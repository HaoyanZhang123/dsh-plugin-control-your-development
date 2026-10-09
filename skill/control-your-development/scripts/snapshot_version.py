#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""snapshot_version.py — dev-dashboard 版本快照（契约 v1.3）。

用法：
    python snapshot_version.py <dev-dashboard目录> save [--note 说明]
    python snapshot_version.py <dev-dashboard目录> list
    python snapshot_version.py <dev-dashboard目录> diff <版本号n> [版本号m]
    python snapshot_version.py --self-test

布局：dev-dashboard/.versions/index.json + 每版一个目录 NNN-<yyyymmdd-HHMM>/，
内含当时的三大 Markdown（PRODUCT / FEATURES / NOW）与术语表——术语表按**实际文件名**收录
（项目可以叫 术语表.md / glossary.md …，所以这里不写死名字）。
退出码：0 正常；1 参数/目录错误。零第三方依赖。
"""
import difflib
import json
import sys
import tempfile
from datetime import datetime
from pathlib import Path

FIXED_MD = ("PRODUCT.md", "FEATURES.md", "NOW.md")


def md_names(*dirs):
    """快照/对比涉及的文件：三大文件 + 任一给定目录里出现的 .md（术语表可以叫任意名字）。"""
    names = set(FIXED_MD)
    for d in dirs:
        try:
            for p in Path(d).glob("*.md"):
                names.add(p.name)
        except OSError:
            pass
    return sorted(names)


def _utf8():
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def _load_index(vdir: Path):
    ip = vdir / "index.json"
    if not ip.is_file():
        return {"versions": []}
    try:
        data = json.loads(ip.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("versions"), list):
            return data
    except Exception:
        pass
    return {"versions": []}


def save(dash: Path, note: str):
    vdir = dash / ".versions"
    idx = _load_index(vdir)
    n = max([v.get("n", 0) for v in idx["versions"]] + [0]) + 1
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    dirname = "%03d-%s" % (n, stamp)
    dest = vdir / dirname
    suffix = 1
    while dest.exists():  # 同一分钟连存两版：目录名加尾号，n 依然递增不复用
        suffix += 1
        dest = vdir / (dirname + "-" + str(suffix))
    dest.mkdir(parents=True)
    copied = []
    for name in md_names(dash):
        src = dash / name
        if src.is_file():
            dest.joinpath(name).write_bytes(src.read_bytes())
            copied.append(name)
    entry = {"n": n, "dir": dest.name, "created_at": datetime.now().isoformat(timespec="seconds"),
             "note": note or ""}
    idx["versions"].append(entry)
    vdir.joinpath("index.json").write_text(json.dumps(idx, ensure_ascii=False, indent=1) + "\n",
                                           encoding="utf-8")
    print(f"OK: 已存版本 {n}（{dest.name}，含 {len(copied)} 份文件）" + (f"——{note}" if note else ""))
    return 0


def list_versions(dash: Path):
    idx = _load_index(dash / ".versions")
    if not idx["versions"]:
        print("还没有版本快照。用 save 存第一版。")
        return 0
    for v in idx["versions"]:
        print(f"  v{v['n']}  {v['created_at']}  {v.get('note') or '（无说明）'}")
    return 0


def _read(d: Path, name: str):
    p = d / name
    return p.read_text(encoding="utf-8-sig").splitlines() if p.is_file() else []


def diff(dash: Path, n: int, m=None):
    """diff n：版本 n 与**当前**三份 Markdown 的差异；diff n m：两个版本之间。"""
    idx = _load_index(dash / ".versions")
    by_n = {v.get("n"): v for v in idx["versions"]}
    if n not in by_n:
        print(f"FATAL: 没有版本 {n}（现有: {sorted(by_n) or '无'}）")
        return 1
    a_dir = dash / ".versions" / by_n[n]["dir"]
    if m is None:
        b_dir, b_label = dash, "当前"
    else:
        if m not in by_n:
            print(f"FATAL: 没有版本 {m}")
            return 1
        b_dir, b_label = dash / ".versions" / by_n[m]["dir"], f"版本 {m}"
    any_diff = False
    for name in md_names(a_dir, b_dir, dash):
        a, b = _read(a_dir, name), _read(b_dir, name)
        if a == b:
            continue
        any_diff = True
        print(f"── {name}（版本 {n} → {b_label}）")
        for line in difflib.unified_diff(a, b, fromfile=f"v{n}/{name}", tofile=f"{b_label}/{name}",
                                         lineterm="", n=2):
            print(line)
    if not any_diff:
        print(f"版本 {n} 与 {b_label} 内容一致。")
    return 0


def self_test():
    with tempfile.TemporaryDirectory() as tmp:
        dash = Path(tmp) / "dev-dashboard"
        dash.mkdir()
        (dash / "PRODUCT.md").write_text("# 项目甲\n", encoding="utf-8")
        (dash / "FEATURES.md").write_text("# 功能地图\n", encoding="utf-8")
        (dash / "NOW.md").write_text("# 现在\n", encoding="utf-8")
        assert save(dash, "第一版") == 0
        (dash / "NOW.md").write_text("# 现在\n- 2026-01-01 | 变了一行\n", encoding="utf-8")
        assert save(dash, "") == 0
        idx = _load_index(dash / ".versions")
        assert [v["n"] for v in idx["versions"]] == [1, 2], "版本号应递增"
        assert not (dash / ".versions" / idx["versions"][0]["dir"] / "GLOSSARY.md").exists(), \
            "没有 GLOSSARY.md 时不应凭空生成"
        assert diff(dash, 1) == 0  # 版本1 → 当前，有差异也正常输出
        assert diff(dash, 1, 2) == 0
        assert diff(dash, 99) == 1
        print("SELF-TEST PASS: snapshot_version")
        return 0


def main(argv):
    _utf8()
    if "--self-test" in argv:
        return self_test()
    args = [a for a in argv if not a.startswith("--")]
    if len(args) < 2:
        print(__doc__)
        return 1
    dash = Path(args[0])
    if not dash.is_dir():
        print("FATAL: 目录不存在 " + args[0])
        return 1
    action = args[1]
    if action == "save":
        note = ""
        if "--note" in argv:
            i = argv.index("--note")
            if i + 1 < len(argv):
                note = argv[i + 1]
        return save(dash, note)
    if action == "list":
        return list_versions(dash)
    if action == "diff":
        if len(args) < 3 or not args[2].isdigit():
            print("FATAL: diff 需要版本号，如 diff 3 或 diff 1 3")
            return 1
        n = int(args[2])
        m = int(args[3]) if len(args) > 3 and args[3].isdigit() else None
        return diff(dash, n, m)
    print("FATAL: 未知动作 " + action + "（save / list / diff）")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
