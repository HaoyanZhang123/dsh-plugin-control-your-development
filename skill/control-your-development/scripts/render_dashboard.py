#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""render_dashboard.py — 把 dev-dashboard 的三份 Markdown 渲染成单文件 HTML 仪表盘。

用法：
    python render_dashboard.py <dev-dashboard目录> [--workspace 根目录]
    python render_dashboard.py --self-test

退出码：0 = 全绿；2 = 有 blocker（证据路径失效 / 变更事实未归置），HTML 仍生成；
1 = 致命错误（目录或模板缺失）。零第三方依赖。
格式契约见 references/dashboard-format.md。
"""
import html as html_mod
import io
import json
import os
import re
import sys
import tempfile
from datetime import datetime
from pathlib import Path

STATUSES = ["设想", "进行中", "可用", "已验证", "已废弃"]
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
    """从 dashboard 父目录向上找 .git；找不到则以 dashboard 父目录为工作区。"""
    cur = dashboard_dir.resolve().parent
    for cand in [cur] + list(cur.parents):
        if (cand / ".git").exists():
            return cand
    return cur


def kind_of(path: str) -> str:
    name = Path(path).name.lower()
    ext = Path(path).suffix.lower()
    if "test" in name or name.startswith("spec"):
        return "测试"
    if ext in DOC_EXT:
        return "文档"
    if ext in CODE_EXT:
        return "代码"
    return "其他"

def _seg_match(s: str, p: str) -> bool:
    """单个路径段内的通配匹配（星号、问号），线性双指针，无正则回溯。"""
    si = pi = 0
    star, mark = -1, 0
    while si < len(s):
        if pi < len(p) and (p[pi] == "?" or p[pi] == s[si]):
            si += 1
            pi += 1
            continue
        if pi < len(p) and p[pi] == "*":
            star, pi = pi, pi + 1
            mark = si
            continue
        if star >= 0:
            pi = star + 1
            mark += 1
            si = mark
            continue
        return False
    while pi < len(p) and p[pi] == "*":
        pi += 1
    return pi == len(p)


def glob_match(path: str, pattern: str) -> bool:
    """最小 glob 语义（契约 v1.2，与共享核 JS 侧 globMatch 逐字同构）：
    双星号跨目录、单星号不跨目录、问号单字符、大小写敏感、不支持字符类。
    线性匹配（不用正则），因此没有灾难性回溯。"""
    ss = path.split("/")
    ps = pattern.split("/")
    i = j = 0
    star, mark = -1, 0
    while i < len(ss):
        if j < len(ps) and ps[j] == "**":
            star, j = j, j + 1
            mark = i
            continue
        if j < len(ps) and _seg_match(ss[i], ps[j]):
            i += 1
            j += 1
            continue
        if star >= 0:
            j = star + 1
            mark += 1
            i = mark
            continue
        return False
    while j < len(ps) and ps[j] == "**":
        j += 1
    return j == len(ps)

def css_selectors(css_text: str):
    """列出 CSS 里所有会作用到页面的选择器（跳过 @keyframes/@page 内部）。
    用途：面板会把这份样式注入 DSH 宿主页面，任何没有 .cyd-app 作用域的规则都会污染宿主 UI。"""
    sels = []

    def walk(text):
        i = 0
        while i < len(text):
            b = text.find("{", i)
            if b < 0:
                break
            prelude = text[i:b].strip()
            depth, j = 1, b + 1
            while j < len(text) and depth > 0:
                if text[j] == "{":
                    depth += 1
                elif text[j] == "}":
                    depth -= 1
                j += 1
            body = text[b + 1:j - 1]
            if re.match(r"^@(media|supports|layer)", prelude):
                walk(body)
            elif not prelude.startswith("@"):
                sels.append(re.sub(r"/\*[\s\S]*?\*/", "", prelude).strip())
            i = j

    walk(css_text)
    return sels


def evidence_path_error(rel: str):
    """证据路径越界校验（契约：一律相对工作区根）。合法返回 None，非法返回中文原因。"""
    if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://", rel):
        return "网址（证据必须是工作区内的文件）"
    if rel.startswith('/') or rel.startswith('\\'):
        return '绝对路径'
    if re.match(r'^[A-Za-z]:', rel):
        return '盘符绝对路径'
    if any(seg == '..' for seg in rel.replace('\\', '/').split('/')):
        return '上跳目录'
    return None


def strip_comments(text: str) -> str:
    return re.sub(r"<!--.*?-->", "", text, flags=re.S)


def split_evidence(raw: str):
    return [p.strip() for p in raw.split(",") if p.strip()]


def parse_product(text: str, warnings):
    text = strip_comments(text)
    proj = {"name": "未命名项目", "intro": "", "stage": "", "direction": "", "next": "", "journey": []}
    m = re.search(r"^#\s+(.+)$", text, re.M)
    if m:
        title = m.group(1).strip()
        proj["name"] = re.split(r"\s[—–-]{1,2}\s", title)[0].strip() or title
    sec = re.split(r"^##\s+", text, flags=re.M)
    for block in sec[1:]:
        lines = block.splitlines()
        head = lines[0].strip()
        body = [l.rstrip() for l in lines[1:]]
        if head.startswith("项目简介"):
            para = []
            for l in body:
                if l.strip().startswith("#"):
                    break
                para.append(l)
            proj["intro"] = "\n".join(para).strip()
        elif head.startswith("当前方向"):
            for l in body:
                mm = re.match(r"^-\s*(阶段|方向|下一步)\s*[:：]\s*(.+)$", l.strip())
                if mm:
                    proj[{"阶段": "stage", "方向": "direction", "下一步": "next"}[mm.group(1)]] = mm.group(2).strip()
        elif head.startswith("使用流程"):
            for l in body:
                mm = re.match(r"^\d+\.\s*(.+)$", l.strip())
                if not mm:
                    continue
                parts = [p.strip() for p in mm.group(1).split("::")]
                step = {"title": parts[0] if parts else "", "desc": "", "evidence": []}
                rest = parts[1:]
                for p in rest:
                    em = re.match(r"^证据\s*[:：]\s*(.+)$", p)
                    if em:
                        step["evidence"] = split_evidence(em.group(1))
                    elif not step["desc"]:
                        step["desc"] = p
                    else:
                        step["desc"] += " :: " + p
                proj["journey"].append(step)
    if not proj["intro"]:
        warnings.append("PRODUCT.md 缺少 ## 项目简介")
    return proj


def parse_features(text: str, warnings):
    text = strip_comments(text)
    feats = []
    cur = None
    for line in text.splitlines():
        s = line.strip()
        hm = re.match(r"^##\s*功能\s*[:：]\s*(.+)$", s)
        if hm:
            if cur:
                feats.append(cur)
            cur = {"name": hm.group(1).strip(), "status": "", "desc": "", "evidence": [],
                   "deps": [], "verify": ""}
            continue
        if cur is None:
            continue
        fm = re.match(r"^-\s*(状态|简介|证据|依赖|验证)\s*[:：]\s*(.*)$", s)
        if not fm:
            continue
        key, val = fm.group(1), fm.group(2).strip()
        if key == "状态":
            if val not in STATUSES:
                warnings.append(f"功能「{cur['name']}」状态非法: {val!r}（允许: {'/'.join(STATUSES)}）")
                cur["status"] = "设想"  # 与共享核一致：非法值直接降级，不再触发第二条"缺少状态字段"误报
            else:
                cur["status"] = val
        elif key == "简介":
            cur["desc"] = val
        elif key == "证据":
            cur["evidence"] = split_evidence(val)
        elif key == "依赖":
            cur["deps"] = [] if val in ("", "无") else split_evidence(val)
        elif key == "验证":
            cur["verify"] = val
    if cur:
        feats.append(cur)
    for f in feats:
        if not f["status"]:
            warnings.append(f"功能「{f['name']}」缺少状态字段")
            f["status"] = "设想"
        if not f["desc"]:
            warnings.append(f"功能「{f['name']}」缺少简介")
            f["desc"] = "[待确认: 功能简介]"
    return feats


def parse_now(text: str, warnings):
    text = strip_comments(text)
    timeline, decisions, todos = [], [], []
    section = None
    cur_dec = None
    for line in text.splitlines():
        s = line.strip()
        h2 = re.match(r"^##(?!#)\s*(.+)$", s)
        if h2:
            head = h2.group(1)
            section = "tl" if head.startswith("时间线") else "dec" if head.startswith("决策") else \
                      "todo" if head.startswith("待办") else None
            continue
        h3 = re.match(r"^###\s*(D\d+)\s+(.+)$", s)
        if section == "dec" and h3:
            cur_dec = {"id": h3.group(1), "title": h3.group(2).strip(), "decided": "", "options": [],
                       "multi": False}
            decisions.append(cur_dec)
            continue
        if section == "tl":
            tm = re.match(r"^-\s*(.+)$", s)
            if tm:
                parts = [p.strip() for p in tm.group(1).split("|")]
                entry = {"dt": parts[0], "text": "", "evidence": []}
                for p in parts[1:]:
                    em = re.match(r"^证据\s*[:：]\s*(.+)$", p)
                    if em:
                        entry["evidence"] = split_evidence(em.group(1))
                    else:
                        entry["text"] = (entry["text"] + " | " + p).strip(" |") if entry["text"] else p
                if not entry["text"]:
                    entry["text"] = entry["dt"]
                    entry["dt"] = ""
                timeline.append(entry)
        elif section == "dec" and cur_dec is not None:
            sm = re.match(r"^-\s*状态\s*[:：]\s*已定\s*([A-Z](?:\s*[、,]\s*[A-Z])*)\s*$", s)
            if sm:
                cur_dec["decided"] = re.sub(r"[\s,]+", "、", sm.group(1))
                continue
            mm = re.match(r"^-\s*多选\s*[:：]\s*是\s*$", s)
            if mm:
                cur_dec["multi"] = True
                continue
            om = re.match(r"^-\s*([A-Z])\s*[:：]\s*(.+)$", s)
            if om:
                cur_dec["options"].append({"key": om.group(1), "text": om.group(2).strip()})
        elif section == "todo":
            dm = re.match(r"^-\s*\[( |x|X)\]\s*(.+)$", s)
            if dm:
                todos.append({"done": dm.group(1).lower() == "x", "text": dm.group(2).strip()})
    for d in decisions:
        for k in [x for x in (d.get("decided") or "").split("、") if x]:
            if not any(o["key"] == k for o in d["options"]):
                warnings.append(f"决策 {d['id']} 标为已定 {k}，但没有对应选项")
    return timeline, decisions, todos


def layout_graph(feats, warnings):
    """分层拓扑布局（迭代实现：深依赖链不再触发递归爆栈）。"""
    active = [f for f in feats if f["status"] != "已废弃"]
    by_name = {}
    for f in active:
        if f["name"] in by_name:
            warnings.append(f"功能名重复：「{f['name']}」出现多次，依赖按首个同名解析")
        else:
            by_name[f["name"]] = f
    index_of = {id(f): i for i, f in enumerate(active)}
    edges = [[index_of[id(by_name[d])] for d in f["deps"] if d in by_name] for f in active]

    resolved = {}
    remaining = set(range(len(active)))
    changed = True
    while remaining and changed:
        changed = False
        for i in sorted(remaining):
            if all(d in resolved for d in edges[i]):
                resolved[i] = max((resolved[d] + 1 for d in edges[i]), default=0)
                remaining.discard(i)
                changed = True
    for i in sorted(remaining):
        warnings.append(f"依赖关系存在环（涉及「{active[i]['name']}」），该节点按第 0 层布局")
        resolved[i] = 0

    per_layer = {}
    for i, f in enumerate(active):
        lv = resolved.get(i, 0)
        idx = per_layer.get(lv, 0)
        per_layer[lv] = idx + 1
        f["x"] = 110 + lv * 235
        f["y"] = 75 + idx * 88
    return feats


def audit(evidence_paths, workspace, facts_path, ignore_path):
    """返回 (matrix, missing, invalid, facts_pending, facts_detail, patterns)。
    missing/invalid/pending 非空即 blocker；同路径只 stat 一次、只记一次。"""
    matrix, missing, invalid = [], [], []
    seen, exists_cache = {}, {}
    for owner, path in evidence_paths:
        rel = path.replace('\\', '/')
        if evidence_path_error(rel):
            if rel not in seen:
                seen[rel] = {"path": rel, "owners": [], "kind": kind_of(rel), "exists": False}
                invalid.append(rel)
            if owner not in seen[rel]["owners"]:
                seen[rel]["owners"].append(owner)
            continue
        rel = rel.lstrip('/')
        if rel not in exists_cache:
            exists_cache[rel] = (workspace / rel).is_file()
        exists = exists_cache[rel]
        if not exists and rel not in missing:
            missing.append(rel)
        if rel in seen:
            if owner not in seen[rel]["owners"]:
                seen[rel]["owners"].append(owner)
        else:
            seen[rel] = {"path": rel, "owners": [owner], "kind": kind_of(rel), "exists": exists}
    matrix = sorted(seen.values(), key=lambda r: r["path"])

    patterns = []
    if ignore_path.is_file():
        patterns = [l.strip() for l in ignore_path.read_text(encoding="utf-8").splitlines()
                    if l.strip() and not l.strip().startswith("#")]
    pending = 0
    facts_detail = []
    if facts_path.is_file():
        try:
            facts = json.loads(facts_path.read_text(encoding="utf-8"))
            ev_set = {p.replace('\\', '/').lstrip('/') for _, p in evidence_paths}
            for item in facts.get("items", []):
                p = (item.get("path") or "").replace('\\', '/')
                hit = p in ev_set or any(glob_match(p, pat) for pat in patterns)
                if not hit:
                    pending += 1
                facts_detail.append({"path": p, "kind": item.get("kind", ""),
                                     "change": item.get("change", ""), "pending": not hit})
        except Exception:
            pending = -1  # 文件损坏视为不可审计
    return matrix, missing, invalid, pending, facts_detail, patterns
def render(dashboard: Path, workspace: Path):
    dash = dashboard.resolve()
    ws = workspace.resolve()
    warnings, blockers = [], []
    template_path = Path(__file__).resolve().parent.parent / "templates" / "dashboard.html"
    if not template_path.is_file():
        print("FATAL: 模板缺失 " + str(template_path))
        return 1
    for req in ("PRODUCT.md", "FEATURES.md", "NOW.md"):
        if not (dash / req).is_file():
            print(f"FATAL: 缺少 {req}（先用模板初始化 dev-dashboard）")
            return 1

    # utf-8-sig：容忍 Windows 编辑器写出的 BOM，普通 UTF-8 不受影响
    proj = parse_product((dash / "PRODUCT.md").read_text(encoding="utf-8-sig"), warnings)
    feats = parse_features((dash / "FEATURES.md").read_text(encoding="utf-8-sig"), warnings)
    timeline, decisions, todos = parse_now((dash / "NOW.md").read_text(encoding="utf-8-sig"), warnings)
    feats = layout_graph(feats, warnings)

    evidence_pairs = []
    for f in feats:
        evidence_pairs += [(f["name"], p) for p in f["evidence"]]
    for j in proj["journey"]:
        evidence_pairs += [("使用流程", p) for p in j["evidence"]]
    for t in timeline:
        evidence_pairs += [("时间线", p) for p in t["evidence"]]

    matrix, missing, invalid, pending, facts_detail, ignore_patterns = audit(
        evidence_pairs, ws, dash / ".facts.json", dash / ".dashboard-ignore")
    if invalid:
        blockers.append(f"{len(invalid)} 条证据路径越界（必须相对工作区根、禁止绝对路径与上跳）: " + ", ".join(invalid[:5]))
    if missing:
        blockers.append(f"{len(missing)} 条证据路径不存在: " + ", ".join(missing[:5]))
    no_verify = [f["name"] for f in feats if f["status"] == "已验证" and not f["verify"]]
    if no_verify:
        blockers.append(f"{len(no_verify)} 个功能标为「已验证」但缺少验证记录: " + ", ".join(no_verify[:5]))
    facts_error = "corrupt" if pending == -1 else ("" if (dash / ".facts.json").is_file() else "missing")
    facts_source = ""
    if (dash / ".facts.json").is_file():
        try:
            facts_source = (json.loads((dash / ".facts.json").read_text(encoding="utf-8")) or {}).get("source", "")
        except Exception:
            facts_source = ""
    if pending == -1:
        blockers.append(".facts.json 损坏，无法审计覆盖性")
    elif pending > 0:
        blockers.append(f"{pending} 条变更事实未归置（收录进时间线/功能证据，或写入 .dashboard-ignore）")
    def ev_objs(paths):
        """与 audit 同口径：先规范化，越界路径一律视为不存在（避免"徽章缺失/矩阵存在"自相矛盾）。"""
        out = []
        for p in paths:
            rel = p.replace('\\', '/')
            if evidence_path_error(rel):
                out.append({"path": rel, "exists": False})
            else:
                rel = rel.lstrip('/')
                out.append({"path": rel, "exists": (ws / rel).is_file()})
        return out

    counts = {s: 0 for s in STATUSES}
    for f in feats:
        counts[f["status"]] = counts.get(f["status"], 0) + 1
    counts["total_active"] = sum(counts[s] for s in STATUSES if s != "已废弃")

    data = {
        "project": {
            "name": proj["name"], "intro": proj["intro"], "stage": proj["stage"],
            "direction": proj["direction"], "next": proj["next"],
            "journey": [{**j, "evidence": ev_objs(j["evidence"])} for j in proj["journey"]],
        },
        "workspace_uri": ws.as_uri(),
        "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "features": [{**f, "evidence": ev_objs(f["evidence"])} for f in feats],
        "counts": counts,
        "timeline": [{**t, "evidence": ev_objs(t["evidence"])} for t in timeline],
        "decisions": decisions,
        "todos": todos,
        "health": {"ok": not blockers, "matrix": matrix,
                   "evidence_missing": missing, "evidence_invalid": invalid,
                   "facts_pending": max(pending, 0), "facts_error": facts_error, "source": facts_source,
                   "verify_missing": no_verify,
                   "facts": facts_detail, "ignore": ignore_patterns, "warnings": warnings},
    }

    parts = {}
    for name in ("dashboard.core.js", "dashboard.web.js", "dashboard.core.css", "dashboard.shell.html"):
        p = template_path.parent / name
        if not p.is_file():
            print("FATAL: 模板部件缺失 " + str(p))
            return 1
        parts[name] = p.read_text(encoding="utf-8")
    tpl = template_path.read_text(encoding="utf-8")
    core = parts["dashboard.core.js"]
    core = core.replace("/*__CYD_CSS__*/''", json.dumps(parts["dashboard.core.css"], ensure_ascii=False), 1)
    core = core.replace("/*__CYD_SHELL__*/''", json.dumps(parts["dashboard.shell.html"], ensure_ascii=False), 1)
    web = parts["dashboard.web.js"]
    # 内联脚本防护：< 一律转义（覆盖 </script> 截断与 <!-- 分词器逃逸），另挡 U+2028/29 换行
    payload = (json.dumps(data, ensure_ascii=False)
               .replace("<", "\\u003c")
               .replace("\u2028", "\\u2028")
               .replace("\u2029", "\\u2029"))
    html = tpl.replace("/*__CYD_CORE__*/", core, 1).replace("/*__CYD_WEB__*/", web, 1)
    html = html.replace("/*__DATA__*/null", "/*__DATA__*/" + payload, 1)
    html = html.replace("__TITLE__", html_mod.escape(proj["name"], quote=True))
    out = dash / "index.html"
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(html)

    for w in warnings:
        print("WARN: " + w)
    for b in blockers:
        print("BLOCKER: " + b)
    print(f"OK: 已渲染 {out.name}（功能 {len(feats)} · 时间线 {len(timeline)} 条 · "
          f"待拍板 {sum(1 for d in decisions if not d['decided'])} 件）")
    return 2 if blockers else 0


def self_test():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        dash = root / "dev-dashboard"
        dash.mkdir()
        (root / "src").mkdir()
        (root / "src" / "app.js").write_text("// demo", encoding="utf-8")
        (dash / "PRODUCT.md").write_text(
            "# 演示项目 —— 自检用\n\n## 项目简介\n这是一个自检项目。\n\n"
            "## 当前方向\n- 阶段: 自检中\n- 方向: 验证渲染器\n- 下一步: 发布\n\n"
            "## 使用流程\n1. 打开 :: 双击即可 :: 证据: src/app.js\n", encoding="utf-8")
        (dash / "FEATURES.md").write_text(
            "# 功能地图\n\n## 功能: 核心功能\n- 状态: 进行中\n- 简介: 自检功能。\n"
            "- 证据: src/app.js\n\n## 功能: 扩展功能\n- 状态: 设想\n- 简介: 依赖核心。\n"
            "- 依赖: 核心功能\n", encoding="utf-8")
        (dash / "NOW.md").write_text(
            "# 现在\n\n## 时间线\n- 2026-01-01 09:00 | 自检开始 | 证据: src/app.js\n\n"
            "## 决策\n### D1 自检决策？\n- 状态: 待拍板\n- 多选: 是\n- A: 通过\n- B: 不通过\n\n"
            "## 待办\n- [ ] 完成自检\n", encoding="utf-8")
        code = render(dash, root)
        assert code == 0, f"期望退出码 0，实际 {code}"
        html = (dash / "index.html").read_text(encoding="utf-8")
        for marker in ("演示项目", "核心功能", "扩展功能", "自检决策", "src/app.js", "🌓",
                       "\"multi\": true", "workspace_uri"):
            assert marker in html, f"产物缺少标记: {marker}"
        # blocker 路径：证据失效 + 事实未归置 → 退出码 2
        (dash / "FEATURES.md").write_text(
            "# 功能地图\n\n## 功能: 坏证据\n- 状态: 可用\n- 简介: 指向不存在文件。\n"
            "- 证据: src/ghost.js\n", encoding="utf-8")
        (dash / ".facts.json").write_text(
            json.dumps({"generated_at": "2026-01-01T00:00:00",
                        "items": [{"path": "src/new.js", "kind": "code", "change": "added"}]},
                       ensure_ascii=False), encoding="utf-8")
        code2 = render(dash, root)
        assert code2 == 2, f"期望退出码 2，实际 {code2}"
        (dash / ".dashboard-ignore").write_text("src/new.js\n", encoding="utf-8")
        code3 = render(dash, root)
        assert code3 == 2, "证据失效仍应为 blocker"
        # 注入防护：数据中的 < 必须转义（覆盖 </script> 截断与 <!-- 逃逸）；标题同理
        (dash / "FEATURES.md").write_text(
            "# 功能地图\n\n## 功能: 注入</script>测试\n- 状态: 可用\n- 简介: 指向不存在文件。\n"
            "- 证据: src/ghost.js\n", encoding="utf-8")
        (dash / "PRODUCT.md").write_text(
            "# 注入</title><script>alert(1)</script>项目\n\n## 项目简介\n看标题转义。\n", encoding="utf-8")
        render(dash, root)
        html4 = (dash / "index.html").read_text(encoding="utf-8")
        assert "注入\\u003c/script>测试" in html4, "数据中的 < 未被转义"
        assert "<title>注入&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;项目" in html4, "标题未转义"
        # 契约红线：已验证必须有验证记录；证据路径不得越界
        (dash / "PRODUCT.md").write_text("# 演示项目 —— 自检用\n\n## 项目简介\n回退。\n", encoding="utf-8")
        (dash / "FEATURES.md").write_text(
            "# 功能地图\n\n## 功能: 缺验证\n- 状态: 已验证\n- 简介: 没有验证行。\n"
            "- 证据: src/app.js\n", encoding="utf-8")
        assert render(dash, root) == 2, "已验证缺验证记录应为 blocker"
        (dash / "FEATURES.md").write_text(
            "# 功能地图\n\n## 功能: 越界证据\n- 状态: 可用\n- 简介: 上跳。\n"
            "- 证据: ../outside.txt\n", encoding="utf-8")  # lint:allow-crossref 自检夹具，刻意构造越界路径
        assert render(dash, root) == 2, "证据路径越界应为 blocker"
        # CSS 作用域红线：这份样式会被面板注入宿主页面，未作用域的规则会改坏 DSH 自己的界面
        css_text = (Path(__file__).resolve().parent.parent / "templates" / "dashboard.core.css").read_text(encoding="utf-8")
        scoped_bad = [s for s in css_selectors(css_text)
                      if any((not p.strip().startswith(".cyd-app")) and (not re.match(r"^(from|to|\d+%)$", p.strip()))
                             for p in s.split(",") if p.strip())]
        assert not scoped_bad, "CSS 存在未作用域选择器（会污染宿主页面）: " + str(scoped_bad[:5])
        print("SELF-TEST PASS: render_dashboard")
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
    return render(dash, ws)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
