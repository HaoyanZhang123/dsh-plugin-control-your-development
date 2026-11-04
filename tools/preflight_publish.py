#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""preflight_publish.py —— 发布前本地预检（1.0.0 起的新结构）。

判据（全部为**断言**，不通过就 FAIL 退 1；不写盘、不发布）：
  1. 版本：`package.json.version` 与 `--tag` 一致（给了 tag 才比）；
  2. 包形态：`dsh.bundle.patch` 存在、`dsh.client.platform` 存在、`dependencies` 必须为空；
  3. 产物：`lib/index.js` + `lib/client.js` 存在且非空；client 里 `require("react")` ≥1、`react.production` = 0（React 未打包）；
  4. 打包卫生：`npm pack --dry-run --json` 的文件清单里**不许**出现 src/、tests/、node_modules、
     `__pycache__`、`.pyc`、`.tgz`、`.log`；
  5. `files` 白名单每一项都必须真的存在（缺一项就是包形态坏了）。

用法：
    python tools/preflight_publish.py                 # 只校验，不发布
    python tools/preflight_publish.py --tag v1.0.0-alpha.1   # 额外校验 tag 与版本一致
退出码：0 通过；1 有不通过项；2 用法错误。
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REQUIRED = ["lib/index.js", "lib/client.js", "cordis.patch.yml", "README.md", "CHANGELOG.md", "LICENSE"]
JUNK_PREFIXES = ("src/", "tests/", "node_modules/", "__pycache__/")
JUNK_SUFFIXES = (".pyc", ".tgz", ".log")


def fail(problems, message):
    problems.append(message)


def main(argv):
    ap = argparse.ArgumentParser(description="release preflight (1.0.0 structure)")
    ap.add_argument("--tag", help="git tag, e.g. v1.0.0-alpha.1")
    args = ap.parse_args(argv[1:])

    problems = []
    pkg_path = ROOT / "package.json"
    if not pkg_path.is_file():
        print("FAIL 缺少 package.json")
        return 1
    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    version = str(pkg.get("version", ""))

    # 1. 版本
    if args.tag:
        tag_version = args.tag[1:] if args.tag.startswith("v") else args.tag
        if tag_version != version:
            fail(problems, "tag %s 与 package.json 版本 %s 不一致" % (args.tag, version))

    # 2. 包形态
    dsh = pkg.get("dsh") or {}
    if not isinstance(dsh.get("bundle"), dict) or not dsh["bundle"].get("patch"):
        fail(problems, "缺少 dsh.bundle.patch")
    client = dsh.get("client") or {}
    if not client.get("platform"):
        fail(problems, "缺少 dsh.client.platform")
    deps = pkg.get("dependencies")
    if deps:
        fail(problems, "dependencies 必须为空对象，实际有 %d 项：%s" % (len(deps), ", ".join(deps)))

    # 3. 产物
    for rel in REQUIRED:
        p = ROOT / rel
        if not p.is_file() or p.stat().st_size == 0:
            fail(problems, "缺少或为空：%s" % rel)
        if rel in (pkg.get("files") or []):
            continue
    for item in pkg.get("files") or []:
        if not (ROOT / item).exists():
            fail(problems, "files 白名单里的路径不存在：%s" % item)

    client_js = ROOT / "lib/client.js"
    if client_js.is_file():
        text = client_js.read_text(encoding="utf-8", errors="replace")
        if text.count('require("react")') < 1:
            fail(problems, "lib/client.js 里没有 require(\"react\")（React 应作为宿主 peer 外置）")
        if re.search(r"react\.production", text):
            fail(problems, "lib/client.js 里出现 react.production —— React 被打进包了")

    # 4. 打包卫生
    try:
        out = subprocess.run(
            ["npm", "pack", "--dry-run", "--json"],
            cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8", shell=True,
        )
        if out.returncode != 0:
            fail(problems, "npm pack --dry-run 失败：" + (out.stderr or "").strip()[:200])
        else:
            entries = json.loads(out.stdout)[0]["files"]
            paths = [item["path"] for item in entries]
            junk = [p for p in paths if p.startswith(JUNK_PREFIXES) or p.endswith(JUNK_SUFFIXES)]
            if junk:
                fail(problems, "打包内容混入不该有的项 %d 个：%s" % (len(junk), ", ".join(junk[:5])))
            print("pack files: %d" % len(paths))
    except Exception as exc:  # noqa: BLE001 - 预检失败要显式报错，不吞
        fail(problems, "打包预检异常：%s" % exc)

    print("version: %s" % version)
    if problems:
        for item in problems:
            print("FAIL " + item)
        print("preflight: FAIL %d" % len(problems))
        return 1
    print("preflight: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
