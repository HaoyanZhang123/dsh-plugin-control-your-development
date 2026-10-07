/* control-your-development 仪表盘共享渲染核：网页版（双击 html 离线打开）与 DSH 面板共用。
     宿主经 env 注入能力：reload（重读数据）/ verifyWrite（写回验证）/ evidenceUrl（证据链接）/ capabilityNote / browserTab。 */
window.CYD = (function(){
const CSS = /*__CYD_CSS__*/'';
const SHELL = /*__CYD_SHELL__*/'';
const norm = t => t.replace(/\r\n?/g, '\n');  // CRLF 与 CR-only 行尾都归一
function pad(n){ return String(n).padStart(2, '0'); }
function fmtDate(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function fmtDT(d){ return fmtDate(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function kindOf(p){
  const n = p.split('/').pop().toLowerCase();
  const ext = n.includes('.') ? '.' + n.split('.').pop() : '';
  if (n.includes('test') || n.startsWith('spec')) return '测试';
  if (['.md', '.txt', '.rst', '.adoc'].includes(ext)) return '文档';
  if (['.py', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.c', '.cpp', '.h', '.java', '.go', '.rs', '.rb', '.php', '.cs', '.swift', '.kt', '.sh', '.ps1', '.html', '.css', '.vue', '.svelte', '.sql'].includes(ext)) return '代码';
  return '其他';
}
/* 最小 glob（与渲染器 scripts/render_dashboard.py 的 glob_match 同语义）：
   双星号跨目录、单星号不跨目录、问号单字符、大小写敏感；线性匹配，无正则回溯风险。 */
function segMatch(s, p){
  let si = 0, pi = 0, star = -1, mark = 0;
  while (si < s.length){
    if (pi < p.length && (p[pi] === '?' || p[pi] === s[si])){ si++; pi++; continue; }
    if (pi < p.length && p[pi] === '*'){ star = pi++; mark = si; continue; }
    if (star >= 0){ pi = star + 1; si = ++mark; continue; }
    return false;
  }
  while (pi < p.length && p[pi] === '*') pi++;
  return pi === p.length;
}
function globMatch(path, pat){
  const ss = path.split('/'), ps = pat.split('/');
  let i = 0, j = 0, star = -1, mark = 0;
  while (i < ss.length){
    if (j < ps.length && ps[j] === '**'){ star = j++; mark = i; continue; }
    if (j < ps.length && segMatch(ss[i], ps[j])){ i++; j++; continue; }
    if (star >= 0){ j = star + 1; i = ++mark; continue; }
    return false;
  }
  while (j < ps.length && ps[j] === '**') j++;
  return j === ps.length;
}


/* ---------- JS 解析器（与渲染器同契约，用于页面内刷新） ---------- */
function evError(rel){
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(rel)) return '网址（证据必须是工作区内的文件）';
  if (rel.startsWith('/') || rel.startsWith('\\')) return '绝对路径';
  if (/^[A-Za-z]:/.test(rel)) return '盘符绝对路径';
  if (rel.split(/[\\/]/).includes('..')) return '上跳目录';
  return '';
}
function stripComments(t){ return t.replace(/^\uFEFF/, '').replace(/<!--[\s\S]*?-->/g, ''); }
function splitEv(raw){ return raw.split(',').map(x => x.trim()).filter(Boolean); }
function parseProduct(text){
  const proj = { name: '未命名项目', intro: '', stage: '', direction: '', next: '', journey: [] };
  text = stripComments(text);
  const m = text.match(/^#\s+(.+)$/m);
  if (m) proj.name = m[1].trim().split(/\s[—–-]{1,2}\s/)[0].trim() || m[1].trim();
  const sec = text.split(/^##\s+/m);
  const keymap = { '阶段': 'stage', '方向': 'direction', '下一步': 'next' };
  for (let i = 1; i < sec.length; i++){
    const lines = sec[i].split('\n'), head = lines[0].trim(), body = lines.slice(1);
    if (head.startsWith('项目简介')){
      const para = [];
      for (const l of body){ if (l.trim().startsWith('#')) break; para.push(l.replace(/\s+$/, '')); }
      proj.intro = para.join('\n').trim();
    } else if (head.startsWith('当前方向')){
      for (const l0 of body){
        const mm = l0.trim().match(/^-\s*(阶段|方向|下一步)\s*[:：]\s*(.+)$/);
        if (mm) proj[keymap[mm[1]]] = mm[2].trim();
      }
    } else if (head.startsWith('使用流程')){
      for (const l0 of body){
        const mm = l0.trim().match(/^\d+\.\s*(.+)$/);
        if (!mm) continue;
        const parts = mm[1].split('::').map(x => x.trim());
        const step = { title: parts[0] || '', desc: '', evidence: [] };
        for (const p of parts.slice(1)){
          const em = p.match(/^证据\s*[:：]\s*(.+)$/);
          if (em) step.evidence = splitEv(em[1]);
          else if (!step.desc) step.desc = p;
          else step.desc += ' :: ' + p;
        }
        proj.journey.push(step);
      }
    }
  }
  return proj;
}
const STATUSES = ['设想', '进行中', '可用', '已验证', '已废弃'];
function parseFeatures(text, warnings){
  warnings = warnings || [];
  text = stripComments(text);
  const feats = []; let cur = null;
  for (const line of text.split('\n')){
    const s = line.trim();
    const hm = s.match(/^##\s*功能\s*[:：]\s*(.+)$/);
    if (hm){ if (cur) feats.push(cur); cur = { name: hm[1].trim(), status: '', desc: '', evidence: [], deps: [], verify: '' }; continue; }
    if (!cur) continue;
    const fm = s.match(/^-\s*(状态|简介|证据|依赖|验证)\s*[:：]\s*(.*)$/);
    if (!fm) continue;
    const key = fm[1], val = fm[2].trim();
    if (key === '状态') cur.status = val;
    else if (key === '简介') cur.desc = val;
    else if (key === '证据') cur.evidence = splitEv(val);
    else if (key === '依赖') cur.deps = (val === '' || val === '无') ? [] : splitEv(val);
    else if (key === '验证') cur.verify = val;
  }
  if (cur) feats.push(cur);
  const seenNames = new Set();
  feats.forEach(f => {
    if (!f.status){ warnings.push('功能「' + f.name + '」缺少状态字段'); f.status = '设想'; }
    else if (!STATUSES.includes(f.status)){ warnings.push('功能「' + f.name + '」状态非法: ' + "'" + f.status + "'" + '（允许: ' + STATUSES.join('/') + '）'); f.status = '设想'; }
    if (!f.desc){ warnings.push('功能「' + f.name + '」缺少简介'); f.desc = '[待确认: 功能简介]'; }
    if (seenNames.has(f.name)) warnings.push('功能名重复：「' + f.name + '」出现多次，依赖按首个同名解析');
    seenNames.add(f.name);
  });
  return feats;
}
function parseNow(text, warnings){
  warnings = warnings || [];
  text = stripComments(text);
  const timeline = [], decisions = [], todos = [];
  let section = null, cur = null;
  for (const line of text.split('\n')){
    const s = line.trim();
    const h2 = s.match(/^##(?!#)\s*(.+)$/);
    if (h2){ const head = h2[1]; section = head.startsWith('时间线') ? 'tl' : head.startsWith('决策') ? 'dec' : head.startsWith('待办') ? 'todo' : null; continue; }
    const h3 = s.match(/^###\s*(D\d+)\s+(.+)$/);
    if (section === 'dec' && h3){ cur = { id: h3[1], title: h3[2].trim(), decided: '', options: [], multi: false }; decisions.push(cur); continue; }
    if (section === 'tl'){
      const tm = s.match(/^-\s*(.+)$/);
      if (tm){
        const parts = tm[1].split('|').map(x => x.trim());
        const e = { dt: parts[0], text: '', evidence: [] };
        for (const p of parts.slice(1)){
          const em = p.match(/^证据\s*[:：]\s*(.+)$/);
          if (em) e.evidence = splitEv(em[1]);
          else e.text = e.text ? e.text + ' | ' + p : p;
        }
        if (!e.text){ e.text = e.dt; e.dt = ''; }
        timeline.push(e);
      }
    } else if (section === 'dec' && cur){
      const sm = s.match(/^-\s*状态\s*[:：]\s*已定\s*([A-Za-z](?:\s*[、,，\s]\s*[A-Za-z])*)\s*$/);
      if (sm){ cur.decided = sm[1].toUpperCase().replace(/[\s,，]+/g, '、'); continue; }
      const mm2 = s.match(/^-\s*多选\s*[:：]\s*是\s*$/);
      if (mm2){ cur.multi = true; continue; }
      const om = s.match(/^-\s*([A-Z])\s*[:：]\s*(.+)$/);
      if (om) cur.options.push({ key: om[1], text: om[2].trim() });
    } else if (section === 'todo'){
      const dm = s.match(/^-\s*\[( |x|X)\]\s*(.+)$/);
      if (dm) todos.push({ done: dm[1].toLowerCase() === 'x', text: dm[2].trim() });
    }
  }
  decisions.forEach(d => {
    if (!d.decided) return;
    d.decided.split('、').forEach(k => {
      if (!d.options.some(o => o.key === k)) warnings.push('决策 ' + d.id + ' 标为已定 ' + k + '，但没有对应选项');
    });
  });
  return { timeline, decisions, todos };
}
function layoutGraph(feats, warnings){
  warnings = warnings || [];
  const active = feats.filter(f => f.status !== '已废弃');
  const byName = {};
  active.forEach(f => { if (!(f.name in byName)) byName[f.name] = f; });
  const idx = new Map(active.map((f, i) => [f, i]));
  const edges = active.map(f => f.deps.filter(d => d in byName).map(d => idx.get(byName[d])));
  const resolved = {};
  const remaining = new Set(active.map((f, i) => i));
  let changed = true;
  while (remaining.size && changed){
    changed = false;
    for (const i of [...remaining].sort((a, b) => a - b)){
      if (edges[i].every(d => d in resolved)){
        resolved[i] = edges[i].length ? Math.max.apply(null, edges[i].map(d => resolved[d])) + 1 : 0;
        remaining.delete(i);
        changed = true;
      }
    }
  }
  for (const i of [...remaining].sort((a, b) => a - b)){
    warnings.push('依赖关系存在环（涉及「' + active[i].name + '」），该节点按第 0 层布局');
    resolved[i] = 0;
  }
  const per = {};
  active.forEach((f, i) => {
    const lv = resolved[i] || 0;
    const n = per[lv] || 0; per[lv] = n + 1;
    f.x = 110 + lv * 235; f.y = 75 + n * 88;
  });
  return feats;
}


/* ---------- 数据组装（网页版与面板共用，两端唯一事实源） ---------- */
/* parts: { prod, feat, now, factsRaw?, ignoreRaw?, workspace_uri?, updated_at? }；existsFn: async path => bool */
async function assembleData(parts, existsFn){
  const warnings = [];
  const project = parseProduct(norm(parts.prod));
  const features = layoutGraph(parseFeatures(norm(parts.feat), warnings), warnings);
  const nw = parseNow(norm(parts.now), warnings);
  const normPath = p => String(p).replace(/\\/g, '/');
  const pairs = [];
  const collect = (owner, list) => (list || []).forEach(p => {
    const rel = normPath(p);
    pairs.push({ owner, path: rel, err: evError(rel) });
  });
  features.forEach(f => collect(f.name, f.evidence));
  project.journey.forEach(j => collect('使用流程', j.evidence));
  nw.timeline.forEach(t => collect('时间线', t.evidence));
  const uniq = [...new Set(pairs.filter(p => !p.err).map(p => p.path.replace(/^\//, '')))];
  const exMap = {};
  await Promise.all(uniq.map(async p => { try{ exMap[p] = await existsFn(p); }catch(e){ exMap[p] = false; } }));
  const withEx = list => (list || []).map(p => {
    const rel = normPath(p);
    if (evError(rel)) return { path: rel, exists: false };
    const key = rel.replace(/^\//, '');
    return { path: key, exists: !!exMap[key] };
  });
  features.forEach(f => f.evidence = withEx(f.evidence));
  project.journey.forEach(j => j.evidence = withEx(j.evidence));
  nw.timeline.forEach(t => t.evidence = withEx(t.evidence));
  const invalid = [...new Set(pairs.filter(p => p.err).map(p => p.path))];
  const ignore = parts.ignoreRaw ? norm(parts.ignoreRaw).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')) : [];
  let facts = [], factsError = '', factsSource = '';
  if (!parts.factsRaw) factsError = 'missing';
  else { try { const parsed = JSON.parse(norm(parts.factsRaw)); facts = parsed.items || []; factsSource = parsed.source || ''; } catch (e){ factsError = 'corrupt'; } }
  const evSet = new Set(pairs.map(p => p.path.replace(/^\//, '')));
  let pending = 0;
  const fd = facts.map(it => {
    const p = normPath(it.path || '');
    const hit = evSet.has(p) || ignore.some(pat => globMatch(p, pat));
    if (!hit) pending++;
    return { path: p, kind: it.kind || '', change: it.change || '', pending: !hit };
  });
  const missing = uniq.filter(p => !exMap[p]);
  const noVerify = features.filter(f => f.status === '已验证' && !f.verify).map(f => f.name);
  const counts = {};
  STATUSES.forEach(s => counts[s] = 0);
  features.forEach(f => counts[f.status] = (counts[f.status] || 0) + 1);
  counts.total_active = counts['设想'] + counts['进行中'] + counts['可用'] + counts['已验证'];
  const seen = {}; const matrix = [];
  for (const pr of pairs){
    const key = pr.path;
    if (!seen[key]){
      seen[key] = { path: key, owners: [pr.owner], kind: kindOf(key), exists: !pr.err && !!exMap[key.replace(/^\//, '')] };
      matrix.push(seen[key]);
    } else if (!seen[key].owners.includes(pr.owner)) seen[key].owners.push(pr.owner);
  }
  matrix.sort((a, b) => a.path < b.path ? -1 : 1);
  // 缺失 .facts.json 只表示还没采集（提示即可）；损坏表示门禁不可用（不健康）
  const ok = missing.length === 0 && invalid.length === 0 && pending === 0 && factsError !== 'corrupt' && noVerify.length === 0;
  return { project, features, timeline: nw.timeline, decisions: nw.decisions, todos: nw.todos, counts,
    workspace_uri: parts.workspace_uri, updated_at: parts.updated_at || fmtDT(new Date()),
    health: { ok, matrix, evidence_missing: missing, evidence_invalid: invalid,
              facts_pending: pending, facts_error: factsError, source: factsSource, verify_missing: noVerify,
              facts: fd, ignore, warnings } };
}

function initDashboard(rootEl, env){
  if (CSS && typeof document !== 'undefined' && !document.querySelector('style[data-cyd-core]')){
    const st = document.createElement('style');
    st.setAttribute('data-cyd-core', '1');
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  let DATA = env.data;
let lastJson = JSON.stringify(env.data);
let docKeyHandler = null;   // 全局只保留一个 Esc 处理器：init 幂等
  const qs = s => rootEl.querySelector(s);
  const qsa = s => Array.from(rootEl.querySelectorAll(s));
  rootEl.classList.add('cyd-app');
  if (SHELL) rootEl.innerHTML = SHELL;

const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SMAP = {"设想":1,"进行中":2,"可用":3,"已验证":4,"已废弃":5};
const SCOLOR = {"设想":"var(--gray)","进行中":"var(--accent)","可用":"var(--warn)","已验证":"var(--ok)","已废弃":"var(--ink2)"};
const SSOFT = {"设想":"var(--gray-soft)","进行中":"var(--accent-soft)","可用":"var(--warn-soft)","已验证":"var(--ok-soft)","已废弃":"var(--gray-soft)"};
const TL_SHOW = 30;
let currentTab = 'project', currentFilter = 'all';
const ACT = () => DATA.features.filter(f => f.status !== '已废弃');
const DEPR = () => DATA.features.filter(f => f.status === '已废弃');

/* ---------- 自动链接：D 编号 → 决策卡，「功能名」→ 功能卡 ---------- */
function linkify(s){
  s = s.replace(/\bD(\d+)\b/g, '<a class="lk" data-jd="D$1">D$1</a>');
  const names = DATA.features.map(f => f.name).filter(n => n.length >= 2).sort((a, b) => b.length - a.length);
  if (names.length){
    const re = new RegExp('「(' + names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')」', 'g');
    s = s.replace(re, '<a class="lk" data-jf="$1" tabindex="0" role="button">「$1」</a>');
  }
  return s;
}


/* ---------- 证据：链接与否由宿主决定 ---------- */
function evHtml(list){
  return (list || []).map(e => {
    const canOpen = e.exists && env.evidenceAction;
    const url = !canOpen && e.exists && env.evidenceUrl ? env.evidenceUrl(e.path) : null;
    if (canOpen) return '<span class="evrow"><button class="min" data-ev="' + esc(e.path) + '" title="打开文件" style="font-size:12.5px;padding:3px 10px">📄 ' + esc(e.path) + '</button><button class="min" data-cp="' + esc(e.path) + '" title="复制路径">⧉</button></span>';
    if (url) return '<span class="evrow"><a href="' + url + '" target="_blank" rel="noopener" title="在浏览器中打开">📄 ' + esc(e.path) + '</a><button class="min" data-cp="' + esc(e.path) + '" title="复制路径">⧉</button></span>';
    if (!e.exists) return '<span class="evrow"><a class="miss" title="' + esc(e.path) + '（路径不存在）">📄 ' + esc(e.path) + '</a></span>';
    return '<span class="evrow"><button class="min" data-cp="' + esc(e.path) + '" title="点击复制路径" style="font-size:12.5px;padding:3px 10px">📄 ' + esc(e.path) + '</button></span>';
  }).join('');
}

/* ---------- 掌控条（五徽章，全部可点） ---------- */
function renderStrip(){
  const d = DATA, active = d.counts.total_active || 0, verified = d.counts['已验证'] || 0;
  const pending = d.decisions.filter(x => !x.decided).length;
  const h =
    '<button class="pill" data-act="stage" title="查看当前方向"><div class="k">当前阶段</div><div class="v">' + esc(d.project.stage || '—') + '</div></button>'
    + '<div class="pill static"><div class="k">数据更新于</div><div class="v">' + esc(d.updated_at) + ' <button class="min" id="updBtn" title="重新读取文件并刷新页面">🔄 更新</button></div></div>'
    + '<button class="pill" data-act="verify" title="去功能地图验收"><div class="k">功能验证</div><div class="v">✅ ' + verified + ' / ' + active + '</div></button>'
    + '<button class="pill ' + (pending ? 'alert' : 'good') + '" data-act="decide" title="打开拍板中心"><div class="k">等你拍板</div><div class="v">' + (pending ? '⚠ ' + pending + ' 件' : '✅ 无') + '</div></button>'
    + '<button class="pill ' + (d.health.ok ? 'good' : 'alert') + '" data-act="health" title="查看完整审计"><div class="k">数据健康</div><div class="v">' + (d.health.ok ? '✅ 完整' : '⚠ 待整理') + '</div></button>';
  qs('#strip').innerHTML = h;
  qs('#projName').firstChild.textContent = d.project.name + ' ';
  if (env.browserTab) document.title = d.project.name + ' · 开发仪表盘';
  qsa('#strip [data-act]').forEach(b => b.onclick = () => stripAct(b.dataset.act));
  qs('#updBtn').onclick = e => { e.stopPropagation(); doRefresh(); };
}
function stripAct(a){
  if (a === 'stage'){ gotoTab('project'); flashEl('cardIntro'); }
  else if (a === 'verify'){ gotoTab('features'); }
  else if (a === 'decide'){ openDecisionCenter(); }
  else if (a === 'health'){ openAudit(); }
}
function gotoTab(name){ const b = qs('nav.tabs button[data-tab="' + name + '"]'); if (b) b.click(); }
function flashEl(id){
  const el = qs('#' + id); if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
}

/* ---------- 项目 Tab ---------- */
function renderProject(){
  const p = DATA.project;
  let h = '<div class="card" id="cardIntro"><h3>项目简介</h3><p class="lede">' + linkify(esc(p.intro || '（尚未填写项目简介）')) + '</p>';
  const tags = [];
  if (p.direction) tags.push('当前方向：' + p.direction);
  if (p.next) tags.push('下一步：' + p.next);
  if (tags.length) h += '<div>' + tags.map(t => '<span class="tag">' + linkify(esc(t)) + '</span>').join('') + '</div>';
  h += '</div>';
  if (p.journey && p.journey.length){
    h += '<div class="card"><h3>它怎么用（真实使用流程）</h3><ol class="steps">';
    p.journey.forEach((j, i) => {
      h += '<li data-n="' + (i + 1) + '"><b>' + esc(j.title) + '</b><br><span class="muted">' + linkify(esc(j.desc)) + '</span>';
      if (j.evidence && j.evidence.length) h += '<div class="ev">' + evHtml(j.evidence) + '</div>';
      h += '</li>';
    });
    h += '</ol></div>';
  }
  qs('#project').innerHTML = h;
}

/* ---------- 功能地图 Tab ---------- */
function renderFeatures(){
  let h = '';
  if (ACT().some(f => f.deps && f.deps.length)){
    h += '<div class="graphbox"><div class="ghead"><b>功能关系图</b><span>滚轮缩放 · 拖背景平移 · 拖节点调整位置 · 点节点看速览</span></div>'
      + '<div class="legend"><span><i style="background:var(--gray)"></i>设想</span><span><i style="background:var(--accent)"></i>进行中</span><span><i style="background:var(--warn)"></i>可用</span><span><i style="background:var(--ok)"></i>已验证</span></div>'
      + '<svg id="graph" viewBox="0 0 960 340"></svg><div class="nodepop" id="nodePop"></div></div>';
  }
  h += '<div class="filters" id="featFilters"></div>';
  const v = DATA.counts['已验证'] || 0, t = DATA.counts.total_active || 0, pct = t ? Math.round(v / t * 100) : 0;
  h += '<div class="progress"><i style="width:' + pct + '%"></i></div><div class="plabel">进度只统计你亲手验证过的功能（' + v + '/' + t + '）——点开功能卡可查看详情、一键验证</div>';
  h += '<div class="grid" id="featGrid"></div>';
  qs('#features').innerHTML = h;
  const counts = DATA.counts;
  const filt = [['all', '全部 ' + (ACT().length + DEPR().length)]];
  ['设想', '进行中', '可用', '已验证', '已废弃'].forEach(s => { if (counts[s]) filt.push([s, s + ' ' + counts[s]]); });
  qs('#featFilters').innerHTML = filt.map((f, i) => '<button data-f="' + f[0] + '" class="' + (i ? '' : 'on') + '">' + f[1] + '</button>').join('');
  qsa('#featFilters button').forEach(b => b.onclick = () => {
    qsa('#featFilters button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); currentFilter = b.dataset.f; renderCards(currentFilter);
  });
  renderCards(currentFilter);
  renderGraph();
}
function featCard(f){
  const dep = f.status === '已废弃';
  let h = '<div class="feat' + (dep ? ' deprecated' : '') + '" id="feat-' + esc(f.name) + '" data-fname="' + esc(f.name) + '" tabindex="0" role="button" title="点击或按回车查看详情">'
    + '<h3>' + esc(f.name) + ' <span class="badge b-x' + SMAP[f.status] + '">' + esc(f.status) + '</span></h3>'
    + '<p class="muted" style="margin:4px 0 0">' + esc(f.desc) + '</p>';
  if (f.evidence && f.evidence.length) h += '<div class="ev">' + evHtml(f.evidence) + '</div>';
  if (f.verify) h += '<div class="verifier">' + esc(f.verify) + '</div>';
  else if (f.status === '可用') h += '<div class="verifier">🤖 标记可用，等你试用</div>';
  else if (f.status === '进行中') h += '<div class="verifier">🤖 开发中</div>';
  return h + '</div>';
}
function renderCards(f){
  const grid = qs('#featGrid');
  const list = f === 'all' ? DATA.features : DATA.features.filter(x => x.status === f);
  grid.innerHTML = list.length ? list.map(featCard).join('') : '<div class="empty">暂无该状态的功能</div>';
  grid.querySelectorAll('.feat').forEach(c => c.onclick = e => {
    if (e.target.closest('a,button,input,textarea')) return;
    openFeatDetail(c.dataset.fname);
  });
}

/* ---------- 关系图（节点浮卡） ---------- */
function renderGraph(){
  const svg = qs('#graph'); if (!svg) return;
  const pop = qs('#nodePop');
  const NS = 'http://www.w3.org/2000/svg', NW = 150, NH = 42;
  const gWorld = document.createElementNS(NS, 'g'); svg.appendChild(gWorld);
  const feats = ACT();
  const byName = {}; feats.forEach(f => byName[f.name] = f);
  const edges = [];
  function edgeD(a, b){
    const x1 = a.x + NW / 2, y1 = a.y, x2 = b.x - NW / 2, y2 = b.y, mx = (x1 + x2) / 2;
    return 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
  }
  feats.forEach(f => (f.deps || []).forEach(dn => {
    const a = byName[dn]; if (!a) return;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', edgeD(a, f)); p.setAttribute('class', 'edge'); gWorld.appendChild(p);
    edges.push({ path: p, from: a, to: f });
  }));
  function redraw(f){ edges.forEach(e => { if (e.from === f || e.to === f) e.path.setAttribute('d', edgeD(e.from, e.to)); }); }
  let dragNode = null, moved = false;
  let tx = 0, ty = 0, k = 1;
  function applyT(){ gWorld.setAttribute('transform', 'translate(' + tx + ',' + ty + ') scale(' + k + ')'); }
  function showPop(f){
    const rect = svg.getBoundingClientRect();
    const sx = rect.width / 960, sy = rect.height / 340;
    let left = (f.x * k + tx) * sx + 14, top = (f.y * k + ty) * sy - 20;
    left = Math.max(8, Math.min(left, rect.width - 245));
    top = Math.max(8, Math.min(top, rect.height - 110));
    pop.innerHTML = '<h4>' + esc(f.name) + ' <span class="badge b-x' + SMAP[f.status] + '">' + esc(f.status) + '</span></h4><p>' + esc(f.desc) + '</p><span class="go">点击查看详情 →</span>';
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    pop.classList.add('on');
    pop.onclick = ev => { ev.stopPropagation(); pop.classList.remove('on'); openFeatDetail(f.name); };
  }
  feats.forEach(f => {
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'node');
  g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button');
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', -NW / 2); r.setAttribute('y', -NH / 2); r.setAttribute('width', NW); r.setAttribute('height', NH); r.setAttribute('rx', 12);
    r.style.fill = SSOFT[f.status]; r.style.stroke = SCOLOR[f.status];
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', 0); t.setAttribute('y', 4); t.setAttribute('text-anchor', 'middle');
    t.style.fill = SCOLOR[f.status]; t.textContent = f.name;
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', -NW / 2 + 14); dot.setAttribute('cy', 0); dot.setAttribute('r', 4); dot.style.fill = SCOLOR[f.status];
    g.appendChild(r); g.appendChild(t); g.appendChild(dot); gWorld.appendChild(g);
    g.setAttribute('transform', 'translate(' + f.x + ',' + f.y + ')');
    g.addEventListener('pointerdown', e => { e.stopPropagation(); dragNode = { f, g, sx: e.clientX, sy: e.clientY }; moved = false; try{ g.setPointerCapture(e.pointerId); }catch(err){} });
    g.addEventListener('pointerup', () => { if (dragNode && dragNode.f === f && !moved) showPop(f); });
  });
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const nk = Math.min(3, Math.max(.4, k * (e.deltaY < 0 ? 1.12 : 0.89)));
    tx = mx - (mx - tx) * (nk / k); ty = my - (my - ty) * (nk / k); k = nk; applyT();
  }, { passive: false });
  let panning = false, sx = 0, sy = 0;
  svg.addEventListener('pointerdown', e => { panning = true; sx = e.clientX - tx; sy = e.clientY - ty; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', e => {
    if (dragNode){
      if (!moved && Math.hypot(e.clientX - dragNode.sx, e.clientY - dragNode.sy) < 4) return;
      moved = true;
      const rect = svg.getBoundingClientRect();
      const wx = (e.clientX - rect.left - tx) / k, wy = (e.clientY - rect.top - ty) / k;
      dragNode.f.x = wx; dragNode.f.y = wy;
      dragNode.g.setAttribute('transform', 'translate(' + wx + ',' + wy + ')');
      redraw(dragNode.f); return;
    }
    if (!panning) return; tx = e.clientX - sx; ty = e.clientY - sy; applyT();
  });
  svg.addEventListener('pointerup', () => { panning = false; dragNode = null; });
}

/* ---------- 现在 Tab（时间线 + 拍板撰写器 + 待办） ---------- */
function decidedKeys(dc){ return dc.decided ? dc.decided.split(/[、,]/) : []; }
function decisionHtml(dc){
  const keys = decidedKeys(dc);
  let h = '<div class="decision' + (dc.decided ? ' decided' : '') + '" id="dec-' + esc(dc.id) + '"><div class="did">决策 ' + esc(dc.id) + (dc.decided ? ' · 已定 ' + esc(dc.decided) : ' · 等你拍板' + (dc.multi ? '（可多选）' : '')) + '</div><h4>' + (dc.decided ? '✅ ' : '⚠ ') + esc(dc.title) + '</h4>';
  dc.options.forEach(o => {
    if (dc.decided){
      h += '<button class="optbtn" disabled><b>' + esc(o.key) + '</b><span>' + esc(o.text) + (keys.includes(o.key) ? ' <span class="chosen">✓ 已定</span>' : '') + '</span></button>';
    } else {
      h += '<button class="optbtn selable" data-did="' + esc(dc.id) + '" data-key="' + esc(o.key) + '"><b>' + esc(o.key) + '</b><span>' + esc(o.text) + '</span><span class="tick">✓</span></button>';
    }
  });
  if (!dc.decided){
    h += '<textarea class="note" data-note="' + esc(dc.id) + '" placeholder="补充说明（可选，复制时会一并带上）"></textarea>';
    h += '<button class="copybtn" data-copydec="' + esc(dc.id) + '">📋 复制拍板</button>';
    h += '<p class="dhint">先点选选项' + (dc.multi ? '（可多选）' : '') + '，需要的话写句补充 → 点「复制拍板」→ 粘贴到聊天框发送，我就能带着完整上下文执行</p>';
  }
  return h + '</div>';
}
// 选择与补充说明以 DOM 为准（不带外挂状态）：重渲染后屏幕上看到什么，复制出去就是什么
function bindComposers(root){
  root.querySelectorAll('.optbtn.selable').forEach(b => b.onclick = () => {
    const did = b.dataset.did;
    const dc = DATA.decisions.find(x => x.id === did);
    const group = root.querySelectorAll('.optbtn.selable[data-did="' + did + '"]');
    if (dc && dc.multi){ b.classList.toggle('sel'); return; }
    const was = b.classList.contains('sel');
    group.forEach(x => x.classList.remove('sel'));
    if (!was) b.classList.add('sel');
  });
  root.querySelectorAll('[data-copydec]').forEach(b => b.onclick = () => copyDecision(root, b.dataset.copydec));
}
function copyDecision(root, did){
  const dc = DATA.decisions.find(x => x.id === did); if (!dc) return;
  const sel = Array.from(root.querySelectorAll('.optbtn.selable[data-did="' + did + '"].sel')).map(x => x.dataset.key);
  const keys = sel.slice().sort((a, b) => dc.options.findIndex(o => o.key === a) - dc.options.findIndex(o => o.key === b));
  const ta = root.querySelector('textarea[data-note="' + did + '"]');
  const note = (ta ? ta.value : '').trim();
  if (!keys.length && !note) return toast('请先点选选项，或填写补充说明');
  let msg = '拍板 ' + did + '「' + dc.title + '」：';
  if (keys.length) msg += '选 ' + keys.join('、');
  if (note) msg += (keys.length ? '；' : '') + '补充：' + note;
  copyText(msg);
}
function renderNow(){
  const d = DATA;
  let left = '<div class="card"><h3>进展时间线（人话版）</h3>';
  if (d.timeline.length){
    left += '<ul class="tl" id="tl">';
    d.timeline.forEach((t, i) => {
      left += '<li class="' + (i < TL_SHOW ? '' : 'old') + '"><time>' + esc(t.dt) + '</time><br>' + linkify(esc(t.text));
      if (t.evidence && t.evidence.length) left += '<div class="ev">' + evHtml(t.evidence) + '</div>';
      left += '</li>';
    });
    left += '</ul>';
    if (d.timeline.length > TL_SHOW) left += '<button id="moreTl">查看更早的 ' + (d.timeline.length - TL_SHOW) + ' 条 ▾</button>';
  } else left += '<div class="empty">还没有进展记录</div>';
  left += '</div>';
  let right = '';
  d.decisions.forEach(dc => { right += decisionHtml(dc); });
  if (d.todos.length){
    right += '<div class="card"><h3>待办</h3>' + d.todos.map(t => '<div class="todo"><input type="checkbox" ' + (t.done ? 'checked ' : '') + 'disabled><span>' + linkify(esc(t.text)) + '</span></div>').join('') + '</div>';
  }
  qs('#now').innerHTML = '<div class="cols"><div>' + left + '</div><div>' + (right || '<div class="empty">暂无待拍板的决策和待办</div>') + '</div></div>';
  const more = qs('#moreTl');
  if (more) more.onclick = function(){
    const tl = qs('#tl'); tl.classList.toggle('showold');
    this.textContent = tl.classList.contains('showold') ? '收起 ▴' : ('查看更早的 ' + (d.timeline.length - TL_SHOW) + ' 条 ▾');
  };
  bindComposers(qs('#now'));
}

/* ---------- 弹层：拍板中心 / 审计 / 功能详情 ---------- */
function openSheet(title, body){
  qs('#sheet').innerHTML = '<div class="sheethead"><h3>' + title + '</h3><button class="xbtn" data-x title="关闭">✕</button></div><div class="sheetbody">' + body + '</div>';
  qs('#ovl').classList.add('on');
}
function closeSheet(){ qs('#ovl').classList.remove('on'); }

function openDecisionCenter(){
  const pend = DATA.decisions.filter(d => !d.decided), done = DATA.decisions.filter(d => d.decided);
  let h = '';
  if (!pend.length) h += '<div class="empty">当前没有待拍板的决策</div>';
  pend.forEach(dc => h += decisionHtml(dc));
  if (done.length) h += '<details><summary>已定历史（' + done.length + ' 件，保留备查）</summary>' + done.map(decisionHtml).join('') + '</details>';
  openSheet('⚖ 等你拍板（' + pend.length + ' 件）', h);
  bindComposers(qs('#sheet'));
}

function openAudit(){
  const h = DATA.health;
  let s = '';
  s += '<p class="muted">有 <b>' + h.facts_pending + '</b> 处改动还没记进看板 · <b>' + h.evidence_missing.length + '</b> 个引用的文件找不到'
    + ((h.evidence_invalid && h.evidence_invalid.length) ? (' · <b>' + h.evidence_invalid.length + '</b> 个引用写到了项目外面（不允许）') : '')
    + ((h.verify_missing && h.verify_missing.length) ? (' · <b>' + h.verify_missing.length + '</b> 个功能标了已验证却没写验证记录') : '')
    + ((h.facts_error === 'corrupt') ? ' · 变更记录文件损坏，请重新采集' : (h.facts_error === 'missing' ? ' · 还没采集过变更' : ''))
    + ' · 变更来源：' + (h.source === 'git' ? '代码仓库变更记录' : (h.source ? '文件修改时间' : '尚未采集')) + '</p>';
  s += '<h4 style="margin:14px 0 6px">这次发现的改动（' + (h.facts || []).length + ' 条）</h4>';
  if (h.facts && h.facts.length){
    s += '<table><tr><th>文件</th><th>类型</th><th>改动</th><th>记进看板了吗</th></tr>'
      + h.facts.map(x => '<tr><td>' + esc(x.path) + '</td><td>' + esc(x.kind) + '</td><td>' + esc(x.change) + '</td><td>' + (x.pending ? '⚠ 还没记' : '✅ 已记') + '</td></tr>').join('') + '</table>';
  } else s += '<p class="muted">这次没有发现改动。</p>';
  s += '<h4 style="margin:14px 0 6px">功能引用的文件（' + h.matrix.length + ' 条）</h4>';
  if (h.matrix.length){
    s += '<table><tr><th>文件</th><th>哪个功能在用</th><th>类型</th><th>文件在吗</th></tr>'
      + h.matrix.map(r => '<tr><td>' + esc(r.path) + '</td><td>' + esc(r.owners.join(' / ')) + '</td><td>' + esc(r.kind) + '</td><td>' + (r.exists ? '✅' : '⚠ 缺失') + '</td></tr>').join('') + '</table>';
  } else s += '<p class="muted">还没有功能登记引用文件。</p>';
  s += '<h4 style="margin:14px 0 6px">不用管的文件（内部工具、其他产品等；列在这里就不算产品改动）</h4>';
  s += (h.ignore && h.ignore.length) ? h.ignore.map(p => '<code style="display:block;margin:3px 0">' + esc(p) + '</code>').join('') : '<p class="muted">无。</p>';
  openSheet('🩺 数据健康 · 完整审计', s);
}

function openFeatDetail(name){
  const f = DATA.features.find(x => x.name === name); if (!f) return;
  const title = esc(f.name) + ' <span class="badge b-x' + SMAP[f.status] + '">' + esc(f.status) + '</span>';
  let h = '<p class="lede">' + esc(f.desc) + '</p>';
  if (f.verify) h += '<div class="kv"><b>验证</b>' + esc(f.verify) + '</div>';
  else if (f.status === '可用') h += '<div class="kv"><b>验证</b>🤖 已标为可用，等你试用后盖章</div>';
  else if (f.status === '进行中') h += '<div class="kv"><b>验证</b>🤖 开发中</div>';
  if (f.evidence && f.evidence.length) h += '<div class="kv"><b>证据</b><span class="muted">（点击可打开，⧉ 复制路径）</span></div><div class="ev">' + evHtml(f.evidence) + '</div>';
  if (f.deps && f.deps.length) h += '<div class="kv"><b>需要先有</b>' + f.deps.map(n => '<span class="depc" data-dep="' + esc(n) + '">' + esc(n) + '</span>').join('') + '</div>';
  const used = DATA.features.filter(x => (x.deps || []).includes(f.name));
  if (used.length) h += '<div class="kv"><b>这些功能需要它</b>' + used.map(x => '<span class="depc" data-dep="' + esc(x.name) + '">' + esc(x.name) + '</span>').join('') + '</div>';
  h += '<div class="actrow">';
  if (f.status === '可用') h += '<button class="actbtn primary" data-verify="' + esc(f.name) + '">' + (env.verifyWrite ? '✅ 我已验证' : '✅ 我已验证（复制指令）') + '</button>';
  if (f.status === '设想') h += '<button class="actbtn" data-cmd="把「' + esc(f.name) + '」标为进行中">📋 生成指令：开始做这个</button>';
  if (f.status === '可用' || f.status === '已验证') h += '<button class="actbtn" data-cmd="把「' + esc(f.name) + '」标为进行中">📋 生成指令：返工重做</button>';
  if (f.status === '已验证') h += '<button class="actbtn" data-cmd="撤销「' + esc(f.name) + '」的验证">📋 生成指令：撤销验证</button>';
  if (f.status === '已废弃') h += '<button class="actbtn" data-cmd="把「' + esc(f.name) + '」恢复为设想">📋 生成指令：恢复为设想</button>';
  if (f.status !== '已废弃') h += '<button class="actbtn" data-cmd="废弃「' + esc(f.name) + '」">📋 生成指令：废弃</button>';
  h += '</div>';
  if (f.status === '可用') h += '<p class="dhint">' + (env.verifyWrite ? '「我已验证」会直接更新你的记录（功能状态 + 时间线）；其余按钮生成一句话指令，粘贴到聊天框我来执行。' : '这个入口不能直接改文件：「我已验证」会复制一句话指令，粘贴到聊天框发送，我来替你写入（功能状态 + 时间线）。其余按钮同样是复制指令。') + '</p>';
  else if (f.status === '进行中') h += '<p class="dhint">开发完成后我会把它标为「可用」，届时这里才会出现「✅ 我已验证」按钮。</p>';
  else if (f.status === '已验证') h += '<p class="dhint">「撤销验证」会退回到「可用」等你重新验收（功能没坏，只是撤回盖章）；按钮均生成指令发给我执行。</p>';
  else h += '<p class="dhint">状态变更属于工作请求：按钮生成指令，粘贴到聊天框我来执行。</p>';
  h += '<p class="dhint">' + (env.capabilityNote || '') + '</p>';
  openSheet(title, h);
  const sh = qs('#sheet');
  sh.querySelectorAll('[data-dep]').forEach(b => b.onclick = () => openFeatDetail(b.dataset.dep));
  sh.querySelectorAll('[data-cmd]').forEach(b => b.onclick = () => copyText(b.dataset.cmd));
  const vb = sh.querySelector('[data-verify]');
  if (vb) vb.onclick = () => {
    const row = sh.querySelector('.actrow');
    if (!row) return;
    const canWrite = !!env.verifyWrite;
    row.innerHTML = '<span class="muted" style="font-size:13px">你已经在真实使用中试过「' + esc(name) + '」了吗？'
      + (canWrite ? '确认后会写入「已验证」并在时间线记一笔：' : '确认后会复制一句话指令，粘贴到聊天框发送，我来写入「已验证」并记一笔时间线：')
      + '</span>'
      + '<button class="actbtn primary" data-cfy>' + (canWrite ? '确认：我已验证' : '复制指令：我已验证') + '</button>'
      + '<button class="actbtn" data-cfn>取消</button>';
    row.querySelector('[data-cfy]').onclick = ev => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = canWrite ? '写入中…' : '复制中…'; doVerify(name); };
    row.querySelector('[data-cfn]').onclick = () => openFeatDetail(name);
  };
}


/* ---------- 刷新与验证（能力由宿主经 env 注入） ---------- */
function applyData(d, quiet){ if (!d) return false;
  const j = JSON.stringify(d);
  if (quiet && j === lastJson) return false;   // 内容没变就不重排 DOM（面板文件流高频触发）
  DATA = d; lastJson = j; renderAll(); return true; }
function doRefresh(){
  return Promise.resolve()
    .then(() => env.reload())
    .then(d => { if (d){ applyData(d); toast('✅ 已重新读取，页面已刷新'); } else { copyText('更新一下仪表盘'); toast('已复制指令，粘贴到聊天框让我更新'); } })
    .catch(e => { console.warn(e); toast('读取失败：' + (e && e.message ? e.message : e)); });
}
function doRefreshQuiet(){ return Promise.resolve().then(() => env.reload()).then(d => applyData(d, true)).catch(() => {}); }
async function doVerify(name){
  // 无论成功、复制还是失败，都要把弹层里的按钮恢复到可用状态（否则会一直卡在"中…"）
  const restore = () => { try { openFeatDetail(name); } catch (e) { /* 弹层已关闭也无所谓 */ } };
  try{
    const res = env.verifyWrite ? await env.verifyWrite(name) : 'fallback';
    if (res === 'ok'){ closeSheet(); await doRefreshQuiet(); toast('✅ 已写入「已验证」'); return; }
    copyText('「' + name + '」我验证过了');
    toast('指令已复制——粘贴到聊天框发送，我来写入「已验证」');
    restore();
  }catch(e){
    console.warn(e);
    copyText('「' + name + '」我验证过了');
    toast('写回失败（' + (e && e.name ? e.name : '未知错误') + '），指令已复制备用');
    restore();
  }
}

/* ---------- 页脚（数据健康摘要） ---------- */
function renderFooter(){
  const h = DATA.health;
  const src = h.source === 'git' ? '代码仓库变更记录' : (h.source ? '文件修改时间' : '尚未采集');
  let txt = '数据健康：';
  txt += h.facts_pending ? ('⚠ ' + h.facts_pending + ' 条变更待整理 · ') : '变更全部已收录 ✅ · ';
  txt += h.evidence_missing.length ? ('⚠ ' + h.evidence_missing.length + ' 条引用文件找不到') : '引用文件都在 ✅';
  if (h.evidence_invalid && h.evidence_invalid.length) txt += ' · ⚠ ' + h.evidence_invalid.length + ' 条引用写到了项目外面';
  if (h.verify_missing && h.verify_missing.length) txt += ' · ⚠ ' + h.verify_missing.length + ' 个功能标了已验证但没写验证记录';
  if (h.facts_error === 'corrupt') txt += ' · ⚠ 变更记录文件损坏，请重新采集';
  if (h.facts_error === 'missing') txt += ' · 还没采集过变更';
  txt += ' · 来源：' + src;
  txt += ' · 点顶部「数据健康」查看完整审计';
  qs('#foot').innerHTML = txt;
}

/* ---------- 复制 / toast ---------- */
function copyText(t){
  const done = () => toast('✓ 已复制，去聊天框粘贴发送');
  if (navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(done).catch(() => fallback()); } else fallback();
  function fallback(){
    const ta = document.createElement('textarea'); ta.value = t; rootEl.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); done(); }catch(e){ toast('复制失败，请手动复制：' + t); }
    rootEl.removeChild(ta);
  }
}
let toastTimer;
function toast(msg){
  const t = qs('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- 总渲染 ---------- */
function renderAll(){
  renderStrip(); renderProject(); renderFeatures(); renderNow(); renderFooter();
  gotoTab(currentTab);
}

/* ---------- 全局事件委托 ---------- */
rootEl.addEventListener('click', e => {
  const evb = e.target.closest('[data-ev]');
  if (evb){
    const p = evb.dataset.ev;
    if (env.evidenceAction){
      try { env.evidenceAction(p); }
      catch (err){
        // 打不开要说话，不能装作没事：提示原因并把路径复制好
        toast('打不开预览（' + ((err && err.message) || '宿主未提供打开能力') + '），已复制路径');
        copyText(p);
      }
    }
    return;
  }
  const cp = e.target.closest('[data-cp]');
  if (cp){ copyText(cp.dataset.cp); return; }
  const jd = e.target.closest('[data-jd]');
  if (jd){ gotoTab('now'); flashEl('dec-' + jd.dataset.jd); return; }
  const jf = e.target.closest('[data-jf]');
  if (jf){
    gotoTab('features');
    const fb = qs('#featFilters button[data-f="all"]'); if (fb) fb.click();
    flashEl('feat-' + jf.dataset.jf);
    return;
  }
  if (e.target.closest('[data-x]')){ closeSheet(); return; }
  const pop = qs('.nodepop.on');
  if (pop && !pop.contains(e.target) && !e.target.closest('.node')) pop.classList.remove('on');
});
// 键盘可达：功能卡 / 引用链接 / 图节点，回车或空格等价于点击
rootEl.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target;
  if (!t || !t.matches) return;
  if (t.matches('.feat') || t.matches('[data-jf]')){
    e.preventDefault(); t.click(); return;
  }
  if (t.matches('.node')){ e.preventDefault(); t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }
});
// Esc 关闭弹层；全局只保留一个处理器（面板每次重挂都会 init，不能叠加）
if (docKeyHandler) document.removeEventListener('keydown', docKeyHandler);
docKeyHandler = e => {
  if (!rootEl.isConnected) return;
  if (e.key === 'Escape'){
    closeSheet();
    const pop = qs('.nodepop.on'); if (pop) pop.classList.remove('on');
  }
};
document.addEventListener('keydown', docKeyHandler);

qs('#ovl').addEventListener('click', e => { if (e.target.id === 'ovl') closeSheet(); });

/* ---------- Tab ---------- */
qsa('nav.tabs button').forEach(b => b.onclick = () => {
  qsa('nav.tabs button').forEach(x => x.classList.remove('on')); b.classList.add('on');
  qsa('section').forEach(s => s.classList.toggle('on', s.id === b.dataset.tab));
  currentTab = b.dataset.tab;
});

/* ---------- 主题（深 / 浅） ---------- */
(function(){
  const root = rootEl;
  let saved = null; try{ saved = localStorage.getItem('cyd-theme'); }catch(e){}
  if (saved) root.dataset.theme = saved;
  qs('#themeBtn').onclick = () => {
    const cur = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const nxt = cur === 'dark' ? 'light' : 'dark'; root.dataset.theme = nxt;
    try{ localStorage.setItem('cyd-theme', nxt); }catch(e){}
  };
})();


  window.__CYD_TOAST__ = toast;
  renderAll();
  return { reload: doRefresh, reloadQuiet: doRefreshQuiet, notice: toast };
}
return { init: initDashboard, css: CSS, parseProduct, parseFeatures, parseNow, layoutGraph, assembleData, globMatch, kindOf, norm, pad, fmtDate, fmtDT };

})();
