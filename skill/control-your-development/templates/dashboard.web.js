/* control-your-development 仪表盘：浏览器宿主引导（双击 html 离线打开 + File System Access 直读写回）
   依赖同页先加载的 dashboard.core.js（window.CYD）与 window.__CYD_DATA__。 */
/* webToast：core 的 toast 在 init 后挂到 window，FS 层提示复用它 */
function webToast(m){ if (window.__CYD_TOAST__) window.__CYD_TOAST__(m); else console.log('[cyd]', m); }

/* ---------- 文件夹直连（File System Access） ---------- */
const FSOK = 'showDirectoryPicker' in window;
let dirHandle = null;
function idb(){
  return new Promise((res, rej) => {
    const r = indexedDB.open('cyd-dash', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function saveHandle(h){
  try{ const db = await idb();
    return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(h, 'dir'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }catch(e){}
}
async function loadHandle(){
  try{ const db = await idb();
    return new Promise((res, rej) => { const tx = db.transaction('kv', 'readonly'); const q = tx.objectStore('kv').get('dir'); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); });
  }catch(e){ return null; }
}
async function getDir(){
  if (!FSOK) return null;
  let h = dirHandle || await loadHandle();
  if (h){
    let p = '';
    try{ p = await h.queryPermission({ mode: 'readwrite' }); }catch(e){}
    if (p === 'prompt'){ try{ p = await h.requestPermission({ mode: 'readwrite' }); }catch(e){} }
    if (p === 'granted'){ dirHandle = h; return h; }
  }
  webToast('请选择项目根目录（包含 dev-dashboard 的文件夹）');
  try{
    dirHandle = await window.showDirectoryPicker({ id: 'cyd', mode: 'readwrite' });
    await saveHandle(dirHandle);
    return dirHandle;
  }catch(e){ return null; }
}
async function readText(root, rel){
  const parts = rel.split('/'); let h = root;
  for (let i = 0; i < parts.length - 1; i++) h = await h.getDirectoryHandle(parts[i]);
  const f = await h.getFileHandle(parts[parts.length - 1]);
  return (await f.getFile()).text();
}
async function writeText(root, rel, text){
  const parts = rel.split('/'); let h = root;
  for (let i = 0; i < parts.length - 1; i++) h = await h.getDirectoryHandle(parts[i]);
  const f = await h.getFileHandle(parts[parts.length - 1], { create: true });
  const w = await f.createWritable();
  await w.write(text); await w.close();
}
async function fileExists(root, rel){
  const parts = rel.split('/'); let h = root;
  for (let i = 0; i < parts.length - 1; i++){ try{ h = await h.getDirectoryHandle(parts[i]); }catch(e){ return false; } }
  try{ await h.getFileHandle(parts[parts.length - 1]); return true; }catch(e){ return false; }
}

/* ---------- 页面内刷新：重读文件 → assembleData（共享组装） ---------- */
async function reloadData(){
  if (!FSOK) return null;
  const root = await getDir();
  if (!root) return null;
  const prod = CYD.norm(await readText(root, 'dev-dashboard/PRODUCT.md'));
  const feat = CYD.norm(await readText(root, 'dev-dashboard/FEATURES.md'));
  const now = CYD.norm(await readText(root, 'dev-dashboard/NOW.md'));
  let factsRaw = null, ignoreRaw = null;
  try{ factsRaw = await readText(root, 'dev-dashboard/.facts.json'); }catch(e){}
  try{ ignoreRaw = await readText(root, 'dev-dashboard/.dashboard-ignore'); }catch(e){}
  return CYD.assembleData(
    { prod, feat, now, factsRaw, ignoreRaw, workspace_uri: window.__CYD_DATA__.workspace_uri },
    p => fileExists(root, p));
}

function setVerified(md, name, dateStr){
  const lines = md.split('\n');
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++){
    const m = lines[i].match(/^##\s*功能\s*[:：]\s*(.+?)\s*$/);
    if (m && m[1] === name){ start = i; break; }
  }
  if (start < 0) throw new Error('找不到功能「' + name + '」');
  for (let i = start + 1; i < lines.length; i++){ if (/^##\s*功能\s*[:：]/.test(lines[i])){ end = i; break; } }
  let si = -1, vi = -1;
  for (let i = start + 1; i < end; i++){
    if (/^-\s*状态\s*[:：]/.test(lines[i])) si = i;
    if (/^-\s*验证\s*[:：]/.test(lines[i])) vi = i;
  }
  if (si < 0) throw new Error('功能块缺少状态行');
  lines[si] = '- 状态: 已验证';
  const vl = '- 验证: 用户在 ' + dateStr + ' 验证过';
  if (vi >= 0) lines[vi] = vl; else lines.splice(si + 1, 0, vl);
  return lines.join('\n');
}
function prependTimeline(md, line){
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++){
    if (/^##(?!#)\s*时间线/.test(lines[i].trim())){ lines.splice(i + 1, 0, line); return lines.join('\n'); }
  }
  throw new Error('找不到时间线小节');
}


/* ---------- 写回：FEATURES.md 状态 + NOW.md 时间线 ---------- */
async function verifyWrite(name){
  if (!FSOK) return 'fallback';
  const root = await getDir();
  if (!root) return 'fallback';
  let fm = CYD.norm(await readText(root, 'dev-dashboard/FEATURES.md'));
  const cur = CYD.parseFeatures(fm).find(x => x.name === name);
  if (!cur) throw new Error('文件中找不到功能「' + name + '」');
  if (cur.status !== '可用') return 'fallback';
  fm = setVerified(fm, name, CYD.fmtDate(new Date()));
  const nf = CYD.parseFeatures(fm);
  const n = nf.filter(x => x.status === '已验证').length, t = nf.filter(x => x.status !== '已废弃').length;
  let nm = CYD.norm(await readText(root, 'dev-dashboard/NOW.md'));
  nm = prependTimeline(nm, '- ' + CYD.fmtDT(new Date()) + ' | 你验证了「' + name + '」，进度前进到 ' + n + '/' + t);
  await writeText(root, 'dev-dashboard/FEATURES.md', fm);
  await writeText(root, 'dev-dashboard/NOW.md', nm);
  return 'ok';
}

/* ---------- 启动（浏览器宿主） ---------- */
(function(){
  const DATA = window.__CYD_DATA__;
  CYD.init(document.getElementById('app'), {
    data: DATA,
    browserTab: true,
    capabilityNote: '直写环境：' + (FSOK ? '✅ 支持（Edge/Chrome）' : '⚠ 不支持，将使用复制指令模式'),
    evidenceUrl: p => DATA.workspace_uri + '/' + encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F'),
    reload: reloadData,
    verifyWrite
  });
  (async function(){
    if (!FSOK) return;
    try{ const hd = await loadHandle(); if (hd && await hd.queryPermission({ mode: 'readwrite' }) === 'granted') dirHandle = hd; }catch(e){}
  })();
})();

