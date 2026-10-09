#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_panel.py — 把 skill 的共享渲染核注入面板源，生成 lib/client.js。

单一事实源：本仓 skill/control-your-development/templates/dashboard.core.js
（它是随包发布的那一份；上游开发树把 skill 装成项目级时，退回到 <工作区>/.dsh/skills/ 那份）
用法：python tools/build_panel.py    （在本仓内或任意 cwd 均可）
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # 插件仓库根
WS = ROOT.parent.parent                                # 工作区根（本仓直接挂在 plugins/ 下时成立）
# 渲染核的查找顺序：① 本仓自带的 skill/（发布出去的就是这一份，改它才不会两边分叉）
#                   ② <工作区>/.dsh/skills/（上游开发树把 skill 装成项目级的那个布局）
CORE_CANDIDATES = (
    ROOT / "skill" / "control-your-development" / "templates" / "dashboard.core.js",
    WS / ".dsh" / "skills" / "control-your-development" / "templates" / "dashboard.core.js",
)
CORE = next((p for p in CORE_CANDIDATES if p.is_file()), CORE_CANDIDATES[0])
SRC = ROOT / "src" / "client.src.js"
OUT = ROOT / "lib" / "client.js"


def main():
    if not CORE.is_file():
        print("FATAL: 共享渲染核缺失，试过：")
        for p in CORE_CANDIDATES:
            print("  - " + str(p))
        return 1
    if not SRC.is_file():
        print("FATAL: 面板源缺失 " + str(SRC))
        return 1
    core = CORE.read_text(encoding="utf-8")
    css = (CORE.parent / "dashboard.core.css").read_text(encoding="utf-8")
    shell = (CORE.parent / "dashboard.shell.html").read_text(encoding="utf-8")
    import json
    core = core.replace("/*__CYD_CSS__*/''", json.dumps(css, ensure_ascii=False), 1)
    core = core.replace("/*__CYD_SHELL__*/''", json.dumps(shell, ensure_ascii=False), 1)
    src = SRC.read_text(encoding="utf-8")
    if "/*__CYD_CORE__*/" not in src:
        print("FATAL: 源文件缺少 /*__CYD_CORE__*/ 占位符")
        return 1
    out = src.replace("/*__CYD_CORE__*/", core, 1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out)
    print("OK: %s（%d KB）" % (OUT, len(out.encode("utf-8")) // 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
