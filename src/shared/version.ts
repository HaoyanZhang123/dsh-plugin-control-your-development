/**
 * 版本号的单一事实源。
 *
 * 规则（04 §7.5）：
 * - `package.json` 的 version 必须与这里一致，构建脚本会用本文件校验；
 * - T12 会把 `project.yml` / `README.md` / `CHANGELOG.md` 也纳入全链校验；
 * - 不做构建期注入（避免“未构建路径上 undefined”的静默失效），产物里的版本来自本常量；
 * - 改版本只改这里 + package.json，不许在别处手写第二份。
 */
export const VERSION = '1.4.1'
