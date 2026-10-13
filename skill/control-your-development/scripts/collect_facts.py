#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""collect_facts.py — 采集工作区自上次采集以来的全部变更事实，写入 dev-dashboard/.facts.json。

用法：
    python collect_facts.py <dev-dashboard目录> [--workspace 根目录]
    python collect_facts.py --self-test

行为：有 git 用 git（已提交 + 未提交）；无 git 退化为按文件修改时间扫描。
排除 dev-dashboard/ 自身与常见噪声目录。退出码：0 正常；1 致命错误。

批 4（同步链路）：
- `.facts.json` 只留「未归置」项：已被三份 Markdown 证据行接住的项出列（**已归置 ≠ 丢失**）；
- `.state.json` 只记采集游标 `{last_collect, files}`，不再拷一份 `pending_items`
  （旧文件里的 `pending_items` 兼容读后直接忽略）；累计未归置集合的唯一事实源是 `.facts.json` 自己；
- `last_collect` 缺失 / 1970 / 不可解析 → 采集窗口限为「最近 30 天」或「最多 500 条」并 WARN 说明历史未采全。

契约 L544（写机器文件必须保留未知键，本版推广到这两个文件）：
- 写盘基线 = **盘上现有内容**（`_preserved()`：整体读进来，只删 `DROP_KEYS` 里的已知废弃键），
  再 `update` 已知键 ⇒ **更新版插件写进去的未知键原样保留**，不会被本版静默丢掉；
- `.cyd.json` 早就是这个写法（`write_cyd_meta` 整体读后只覆盖已知键），本条把口径统一到三件机器文件；
- 坏文件（非 JSON / 不是对象 / 缺失）→ 以空 dict 为基线**自愈重写**，不许把写路径卡死。
"""
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
# 证据抽取只用渲染器那一套（同目录纯函数、零副作用）—— 禁止在采集器里再写一套「证据行」正则
from render_dashboard import glob_match, parse_features, parse_now, parse_product  # noqa: E402
# `_skill_version()` **复用渲染器那一份**（读同目录 skill 根的 manifest.yaml）—— 单一执行路径：
# 采集与渲染写进机器文件的 `writer.skill` 必须是**同一个版本常量**（不让两份产物两种行为）。
from render_dashboard import _skill_version  # noqa: E402
# 乐观并发检查（契约 :552 形态③）的**唯一实现**在渲染器那一份 —— 采集器只调用，不另写一套哈希口径。
from render_dashboard import concurrent_edit, file_hash  # noqa: E402

WINDOW_DAYS = 30        # last_collect 丢失时的采集窗口（天）
GIT_MAX_COUNT = 500     # 同期 git log 条数上限：与 30 天窗口「先到者」生效
MD_FILES = ("PRODUCT.md", "FEATURES.md", "NOW.md")

SKIP_DIRS = {".git", ".dsh", "node_modules", "__pycache__", ".venv", "venv", "dist", "build",
             ".idea", ".vscode", ".next", ".cache", "target"}
CODE_EXT = {".py", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".c", ".cpp", ".h", ".java",
            ".go", ".rs", ".rb", ".php", ".cs", ".swift", ".kt", ".sh", ".ps1",
            ".html", ".css", ".vue", ".svelte", ".sql"}
DOC_EXT = {".md", ".txt", ".rst", ".adoc"}


def _utf8():
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def find_workspace(dashboard_dir: Path) -> Path:
    cur = dashboard_dir.resolve().parent
    for cand in [cur] + list(cur.parents):
        if (cand / ".git").exists():
            return cand
    return cur


def kind_of(path: str) -> str:
    name = Path(path).name.lower()
    ext = Path(path).suffix.lower()
    if "test" in name or name.startswith("spec"):
        return "test"
    if ext in DOC_EXT:
        return "doc"
    if ext in CODE_EXT:
        return "code"
    return "other"


_GIT_ERROR = ""


def _git(ws: Path, args):
    """调用 git。统一 core.quotepath=false（否则中文路径会变成八进制转义串）并固定 UTF-8 解码。"""
    global _GIT_ERROR
    cmd = ["git", "-C", str(ws), "-c", "core.quotepath=false"] + args
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30,
                           encoding="utf-8", errors="replace")
        return r.returncode == 0, r.stdout
    except subprocess.TimeoutExpired:
        _GIT_ERROR = "git 命令超时（30 秒）"
        return False, ""
    except Exception as e:
        _GIT_ERROR = "git 调用失败：" + str(e)
        return False, ""


def _unquote_git_path(p: str) -> str:
    """还原 git 的 C 风格引号路径（兼容用户全局把 core.quotepath 设回 true 的情况）。"""
    if not (p.startswith('"') and p.endswith('"')):
        return p
    body, out, i = p[1:-1], bytearray(), 0
    while i < len(body):
        c = body[i]
        if c == '\\' and i + 1 < len(body):
            nxt = body[i + 1]
            if nxt in '01234567':
                j, digits = i + 1, ""
                while j < len(body) and len(digits) < 3 and body[j] in '01234567':
                    digits += body[j]
                    j += 1
                out.append(int(digits, 8) & 0xFF)
                i = j
                continue
            esc = {"n": 10, "t": 9, "r": 13, "\"": 34, "\\": 92}
            if nxt in esc:
                out.append(esc[nxt])
                i += 2
                continue
        out.extend(c.encode("utf-8", "surrogateescape"))
        i += 1
    return out.decode("utf-8", "replace")


def _load_ignore(dash: Path):
    p = dash / ".dashboard-ignore"
    if not p.is_file():
        return []
    return [l.strip() for l in p.read_text(encoding="utf-8").splitlines()
            if l.strip() and not l.strip().startswith("#")]

def collect_git(ws: Path, dash_rel: str, since_iso: str):
    """返回 (ok, items, truncated)。items: [{path, kind, change}]；truncated = 命中 --max-count 上限。

    `--max-count` 与窗口「先到者」：`last_collect` 丢失时若不吃上限，重新克隆的仓库会把全历史
    一次倒出来，用户面对几千条未归置事实无从下手（见契约「同步链路 5 项改进」第 3 条）。
    """
    seen = {}
    ok, out = _git(ws, ["log", "--since=" + since_iso, "--max-count=%d" % GIT_MAX_COUNT,
                        "--name-status", "--pretty=format:--COMMIT--"])
    if not ok:
        return False, [], False
    commits = 0
    for line in out.splitlines():
        if line == "--COMMIT--":
            commits += 1
            continue
        parts = line.split("\t")
        if len(parts) >= 2 and parts[0] in ("A", "M", "D"):
            change = {"A": "added", "M": "modified", "D": "deleted"}[parts[0]]
            # git log 是"新→旧"，同路径只认第一条（最新）事件，避免旧事件覆盖新事件
            seen.setdefault(_unquote_git_path(parts[1]), change)
        elif len(parts) >= 3 and parts[0].startswith("R"):
            seen.setdefault(_unquote_git_path(parts[2]), "added")
    ok2, out2 = _git(ws, ["status", "--porcelain"])
    if ok2:
        for line in out2.splitlines():
            if len(line) < 4:
                continue
            code = line[:2].strip()
            path = _unquote_git_path(line[3:].strip())
            if " -> " in path:
                path = path.split(" -> ")[-1]
            if code == "??" or "A" in code:
                seen[path] = "added"
            elif "D" in code:
                seen[path] = "deleted"
            else:
                seen.setdefault(path, "modified")
    items = []
    for p, ch in sorted(seen.items()):
        if p.startswith(dash_rel) or p.startswith(".git") or p.startswith(".dsh/"):
            continue
        items.append({"path": p, "kind": kind_of(p), "change": ch})
    return True, items, commits >= GIT_MAX_COUNT


def collect_mtime(ws: Path, dash: Path, since_ts: float):
    """按 mtime 扫描。返回 (items, 当前文件清单)。跳过符号链接与 junction，避免重复登记。"""
    items, files = [], []
    dash_r = dash.resolve()
    for dirpath, dirnames, filenames in os.walk(ws):
        try:
            if os.path.islink(dirpath) or (hasattr(os.path, "isjunction") and os.path.isjunction(dirpath)):
                dirnames[:] = []
                continue
        except OSError:
            pass
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        dpath = Path(dirpath).resolve()
        if dpath == dash_r or dash_r in dpath.parents:
            dirnames[:] = []
            continue
        for fn in filenames:
            fp = Path(dirpath) / fn
            try:
                rel = fp.relative_to(ws).as_posix()
                files.append(rel)
                if fp.stat().st_mtime > since_ts:
                    items.append({"path": rel, "kind": kind_of(rel), "change": "modified"})
            except OSError:
                continue
    items.sort(key=lambda x: x["path"])
    files.sort()
    return items, files

# 已知废弃键：**必须丢**（留着就把 `.facts.json` 的第二份拷贝复活 ⇒ 单一事实源破了）。
# 除它之外的键一律视为「更新版插件写的」，写盘时**原样保留**（契约 L544 点名：
# 「写机器文件必须保留未知键」——`.cyd.json` 早就如此，本条把它推广到 `.facts.json` / `.state.json`）。
DROP_KEYS = {"pending_items"}


def _preserved(path: Path):
    """写机器文件前的**基线**：整体读进来，只删已知废弃键；未知键一个都不许丢。

    为什么必须这样写：旧版本/旧副本的解析器不认识新版本写进去的键，若写盘时重建一个全新 dict，
    那些键就被**静默丢掉**了 —— 静默正是这条契约要防的东西（用户从"旧插件仍能读写"里得不到任何提示）。
    读不动（缺失 / 不是对象 / 坏 JSON）→ 空 dict：**写路径必须能自愈**，不许因为坏文件写不下去。
    """
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                for k in DROP_KEYS:
                    data.pop(k, None)
                return data
        except Exception:
            pass
    return {}


def load_state(dash: Path):
    """采集游标。旧文件的 `pending_items`（批 4 前的第二份拷贝）**兼容读后忽略**：
    不迁移、不报错，下次写盘自然消失。未知键保留（与写路径同一条基线，见 `_preserved`）。"""
    return _preserved(dash / ".state.json")


def _read_md(dash: Path, name: str) -> str:
    p = dash / name
    # utf-8-sig：与渲染器同口径，容忍 Windows 编辑器写出的 BOM
    return p.read_text(encoding="utf-8-sig") if p.is_file() else ""


def evidence_paths(dash: Path):
    """三份 Markdown 里**已被证据引用**的路径集合（归一化口径同 render_dashboard.audit）。

    复用渲染器的解析函数抽证据：功能与子项、使用流程、时间线三处 —— 与渲染器的
    `evidence_pairs` 完全同源；**不在采集器里重写正则**（单一执行路径）。
    """
    warnings = []           # 解析告警归渲染器发声，采集器不抢这条通道
    proj = parse_product(_read_md(dash, "PRODUCT.md"), warnings)
    feats = parse_features(_read_md(dash, "FEATURES.md"), warnings)
    timeline, _decisions, _todos = parse_now(_read_md(dash, "NOW.md"), warnings)
    paths = []
    for f in feats:
        paths += list(f["evidence"])
        for c in f["children"]:
            paths += list(c["evidence"])
    for j in proj["journey"]:
        paths += list(j["evidence"])
    for t in timeline:
        paths += list(t["evidence"])
    return {p.replace("\\", "/").lstrip("/") for p in paths}


def _load_facts_items(dash: Path, warnings):
    """上一轮 `.facts.json` 的 items —— 「累计未归置集合」的唯一事实源。

    批 4 的合并起点从 `.state.json` 的 `pending_items` 拷切换到 `.facts.json` 自己：既是单一事实源，
    又让人工校正 / 出列后的结果不会被旧 state 复活。文件在但解析不了 → WARN（渲染器另按 corrupt 报 blocker）。
    """
    fp = dash / ".facts.json"
    if not fp.is_file():
        return {}
    try:
        data = json.loads(fp.read_text(encoding="utf-8"))
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list):
            raise ValueError("items 不是数组")
    except Exception:
        warnings.append("上一轮 .facts.json 不可解析，本轮按空起点合并未归置项"
                        "（渲染器会按 corrupt 报 blocker）")
        return {}
    out = {}
    for it in items:
        if isinstance(it, dict) and it.get("path"):
            out[it["path"]] = it
    return out


def _since_of(state, now, warnings):
    """起点判定：`last_collect` 缺失 / 1970 / 不可解析 → 限窗（最近 30 天）+ WARN。"""
    raw = state.get("last_collect")
    if raw:
        try:
            dt = datetime.fromisoformat(str(raw))
            if not str(raw).startswith("1970-01-01"):
                return str(raw), dt.timestamp()
        except Exception:
            pass
    dt = now - timedelta(days=WINDOW_DAYS)
    warnings.append("没有可用的上次采集时间（.state.json 缺失或 last_collect 不可解析），"
                    "已把采集窗口限制为最近 %d 天 / 最多 %d 条：**历史未采全**，可能漏掉更早的改动，"
                    "请人工确认（`.facts.json` 只覆盖这段窗口）。" % (WINDOW_DAYS, GIT_MAX_COUNT))
    return dt.isoformat(), dt.timestamp()


def collect(dash: Path, ws: Path, now=None):
    """采集并写盘。返回 (source, items, warnings)。

    要点：.facts.json 写的是「累计未归置集合」——已写入但**未被证据引用/未被 ignore** 的项会跨轮次
    保留（合并起点就是上一轮 `.facts.json`），因此「连跑两次采集再渲染」无法把覆盖性门禁洗掉；
    反过来，已被证据接住的项出列，文件不随采集轮次无限膨胀。"""
    global _GIT_ERROR
    _GIT_ERROR = ""
    now = now or datetime.now(timezone.utc)
    state = load_state(dash)
    h_state0 = file_hash(dash / ".state.json")   # 读入那一刻的哈希（乐观并发检查的基线，见下方写盘处）
    dash_rel = dash.resolve().relative_to(ws.resolve()).as_posix() + "/" \
        if ws.resolve() in dash.resolve().parents else "dev-dashboard/"
    warnings = []
    since_iso, since_ts = _since_of(state, now, warnings)

    ok_git, _ = _git(ws, ["rev-parse", "--is-inside-work-tree"])
    cur_files = None
    if ok_git:
        used, items, truncated = collect_git(ws, dash_rel, since_iso)
        source = "git"
        if not used:
            warnings.append("git 采集失败（" + (_GIT_ERROR or "未知原因") + "），已降级为按文件时间扫描")
            source = "mtime(git 不可用兜底)"
            items, cur_files = collect_mtime(ws, dash, since_ts)
        elif truncated:
            warnings.append("git 命中 %d 条上限，只取了最近 %d 条提交：更早的改动未采全，"
                            "必要时先收敛未归置项再重跑。" % (GIT_MAX_COUNT, GIT_MAX_COUNT))
    else:
        if _GIT_ERROR:
            warnings.append("git 不可用（" + _GIT_ERROR + "），按文件时间扫描")
        source = "mtime(非 git 项目)"
        items, cur_files = collect_mtime(ws, dash, since_ts)

    if cur_files is not None:
        prev_files = state.get("files") or []
        for p in sorted(set(prev_files) - set(cur_files)):
            items.append({"path": p, "kind": kind_of(p), "change": "deleted"})

    ignore = _load_ignore(dash)
    evidence = evidence_paths(dash)
    h_facts0 = file_hash(dash / ".facts.json")   # 读入那一刻的哈希（乐观并发检查的基线，见下方写盘处）
    merged = _load_facts_items(dash, warnings)
    for it in items:
        merged[it["path"]] = it
    # 出列：已被证据引用（已归置）或命中 .dashboard-ignore（显式忽略）的项不再留在未归置集合里。
    # 审计语义不变：pending = 事实 ∖ (证据 ∪ ignore)；已归置 ≠ 丢失。
    pending_items = [it for p, it in sorted(merged.items())
                     if not any(glob_match(p, pat) for pat in ignore)
                     and p.replace("\\", "/").lstrip("/") not in evidence]

    # 一次写：先在内存里算完 pending_items 再落盘（不要写两遍）。
    # **基线 = 盘上现有内容**（只删已知废弃键）⇒ 更新版插件写进去的未知键原样保留（契约 L544）。
    # `writer` = 「这个文件最后被哪个插件版本写的」（契约 :495 目标形态；`.cyd.json` 早已如此，本条
    # 把它补到采集器写的两个机器文件上）。**只看 `skill`，不看 `at`**：`at` 每次真写都变，进两端比对会假红。
    # ⚠ **字段已写、判据未用**（2026-10-13 队长裁决 (A)）：契约 `:550` 明文限定「版本冲突形态①
    # （`writer.skill` 超前 ⇒ 只读 + WARN）**只对 `.cyd.json` 成立**」⇒ 这两个文件**只补字段、
    # 不产任何 WARN**（合契约 `:542`「今后只允许新增键」）。**别以为那条 WARN 覆盖了这两个文件**
    # —— `.state.json` 连两端都读不到（宿主不读它）。
    _writer = {"skill": _skill_version(), "at": now.isoformat(timespec="seconds")}
    _facts_fields = {"generated_at": now.isoformat(timespec="seconds"), "source": source,
                     "items": pending_items, "writer": _writer}
    facts = _preserved(dash / ".facts.json")
    facts.update(_facts_fields)
    # 乐观并发检查（契约 :552 形态③）：读入之后被别人改过 ⇒ **WARN + 重算**（不覆盖别人的改动；
    # 未知键本来就靠 `_preserved` 保留，这里保的是**别人的新写入**，不是"我们认识的键"）。
    if concurrent_edit(dash / ".facts.json", h_facts0, ".facts.json"):
        facts = _preserved(dash / ".facts.json")
        facts.update(_facts_fields)
    (dash / ".facts.json").write_text(json.dumps(facts, ensure_ascii=False, indent=1),
                                      encoding="utf-8")
    # .state.json 只记采集游标：last_collect + files（pending_items 是 .facts.json 的第二份拷贝，批 4 删除）；
    # `writer` 同上一段（新增键，不改既有键语义 ⇒ 合契约 :542「今后只允许新增键」）。
    files = cur_files if cur_files is not None else (state.get("files") or [])
    _state_fields = {"last_collect": now.isoformat(), "files": files, "writer": _writer}
    state_out = _preserved(dash / ".state.json")
    state_out.update(_state_fields)
    if concurrent_edit(dash / ".state.json", h_state0, ".state.json"):
        state_out = _preserved(dash / ".state.json")
        state_out.update(_state_fields)
    (dash / ".state.json").write_text(json.dumps(state_out, ensure_ascii=False, indent=1),
                                      encoding="utf-8")
    return source, items, warnings

def _git_available() -> bool:
    try:
        return subprocess.run(["git", "--version"], capture_output=True).returncode == 0
    except Exception:
        return False


def _git_runner(root: Path):
    def run(*args, **kw):
        return subprocess.run(["git", "-C", str(root)] + list(args), capture_output=True,
                              text=True, encoding="utf-8", errors="replace", **kw)
    return run


def _write_min_dash(dash: Path):
    """自检用的最小可用 dev-dashboard（三份 Markdown 齐备，渲染器能跑审计）。"""
    (dash / "PRODUCT.md").write_text("# 项目甲\n\n## 项目简介\n一句话。\n\n## 当前方向\n- 阶段: 进行中\n",
                                     encoding="utf-8")
    (dash / "NOW.md").write_text("# 现在\n\n## 时间线\n\n## 决策\n\n## 待办\n", encoding="utf-8")
    (dash / "FEATURES.md").write_text("# 功能地图\n\n## 功能: 基准\n- 状态: 可用\n- 简介: x。\n",
                                      encoding="utf-8")


def _features_with(evidence: str) -> str:
    return ("# 功能地图\n\n## 功能: 基准\n- 状态: 可用\n- 简介: x。\n- 证据: " + evidence + "\n")


def self_test():
    import contextlib
    import io
    skips = []
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        dash = root / "dev-dashboard"
        dash.mkdir()
        (root / "src").mkdir()
        f = root / "src" / "a.py"
        f.write_text("print(1)", encoding="utf-8")
        time.sleep(0.05)
        source, items, _w = collect(dash, root)
        assert any(i["path"] == "src/a.py" for i in items), "首次采集应发现新文件"
        assert all(not i["path"].startswith("dev-dashboard") for i in items), "不应采集自身"
        _, items2, _w = collect(dash, root)
        assert not any(i["path"] == "src/a.py" for i in items2), "无变化应采集为空"
        time.sleep(0.05)
        f.write_text("print(2)", encoding="utf-8")
        os.utime(f, None)
        _, items3, _w = collect(dash, root)
        assert any(i["path"] == "src/a.py" for i in items3), "改动后应再次被发现"
        assert (dash / ".state.json").is_file() and (dash / ".facts.json").is_file()
        # 中文路径还原（git 八进制转义兜底）
        assert _unquote_git_path(r'"src/\344\270\255.py"') == "src/中.py", "C 引号路径未还原"
        # 删除事件可见
        f.unlink()
        _, items4, _w = collect(dash, root)
        assert any(i["path"] == "src/a.py" and i["change"] == "deleted" for i in items4), "删除未被采集"
        # 覆盖性门禁不可绕过：第二次采集后 .facts.json 仍保留未归置项
        facts = json.loads((dash / ".facts.json").read_text(encoding="utf-8"))
        assert any(i["path"] == "src/a.py" for i in facts["items"]), "未归置项被后续采集洗掉"
        # .state.json 只记游标（B）—— 判据是「**含**两个游标键且**不含** pending_items」，
        # 不是「键集合恰好相等」：未知键必须保留（契约 L544），相等式会把它误判成违规。
        st_now = json.loads((dash / ".state.json").read_text(encoding="utf-8"))
        assert {"last_collect", "files"} <= set(st_now), "游标键缺失: " + str(sorted(st_now))
        assert "pending_items" not in st_now, "pending_items 是已知废弃键，必须丢掉"

    # ---- A：已归置项出列、未归置项保留、pending 语义不变 ----
    with tempfile.TemporaryDirectory() as tmp:
        import render_dashboard as _rd
        root = Path(tmp)
        dash = root / "dev-dashboard"
        dash.mkdir()
        _write_min_dash(dash)
        (root / "src").mkdir()
        (root / "src" / "a.py").write_text("print(1)", encoding="utf-8")
        (root / "src" / "b.py").write_text("print(2)", encoding="utf-8")
        collect(dash, root)
        paths = {i["path"] for i in json.loads((dash / ".facts.json").read_text(encoding="utf-8"))["items"]}
        assert paths == {"src/a.py", "src/b.py"}, "首次采集两条都应未归置: " + str(paths)
        # a.py 写进 FEATURES 证据 = 已归置
        (dash / "FEATURES.md").write_text(_features_with("src/a.py"), encoding="utf-8")
        collect(dash, root)
        paths = {i["path"] for i in json.loads((dash / ".facts.json").read_text(encoding="utf-8"))["items"]}
        assert "src/a.py" not in paths, "已归置项（被证据引用）应出列: " + str(paths)
        assert "src/b.py" in paths, "未归置项必须保留: " + str(paths)
        with contextlib.redirect_stdout(io.StringIO()):
            rc = _rd.render(dash, root)
        assert rc == 2, "未归置项仍须让渲染器报 blocker（pending 语义不变），实际 exit=%s" % rc
        (dash / "FEATURES.md").write_text(_features_with("src/a.py, src/b.py"), encoding="utf-8")
        collect(dash, root)
        left = json.loads((dash / ".facts.json").read_text(encoding="utf-8"))["items"]
        assert left == [], "全部归置后未归置集合应为空: " + str(left)
        with contextlib.redirect_stdout(io.StringIO()):
            rc = _rd.render(dash, root)
        assert rc == 0, "全部归置后应无 blocker，实际 exit=%s" % rc

    # ---- B：旧 .state.json（含 pending_items）能读不报错；写回后该键消失，且不许复活旧项 ----
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        dash = root / "dev-dashboard"
        dash.mkdir()
        _write_min_dash(dash)
        (dash / ".state.json").write_text(json.dumps({
            "last_collect": "2026-01-01T00:00:00+00:00", "files": [],
            "pending_items": [{"path": "src/旧.py", "kind": "code", "change": "added"}]},
            ensure_ascii=False), encoding="utf-8")
        (root / "src").mkdir()
        (root / "src" / "new.py").write_text("# n", encoding="utf-8")
        _src, _items, w_b = collect(dash, root)          # 旧文件必须能读、不报错
        state = json.loads((dash / ".state.json").read_text(encoding="utf-8"))
        assert {"last_collect", "files"} <= set(state), "写回后游标键应还在: " + str(sorted(state))
        assert "pending_items" not in state, "已知废弃键 pending_items 写回后必须消失: " + str(sorted(state))
        left = {i["path"] for i in json.loads((dash / ".facts.json").read_text(encoding="utf-8"))["items"]}
        assert "src/旧.py" not in left, "旧 state 的 pending_items 不许把已不在的事实复活: " + str(left)
        assert not any("1970" in w for w in w_b), "last_collect 可用时不该触发限窗"

    # ---- D：保留未知键（契约 L544）—— 正向（未知键必须活）+ 反向（已知废弃键必须死 + 坏文件不许卡死写路径）
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        dash = root / "dev-dashboard"
        dash.mkdir()
        _write_min_dash(dash)
        (root / "src").mkdir()
        (root / "src" / "x.py").write_text("# x", encoding="utf-8")
        (dash / ".facts.json").write_text(json.dumps({
            "generated_at": "2026-01-01T00:00:00", "source": "旧插件", "items": [],
            "future_meta": {"ratio": 0.5}, "future_list": [1, 2, 3], "future_flag": True},
            ensure_ascii=False), encoding="utf-8")
        (dash / ".state.json").write_text(json.dumps({
            "last_collect": "2026-01-01T00:00:00+00:00", "files": [],
            "future_meta": {"ratio": 0.5}, "pending_items": [{"path": "src/旧.py"}]},
            ensure_ascii=False), encoding="utf-8")
        collect(dash, root)
        f = json.loads((dash / ".facts.json").read_text(encoding="utf-8"))
        s = json.loads((dash / ".state.json").read_text(encoding="utf-8"))
        assert f.get("future_meta") == {"ratio": 0.5} and f.get("future_list") == [1, 2, 3] \
            and f.get("future_flag") is True, "未知键被静默丢掉（.facts.json）: " + str(sorted(f))
        assert s.get("future_meta") == {"ratio": 0.5}, "未知键被静默丢掉（.state.json）: " + str(sorted(s))
        # 保留未知 ≠ 冻结整个文件：已知键照旧被更新
        assert any(i["path"] == "src/x.py" for i in f["items"]), "已知键 items 没更新: " + str(f["items"])
        assert isinstance(s.get("files"), list) and s["files"], "已知键 files 没更新: " + str(s.get("files"))
        # 反向：已知废弃键必须丢（留着就是 .facts.json 的第二份拷贝复活）
        assert "pending_items" not in s, "pending_items 必须丢: " + str(sorted(s))
        assert not any(i["path"] == "src/旧.py" for i in f["items"]), "旧 pending_items 不许复活: " + str(f["items"])
        # 反向：坏文件不许把写路径卡死（坏 JSON / 合法但不是对象）
        (dash / ".facts.json").write_text("{ 不是 json", encoding="utf-8")
        (dash / ".state.json").write_text("[]", encoding="utf-8")
        collect(dash, root)
        f2 = json.loads((dash / ".facts.json").read_text(encoding="utf-8"))
        s2 = json.loads((dash / ".state.json").read_text(encoding="utf-8"))
        assert set(f2) == {"generated_at", "source", "items", "writer"}, "坏 .facts.json 应被自愈重写: " + str(sorted(f2))
        assert {"last_collect", "files", "writer"} <= set(s2), "非对象 .state.json 应被自愈重写: " + str(sorted(s2))
        # `writer` 判据只看 `skill`（`at` 每次真写都变 ⇒ 进两端比对会假红），且必须是**非空字符串**
        for _f, _tag in ((f2, ".facts.json"), (s2, ".state.json")):
            _w = _f.get("writer")
            assert isinstance(_w, dict) and isinstance(_w.get("skill"), str) and _w["skill"].strip(), \
                _tag + " 的 writer.skill 必须是非空字符串: " + str(_w)
            assert _w["skill"] == _skill_version(), _tag + " 的 writer.skill 必须等于本插件版本: " + str(_w)

    # ---- C：last_collect 置 1970 → 限窗 + WARN，且本轮近期改动不许丢 ----
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        dash = root / "dev-dashboard"
        dash.mkdir()
        _write_min_dash(dash)
        (dash / ".state.json").write_text(json.dumps(
            {"last_collect": "1970-01-01T00:00:00+00:00", "files": []}), encoding="utf-8")
        (root / "src").mkdir()
        (root / "src" / "now.py").write_text("# n", encoding="utf-8")
        _src, items, w_c = collect(dash, root)
        assert any("历史未采全" in w and str(WINDOW_DAYS) in w for w in w_c), \
            "1970 应触发限窗 WARN: " + str(w_c)
        assert any(i["path"] == "src/now.py" for i in items), "限窗不许漏掉本轮的近期改动"
        st = json.loads((dash / ".state.json").read_text(encoding="utf-8"))
        assert not st["last_collect"].startswith("1970"), "采集后游标必须推进"
        # 缺失 .state.json 同样限窗
        (dash / ".state.json").unlink()
        _src, _items, w_c2 = collect(dash, root)
        assert any("历史未采全" in w for w in w_c2), "缺 .state.json 应限窗并说话: " + str(w_c2)

    # ---- C2：git --max-count 上限命中要说话（把上限临时压到 1 条，避免自检造 500 次提交） ----
    if _git_available():
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dash = root / "dev-dashboard"
            dash.mkdir()
            _write_min_dash(dash)
            g = _git_runner(root)
            assert g("init", "-q").returncode == 0, "git init 失败"
            (root / "old.py").write_text("# old", encoding="utf-8")
            g("add", "-A")
            old_env = dict(os.environ, GIT_AUTHOR_DATE="2000-01-01T00:00:00+0000",
                           GIT_COMMITTER_DATE="2000-01-01T00:00:00+0000")
            assert g("-c", "user.email=a@b", "-c", "user.name=t", "commit", "-qm", "old",
                     env=old_env).returncode == 0, "旧提交失败"
            (root / "recent.py").write_text("# new", encoding="utf-8")
            g("add", "-A")
            # **flaky 的验收用例本身就是缺陷**（"重跑就好了"不是修法；它属"验收工具自身不稳"那一族）：
            # 旧写法让这个提交用**墙钟当下**，而第二次 collect 的 `--since` 可能取自第一次刚写下的
            # `.state.json:last_collect`（≈同一秒），或落在**秒精度边界**上 ⇒ 提交被窗口排除
            # ⇒ `commits=0 < 上限` ⇒ `truncated=False` ⇒ 断言**偶发失败**（实测过一次，随后连跑两次通过）。
            # 钉法两件：① 显式 GIT_AUTHOR_DATE/GIT_COMMITTER_DATE（世界时 now-1d，任何 30 天窗口都覆盖）；
            #           ② 第二次 collect 前**删掉 .state.json**，强制走"限窗"路径，不依赖 last_collect 边界。
            from datetime import datetime, timedelta, timezone
            recent_iso = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S+0000")
            recent_env = dict(os.environ, GIT_AUTHOR_DATE=recent_iso, GIT_COMMITTER_DATE=recent_iso)
            assert g("-c", "user.email=a@b", "-c", "user.name=t", "commit", "-qm", "recent",
                     env=recent_env).returncode == 0, "近期提交失败"
            _src, items, _w = collect(dash, root)     # 无 .state.json → 限窗
            got = {i["path"] for i in items}
            assert "recent.py" in got, "近期提交必须采到: " + str(got)
            assert "old.py" not in got, "2000 年的提交不许进（--since 限窗生效）: " + str(got)
            cap = GIT_MAX_COUNT
            try:
                globals()["GIT_MAX_COUNT"] = 1
                (dash / ".state.json").unlink(missing_ok=True)   # 强制限窗：不依赖 last_collect 的秒级边界
                _src, _items, w_cap = collect(dash, root)
                assert any("上限" in w for w in w_cap), \
                    "--max-count 命中上限应 WARN: " + str(w_cap)
            finally:
                globals()["GIT_MAX_COUNT"] = cap
    else:
        skips.append("git 限窗 / --max-count 用例（本机未找到 git）")

    print("SELF-TEST PASS: collect_facts（来源 %s%s）" % (
        source, "；SKIP %d 项：%s" % (len(skips), " / ".join(skips)) if skips else ""))
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
    ws = None
    if "--workspace" in argv:
        i = argv.index("--workspace")
        if i + 1 < len(argv):
            ws = Path(argv[i + 1])
    if ws is None:
        ws = find_workspace(dash)
    source, items, warnings = collect(dash, ws)
    for w in warnings:
        print("WARN: " + w)
    print(f"OK: 采集 {len(items)} 条变更事实（来源 {source}）")
    for it in items[:20]:
        print(f"  [{it['change']}] {it['path']}")
    if len(items) > 20:
        print(f"  … 其余 {len(items) - 20} 条见 .facts.json")
    print("下一步：逐条归置——写入时间线/功能证据，或在 .dashboard-ignore 标记为内部工程")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
