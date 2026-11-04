/*
 * copy.test.ts —— 03 §16 禁止词扫描（A40-3 的第三项）。
 *
 * 判据：zh 文案里**零命中**（唯一例外是规范自己规定的否定句 modal.badge「…，非生成摘要」，
 * 它在规范表里逐字存在，属于"说明不生成摘要"而不是运行控制的"生成摘要"）；
 * 组件源码（去掉注释后的字符串字面量）同样零命中，避免 UI 里私造禁用词。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'
import { stringLiterals, stripComments } from './source-utils.ts'
import { en } from '../../src/client/locale/en.ts'
import { zh } from '../../src/client/locale/zh.ts'
import type { MessageKey } from '../../src/client/locale/index.ts'

export const BANNED_WORDS: readonly string[] = [
  '依赖',
  '已完成',
  '成功',
  '同步',
  '应用',
  '保存',
  '开始',
  '停止',
  '重试',
  '生成摘要',
]

/** 唯一白名单：key + 允许出现的词 + 理由（必须写清，不许只白名单不解释）。 */
export const BANNED_ALLOWLIST = [
  {
    key: 'modal.badge',
    word: '生成摘要',
    reason: '规范定稿文案「按记录重建，非生成摘要」——是否定句，说明本插件不生成摘要',
  },
]

test('zh 文案禁止词 0 命中（白名单 1 条，理由见 BANNED_ALLOWLIST）', () => {
  const violations: string[] = []
  for (const [key, value] of Object.entries(zh)) {
    for (const word of BANNED_WORDS) {
      if (!value.includes(word)) continue
      const allowed = BANNED_ALLOWLIST.some((item) => item.key === key && item.word === word)
      if (!allowed) violations.push(key + ' → ' + word + '（' + value + '）')
    }
  }
  assert.deepEqual(violations, [], '出现禁止词：' + violations.join(' | '))
})

test('白名单本身必须真的命中（防止白名单腐烂成空转）', () => {
  for (const item of BANNED_ALLOWLIST) {
    const value = zh[item.key as MessageKey]
    assert.ok(value.includes(item.word), '白名单条目已失效：' + item.key + ' 里没有 ' + item.word)
  }
})

test('en 文案不含运行控制式动词（start/stop/retry/save/apply/sync 作为动作）', () => {
  const banned = /\b(start|stop|retry|save|apply|sync)\b/i
  // 规范自己把 modal.start / modal.end 定成 "Start" / "End"（是"起点/终点"这个名词标签，不是控制按钮）。
  const labelAllowlist = new Set(['modal.start'])
  const violations = Object.entries(en)
    .filter(([key, value]) => !labelAllowlist.has(key) && banned.test(value))
    .map(([key, value]) => key + ' → ' + value)
  assert.deepEqual(violations, [], '英文文案出现运行控制词：' + violations.join(' | '))
})

test('en 的 label 白名单必须真的命中规范值（防止白名单空转）', () => {
  assert.equal(en['modal.start' as MessageKey], 'Start')
  assert.equal(en['modal.end' as MessageKey], 'End')
})

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}


test('组件源码的字符串字面量里没有禁止词（文案只许来自 locale）', () => {
  const files = walk(join(PLUGIN_ROOT, 'src', 'client', 'ui'))
  const violations: string[] = []
  for (const file of files) {
    const code = stripComments(readFileSync(file, 'utf8'))
    const literals = stringLiterals(code)
    for (const literal of literals) {
      for (const word of BANNED_WORDS) {
        if (literal.includes(word)) violations.push(file + ': ' + literal + '（' + word + '）')
      }
    }
  }
  assert.deepEqual(violations, [], '组件里出现禁用词：' + violations.join(' | '))
})
