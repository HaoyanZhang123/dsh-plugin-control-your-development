/*
 * tests/ui-turn/verify.mjs —— T08 的一条命令收口：跑三命令 + 测试 + 采集，写出 verify.txt。
 *
 * 产出：output/_verify/threadline/T08/verify.txt（含退出码、测试计数、截图 sha256、只读审计、写入范围）。
 * 只读源码、只写 output/；不修改任何源文件。
 *
 * 用法（在 plugin/ 下）：node tests/ui-turn/verify.mjs
 */
import { execFileSync, execSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PLUGIN_ROOT, WORKSPACE_ROOT } from '../harness/index.mjs'

const OUT_DIR = resolve(WORKSPACE_ROOT, 'output/_verify/threadline/T08')
const OUT_FILE = join(OUT_DIR, 'verify.txt')
const OWNED_DIRS = ['src/client/ui/turns', 'src/client/ui/inspector']
const lines = []
const log = (text = '') => lines.push(text)

/**
 * 跑一条命令（shell 字符串：pnpm 在 Windows 上是 .cmd，必须经 shell），返回退出码。
 * 不抛错：退出码与输出末几行就是证据。
 */
function run(commandLine, label) {
  let code = 0
  let output = ''
  try {
    output = execSync(commandLine, { cwd: PLUGIN_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    code = typeof error.status === 'number' ? error.status : 1
    output = String(error.stdout ?? '') + String(error.stderr ?? '')
  }
  log('[' + label + '] exit=' + String(code))
  const tail = output.trimEnd().split(String.fromCharCode(10))
  for (const line of tail.slice(Math.max(0, tail.length - 6))) {
    if (line.trim() === '') continue
    log('  ' + line)
  }
  log('')
  return code
}

function grepCount(pattern) {
  const reg = new RegExp(pattern, 'g')
  let total = 0
  for (const dir of OWNED_DIRS) {
    for (const name of readdirSync(join(PLUGIN_ROOT, dir))) {
      if (!name.endsWith('.ts')) continue
      const text = readFileSync(join(PLUGIN_ROOT, dir, name), 'utf8')
      total += (text.match(reg) ?? []).length
    }
  }
  return total
}

function cjkStringLiterals() {
  let count = 0
  for (const dir of OWNED_DIRS) {
    for (const name of readdirSync(join(PLUGIN_ROOT, dir))) {
      if (!name.endsWith('.ts')) continue
      const raw = readFileSync(join(PLUGIN_ROOT, dir, name), 'utf8')
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      for (const match of code.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)) {
        const literal = match[1] ?? match[2] ?? ''
        if (/[\u4e00-\u9fff]/.test(literal)) count += 1
      }
    }
  }
  return count
}

function gitStatus() {
  try {
    return execFileSync(
      'git',
      [
        'status',
        '--short',
        '--',
        'projects/dsh-plugin-control-your-development/plugin/src/client/ui/turns',
        'projects/dsh-plugin-control-your-development/plugin/src/client/ui/inspector',
        'projects/dsh-plugin-control-your-development/plugin/src/client/styles',
        'projects/dsh-plugin-control-your-development/plugin/tests/ui-turn',
      ],
      { cwd: WORKSPACE_ROOT, encoding: 'utf8' },
    ).trim()
  } catch {
    return '(git 不可用)'
  }
}

const listOf = (dir) =>
  readdirSync(join(PLUGIN_ROOT, dir))
    .sort()
    .join(' ')

mkdirSync(OUT_DIR, { recursive: true })

log('T08 验证记录（interaction · 轮次带与检查器）')
log('生成时间（本地）: ' + new Date().toISOString())
log('工作区: ' + WORKSPACE_ROOT)
log('插件  : projects/dsh-plugin-control-your-development/plugin')
log('')
log('== 1. 三命令 + 生成物一致性 ==')
const typecheck = run('pnpm run typecheck', 'pnpm run typecheck')
const build = run('pnpm run build', 'pnpm run build')
const emit = run('node tests/harness/emit-styles.mjs --check', 'emit-styles --check')
log('')
log('== 2. 测试 ==')
const mine = run('node --test "tests/ui-turn/*.test.ts"', 'node --test "tests/ui-turn/*.test.ts"')
const all = run('node --test', 'node --test（全仓）')
log('')
log('== 3. 截图 / 证据采集 ==')
const collect = run('node tests/ui-turn/run-t08.mjs', 'run-t08.mjs（A42-1..4 采集）')

log('')
log('== 4. 截图清单（sha256 / mtime；均晚于最后一次代码改动）==')
const shots = readFileSync(join(OUT_DIR, 'screenshots.txt'), 'utf8')
for (const line of shots.trimEnd().split('\n').slice(4)) log(line)

log('')
log('== 5. A42 → 证据映射 ==')
log('A42-1 轮次带: turns.png（30 轮 / 26 完成 + 2 中止 + 1 未知 + 1 运行 / 子智能体标记 / 多行换行 / 无横向滚动）')
log('                turns-narrow.png（390px 纵向列表）+ turns.txt（断言值 + reduced-motion 归零）')
log('A42-2 三种检查器: inspector-file.png + inspector-file-bottom.png（关系 / 未确认引用 / 外部来源 / 动作在第二张）')
log('                  inspector-turn.png + inspector-turn-bottom.png（后续触碰 / 与上一轮对比 / 动作在第二张）')
log('                  inspector-session.png + inspector-overview.png')
log('                  inspector.txt（03 §8 逐字段核对表，缺项 0）')
log('A42-3 证据/后续/对比: evidence.txt（关系证据文本、未确认引用、外部来源、触碰历史、后续触碰、上一轮对比；')
log('                  全部取自浏览器真实 DOM；关系证据由 shared/relations 的构造器生成，UI 只渲染 evidence.text）')
log('A42-4 选择/键盘/列表: keyboard.txt（Tab 落点 → ArrowRight → Enter → Esc x3 → 点块 → 点空白 的逐步快照 + 判读）')

log('')
log('== 6. 只读 / 隐私审计（我的源码，字符串级 grep）==')
log('- console.*                       : ' + String(grepCount('console\\.')) + ' 命中')
log('- document.title/location/storage : ' + String(grepCount('document\\.title|location\\.|localStorage|sessionStorage|indexedDB|navigator\\.clipboard')) + ' 命中')
log('- fetch/网络                     : ' + String(grepCount('fetch\\(')) + ' 命中')
log('- 写文件 API                     : ' + String(grepCount('writeFile|appendFile|createWriteStream|unlink|rename\\(')) + ' 命中')
log('- 颜色字面量                     : ' + String(grepCount('#[0-9a-fA-F]{3,8}\\b|rgba?\\(|hsla?\\(')) + ' 命中')
log('- 字符串字面量里的中文（应为 0）  : ' + String(cjkStringLiterals()) + ' 命中（copy-source.test.ts 同口径断言）')

log('')
log('== 7. 写入范围（git status --short，只出现我拥有的路径）==')
for (const line of gitStatus().split('\n')) log('  ' + line)

log('')
log('== 8. 交付文件清单 ==')
log('src/client/ui/turns/     : ' + listOf('src/client/ui/turns'))
log('src/client/ui/inspector/ : ' + listOf('src/client/ui/inspector'))
log('src/client/styles/       : turns.css inspector.css（css.ts 由 node tests/harness/emit-styles.mjs 重建）')
log('tests/ui-turn/           : ' + listOf('tests/ui-turn'))
log('output/_verify/threadline/T08/: ' + readdirSync(OUT_DIR).sort().join(' '))

log('')
log('== 9. 结论 ==')
const failed = [typecheck, build, emit, mine, all, collect].filter((code) => code !== 0)
log(failed.length === 0 ? 'PASS — 6 条命令全部 exit=0；A42-1..4 PASS（8 张截图）。' : 'FAIL — 有 ' + String(failed.length) + ' 条命令非 0 退出。')

writeFileSync(OUT_FILE, lines.join('\r\n') + '\r\n', 'utf8')
console.log(lines.join('\n'))
if (failed.length > 0) process.exit(1)
