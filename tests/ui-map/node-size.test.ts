/*
 * tests/ui-map/node-size.test.ts —— 节点大小表达**文件体积**（D-35 需求 10c）。
 *
 * 这条需求的核心不是"换个公式"，而是**语义替换**：旧实现半径 = f(ops)，
 * 于是"改得多的文件"看起来比"大文件"更重要。现在必须：
 *   1. 半径只由字节数决定，与 ops 无关；
 *   2. 对数映射（避免 2MB 图片吞掉画布、几 KB 小文件看不见）；
 *   3. 有上下限（可点、可读）；
 *   4. 未知大小 → 中性半径，且**不按 0 B**。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FOLDER_SIZE_RADIUS,
  folderRadiusFromSize,
  layoutFolderGeometry,
  type MapEntry,
} from '../../src/client/ui/map/folderLayout.ts'

test('半径随字节数单调不减，且落在上下限内', () => {
  const sizes = [0, 1, 1024, 65536, 1048576, 10485760, 1073741824]
  let previous = -1
  for (const size of sizes) {
    const radius = folderRadiusFromSize(size)
    assert.ok(radius >= previous, '大小增大时半径不得变小：' + String(size))
    assert.ok(radius >= FOLDER_SIZE_RADIUS.min, '不得小于下限')
    assert.ok(radius <= FOLDER_SIZE_RADIUS.max, '不得大于上限')
    previous = radius
  }
})

test('对数映射：百倍大小差远小于百倍半径差', () => {
  const small = folderRadiusFromSize(1024)
  const large = folderRadiusFromSize(1024 * 1024)
  assert.ok(large > small, '大文件半径必须更大')
  /* 若线性映射，1MB 会是 1KB 的 1024 倍；对数下差异极小。 */
  assert.ok(large / small < 3, '必须是压缩过的（对数）关系，实际 got ' + String(large / small))
})

test('未知大小不按 0 B 处理：与 0 字节**同半径**但可区分', () => {
  assert.equal(folderRadiusFromSize(undefined), FOLDER_SIZE_RADIUS.min)
  /* 0 字节是"确实是空文件"，未知是"不知道"——半径可以相同，但语义不同，
   * 差异由渲染层的 data-size-unknown 表达（见 FolderMap）。 */
  assert.equal(folderRadiusFromSize(0), FOLDER_SIZE_RADIUS.min)
})

test('非法数值（NaN/负数）退回中性半径，不产出 NaN 坐标', () => {
  assert.equal(folderRadiusFromSize(Number.NaN), FOLDER_SIZE_RADIUS.min)
  assert.equal(folderRadiusFromSize(-5), FOLDER_SIZE_RADIUS.min)
  assert.equal(Number.isFinite(folderRadiusFromSize(Number.POSITIVE_INFINITY)), true)
})

test('几何：半径由文件大小决定，与操作次数无关', () => {
  const base: MapEntry[] = [
    { name: 'big.ts', path: 'big.ts', kind: 'file', size: 2_000_000, family: 'code' },
    { name: 'small.ts', path: 'small.ts', kind: 'file', size: 1_000, family: 'code' },
  ]
  const geometry = layoutFolderGeometry(base, [], { width: 600, height: 400, currentPath: '' })
  const big = geometry.nodes.find((node) => node.path === 'big.ts')
  const small = geometry.nodes.find((node) => node.path === 'small.ts')
  assert.ok(big !== undefined && small !== undefined)
  assert.ok(big.r > small.r, '大文件半径必须更大')

  /* 把"操作数"拉满到一个文件上：半径不得因此改变（旧实现会变大）。 */
  const touched = layoutFolderGeometry(
    base,
    [
      {
        path: 'small.ts',
        name: 'small.ts',
        dir: '',
        family: 'code',
        firstAt: 1,
        lastAt: 2,
        reads: 999,
        writes: 999,
        searches: 999,
        added: 0,
        removed: 0,
        ops: 2997,
        sessionIds: ['s'],
        sessionCount: 1,
        turnCount: 1,
      },
    ],
    { width: 600, height: 400, currentPath: '' },
  )
  const smallTouched = touched.nodes.find((node) => node.path === 'small.ts')
  assert.ok(smallTouched !== undefined)
  assert.equal(smallTouched.r, small.r, '操作次数不得影响半径（语义已改为文件体积）')
})

test('几何：未知大小的文件节点不带 size 字段（渲染层据此画空心）', () => {
  const entries: MapEntry[] = [{ name: 'mystery.bin', path: 'mystery.bin', kind: 'file', family: 'other' }]
  const geometry = layoutFolderGeometry(entries, [], { width: 600, height: 400, currentPath: '' })
  const node = geometry.nodes.find((item) => item.path === 'mystery.bin')
  assert.ok(node !== undefined)
  assert.equal(node.size, undefined, '未知大小必须是 undefined，不能填 0')
})
