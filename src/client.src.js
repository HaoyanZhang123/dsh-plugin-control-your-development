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
    /* ---------- 统一意图通道（v1.7，D4/R1–R9）----------
       一次发送只有这一条路：**优先官方 Client Session API**（beginSubmission → prompt(…, mode, …, requestId)），
       拿不到会话就退回宿主 RPC（steer / 信箱）。**回执只报我们真观测到的那一步**：
       accepted / queued / mailbox / failed，绝不写"已完成"。
       请求 id：网络重试**复用它**（幂等）；真正重跑由调用方**换新 id**（R3/R6）。 */
    function makeIntentBus(cfg){
      const { ctx, carrier, notify, sessionId } = cfg;
      function getSession(){
        try{
          const sessions = ctx.get && ctx.get('sessions');
          const binding = sessions && typeof sessions.binding === 'function' ? sessions.binding(sessionId) : null;
          const s = binding && binding.session;
          return s && typeof s.prompt === 'function' ? s : null;
        }catch(e){ return null; }
      }
      /* 会话快照：**官方客户端 Session 的公开入口是 getSnapshot()**（0.2.1-rc.2：
         `getSnapshot()` 返回缓存快照、`subscribe(listener)` 返回退订函数）。
         这里按"先官方、再兜底"取一次：真机上曾因为写成 snapshot() 而永远"观测不到"（截图实证）。 */
      function runtimeSnapshot(){
        const s = getSession();
        if (!s) return null;
        try{
          if (typeof s.getSnapshot === 'function') return s.getSnapshot();
          if (typeof s.snapshot === 'function') return s.snapshot();     // 旧版/兼容形状
          if (typeof s.running === 'boolean') return { running: s.running, pendingSubmissions: [] };
        }catch(e){ /* 读不到就是读不到，交给 unknown */ }
        return null;
      }
      function subscribeRuntime(cb){
        const s = getSession();
        if (!s) return null;
        try{
          const notify = () => cb(runtimeSnapshot());
          if (typeof s.subscribe === 'function'){ const un = s.subscribe(notify); if (typeof un === 'function') return un; }
          if (s.notifier && typeof s.notifier.subscribe === 'function'){ const un = s.notifier.subscribe(notify); if (typeof un === 'function') return un; }
        }catch(e){ /* 退化为"只在 init/刷新时取一次" */ }
        return null;
      }
      /* mode: 'queue'（排在本轮之后）| 'steer'（打断本轮） */
      async function send(text, summary, mode){
        const s = getSession();
        const m = mode === 'steer' ? 'steer' : 'queue';
        if (s){
          let requestId = null;
          try{
            if (typeof s.beginSubmission === 'function'){
              const sub = s.beginSubmission({ mode: m, text: text, attachments: [] });
              requestId = sub && sub.requestId ? sub.requestId : null;
            }
          }catch(e){ /* beginSubmission 只是"回声占位"，拿不到就退化成宿主随机 id */ }
          const r = await s.prompt([{ type: 'text', text: text }], m, undefined, requestId || undefined);
          if (r && r.ok === true){
            const snap = runtimeSnapshot();
            const p = window.CYD.intent.project(snap);
            const placement = m === 'steer' ? 'steering' : (p.observed && p.running === false ? 'transcript' : 'queued');
            return window.CYD.intent.receipt(placement === 'queued' ? 'queued' : 'accepted',
              { requestId: requestId, placement: placement, text: text });
          }
          const code = r && r.error && (r.error.code || r.error.message);
          /* 会话通道明确失败 → 不再静默改写：交回调用方决定是否走信箱 */
          if (code && /no-session|not-found|unavailable/i.test(String(code))){ /* fallthrough */ }
          else return window.CYD.intent.receipt('failed', { requestId: requestId, reason: String(code || 'prompt-failed') });
        }
        if (notify){
          const r = await notify(sessionId, 'command', text, summary || String(text).slice(0, 60));
          return window.CYD.intent.receipt(r === 'queued' ? 'mailbox' : 'accepted', { text: text });
        }
        return window.CYD.intent.receipt('failed', { reason: '两条通道都不可用' });
      }
      /* 停止：官方 session.cancel() —— 语义就是**保留队列**（宿主 pending inbox 不动） */
      async function stop(){
        const s = getSession();
        if (!s || typeof s.cancel !== 'function') return { ok: false, error: { code: 'no-session', message: '拿不到当前会话，无法停止' } };
        return await s.cancel();
      }
      /* 停止并清空：cancel + **请求**清空（队列与信箱是宿主的，面板不直接写） */
      async function stopClear(){
        const r = await stop();
        if (!r || r.ok !== true) return r;
        const rc = await send('停止当前轮次，并把队列与 .inbox.jsonl 里未生效的条目一并清空（这是我确认过的请求）',
                               '用户请求：停止并清空队列', 'queue');
        return { ok: rc.state !== 'failed', receipt: rc, error: rc.state === 'failed' ? { code: 'clear-request-failed', message: rc.reason } : null };
      }
      return { send, stop, stopClear, runtimeSnapshot, subscribeRuntime,
               hasSession: () => !!getSession(),
               retry: (text, summary) => send(text, summary, 'queue') };
    }

    /* ---------- 读模型（v1.7）：数据只从 `.view.json` 来，面板**不解析 Markdown** ----------
       取值走宿主 RPC `control-your-development/view/read`：{sessionId, autoRebuild} →
       {state, mismatched, view:{schemaVersion, producer, format, generatedAt, data}, rebuild, detail}。
       宿主侧负责重算指纹（唯一一份 node 实现，plugin/lib/view.js）；面板只消费状态与 data。
       **拿不到 RPC 就是 unverified**（"没校验"≠"新鲜"），绝不回退成自己读 Markdown。 */
    async function readView(carrier, sessionId, autoRebuild){
      if (!carrier) return { state: 'unverified', mismatched: [], view: null, rebuild: 'not-attempted',
                             detail: '宿主 RPC 不可用' };
      try{
        const r = await carrier.call('view/read', { sessionId: sessionId, autoRebuild: !!autoRebuild });
        if (!r || !r.ok){
          const e = r && r.error;
          return { state: 'unverified', mismatched: [], view: null, rebuild: 'not-attempted',
                   detail: (e && (e.message || e.code)) || 'rpc-failed' };
        }
        const v = r.value || {};
        return { state: v.state || 'unverified', mismatched: Array.isArray(v.mismatched) ? v.mismatched : [],
                 view: v.view || null, rebuild: v.rebuild || 'not-attempted', detail: v.detail || '' };
      }catch(e){
        return { state: 'unverified', mismatched: [], view: null, rebuild: 'not-attempted',
                 detail: String((e && e.message) || e) };
      }
    }
    /* 版本快照读取（workspaceFiles 只有读方法，够了）：list / read(n) / current()
       术语表文件名从读模型里取（`glossary_file` 由渲染器解析），面板不再自己嗅探。 */
    const VERSION_BASE = ['PRODUCT.md', 'FEATURES.md', 'NOW.md'];
    let lastGlossName = null;
    /* 版本快照里要不要带术语表：文件名来自读模型（glossary_file 由渲染器解析），面板不再自己嗅探 */
    function latestGloss(data){ lastGlossName = (data && data.glossary_file) || null; }
    /* 分页续读（**唯一一份**）：宿主 read 有单页行数上限，靠 eof 判断是否读完。
       **丢掉续读 = 静默截断**：.inbox.jsonl 超过一页会少数几条，版本对比还会把长文件判成"被删了"。
       （0.6.2 修过一次 eof 判反，这里保持 while + eof 的写法。） */
    async function readAll(remote, sessionId, path, signal){
      let offset = 1, out = '', page = 2000;
      for (let i = 0; i < 50; i++){
        const v = await rpcValue(remote.workspaceFiles.read(sessionId, path, { offset: offset, limit: page }, signal));
        out += v.text || '';
        if (v.eof) break;                       // eof=true 表示本页含最后一行
        const lines = v.lines || 0;
        if (!lines) break;
        offset = (v.offset || offset) + lines;
      }
      return out;
    }
    async function readOpt(remote, sessionId, path, signal){
      try{ return await readAll(remote, sessionId, path, signal); }catch(e){ return null; }
    }
    async function readInboxRaw(remote, sessionId, signal){
      /* 待生效（意图）不进读模型：watch 到变化就重读原文，交给共享核 parseIntent（唯一解析处）。
         **三态必须分清**（真机曾把"没有这个文件"显示成"读不到"）：
           文件不存在        ⇒ ''（= 0 条，正常）
           读到了（含空文件） ⇒ 原文
           存在但读失败      ⇒ null（界面显示 —，不猜 0） */
      try{
        const st = await rpcValue(remote.workspaceFiles.stat(sessionId, 'dev-dashboard/.inbox.jsonl', signal));
        void st;
      }catch(e){
        const code = String((e && (e.code || e.message)) || e);
        if (/not-?found|enoent|不存在|no such file/i.test(code)) return '';
        return null;                      // stat 本身失败（权限/超时）：真"读不到"
      }
      const raw = await readOpt(remote, sessionId, 'dev-dashboard/.inbox.jsonl', signal);
      return raw === null ? null : raw;
    }
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
          /* 读模型：先给"正在准备"，再取（宿主可能顺手重建；重建要跑一次渲染器，慢一点要有话说） */
          if (!inst) emptyEl(mountEl, '正在准备只读视图…');
          let got = await props.readView(sessionId, true);
          if (dead) return;
          /* stale 且**手里有旧数据**时不许清空：契约 F4 要求"保留旧图 + 明确标注"，
             清成空态等于丢掉了用户还能看的那份信息（而且看起来像"没数据"）。 */
          const hasStaleData = got.state === 'stale' && got.view && got.view.data;
          if (!hasStaleData && got.rebuild === 'unavailable'
              && (got.state === 'missing' || got.state === 'stale' || got.state === 'unsupported')){
            /* 宿主重建能力不齐：说清缺什么，给"请求更新"意图（那是唯一能让它变新的通道） */
            emptyEl(mountEl, (got.state === 'missing' ? '这个工作区还没有生成读模型。' : '读模型需要更新。')
              + '<br><br><button class="btn primary" data-send-cmd>让我更新仪表盘</button>'
              + '<br><br><span class="muted">' + (got.detail ? '原因：' + got.detail : '') + '</span>');
            const sb = mountEl.querySelector('[data-send-cmd]');
            if (sb && props.notify) sb.onclick = () => {
              sb.disabled = true;
              props.notify(sessionId, 'command', '更新仪表盘', '用户请求重建读模型')
                .then(r => { sb.textContent = r === 'queued' ? '✓ 已记下，下次更新时生效' : '✓ 已发送，我来更新'; })
                .catch(() => { sb.disabled = false; sb.textContent = '发送失败，请在聊天框说「更新仪表盘」'; });
            };
            else if (sb) { sb.textContent = '请在聊天框说「更新仪表盘」'; sb.disabled = true; }
            return;
          }
          /* 这一挂载点自己的意图总线：会话 API 优先、信箱兜底；拿不到任何通道就是 null */
          const intentBus = props.busFor ? props.busFor(sessionId) : null;
          const showReceipt = rc => { if (inst && inst.receipt) inst.receipt(rc); };
          const data = got.view && got.view.data;
          if (!data){
            /* 没有任何可用数据（missing / 坏 JSON / schema 更高）：明说缺什么，不渲染半张空壳 */
            emptyEl(mountEl, (got.state === 'missing' ? '这个工作区还没有生成读模型。'
              : got.state === 'unsupported' ? '读模型版本比当前面板新，先升级插件再看。'
              : '读模型读不出来（' + (got.detail || got.state) + '）。')
              + '<br><br><button class="btn primary" data-send-cmd>让我更新仪表盘</button>');
            const sb = mountEl.querySelector('[data-send-cmd]');
            if (sb && props.notify){
              sb.onclick = () => {
                sb.disabled = true;
                props.notify(sessionId, 'command', '更新仪表盘', '用户请求重建读模型')
                  .then(r => { sb.textContent = r === 'queued' ? '✓ 已记下，下次更新时生效' : '✓ 已发送，我来更新'; })
                  .catch(() => { sb.disabled = false; sb.textContent = '发送失败，请在聊天框说「更新仪表盘」'; });
              };
            } else if (sb) { sb.textContent = '请在聊天框说「更新仪表盘」'; sb.disabled = true; }
            return;
          }
          setProjectTitle(data.project && data.project.name);
          latestGloss(data);
          const intentRaw = await props.readInbox(sessionId, ctrl.signal);
          if (dead) return;
          const canSend = !!props.notify;
          const viewStatus = {
            state: got.state, mismatched: got.mismatched,
            meta: got.view ? { schemaVersion: got.view.schemaVersion, producer: got.view.producer, format: got.view.format, generatedAt: got.view.generatedAt } : {},
          };
          inst = window.CYD.init(mountEl, {
            data,
            viewStatus,
            intentRaw,
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
            /* 「更新」按钮 = 重新读读模型（宿主可能顺带重建），不读 Markdown、不写文件 */
            reload: async () => {
              const next = await props.readView(sessionId, true);
              return next && next.view ? next.view.data : null;
            },
            /* 读模型非 fresh 时的唯一出口：发一句"更新仪表盘"的工作请求（D4：面板不直写事实） */
            /* 面板上**所有**要交给 agent 的请求都走这一条总线（单一意图通道，D4）。
               bus 按会话创建（含会话 API 与信箱兜底），拿不到就在 boot 里退化为 null。 */
            bus: props.busFor ? props.busFor(sessionId) : null,
            verifyWrite: null,   // 写回走 notify（steer/信箱），面板不直接改文件
            /* 整页「查看详情」用：宿主未注入时为 null ⇒ 共享核只退出整页（不静默假装开了侧栏） */
            openSidebar: props.openSidebar || null,
            /* 三条既有通道改走总线：回执只报观测到的那一步（accepted/queued/mailbox/failed） */
            decide: canSend && intentBus ? d => intentBus.send(d.text,
              '用户在仪表盘拍板 ' + d.id + (d.keys && d.keys.length ? '：选 ' + d.keys.join('、') : '') + (d.note ? '（附补充）' : ''), 'queue')
              .then(rc => { showReceipt(rc); return rc.state === 'failed' ? null : (rc.state === 'mailbox' ? 'queued' : 'sent'); }) : null,
            command: canSend && intentBus ? (text, summary) => intentBus.send(text, summary || String(text).slice(0, 60), 'queue')
              .then(rc => { showReceipt(rc); return rc.state === 'failed' ? null : (rc.state === 'mailbox' ? 'queued' : 'sent'); }) : null,
            ask: canSend && intentBus ? (text, summary) => intentBus.send(text, summary || String(text).slice(0, 60), 'steer')
              .then(rc => { showReceipt(rc); return rc.state === 'failed' ? null : (rc.state === 'mailbox' ? 'queued' : 'sent'); }) : null,
            /* 运行控制（R1–R10）：**只在能拿到当前会话时注入**；拿不到就整块不渲染（不假装能控） */
            run: (intentBus && intentBus.hasSession()) ? {
              stop: () => intentBus.stop(),
              stopClear: () => intentBus.stopClear(),
              retry: (text, summary) => intentBus.retry(text, summary).then(rc => { showReceipt(rc); return rc; }),
              confirm: () => (typeof window.confirm === 'function'
                ? window.confirm('停止当前轮次，并请求把队列与信箱里未生效的条目一并清空。队列里的消息将不再执行，这一步不可撤销。继续？')
                : false),
            } : null,
            versions: props.makeVersions ? props.makeVersions(sessionId, ctrl.signal) : null,
            settings: (cfg.available && props.configSet) ? {
              view: cfg,
              refresh: () => props.configGet(),
              set: (revision, set, reset) => props.configSet(revision, set, reset),
            } : null,
          });
          /* 运行投影：初始一次 + 宿主通知变化时再推（**只读**，不写任何事实） */
          if (intentBus && inst.setRun){
            inst.setRun(intentBus.runtimeSnapshot());
            let unsub = null;
            try { unsub = intentBus.subscribeRuntime(snap => { if (!dead && inst.setRun) inst.setRun(snap); }); }catch(e){ unsub = null; }
            if (unsub) ctrl.signal.addEventListener('abort', () => { try { unsub(); } catch (e) {} }, { once: true });
          }
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
      /* 刷新一次 = 重读读模型 + 重读待生效原文（两者互不等待，契约 F7）。
         `reloadQuiet` 只换数据不打断视野（共享核里"内容没变就不重排"）；
         指纹状态变了（fresh↔stale）要**升级为完整状态刷新**，否则状态条不会出现。 */
      async function refreshOnce(){
        if (!inst) { await boot(); return; }
        const got = await props.readView(sessionId, true);
        if (dead || ctrl.signal.aborted) return;
        const raw = await props.readInbox(sessionId, ctrl.signal);
        if (dead || ctrl.signal.aborted) return;
        inst.setIntent(raw);
        const viewStatus = {
          state: got.state, mismatched: got.mismatched,
          meta: got.view ? { schemaVersion: got.view.schemaVersion, producer: got.view.producer, format: got.view.format, generatedAt: got.view.generatedAt } : {},
        };
        if (got.view && got.view.data){
          latestGloss(got.view.data);
          if (inst.reloadQuietData) inst.reloadQuietData(got.view.data);
          inst.setViewStatus(viewStatus);
        } else {
          /* 读模型整个不见了 / 读不出来：重建一次完整引导（保留旧图就会变成"永远显示旧数据"） */
          inst = null;
          await boot();
        }
      }
      if (sessionId){
        (async () => {
          let backoff = 1000;
          while (!dead && !ctrl.signal.aborted){
            try{
              for await (const kind of props.watchDash(sessionId, ctrl.signal)){
                if (dead) return;
                backoff = 1000;
                clearTimeout(timer);
                timer = setTimeout(() => { refreshOnce().catch(() => {}); }, 400);
              }
              // 正常结束也视为断开：退避后重连，避免静默停更
            }catch(e){
              if (dead || ctrl.signal.aborted) return;
              if (inst) inst.notice('自动更新暂时断开，正在重连…');
            }
            await new Promise(r => setTimeout(r, backoff));
            if (!dead && !ctrl.signal.aborted) { refreshOnce().catch(() => {}); }   // 补上断线期间漏掉的变更
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
    /* 宿主右侧边栏的「选择面板」条目：标题就是 tab 标题（不是一张"使用指南"页，D2 已删那一页） */
    const zh = { title: '开发仪表盘', 'entry.title': '开发仪表盘', 'map.tab': '功能地图' };
    const en = { title: 'Dev Dashboard', 'entry.title': 'Dev Dashboard', 'map.tab': 'Feature Map' };

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
        /* 宿主用它渲染"打开右侧边栏"的选面板条目：标题=tab 标题；描述已删（D2 不再有指南页） */
        guide: [{ id: 'open', order: 30, title: () => t('entry.title'), icon: DashGuideArtwork }]
      }), 'dev-dashboard: tab type');
      const face = {
        /* 读模型：只走宿主 RPC（面板不解析 Markdown）；待生效单独重读原文 */
        readView: (sessionId, autoRebuild) => readView(carrier, sessionId, autoRebuild),
        busFor: (sessionId) => makeIntentBus({ ctx: ctx, carrier: carrier, notify: notify, sessionId: sessionId }),
        readInbox: (sessionId, signal) => readInboxRaw(ctx.remote, sessionId, signal),
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
          readView: face.readView, readInbox: face.readInbox, busFor: face.busFor, watchDash: face.watchDash, notify: face.notify,
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
