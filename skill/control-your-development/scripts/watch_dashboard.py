#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""watch_dashboard.py — 看护 dev-dashboard：Markdown 一变就自动重新渲染 index.html。

用法：
    python watch_dashboard.py <dev-dashboard目录> [--interval 秒数]   # 持续看护
    python watch_dashboard.py <dev-dashboard目录> --once              # 检查一次后退出
    python watch_dashboard.py --self-test

纯标准库轮询，无第三方依赖。建议由 agent 作为后台任务启动；用户无需手动运行。
退出码：0 正常；1 参数/目录错误。
"""
import subprocess
import sys
import tempfile
import time
from pathlib import Path

MD_FILES = ("PRODUCT.md", "FEATURES.md", "GLOSSARY.md", "NOW.md")


def _utf8():
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def snapshot(dash: Path):
    snap = {}
    for name in MD_FILES:
        fp = dash / name
        try:
            snap[name] = fp.stat().st_mtime
        except OSError:
            snap[name] = None
    return snap


def changed(old, new):
    return any(old.get(k) != new.get(k) for k in MD_FILES)


def run_render(dash: Path):
    script = Path(__file__).resolve().parent / "render_dashboard.py"
    try:
        r = subprocess.run([sys.executable, str(script), str(dash)],
                           capture_output=True, text=True, timeout=120,
                           encoding="utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        # 超时不能让看护进程死掉：报清楚并继续看护
        print("  ✗ 渲染超时（超过 120 秒）：数据规模可能过大，本次跳过，看护继续运行")
        return 1
    tail = (r.stdout or "").strip().splitlines()
    for line in tail[-3:]:
        print("  " + line)
    if r.returncode == 2:
        print("  ⚠ 存在 blocker：仪表盘已更新，但数据健康待整理")
    elif r.returncode != 0:
        print("  ✗ 渲染失败（退出码 %d）" % r.returncode)
        for line in (r.stderr or "").strip().splitlines()[-3:]:
            print("    " + line[:200])
        print("    常见原因：三份 Markdown 缺失或被删；契约见 references/dashboard-format.md")
    return r.returncode


def self_test():
    with tempfile.TemporaryDirectory() as tmp:
        dash = Path(tmp)
        md = dash / "PRODUCT.md"
        md.write_text("# a", encoding="utf-8")
        s1 = snapshot(dash)
        assert not changed(s1, snapshot(dash)), "无改动不应触发"
        time.sleep(0.05)
        md.write_text("# b", encoding="utf-8")
        assert changed(s1, snapshot(dash)), "改动必须被检测到"
        (dash / "NOW.md").write_text("# n", encoding="utf-8")
        assert changed(s1, snapshot(dash)), "新增 MD 文件必须被检测到"
        print("SELF-TEST PASS: watch_dashboard")
        return 0


def main(argv):
    _utf8()
    if "--self-test" in argv:
        return self_test()
    args = [a for a in argv if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 1
    dash = Path(args[0])
    if not dash.is_dir():
        print("FATAL: 目录不存在 " + args[0])
        return 1
    interval = 1.5
    if "--interval" in argv:
        i = argv.index("--interval")
        if i + 1 < len(argv):
            try:
                interval = max(0.5, float(argv[i + 1]))
            except ValueError:
                pass
    snap = snapshot(dash)
    if "--once" in argv:
        print("OK: --once 模式，渲染一次后退出")
        rc = run_render(dash)
        return 1 if rc == 1 else 0  # 致命失败向上暴露；blocker(2) 表示已渲染但待整理，不算看护失败
    print(f"OK: 看护中（每 {interval}s 检查 {dash.name}/ 的三份 Markdown，Ctrl+C 停止）")
    try:
        while True:
            time.sleep(interval)
            new = snapshot(dash)
            if changed(snap, new):
                snap = new
                print("· 检测到 Markdown 变化，重新渲染…")
                run_render(dash)
    except KeyboardInterrupt:
        print("OK: 看护结束")
        return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
