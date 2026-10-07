#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""preflight_publish.py —— 发布 npm 前的预检：元数据 / 打包内容 / 包名占用。

用法：python tools/preflight_publish.py [--pnpm <pnpm.mjs>] [--node <node.exe>]
退出码：0 = 可以发布；1 = 有问题（逐条打印）。
"""
import json
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "package.json"
REQUIRED_FILES = ["package.json", "cordis.patch.yml", "lib/client.js", "lib/index.js",
                  "skill/control-your-development/SKILL.md", "skill/control-your-development/manifest.yaml"]


def check_manifest():
    m = json.loads(PKG.read_text(encoding="utf-8"))
    problems = []
    for field in ("name", "version", "license", "description"):
        if not m.get(field):
            problems.append(f"package.json 缺少 {field}")
    for field in ("repository", "homepage", "bugs"):
        if not m.get(field):
            problems.append(f"package.json 建议补 {field}（npm 页面会用到）")
    dsh = m.get("dsh") or {}
    if not (dsh.get("bundle") or {}).get("patch"):
        problems.append("dsh.bundle.patch 缺失：DSH 会因为读不到 dsh.bundle 而不挂载")
    if not (dsh.get("client") or {}).get("platform"):
        problems.append("dsh.client.platform 缺失：客户端 bundle 不会加载")
    files = m.get("files") or []
    for need in ("lib", "skill", "cordis.patch.yml"):
        if need not in files:
            problems.append(f"files 未包含 {need}（安装后就缺文件）")
    if not (ROOT / "README.md").is_file():
        problems.append("缺少 README.md（npm 页面会空白）")
    return m, problems


def check_registry(name):
    url = "https://registry.npmjs.org/" + name.replace("/", "%2F")
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            data = json.loads(r.read().decode("utf-8"))
            latest = (data.get("dist-tags") or {}).get("latest", "?")
            return f"包名 {name} 已存在（最新 {latest}）——若这是你的包请先改 version，否则换个名字"
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None      # 可用
        return f"查询包名失败：HTTP {e.code}"
    except Exception as e:
        return f"查询包名失败（网络？）：{e}"


def check_tarball(pnpm, node):
    with tempfile.TemporaryDirectory() as td:
        cmd = [str(node), str(pnpm), "pack", "--pack-destination", td] if node else ["pnpm", "pack", "--pack-destination", td]
        r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0:
            return None, ["pnpm pack 失败：" + (r.stderr or r.stdout or "").strip()[-300:]]
        tars = list(Path(td).glob("*.tgz"))
        if not tars:
            return None, ["pnpm pack 没有产出 .tgz"]
        tgz = tars[0]
        lr = subprocess.run(["tar", "-tzf", str(tgz)], capture_output=True, text=True, encoding="utf-8", errors="replace")
        entries = [l.strip() for l in (lr.stdout or "").splitlines() if l.strip()]
        problems = []
        for need in REQUIRED_FILES:
            if ("package/" + need) not in entries:
                problems.append(f"打包内容缺少 {need}")
        return (tgz, entries), problems


def main(argv):
    pnpm = None
    node = None
    if "--pnpm" in argv:
        pnpm = argv[argv.index("--pnpm") + 1]
    if "--node" in argv:
        node = argv[argv.index("--node") + 1]
    if pnpm is None:
        print("FATAL: 请用 --pnpm 指定 pnpm.mjs 路径（DSH 捆绑运行时里那个）")
        return 1
    manifest, problems = check_manifest()
    name = manifest.get("name", "")
    version = manifest.get("version", "")
    print(f"包：{name}@{version}")
    reg = check_registry(name) if name else "包名缺失"
    if reg:
        problems.append(reg)
    packed, tprobs = check_tarball(pnpm, node)
    problems += tprobs
    if packed:
        tgz, entries = packed
        print(f"打包预览：{tgz.name}（{len(entries)} 个文件）")
        for line in entries[:12]:
            print("   " + line)
        if len(entries) > 12:
            print(f"   … 其余 {len(entries) - 12} 个")
    print("=" * 56)
    if problems:
        for x in problems:
            print("✗ " + x)
        print("不可发布：先修掉上面的问题")
        return 1
    print("预检通过 ✔ 可以发布。下一步（在仓库根执行）：")
    print(f"  pnpm publish --access public    # 发布 {name}@{version}")
    print("  发布后验证：https://registry.npmjs.org/" + name + "  与  https://registry.npmmirror.com/" + name)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
