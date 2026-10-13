#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_panel.py — 把 skill 的共享渲染核注入面板源，生成 lib/client.js。

单一事实源：本仓 skill/control-your-development/templates/dashboard.core.js
（它是随包发布的那一份；上游开发树把 skill 装成项目级时，退回到 <工作区>/.dsh/skills/ 那份）
用法：python tools/build_panel.py    （在本仓内或任意 cwd 均可）

仓库布局适配（发布仓专用）：版本常量取自**所选渲染核同目录的 skill 根**，
因此本仓（skill/ 优先）与上游工作区（.dsh/skills/ 回退）两种布局都能取到。
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


def manifest_version(core_path):
    """读所选渲染核同目录 skill 根的 manifest.yaml: version。读不到返回 None。"""
    mf = core_path.parent.parent / "manifest.yaml"
    try:
        for ln in mf.read_text(encoding="utf-8").splitlines():
            if ln.startswith("version:"):
                return ln.split(":", 1)[1].strip(), mf
    except Exception:
        return None, mf
    return None, mf


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
    # 版本常量**构建期注入**（契约 L495）：占位写法 = 注释占位 + 字面 null，构建后成 "x.y.z"。
    # 取**所选渲染核同目录**的 skill manifest（本仓 skill/ 优先，工作区 .dsh/skills/ 回退）。
    # 读不到 ⇒ **FATAL**（不静默：未注入会让"版本比对新"这条判据永不触发 = 空绿 ✗）。
    ver, mf = manifest_version(CORE)
    if not ver:
        print("FATAL: 读不到 skill manifest.yaml 的 version（版本常量必须注入，否则判据空跑）：" + str(mf))
        return 1
    if "/*__CYD_VERSION__*/null" not in core:
        # 占位符不在 ⇒ replace 会静默无效，产物里的版本位恒为 null（同一种空绿）。显式拦住。
        print("FATAL: 渲染核缺少 /*__CYD_VERSION__*/null 占位符（注入会静默失效）：" + str(CORE))
        return 1
    core = core.replace("/*__CYD_VERSION__*/null", json.dumps(ver), 1)
    src = SRC.read_text(encoding="utf-8")
    if "/*__CYD_CORE__*/" not in src:
        print("FATAL: 源文件缺少 /*__CYD_CORE__*/ 占位符")
        return 1
    out = src.replace("/*__CYD_CORE__*/", core, 1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out)
    print("OK: %s（%d KB）；注入 skill 版本 = %s（来自 %s）"
          % (OUT, len(out.encode("utf-8")) // 1024, ver, mf))
    return 0


if __name__ == "__main__":
    sys.exit(main())
