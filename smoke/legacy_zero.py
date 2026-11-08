#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""legacy_zero.py —— 旧路径归零（G-5 / A50-4）。

在 `plugin/src` + `plugin/lib` 上跑 06 §1.2 的 grep，并逐条说明命中：
- `.view.json` / `render_dashboard` / `viewGate` / `runBar` / `intentBus` / `offline` /
  `guide` / `功能地图` / `开发仪表盘` / `view.js`：**必须 0 命中**；
- `control-your-development`：**唯一白名单**，只允许作为包名/插件 id 出现
  （即匹配串必须是 `dsh-plugin-control-your-development` 的一部分）；
  其余形态（如旧产品名单独出现）仍算失败。

用法：
  python legacy_zero.py              # 正向：非白名单命中必须 0 → 退出 0
  python legacy_zero.py --self-test  # 反向：喂已知旧路径，必须红并点名

退出码：0 = 全绿；1 = 有未归零命中 / 自审失败。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parents[0] / "plugin"
SCAN_GLOBS = ["src/**/*.ts", "src/**/*.tsx", "src/**/*.css", "lib/*.js"]

# 06 §1.2 的基线（另加 `view.js`：旧读模型产物，tasks.json T11 明确点名）。
PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("旧读模型文件", re.compile(r"\.view\.json")),
    ("旧渲染器", re.compile(r"render_dashboard")),
    ("旧门禁", re.compile(r"viewGate")),
    ("旧运行条", re.compile(r"runBar")),
    ("旧意图总线", re.compile(r"intentBus")),
    ("离线页", re.compile(r"offline")),
    ("旧引导", re.compile(r"\bguide\b")),
    ("旧功能地图文案", re.compile(r"功能地图")),
    ("旧产品名", re.compile(r"开发仪表盘")),
    ("旧读模型产物", re.compile(r"\bview\.js\b")),
    ("插件 id/包名（白名单）", re.compile(r"control-your-development")),
]

WHITELIST_NAME = "插件 id/包名（白名单）"
LEGIT_ID = "dsh-plugin-control-your-development"


def iter_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for pattern in SCAN_GLOBS:
        files.extend(sorted(root.glob(pattern)))
    seen: set[Path] = set()
    unique: list[Path] = []
    for path in files:
        if path.is_file() and path not in seen:
            seen.add(path)
            unique.append(path)
    return unique


def is_allowed(name: str, line: str, match: re.Match[str]) -> bool:
    """白名单判定：只允许 `dsh-plugin-control-your-development` 这个字符串里的命中。"""
    if name != WHITELIST_NAME:
        return False
    start = match.start()
    prefix = line[max(0, start - len("dsh-plugin-")) : start]
    return prefix.endswith("dsh-plugin-")


def scan_text(text: str) -> tuple[list[tuple[str, int, str]], list[tuple[str, int, str]]]:
    """返回 (未归零命中, 白名单命中)；纯函数，供自审复现。"""
    failures: list[tuple[str, int, str]] = []
    allowed: list[tuple[str, int, str]] = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        for name, pattern in PATTERNS:
            for match in pattern.finditer(line):
                entry = (name, line_no, line.strip()[:200])
                if is_allowed(name, line, match):
                    allowed.append(entry)
                else:
                    failures.append(entry)
    return failures, allowed


def main() -> int:
    if "--self-test" in sys.argv:
        return run_self_test()

    failures: list[tuple[str, str, int, str]] = []
    allowed_count = 0
    files = iter_files(PLUGIN)
    if not files:
        print("LEGACY-ZERO: FAIL（扫描范围为空，路径或产物缺失）")
        return 1
    for path in files:
        rel = path.relative_to(PLUGIN).as_posix()
        text = path.read_text(encoding="utf-8", errors="replace")
        bad, ok = scan_text(text)
        allowed_count += len(ok)
        for name, line_no, line in bad:
            failures.append((rel, name, line_no, line))
    for rel, name, line_no, line in failures:
        print("HIT | %s | %s:%d | %s" % (name, rel, line_no, line))
    print("CHECK | 旧路径 grep（src+lib，未归零命中） | hits=%d" % len(failures))
    print("CHECK | 插件 id/包名白名单（dsh-plugin-control-your-development） | allowed=%d" % allowed_count)
    print("LEGACY-ZERO: " + ("PASS" if not failures else "FAIL (%d 项)" % len(failures)))
    return 0 if not failures else 1


def run_self_test() -> int:
    failures = 0
    bad = "\n".join(
        [
            "const model = read('.view.json')",
            "render_dashboard()",
            "viewGate.open()",
            "runBar.show()",
            "intentBus.emit()",
            "const offline = true",
            "guide.start()",
            "功能地图",
            "开发仪表盘",
            "import './view.js'",
        ]
    )
    bad_hits, _allowed = scan_text(bad)
    detected = {name for name, _line, _text in bad_hits}
    for name, _pattern in PATTERNS:
        if name == WHITELIST_NAME:
            continue
        if name not in detected:
            print("SELFTEST-FAIL | 旧路径未被抓到：%s" % name)
            failures += 1
        else:
            print("SELFTEST-OK   | 抓到 %s" % name)
    legit = "export const name = '%s'\nexport const PLUGIN_ID = '%s'\n" % (LEGIT_ID, LEGIT_ID)
    legit_bad, legit_ok = scan_text(legit)
    if legit_bad or len(legit_ok) < 2:
        print("SELFTEST-FAIL | 合法包名被误判：bad=%s ok=%s" % (legit_bad, legit_ok))
        failures += 1
    else:
        print("SELFTEST-OK   | 合法包名/插件 id 走白名单（allowed=%d）" % len(legit_ok))
    sneaky = "const product = 'control-your-development dashboard'\n"
    sneaky_bad, _sneaky_ok = scan_text(sneaky)
    if not sneaky_bad:
        print("SELFTEST-FAIL | 裸 control-your-development（非包名形态）未被判失败")
        failures += 1
    else:
        print("SELFTEST-OK   | 裸 control-your-development 被判失败")
    clean = "const answer = 42\n"
    if scan_text(clean)[0]:
        print("SELFTEST-FAIL | 干净输入被误报")
        failures += 1
    else:
        print("SELFTEST-OK   | 干净输入 0 命中")
    print("SELFTEST: " + ("PASS" if failures == 0 else "FAIL (%d 项)" % failures))
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
