/*
 * tests/a11y/privacy.test.ts —— A44-1：隐私默认与模式（03 §12；06 A44-1/N-14）。
 *
 * 覆盖四类掩码（路径 / 命令 / 标题 / URL）的**正反例**、幂等、空值、正文闸门、日志脱敏，
 * 以及最关键的一条"无存储"：源码 grep 0 命中 + 运行时把 localStorage 换成一碰就炸的 getter。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from '../../src/client/locale/index.ts'
import { PLUGIN_ROOT } from '../harness/styles-codegen.ts'
import { stripComments } from '../ui-shell/source-utils.ts'
import {
  DEFAULT_PRIVACY_MODE,
  PrivacyProvider,
  contentEntryVisible,
  isHidden,
  maskCommand,
  maskPathFor,
  maskPaths,
  maskTitle,
  maskUrl,
  redactBatch,
  redactForLog,
  sessionLabel,
  shouldRenderContent,
  usePrivacy,
} from '../../src/client/privacy/index.ts'
import { SESSION_SAMPLE, commandRecord } from './fixtures.ts'

const t = createTranslator('zh')
const h = React.createElement

test('默认模式是 metadata（正文默认折叠，不是"默认展开"）', () => {
  assert.equal(DEFAULT_PRIVACY_MODE, 'metadata')
  assert.equal(isHidden(DEFAULT_PRIVACY_MODE), false)
  assert.equal(shouldRenderContent('metadata', false), false, '元数据模式下未展开时不得渲染正文')
  assert.equal(shouldRenderContent('metadata', true), true)
  assert.equal(shouldRenderContent('hidden', true), false, '隐私模式下即使展开也不渲染正文')
  assert.equal(contentEntryVisible('metadata'), true)
  assert.equal(contentEntryVisible('hidden'), false)
})

test('路径掩码：元数据保留全路径；隐私模式只留 basename；幂等；空值不崩', () => {
  const path = 'src/client/ui/shell/Shell.ts'
  assert.equal(maskPathFor(path, 'metadata'), path)
  assert.equal(maskPathFor(path, 'hidden'), 'Shell.ts')
  assert.equal(maskPathFor(maskPathFor(path, 'hidden'), 'hidden'), 'Shell.ts', '掩码必须幂等')
  assert.equal(maskPathFor('', 'hidden'), '')
  assert.equal(maskPathFor('a\\b\\c.ts', 'hidden'), 'c.ts', '反斜杠路径也要取 basename')
  assert.equal(maskPathFor('no-dir.ts', 'hidden'), 'no-dir.ts')
  assert.deepEqual(maskPaths([path, 'data/x.json'], 'hidden'), ['Shell.ts', 'x.json'])
  assert.deepEqual(maskPaths([], 'hidden'), [])
})

test('命令掩码：程序名始终可见；参数只在元数据模式可见；缺失程序名给 ?', () => {
  const record = commandRecord()
  assert.deepEqual(maskCommand(record, 'metadata'), { program: 'pnpm', text: 'pnpm test --filter threadline' })
  assert.deepEqual(maskCommand(record, 'hidden'), { program: 'pnpm', text: null })
  assert.deepEqual(maskCommand(commandRecord({ program: undefined, text: undefined }), 'metadata'), { program: '?', text: null })
  assert.deepEqual(maskCommand(null, 'hidden'), { program: '?', text: null })
  assert.deepEqual(maskCommand(undefined, 'metadata'), { program: '?', text: null })
  // 幂等：对已掩码的结果再掩一次，命令文本仍然是 null（不是"复原"）
  const once = maskCommand(record, 'hidden')
  assert.equal(once.text, null)
})

test('标题掩码：隐私模式按视图顺序编号「会话 N」，不用标题散列；元数据保留标题', () => {
  assert.equal(maskTitle(SESSION_SAMPLE, 0, 'hidden', t), '会话 1')
  assert.equal(maskTitle(SESSION_SAMPLE, 4, 'hidden', t), '会话 5', '编号由调用方按当前视图顺序给')
  assert.equal(maskTitle(SESSION_SAMPLE, 0, 'metadata', t), '修复读模型指纹')
  assert.equal(maskTitle({ sessionId: 's-abcdef123456' }, 0, 'metadata', t), 's-abcdef', '没有标题时退回短 id（前 8 位）')
  assert.equal(maskTitle(null, 2, 'hidden', t), '会话 3')
  assert.equal(maskTitle(null, 0, 'metadata', t), '—')
  assert.equal(sessionLabel(SESSION_SAMPLE, 'hidden'), null, '隐私模式不暴露会话 id')
  assert.equal(sessionLabel(SESSION_SAMPLE, 'metadata'), 's-abcdef')
})

test('URL 掩码：元数据显示完整 URL；隐私模式只显示域名；解析失败不猜', () => {
  const url = 'https://docs.example.com/guide/secret?q=1'
  assert.equal(maskUrl(url, 'metadata'), url)
  assert.equal(maskUrl(url, 'hidden'), 'docs.example.com')
  assert.equal(maskUrl(maskUrl(url, 'hidden'), 'hidden'), 'docs.example.com', '掩码必须幂等')
  assert.equal(maskUrl('not a url', 'hidden'), 'not a url')
  assert.equal(maskUrl('', 'hidden'), '')
})

test('日志脱敏：只允许错误码与计数，正文/路径/标题/URL 一律不落日志', () => {
  assert.deepEqual(redactForLog({ code: 'scan_failed', count: 3 }), { code: 'scan_failed', count: 3 })
  assert.deepEqual(redactForLog({ code: 'scan-failed', failed: 2 }), { code: 'scan-failed', count: 2 })
  assert.deepEqual(redactForLog('src/client/secret.ts'), { code: 'redacted', count: 0 })
  assert.deepEqual(redactForLog('用户正文：这是一段不该进日志的话'), { code: 'redacted', count: 0 })
  assert.deepEqual(redactForLog(7), { code: 'count', count: 7 })
  assert.deepEqual(redactForLog(null), { code: 'unknown', count: 0 })
  assert.deepEqual(redactForLog({ code: 'bad code with spaces', count: -1 }), { code: 'redacted', count: 0 })
  assert.deepEqual(redactBatch([{ code: 'scan_failed' }, { code: 'scan_failed' }, { code: 'detail_failed' }]), [
    { code: 'scan_failed', count: 2 },
    { code: 'detail_failed', count: 1 },
  ])
  // 反向：任何字符串都不会原样出现在日志形状里
  const leak = JSON.stringify(redactForLog({ code: 'x', text: 'pnpm test; rm -rf /' }))
  assert.equal(leak.includes('rm -rf'), false)
})

function Probe(): React.ReactElement {
  const privacy = usePrivacy()
  return h('span', { 'data-mode': privacy.mode, 'data-hidden': String(privacy.hidden) }, privacy.mode)
}

test('Provider：默认 metadata；受控模式跟随 props；没有 Provider 时安全降级', () => {
  const defaulted = renderToStaticMarkup(h(PrivacyProvider, null, h(Probe, null)))
  assert.match(defaulted, /data-mode="metadata"/)
  assert.match(defaulted, /data-hidden="false"/)

  const controlled = renderToStaticMarkup(h(PrivacyProvider, { mode: 'hidden' }, h(Probe, null)))
  assert.match(controlled, /data-mode="hidden"/)
  assert.match(controlled, /data-hidden="true"/)

  const orphan = renderToStaticMarkup(h(Probe, null))
  assert.match(orphan, /data-mode="metadata"/, '没有 Provider 时必须给默认值而不是抛错')
})

/* ------------------------------------------------------------------ *
 * 无存储：源码 grep + 运行时两面证明
 * ------------------------------------------------------------------ */

const T10_DIRS = ['privacy', 'a11y', 'perf'].map((name) => join(PLUGIN_ROOT, 'src', 'client', name))

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

test('源码里没有任何存储 API（localStorage / sessionStorage / cookie / indexedDB）', () => {
  const offenders: string[] = []
  const pattern = /localStorage|sessionStorage|document\.cookie|indexedDB/
  for (const dir of T10_DIRS) {
    for (const file of walk(dir)) {
      const code = stripComments(readFileSync(file, 'utf8'))
      if (pattern.test(code)) offenders.push(file.replaceAll('\\', '/'))
    }
  }
  assert.deepEqual(offenders, [], 'T10 代码不许碰存储：' + offenders.join(', '))
})

test('运行时：把 localStorage 换成"一碰就炸"，掩码与 Provider 照常工作', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  let touched = false
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      touched = true
      throw new Error('storage touched')
    },
  })
  try {
    assert.equal(maskPathFor('a/b/c.ts', 'hidden'), 'c.ts')
    assert.deepEqual(maskCommand(commandRecord(), 'hidden'), { program: 'pnpm', text: null })
    assert.equal(maskTitle(SESSION_SAMPLE, 0, 'hidden', t), '会话 1')
    assert.equal(maskUrl('https://x.example.com/p?q=1', 'hidden'), 'x.example.com')
    assert.deepEqual(redactForLog({ code: 'ok' }), { code: 'ok', count: 0 })
    const html = renderToStaticMarkup(h(PrivacyProvider, null, h(Probe, null)))
    assert.match(html, /data-mode="metadata"/)
    assert.equal(touched, false, '任何一步都不许摸 localStorage')
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})
