/*
 * shared/reasoning/sentences.ts —— 句子切分 + 语言/句式启发式（纯函数）。
 *
 * 为什么放在 shared：host 归约与 client 展示必须用**同一套**切分与分类，
 * 否则「排行里的 I need 有 12 句、点进去却有 9 句」这种不一致会直接毁掉可信度。
 *
 * 明确边界（会被测试与文案引用）：
 * - 切分是**规则切分**，不是语言模型理解；缩写、代码、小数都可能切得不完美；
 * - 语言按 Unicode 脚本粗判（Han/Kana/Hangul/Latin），混排归 mixed，判不出归 unknown；
 * - 句式是**句首模式匹配**，不是句法分析；
 * - 所有阈值与正则都是常量，便于测试与复核。
 */
import type { ReasoningForm, ReasoningLang } from './types.ts'

/** 句首短语的最大字符数（排行键；超过就截断，避免把整句当"句式"）。 */
export const PREFIX_MAX_CHARS = 24

/** 单句最大字符数（超长句截断，避免一条记录撑爆列表）。 */
export const SENTENCE_MAX_CHARS = 400

/** 单块最多切出的句子数（防御：异常长文本）。 */
export const MAX_SENTENCES_PER_BLOCK = 200

/** 代码围栏/行内代码先挖掉，避免把 `foo()` 里的点号当句号。 */
function stripCode(text: string): string {
  /* 围栏整段替换成一个不含标点的占位符（保留换行，让段落结构还在）：
   * 直接把内容删掉会让 "Call this:\n```code```\nThen..." 粘成一句。 */
  return text
    .replace(/```[\s\S]*?```/g, (block) => '\n' + 'code'.repeat(1) + '\n'.repeat(Math.max(1, (block.match(/\n/g) ?? []).length)))
    .replace(/`[^`]*`/g, 'code')
}

/**
 * 切句：在句末标点后切分，但**不切**常见缩写与小数。
 *
 * 规则（可复核）：
 * - 终止符：`.` `。` `!` `！` `?` `？` `;` `；` 与换行；
 * - 英文缩写（e.g. / i.e. / etc. / Mr. / vs. / approx.）与单字母首字母缩写不切；
 * - 小数点（数字.数字）不切；
 * - 连续终止符（`?!`、`……`）作为一次切分。
 */
export function splitSentences(input: string): string[] {
  if (typeof input !== 'string' || input === '') return []
  const text = stripCode(input)
  const out: string[] = []
  let buffer = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const isTerminator = char === '.' || char === '。' || char === '!' || char === '！' || char === '?' || char === '？' || char === ';' || char === '；'
    const isBreak = char === '\n'
    if (isTerminator) {
      buffer += char
      if (char === '.') {
        const next = text[index + 1] ?? ''
        const prev = buffer[buffer.length - 2] ?? ''
        // 小数：数字.数字
        if (/[0-9]/.test(prev) && /[0-9]/.test(next)) continue
        // 缩写：形如 "e.g." / "vs." / 单字母 "A."
        const tail = buffer.slice(0, -1)
        if (/(?:^|\s)(?:e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|approx|fig|no|al)$/i.test(tail)) continue
        if (/(?:^|\s)[A-Za-z]$/.test(tail)) continue
        // 后面紧跟非空白字符（如 ".ts"）：不当作句末
        if (next !== '' && !/\s/.test(next)) continue
      }
      // 连续终止符一起吞掉
      while (index + 1 < text.length && /[.!?！？。]/.test(text[index + 1] ?? '')) {
        buffer += text[index + 1]
        index += 1
      }
      const trimmed = buffer.trim()
      if (trimmed !== '') out.push(trimmed)
      buffer = ''
      if (out.length >= MAX_SENTENCES_PER_BLOCK) break
      continue
    }
    if (isBreak) {
      const trimmed = buffer.trim()
      if (trimmed !== '') out.push(trimmed)
      buffer = ''
      if (out.length >= MAX_SENTENCES_PER_BLOCK) break
      continue
    }
    buffer += char
  }
  const tail = buffer.trim()
  if (tail !== '' && out.length < MAX_SENTENCES_PER_BLOCK) out.push(tail)
  return out
}

/** 非空白字符数（按 code point 计，emoji/汉字都算 1 个）。 */
export function countChars(input: string): number {
  if (typeof input !== 'string' || input === '') return 0
  let count = 0
  for (const char of input) {
    if (/\s/.test(char)) continue
    count += 1
  }
  return count
}

/** 脚本字符计数（用于语言粗判）。 */
const SCRIPT_RE = {
  han: /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g,
  kana: /[\u3040-\u30FF]/g,
  hangul: /[\uAC00-\uD7AF\u1100-\u11FF]/g,
  latin: /[A-Za-z]/g,
  cyrillic: /[\u0400-\u04FF]/g,
  arabic: /[\u0600-\u06FF]/g,
}

function scriptCounts(text: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [key, re] of Object.entries(SCRIPT_RE)) {
    const matches = text.match(re)
    counts[key] = matches === null ? 0 : matches.length
  }
  return counts
}

/**
 * 语言粗判（按脚本占比）。
 *
 * 判定顺序：含假名 → ja；含谚文 → ko；汉字占绝对多数 → zh；
 * 拉丁占多数 → en；两种以上都显著 → mixed；一个脚本都没有 → unknown。
 */
export function detectLang(input: string): ReasoningLang {
  if (typeof input !== 'string' || input.trim() === '') return 'unknown'
  const counts = scriptCounts(input)
  const han = counts.han ?? 0
  const kana = counts.kana ?? 0
  const hangul = counts.hangul ?? 0
  const latin = counts.latin ?? 0
  const other = (counts.cyrillic ?? 0) + (counts.arabic ?? 0)
  const total = han + kana + hangul + latin + other
  if (total === 0) return 'unknown'
  if (kana > 0 && kana + han >= total * 0.5) return 'ja'
  if (hangul > 0 && hangul + han >= total * 0.5) return 'ko'
  /* 混合判据要先于单一语种：中英混排时两边都显著，硬判成任何一边都是错的。
   * 阈值 0.2 的含义：拉丁或汉字任一占到 20% 以上，就认为两种语言都在场。 */
  const cjk = han + kana + hangul
  const minorShare = Math.min(latin, cjk) / total
  if (minorShare >= 0.2) return 'mixed'
  if (han >= total * 0.6) return 'zh'
  if (latin >= total * 0.6) return 'en'
  if (other >= total * 0.6) return 'unknown'
  return 'mixed'
}

/**
 * 句首句式（启发式）。
 *
 * 只在**句首**匹配：句中出现 "why" 不代表这整句是疑问句，
 * 这样「句式排行」才对应真实可读的"句子是怎么开头的"。
 */
const FORM_PATTERNS: ReadonlyArray<{ form: ReasoningForm; re: RegExp }> = [
  /* 精确前缀优先于泛化前缀：「需要注意的是」不能被「需要」抢先判成祈使。 */
  { form: 'warning', re: /^(?:careful|warning|note that|beware|需要注意|需要注意的是|小心|风险|不要)/i },
  { form: 'question', re: /^(?:why|what|how|when|where|which|who|should|could|would|can|is|are|does|do|did|might|may|是不是|为什么|怎么|如何|是否|能不能|要不要)/i },
  { form: 'imperative', re: /^(?:check|look|verify|make|let me|let's|use|add|remove|run|test|ensure|avoid|keep|先|请|务必|记得|注意|检查|确认|需要|先把)/i },
  { form: 'plan', re: /^(?:i need|we need|i should|we should|i will|we will|i'll|we'll|i can|we can|next|then|let us|接下来|下一步|首先|其次|然后|我将|我们)/i },
]

export function detectForm(input: string): ReasoningForm {
  const text = (input ?? '').trim()
  if (text === '') return 'statement'
  for (const rule of FORM_PATTERNS) {
    if (rule.re.test(text)) return rule.form
  }
  return 'statement'
}

/**
 * 句首短语（排行键）。
 *
 * 英文取前 1–3 个词（优先匹配已知句式前缀），中文取前若干字；
 * 统一小写化仅用于**匹配**，返回保留原文以便展示（"I need" 而不是 "i need"）。
 */
const KNOWN_PREFIXES: readonly string[] = [
  'I need', 'We need', 'I should', 'We should', 'I will', 'We will', "I'll", "We'll",
  'I can', 'We can', 'Let me', "Let's", 'Let us', 'I want', 'We want', 'I think', 'We think',
  'Could you', 'Can you', 'Would you', 'Should I', 'Might', 'Perhaps', 'First', 'Next', 'Then',
  '先检查', '先确认', '接下来', '下一步', '首先', '其次', '然后', '需要确认', '需要注意的是',
  '检查一下', '确认一下', '请', '如果', '这样', '因此', '所以',
]

export function extractPrefix(input: string): string {
  const text = (input ?? '').trim()
  if (text === '') return ''
  for (const known of KNOWN_PREFIXES) {
    if (text.toLowerCase().startsWith(known.toLowerCase())) return text.slice(0, known.length)
  }
  // 未命中已知前缀：英文取前两个词，中文取前 4 个字符。
  if (/^[A-Za-z]/.test(text)) {
    const words = text.split(/\s+/).slice(0, 2).join(' ')
    return words.slice(0, PREFIX_MAX_CHARS)
  }
  const chars = Array.from(text).slice(0, 4).join('')
  return chars.slice(0, PREFIX_MAX_CHARS)
}

/** 句子截断（超长句只保留前 N 字符，并标省略号；不影响 chars 统计口径的调用方需自行决定）。 */
export function truncateSentence(input: string, max = SENTENCE_MAX_CHARS): string {
  const chars = Array.from(input ?? '')
  if (chars.length <= max) return input ?? ''
  return chars.slice(0, max).join('') + '…'
}
