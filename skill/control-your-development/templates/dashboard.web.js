/* control-your-development 仪表盘：离线网页引导（**只读快照**，v1.7）。
   依赖同页先加载的 dashboard.core.js（window.CYD）、window.__CYD_DATA__ 与 window.__CYD_META__。
   **这里没有任何写能力**：没有目录授权（File System Access）、没有文件写入、没有实时运行控制——
   按契约「读模型 · 消费方职责」，离线页只冻结一份数据并说清它是什么时候、由哪个版本导出的。
   要更新：重新导出（在对话里说「更新仪表盘」），不靠这个页面自己变。 */
(function(){
  const DATA = window.__CYD_DATA__ || null;
  const META = window.__CYD_META__ || {};
  const toast = m => { if (window.__CYD_TOAST__) window.__CYD_TOAST__(m); else console.log('[cyd]', m); };
  const mount = document.getElementById('app');
  if (!DATA || !DATA.project){
    /* 读模型缺失就明说缺什么，不渲染半张空壳（"读不到就说读不到"） */
    CYD.ensureCss();
    mount.classList.add('cyd-app');
    mount.innerHTML = '<div class="empty">这份离线快照里没有数据（__CYD_DATA__ 为空）。'
      + '<br><br>回到对话里说一句「更新仪表盘」重新导出。</div>';
    return;
  }
  /* 导出时刻与来源版本：契约要求离线页标出它们，否则"冻结数据"会被当成实时 */
  const exported = META.exportedAt || META.generatedAt || '';
  const ver = (META.producer && META.producer.version) || '';
  CYD.init(mount, {
    data: DATA,
    browserTab: true,
    /* 冻结快照的元信息：renderStrip 用它标注导出时刻；intentRaw 由共享核 parseIntent 解析 */
    viewMeta: META,
    intentRaw: META.intentRaw === undefined ? null : META.intentRaw,
    /* 离线页永远是"快照已冻结"：新鲜度只能靠重新导出，不假装能校验 */
    viewStatus: { state: 'fresh', mismatched: [], meta: META },
    capabilityNote: '离线只读快照'
      + (exported ? ' · 导出于 ' + exported : '')
      + (ver ? ' · 源版本 ' + ver : '')
      + '；数据不会自动更新，要更新请重新导出。',
    /* 只读：不给刷新（没法重读文件）、不给写回（没有写权限） */
    reload: null,
    verifyWrite: null,
    requestUpdate: null,
    evidenceUrl: p => (DATA.workspace_uri || '') + '/' + String(p).split('/').map(encodeURIComponent).join('/'),
  });
})();
