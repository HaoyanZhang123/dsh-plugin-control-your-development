/*
 * 打包产物安装自检：把 tgz 解到临时目录，验证"装上去能被 DSH 加载"的几个硬条件。
 * 不碰任何现有安装、不改 profile、不启动 DSH。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TARBALL = 'dsh-plugin-control-your-development-1.5.0.tgz'
const results = []
let failures = 0
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failures += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' :: ' + JSON.stringify(detail))
}

const dir = mkdtempSync(join(tmpdir(), 'tl-pack-'))
try {
  execFileSync('tar', ['-xzf', TARBALL, '-C', dir], { stdio: 'ignore' })
  const root = join(dir, 'package')

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  record('package.json 可解析', true, { name: pkg.name, version: pkg.version })
  record('版本是 1.5.0', pkg.version === '1.5.0', { version: pkg.version })

  /* 入口必须指向真实存在的产物文件。 */
  const mainPath = join(root, pkg.main ?? 'index.js')
  record('main 指向的产物存在', existsSync(mainPath), { main: pkg.main })

  /* DSH 客户端注入点：dsh.client 字段。 */
  const clientEntry = pkg.dsh?.client?.entry ?? pkg.dsh?.client
  record('声明了 dsh.client 注入点', clientEntry !== undefined, { client: JSON.stringify(pkg.dsh?.client) })

  /* 依赖铁律：dependencies 必须为空对象。 */
  record('dependencies 为空（零第三方依赖）', JSON.stringify(pkg.dependencies ?? {}) === '{}', {
    dependencies: pkg.dependencies,
  })

  /* 产物可被 require 的形态：client 是 CJS 包装、host 是 ESM。 */
  const clientCode = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  record('client 产物是 __ModuleLoader__ 包装', clientCode.includes('__ModuleLoader__'), {})
  record('client 产物 external react', /require\("react"\)/.test(clientCode), {})
  record('client 产物无 react.production（未打包进 React）', clientCode.includes('react.production') === false, {})

  const hostCode = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
  record('host 产物存在且非空', hostCode.length > 1000, { bytes: hostCode.length })
  /* 只读铁律：host 不得 import fs。 */
  record('host 产物不 import node:fs', /from\s*["']node:fs["']|require\(["']node:fs["']\)/.test(hostCode) === false, {})

  /* 不应包含源码与测试。 */
  record('不含 src 目录', existsSync(join(root, 'src')) === false, {})
  record('不含 tests 目录', existsSync(join(root, 'tests')) === false, {})
  record('不含 node_modules', existsSync(join(root, 'node_modules')) === false, {})
  record('含 CHANGELOG', existsSync(join(root, 'CHANGELOG.md')), {})
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('---')
console.log(failures === 0 ? 'ALL PASS' : 'FAILURES: ' + String(failures))
process.exit(failures === 0 ? 0 : 1)
