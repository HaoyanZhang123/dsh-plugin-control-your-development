#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""collect_facts.py — 采集工作区自上次采集以来的全部变更事实，写入 dev-dashboard/.facts.json。

用法：
    python collect_facts.py <dev-dashboard目录> [--workspace 根目录]
    python collect_facts.py --self-test

行为：有 git 用 git（已提交 + 未提交）；无 git 退化为按文件修改时间扫描。
排除 dev-dashboard/ 自身与常见噪声目录。退出码：0 正常；1 致命错误。
"""
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from render_dashboard import glob_match  # noqa: E402  与渲染器共用同一套 glob 语义

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
    """返回 (ok, items)。items: [{path, kind, change}]"""
    seen = {}
    ok, out = _git(ws, ["log", "--since=" + since_iso, "--name-status",
                        "--pretty=format:--COMMIT--"])
    if not ok:
        return False, []
    for line in out.splitlines():
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
    return True, items


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

def load_state(dash: Path):
    sp = dash / ".state.json"
    if sp.is_file():
        try:
            return json.loads(sp.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def collect(dash: Path, ws: Path, now=None):
    """采集并写盘。返回 (source, items, warnings)。

    要点：.facts.json 写的是「累计未归置集合」——已写入但未被引用/忽略的项会跨轮次保留，
    因此「连跑两次采集再渲染」无法把覆盖性门禁洗掉。"""
    global _GIT_ERROR
    _GIT_ERROR = ""
    now = now or datetime.now(timezone.utc)
    state = load_state(dash)
    since_iso = state.get("last_collect", "1970-01-01T00:00:00+00:00")
    dash_rel = dash.resolve().relative_to(ws.resolve()).as_posix() + "/" \
        if ws.resolve() in dash.resolve().parents else "dev-dashboard/"
    warnings = []
    try:
        since_ts = datetime.fromisoformat(since_iso).timestamp()
    except Exception:
        since_ts = 0.0

    ok_git, _ = _git(ws, ["rev-parse", "--is-inside-work-tree"])
    cur_files = None
    if ok_git:
        used, items = collect_git(ws, dash_rel, since_iso)
        source = "git"
        if not used:
            warnings.append("git 采集失败（" + (_GIT_ERROR or "未知原因") + "），已降级为按文件时间扫描")
            source = "mtime(git 不可用兜底)"
            items, cur_files = collect_mtime(ws, dash, since_ts)
    else:
        if _GIT_ERROR:
            warnings.append("git 不可用（" + _GIT_ERROR + "），按文件时间扫描")
        source = "mtime(非 git 项目)"
        items, cur_files = collect_mtime(ws, dash, since_ts)

    if cur_files is not None:
        prev_files = state.get("files") or []
        for p in sorted(set(prev_files) - set(cur_files)):
            items.append({"path": p, "kind": kind_of(p), "change": "deleted"})
        state["files"] = cur_files

    ignore = _load_ignore(dash)
    merged = {it["path"]: it for it in state.get("pending_items", [])
              if isinstance(it, dict) and it.get("path")}
    for it in items:
        merged[it["path"]] = it
    pending_items = [it for p, it in sorted(merged.items())
                     if not any(glob_match(p, pat) for pat in ignore)]

    (dash / ".facts.json").write_text(json.dumps(
        {"generated_at": now.isoformat(timespec="seconds"), "source": source, "items": pending_items},
        ensure_ascii=False, indent=1), encoding="utf-8")
    state["last_collect"] = now.isoformat()
    state["pending_items"] = pending_items
    (dash / ".state.json").write_text(json.dumps(state, ensure_ascii=False, indent=1),
                                      encoding="utf-8")
    return source, items, warnings

def self_test():
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
        print(f"SELF-TEST PASS: collect_facts（来源 {source}）")
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
