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
import hashlib
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
    """最小 glob 语义（契约 v1.2；v1.7 起**只有这一份实现**——共享核的 globMatch 已随 JS 解析删除）：
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

def split_selector_list(s: str):
    """按**顶层**逗号切一个选择器列表。

    为什么不能裸 `s.split(",")`：`:not(:has([data-approval-key],[data-question-key]))` 里的逗号是
    **函数实参**，裸切会把**一个**选择器切成三段，后两段既不以 `.cyd-app` 开头、也没有锚 ⇒ 假红。
    括号/中括号/引号里面一律不算分隔符。
    """
    out, depth, cur, quote = [], 0, "", None
    for ch in s:
        if quote:
            cur += ch
            if ch == quote:
                quote = None
            continue
        if ch in "\"'":
            quote = ch
            cur += ch
        elif ch in "([":
            depth += 1
            cur += ch
        elif ch in ")]":
            depth = max(0, depth - 1)
            cur += ch
        elif ch == "," and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return out


def css_unscoped(css_text: str):
    """列出**未作用域**的选择器（面板会把这份样式注入 DSH 宿主页面，未作用域的规则会改坏宿主 UI）。

    作用域判据（三种都算已作用域）：
      ① 以 `.cyd-app` 开头 —— 我们自己的根；
      ② `@keyframes` 的步进（`from`/`to`/`N%`）；
      ③ **以 `.cyd-immersive` 为锚**的宿主侧规则（选择器里含 `:has(.cyd-immersive)`）——
         它只在**我们整页根存在时**才可能命中，语义上已经作用域化；这类规则必须选择宿主元素
         （如隐藏宿主输入框座席），天然不可能以 `.cyd-app` 开头。2026-10-13 队长批准。
    """
    def kept(part):
        p = part.strip()
        if not p:
            return True
        return (p.startswith(".cyd-app") or re.match(r"^(from|to|\d+%)$", p)
                or ":has(.cyd-immersive)" in p)

    return [s for s in css_selectors(css_text)
            if any(not kept(p) for p in split_selector_list(s))]


def css_selectors(css_text: str):
    """列出 CSS 里所有会作用到页面的选择器（跳过 @keyframes/@page 内部）。

    **先剥注释、再走规则**（顺序不能反）：注释不是选择器；而且注释里若出现 `{`（本项目真发生过：
    注释里逐字引用了 dsh-context 的 CSS 片段，含 `{display:none}`），`walk` 会把那个 `{` 当成规则开头，
    于是**整段注释文字被当成选择器** ⇒ 假红。先剥掉注释，这种 `{` 就没了。
    """
    css_text = re.sub(r"/\*[\s\S]*?\*/", "", css_text)      # 注释先出局（含注释里的 `{`）
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
                sels.append(prelude)
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


def read_prev_tech(dash: Path):
    """`.versions/` 里最近一份 `TECH.md` 快照（批 4 的"写前快照"就是"上一轮"的权威副本）。
    没有快照 / 读不出 → `None`：漂移 WARN 走 **fail-closed**（不产，不用"本轮证据为空"近似）。"""
    idx = dash / ".versions" / "index.json"
    if not idx.is_file():
        return None
    try:
        data = json.loads(idx.read_text(encoding="utf-8"))
    except Exception:
        return None
    vers = data.get("versions") if isinstance(data, dict) else None
    if not isinstance(vers, list):
        return None
    for v in reversed(vers):
        d = v.get("dir") if isinstance(v, dict) else None
        if not isinstance(d, str):
            continue
        f = dash / ".versions" / d / "TECH.md"
        if f.is_file():
            try:
                return f.read_text(encoding="utf-8-sig")
            except OSError:
                return None
    return None


def read_prev_tech_path(dash: Path):
    """`read_prev_tech` 选中的**那个文件**（相对路径要进读模型指纹；内容规则仍只有 `read_prev_tech` 一处）。"""
    idx = dash / ".versions" / "index.json"
    if not idx.is_file():
        return None
    try:
        data = json.loads(idx.read_text(encoding="utf-8"))
    except Exception:
        return None
    vers = data.get("versions") if isinstance(data, dict) else None
    if not isinstance(vers, list):
        return None
    for v in reversed(vers):
        d = v.get("dir") if isinstance(v, dict) else None
        if not isinstance(d, str):
            continue
        f = dash / ".versions" / d / "TECH.md"
        if f.is_file():
            return f
    return None


def _declared_format(dash: Path) -> int:
    """`.cyd.json` 声明的**事实格式版本**（读模型透出为 `format`）。

    缺失 / 非整数 / 布尔 ⇒ 1：那是"向后兼容的正常情况"，也是渲染器能安全消费的那一版
    （契约「版本位分三件」；更高 format 的 WARN 与只读由 `cyd_format_state` 管，不在这里判）。
    """
    meta = dash / CYD_META
    if not meta.is_file():
        return CYD_FORMAT_SUPPORTED
    try:
        obj = json.loads(meta.read_text(encoding="utf-8-sig"))
    except Exception:
        return CYD_FORMAT_SUPPORTED
    fmt = obj.get("format", CYD_FORMAT_SUPPORTED) if isinstance(obj, dict) else CYD_FORMAT_SUPPORTED
    bad = isinstance(fmt, bool) or not isinstance(fmt, int)
    return CYD_FORMAT_SUPPORTED if bad else fmt


def parse_tech(text, warnings):
    """技术地图（v1.6）：`## 模块: 名称` + 固定七字段（层 / 职责 / 技术 / 状态 / 证据 / 连到）+ `### 子项` 复用。
    **不做代码解析**（保真红线）：内容只来自用户声明。返回 {modules, layers}；
    `layers` 是**首次出现顺序**去重（视觉侧照这个顺序自上而下排，渲染核不许硬编码层名单）。"""
    text = strip_comments(text)
    mods, layers = [], []
    cur = None
    for line in text.splitlines():
        s = line.strip()
        hm = re.match(r"^##\s*模块\s*[:：]\s*(.+)$", s)
        if hm:
            cur = {"name": hm.group(1).strip(), "layer": "", "duty": "", "tech": "", "status": "",
                   "evidence": [], "links": [], "children": []}
            mods.append(cur)
            continue
        cm = re.match(r"^###\s*子项\s*[:：]\s*(.+)$", s)
        if cm:
            if cur is None:
                warnings.append(f"子项「{cm.group(1).strip()}」出现在任何模块之前，已忽略")
                continue
            cur["children"].append({"name": cm.group(1).strip(), "layer": "", "duty": "", "tech": "",
                                    "status": "", "evidence": []})
            continue
        if cur is None:
            continue
        target = cur["children"][-1] if cur["children"] else cur
        fm = re.match(r"^-\s*(层|职责|技术|状态|证据|连到)\s*[:：]\s*(.*)$", s)
        if not fm:
            continue
        key, val = fm.group(1), fm.group(2).strip()
        if key == "连到":
            if cur["children"]:
                continue                      # 子项不写「连到」（契约：忽略）
            for item in val.split(","):
                item = item.strip()
                if not item:
                    continue
                lm = re.match(r"^(.+?)\s*[（(](.*?)[）)]\s*$", item)
                cur["links"].append({"name": (lm.group(1) if lm else item).strip(),
                                     "rel": (lm.group(2).strip() if lm else "")})
            continue
        if key == "层":
            target["layer"] = val
        elif key == "职责":
            target["duty"] = val
        elif key == "技术":
            target["tech"] = val
        elif key == "状态":
            target["status"] = val
        elif key == "证据":
            target["evidence"] = split_evidence(val)
    seen = set()
    for m in mods:
        if m["name"] in seen:
            warnings.append(f"技术地图里有重名模块「{m['name']}」，按第一个解析。请给其中一个改名。")
            continue
        seen.add(m["name"])
        if m["layer"] and m["layer"] not in layers:
            layers.append(m["layer"])          # 首次出现顺序
        if not m["layer"]:
            warnings.append(f"模块「{m['name']}」没写层，位置可能不对。在 TECH.md 里给它补一行层。")
        if not m["duty"]:
            warnings.append(f"模块「{m['name']}」没写职责，看不出这块是干什么的。在 TECH.md 里给它补一行职责。")
        if m["status"] not in STATUSES:
            warnings.append(f"「{m['name']}」状态非法: '{m['status']}'（允许: 设想/进行中/可用/已验证/已废弃）")
    if mods and not any(m["evidence"] for m in mods):
        warnings.append("技术地图没有证据，无法审计。")
    return {"modules": mods, "layers": layers}


def parse_changes(text, warnings):
    """变更规则（v1.6）：`## 内部工程`（什么不算产品变更）+ `## 变更归属`（某类改动归到哪个功能）。
    返回 {internal: [{path, action}], rules: [{path, action, owner}]}；**只读声明，不解析代码**。"""
    text = strip_comments(text)
    internal, rules = [], []
    section = None
    for line in text.splitlines():
        s = line.strip()
        h2 = re.match(r"^##\s*(.+)$", s)
        if h2:
            head = h2.group(1).strip()
            section = "internal" if head.startswith("内部工程") else ("rules" if head.startswith("变更归属") else None)
            continue
        if section is None or not s:
            continue
        if s.startswith("|"):
            cells = [c.strip() for c in s.strip().strip("|").split("|")]
            if len(cells) < 3 or set("".join(cells[0])) <= set("-: "):
                continue                        # 表头行或分隔行
            if cells[0] in ("路径 / 变更类型", "路径", "变更类型"):
                continue
            rules.append({"path": cells[0], "action": cells[1], "owner": cells[2]})
            continue
        bm = re.match(r"^-\s*(.+?)\s*(?:→|->)\s*归置方式\s*[:：]\s*(.+)$", s)
        if bm:
            internal.append({"path": bm.group(1).strip(), "action": bm.group(2).strip()})
    return {"internal": internal, "rules": rules}


def resolve_declared(dash: Path, warnings, kind):
    """声明类文件（tech / changes）的四级识别链，与 resolve_glossary 同构：
    `.cyd.json` 的 <kind> 字段 → 内容嗅探 → 歧义就问 → 没有给空态（不算错误）。
    返回 (Path | None, status)；status = {"file", "source", "candidates"}。"""
    status = {"file": None, "source": "none", "candidates": []}
    meta = {}
    mp = dash / CYD_META
    if mp.is_file():
        try:
            loaded = json.loads(mp.read_text(encoding="utf-8-sig"))
            if isinstance(loaded, dict):
                meta = loaded
        except Exception:
            pass                                # 这一环的岔子由 resolve_glossary 报（同一次读取只报一次）
    want = meta.get(kind)
    if isinstance(want, str) and want.strip():
        want = want.strip()
        if (dash / want).is_file():
            status.update({"file": want, "source": "explicit"})
            return dash / want, status
    hits = []
    for p in sorted((q for q in dash.iterdir() if q.is_file() and q.name.lower().endswith(".md")),
                    key=lambda q: q.name):
        try:
            txt = p.read_text(encoding="utf-8-sig")
        except OSError:
            continue
        if declared_sniff_ok(kind, txt):
            hits.append(p)
    if len(hits) == 1:
        status.update({"file": hits[0].name, "source": "sniff"})
        return hits[0], status
    if len(hits) > 1:
        status.update({"source": "ambiguous", "candidates": [p.name for p in hits]})
        return None, status
    return None, status


def declared_sniff_ok(kind, text):
    """嗅探判据（契约「CHANGES.md」「TECH.md」各一节）：
    tech —— 第一个二级标题是 `## 模块`，或第一张表表头同时含 模块/层/技术；
    changes —— 第一个二级标题是 `## 内部工程` 或 `## 变更归属`，或第一张表表头三列是 路径|归置方式|归属。"""
    t = strip_comments(text)
    heads = [ln.strip() for ln in t.splitlines() if ln.strip().startswith("## ")]
    first_head = heads[0][3:].strip() if heads else ""
    cells = []
    for ln in t.splitlines():
        s = ln.strip()
        if s.startswith("|"):
            cells = [c.strip() for c in s.strip().strip("|").split("|")]
            break
    if kind == "tech":
        if first_head.startswith("模块"):
            return True
        return len(cells) >= 3 and "模块" in cells[0] and "层" in cells and "技术" in cells
    if first_head.startswith("内部工程") or first_head.startswith("变更归属"):
        return True
    return len(cells) >= 3 and cells[0].replace(" ", "") in ("路径/变更类型", "路径", "变更类型") \
        and "归置方式" in cells and "归属" in cells


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


GLOSSARY_HEADER_TERMS = ("标准用词", "术语", "用词", "term", "glossary term")
CYD_META = ".cyd.json"
# 本插件支持的**事实源格式版本**（`.cyd.json.format`；契约「版本位分三件」L494）
CYD_FORMAT_SUPPORTED = 1                     # 渲染器拥有的机器文件：解析结论（面板靠它才知道真实文件名）
FIXED_MD = ("PRODUCT.md", "FEATURES.md", "NOW.md")


def _first_table_header(text: str):
    """返回文件第一张表的表头单元格（已剥注释）。没有表格 → None。"""
    for line in strip_comments(text).splitlines():
        if line.strip().startswith("|"):
            return [c.strip() for c in line.strip().strip("|").split("|")]
    return None


def glossary_header_ok(text: str) -> bool:
    """内容嗅探：第一张表 ≥3 列，且首列是「标准用词」及其常见别名/英文写法。
    文件名不参与判断 —— 项目把它叫 术语表.md / 词汇表.md / glossary.md 都认。"""
    h = _first_table_header(text)
    if not h or len(h) < 3:
        return False
    return h[0].strip().lower() in GLOSSARY_HEADER_TERMS


def parse_glossary(text: str, warnings, name: str = "GLOSSARY.md"):
    """解析术语表文档的第一张表格 → [{term, meaning, aliases}]。文件无表格 → WARN 并按空表处理。
    表头接受「标准用词 | 指什么 | 别名/曾用名」及其常见别名/英文写法（见 GLOSSARY_HEADER_TERMS）。"""
    text = strip_comments(text)
    entries = []
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if not line.strip().startswith("|"):
            continue
        header = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(header) < 3 or header[0].strip().lower() not in GLOSSARY_HEADER_TERMS:
            warnings.append(f"{name} 第一张表我认不出来，暂时按没有术语表处理。"
                            f"去术语表页看表头示例，照它改就行。")
            return entries
        j = i + 1
        if j < len(lines) and re.match(r"^\s*\|[|\-:\s]+\|\s*$", lines[j]):
            j += 1  # 跳过分隔行（有无均可）
        while j < len(lines) and lines[j].strip().startswith("|"):
            cells = [c.strip() for c in lines[j].strip().strip("|").split("|")]
            if len(cells) < 2 or not cells[0]:
                warnings.append(f"{name} 有一行列数不足或标准用词为空，已忽略该行")
            else:
                # 别名：先 strip 再滤空（与共享核 dashboard.core.js 的 parseGlossary 同口径）。
                # 顺序不能反——"看板, , dashboard" 用 `if a` 先滤会留下只剩空格的项，strip 后变成空别名。
                aliases = [a for a in (x.strip() for x in re.split(r"[、，,/]", cells[2] if len(cells) > 2 else "")) if a]
                entries.append({"term": cells[0], "meaning": cells[1], "aliases": aliases})
            j += 1
        return entries
    warnings.append(f"{name} 里没有表格，按无术语表处理")
    return entries


def resolve_glossary(dash: Path, warnings):
    """识别术语表文档（文件名不写死）：
    ① .cyd.json 里用户手写的 glossary → 最高优先；
    ② 内容嗅探：dev-dashboard/*.md（排除三大文件）里唯一一个表头符合契约的文件；
    ③ 命中多个 → 不猜，返回 candidates 让界面/AI 去问；
    ④ 一个都没有 → 未启用（不算错）。
    返回 (Path | None, status)；status = {"file", "source", "candidates"}。"""
    status = {"file": None, "source": "none", "candidates": []}
    meta = {}
    mp = dash / CYD_META
    if mp.is_file():
        try:
            loaded = json.loads(mp.read_text(encoding="utf-8-sig"))
            if isinstance(loaded, dict):
                meta = loaded
        except Exception:
            warnings.append(f"{CYD_META} 不是合法 JSON，已忽略（术语表按自动识别处理）")
            # 与 JS 侧同名的失败 flag（契约 v1.6 补录）：两端 glossary_status 必须同形，
            # 差分门禁逐字段比对；JS 侧由宿主把同一事实喂给共享核。不进 ok、不改变 source。
            status["meta_error"] = True
    cyd_format_state(meta, warnings)      # A/B 判据 + **只在这一处说话**（写路径只取布尔）
    want = meta.get("glossary")
    if isinstance(want, str) and want.strip():
        want = want.strip()
        if (dash / want).is_file():
            status.update({"file": want, "source": "explicit"})
            return dash / want, status
        warnings.append(f"{CYD_META} 指定的术语表「{want}」不存在，已退回自动识别")
        status["meta_missing"] = want
    hits = []
    # 扩展名大小写不敏感（与共享核 / 差分驱动同口径）：glob("*.md") 在 Windows 上大小写不敏感、
    # 在 macOS/Linux 上区分，显式按小写比较才能让三端认同一批候选文件。
    # 排序键必须是**文件名本身**：sorted(Path…) 在 Windows 走 normcase（大小写不敏感）、POSIX 区分大小写，
    # 而共享核是 JS 默认的 UTF-16 码位序 —— 只有按 name 排序才能让三端候选顺序一致、且稳定可复现。
    for p in sorted((q for q in dash.iterdir() if q.is_file() and q.name.lower().endswith(".md")),
                    key=lambda q: q.name):
        if p.name in FIXED_MD:
            continue
        try:
            if glossary_header_ok(p.read_text(encoding="utf-8-sig")):
                hits.append(p)
        except OSError:
            continue
    if len(hits) == 1:
        status.update({"file": hits[0].name, "source": "sniff"})
        return hits[0], status
    if len(hits) > 1:
        names = [p.name for p in hits]
        status.update({"source": "ambiguous", "candidates": names})
        return None, status
    return None, status


def _skill_version():
    """本插件（**正在跑的这一份**）的版本 = 同目录 skill 根的 `manifest.yaml: version`。

    写者就是跑渲染器的那份 ⇒ 版本取它自己那份（工作区领先时即工作区版本 ✓；发布副本跑时即副本版本 ✓）
    —— **同一份产物 = 同一个版本常量**（不让"两份产物两种行为" ✗）。
    """
    try:
        mp = Path(__file__).resolve().parent.parent / "manifest.yaml"
        for line in mp.read_text(encoding="utf-8").splitlines():
            if line.startswith("version:"):
                return line.split(":", 1)[1].strip()
    except Exception:
        return None
    return None


def file_hash(path):
    """机器文件的**字节级哈希**（乐观并发检查的唯一口径，契约 :552 形态③）。

    文件不存在 ⇒ `None`（"当时没有这个文件"也是一种可比的初始状态）。
    """
    p = Path(path)
    try:
        return hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None
    except OSError:
        return None


VIEW_FILE = ".view.json"
VIEW_SCHEMA_VERSION = 1
VIEW_PRODUCER = "control-your-development"


def view_norm_bytes(raw: bytes) -> bytes:
    """读模型指纹的**规范化**（契约「读模型 · 指纹」）：去 UTF-8 BOM，CRLF / CR 归一成 LF。

    **为什么必须成文并两端各实现一份**：宿主侧（node）要能独立重算同一串指纹，
    所以规则不能藏在实现细节里 —— 字节不同 ⇒ 面板误报 stale，字节相同 ⇒ 才叫"同一份事实"。
    """
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    return raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def view_hash_bytes(raw: bytes) -> str:
    return hashlib.sha256(view_norm_bytes(raw)).hexdigest()


def view_hash_text(text: str) -> str:
    return view_hash_bytes(text.encode("utf-8"))


VIEW_ABSENT = "\u0000absent"


def view_file_hash(path) -> "str | None":
    """文件指纹；不存在 ⇒ None（"当时没有这个文件"是可比的初始状态，与 file_hash 同口径）。"""
    p = Path(path)
    try:
        return view_hash_bytes(p.read_bytes()) if p.is_file() else None
    except OSError:
        return None


def view_file_hash_or_absent(path) -> str:
    """**参与新鲜度、但可能出现得晚**的输入的指纹：缺失时给一个确定的"缺席值"。

    为什么不能"缺了就跳过这个键"：消费方只重算**记录里已有的键**，于是"文件后来才出现"
    （例如先渲染、后采集出 `.facts.json`）永远判不出 stale —— 那是一整类静默过期。
    缺席值必须两边同一串（node 侧同名常量），否则又变成跨端漂移。
    """
    h = view_file_hash(path)
    return h if h is not None else view_hash_text(VIEW_ABSENT)


def view_evidence_hash(entries) -> str:
    """`@evidence`：数据里全部证据路径的 (`相对路径`, `是否存在`) 快照。

    entries = [(归一化相对路径, exists: bool)]。**按路径字节序排序**后序列化成紧凑 JSON
    （ensure_ascii=False / separators=(",", ":")），再走同一规范化 + SHA-256。
    宿主侧用同一份规则从 data 里重建它，所以这里**不许**做额外过滤（越界路径 exists=False 也照收）。
    """
    # **按路径去重**：同一条证据被多个归属引用是常态（功能/流程/时间线/技术地图），
    # 重复条目对"这份事实依赖哪些文件"零信息量，却让两端的排序稳定性变成负担。
    # 同一路径的不同 exists 不可能同时为真（口径唯一），取最后一次即可。
    uniq = {}
    for rel, ex in entries:
        uniq[str(rel)] = bool(ex)
    pairs = sorted(uniq.items(), key=lambda kv: kv[0].encode("utf-8"))
    payload = json.dumps([[k, v] for k, v in pairs], ensure_ascii=False, separators=(",", ":"))
    return view_hash_text(payload)


def view_sources_hash(dash: Path) -> str:
    """`@sources`：`dev-dashboard/*.md` 的**文件名快照**（不含内容）。

    为什么需要它：术语表 / TECH / CHANGES 的真实文件名是**嗅探**出来的。用户新建一个候选
    Markdown 时，解析结论可能变（歧义、换选中文件），而"选中的文件"那些键都不会变 ——
    没有这条快照，这种变化会**静默不 stale**。内容仍由各选中文件的键覆盖，这里只管"出现了谁"。
    """
    names = [p.name for p in dash.glob("*.md")] if dash.is_dir() else []
    # 按 UTF-8 字节序（不是 str 的码点序）：宿主侧 node 用 Buffer 比较，两边必须同一口径
    names.sort(key=lambda s: s.encode("utf-8"))
    return view_hash_text(json.dumps(names, ensure_ascii=False, separators=(",", ":")))


def view_cyd_hash(dash: Path) -> str:
    """`@cyd`：`.cyd.json` 里**影响语义的那一小撮**（选中的文件 / format / 用户指定项）。

    为什么不能整份纳入：`updated_at` / `writer.at` 每轮都变，纳入即"一渲染完就 stale"。
    为什么必须纳入：`{"glossary": "..."}` 是**用户按面板提示亲手写进去的选择**；不纳入的话用户
    改完毫无反应（面板没有别的路能察觉），解析结论会静默停在旧的那一份。
    """
    meta = dash / CYD_META
    subset = {}
    try:
        obj = json.loads(meta.read_text(encoding="utf-8-sig")) if meta.is_file() else {}
        if not isinstance(obj, dict):
            obj = {}
    except Exception:
        obj = {}
    for k in ("format", "glossary", "glossary_file", "glossary_source",
              "tech", "tech_file", "tech_source", "changes", "changes_file", "changes_source"):
        v = obj.get(k)
        if v is not None:
            subset[k] = v
    return view_hash_text(json.dumps(subset, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


def view_prevtech_hash(rel_path) -> str:
    """`@prevtech`：**选中了哪一份**上一轮 TECH 快照（只记路径，不记内容）。

    为什么需要：`.versions/index.json` 改指另一份**已存在**的快照时，文件内容都没动，正文哈希
    当然不变 —— 但"拿哪一份当上一轮"变了，S3「技术地图跟不上了」的结论跟着变。不纳入就是
    "信号整块静默滞后"。
    """
    return view_hash_text(json.dumps([str(rel_path)], ensure_ascii=False, separators=(",", ":")))


def write_view(dash: Path, data, source_hashes, fmt, generated_at) -> Path:
    """把读模型**原子**写到 `dev-dashboard/.view.json`（契约「读模型 · 原子写」）。

    临时文件同目录 ⇒ 同一文件系统 ⇒ `os.replace` 是原子的；任何时刻读到的都是完整一份。
    异常路径必须清理临时文件：残留的 `.tmp*` 会被门禁当成"半写痕迹"。
    """
    payload = {
        "schemaVersion": VIEW_SCHEMA_VERSION,
        "producer": {"name": VIEW_PRODUCER, "version": _skill_version() or ""},
        "format": fmt,
        "generatedAt": generated_at,
        "sourceHashes": source_hashes,
        "data": data,
    }
    out = dash / VIEW_FILE
    tmp = dash / (VIEW_FILE + ".tmp-" + str(os.getpid()))
    try:
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, out)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
    return out


def read_inbox_raw(inbox_path: Path):
    """`.inbox.jsonl` 的**原始文本**（离线导出要用它冻结"导出时刻的待生效"）。

    三态：文件不存在 → `""`；读到 → 原文；读取失败（IO／权限）→ `None`（"读不到"≠"没有"）。
    **不再在渲染器里解析它**：计数与明细只由共享核 `CYD.parseIntent` 一处解析（v1.7）。
    """
    try:
        return inbox_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""
    except OSError:
        return None


def concurrent_edit(path, expected_hash, label=""):
    """**乐观并发检查**（契约 :552 形态③：两份插件副本 / 两个宿主并发写同一份机器文件）。

    写机器文件**之前**调用：`expected_hash` = **读入那一刻**的 `file_hash(path)`。
    返回 True ⇒ 读入之后**被别人改过**（此刻哈希不同）——**WARN 在这里说一次**，
    调用方**必须按最新内容重算后再写**（"WARN + 重算"，不然后写者会静默覆盖前写者）。

    **为什么用哈希而不是 mtime**：mtime 在秒级 / 文件系统精度下会漏判，内容哈希不会。
    """
    now = file_hash(path)
    if now == expected_hash:
        return False
    print("WARN: %s 在本次读入之后被别的写者改过（读时 %s / 此刻 %s）⇒ 按最新内容重算后再写，避免后写覆盖前写"
          % (label or Path(path).name, (expected_hash or "无")[:12], (now or "无")[:12]))
    return True


def semver_cmp(a, b):
    """纯 stdlib 的 semver 比较：返回 -1/0/1；**任一侧无法解析 ⇒ None**（fail-safe）。

    三段数字 + 预发布按 semver 优先级（预发布 < 同号正式版，如 `1.9.0-rc < 1.9.0`）。
    **为什么无法解析就不比**：这条 WARN 说的是"你的项目被更新版写过"——**说错会让用户白忙** ⇒
    误报比漏报更坏。注明：**"无法解析 ⇒ 不产"是 fail-safe，不是因为这件事不重要** ✓
    （`1.10.0 > 1.9.0` 是经典易错例：字符串比较会判反 ⇒ self-test 必测。）
    """
    def parse(v):
        if not isinstance(v, str):
            return None
        s = v.strip()
        if not s:
            return None
        main, _, pre = s.partition("-")
        parts = main.split(".")
        if len(parts) != 3 or not all(p.isdigit() for p in parts):
            return None
        return (tuple(int(p) for p in parts), pre)
    pa, pb = parse(a), parse(b)
    if pa is None or pb is None:
        return None
    na, prea = pa
    nb, preb = pb
    if na != nb:
        return -1 if na < nb else 1
    if prea == preb:
        return 0
    if prea == "":
        return 1            # 正式版 > 预发布
    if preb == "":
        return -1
    return -1 if prea < preb else 1


def cyd_format_state(meta, warnings):
    """读 `.cyd.json.format` 并判定**能不能安全回写**（fail-closed）——契约「版本位分三件」L494。

    **判据**（L494 原文）：`format > 本插件支持` → **只读、不写回** + 一条 WARN
    「这份文件是更新版插件写的，当前版本读不全，已按只读处理」（**fail-closed**：
    宁可不动，不可用旧解析器覆盖新格式）。
    缺失 ⇒ 视为 1（向后兼容）；布尔与非整数 ⇒ 同样**按只读处理**（不猜、不修）。

    **保护对象说清楚**（口径）：fail-closed 的对象是**承载格式声明的文件**（`.cyd.json`）；
    `index.html` / `.versions/` 是**由事实源重新生成的产物**、不承载格式声明 ⇒ **照旧生成**
    （停写它们只会让看板静默变旧，更坏 ✗）。
    **并且**：只读时**不许假装是新算的** —— 跳过写 ⇒ `updated_at` 保持旧值 ⇒ 派生状态不会假装刚更新 ✓。

    **A（deck:600 定稿）**：`format > 本插件支持` **或** `writer.skill > 本插件版本` ⇒ **一条** ——
      两个信号指向同一件事（"文件比插件新"）、同一个下一步（升级插件）⇒ **合并**
      （尺子：**下一步相同 ⇒ 合并；下一步不同 ⇒ 分开**）。
    **B（deck:601 定稿）**：`format` **存在但不是整数** ⇒ **另一条**（下一步是"改回一个数字"）。
    **A 与 B 互斥**：同一份文件不可能既"比插件新"又"格式无法解析" ⇒ else-if ⇒ **不会同时产**
    （同时出现会让用户不知道听谁的）。
    缺失 `format` ⇒ 视为 1（向后兼容、不产）；`writer` 缺失/无法解析 ⇒ 不比、不产（**fail-safe**：
    说错会让用户白忙，**不是因为这件事不重要**）。只看 `skill`、**不看 `at`**（at 每次真写都变 ⇒ 假红）。
    返回 **writable**（True = 允许写回）；`warnings=None` ⇒ **只取布尔、不说话**（写路径用 ⇒
    "同一条 WARN 只在一处产出"）。
    """
    fmt = meta.get("format", 1)
    bad = isinstance(fmt, bool) or not isinstance(fmt, int)
    w = meta.get("writer")
    wv = w.get("skill") if isinstance(w, dict) else None
    cmp = semver_cmp(wv, _skill_version()) if wv else None
    newer = ((not bad) and fmt > CYD_FORMAT_SUPPORTED) or (cmp is not None and cmp > 0)
    if warnings is not None:
        if newer:
            warnings.append(".cyd.json 是更新版插件写的，当前版本读不全。"
                            "所以这次不改它，免得把新内容写坏。" "升级插件后再看就行。")
        elif bad:
            warnings.append(".cyd.json 里的格式版本写得不对，读不出来。"
                            "所以这次不改它，先按只读用。" "把这一项改回一个数字就行。")
    return not (newer or bad)

def write_cyd_meta(dash: Path, status, warnings):
    """把解析结论写进 .cyd.json（面板没有列目录能力，只能靠它知道真实文件名）。
    用户手写的 glossary 字段会被保留，渲染器不覆盖。"""
    mp = dash / CYD_META
    meta = {}
    h0 = file_hash(mp)                      # 读入那一刻的哈希（乐观并发检查的基线）
    if mp.is_file():
        try:
            loaded = json.loads(mp.read_text(encoding="utf-8-sig"))
            if isinstance(loaded, dict):
                meta = loaded
        except Exception:
            meta = {}
    # fail-closed：**承载格式声明的文件**不许被旧解析器覆盖（只读时一个字节都不改）。
    # WARN **只在读路径说一次**（`cyd_format_state(meta, warnings)` 那处）——这里传空列表只取布尔，
    # 否则同一句被说两遍（实测：两端比对 py=2 / js=1 ✗）。
    writable = cyd_format_state(meta, [])
    meta["format"] = CYD_FORMAT_SUPPORTED
    if not writable:
        return
    # 乐观并发检查（契约 :552 形态③）：读入之后被别人改过 ⇒ **WARN + 重算**（不覆盖别人的改动）。
    if concurrent_edit(mp, h0, ".cyd.json"):
        try:
            loaded = json.loads(mp.read_text(encoding="utf-8-sig"))
            if isinstance(loaded, dict):
                meta = loaded
        except Exception:
            pass
        # **重算后要重新判可写性**：新内容可能声明了更高的 `format`（那就该退回只读，不能写）
        if not cyd_format_state(meta, []):
            print("WARN: .cyd.json 重算后要求只读（新内容声明了更高 format）⇒ 本次不写")
            return
    meta["version"] = 1
    meta["glossary_file"] = status["file"]
    meta["glossary_source"] = status["source"]
    meta["glossary_candidates"] = status["candidates"]
    meta["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    # 写入者版本位（契约 L495）：记"这个项目最后被哪个插件版本写过"。
    # **`at` 只在真写时更新**（只读时整体 return，不动它 ✓）；**`at` 只用于记录/人读，不参与任何比对** ✗
    # （比对项只有 `skill`——否则两端会因时间戳不同而假红）。
    _sv = _skill_version()
    if _sv:
        meta["writer"] = {"skill": _sv, "at": datetime.now().isoformat(timespec="seconds")}
    with open(mp, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(meta, ensure_ascii=False, indent=1) + "\n")


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
                       "multi": False, "obsolete": False}
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
            # v1.5 三态：待拍板 显式清空结论；已废弃 是终态（不进「待拍板」计数，界面按废弃样式渲染）
            pm = re.match(r"^-\s*状态\s*[:：]\s*待拍板\s*$", s)
            if pm:
                cur_dec["obsolete"] = False
                cur_dec["decided"] = ""
                continue
            ob = re.match(r"^-\s*状态\s*[:：]\s*已废弃\s*$", s)
            if ob:
                cur_dec["obsolete"] = True
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


def legacy_ignore_warnings(patterns, ref_paths):
    """`.dashboard-ignore` 旧写法失效 WARN —— **行为式判据**（契约 :504-521）+ 文案逐字 deck:599。

    作用域＝**渲染器单端**（v1.7 起 ignore 解析与匹配只有渲染器这一侧；文案定稿由 warn_copy_check 按 `作用域：渲染器` 核对）。

    **为什么是行为式**：看模式形状必然误报 ——
      ① 漏掉最危险的一类：**旧版 `*`/`?` 能跨 `/`**，新版按 `/` 分段（`*.log` 旧版命中 `dist/app.log`、
         新版只命中根目录）；而契约 :392 举的例子正好是 `*.log` ⇒ 最常见写法正好落在这类。
      ② "含大写字母"会把"用户目录名真有大写"误报成失效（从模式串无法判定大小写**是否与实际路径不符**）。
    ⇒ 判据用**真实数据**做行为验证：

      参照集合 = 本轮 `.facts.json` 的 `items[].path`
      旧语义参照匹配器 = `fnmatch.fnmatchcase(p.lower(), pat.lower())`
        （一次性建模旧版三处差异：`*`/`?` 跨 `/`、大小写不敏感、支持字符类）
      判据 = 存在参照路径 p 使「**旧命中 ∧ 新语义 glob_match(p, pat) 不命中**」⇒ 该条计入失效
        · 两边都命中 = 规则本来正常 ⇒ **不报**
        · 两边都不命中 = 惰性模式 ⇒ **不报**
      `!` 取反**不列入判据**（旧版也不支持，非升级问题）。
      `X` = 首个失效条目原文、`N` = 总数（**一条 WARN 覆盖全部**）。
    """
    import fnmatch
    bad = []
    for pat in patterns:
        if pat.startswith("!"):
            continue
        for p in ref_paths:
            try:
                old_hit = fnmatch.fnmatchcase(str(p).lower(), str(pat).lower())
            except Exception:
                old_hit = False
            if old_hit and not glob_match(p, pat):
                bad.append(pat)
                break
    if not bad:
        return []
    return [".dashboard-ignore 里「" + bad[0] + "」等 " + str(len(bad)) + " 条写法不再生效。"
            "旧写法和新版本的匹配规则不一样。" "照实际路径改一下写法就行。"]


def _exists_like_audit(workspace: Path, rel: str, cache: dict):
    """**唯一的存在性口径**（`audit()` 与 S3 共用一份）：越界/绝对路径 → False；否则 lstrip('/') 后 stat 文件。

    为什么单拎出来：S3 要比"**快照**里声明过、现在还在不在"的路径，那些路径不一定出现在本轮 matrix 里，
    但**判定规则必须与 audit 一模一样** —— 两套存在性口径就是下一个漂移源。
    """
    r = rel.replace("\\", "/")
    if evidence_path_error(r):
        return False
    r = r.lstrip("/")
    if r not in cache:
        cache[r] = (workspace / r).is_file()
    return cache[r]


def compute_tech_stale(prev_tech_raw, tech_doc, workspace: Path):
    """S3 部分失效（契约 L560）—— 返回 `{"modules": [...], "ratio": x}` 或 `None`。

    **判据（与快照对比，载体与 S1 同一个）**：
      · 只比**两边都在的模块**（最近一份 `.versions/*/TECH.md` 里有、本轮 `TECH.md` 里也有）；
      · 分母 = **快照**为该模块声明的证据条数（那是"上一版地图的承诺"）；分子 = 其中**现在不存在**的条数；
      · `0 < 失效率` 的模块计入 `modules`（**全灭也算** —— 声明还在、文件全没了正是"地图跟不上了"最该说的情况；
        S1 那条 WARN 管的是"本轮声明被清空"，与这条不是一回事）；
      · 无快照 / 快照解析不出模块 / 没有一个模块失效 → `None`（**fail-closed 不产**，不用"本轮为空"近似）。
      · `ratio` = 总体失效率 = Σ失效 / Σ分母（4 位小数；只此一份实现，消费方只读不算）。

    存在性走 `_exists_like_audit` —— **不在渲染器里另写一套 stat 规则**。
    """
    if prev_tech_raw is None:
        return None
    prev_doc = parse_tech(prev_tech_raw, [])
    cur_names = set(m["name"] for m in tech_doc["modules"])
    cache, modules, miss_tot, decl_tot = {}, [], 0, 0
    for pm in prev_doc["modules"]:
        if pm["name"] not in cur_names:
            continue
        paths = list(pm["evidence"])
        if not paths:
            continue
        miss = sum(1 for p in paths if not _exists_like_audit(workspace, p, cache))
        decl_tot += len(paths)
        miss_tot += miss
        if miss > 0:
            modules.append(pm["name"])
    if not modules or decl_tot == 0:
        return None
    return {"modules": modules, "ratio": round(miss_tot / decl_tot, 4)}


def compute_moved_evidence(facts_detail, tech_doc, features, journey, timeline):
    """S4 搬迁检测 —— 返回 `{"tech": [...], "features": [...]}` 或 `None`。

    **判据（只看本轮 `.facts.json`，不需要任何历史）**：
      · `deleted` = 本轮 `facts_detail` 里 `change == "deleted"` 的路径集合；
      · 命中① tech 侧 = `deleted` ∩（技术模块 / 子项的 `证据` 路径）⇒ 记下**模块名**；
      · 命中② 功能侧 = `deleted` ∩（功能 / 子项 / 使用流程 / 时间线 的证据路径）⇒ 记下**功能名**
        （使用流程与时间线按各自板块名记一次）；
      · 两侧都没命中 ⇒ `None`（**fail-closed 不产** —— 不许"没数据也报一句"，那是恒真信号）。

    路径规范化**只做反斜杠 → 正斜杠**：与 `facts_detail` 里 `path` 的写法、以及 JS `normPath` 逐字同口径。
    另立一套 lstrip／大小写规则就是下一个漂移源（两端交集算出不同结果 ⇒ 差分假红或假绿）。
    名字按**声明顺序去重**；超过 3 个由调用方加「等」（与 S3 同规矩：别让变量把句子撑过 40 字）。
    """
    deleted = set()
    for d in facts_detail or []:
        if (d.get("change") or "") == "deleted":
            p = (d.get("path") or "").replace("\\", "/")
            if p:
                deleted.add(p)
    if not deleted:
        return None

    def _hit(paths):
        return any((p or "").replace("\\", "/") in deleted for p in paths)

    def _push(seq, name):
        if name not in seq:
            seq.append(name)

    tech_names, feat_names = [], []
    for m in tech_doc["modules"]:
        if _hit(list(m["evidence"]) + [p for c in m["children"] for p in c["evidence"]]):
            _push(tech_names, m["name"])
    for f in features:
        if _hit(list(f["evidence"]) + [p for c in f["children"] for p in c["evidence"]]):
            _push(feat_names, f["name"])
    if any(_hit(j["evidence"]) for j in journey):
        _push(feat_names, "使用流程")
    if any(_hit(t["evidence"]) for t in timeline):
        _push(feat_names, "时间线")
    if not tech_names and not feat_names:
        return None
    return {"tech": tech_names, "features": feat_names}


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
        exists = _exists_like_audit(workspace, rel, exists_cache)
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

    # 术语表（默认建、文件名不写死）：先显式指定，再按表头契约内容嗅探；结论写进 .cyd.json 供面板读取
    glossary = []
    drift = []
    gpath, gstatus = resolve_glossary(dash, warnings)
    if gpath is not None:
        glossary = parse_glossary(gpath.read_text(encoding="utf-8-sig"), warnings, gpath.name)
        drift = glossary_drift(glossary, [
            ("PRODUCT.md", strip_comments(prod_text)),
            ("FEATURES.md", strip_comments(feat_text)),
            ("NOW.md", strip_comments(now_text))])
        for d in drift:
            warnings.append(f"用词漂移：别名「{d['alias']}」在 {d['file']} 出现 {d['count']} 次，"
                            f"标准用词是「{d['term']}」")
    elif gstatus["source"] == "ambiguous":
        warnings.append("术语表找到 " + str(len(gstatus["candidates"])) + " 个候选（"
                        + " / ".join(gstatus["candidates"]) + "），暂时按没有术语表处理。"
                        + "告诉我用哪一个，我来指定术语表。")
    write_cyd_meta(dash, gstatus, warnings)

    # 声明类文件（v1.6）：技术地图 / 变更规则 —— 先按四级链识别，再解析；**绝不做代码解析**
    tpath, tstatus = resolve_declared(dash, warnings, "tech")
    cpath, cstatus = resolve_declared(dash, warnings, "changes")
    tech_doc = parse_tech(tpath.read_text(encoding="utf-8-sig"), warnings) if tpath else {"modules": [], "layers": []}
    changes_doc = parse_changes(cpath.read_text(encoding="utf-8-sig"), warnings) if cpath else {"internal": [], "rules": []}

    evidence_pairs = []
    for f in feats:
        evidence_pairs += [(f["name"], p) for p in f["evidence"]]
        for c in f["children"]:
            evidence_pairs += [(f["name"] + " / " + c["name"], p) for p in c["evidence"]]
    for j in proj["journey"]:
        evidence_pairs += [("使用流程", p) for p in j["evidence"]]
    for t in timeline:
        evidence_pairs += [("时间线", p) for p in t["evidence"]]

    # 声明类文件（v1.6）：技术地图的证据**计入归置**（否则用户声明了还一直报"未归置"），
    # 但审计必须**单列**（防后门：只算归置而不单列，谁都能把"未归置"清零）；变更规则引用的是 glob、
    # 无存在性可查 → 只参与"算归置 / 审计单列"（队长裁决）。
    owned_paths = set(p for _, p in evidence_pairs)          # 功能 / 使用流程 / 时间线引用的路径
    tech_evidence = [p for m in tech_doc["modules"] for p in m["evidence"]] \
        + [p for m in tech_doc["modules"] for c in m["children"] for p in c["evidence"]]
    for m in tech_doc["modules"]:
        evidence_pairs += [("技术地图 / " + m["name"], p) for p in m["evidence"]]
        for c in m["children"]:
            evidence_pairs += [("技术地图 / " + m["name"] + " / " + c["name"], p) for p in c["evidence"]]
    tech_only = [p for p in tech_evidence if p not in owned_paths]
    changes_declared = [r["path"] for r in changes_doc["internal"] + changes_doc["rules"]]
    changes_only = [p for p in changes_declared if not any(glob_match(o, p) for o in owned_paths)]
    if len(tech_only) > 10:
        warnings.append(f"仅由技术地图引用的文件已有 {len(tech_only)} 个，请复核这些模块的证据是否还准确。")
    if len(changes_only) > 10:
        warnings.append(f"仅由变更规则声明的路径已有 {len(changes_only)} 条，请复核这些规则是否还准确。")
    # 漂移 ①（deck:580）：规则引用的功能名已不在功能地图里
    feat_names = set(f["name"] for f in feats)
    for r in changes_doc["internal"] + changes_doc["rules"]:
        om = re.search(r"功能\s*[「『](.+?)[」』]", r.get("owner", "") or "")
        if om and om.group(1) not in feat_names:
            warnings.append(f"变更规则可能过期：规则「{r['path']}」引用的功能「{om.group(1)}」已不在功能地图里，请确认。")
    # 漂移 ②（deck:582）：载体 = .versions/ 最近一份 TECH.md 快照；**无快照 → 不产**（fail-closed）
    prev_tech = read_prev_tech(dash)
    if prev_tech is not None:
        prev_doc = parse_tech(prev_tech, [])
        cur_by_name = {m["name"]: m for m in tech_doc["modules"]}
        for pm in prev_doc["modules"]:
            cm = cur_by_name.get(pm["name"])
            if pm["evidence"] and cm is not None and not cm["evidence"]:
                warnings.append(f"技术地图可能过期：模块「{pm['name']}」的证据都不在了，请确认。")

    matrix, missing, invalid, pending, facts_detail, ignore_patterns = audit(
        evidence_pairs, ws, dash / ".facts.json", dash / ".dashboard-ignore")
    # 旧写法失效 WARN：**行为式**判据，参照集合 = 本轮 .facts.json 的 items[].path（契约 :504-521）
    warnings.extend(legacy_ignore_warnings(ignore_patterns, [x["path"] for x in facts_detail]))
    # 漂移 ③（deck:583）：不需要历史 —— 本轮 .facts.json 的顶层目录 vs 本轮模块证据覆盖
    covered_tops = set(p.split("/")[0] for p in tech_evidence if p)
    seen_tops = []
    for d0 in [x.get("path", "") for x in facts_detail]:
        top = d0.split("/")[0] if d0 else ""
        if top and top not in seen_tops:
            seen_tops.append(top)
    for top in seen_tops:
        if top not in covered_tops:
            warnings.append(f"新目录 {top} 未进技术地图，请确认是内部工程还是漏了模块。")
    if invalid:
        blockers.append(f"{len(invalid)} 条证据路径越界（必须相对工作区根、禁止绝对路径与上跳）: " + ", ".join(invalid[:5]))
    if missing:
        blockers.append(f"{len(missing)} 条证据路径不存在: " + ", ".join(missing[:5]))
    # S3（契约 L560，任务②）：**部分失效**信号 —— 与 S1 同一个载体（`.versions/` 最近一份 TECH.md）；
    # **无快照 → None**（fail-closed）⇒ 数据里就是 `null`，渲染层不产 ⚠/.snote（不许假装"没问题"）。
    tech_stale = compute_tech_stale(prev_tech, tech_doc, ws)
    if tech_stale:
        # 文案**逐字取自 copy-deck §16.6**（两端必须逐字同序；JS 同一段在 `techStaleLines()`，
        # 逐条核对由 view_model_test 的 warnings 断言与 warn_copy_check 守）。模块名**最多列 3 个、超出加「等」**（deck 要求：
        # 别让变量把句子撑过 40 字）。
        _stale_names = list(tech_stale["modules"])
        _stale_shown = "、".join(_stale_names[:3]) + ("等" if len(_stale_names) > 3 else "")
        warnings.append("技术地图里有 %d 个模块的证据找不到了：%s。" % (len(_stale_names), _stale_shown))
        warnings.append("这份地图可能已经跟不上代码了。")
        warnings.append("去技术地图里把这几条证据改对。")
    # S4 搬迁检测：本轮 .facts.json 里 change == "deleted" 的路径 ∩ 两侧证据。
    # **推的位置紧接 S3 之后**（warnings[] 是**有序**的，两端顺序必须一致；JS 同一段紧跟 `techStaleLines` 那句）。
    # 文案与 JS `movedEvidenceLines()` **逐字一致**（JS 侧的唯一生成处）；最多列 3 个名字、超出加「等」。
    moved_evidence = compute_moved_evidence(facts_detail, tech_doc, feats, proj["journey"], timeline)
    if moved_evidence and moved_evidence["tech"]:
        _mv_tech = list(moved_evidence["tech"])
        _mv_tech_shown = "、".join(_mv_tech[:3]) + ("等" if len(_mv_tech) > 3 else "")
        warnings.append("技术地图里有 %d 个模块的证据文件已被删除（可能搬迁）：%s。"
                        % (len(_mv_tech), _mv_tech_shown))
    if moved_evidence and moved_evidence["features"]:
        _mv_feat = list(moved_evidence["features"])
        _mv_feat_shown = "、".join(_mv_feat[:3]) + ("等" if len(_mv_feat) > 3 else "")
        warnings.append("功能地图里有 %d 个功能的证据文件已被删除（可能搬迁）：%s。"
                        % (len(_mv_feat), _mv_feat_shown))
    no_verify = [f["name"] for f in feats if f["status"] == "已验证" and not f["verify"]]
    no_verify += [f"{f['name']} 的子项 {c['name']}" for f in feats for c in f["children"]
                  if c["status"] == "已验证" and not c["verify"]]
    if no_verify:
        blockers.append(f"{len(no_verify)} 个功能标为「已验证」但缺少验证记录: " + ", ".join(no_verify[:5]))
    facts_error = "corrupt" if pending == -1 else ("" if (dash / ".facts.json").is_file() else "missing")
    # 采集来源与采集时间同源同读（都在 .facts.json 顶层）：缺失 / 不可解析 / 缺键一律空串，
    # 它们是提示性信息，不参与 ok 判定。
    facts_source = ""
    facts_generated_at = ""
    if (dash / ".facts.json").is_file():
        try:
            fmeta = json.loads((dash / ".facts.json").read_text(encoding="utf-8")) or {}
            if isinstance(fmeta, dict):
                facts_source = fmeta.get("source", "") or ""
                _ga = fmeta.get("generated_at", "")
                facts_generated_at = _ga if isinstance(_ga, str) else ""
        except Exception:
            facts_source = ""
            facts_generated_at = ""
    if pending == -1:
        blockers.append(".facts.json 损坏，无法审计覆盖性")
    elif pending > 0:
        blockers.append(f"{pending} 条变更事实未归置（收录进时间线/功能证据，或写入 .dashboard-ignore）")
    # 待生效（意图状态）**不进事实视图**（v1.7，契约「读模型 · 意图不在读模型里」）：
    # 面板与离线页都拿原始文本交给共享核 parseIntent 解析；这里只为离线导出冻结"导出时刻的原文"。
    inbox_raw = read_inbox_raw(dash / ".inbox.jsonl")
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

    generated_at = datetime.now().astimezone().isoformat(timespec="seconds")
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
        "glossary_file": gstatus["file"],
        "tech": tech_doc,
        "changes": changes_doc,
        "timeline": [{**t, "evidence": ev_objs(t["evidence"])} for t in timeline],
        "decisions": decisions,
        "todos": todos,
        "health": {"ok": not blockers, "matrix": matrix,
                   "evidence_missing": missing, "evidence_invalid": invalid,
                   "facts_pending": max(pending, 0), "facts_error": facts_error, "source": facts_source,
                   "facts_generated_at": facts_generated_at,
                   "verify_missing": no_verify,
                   "glossary_drift": drift, "glossary_status": gstatus,
                   "tech_status": tstatus, "changes_status": cstatus,
                   "declared_refs": {"changes_only": changes_only, "tech_only": tech_only},
                   "tech_stale": tech_stale,
                   "facts": facts_detail, "ignore": ignore_patterns, "warnings": warnings},
    }

    # ---- 读模型（v1.7）：**每次 render 都写**，与是否导出 HTML 无关（契约「读模型 · 消费方职责」）----
    # 指纹覆盖 = 契约「读模型 · 指纹」；可选文件缺失就不产那个键（不是空串）。
    _src = {
        "PRODUCT.md": view_file_hash(dash / "PRODUCT.md"),
        "FEATURES.md": view_file_hash(dash / "FEATURES.md"),
        "NOW.md": view_file_hash(dash / "NOW.md"),
    }
    if gpath is not None:
        _src[gpath.name] = view_file_hash(gpath)
    if tpath is not None:
        _src[tpath.name] = view_file_hash(tpath)
    if cpath is not None:
        _src[cpath.name] = view_file_hash(cpath)
    # 这两件**必须始终产键**（缺席用确定的缺席值）：它们可能在首次渲染之后才出现，
    # "后来才出现"必须能判成 stale，否则读模型会带着旧 facts 静默显示"完整"。
    for _opt in (".facts.json", ".dashboard-ignore"):
        _src[_opt] = view_file_hash_or_absent(dash / _opt)
    # 参与漂移判定的最近一版 TECH.md：按它自己的相对路径登记（内容规则只有 read_prev_tech 一处）
    _prev_path = read_prev_tech_path(dash)
    if _prev_path is not None:
        try:
            _rel_prev = _prev_path.relative_to(dash).as_posix()
        except ValueError:
            _rel_prev = _prev_path.name
        _src[_rel_prev] = view_file_hash(_prev_path)
        _src["@prevtech"] = view_prevtech_hash(_rel_prev)
    else:
        # 没有快照也要有键：快照"后来才出现 / 被 prune 掉"同样会改变漂移判定的前提
        _src["@prevtech"] = view_prevtech_hash("")
    # @evidence：数据里的**每一条**证据路径 + 存在性（越界 = False，与证据矩阵同口径）
    _ev_entries = []
    _exists_cache_ev = {}

    def _ev_add(items):
        for _e in items:
            if isinstance(_e, dict):
                _ev_entries.append((_e["path"], bool(_e["exists"])))
            elif isinstance(_e, str):
                # 技术地图的 `evidence` 是**路径字符串数组**（契约「顶层 tech」明确不重复一份 exists），
                # 存在性在这里按 audit 的同一口径现算 —— 与 node 侧 evidenceEntries 对齐（它也只看 path）。
                _rel = _e.replace("\\", "/")
                _ev_entries.append((_rel, _exists_like_audit(ws, _rel, _exists_cache_ev)))

    for _f in feats:
        _ev_add(ev_objs(_f["evidence"]))
        for _c in _f["children"]:
            _ev_add(ev_objs(_c["evidence"]))
    for _j in proj["journey"]:
        _ev_add(ev_objs(_j["evidence"]))
    for _t in timeline:
        _ev_add(ev_objs(_t["evidence"]))
    for _m in tech_doc["modules"]:
        _ev_add(ev_objs(_m["evidence"]))
        for _mc in (_m.get("children") or []):
            _ev_add(ev_objs(_mc["evidence"]))
    _src["@evidence"] = view_evidence_hash(_ev_entries)
    # @sources：dev-dashboard/*.md 的**文件名快照**（嗅探结论可能因新建候选文件而变）
    _src["@sources"] = view_sources_hash(dash)
    # @cyd：用户手写的解析结论（选术语表 / format）—— 用户照面板提示改完必须能让读模型过期
    _src["@cyd"] = view_cyd_hash(dash)
    write_view(dash, data, _src, _declared_format(dash), generated_at)

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
    # 离线页的只读元数据：导出时刻 + 数据来源版本 + 冻结的待生效原文（面板与离线页同一个 parseIntent 解析）
    meta_payload = (json.dumps({
        "schemaVersion": VIEW_SCHEMA_VERSION,
        "producer": {"name": VIEW_PRODUCER, "version": _skill_version() or ""},
        "format": _declared_format(dash),
        "generatedAt": generated_at,
        "exportedAt": generated_at,
        "intentRaw": inbox_raw,
    }, ensure_ascii=False)
        .replace("<", "\\u003c")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029"))
    html = tpl.replace("/*__CYD_CORE__*/", core, 1).replace("/*__CYD_WEB__*/", web, 1)
    html = html.replace("/*__DATA__*/null", "/*__DATA__*/" + payload, 1)
    html = html.replace("/*__META__*/null", "/*__META__*/" + meta_payload, 1)
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
                       "子项", "汇总", '"glossary"', "仪表盘",
                       '📖 术语表', "还没有术语表"):
            assert marker in html, f"产物缺少标记: {marker}"
        # 壳是 json.dumps 注入的（引号被转义），归一化后再断言结构
        flat = html.replace('\\"', '"')
        for marker in ('data-tab="project"', 'id="project"', 'data-tab="features"', 'id="features"',
                       'data-tab="now"', 'id="now"', 'data-tab="decisions"', 'id="decisions"',
                       'data-tab="glossary"', 'id="glossary"'):
            assert marker in flat, f"产物缺少结构标记: {marker}"
        # v1.7 五 tab 顺序：项目 / 功能地图 / 现在 / 决策与待办 / 术语表（**使用指南已删**，D2）
        assert (flat.index('data-tab="project"') < flat.index('data-tab="features"') < flat.index('data-tab="now"')
                < flat.index('data-tab="decisions"') < flat.index('data-tab="glossary"')), \
            "五 tab 顺序不对（应为 项目 / 功能地图 / 现在 / 决策与待办 / 术语表）"
        # 反向断言：独立「使用指南」必须整块消失（导航 / section / 固定文案一处都不许留）
        for gone in ('data-tab="guide"', 'id="guide"', '上手方式', '待办不做也能跑'):
            assert gone not in flat, f"使用指南残留: {gone}"
        # 统一工作区（v1.7）：右侧检查器 + 底部进展/决策抽屉
        for marker in ('id="inspector"', 'id="insBody"', 'id="drawer"', 'id="drawerBody"'):
            assert marker in flat, f"产物缺少统一壳结构: {marker}"
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
        # 术语表识别契约：改名后仍按内容嗅探认出来，并把真实文件名落进 .cyd.json 与产物
        (dash / "GLOSSARY.md").rename(dash / "术语表.md")
        assert render(dash, root, write_html=True) == 0
        meta = json.loads((dash / CYD_META).read_text(encoding="utf-8"))
        assert meta["glossary_file"] == "术语表.md" and meta["glossary_source"] == "sniff", meta
        assert "术语表.md" in (dash / "index.html").read_text(encoding="utf-8"), "产物未带真实文件名"
        # 歧义：两个文件都符合表头契约 → 不猜、报警、不阻断
        (dash / "词汇表.md").write_text(
            "# 另一个\n\n| 标准用词 | 指什么 | 别名/曾用名 |\n| --- | --- | --- |\n| 甲 | 乙 | 丙 |\n",
            encoding="utf-8")
        assert render(dash, root, write_html=True) == 0
        meta2 = json.loads((dash / CYD_META).read_text(encoding="utf-8"))
        assert meta2["glossary_source"] == "ambiguous" and len(meta2["glossary_candidates"]) == 2, meta2
        # 显式指定优先，且渲染器不覆盖用户手写的 glossary 字段
        (dash / CYD_META).write_text(json.dumps({"glossary": "术语表.md"}, ensure_ascii=False),
                                     encoding="utf-8")
        assert render(dash, root, write_html=True) == 0
        meta3 = json.loads((dash / CYD_META).read_text(encoding="utf-8"))
        assert meta3["glossary_source"] == "explicit" and meta3["glossary_file"] == "术语表.md", meta3
        assert meta3["glossary"] == "术语表.md", "用户手写的 glossary 字段被覆盖了"
        # 一个都没有 → 未启用（不算错误）；空态由前端负责
        (dash / "术语表.md").unlink()
        (dash / "词汇表.md").unlink()
        (dash / CYD_META).unlink()
        assert render(dash, root, write_html=True) == 0
        meta4 = json.loads((dash / CYD_META).read_text(encoding="utf-8"))
        assert meta4["glossary_file"] is None and meta4["glossary_source"] == "none", meta4
        # ---- ① format 位 + fail-closed（契约「版本位分三件」L494）：三组夹具，**正反两侧常驻** ----
        # 这三组此前只在一次性脚本里验过 ⇒ 不固化就"下次没人跑它也不会红"（今天的教训）。
        def _fmt_case(meta_obj, expect_readonly, phrase="是更新版插件写的"):
            (dash / CYD_META).write_text(json.dumps(meta_obj, ensure_ascii=False), encoding="utf-8")
            b0 = (dash / CYD_META).read_bytes()
            rc = render(dash, root, write_html=True)
            b1 = (dash / CYD_META).read_bytes()
            import re as _re
            html = (dash / "index.html").read_text(encoding="utf-8")
            data = json.loads(_re.search(r"__DATA__\*/(\{.*?\});", html, _re.S).group(1))
            ws = data.get("health", {}).get("warnings", [])
            n = sum(1 for w in ws if phrase in w)
            assert rc == 0, "format 夹具渲染应当成功（退出码 0）"
            assert n == (1 if expect_readonly else 0), \
                "该支 WARN 条数应为 %d，实得 %d：%s" % (1 if expect_readonly else 0, n, ws)
            assert (b0 == b1) == expect_readonly, "fail-closed：只读时 .cyd.json 必须**逐字节未变**"
        # A（deck:600）两个信号各一例 + 反例；**B（deck:601）独立一支**；A/B 互斥（B 例里 A 必须为 0 ✓）
        _fmt_case({"version": 1, "format": 1}, False)       # 正常 ⇒ 可写回、不产（反例）
        _fmt_case({"version": 1, "format": 99}, True)       # A-信号①：format 超前
        _fmt_case({"version": 1, "format": 1, "writer": {"skill": "99.0.0", "at": "2026-01-01T00:00:00"}},
                  True)                                     # A-信号②：writer 超前（format 正常也产 A ✓）
        _fmt_case({"version": 1, "format": 1, "writer": {"skill": "1.0.0", "at": "2026-01-01T00:00:00"}},
                  False)                                    # 反例：writer 不超前 ⇒ 不产
        _fmt_case({"version": 1}, False)                    # 缺失 format ⇒ 视为 1（向后兼容）
        _fmt_case({"version": 1, "format": "x"}, True, phrase="格式版本写得不对")   # B 支；A 必须为 0（互斥 ✓）
        # semver 六例（纯 stdlib；`1.10.0 > 1.9.0` 是"字符串比较会判反"的经典例）
        assert semver_cmp("1.10.0", "1.9.0") == 1
        assert semver_cmp("1.9.0", "1.9.0-rc") == 1
        assert semver_cmp("1.9.0-rc", "1.9.0") == -1
        assert semver_cmp("", _skill_version()) is None
        assert semver_cmp("abc", _skill_version()) is None
        assert semver_cmp("1.2", _skill_version()) is None
        (dash / CYD_META).unlink()
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
        scoped_bad = css_unscoped(css_text)
        assert not scoped_bad, "CSS 存在未作用域选择器（会污染宿主页面）: " + str(scoped_bad[:5])
        # 判据自身的**正反两侧**用例（它判别人，也得被人判）：喂已知越界 / 已知合规，两向都要对
        bad_probe = css_unscoped(
            "body { color: red }\n"
            ".foo { color: red }\n"
            "[data-conversation-scroll]:has(.other-root)>[data-composer-seat]{color:red}\n"
            "/* 注释里写个选择器不算数 */.bar{color:red}\n")
        assert len(bad_probe) == 4, "未作用域判据漏拦：期望 4 条（body / .foo / 别家根 / 注释后的 .bar），实际 %r" % (bad_probe,)
        assert css_unscoped(
            ".cyd-app .ok{a:b}\n"
            "@keyframes k{from{a:b}to{a:c}}\n"
            "[data-conversation-scroll]:has(.cyd-immersive)>[data-composer-seat]:not(:has([data-approval-key],"
            "[data-question-key],[data-plan-review-key])){display:none}\n"
            "/* 注释里出现 .cyd-app 也不能给别的选择器开绿灯 */.nope{a:b}\n") == ['.nope'], \
            "已作用域判据误伤：`.cyd-app` / @keyframes / `:has(.cyd-immersive)` 都必须放行，注释不得开绿灯"
        # S3（任务②）**正反两侧**（单元级；端到端那条 WARN 的措辞由 warn_copy_check 守）：
        # 正向 = 快照声明两条、只剩一条 ⇒ 0 < 失效率 ⇒ 产；三条反向 = 都在 / 无快照 / 模块不在本轮 ⇒ 都不产。
        # 注：TECH 模块的 `证据` 是**一行、逗号分隔多路径**（多行 `- 证据:` 只留最后一行 —— 与 FEATURES 不同）。
        _tech = ("# 技术地图\n\n## 模块: 渲染\n- 层: 界面\n- 职责: 画图\n- 状态: 可用\n"
                 "- 证据: src/pa.js, src/pb.js\n")
        _doc = parse_tech(_tech, [])
        (root / "src").mkdir(exist_ok=True)
        (root / "src" / "pa.js").write_text("// a\n", encoding="utf-8")
        (root / "src" / "pb.js").unlink(missing_ok=True)
        _ts = compute_tech_stale(_tech, _doc, root)
        assert _ts and _ts["modules"] == ["渲染"] and _ts["ratio"] == 0.5, \
            "S3 正向没产或产错: %r（root=%s pa存在=%s pb存在=%s）" % (
                _ts, root, (root / "src" / "pa.js").is_file(), (root / "src" / "pb.js").is_file())
        (root / "src" / "pb.js").write_text("// b\n", encoding="utf-8")
        assert compute_tech_stale(_tech, _doc, root) is None, "S3 反向①：证据都在却仍产（恒真守卫）"
        assert compute_tech_stale(None, _doc, root) is None, "S3 反向②：无快照却仍产（fail-closed 破了）"
        assert compute_tech_stale(_tech, parse_tech("# 技术地图\n\n## 模块: 别的\n- 层: 界面\n- 职责: x\n",
                                                    []), root) is None, "S3 反向③：模块不在本轮却仍产"
        # S4 搬迁检测的**单元级正反三例**（端到端那两条 WARN 的措辞 + 顺序由 warn_copy_check 的
        # 「搬迁检测-命中（产）」夹具守；这里守**判据本身**，且两条反向都要真的不产 —— 防恒真）。
        _fd_of = lambda *items: [{"path": p, "kind": "code", "change": c, "pending": False}
                                 for p, c in items]
        _tdoc = parse_tech("# 技术地图\n\n## 模块: 渲染\n- 层: 界面\n- 职责: 画图\n- 状态: 可用\n"
                           "- 证据: src/a.js\n", [])
        _fx = parse_features("# 功能地图\n\n## 功能: 甲\n- 状态: 可用\n- 简介: 甲。\n"
                             "- 证据: src/b.js\n", [])
        # 正：模块证据 src/a.js + 功能证据 src/b.js 都被标 deleted ⇒ **两侧各一**、且 tech 在前
        _mv_pos = compute_moved_evidence(_fd_of(("src/a.js", "deleted"), ("src/b.js", "deleted")),
                                         _tdoc, _fx, [], [])
        assert _mv_pos == {"tech": ["渲染"], "features": ["甲"]}, "S4 正向没产或产错: %r" % (_mv_pos,)
        # 正·补：使用流程的证据被删 ⇒ 功能侧按板块名记一次（功能/子项/使用流程/时间线**四条路径**都算）
        _mv_j = compute_moved_evidence(_fd_of(("src/c.js", "deleted")), _tdoc, _fx,
                                       [{"evidence": ["src/c.js"]}], [])
        assert _mv_j == {"tech": [], "features": ["使用流程"]}, \
            "S4 正向·补：使用流程侧没产或产错: %r" % (_mv_j,)
        # 反①：facts_detail 里根本没有这个路径（空 / 只有非 deleted 项）⇒ 不产
        assert compute_moved_evidence([], _tdoc, _fx, [], []) is None, \
            "S4 反向①：facts_detail 为空却仍产（恒真守卫）"
        assert compute_moved_evidence(_fd_of(("src/a.js", "added")), _tdoc, _fx, [], []) is None, \
            "S4 反向①b：证据路径在 facts_detail 里但不是 deleted 却仍产"
        # 反②：有 deleted，但**无人引用**那条路径 ⇒ 不产
        assert compute_moved_evidence(_fd_of(("src/zz.js", "deleted")), _tdoc, _fx, [], []) is None, \
            "S4 反向②：deleted 但无人引用却仍产（判据被「有删除就报」顶替）"
        # ---- 【3】乐观并发检查（契约 :552 形态③）：**正反两侧**（判据真的会红、且不恒真）----
        import contextlib
        _cd = Path(tmp) / "concurrency"
        _cd.mkdir()
        _cp = _cd / ".cyd.json"
        assert concurrent_edit(_cp, file_hash(_cp), ".cyd.json") is False, "反例①：文件不存在但基线同为 None ⇒ 不该报"
        _cp.write_text('{"version": 1}\n', encoding="utf-8")
        _h = file_hash(_cp)
        assert concurrent_edit(_cp, _h, ".cyd.json") is False, "反例②：没别人改却报并发（恒真守卫）"
        _cp.write_text('{"version": 1, "别人写的": true}\n', encoding="utf-8")   # 模拟另一份副本写进来
        _buf = io.StringIO()
        with contextlib.redirect_stdout(_buf):
            _hit = concurrent_edit(_cp, _h, ".cyd.json")
        assert _hit is True, "正向：读入之后被改过却没检出"
        assert "在本次读入之后被别的写者改过" in _buf.getvalue(), "正向：没说出那条 WARN：%r" % _buf.getvalue()
        assert "按最新内容重算" in _buf.getvalue(), "WARN 必须点明处置是重算，而不是只说'冲突'"
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
