/*
 * harness/index.mjs —— harness 的唯一出口（T06 自检、T07/T08 复用）。
 */
export { HarnessError, BROWSER_CANDIDATES, launchBrowser, resolveBrowserPath } from './cdp.mjs'
export {
  DEFAULT_ENTRY,
  HOST_THEME_STUB,
  PAGE_RESET,
  PLUGIN_ROOT,
  buildEntryHtml,
  bundleEntry,
  makePageHtml,
  readBundle,
} from './build.mjs'
export {
  WORKSPACE_ROOT,
  evaluateAssertions,
  renderAt,
  renderAtWithBrowser,
} from './screenshot.mjs'
