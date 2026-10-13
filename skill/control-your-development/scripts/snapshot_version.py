#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""snapshot_version.py — dev-dashboard 版本快照（契约 v1.3）。

用法：
    python snapshot_version.py <dev-dashboard目录> save [--note 说明]
    python snapshot_version.py <dev-dashboard目录> list
    python snapshot_version.py <dev-dashboard目录> diff <版本号n> [版本号m]
    python snapshot_version.py <dev-dashboard目录> prune [--keep 20]
    python snapshot_version.py <dev-dashboard目录> preflight
    python snapshot_version.py --self-test

布局：dev-dashboard/.versions/index.json + 每版一个目录 NNN-<yyyymmdd-HHMM>/，
内含当时的三大 Markdown（PRODUCT / FEATURES / NOW）与术语表——术语表按**实际文件名**收录
（项目可以叫 术语表.md / glossary.md …，所以这里不写死名字）。
退出码：0 正常；1 参数/目录错误；3 = preflight 发现 dev-dashboard/ 有未提交改动（裁决权交给人）。

批 4：
- `save()` 末尾自动 `prune()`：`.versions/` 默认只留最近 20 版（从最旧删起，n 不回退不复用）；
- `preflight()`：改 Markdown 之前查 dev-dashboard/ 的 git 干净度（脏 → 退 3 并列脏文件）。
"""
import difflib
import json
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

FIXED_MD = ("PRODUCT.md", "FEATURES.md", "NOW.md")
KEEP_VERSIONS = 20   # `.versions/` 保留上限：更早的历史交给 git（Markdown 本就在版本控制里）


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


def prune(dash: Path, keep: int = KEEP_VERSIONS):
    """只保留最近 keep 版：从最旧删起（目录 + index.json 条目同步收缩），n 不回退、不复用。

    `.versions/` 只由本脚本删（它 owns 该目录）；删除前逐个核对目标确实在 `.versions/` 下，
    index.json 被改坏也不会删到目录外面去。
    """
    if keep < 0:
        print("FATAL: --keep 不能是负数")
        return 1
    vdir = dash / ".versions"
    idx = _load_index(vdir)
    versions = [v for v in idx["versions"] if isinstance(v, dict)]
    if len(versions) <= keep:
        print("OK: 版本 %d 个，未超过保留上限 %d，无需 prune。" % (len(versions), keep))
        return 0
    ordered = sorted(versions, key=lambda v: v.get("n", 0))
    drop, kept = ordered[:len(ordered) - keep], ordered[len(ordered) - keep:]
    cut = kept[0].get("n", 0)
    vroot = vdir.resolve()
    removed, skipped = 0, 0
    for v in drop:
        name = str(v.get("dir") or "")
        target = vdir / name
        try:
            resolved = target.resolve()
        except OSError:
            resolved = None
        if not name or resolved is None or resolved.parent != vroot or not resolved.is_dir():
            print("WARN: 跳过目录异常的版本条目 %r（不在 %s 下，不删）" % (name, vdir.name))
            skipped += 1
            continue
        shutil.rmtree(resolved)
        removed += 1
    idx["versions"] = [v for v in versions if v.get("n", 0) >= cut]
    vdir.joinpath("index.json").write_text(json.dumps(idx, ensure_ascii=False, indent=1) + "\n",
                                           encoding="utf-8")
    print("OK: prune 删除 %d 版（目录 %d 个），保留最近 %d 版；最大 n=%s 不回退不复用%s" % (
        len(drop), removed, keep, max((v.get("n", 0) for v in idx["versions"]), default=0),
        "；%d 条目录异常已跳过" % skipped if skipped else ""))
    return 0


def preflight(dash: Path):
    """改 Markdown 之前的 git 干净检查：只看即将改的 `dev-dashboard/`，别人的脏改动不算。

    0 = 干净（或无 git，**已明说跳过**）；3 = 脏，裁决权交给人（commit / stash / 继续）。
    """
    from collect_facts import find_workspace   # 同目录共用一处「工作区根」判定
    ws = find_workspace(dash)
    if not (ws / ".git").exists():
        print("跳过：无 git，跳过检查（快照仍存）——改前没有提交基线，事后无法回答「这次改动是谁改的」")
        return 0
    try:
        rel = dash.resolve().relative_to(ws.resolve()).as_posix()
    except ValueError:
        rel = dash.name
    r = subprocess.run(["git", "-C", str(ws), "-c", "core.quotepath=false",
                        "status", "--porcelain", "--untracked-files=all", "--", rel],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print("跳过：git status 失败（exit %d）：%s —— 未做干净检查，不算通过"
              % (r.returncode, (r.stderr or "").strip()[:200]))
        return 0
    dirty = [l for l in (r.stdout or "").splitlines() if l.strip()]
    if not dirty:
        print("OK: git 工作区干净（%s/），继续。" % rel)
        return 0
    print("脏：%s/ 下有 %d 处未提交改动 —— 带着它写入会失去 diff 基线，事后无法归因：" % (rel, len(dirty)))
    for l in dirty[:20]:
        print("  " + l)
    if len(dirty) > 20:
        print("  … 其余 %d 条" % (len(dirty) - 20))
    print("请三选一后再继续：① git commit 先把现状提交 ② git stash 暂存起来 "
          "③ 明确说「继续」（本次仍会先存写前快照）")
    return 3


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
    return prune(dash)   # 每存一版自动收缩（index 已写盘）


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
    import contextlib
    import io
    skips = []
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

        # ---- D：save() 自动 prune（存到第 21 版 → 只剩最近 20 版，最大 n 不回退） ----
        for i in range(3, 22):
            assert save(dash, "第 %d 版" % i) == 0
        vdir = dash / ".versions"
        idx = _load_index(vdir)
        ns = [v["n"] for v in idx["versions"]]
        assert len(ns) == KEEP_VERSIONS, "应只剩 %d 版，实际 %d" % (KEEP_VERSIONS, len(ns))
        assert max(ns) == 21, "最大版本号必须是 21（不回退不复用），实际 %s" % max(ns)
        assert len([p for p in vdir.iterdir() if p.is_dir()]) == KEEP_VERSIONS, "目录数应与版本数一致"
        dirs = sorted(p.name for p in vdir.iterdir() if p.is_dir())
        assert dirs[0].startswith("002-"), "最旧的 001 版目录应已删除，实际最小是 %s" % dirs[0]
        # 幂等：再跑一次无变化、退 0
        assert prune(dash) == 0
        assert [v["n"] for v in _load_index(vdir)["versions"]] == ns, "重复 prune 不该再动 index"
        # --keep 显式给值
        assert prune(dash, keep=3) == 0
        assert [v["n"] for v in _load_index(vdir)["versions"]] == [19, 20, 21], "--keep 3 应留最后三版"
        assert diff(dash, 21) == 0, "留存的版本仍可 diff"

        # ---- E：preflight —— 非 git 退 0 且说明；干净退 0；脏退 3 并列出脏文件 ----
        nogit = Path(tmp) / "nogit-dash"
        nogit.mkdir()
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = preflight(nogit)
        assert rc == 0 and "无 git，跳过检查" in buf.getvalue(), \
            "非 git 工作区应退 0 且说明跳过: %r exit=%s" % (buf.getvalue()[:120], rc)

        if shutil.which("git"):
            repo = Path(tmp) / "repo"
            dash2 = repo / "dev-dashboard"
            dash2.mkdir(parents=True)
            (repo / "a.py").write_text("# a", encoding="utf-8")

            def git(*a, **kw):
                return subprocess.run(["git", "-C", str(repo)] + list(a), capture_output=True,
                                      text=True, encoding="utf-8", errors="replace", **kw)

            assert git("init", "-q").returncode == 0, "git init 失败"
            git("add", "-A")
            assert git("-c", "user.email=a@b", "-c", "user.name=t", "commit", "-qm", "init").returncode == 0
            with contextlib.redirect_stdout(io.StringIO()):
                rc = preflight(dash2)
            assert rc == 0, "干净工作区应退 0，实际 %s" % rc
            # 只查 dev-dashboard/：仓里别处的脏改动不算
            (repo / "a.py").write_text("# a 改过", encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()):
                rc = preflight(dash2)
            assert rc == 0, "dev-dashboard 外的脏改动不该拦（只看即将改的目录），实际 %s" % rc
            # dev-dashboard/ 脏 → 退 3 并列出该文件
            (dash2 / "NOW.md").write_text("# 现在\n- 改了一行\n", encoding="utf-8")
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = preflight(dash2)
            out = buf.getvalue()
            assert rc == 3, "脏工作区应退 3，实际 %s" % rc
            assert "NOW.md" in out, "脏文件必须列出来: %r" % out[:200]
            assert "commit" in out and "stash" in out, "必须给出三选一的提示"
        else:
            skips.append("preflight 的 git 用例（本机未找到 git）")

        # ---- F：**旧布局夹具**（契约 `:543`【目标形态】）----
        # 拿一份"三版之前"的 `.versions/`（旧插件写的：index 条目**只有 n/dir/created_at、没有 note**），
        # 断言 `list` / `diff` **仍可用**；且**只新增不迁移**（旧目录名与内容一字不动）、
        # `n` 递增不复用、`prune` 只按数量删最旧 —— 三条都不依赖 index 里的可选新键。
        with tempfile.TemporaryDirectory() as tmp2:
            d2 = Path(tmp2) / "dev-dashboard"
            d2.mkdir()
            for name, body in (("PRODUCT.md", "# 项目甲\n"), ("FEATURES.md", "# 功能地图\n"),
                               ("NOW.md", "# 现在\n")):
                (d2 / name).write_text(body, encoding="utf-8")
            vdir2 = d2 / ".versions"
            old = [{"n": 1, "dir": "001-20250101-0000", "created_at": "2025-01-01T00:00:00"},
                   {"n": 2, "dir": "002-20250102-0000", "created_at": "2025-01-02T00:00:00"},
                   {"n": 3, "dir": "003-20250103-0000", "created_at": "2025-01-03T00:00:00"}]
            for v in old:
                (vdir2 / v["dir"]).mkdir(parents=True)
                (vdir2 / v["dir"] / "PRODUCT.md").write_text("# 旧版 %d\n" % v["n"], encoding="utf-8")
            (vdir2 / "index.json").write_text(
                json.dumps({"versions": old}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            before = sorted(p.name for p in vdir2.iterdir())
            # ① list 仍可用（只读 index，不依赖 note 等可选键）
            assert list_versions(d2) == 0, "旧布局下 list 必须仍可用"
            # ② diff 仍可用：旧版之间、旧版与当前
            assert diff(d2, 1, 3) == 0, "旧布局下 diff n m 必须仍可用"
            assert diff(d2, 3) == 0, "旧布局下 diff n（对当前）必须仍可用"
            # ③ **不迁移**：旧目录（名字与数量）原封不动
            assert sorted(p.name for p in vdir2.iterdir()) == before, "旧布局目录被迁移/改名了"
            # ④ 再存一版：`n` 从 3 起**递增不复用**
            assert save(d2, "新一版") == 0
            assert [v["n"] for v in _load_index(vdir2)["versions"]] == [1, 2, 3, 4], \
                "旧布局之后 n 必须递增不复用，实际 %s" % [v["n"] for v in _load_index(vdir2)["versions"]]
            # ⑤ `prune` 只按数量删最旧：keep=2 ⇒ 留 3/4，旧目录 1/2 删掉、3 保留且内容不动
            assert prune(d2, keep=2) == 0
            assert [v["n"] for v in _load_index(vdir2)["versions"]] == [3, 4], \
                "prune 应只按数量删最旧，实际 %s" % [v["n"] for v in _load_index(vdir2)["versions"]]
            assert (vdir2 / "003-20250103-0000" / "PRODUCT.md").read_text(encoding="utf-8") == "# 旧版 3\n", \
                "留存的最旧版内容被改动了"

        print("SELF-TEST PASS: snapshot_version%s" % (
            "；SKIP %d 项：%s" % (len(skips), " / ".join(skips)) if skips else ""))
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
    if action == "prune":
        keep = KEEP_VERSIONS
        if "--keep" in argv:
            i = argv.index("--keep")
            if i + 1 >= len(argv) or not argv[i + 1].isdigit():
                print("FATAL: --keep 需要整数，如 prune --keep 20")
                return 1
            keep = int(argv[i + 1])
        return prune(dash, keep)
    if action == "preflight":
        return preflight(dash)
    print("FATAL: 未知动作 " + action + "（save / list / diff / prune / preflight）")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
