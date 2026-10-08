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
    cur = None        # 当前功能
    cur_child = None  # 当前子项（v1.3）
    for line in text.splitlines():
        s = line.strip()
        hm = re.match(r"^##\s*功能\s*[:：]\s*(.+)$", s)
        if hm:
            if cur:
                feats.append(cur)
            cur = {"name": hm.group(1).strip(), "status": "", "desc": "", "evidence": [],
                   "deps": [], "verify": "", "children": []}
            cur_child = None
            continue
        cm = re.match(r"^###\s*子项\s*[:：]\s*(.+)$", s)
        if cm:
            if cur is None:
                warnings.append(f"子项「{cm.group(1).strip()}」出现在任何功能之前，已忽略")
                continue
            cur_child = {"name": cm.group(1).strip(), "status": "", "desc": "",
                         "evidence": [], "verify": ""}
            cur["children"].append(cur_child)
            continue
        target = cur_child if cur_child is not None else cur
        if target is None:
            continue
        fm = re.match(r"^-\s*(状态|简介|证据|依赖|验证)\s*[:：]\s*(.*)$", s)
        if not fm:
            continue
        key, val = fm.group(1), fm.group(2).strip()
        if key == "依赖":
            if cur_child is not None:
                warnings.append(f"子项「{cur_child['name']}」（功能「{cur['name']}」）不允许写依赖，已忽略")
                continue
            target["deps"] = [] if val in ("", "无") else split_evidence(val)
        elif key == "状态":
            if val not in STATUSES:
                warnings.append(f"「{target['name']}」状态非法: {val!r}（允许: {'/'.join(STATUSES)}）")
                target["status"] = "设想"  # 与共享核一致：非法值直接降级，不再触发第二条"缺少状态字段"误报
            else:
                target["status"] = val
        elif key == "简介":
            target["desc"] = val
        elif key == "证据":
            target["evidence"] = split_evidence(val)
        elif key == "验证":
            target["verify"] = val
    if cur:
        feats.append(cur)

    def _check(item, label, miss_desc):
        if not item["status"]:
            warnings.append(f"{label}缺少状态字段")
            item["status"] = "设想"
        if not item["desc"]:
            warnings.append(f"{label}缺少简介")
            item["desc"] = miss_desc

    for f in feats:
        _check(f, f"功能「{f['name']}」", "[待确认: 功能简介]")
        seen_child = set()
        for c in f["children"]:
            _check(c, f"功能「{f['name']}」的子项「{c['name']}」", "[待确认: 子项简介]")
            if c["name"] in seen_child:
                warnings.append(f"功能「{f['name']}」内子项重名：「{c['name']}」，按首个解析")
            seen_child.add(c["name"])
    return feats


def parse_glossary(text: str, warnings):
    """解析 GLOSSARY.md 的第一张表格 → [{term, meaning, aliases}]。文件无表格 → WARN 并按空表处理。"""
    text = strip_comments(text)
    entries = []
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if not line.strip().startswith("|"):
            continue
        header = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(header) < 3 or header[0] != "标准用词":
            warnings.append("GLOSSARY.md 第一张表的表头不是「标准用词 | 指什么 | 别名/曾用名」，按无术语表处理")
            return entries
        j = i + 1
        if j < len(lines) and re.match(r"^\s*\|[|\-:\s]+\|\s*$", lines[j]):
            j += 1  # 跳过分隔行（有无均可）
        while j < len(lines) and lines[j].strip().startswith("|"):
            cells = [c.strip() for c in lines[j].strip().strip("|").split("|")]
            if len(cells) < 2 or not cells[0]:
                warnings.append("GLOSSARY.md 有一行列数不足或标准用词为空，已忽略该行")
            else:
                aliases = [a for a in re.split(r"[、，,/]", cells[2] if len(cells) > 2 else "") if a]
                entries.append({"term": cells[0], "meaning": cells[1], "aliases": aliases})
            j += 1
        return entries
    warnings.append("GLOSSARY.md 里没有表格，按无术语表处理")
    return entries


def glossary_drift(entries, texts):
    """用词漂移检查：别名字面出现在正文（PRODUCT/FEATURES/NOW，已剥注释）即记一条。
    texts: [(文件名, 正文)]。同一（别名, 文件）只报一次。"""
    drift = []
    for e in entries:
        for alias in e["aliases"]:
            if not alias or alias == e["term"]:
                continue
            for fname, body in texts:
                n = body.count(alias)
                if n:
                    drift.append({"alias": alias, "term": e["term"], "file": fname, "count": n})
    return drift


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
            sm = re.match(r"^-\s*状态\s*[:：]\s*已定\s*([A-Za-z](?:\s*[、,，\s]\s*[A-Za-z])*)\s*$", s)
            if sm:
                cur_dec["decided"] = re.sub(r"[\s,，]+", "、", sm.group(1).upper())
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


def text_width(s: str) -> int:
    """确定性文本宽度（与共享核 JS 逐字同构）：>U+2E00 按宽字符 14px，其余 8px。
    不用字体度量——布局坐标要写进数据，两端必须算出完全一致的值。"""
    return sum(14 if ord(c) > 0x2E00 else 8 for c in str(s))


NODE_PAD, NODE_MIN_W, NODE_MAX_W = 46, 150, 280
NODE_TEXT_MAX = NODE_MAX_W - NODE_PAD


def wrap_name(name: str):
    """名称折行：最多 2 行，第二行放不下就 … 省略（悬浮 title 见全文）。确定性，与 JS 同构。"""
    name = str(name)
    if text_width(name) <= NODE_TEXT_MAX:
        return [name]
    i, w = 0, 0
    while i < len(name) and w + (14 if ord(name[i]) > 0x2E00 else 8) <= NODE_TEXT_MAX:
        w += 14 if ord(name[i]) > 0x2E00 else 8
        i += 1
    l1, rest = name[:i], name[i:]
    if text_width(rest) <= NODE_TEXT_MAX:
        return [l1, rest]
    j, w2 = 0, 0
    limit = NODE_TEXT_MAX - 14  # 给 … 留位
    while j < len(rest) and w2 + (14 if ord(rest[j]) > 0x2E00 else 8) <= limit:
        w2 += 14 if ord(rest[j]) > 0x2E00 else 8
        j += 1
    return [l1, rest[:j] + "…"]


def node_dims(name: str):
    lines = wrap_name(name)
    w = max(NODE_MIN_W, min(NODE_MAX_W, text_width(name) + NODE_PAD))
    return w, (58 if len(lines) > 1 else 42), lines


def layout_graph(feats, warnings):
    """分层拓扑布局（迭代实现：深依赖链不再触发递归爆栈）。
    v1.3：节点宽度按名称自适应（两端同一份确定性字宽算法），层间距按相邻层实际最大宽度算。"""
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

    for f in active:
        f["w"], f["h"], f["lines"] = node_dims(f["name"])
    layer_max_w = {}
    for i, f in enumerate(active):
        lv = resolved.get(i, 0)
        layer_max_w[lv] = max(layer_max_w.get(lv, 0), f["w"])
    layer_x = {}
    prev = None
    for lv in sorted(layer_max_w):
        if prev is None:
            layer_x[lv] = 90 + layer_max_w[lv] / 2
        else:
            layer_x[lv] = layer_x[prev] + layer_max_w[prev] / 2 + layer_max_w[lv] / 2 + 64
        prev = lv
    layer_y = {}
    for i, f in enumerate(active):
        lv = resolved.get(i, 0)
        y0 = layer_y.get(lv, 80)
        f["x"], f["y"] = layer_x[lv], y0 + f["h"] / 2
        layer_y[lv] = y0 + f["h"] + 30
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
def render(dashboard: Path, workspace: Path, write_html=None):
    """渲染（审计）dev-dashboard。write_html：True=强制写 index.html；False=不写；
    None=自动（仅当 index.html 已存在时更新它，不主动生成）——v1.3 起网页版是可选导出。"""
    dash = dashboard.resolve()
    ws = workspace.resolve()
    warnings, blockers = [], []
    for req in ("PRODUCT.md", "FEATURES.md", "NOW.md"):
        if not (dash / req).is_file():
            print(f"FATAL: 缺少 {req}（先用模板初始化 dev-dashboard）")
            return 1

    # utf-8-sig：容忍 Windows 编辑器写出的 BOM，普通 UTF-8 不受影响
    prod_text = (dash / "PRODUCT.md").read_text(encoding="utf-8-sig")
    feat_text = (dash / "FEATURES.md").read_text(encoding="utf-8-sig")
    now_text = (dash / "NOW.md").read_text(encoding="utf-8-sig")
    proj = parse_product(prod_text, warnings)
    feats = parse_features(feat_text, warnings)
    timeline, decisions, todos = parse_now(now_text, warnings)
    feats = layout_graph(feats, warnings)

    # 术语表（可选）与用词漂移检查（v1.3）
    glossary = []
    drift = []
    if (dash / "GLOSSARY.md").is_file():
        glossary = parse_glossary((dash / "GLOSSARY.md").read_text(encoding="utf-8-sig"), warnings)
        drift = glossary_drift(glossary, [
            ("PRODUCT.md", strip_comments(prod_text)),
            ("FEATURES.md", strip_comments(feat_text)),
            ("NOW.md", strip_comments(now_text))])
        for d in drift:
            warnings.append(f"用词漂移：别名「{d['alias']}」在 {d['file']} 出现 {d['count']} 次，"
                            f"标准用词是「{d['term']}」")

    evidence_pairs = []
    for f in feats:
        evidence_pairs += [(f["name"], p) for p in f["evidence"]]
        for c in f["children"]:
            evidence_pairs += [(f["name"] + " / " + c["name"], p) for p in c["evidence"]]
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
    no_verify += [f"{f['name']} 的子项 {c['name']}" for f in feats for c in f["children"]
                  if c["status"] == "已验证" and not c["verify"]]
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
        "features": [{**f, "evidence": ev_objs(f["evidence"]),
                      "children": [{**c, "evidence": ev_objs(c["evidence"])} for c in f["children"]]}
                     for f in feats],
        "counts": counts,
        "glossary": glossary,
        "timeline": [{**t, "evidence": ev_objs(t["evidence"])} for t in timeline],
        "decisions": decisions,
        "todos": todos,
        "health": {"ok": not blockers, "matrix": matrix,
                   "evidence_missing": missing, "evidence_invalid": invalid,
                   "facts_pending": max(pending, 0), "facts_error": facts_error, "source": facts_source,
                   "verify_missing": no_verify,
                   "glossary_drift": drift,
                   "facts": facts_detail, "ignore": ignore_patterns, "warnings": warnings},
    }

    # index.html 写出规则（v1.3）：--html 强制；--no-html 不写；默认仅在该文件已存在时更新
    do_write = (dash / "index.html").is_file() if write_html is None else write_html
    if not do_write:
        for w in warnings:
            print("WARN: " + w)
        for b in blockers:
            print("BLOCKER: " + b)
        print(f"OK: 审计完成（功能 {len(feats)} · 时间线 {len(timeline)} 条 · "
              f"待拍板 {sum(1 for d in decisions if not d['decided'])} 件；未生成 index.html，需要导出加 --html）")
        return 2 if blockers else 0

    template_path = Path(__file__).resolve().parent.parent / "templates" / "dashboard.html"
    if not template_path.is_file():
        print("FATAL: 模板缺失 " + str(template_path))
        return 1
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
            "- 证据: src/app.js\n"
            "### 子项: 汇总\n- 状态: 已验证\n- 简介: 子项自检。\n- 证据: src/app.js\n"
            "- 验证: 自检 2026-01-01\n"
            "### 子项: 展示\n- 状态: 进行中\n- 简介: 子项自检二。\n\n"
            "## 功能: 扩展功能\n- 状态: 设想\n- 简介: 依赖核心。\n"
            "- 依赖: 核心功能\n", encoding="utf-8")
        (dash / "NOW.md").write_text(
            "# 现在\n\n## 时间线\n- 2026-01-01 09:00 | 自检开始 | 证据: src/app.js\n\n"
            "## 决策\n### D1 自检决策？\n- 状态: 待拍板\n- 多选: 是\n- A: 通过\n- B: 不通过\n\n"
            "## 待办\n- [ ] 完成自检\n", encoding="utf-8")
        (dash / "GLOSSARY.md").write_text(
            "# 术语表\n\n| 标准用词 | 指什么 | 别名/曾用名 |\n| --- | --- | --- |\n"
            "| 仪表盘 | 自检术语 | 看板 |\n", encoding="utf-8")
        code = render(dash, root)
        assert code == 0, f"期望退出码 0，实际 {code}"
        assert not (dash / "index.html").is_file(), "v1.3：index.html 默认不生成（可选导出）"
        code = render(dash, root, write_html=True)
        assert code == 0 and (dash / "index.html").is_file(), "--html 应强制生成 index.html"
        html = (dash / "index.html").read_text(encoding="utf-8")
        for marker in ("演示项目", "核心功能", "扩展功能", "自检决策", "src/app.js", "🌓",
                       "\"multi\": true", "workspace_uri",
                       "子项", "汇总", '"glossary"', "仪表盘"):
            assert marker in html, f"产物缺少标记: {marker}"
        # 用词漂移：别名「看板」写进 NOW.md 正文 → 进 warnings（不阻断）
        (dash / "NOW.md").write_text(
            "# 现在\n\n## 时间线\n- 2026-01-01 09:10 | 看板更新完毕\n", encoding="utf-8")
        assert render(dash, root) == 0
        html_g = (dash / "index.html").read_text(encoding="utf-8")  # 已存在 → 默认一并更新
        assert "用词漂移" in html_g and "看板" in html_g, "漂移提示未进产物"
        (dash / "NOW.md").write_text(
            "# 现在\n\n## 时间线\n- 2026-01-01 09:00 | 自检开始 | 证据: src/app.js\n\n"
            "## 决策\n### D1 自检决策？\n- 状态: 待拍板\n- 多选: 是\n- A: 通过\n- B: 不通过\n\n"
            "## 待办\n- [ ] 完成自检\n", encoding="utf-8")
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
            "# 功能地图\n\n## 功能: 带子项\n- 状态: 进行中\n- 简介: 有子项。\n"
            "- 证据: src/app.js\n### 子项: 缺验证\n- 状态: 已验证\n- 简介: 子项没验证行。\n", encoding="utf-8")
        assert render(dash, root) == 2, "子项已验证缺验证记录应为 blocker"
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
    write_html = True if "--html" in argv else (False if "--no-html" in argv else None)
    return render(dash, ws, write_html=write_html)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
