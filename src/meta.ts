/**
 * 插件身份与版本 —— 最底层模块，不 import 任何东西。
 *
 * PLUGIN_ID 必须与 package.json 的 name 完全一致，否则 DSH 报
 * `loaded without registering`（`npm run check` 第 1 组会校验）。
 *
 * 浏览器端拿不到 package.json（DSH 只 serve roster 里的 client.js，
 * `/plugins/<id>/package.json` 返回空），所以版本号只能内置。
 */

export const STORAGE_KEY = 'dsh-bloom-variant'

export const PLUGIN_ID = 'dsh-k-bloom-theme'

/** 当前装的版本 —— 必须与 package.json 的 version 一致（本仓库没有自动同步脚本，
 *  发版时两处一起改；`npm run build` 会把包进 lib/client.js 的横幅）。 */
export const PLUGIN_VERSION = '0.18.0'
