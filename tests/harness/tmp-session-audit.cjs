/* 只读审计：解压真实会话日志（.zstd），统计 reasoning / usage 数据的存在情况。
 * 仅读取，不写入任何会话文件。 */
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const ROOT = 'E:/DSH/.dsh/sessions'

function walk(dir, out) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.zstd')) out.push(full)
  }
}

const files = []
walk(ROOT, files)

let ok = 0
let fail = 0
let hasReasoning = 0
let hasUsage = 0
let hasTotalTokens = 0
let hasReasoningTokens = 0
const samples = []

for (const file of files.slice(0, 300)) {
  let text
  try {
    const raw = fs.readFileSync(file)
    text = zlib.zstdDecompressSync(raw).toString('utf8')
    ok += 1
  } catch {
    fail += 1
    continue
  }
  const r = text.includes('reasoning')
  const u = text.includes('"usage"') || text.includes('usage')
  const t = text.includes('totalTokens') || text.includes('total_tokens')
  const rt = text.includes('reasoningTokens') || text.includes('reasoning_tokens')
  if (r) {
    hasReasoning += 1
    if (samples.length < 3) samples.push(file)
  }
  if (u) hasUsage += 1
  if (t) hasTotalTokens += 1
  if (rt) hasReasoningTokens += 1
}

console.log('zstd files      = ' + String(files.length))
console.log('decompressed ok = ' + String(ok) + ', failed = ' + String(fail))
console.log('contains reasoning     = ' + String(hasReasoning))
console.log('contains usage         = ' + String(hasUsage))
console.log('contains totalTokens   = ' + String(hasTotalTokens))
console.log('contains reasoningTokens = ' + String(hasReasoningTokens))
console.log('samples:')
for (const s of samples) console.log('  ' + s)
