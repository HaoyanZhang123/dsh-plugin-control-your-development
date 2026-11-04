import io

p = 'tests/entries/run-t13c.mjs'
s = io.open(p, encoding='utf-8').read()
old = """    const actual = (label) => result.checks.find((check) => check.label === 'expr:' + label)?.detail?.actual
    const mapHeight = Number(actual('map-height'))
    const mapBottom = Number(actual('map-bottom'))
    const inspectorTop = Number(actual('inspector-top'))
    const inspectorPosition = String(actual('inspector-position'))
    const wide = width >= 1100
    const ok =
      result.ok &&
      mapHeight >= 520 &&
      (wide ? inspectorPosition === 'sticky' : inspectorPosition === 'static' && inspectorTop >= mapBottom - 4)
    if (!ok) failures.push('width ' + String(width) + ' 不满足 D-28（' + JSON.stringify({ mapHeight, inspectorPosition, inspectorTop, mapBottom }) + '）')
    layoutRows.push(
      [
        'width=' + String(width),
        '  page-scrollable=' + String(actual('page-scrollable')),
        '  no-h-scroll=' + String(actual('no-h-scroll')),
        '  map-height=' + String(mapHeight),
        '  header-position=' + String(actual('header-position')),
        '  inspector-position=' + String(inspectorPosition) + ' (期望 ' + (wide ? 'sticky' : 'static') + ')',
        '  inspector-top=' + String(inspectorTop) + ' / map-bottom=' + String(mapBottom),
        '  => ' + (ok ? 'PASS' : 'FAIL'),
      ].join(''),
    )"""
new = """    const actual = (label) => result.checks.find((check) => check.label === 'expr:' + label)?.detail?.actual
    const mapHeight = Number(actual('map-height'))
    const inspectorPosition = String(actual('inspector-position'))
    const flowOk = actual('inspector-flow') === true
    const wide = width >= 1100
    const ok = result.ok && mapHeight >= 520 && inspectorPosition === (wide ? 'sticky' : 'static') && flowOk
    if (!ok) {
      failures.push(
        'width ' +
          String(width) +
          ' 不满足 D-28（' +
          JSON.stringify({ mapHeight, inspectorPosition, flowOk, checks: result.checks.filter((check) => check.ok === false).map((check) => check.label) }) +
          '）',
      )
    }
    layoutRows.push(
      [
        'width=' + String(width),
        '  page-scrollable=' + String(actual('page-scrollable')),
        '  no-h-scroll=' + String(actual('no-h-scroll')),
        '  map-height=' + String(mapHeight),
        '  header-position=' + String(actual('header-position')),
        '  inspector-position=' + String(inspectorPosition) + ' (期望 ' + (wide ? 'sticky' : 'static') + ')',
        '  inspector-flow-ok=' + String(flowOk),
        '  => ' + (ok ? 'PASS' : 'FAIL'),
      ].join(''),
    )"""
assert old in s
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('run-t13c extraction updated')
