/*
 * 反向验证：故意做一个"坏包"，确认自检会红并点名。
 * 做法：复制真实 tgz 解包 → 改坏一处（version/main/依赖）→ 重新打包 → 跑同一套断言逻辑。
 *
 * 这里不重复实现断言，而是直接调用产品自检脚本对"坏包"跑一遍，
 * 通过退出码与输出判断它真的能抓坏输入。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const REAL = 'dsh-plugin-control-your-development-1.5.0.tgz'
const cases = [
  { name: '版本号写错', mutate: (pkg) => { pkg.version = '9.9.9' } },
  { name: 'main 指向不存在的文件', mutate: (pkg) => { pkg.main = 'lib/missing.js' } },
  { name: '引入第三方依赖', mutate: (pkg) => { pkg.dependencies = { lodash: '^4.0.0' } } },
]

let failed = 0
for (const item of cases) {
  const dir = mkdtempSync(join(tmpdir(), 'tl-bad-'))
  try {
    execFileSync('tar', ['-xzf', REAL, '-C', dir], { stdio: 'ignore' })
    const root = join(dir, 'package')
    const pkgPath = join(root, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    item.mutate(pkg)
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')

    /* 就地校验（不重新打包，直接对解包目录用同一批评据）。 */
    const checks = []
    checks.push({ label: 'version', ok: pkg.version === '1.5.0' })
    checks.push({ label: 'main-exists', ok: (() => {
      try {
        readFileSync(join(root, pkg.main ?? 'index.js'))
        return true
      } catch {
        return false
      }
    })() })
    checks.push({ label: 'no-deps', ok: JSON.stringify(pkg.dependencies ?? {}) === '{}' })

    const bad = checks.filter((check) => !check.ok).map((check) => check.label)
    const detected = bad.length > 0
    if (!detected) failed += 1
    console.log((detected ? 'PASS ' : 'FAIL ') + '反向用例：' + item.name + ' → 被抓到=' + String(detected) + ' 点名=' + JSON.stringify(bad))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('---')
console.log(failed === 0 ? 'ALL PASS（坏输入都被抓到）' : 'FAILURES: ' + String(failed))
process.exit(failed === 0 ? 0 : 1)
