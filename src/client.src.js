// dsh-plugin-control-your-development 浏览器端源文件（构建：tools/build_panel.py 注入共享渲染核）
// 视图 = skill 模板 dashboard.core.js（与网页版完全一致）；本文件只负责宿主接线。
window.__ModuleLoader__.load({
  id: 'dsh-plugin-control-your-development',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const react = require('react');
    const h = react.createElement;

/*__CYD_CORE__*/

    /* 标签标题截断样式（对齐终端/文件标签的宿主规则） */
    const TITLE_CSS = ".cydp-tabtitle{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}";
    function injectTitleCss(){
      if (typeof document === 'undefined' || document.querySelector('style[data-cydp-title]')) return;
      const s = document.createElement('style');
      s.setAttribute('data-cydp-title', '1');
      s.textContent = TITLE_CSS;
      document.head.appendChild(s);
    }

    const NS = 'devDashboard';
    const TAB_ID = 'dev-dashboard';
    /* 右侧栏 tab 的 kind：`sidebarRightTabs.register` 与 `sidebarRight.openTab` 两处共用一份 —— 单一事实源 */
    const TAB_KIND = 'dashboard';
    const MAP_TAB_ID = 'dev-dashboard-map';

    /* 标签标题里的项目名：面板体读到数据后写进来，标签订阅它 */
    const titleStore = { name: '', subs: new Set() };
    function setProjectTitle(name){
      const v = (name && name !== '未命名项目') ? name : '';
      if (titleStore.name === v) return;
      titleStore.name = v;
      titleStore.subs.forEach(fn => { try { fn(); } catch (e) { /* 单个订阅出错不影响其他 */ } });
    }
    function useProjectTitle(){
      const [v, setV] = react.useState(titleStore.name);
      react.useEffect(() => {
        const fn = () => setV(titleStore.name);
        titleStore.subs.add(fn);
        fn();
        return () => titleStore.subs.delete(fn);
      }, []);
      return v;
    }

    /* ---------- 数据层（宿主 RPC，零鉴权代码） ---------- */
    async function rpcValue(p){
      const r = await p;
      if (!r || !r.ok){ const e = r && r.error; throw new Error((e && e.code) || 'rpc-failed'); }
      return r.value;
    }
    /* ---------- 双向闭环：面板动作 → host RPC → steer / 信箱 ---------- */
    const RPC_NS = 'control-your-development';
    function rpcCarrier(ctx){
      // 按形状收窄 connection 服务（workflow-lite 同款做法）：拿不到就返回 null，面板退化为复制指令
      try{
        const svc = ctx.get('connection');
        const call = svc && svc.rpc && svc.rpc.call;
        if (typeof call !== 'function') return null;
        return { call: (ep, payload) => call.call(svc.rpc, '/api', RPC_NS + '/' + ep, payload) };
      }catch(e){ return null; }
    }
    /* 直发通道（按优先级）：
       ① 官方会话直发 ctx.sessions.binding(id).session.prompt([...],'queue')
          —— 消息直接出现在你与 agent 的主对话里，等价于你在输入框回车；
       ② 宿主 RPC（control-your-development/notify）—— agent 在线就 steer 直达，
          不在线写 dev-dashboard/.inbox.jsonl 兜底；
       ③ 两条都拿不到 → 面板退回复制，并把失败原因说清楚（不再静默复制）。 */
    function makeSessionSend(ctx){
      return async (sessionId, text) => {
        const sessions = ctx.get && ctx.get('sessions');
        const binding = sessions && typeof sessions.binding === 'function' ? sessions.binding(sessionId) : null;
        const session = binding && binding.session;
        if (!session || typeof session.prompt !== 'function') throw new Error('会话直发接口不可用');
        const r = await session.prompt([{ type: 'text', text }], 'queue');
        if (!r || r.ok !== true) throw new Error((r && r.error && (r.error.code || r.error.message)) || 'prompt-failed');
        return 'sent';
      };
    }
    function makeNotify(carrier, ctx){
      const viaSession = makeSessionSend(ctx);
      const viaRpc = carrier ? async (sessionId, kind, text, summary) => {
        const r = await carrier.call('notify', { sessionId, kind, text, summary });
        if (!r || !r.ok) throw new Error((r && r.error && (r.error.code || r.error.message)) || 'notify-failed');
        return r.value && r.value.delivered === 'queued' ? 'queued' : 'ok';
      } : null;
      /* 返回 'sent' | 'ok' | 'queued'；全都失败则抛错，带两条通道各自的原因 */
      return async (sessionId, kind, text, summary) => {
        const errs = [];
        try{ return await viaSession(sessionId, text); }
        catch (e){ errs.push('会话直发：' + ((e && e.message) || e)); }
        if (viaRpc){
          try{ return await viaRpc(sessionId, kind, text, summary); }
          catch (e){ errs.push('宿主 RPC：' + ((e && e.message) || e)); }
        } else errs.push('宿主 RPC：不可用');
        throw new Error(errs.join('；'));
      };
    }
    async function readText(remote, sessionId, path, signal){
      // 分页续读：宿主 read 有单页行数上限，靠 eof 判断是否读完，避免静默截断
      var offset = 1, out = '', page = 2000;
      for (var i = 0; i < 50; i++){
        const v = await rpcValue(remote.workspaceFiles.read(sessionId, path, { offset: offset, limit: page }, signal));
        out += v.text || '';
        if (v.eof) break;   // eof=true 表示本页含文件最后一行（宿主契约）；写反会静默截断 >2000 行的文件
        const lines = v.lines || 0;
        if (!lines) break;
        offset = (v.offset || offset) + lines;
      }
      return out;
    }
    async function readOpt(remote, sessionId, path, signal){
      try { return await readText(remote, sessionId, path, signal); } catch (e){ return null; }
    }
    async function exists(remote, sessionId, path, signal){
      try { await rpcValue(remote.workspaceFiles.stat(sessionId, path, signal)); return true; } catch (e){ return false; }
    }
    async function loadAll(remote, sessionId, signal){
      const missing = [];
      const need = async (name) => {
        try { return await readText(remote, sessionId, 'dev-dashboard/' + name, signal); }
        catch (e){ missing.push(name); return ''; }
      };
      const prod = await need('PRODUCT.md');
      const feat = await need('FEATURES.md');
      const now = await need('NOW.md');
      if (missing.length){ const err = new Error('missing:' + missing.join(',')); err.missing = missing; throw err; }
      const factsRaw = await readOpt(remote, sessionId, 'dev-dashboard/.facts.json', signal);
      const ignoreRaw = await readOpt(remote, sessionId, 'dev-dashboard/.dashboard-ignore', signal);
      /* 术语表：文件名不写死 —— 面板没有列目录能力（workspaceFiles 只有 read/stat），
         所以先读渲染器写下的 .cyd.json（真实文件名 + 解析状态），再按候选名 stat 兜底。 */
      /* 术语表：判定**调用共享核**（`CYD.resolveGlossary`，契约化入口），这里只做 IO 注入。
         面板没有列目录能力（workspaceFiles 只有 read/stat），所以候选集只能按惯用名探测 ——
         那是"IO 能拿到哪些文件"，判定（显式指定 / 嗅探 / 歧义 / 两个失败 flag）全在共享核里。
         读 `.cyd.json` 失败**不再静默**：原文照传，由共享核判成 `meta_error` flag → 两端同一条 WARN。 */
      const metaRaw = await readOpt(remote, sessionId, 'dev-dashboard/.cyd.json', signal);
      const probe = ['GLOSSARY.md', 'glossary.md', '术语表.md', '词汇表.md', 'TERMS.md'];
      const texts = {};
      for (const c of probe){
        const t = await readOpt(remote, sessionId, 'dev-dashboard/' + c, signal);
        if (t != null) texts[c] = t;
      }
      /* .cyd.json 里点名的文件也要能读到（显式指定优先于探测列表） */
      let metaHint = null;
      try { metaHint = metaRaw ? JSON.parse(metaRaw) : null; }catch (e){ metaHint = null; }
      const extra = metaHint && typeof metaHint === 'object'
        ? [metaHint.glossary, metaHint.glossary_file].filter(x => typeof x === 'string' && x.trim()) : [];
      for (const c of extra){
        if (texts[c] === undefined){
          const t = await readOpt(remote, sessionId, 'dev-dashboard/' + c, signal);
          if (t != null) texts[c] = t;
        }
      }
      const glossStatus = window.CYD.resolveGlossary({
        metaRaw,
        listMd: Object.keys(texts).filter((k, i, arr) => arr.findIndex(x => x.toLowerCase() === k.toLowerCase()) === i),
        readText: n => (texts[n] === undefined ? null : texts[n])
      });
      const glossName = glossStatus.file;
      const glossRaw = glossName ? (texts[glossName] != null ? texts[glossName]
        : await readOpt(remote, sessionId, 'dev-dashboard/' + glossName, signal)) : null;
      lastGlossName = glossName;
      /* 声明类文件（v1.6）：判定调共享核 `CYD.resolveDeclared`，这里只做 IO（与术语表同款）。
         面板没有列目录能力 → 候选按惯用名探测；.cyd.json 里点名的文件也读上。
         `.versions/index.json` → 最近一份 TECH.md（**只读、不写**；缺失/坏 JSON/文件不存在 → null
         = **不产**漂移 WARN，fail-closed 与契约一致）。 */
      const declaredOf = async kind => {
        const cands = kind === 'tech'
          ? ['TECH.md', 'tech.md', '技术地图.md'] : ['CHANGES.md', 'changes.md', '变更规则.md'];
        const texts = {};
        for (const c of cands){
          const t = await readOpt(remote, sessionId, 'dev-dashboard/' + c, signal);
          if (t != null) texts[c] = t;
        }
        let hint = null;
        try { hint = metaRaw ? JSON.parse(metaRaw) : null; }catch (e){ hint = null; }
        const extra = hint && typeof hint === 'object'
          ? [hint[kind], hint[kind + '_file']].filter(x => typeof x === 'string' && x.trim()) : [];
        for (const c of extra){
          if (texts[c] === undefined){
            const t = await readOpt(remote, sessionId, 'dev-dashboard/' + c, signal);
            if (t != null) texts[c] = t;
          }
        }
        const st = window.CYD.resolveDeclared({ kind, metaRaw, listMd: Object.keys(texts).filter((k, i, arr) => arr.findIndex(x => x.toLowerCase() === k.toLowerCase()) === i),
          readText: n => (texts[n] === undefined ? null : texts[n]) });
        return { st, raw: st.file ? (texts[st.file] != null ? texts[st.file] : null) : null };
      };
      const techD = await declaredOf('tech');
      const changesD = await declaredOf('changes');
      const prevTechRaw = await (async () => {
        const idx = await readOpt(remote, sessionId, 'dev-dashboard/.versions/index.json', signal);
        if (idx == null) return null;
        let data = null;
        try { data = JSON.parse(idx); }catch (e){ return null; }
        const vers = data && Array.isArray(data.versions) ? data.versions : null;
        if (!vers) return null;
        for (let i = vers.length - 1; i >= 0; i--){
          const d = vers[i] && vers[i].dir;
          if (typeof d !== 'string') continue;
          const t = await readOpt(remote, sessionId, 'dev-dashboard/.versions/' + d + '/TECH.md', signal);
          if (t != null) return t;
        }
        return null;
      })();
      /* 待生效条数（v1.5）：以 .inbox.jsonl 文件为准，不做本地增量；投递成功后靠本函数/watch 重读再算。
         三态必须分清：stat 说没有 → 空串（= 0）；stat 说有但读失败 → null（界面显示 —，不猜数字）。 */
      let inboxRaw = '';
      if (await exists(remote, sessionId, 'dev-dashboard/.inbox.jsonl', signal)){
        inboxRaw = await readOpt(remote, sessionId, 'dev-dashboard/.inbox.jsonl', signal);
      }
      return window.CYD.assembleData(
        { prod, feat, now, glossRaw, glossName, glossStatus, factsRaw, ignoreRaw, inboxRaw,
          techRaw: techD.raw, techName: techD.st.file, techStatus: techD.st, techPrevRaw: prevTechRaw,
          changesRaw: changesD.raw, changesName: changesD.st.file, changesStatus: changesD.st },
        p => exists(remote, sessionId, p, signal));
    }
    /* 版本快照读取（workspaceFiles 只有读方法，够了）：list / read(n) / current()
       术语表按 loadAll 解析到的真实文件名走（项目可以叫 术语表.md / glossary.md …） */
    const VERSION_BASE = ['PRODUCT.md', 'FEATURES.md', 'NOW.md'];
    /* 候选探测名单只表示"面板能读哪些惯用名"（没有列目录能力）；**判定**在共享核 resolveGlossary 里 */
    let lastGlossName = null;
    function makeVersions(remote, sessionId, signal){
      async function readIndex(){
        const raw = await readOpt(remote, sessionId, 'dev-dashboard/.versions/index.json', signal);
        if (!raw) return { versions: [] };
        try { const d = JSON.parse(raw); return { versions: Array.isArray(d.versions) ? d.versions : [] }; }
        catch (e){ return { versions: [] }; }
      }
      async function readFiles(prefix){
        const files = {};
        for (const f of VERSION_BASE.concat(lastGlossName ? [lastGlossName] : [])){ files[f] = (await readOpt(remote, sessionId, prefix + f, signal)) || ''; }
        return files;
      }
      return {
        list: async () => (await readIndex()).versions,
        read: async (n) => {
          const idx = await readIndex();
          const v = idx.versions.find(x => x.n === n);
          if (!v) throw new Error('没有版本 ' + n);
          return { entry: v, files: await readFiles('dev-dashboard/.versions/' + v.dir + '/') };
        },
        current: () => readFiles('dev-dashboard/'),
      };
    }
    function watchDash(remote, sessionId, signal){
      return (async function*(){
        if (signal.aborted) return;
        const stream = remote.$stream({
          name: 'dev-dashboard watch',
          open: (lifetime) => remote.workspaceFiles.changes(sessionId, 'dev-dashboard', lifetime),
          ended: () => new Error('dashboard watch ended')
        });
        const abort = () => stream.dispose();
        signal.addEventListener('abort', abort, { once: true });
        try {
          for await (const item of stream){
            if (signal.aborted) return;
            if (item.value.kind === 'ready') item.accept();
            else yield item.value.kind;
          }
        } finally {
          signal.removeEventListener('abort', abort);
          await stream.dispose();
        }
      })();
    }

    /* ---------- 面板挂载：共享渲染核 ---------- */
    /* 空态/错误态与仪表盘本体共用 .cyd-app 变量：先补渲染核样式、再加类名。
       这里不许再写一套内联字号/宿主 token —— 与仪表盘内的文案和控件同一套样式。 */
    function emptyEl(mountEl, html){
      if (window.CYD && window.CYD.ensureCss) window.CYD.ensureCss();
      mountEl.classList.add('cyd-app');
      mountEl.innerHTML = '<div class="empty">' + html + '</div>';
    }
    /* 面板里唯一能做的动作是复制指令：把这句话发给我，我来建/更新仪表盘 */
    function copyCommand(mountEl, cmd){
      const btn = mountEl.querySelector('[data-copy-cmd]');
      if (!btn) return;
      btn.onclick = () => {
        const done = () => { btn.textContent = '✓ 已复制，去聊天框粘贴发送'; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(cmd).then(done).catch(() => { btn.textContent = '复制失败，请手动复制：' + cmd; });
        else btn.textContent = '请手动复制：' + cmd;
      };
    }
    function mountDashboard(root, props){
      const sessionId = props.sessionId;
      const ctrl = new AbortController();
      let dead = false, timer = 0, inst = null;
      root.innerHTML = '';
      const mountEl = document.createElement('div');
      mountEl.style.height = '100%';
      // 整页模式（会话页「功能地图」）自己撑满父容器，不让滚动条插进来影响关系图高度
      mountEl.style.overflow = props.fullGraph ? 'hidden' : 'auto';
      if (props.fullGraph){ mountEl.style.display = 'flex'; mountEl.style.flexDirection = 'column'; mountEl.style.minHeight = '0'; }
      root.appendChild(mountEl);
      async function boot(){
        setProjectTitle('');   // 切会话时先清空，避免短暂显示上一个项目
        if (!sessionId){
          emptyEl(mountEl, '在左侧打开一个会话，点击右侧边栏，选择开发仪表盘，工作区内共享，初次点击需建立');
          return;
        }
        try{
          const cfg = props.configGet ? await props.configGet().catch(() => ({ available: false, values: {} })) : { available: false, values: {} };
          const data = await props.loadAll(sessionId, ctrl.signal);
          if (dead) return;
          setProjectTitle(data && data.project && data.project.name);
          const canSend = !!props.notify;
          inst = window.CYD.init(mountEl, {
            data,
            browserTab: false,
            onlyTab: props.onlyTab || null,
            fullGraph: !!props.fullGraph,
            timelineShow: (cfg.values && cfg.values.timelineShow) || undefined,
            capabilityNote: canSend
              ? '证据在新标签页打开。点关系图节点可以写一句话发给我，消息进主对话。（没有直发通道时会改成复制。）'
              : props.openResource ? '证据在新标签页打开。动作按钮会复制一句指令，粘贴到聊天框发给我。' : '动作按钮会复制一句指令，粘贴到聊天框发给我。',
            evidenceUrl: () => null,
            evidenceAction: props.openResource ? path => {
              // 地址按官方 encodeSegment/encodePath 逐字构造（保留盘符冒号）
              const enc = s => encodeURIComponent(s).replace(/%3A/gi, ':');
              const norm = String(path).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
              const addr = 'dsh-resource://file/session/' + enc(sessionId) + '/' + norm.split('/').map(enc).join('/');
              props.openResource(addr, {});
            } : null,
            reload: () => props.loadAll(sessionId, ctrl.signal),
            verifyWrite: null,   // 写回走 notify（steer/信箱），面板不直接改文件
            /* 整页「查看详情」用：宿主未注入时为 null ⇒ 共享核只退出整页（不静默假装开了侧栏） */
            openSidebar: props.openSidebar || null,
            decide: canSend ? d => props.notify(sessionId, 'decide', d.text, '用户在仪表盘拍板 ' + d.id + (d.keys && d.keys.length ? '：选 ' + d.keys.join('、') : '') + (d.note ? '（附补充）' : '')) : null,
            command: canSend ? (text, summary) => props.notify(sessionId, 'command', text, summary || String(text).slice(0, 60)) : null,
            /* 节点面板的「直接和 agent 说一句」：kind=ask，信箱兜底时可以区分是提问还是改状态的指令 */
            ask: canSend ? (text, summary) => props.notify(sessionId, 'ask', text, summary || String(text).slice(0, 60)) : null,
            versions: props.makeVersions ? props.makeVersions(sessionId, ctrl.signal) : null,
            settings: (cfg.available && props.configSet) ? {
              view: cfg,
              refresh: () => props.configGet(),
              set: (revision, set, reset) => props.configSet(revision, set, reset),
            } : null,
          });
        }catch(e){
          if (dead || ctrl.signal.aborted) return;
          const code = String((e && e.message) || e);
          const noDash = (e && e.missing && e.missing.length === 3) || /not-found/.test(code);
          if (noDash){
            // 这个工作区还没建仪表盘：能直发就直接发，不行再给复制指令
            if (props.notify){
              emptyEl(mountEl, '这个工作区还没有仪表盘。每个工作区各有一份，工作区内对话共享。'
                + '<br><br><button class="btn primary" data-send-cmd>发送：control my development</button>'
                + '<br><br><span class="muted">点一下发给我，我来建。</span>');
              const sb = mountEl.querySelector('[data-send-cmd]');
              sb.onclick = () => {
                sb.disabled = true;
                props.notify(sessionId, 'command', 'control my development', '用户请求建立开发仪表盘')
                  .then(r => { sb.textContent = r === 'queued' ? '✓ 已记下，下次更新时生效' : '✓ 已发送，我来建立'; })
                  .catch(() => { sb.disabled = false; sb.textContent = '发送失败，请在聊天框输入：control my development'; });
              };
            } else {
              emptyEl(mountEl, '这个工作区还没有仪表盘。每个工作区各有一份，工作区内对话共享。'
                + '<br><br><button class="btn primary" data-copy-cmd>复制指令：control my development</button>'
                + '<br><br><span class="muted">复制好了，粘贴到聊天框发给我。</span>');
              copyCommand(mountEl, 'control my development');
            }
          } else if (e && e.missing && e.missing.length){
            emptyEl(mountEl, '仪表盘缺文件：<b>' + e.missing.join('、') + '</b><br><br>'
              + '<button class="btn primary" data-copy-cmd>复制指令：更新仪表盘</button>');
            copyCommand(mountEl, '更新仪表盘');
          } else {
            const plain = /bad-request/.test(code) ? '文件太大，宿主拒绝了本次读取'
              : /timeout|abort/i.test(code) ? '读取超时'
              : '读取失败（' + code + '）';
            emptyEl(mountEl, plain + '<br><br><a href="#" data-retry>点这里重试</a>，或在聊天框对我说 <b>更新仪表盘</b>。');
            const b = mountEl.querySelector('[data-retry]');
            if (b) b.onclick = ev => { ev.preventDefault(); boot(); };
          }
        }
      }
      boot();
      if (sessionId){
        (async () => {
          let backoff = 1000;
          while (!dead && !ctrl.signal.aborted){
            try{
              for await (const kind of props.watchDash(sessionId, ctrl.signal)){
                if (dead) return;
                backoff = 1000;
                clearTimeout(timer);
                timer = setTimeout(() => { if (inst) inst.reloadQuiet(); else boot(); }, 400);
              }
              // 正常结束也视为断开：退避后重连，避免静默停更
            }catch(e){
              if (dead || ctrl.signal.aborted) return;
              if (inst) inst.notice('自动更新暂时断开，正在重连…');
            }
            await new Promise(r => setTimeout(r, backoff));
            if (!dead && !ctrl.signal.aborted && inst) inst.reloadQuiet();  // 补上断线期间漏掉的变更
            backoff = Math.min(backoff * 2, 30000);
          }
        })();
      }
      return () => { dead = true; ctrl.abort(); clearTimeout(timer); };
    }

    /* ---------- 图标（与右侧栏内置图标同一画风：16×16 细线 currentColor） ---------- */
    function DashIcon(){
      return h('svg', { width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: '2.5', y: '2.5', width: '11', height: '11', rx: '2', stroke: 'currentColor' }),
        h('path', { d: 'M8 2.5V13.5', stroke: 'currentColor' }),
        h('path', { d: 'M2.5 8H13.5', stroke: 'currentColor' }));
    }
    function DashGuideArtwork(){
      return h('svg', { width: '32', height: '32', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: '2.5', y: '2.5', width: '11', height: '11', rx: '2', stroke: 'currentColor' }),
        h('path', { d: 'M8 2.5V13.5', stroke: 'currentColor' }),
        h('path', { d: 'M2.5 8H13.5', stroke: 'currentColor' }));
    }

    /* ---------- 标签标题与面板体 ---------- */
    function DashTitle(props){
      const tab = props.useTabInfo ? props.useTabInfo().tab : null;
      const proj = useProjectTitle();
      const base = tab ? tab.title : '开发仪表盘';
      // 带上项目名，一眼看出这份仪表盘是哪个工作区的
      return h(react.Fragment, null, h(DashIcon), h('span', { className: 'cydp-tabtitle' }, proj ? base + ' · ' + proj : base));
    }
    function DashboardBody(props){
      const ref = react.useRef(null);
      const sid = props.sessionId;
      // 打开文件的两条路：宿主服务（face 注入，最稳）优先；官方同款 tab.actions 兜底
      let tabOpen = null;
      try { const info = props.useTabInfo ? props.useTabInfo() : null; tabOpen = (info && info.tab && info.tab.actions && info.tab.actions.openResource) || null; } catch (e) { tabOpen = null; }
      const openResource = props.openResource || tabOpen;
      if (props.setTabOpen) props.setTabOpen(tabOpen);
      react.useEffect(() => {
        if (!ref.current) return undefined;
        return mountDashboard(ref.current, Object.assign({}, props, { openResource }));
      }, [sid]);
      return h('div', { className: 'cydp-host', style: { height: '100%', minHeight: 0 }, ref });
    }
    /* 会话页顶部「功能地图」整页视图：同一份共享核，只显示功能板块，图占满整页 */
    function MapView(props){
      const ref = react.useRef(null);
      const sid = props.sessionId;
      react.useEffect(() => {
        if (!ref.current) return undefined;
        return mountDashboard(ref.current, Object.assign({}, props, { onlyTab: 'features', fullGraph: true }));
      }, [sid]);
      return h('div', { className: 'cydp-host', style: { height: '100%', minHeight: 0, flex: '1 1 auto' }, ref });
    }

    /* ---------- 文案 ---------- */
    const zh = { title: '开发仪表盘', 'guide.title': '开发仪表盘', 'guide.desc': '功能地图、验证进度、等你拍板的事，都在这里。', 'map.tab': '功能地图' };
    const en = { title: 'Dev Dashboard', 'guide.title': 'Dev Dashboard', 'guide.desc': 'Features, progress and pending decisions', 'map.tab': 'Feature Map' };

    /* ---------- 注册 ---------- */
    function apply(ctx){
      injectTitleCss();
      // 证据「打开文件」走宿主公开服务（与官方文件面板同一条路），不依赖组件 props 管道
      const nav = ctx.sidebarRight;
      /* 整页「功能地图」的「查看详情」按钮：退出整页 + 在右侧边栏打开**本**仪表盘 tab。
         ⚠ **`nav.openTab(TAB_KIND)` 这条路已确认有问题（2026-10-13 用户实拍）**：会话页那个视图
         自己变成了仪表盘，从侧栏回来仍是。**根因**：我按 **kind** 传参，依据是这里原先那句注释，
         而那句来自**生态里的一个例子**（dsh-context 的 id 与 kind 恰好同串 ⇒ 对参数语义零信息量）：
         **"生态里有例子" ≠ "有契约"**。详见
         `projects/dsh-plugin-control-your-development/notes/2026-10-13-opentab-参数语义歧义.md`。
         修法（方向 A，已批准）：改成「**揭示右侧栏 + 激活我们那个 tab**」两步，**不再调 openTab**。
         ⚠ **本行以下的行为按修法改造前不要依赖**（本注释只负责不让下一个人再照着旧结论写一遍）。 */
      function openDashboardTab(){
        /* **D 版**（2026-10-13 队长批准）：**只点宿主侧栏开关**；不调任何 nav 服务、不点任何 tab。
           ——「退出整页」那半由调用方完成（`dashboard.core.js` 的点击处理器先 `exitImmersive()` 再调本函数）。
           为什么砍到这一步：`nav.openTab` 已确认会把【当前视图类型】切成 dashboard（用户实拍）；
           替代品 `nav.show()` 的语义**我没有任何依据**（"揭示侧栏"是我猜的），`focusTab()`
           （按标题文本点 `button[role="tab"]`）**可能点到别的 tab** —— 两条都可能是肇事者 ⇒ 一次排除，
           先把用户看到的"跳转切换"消掉。代价：侧栏可能停在别的 tab（**失效方向安全**：不切视图、不炸）。 */
        try {
          const b = document.querySelector('[aria-label="打开右侧边栏"]');
          if (b){ b.click(); return true; }
        } catch (e){ console.warn('[cyd] 打开右侧边栏失败', e); }
        return false;
      }
      let tabOpen = null;   // 由 DashboardBody 注入（官方同款 tab.actions.openResource）
      const setTabOpen = (fn) => { if (typeof fn === 'function') tabOpen = fn; };
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dev-dashboard: locale');
      const t = ctx.locale.bind(NS);
      // 双向闭环的 RPC 载波：没有 connection 服务时退化为「复制指令」
      const carrier = rpcCarrier(ctx);
      const notify = makeNotify(carrier, ctx);
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID, kind: TAB_KIND, priority: 'builtin', keepMounted: true, title: () => t('title'),
        guide: [{ id: 'open', order: 30, title: () => t('guide.title'), description: () => t('guide.desc'), icon: DashGuideArtwork }]
      }), 'dev-dashboard: tab type');
      const face = {
        loadAll: (sessionId, signal) => loadAll(ctx.remote, sessionId, signal),
        watchDash: (sessionId, signal) => watchDash(ctx.remote, sessionId, signal),
        notify,
        versions: null,   // 每个挂载点按自己的 sessionId/signal 现做（见下方 makeVersions 包装）
        makeVersions: (sessionId, signal) => makeVersions(ctx.remote, sessionId, signal),
        configGet: async () => {
          if (!carrier) return { available: false, values: {} };
          try{ const r = await carrier.call('config/get', {}); return (r && r.ok && r.value) || { available: false, values: {} }; }catch(e){ return { available: false, values: {} }; }
        },
        configSet: async (revision, set, reset) => {
          if (!carrier) throw new Error('unavailable');
          const r = await carrier.call('config/set', { revision, set, reset });
          if (!r || !r.ok) throw new Error((r && r.error && r.error.message) || (r && r.error && r.error.code) || 'config-set-failed');
          return r.value;
        },
        setTabOpen,
        openSidebar: openDashboardTab,
        openResource: (address) => {
          const errs = [];
          try { if (nav && typeof nav.openResource === 'function'){ nav.openResource(address, {}); return; } }
          catch (e){ errs.push('sidebarRight: ' + ((e && e.message) || e)); }
          try { if (typeof tabOpen === 'function'){ tabOpen(address); return; } }
          catch (e){ errs.push('tab.actions: ' + ((e && e.message) || e)); }
          throw new Error(errs.length ? errs.join(' / ') : '宿主未提供打开能力');
        }
      };
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS, inject: () => face
      }, DashboardBody)), 'dev-dashboard: tab body');
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title', key: TAB_ID
      }, DashTitle)), 'dev-dashboard: tab title');
      // 会话页顶部「功能地图」整页 tab（conversation.view 槽位，与「对话 / 轨迹」并列）
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view', id: MAP_TAB_ID, order: 30, label: () => t('map.tab'), locale: NS,
        inject: (sessionId) => ({
          sessionId: String(sessionId),
          loadAll: face.loadAll, watchDash: face.watchDash, notify: face.notify,
          makeVersions: face.makeVersions, configGet: face.configGet, configSet: face.configSet, openResource: face.openResource,
          openSidebar: face.openSidebar,
        }),
      }, MapView));
    }

    const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles', 'connection'];
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
