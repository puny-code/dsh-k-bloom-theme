/**
 * 把浏览器半侧（src/client.ts 及其依赖）打成单文件 lib/client.js。
 *
 * 为什么不用 tsc：DSH 的插件 client.js 是 classic script，容不下 import/export，
 * 也不从 node_modules 解析裸模块。tsc 只能输出 ESM，所以浏览器半侧走 esbuild
 * 的 iife 单文件打包；node 半侧（src/index.ts）仍然是 tsc 产物。
 *
 *   node scripts/bundle.mjs           一次性构建
 *   node scripts/bundle.mjs --watch   监听改动
 */
import { build, context } from 'esbuild'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const banner = `/* ${pkg.name} v${pkg.version} —— 由 scripts/bundle.mjs 从 src/*.ts 打包生成，请勿直接编辑。
   源码入口 src/client.ts；改完跑 npm run build。 */`

const options = {
  entryPoints: ['src/client.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  charset: 'utf8',
  legalComments: 'none',
  banner: { js: banner },
  logLevel: 'info',
}

if (process.argv.includes('--watch')) {
  const ctx = await context(options)
  await ctx.watch()
  console.log('[bundle] watching src/client.ts …')
} else {
  await build(options)
  console.log(`[bundle] lib/client.js ← ${pkg.name} v${pkg.version}`)
}
