/**
 * DOM 工具层：样式注入、变体读写、宿主查找、<think> 标签收拾。
 *
 * injectCSS 用 data-plugin-css 属性做幂等标记 —— DSH 的 cordis materialize
 * 可能多次调用 apply，重复注入会让同一份 CSS 叠好几份。
 */
import { PLUGIN_ID, STORAGE_KEY } from './meta.js'
import { VARIANTS } from './palette.js'


/**
 * 收拾裸露的 <think> 标签。
 *
 * ⚠️ 这是 workaround，不是根治。根因在 LLM 适配层：某些模型（如 MiniMax-M3）把思考
 * 内容内联在 content 里输出 <think>…</think>，而 DSH 的推理解析没识别它，于是整段
 * 当普通 markdown 渲染，标签就露在正文里。正解是在 provider 适配层解析成 reasoning
 * 字段，交给 DSH 原生的 ReasoningRow 渲染。
 *
 * 之所以敢在主题层做：实测这些标签**各自独占一个段落元素**（56/56，无一混在正文中），
 * 所以只标记、不改任何文本内容 —— 隐藏它们不会丢字。
 * 只加 data-* 属性，不动 DOM 结构，React 重渲染最多是属性丢失，observer 会补回来。
 */
export const THINK_OPEN = '<think>'

export const THINK_CLOSE = '</think>'

/**
 * 「DOM 变了」的唯一 observer 与两类订阅（v0.19 合并）。
 *
 * 为什么合并：插件里有两拨人想知道 DOM 变了 —— 切换器要尽快重挂（毫秒级），
 * 思考标签/计时行要重扫（可以慢，300ms）。以前各挂一个 observer，同一份变更被
 * 通知两遍，切换器那份还没有节流。
 *
 * 两类订阅：
 * · onDomMutation：rAF 合并，≤60 次/秒。只许做「查询 + 幂等修补」。
 * · onDomRecords：每批 records 都回调（不节流），交给调用方自己决定轻重。
 *   重活（全文档扫描）继续由调用方自己按 300ms 节流。
 */
type RecordsHandler = (records: MutationRecord[]) => void
const mutationListeners: Array<() => void> = []
const recordsHandlers: RecordsHandler[] = []
let mutationFrame = 0
let mutationObserver: MutationObserver | null = null

export function onDomMutation(fn: () => void) {
  if (mutationListeners.indexOf(fn) < 0) mutationListeners.push(fn)
}

export function onDomRecords(fn: RecordsHandler) {
  if (recordsHandlers.indexOf(fn) < 0) recordsHandlers.push(fn)
}

function flushMutationListeners() {
  mutationFrame = 0
  for (let i = 0; i < mutationListeners.length; i++) {
    // 单个订阅出错不能拖垮别的，但必须留痕 —— 静默 catch 等于把唯一诊断信号吞掉
    try { mutationListeners[i]() } catch (e) { console.warn('[bloom] dom subscriber failed', e) }
  }
}

export function ensureObserver(): MutationObserver | null {
  if (mutationObserver) return mutationObserver
  if (!document.body) return null
  mutationObserver = new MutationObserver((records) => {
    // ① 轻量订阅：每帧最多一次
    if (!mutationFrame) mutationFrame = requestAnimationFrame(flushMutationListeners)
    // ② records 订阅：每批一次（调用方自己节流）
    for (let i = 0; i < recordsHandlers.length; i++) {
      try { recordsHandlers[i](records) } catch (e) { console.warn('[bloom] dom records handler failed', e) }
    }
  })
  mutationObserver.observe(document.body, { childList: true, subtree: true, characterData: true })
  return mutationObserver
}

/**
 * 收拾裸露的 <think> 标签。
 *
 * ⚠️ 这是 workaround，不是根治。根因在 LLM 适配层：某些模型（如 MiniMax-M3）把思考
 * 内容内联在 content 里输出 <think>…</think>，而 DSH 的推理解析没识别它，于是整段
 * 当普通 markdown 渲染，标签就露在正文里。正解是在 provider 适配层解析成 reasoning
 * 字段，交给 DSH 原生的 ReasoningRow 渲染。
 *
 * 之所以敢在主题层做：实测这些标签**各自独占一个段落元素**（56/56，无一混在正文中），
 * 所以只标记、不改任何文本内容 —— 隐藏它们不会丢字。
 * 只加 data-* 属性，不动 DOM 结构，React 重渲染最多是属性丢失，observer 会补回来。
 *
 * v0.19：支持局部根。传了 dirty（候选节点集合）就只从这些节点往下找，不再每次
 * 全文档走 TreeWalker —— 普通回答没有 think 标签时，这一步被完全跳过。
 */
export function markThinkTags(dirty?: Set<Node> | null) {
  const roots: Node[] = []
  if (dirty) {
    // 相邻候选会被重复遍历（父节点被加进来的同时子文本节点也在集合里），
    // 用 isConnected + 父先入的简单去重：只要祖先也在集合里就跳过自己。
    dirty.forEach((n) => {
      if (!n.isConnected) return
      let p = n.parentNode
      while (p) {
        if (dirty.has(p)) return
        p = p.parentNode
      }
      roots.push(n)
    })
  } else {
    if (!document.body) return
    roots.push(document.body)
  }
  if (!roots.length) return

  const tags = []
  for (let r = 0; r < roots.length; r++) {
    const walker = document.createTreeWalker(roots[r], NodeFilter.SHOW_TEXT)
    let n
    while ((n = walker.nextNode())) {
      const t = (n.nodeValue || '').trim()
      if (t !== THINK_OPEN && t !== THINK_CLOSE) continue
      const el = n.parentElement
      if (!el || el.dataset.bloomThink) continue
      el.dataset.bloomThink = t === THINK_OPEN ? 'open' : 'close'
      tags.push(el)
    }
  }
  if (!tags.length) return
  // 配对：把开闭标签之间的兄弟节点标成思考内容（降权显示，不隐藏 —— 信息不丢）
  for (const el of tags) {
    if (el.dataset.bloomThink !== 'open') continue
    for (let sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
      if (sib.dataset.bloomThink === 'close') break
      if (sib.dataset.bloomThink === 'open') break // 未配对，停手
      sib.dataset.bloomThinkBody = 'true'
    }
  }
}

/* 流式输出会高频触发，重活节流到 300ms。
   v0.19：兜底改按**墙钟** 5s 算 —— 曾经想用「每 15 个 tick 扫一次」，但 tick 只在
   这个定时器里 ++，churn 一停 tick 就不走了，等于永远不再兜底。 */
let thinkTimer: ReturnType<typeof setTimeout> | null = null
let thinkCandidates: Set<Node> | null = null
let lastFullScan = 0
const FULL_SCAN_MS = 5000

function collectThinkCandidates(records: MutationRecord[]) {
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    if (r.type === 'characterData') {
      // 只收「文本里真的出现标签」的节点：绝大多数 token 都不含 '<think'，
      // 这一层过滤把候选集压到接近空，下面那趟 TreeWalker 自然就不跑了。
      const v = r.target.nodeValue
      if (v && (v.indexOf('<think') >= 0 || v.indexOf('</think') >= 0)) {
        ;(thinkCandidates || (thinkCandidates = new Set())).add(r.target)
      }
      continue
    }
    for (let j = 0; j < r.addedNodes.length; j++) {
      const n = r.addedNodes[j]
      const t = n.nodeType === 3 ? n.nodeValue : n.textContent
      if (t && (t.indexOf('<think') >= 0 || t.indexOf('</think') >= 0)) {
        ;(thinkCandidates || (thinkCandidates = new Set())).add(n)
      }
    }
  }
}

function scheduleThinkScan(records?: MutationRecord[]) {
  if (records) collectThinkCandidates(records)
  if (thinkTimer) return
  thinkTimer = setTimeout(() => {
    thinkTimer = null
    const cands = thinkCandidates
    thinkCandidates = null
    const now = Date.now()
    const full = !cands || now - lastFullScan > FULL_SCAN_MS
    if (full) lastFullScan = now
    if (!full) markThinkTags(cands)
    else markThinkTags(null)
    markLiveTurn()
  }, 300)
}

export function watchThinkTags() {
  if (window.__dshBloomThinkObserver__) return
  const obs = ensureObserver()
  if (!obs) return
  onDomRecords(scheduleThinkScan)
  window.__dshBloomThinkObserver__ = obs // 只有这里写这个 marker
  markThinkTags()
  markLiveTurn()
}

/**
 * 标出「正在跑」的那一行轮次状态 —— "深度求索中，用时 1分30秒"。
 *
 * ## 为什么需要 JS 标
 *
 * 这行字现在由 DSH 渲染成 `<button data-turn-process>` 里的一个 label，
 * **跑完和跑着是同一个元素**：跑完是 "用时 7分11秒"，跑着是 "深度求索中，用时
 * 1分30秒"，两者在 DOM 上只差文本内容，没有状态属性可挂。
 * （实测三种状态：跑完折叠 `data-open`+disabled、跑完展开 `aria-expanded`、
 * 正在跑 `data-open`+disabled —— disabled / data-open 都不能当「在跑」的判据。）
 *
 * 唯一稳定的信号是**文本在变**：计时每 ~1s 跳一次，跑完就不动了。
 * 所以：同一个 row 的文本相比上一次扫描变了 → 标上；2.5s 内没等到下一次变化
 * → 摘掉。切会话时新 row 第一次被看到不算「变过」（WeakMap 里没有旧值），
 * 所以切过去不会先闪一下再停。
 *
 * ## 为什么复用 watchThinkTags 的 observer
 *
 * 两者要的都是「DOM 变了就重扫一遍」，而计时文本本身就是 characterData 变更，
 * 已经在那个 observer 的射程里。再挂一个 observer 只是把同样的事做两遍。
 * 代价是函数名比做的事多一点 —— 已在调用处注明。
 */
const LIVE_TURN_ATTR = 'data-bloom-live-turn'
const lastRowText = new WeakMap<Element, string>()
let liveTurnTimer: ReturnType<typeof setTimeout> | undefined

export function markLiveTurn() {
  const rows = document.querySelectorAll('[data-turn-process]')
  if (!rows.length) return
  // DOM 顺序就是时间顺序，最后一个 = 当前这一轮
  const row = rows[rows.length - 1]
  const label = row.querySelector('[class*="_label"]') || row
  const text = (label.textContent || '').trim()
  if (!text) return
  const prev = lastRowText.get(row)
  lastRowText.set(row, text)
  if (prev === undefined || text === prev) return      // 初次见到 / 没变 → 不算在跑
  row.setAttribute(LIVE_TURN_ATTR, '')
  if (liveTurnTimer) clearTimeout(liveTurnTimer)
  liveTurnTimer = setTimeout(() => {
    if (lastRowText.get(row) === text) row.removeAttribute(LIVE_TURN_ATTR)
  }, 2500)
}

/* v0.5.0：氛围层（壁纸 / 玻璃开关 / 主题包）整体移除，玻璃改为默认常开。 */

export function readVariant() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return VARIANTS.includes(v) ? v : 'mist'
  } catch { return 'mist' }
}

export function injectCSS(css, idSuffix) {
  const tagId = PLUGIN_ID + '/' + idSuffix
  if (document.querySelector<HTMLElement>('style[data-plugin-css="' + tagId + '"]')) return
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = tagId
  tag.textContent = css
  document.head.appendChild(tag)
}

/**
 * 挂载点：优先塞进 DSH 顶栏的工具区，跟 Session log 等原生控件并排。
 *
 * 之前用 position:fixed 浮在右上角，实测矩形与 Session log 按钮几乎完全重合，
 * 把人家整个盖住点不到 —— 浮层永远有压住宿主控件的风险，挂进 DOM 才是根治。
 * 找不到宿主时退回浮动，但位置移到 header 下方（见 [data-floating] 样式）。
 */
export function findSwitcherHost() {
  // 必须限定在真顶栏（<header>）内部再找。
  //
  // 侧边栏「工作区」那一行也有个 [class*="_headerActions"] 容器（另一套 CSS Module
  // 前缀，实测 qDHVXG_headerActions vs 顶栏的 wSkVaW_headerActions），而它在 DOM 里
  // 排在顶栏之前 —— 不限定作用域时 document.querySelector 会先命中它，切换器就被
  // prepend 到左边侧边栏去了。新建会话时顶栏子树重建、_headerUtilities 短暂消失，
  // fallback 生效，于是「右上角的切换器跑到左边」。
  const header = document.querySelector<HTMLElement>('header[class*="_header"]') || document.querySelector<HTMLElement>('header')
  if (!header) return null
  return header.querySelector<HTMLElement>('[class*="_headerUtilities"]')
    || header.querySelector<HTMLElement>('[class*="_headerActions"]')
    || null
}
