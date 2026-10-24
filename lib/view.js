// dsh-plugin-control-your-development 宿主侧读模型层（node，零第三方依赖）。
//
// 职责（契约 references/dashboard-format.md「读模型 .view.json」）：
//   ① 校验 .view.json 的 schema 与形状；
//   ② 用**与渲染器完全同一套规则**重算 sourceHashes，判定 fresh / stale 并点名变了哪个键；
//   ③ 在宿主具备「渲染器脚本 + Python 解释器」时按需重建（重建 = 跑现有渲染器，不另写一套解析）。
// 这里**不解析 Markdown**：解析只有 scripts/render_dashboard.py 一处。
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const VIEW_FILE = '.view.json';
export const VIEW_SCHEMA_VERSION = 1;
export const VIEW_PRODUCER = 'control-your-development';
export const STATES = ['fresh', 'stale', 'missing', 'unsupported', 'unverified'];

/**
 * **契约要求必须存在的键**（唯一一份清单，与契约「指纹 · 必须覆盖」逐条对应）。
 * 为什么要有这份清单：只遍历"记录里已有的键"永远发现不了**缺键** —— 被裁剪 / 旧版 / 手改
 * 都能安静地过判定，而契约把"键缺失"明确列为 stale。这里把「该有而没有」也判成 stale。
 * .facts.json / .dashboard-ignore 用缺席哨兵，所以它们**永远算存在**；
 * @prevtech 同理（没有快照时是空路径的哨兵值）。
 */
export const REQUIRED_KEYS = ['PRODUCT.md', 'FEATURES.md', 'NOW.md',
                              '.facts.json', '.dashboard-ignore',
                              '@evidence', '@sources', '@cyd', '@prevtech'];
/**
 * 必需键 = 上面这份清单。**术语表 / TECH / CHANGES / 版本快照故意不在其中**：
 * 它们本来就可以不存在（"没有技术地图"是合法状态），硬要求会把正常项目判成 stale。
 * 它们的有无与改名由 `@sources`（*.md 文件名快照）与 `@prevtech`（选中了哪份快照）兜住。
 */
export function missingRequiredKeys(view){
  const has = view && view.sourceHashes ? view.sourceHashes : {};
  return REQUIRED_KEYS.filter(k => !Object.hasOwn(has, k));
}

/* 规范化（与 Python view_norm_bytes 逐字节同口径）：去 UTF-8 BOM，CRLF / CR 归一成 LF。 */
export function normBytes(buf){
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8');
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  const s = b.toString('latin1').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return Buffer.from(s, 'latin1');
}

export function hashBytes(buf){ return createHash('sha256').update(normBytes(buf)).digest('hex'); }
export function hashText(text){ return hashBytes(Buffer.from(String(text), 'utf8')); }

/* @evidence：data 里全部证据路径的 (相对路径, 是否存在) 快照，按路径字节序排序后紧凑 JSON。 */
export function evidenceHash(entries){
  /* **按路径去重**（与 Python view_evidence_hash 同口径）：同一条证据被多个归属引用是常态，
     重复条目对"依赖哪些文件"零信息量；去重后排序才稳定，两端才不会因条目顺序分叉。 */
  const uniq = new Map();
  entries.forEach(([p, ex]) => uniq.set(String(p), !!ex));
  const pairs = Array.from(uniq.entries());
  pairs.sort((a, b) => Buffer.compare(Buffer.from(a[0], 'utf8'), Buffer.from(b[0], 'utf8')));
  return hashText(JSON.stringify(pairs));
}

/* @sources：dev-dashboard/*.md 的文件名快照（嗅探结论会因新建候选文件而变）。 */
export function sourcesHash(names){
  const sorted = names.slice().sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
  return hashText(JSON.stringify(sorted));
}

export function fileHash(path){
  try { return hashBytes(readFileSync(path)); } catch (e) { return null; }
}

/* 与 Python `VIEW_ABSENT` 同一串："文件缺席"本身也是可比较的状态。 */
export const VIEW_ABSENT = '\u0000absent';

/** 参与新鲜度、可能后来才出现的输入：缺席时给确定的缺席值（两端同一串）。 */
export function fileHashOrAbsent(path){
  const h = fileHash(path);
  return h === null ? hashText(VIEW_ABSENT) : h;
}

/** `@cyd`：.cyd.json 里影响语义的那一小撮（与 Python `view_cyd_hash` 同口径：缺省键**不写**）。 */
export function cydHash(dashDir){
  let obj = {};
  try { obj = JSON.parse(readFileSync(join(dashDir, '.cyd.json'), 'utf8')); } catch (e){ obj = {}; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) obj = {};
  const keys = ['format', 'glossary', 'glossary_file', 'glossary_source',
                'tech', 'tech_file', 'tech_source', 'changes', 'changes_file', 'changes_source'];
  const subset = {};
  for (const k of keys) if (obj[k] !== null && obj[k] !== undefined) subset[k] = obj[k];
  // sort_keys + 紧凑分隔：与 Python json.dumps(..., sort_keys=True, separators=(",", ":")) 同形
  const ordered = {};
  for (const k of Object.keys(subset).sort()) ordered[k] = subset[k];
  return hashText(JSON.stringify(ordered));
}

/**
 * `@prevtech`：**当前**选中的那一版快照路径（"选的是哪一份"变了也算变）。
 * 规则与渲染器 `read_prev_tech_path` **同一套**：`index.json.versions` 从后往前，第一个
 * 真的存在 `<dir>/TECH.md` 的目录。两端各一份实现，由跨语言指纹门禁对账。
 * 为什么必须自己解析：只读记录里的键永远等于记录 —— "index 改指另一份已存在的快照"
 * （文件一个没动）就永远判不出来，S3「技术地图跟不上了」会整块静默滞后。
 */
export function prevTechHash(dashDir){
  let versions = [];
  try {
    const idx = JSON.parse(readFileSync(join(dashDir, '.versions', 'index.json'), 'utf8'));
    if (idx && Array.isArray(idx.versions)) versions = idx.versions;
  } catch (e){ versions = []; }
  let picked = '';
  for (let i = versions.length - 1; i >= 0; i--){
    const v = versions[i];
    const dir = v && typeof v.dir === 'string' ? v.dir : null;
    if (!dir) continue;
    if (existsSync(join(dashDir, '.versions', dir, 'TECH.md'))){ picked = '.versions/' + dir + '/TECH.md'; break; }
  }
  return hashText(JSON.stringify([picked]));
}

export function listMdNames(dashDir){
  try { return readdirSync(dashDir).filter(n => n.toLowerCase().endsWith('.md')); }
  catch (e) { return []; }
}

/* 读 .view.json 并做形状校验（不改任何字段）。 */
export function readView(dashDir){
  const file = join(dashDir, VIEW_FILE);
  if (!existsSync(file)) return { state: 'missing', view: null, detail: '没有 ' + VIEW_FILE };
  let view;
  try { view = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { return { state: 'stale', view: null, detail: '解析失败：' + ((e && e.message) || e) }; }
  const bad = validateView(view);
  if (bad){
    /* 形状不合法也要**点名到底是哪些键缺了**（只给一句"缺键"不够定位）。
       view 仍返回：契约要求"保留旧图但明确标注"，而 data 可能完好。 */
    const missing = missingRequiredKeys(view);
    return { state: 'stale', view: view, mismatched: missing, detail: bad };
  }
  if (view.schemaVersion !== VIEW_SCHEMA_VERSION){
    return { state: 'unsupported', view: view, detail: 'schemaVersion=' + view.schemaVersion + '（本端支持 ' + VIEW_SCHEMA_VERSION + '）' };
  }
  return { state: 'fresh', view: view, detail: '' };
}

export function validateView(view){
  if (!view || typeof view !== 'object' || Array.isArray(view)) return '顶层不是对象';
  if (!Number.isInteger(view.schemaVersion)) return 'schemaVersion 不是整数';
  if (!view.producer || typeof view.producer !== 'object') return 'producer 缺失';
  if (typeof view.producer.name !== 'string') return 'producer.name 缺失';
  if (typeof view.producer.version !== 'string') return 'producer.version 缺失';
  if (!Number.isInteger(view.format)) return 'format 不是整数';
  if (typeof view.generatedAt !== 'string' || !view.generatedAt) return 'generatedAt 缺失';
  if (!view.sourceHashes || typeof view.sourceHashes !== 'object' || Array.isArray(view.sourceHashes)) return 'sourceHashes 缺失';
  const keys = Object.keys(view.sourceHashes);
  if (!keys.length) return 'sourceHashes 为空';
  for (const k of keys){
    if (typeof view.sourceHashes[k] !== 'string' || !/^[0-9a-f]{64}$/.test(view.sourceHashes[k])) return 'sourceHashes[' + k + '] 不是 sha256';
  }
  if (!view.data || typeof view.data !== 'object' || Array.isArray(view.data)) return 'data 缺失';
  if (!view.data.project || !Array.isArray(view.data.features)) return 'data.project / data.features 缺失';
  if (!view.data.health || typeof view.data.health !== 'object') return 'data.health 缺失';
  const missing = missingRequiredKeys(view);
  if (missing.length) return 'sourceHashes 缺必需键：' + missing.join('、');
  return '';
}

/* data 里全部证据路径（功能 + 子项 + 使用流程 + 时间线 + 技术地图模块与子项）。 */
export function evidenceEntries(data){
  const out = [];
  const push = list => (list || []).forEach(e => { if (e && typeof e.path === 'string') out.push([e.path, !!e.exists]); });
  (data.features || []).forEach(f => { push(f.evidence); (f.children || []).forEach(c => push(c.evidence)); });
  ((data.project && data.project.journey) || []).forEach(j => push(j.evidence));
  (data.timeline || []).forEach(t => push(t.evidence));
  ((data.tech && data.tech.modules) || []).forEach(m => { push(m.evidence); (m.children || []).forEach(c => push(c.evidence)); });
  return out;
}

/** 证据路径红线（与渲染器 evidence_path_error 同判据）：绝对 / 盘符 / UNC / 含上跳段 ⇒ 越界。 */
export function evidencePathError(rel){
  const s = String(rel || '').replace(/\\/g, '/');
  if (!s) return true;
  if (s.startsWith('/')) return true;                 // 绝对路径
  if (/^[A-Za-z]:/.test(s)) return true;              // 盘符
  if (s.startsWith('//')) return true;                // UNC
  if (s.split('/').includes('..')) return true;       // 上跳
  return false;
}

/**
 * 从**文件系统**重新判存在性（不是信 data 里记的那个 exists）。
 * 为什么必须重判：data 是**生成那一刻**的快照；证据文件后来被删/被改名，只有重新 stat 才知道 ——
 * 照抄 data.exists 会让"删掉证据文件"永远不 stale（本轮反证用例真的抓到过这个错误）。
 * 存在性口径与渲染器 `_exists_like_audit` 一致：越界 ⇒ false，否则 <workspace>/<rel> 是文件。
 */
export function evidenceEntriesFromFs(data, workspace){
  const out = [];
  const seen = new Set();
  const push = list => (list || []).forEach(e => {
    const rel = (e && typeof e === 'object') ? e.path : e;   // 技术地图的 evidence 是路径字符串
    if (typeof rel !== 'string' || !rel) return;
    if (seen.has(rel)) return;
    seen.add(rel);
    const norm = rel.replace(/\\/g, '/');
    let exists = false;
    if (!evidencePathError(norm)){
      try { exists = statSync(join(workspace, norm.replace(/^\//, ''))).isFile(); } catch (err){ exists = false; }
    }
    out.push([norm, exists]);
  });
  (data.features || []).forEach(f => { push(f.evidence); (f.children || []).forEach(c => push(c.evidence)); });
  ((data.project && data.project.journey) || []).forEach(j => push(j.evidence));
  (data.timeline || []).forEach(t => push(t.evidence));
  ((data.tech && data.tech.modules) || []).forEach(m => { push(m.evidence); (m.children || []).forEach(c => push(c.evidence)); });
  return out;
}

/**
 * 重算**记录里每个键**的当前指纹（唯一实现；freshness 判定与跨语言对账都用它）。
 * @evidence 重新 stat 文件系统；@sources 重新列 *.md；其余按键读文件。
 */
export function computeSourceHashes(view, dashDir){
  const recorded = view.sourceHashes || {};
  const workspace = dirname(dashDir);
  const out = {};
  for (const key of Object.keys(recorded)){
    if (key === '@evidence') out[key] = evidenceHash(evidenceEntriesFromFs(view.data, workspace));
    else if (key === '@sources') out[key] = sourcesHash(listMdNames(dashDir));
    else if (key === '.facts.json' || key === '.dashboard-ignore') out[key] = fileHashOrAbsent(join(dashDir, key));
    else if (key === '@cyd') out[key] = cydHash(dashDir);
    else if (key === '@prevtech') out[key] = prevTechHash(dashDir);
    else out[key] = fileHash(join(dashDir, key));
  }
  return out;
}

/* 重算指纹并与记录比对：任一不等 / 文件消失 / 记录里有而当前算不出的键 ⇒ stale，并点名。 */
export function verifySourceHashes(view, dashDir){
  const recorded = view.sourceHashes || {};
  const got = computeSourceHashes(view, dashDir);
  const mismatched = Object.keys(recorded).filter(k => got[k] !== recorded[k]);
  /* 缺键也是 stale（契约：任一不等 / 文件消失 / **键缺失**）——只遍历记录会永远看不见缺键 */
  for (const k of missingRequiredKeys(view)){
    if (!mismatched.includes(k)) mismatched.push(k);
  }
  return { state: mismatched.length ? 'stale' : 'fresh', mismatched: mismatched };
}

/* 重建能力探测：缺哪一环就报哪一环，不静默。 */
export function rebuildCapability(skillRoot, pkgRoot){
  const cands = [];
  if (skillRoot) cands.push(join(skillRoot, VIEW_PRODUCER, 'scripts', 'render_dashboard.py'));
  if (pkgRoot) cands.push(join(pkgRoot, 'skill', VIEW_PRODUCER, 'scripts', 'render_dashboard.py'));
  const renderer = cands.find(p => existsSync(p)) || null;
  const python = process.env.DSH_PYTHON || firstOnPath(['python3', 'python']);
  const missing = [];
  if (!renderer) missing.push('渲染器脚本（skill 未安装或 skillRoot 不对）');
  if (!python) missing.push('Python 解释器（设 DSH_PYTHON 或把 python 放进 PATH）');
  return { ok: !missing.length, renderer: renderer, python: python, missing: missing };
}

function firstOnPath(names){
  for (const n of names){
    const r = spawnSync(n, ['-c', 'print(1)'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return n;
  }
  return null;
}

/* 跑现有渲染器重建读模型（渲染器对用户事实只读，不写任何 Markdown）。 */
export function rebuildView({ dashDir, workspace, capability, timeoutMs = 20000 }){
  if (!capability || !capability.ok){
    return { ok: false, code: 'unavailable', detail: ((capability && capability.missing) || []).join('；') || '能力未知' };
  }
  const args = [capability.renderer, dashDir];
  if (workspace) args.push('--workspace', workspace);
  const r = spawnSync(capability.python, args, { encoding: 'utf8', timeout: timeoutMs });
  const tail = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-3).join(' / ');
  if (r.error && r.error.code === 'ETIMEDOUT') return { ok: false, code: 'timeout', detail: tail };
  if (r.error) return { ok: false, code: 'failed', detail: String(r.error.message || r.error) + (tail ? '：' + tail : '') };
  // 退出码：0 全绿 / 2 有 blocker（读模型照写）/ 1 致命
  if (r.status === 0 || r.status === 2) return { ok: true, code: 'built', detail: tail, exitCode: r.status };
  return { ok: false, code: 'failed', detail: 'exit=' + r.status + (tail ? '：' + tail : '') };
}

/* 重建冷却（模块级）：渲染器是外部进程，watch 抖动时不能每次都拉起来。
   冷却只抑制"再来一次重建"，**不改变状态判定**（state 仍是调用方看到的真状态）。 */
let lastRebuildAt = 0;
export function resetRebuildCooldown(){ lastRebuildAt = 0; }

/* 组合：读 + 校验（+ 可选重建一次，之后重新读再判）。 */
export function loadView({ dashDir, workspace, autoRebuild, capability, rebuildCooldownMs = 3000, now = Date.now() }){
  const cap = capability || rebuildCapability(null, null);
  let got = readView(dashDir);
  if (got.state === 'fresh'){
    const v = verifySourceHashes(got.view, dashDir);
    if (v.state !== 'fresh'){
      got = { state: 'stale', view: got.view, detail: '源已变：' + v.mismatched.join('、'), mismatched: v.mismatched };
    }
  }
  if (!autoRebuild) return Object.assign({}, got, { rebuild: 'not-attempted', capability: cap });
  if (got.state === 'fresh') return Object.assign({}, got, { rebuild: 'not-attempted', capability: cap });
  /* **更高 schemaVersion 绝不重建**：那是更新版插件写的读模型，用旧渲染器覆盖它等于降级写入
     （契约「读模型 · 状态词」：unsupported ⇒ 只报状态 + 由界面说"先升级插件"）。 */
  if (got.state === 'unsupported') return Object.assign({}, got, { rebuild: 'not-attempted', capability: cap });
  if (!cap.ok) return Object.assign({}, got, { rebuild: 'unavailable', capability: cap });
  if (now - lastRebuildAt < rebuildCooldownMs) return Object.assign({}, got, { rebuild: 'cooldown', capability: cap });
  lastRebuildAt = now;
  const r = rebuildView({ dashDir: dashDir, workspace: workspace, capability: cap });
  if (!r.ok){
    return Object.assign({}, got, { rebuild: r.code, capability: cap,
      detail: (got.detail ? got.detail + '；' : '') + '重建失败：' + r.detail });
  }
  const again = readView(dashDir);
  if (again.state === 'fresh'){
    const v = verifySourceHashes(again.view, dashDir);
    return { state: v.state, view: again.view, mismatched: v.mismatched || [], rebuild: 'built',
             detail: v.state === 'fresh' ? '' : '重建后仍有差异：' + v.mismatched.join('、'), capability: cap };
  }
  return Object.assign({}, again, { rebuild: 'built', capability: cap });
}

/* 面板要的 payload：只给状态 + 数据，不给宿主路径 */
export function viewPayload(got){
  return {
    state: got.state,
    mismatched: got.mismatched || [],
    view: got.view ? {
      schemaVersion: got.view.schemaVersion,
      producer: got.view.producer,
      format: got.view.format,
      generatedAt: got.view.generatedAt,
      data: got.view.data,
    } : null,
    rebuild: got.rebuild || 'not-attempted',
    detail: got.detail || '',
  };
}
