#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""readonly_check.py —— 只读证明（G-1 / A50-3）。

检查 06 §1.1 的四条 grep 基线（写 / 存储 / 会话控制 / 外部网络），外加：
- `fs` 导入（含 `node:fs`）；
- host 路由审查：只允许 `/api/dsh-threadline/{scan,snapshot,detail}` 三个 POST 只读路由；
- 构建产物 `lib/index.js` 不含 fs、不含写 API、无外部请求；
- `lib/client.js` 不写存储、不直连外部（只允许同源 `/api/dsh-threadline/*`）。

注释处理：**注释里提到禁止 API 是文档，不是行为**——扫的是去注释后的代码；
被注释挡住的提及单独打印 `INFO`，不当作命中。

用法：
  python readonly_check.py              # 正向：代码内命中数必须 0 → 退出 0
  python readonly_check.py --self-test  # 反向：喂已知坏输入，必须红并点名

退出码：0 = 全绿；1 = 有命中/审查失败/自审失败。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent / "plugin"

SCAN_GLOBS = ["src/**/*.ts", "src/**/*.tsx", "src/**/*.css", "lib/*.js"]

WRITE_RE = re.compile(
    r"\b(writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|unlink(?:Sync)?|rename(?:Sync)?|"
    r"mkdir(?:Sync)?|copyFile(?:Sync)?|rmSync)\b|\brm\("
)

PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("写/删除/目录 API", WRITE_RE),
    (
        "存储/cookie/剪贴板",
        re.compile(r"(localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.clipboard\.writeText)"),
    ),
    ("会话控制/工具注册", re.compile(r"(session\.prompt|session\.cancel|session\.resume|tools\.register)")),
    ("外部网络", re.compile(r"(fetch\(\s*['\"`]https?://|XMLHttpRequest|WebSocket|EventSource|new Worker)")),
    ("fs 导入", re.compile(r"(from\s+['\"](?:node:)?fs['\"]|require\(\s*['\"](?:node:)?fs['\"]\s*\))")),
]

ROUTE_REQUIRED = (
    "/api/dsh-threadline/scan",
    "/api/dsh-threadline/snapshot",
    "/api/dsh-threadline/detail",
)


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


def strip_comments(text: str) -> str:
    """去注释、**保留行号与字符串内容**（`fetch('https://…')` 仍必须被抓到）。"""
    out: list[str] = []
    index = 0
    length = len(text)
    quote: str | None = None
    block = False
    while index < length:
        char = text[index]
        next_char = text[index + 1] if index + 1 < length else ""
        if block:
            if char == "*" and next_char == "/":
                block = False
                out.append("  ")
                index += 2
                continue
            out.append(char if char == "\n" else " ")
            index += 1
            continue
        if quote is not None:
            out.append(char)
            if char == "\\" and index + 1 < length:
                out.append(text[index + 1])
                index += 2
                continue
            if char == quote:
                quote = None
            index += 1
            continue
        if char in ('"', "'", "`"):
            quote = char
            out.append(char)
            index += 1
            continue
        if char == "/" and next_char == "/":
            while index < length and text[index] != "\n":
                out.append(" ")
                index += 1
            continue
        if char == "/" and next_char == "*":
            block = True
            out.append("  ")
            index += 2
            continue
        out.append(char)
        index += 1
    return "".join(out)


CLASSIFIER_MARK = "DELETE_COMMAND_PATTERN"


def _is_readonly_classifier_line(line: str) -> bool:
    """`DELETE_COMMAND_PATTERN` 是**命令文本分类器**（只匹配 rm/del/unlink 词，不执行任何 API）。

    它包含 `unlink`/`rmdir` 这些词，会被 WRITE_RE 误当成删除 API；这是唯一允许的这类行。
    若同一行还出现真正写 API，则不豁免（防绕过）。
    """
    if CLASSIFIER_MARK not in line:
        return False
    if "rmdir" not in line or "unlink" not in line:
        return False
    return re.search(r"(writeFile|appendFile|createWriteStream|rmSync|unlinkSync|renameSync|mkdirSync|copyFile)", line) is None


def scan_text(text: str) -> list[tuple[str, int, str]]:
    """返回 [(pattern_name, line_no, line)]；纯函数，供自审复现。"""
    hits: list[tuple[str, int, str]] = []
    for name, pattern in PATTERNS:
        for line_no, line in enumerate(text.splitlines(), start=1):
            if _is_readonly_classifier_line(line):
                continue
            if pattern.search(line):
                hits.append((name, line_no, line.strip()[:200]))
    return hits


def review_routes(text: str) -> list[str]:
    """host 路由审查：三个只读 POST 路由，无第二入口、无 fs、无外部请求、无路径参数。"""
    problems: list[str] = []
    for required in ROUTE_REQUIRED:
        if required not in text:
            problems.append("缺少路由 " + required)
    method_lists = re.findall(r"methods:\s*\[[^\]]*\]", text)
    if not method_lists:
        problems.append("没有声明 methods")
    for entry in method_lists:
        if "POST" not in entry:
            problems.append("出现非 POST 方法：" + entry.strip())
    if len(re.findall(r"path:\s*handler\.path|path:\s*ROUTE_PATHS\.", text)) < 3:
        problems.append("路由注册点不足 3 处（scan/snapshot/detail）")
    if re.search(r"(from\s+['\"](?:node:)?fs['\"]|require\(\s*['\"](?:node:)?fs['\"])", text):
        problems.append("路由文件 import 了 fs")
    if WRITE_RE.search(text):
        problems.append("路由文件出现写 API")
    if re.search(r"fetch\(\s*['\"`]https?://", text):
        problems.append("路由文件出现外部 fetch")
    if re.search(r"searchParams\.get\(\s*['\"](path|file|dir)", text):
        problems.append("路由接收路径参数（只允许 sessionId/scanId）")
    if "requestBody: 'buffered'" not in text:
        problems.append("路由未声明 requestBody: 'buffered'")
    return problems


def main() -> int:
    if "--self-test" in sys.argv:
        return run_self_test()

    failures = 0
    total_hits = 0
    comment_mentions = 0
    for path in iter_files(PLUGIN):
        rel = path.relative_to(PLUGIN).as_posix()
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as error:
            print("CHECK | 读取 %s | FAIL: %s" % (rel, error))
            failures += 1
            continue
        raw_hits = scan_text(text)
        hits = scan_text(strip_comments(text))
        comment_mentions += max(0, len(raw_hits) - len(hits))
        if hits:
            total_hits += len(hits)
            for name, line_no, line in hits:
                print("HIT | %s | %s:%d | %s" % (name, rel, line_no, line))
    if comment_mentions:
        print("INFO | 注释中提及的禁止词（不计入；代码内 0 命中） | count=%d" % comment_mentions)
    print("CHECK | 只读 grep（src+lib，代码内命中） | hits=%d" % total_hits)
    if total_hits:
        failures += 1

    routes_path = PLUGIN / "src" / "host" / "routes.ts"
    if routes_path.is_file():
        problems = review_routes(routes_path.read_text(encoding="utf-8"))
        for problem in problems:
            print("ROUTE-PROBLEM | " + problem)
        print("CHECK | host 路由审查（3 个只读 POST） | problems=%d" % len(problems))
        if problems:
            failures += 1
    else:
        print("ROUTE-PROBLEM | 缺少 src/host/routes.ts")
        failures += 1

    host_bundle = PLUGIN / "lib" / "index.js"
    if host_bundle.is_file():
        bundle_hits = scan_text(strip_comments(host_bundle.read_text(encoding="utf-8", errors="replace")))
        for name, line_no, line in bundle_hits:
            print("HIT | bundle:%s | lib/index.js:%d | %s" % (name, line_no, line))
        print("CHECK | lib/index.js 只读（node:fs/写/外连） | hits=%d" % len(bundle_hits))
        if bundle_hits:
            failures += 1
    else:
        print("CHECK | lib/index.js 只读（node:fs/写/外连） | FAIL: 缺少产物（先 pnpm run build）")
        failures += 1

    client_bundle = PLUGIN / "lib" / "client.js"
    if client_bundle.is_file():
        text = strip_comments(client_bundle.read_text(encoding="utf-8", errors="replace"))
        store_hits = [
            hit for hit in scan_text(text) if hit[0] in ("存储/cookie/剪贴板", "外部网络", "会话控制/工具注册")
        ]
        print("CHECK | lib/client.js 只读（无存储/无外连/无会话控制） | hits=%d" % len(store_hits))
        for name, line_no, line in store_hits:
            print("HIT | %s | lib/client.js:%d | %s" % (name, line_no, line))
        if store_hits:
            failures += 1
        same_origin = len(re.findall(r"/api/dsh-threadline/", text))
        print("CHECK | lib/client.js 同源路由引用 | count=%d" % same_origin)
        if same_origin < 1:
            failures += 1
    else:
        print("CHECK | lib/client.js 只读（无存储/无外连/无会话控制） | FAIL: 缺少产物")
        failures += 1

    print("READONLY: " + ("PASS" if failures == 0 else "FAIL (%d 项)" % failures))
    return 0 if failures == 0 else 1


def run_self_test() -> int:
    """反向自审：已知坏输入必须被抓到；干净输入/注释必须 0 命中；坏路由必须点名。"""
    failures = 0
    bad_source = "\n".join(
        [
            "import fs from 'node:fs'",
            "fs.writeFileSync('x', 'y')",
            "localStorage.setItem('a', 'b')",
            "session.prompt('hi')",
            "fetch('https://evil.example/x')",
        ]
    )
    hit_names = {name for name, _line, _text in scan_text(bad_source)}
    for name, _pattern in PATTERNS:
        if name not in hit_names:
            print("SELFTEST-FAIL | 坏输入未被抓到：%s" % name)
            failures += 1
        else:
            print("SELFTEST-OK   | 抓到 %s" % name)
    comment_only = "// fs.writeFileSync('x', 'y') 与 localStorage 只是注释\nconst answer = 42\n"
    if scan_text(strip_comments(comment_only)):
        print("SELFTEST-FAIL | 注释里的禁止词被误报（注释不是行为）")
        failures += 1
    else:
        print("SELFTEST-OK   | 注释里的禁止词不计入")
    clean_source = "const answer = 42\nconst response = fetch('/api/dsh-threadline/scan')\n"
    if scan_text(clean_source):
        print("SELFTEST-FAIL | 干净输入被误报：%s" % scan_text(clean_source))
        failures += 1
    else:
        print("SELFTEST-OK   | 干净输入 0 命中")
    classifier = 'const DELETE_COMMAND_PATTERN = /(?:^|[\\n;|&])\\s*(?:rm|del|rmdir|unlink|remove-item)\\b|git\\s+rm\\b/i'
    if scan_text(classifier):
        print("SELFTEST-FAIL | 只读命令分类器被误报：%s" % scan_text(classifier))
        failures += 1
    else:
        print("SELFTEST-OK   | 命令文本分类器豁免（不是文件 API）")
    bypass = classifier + '; require("node:fs").rmSync("x")'
    if not scan_text(bypass):
        print("SELFTEST-FAIL | 分类器同行夹带写 API 未被抓到（豁免被绕过）")
        failures += 1
    else:
        print("SELFTEST-OK   | 分类器同行夹带写 API 仍被抓到")

    good_routes = (
        "const ROUTE_PATHS = { scan: '/api/dsh-threadline/scan', snapshot: '/api/dsh-threadline/snapshot', "
        "detail: '/api/dsh-threadline/detail' }\n"
        "register({ path: ROUTE_PATHS.scan, methods: ['POST'], requestBody: 'buffered' })\n"
        "register({ path: ROUTE_PATHS.snapshot, methods: ['POST'], requestBody: 'buffered' })\n"
        "register({ path: ROUTE_PATHS.detail, methods: ['POST'], requestBody: 'buffered' })\n"
    )
    if review_routes(good_routes):
        print("SELFTEST-FAIL | 合法路由被误报：%s" % review_routes(good_routes))
        failures += 1
    else:
        print("SELFTEST-OK   | 合法路由 0 问题")
    bad_routes = (
        "import fs from 'node:fs'\n"
        "register({ path: '/api/dsh-threadline/scan', methods: ['GET'], requestBody: 'buffered' })\n"
    )
    problems = review_routes(bad_routes)
    expected = ["缺少路由", "出现非 POST 方法", "路由注册点不足 3 处", "路由文件 import 了 fs"]
    for piece in expected:
        if not any(piece in problem for problem in problems):
            print("SELFTEST-FAIL | 坏路由未点名：%s（实际 %s）" % (piece, problems))
            failures += 1
        else:
            print("SELFTEST-OK   | 坏路由点名：%s" % piece)
    print("SELFTEST: " + ("PASS" if failures == 0 else "FAIL (%d 项)" % failures))
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
