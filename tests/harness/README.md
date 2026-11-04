# tests/harness —— 零第三方依赖的截图 / DOM 断言脚手架

T06 建的通用件，**T07/T08 直接复用，不要各写一套**。
只用两样东西：`plugin/node_modules/esbuild`（已在 devDependencies）与 **Node 24 内置全局 `WebSocket` + CDP**。
浏览器 profile 一律在 `os.tmpdir()`（本机 `D:\Cache\Temp`），**不写进工作区**；截图落盘路径由调用方给。

## 1. 最快用法

```js
import { renderAt } from './tests/harness/index.mjs'

const result = await renderAt({
  width: 1440,              // 视口宽（= 宿主面板宽度）
  height: 900,
  entry: 'tests/harness/entries/shell.entry.ts',   // 或用 html / bundlePath
  waitFor: 'html[data-harness-ready]',              // 等 entry 打上就绪标记
  outPng: 'output/_verify/threadline/T07/xxx.png',  // 相对工作区根，或绝对路径
  assert: {
    contains: [{ selector: '[data-region="map"]' }, { selector: '.threadline-brand', text: '脉络' }],
    styles: [{ selector: '[data-region="inspector"]', property: 'position', equals: 'absolute' }],
  },
})
result.ok        // true = 全部断言通过
result.checks    // [{ label, ok, detail }]
result.metrics   // { scrollWidth, clientWidth, regions: [...], inspector: {...}, overflow: [...] }
result.png       // { path, relative, bytes, sha256, mtimeMs } —— 只有 ok 时才落盘
```

批量截图时复用浏览器（5 张图 ≈ 1 次启动）：

```js
import { launchBrowser, renderAtWithBrowser } from './tests/harness/index.mjs'

const browser = await launchBrowser({ width: 1440, height: 900 })
try {
  for (const width of [1440, 1024, 900, 600, 420]) {
    const result = await renderAtWithBrowser(browser, { width, height: 900, entry, outPng, assert })
  }
} finally {
  await browser.close()   // Browser.close + 删 %TEMP% profile（带重试）
}
```

自检：`node tests/harness/selfcheck.mjs`（正向 + 三种反向坏输入；退出码 0 = 全部符合预期）。
A40-2 采集示例：`node tests/harness/run-t06.mjs`。

## 2. `renderAt` 参数

### 2.0 类型签名（可直接复制到 T07/T08 的脚本里）

```ts
export interface RenderAtOptions {
  width: number
  height?: number
  /** 可选：视口更宽、但把入口挂到固定宽容器里（证明是容器查询在起作用） */
  containerWidth?: number
  entry?: string            // .ts/.tsx 入口（esbuild 现打，含 React）
  html?: string             // 或直接给整页 HTML
  bundlePath?: string       // 或给已打好的 IIFE 文本文件
  css?: string
  query?: string            // 追加到 file URL 的查询串，例如 'inspector=0'
  dark?: boolean
  reducedMotion?: boolean
  lang?: string
  title?: string
  waitFor?: string
  waitForTimeoutMs?: number
  actions?: RenderAction[]
  assert?: RenderAssertions
  outPng?: string           // 相对工作区根或绝对路径；断言失败时不落盘
  deviceScaleFactor?: number
  failOnPageError?: boolean     // 默认 true
  failOnConsoleError?: boolean  // 默认 false
  executablePath?: string
  browser?: LaunchedBrowser      // 批量截图时复用
  label?: string
  buildOptions?: Record<string, unknown>
}

export interface RenderCheck {
  label: string
  ok: boolean
  detail: unknown
}

export interface RenderMetrics {
  scrollWidth: number
  clientWidth: number
  scrollHeight: number
  clientHeight: number
  bodyScrollWidth: number
  bodyClientWidth: number
  viewportWidth: number
  viewportHeight: number
  devicePixelRatio: number
  readyState: string
  overflow: Array<{ region: string | null; cls: string; scrollWidth: number; clientWidth: number }>
  regions: Array<{ region: string; x: number; y: number; width: number; height: number; position: string; display: string }>
  inspector: { x: number; y: number; width: number; height: number; position: string; borderRadius: string; maxHeight: string } | null
  appContainerType: string | null
  bodyFontFamily: string
}

export interface RenderResult {
  ok: boolean
  checks: RenderCheck[]
  metrics: RenderMetrics
  errors: string[]              // 页面未捕获异常
  console: Array<{ type: string; text: string }>
  png: { path: string; relative: string; bytes: number; sha256: string; mtimeMs: number } | null
  pageUrl: string
  profileDir: string
  width: number
  height: number
  containerWidth: number
  label: string | null
}

export type RenderAction =
  | { type: 'click'; selector: string }
  | { type: 'evaluate'; code: string; awaitPromise?: boolean }
  | { type: 'wait'; ms?: number }
  | { type: 'waitFor'; selector: string; timeoutMs?: number }
  | { type: 'key'; key?: string }

export interface RenderAssertions {
  noHScroll?: boolean
  noInnerOverflow?: boolean
  contains?: Array<{ selector: string; text?: string }>
  absent?: Array<{ selector: string }>
  count?: Array<{ selector: string; equals: number }>
  styles?: Array<{ selector: string; property: string; equals?: string; matches?: string }>
  boxes?: Array<{ selector: string; minWidth?: number; maxWidth?: number; minHeight?: number; maxHeight?: number; equalsHeight?: number }>
  expr?: Array<{ label: string; code: string; equals?: unknown }>
}

export function renderAt(options: RenderAtOptions): Promise<RenderResult>
```

### 2.1 参数表

| 参数 | 说明 |
|---|---|
| `width` / `height` | 视口尺寸（物理像素 CSS px；deviceScaleFactor 默认 1） |
| `containerWidth` | 可选。视口更宽、但把入口挂在固定宽容器里 —— 用来证明**是容器查询在起作用，不是 viewport** |
| `entry` | `.ts/.tsx` 入口，esbuild 现打（React 会一起打进去；harness 不依赖宿主 `__ModuleLoader__`） |
| `html` | 直接给完整 HTML（不打包），最轻量 |
| `bundlePath` | 给已打好的 IIFE 文本文件 |
| `css` | 额外 CSS（页面级）；宿主令牌桩已自动注入 |
| `query` | 追加到 file URL 的查询串，例如 `'inspector=0'`（entry 用 `location.search` 读） |
| `dark` | `true` → `<body data-ds-dark-theme>`（与 DSH 深色开关同名） |
| `reducedMotion` | `true` → 模拟 `prefers-reduced-motion: reduce` |
| `waitFor` | CSS 选择器，出现后才断言（entry 打 `data-harness-ready` 最稳） |
| `actions` | `[{type:'click',selector} / {type:'evaluate',code} / {type:'wait',ms} / {type:'waitFor',selector} / {type:'key',key}]` |
| `assert` | 见下表 |
| `outPng` | 截图路径；**断言失败时不落盘**（避免留假证据） |
| `freezeAnimations` | 默认 `true`：把页面内所有动画暂停在 0%（**同一状态两次截图逐字节相同**）；要观察动画本身时传 `false` |
| `failOnPageError` | 默认 `true`：页面抛未捕获异常即判红 |
| `failOnConsoleError` | 默认 `false`；需要时打开 |

## 3. `assert` 断言（全部在页面内对真实 DOM / computed style 求值）

| 字段 | 形状 | 说明 |
|---|---|---|
| `noHScroll` | `false` 关闭 | 默认开：`documentElement.scrollWidth <= clientWidth` 且 `body` 同 |
| `noInnerOverflow` | `false` 关闭 | 默认开：扫描 `[data-region]`/shell 各层，`scrollWidth <= clientWidth + 1` |
| `contains` | `[{ selector, text? }]` | 元素存在；给 `text` 则断子串 |
| `absent` | `[{ selector }]` | 元素不存在 |
| `count` | `[{ selector, equals }]` | 匹配数量 |
| `styles` | `[{ selector, property, equals? / matches? }]` | computed style；属性名带 `-` 走 `getPropertyValue`（如 `container-type`、`border-top-left-radius`） |
| `boxes` | `[{ selector, minWidth?, maxWidth?, minHeight?, maxHeight?, equalsHeight? }]` | `getBoundingClientRect` 尺寸 |
| `expr` | `[{ label, code, equals? }]` | 页面内 `new Function('return (' + code + ')')` 求值；`equals` 深比较（不给则要求 `=== true`） |

默认还会跑 `no-page-error`（未捕获异常 0 条）。

## 4. entry 怎么写（照 `entries/shell.entry.ts`）

1. `installStyles(document)` —— 注入真实令牌层 + 基础层（不是另一份 CSS）；
2. 用**确定性合成 fixture** 渲染真组件（不要 `Date.now()` / `Math.random()`，否则截图不可复现）；
3. 支持 URL 参数切状态（locale / theme / 折叠 / 空态 / 错误态），一个参数组合 = 一个可复现状态；
4. 两帧之后打 `document.documentElement.setAttribute('data-harness-ready','1')`，配合 `waitFor` 使用。

## 5. 纪律（踩过的坑）

- **截图必须晚于最后一次代码改动**；`run-t06.mjs` 会把「截图 mtime vs 代码最新 mtime」写进证据，早于代码的图判红。
- **每张图对应一个可复现断言状态**：视口、URL 参数、entry 版本三者固定；不接受"手工拖过之后的状态"。
- **断言失败不落图**：没有 `ok:true` 就没有 png，避免半成品被当证据。
- **页面里不写反引号**（模板串截断事故）；本目录所有字符串拼接都用普通引号。
- **profile 只在 %TEMP%**；`selfcheck.mjs` 有一条断言专门守它。
- 宿主主题桩（`HOST_THEME_STUB`，`build.mjs`）的值抄自 DSH `0.2.1-rc.5` 的 `dsh-client-ui-theme`，**只给 harness 截图用**，产品代码不得引用。
