// dsh-plugin-control-your-development 宿主侧入口。
// ① 给 Loader 一个可挂载的锚点（面板本体是纯浏览器端）；
// ② 一键安装的最后一公里——把包内自带的 skill 装到全局技能目录，任何工作区都能用；
// ③ 双向闭环：面板拍板/指令 → steer 送进会话（agent 不在线则写 dev-dashboard/.inbox.jsonl 兜底）；
// ④ 插件设置：导出 Config（schemastery），DSH 设置页自动生成表单（volatile 字段在线生效）。
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import z from '@deepseek-ai/schemastery';
import { createUserMessage, boundContextSummary } from '@deepseek-ai/dsh-llm';

const PKG = dirname(dirname(fileURLToPath(import.meta.url)));   // <包根>
const SKILL_NAME = 'control-your-development';
const MARKER = '.installed-by-dsh-plugin-control-your-development.json';
const LEGACY_MARKER = '.installed-by-dsh-plugin-dev-dashboard.json';   // 改名前的标记，认它才不会把已有安装当成用户副本

/** 插件在 profile 里的行 id（cordis.patch.yml 的 insert.id）。 */
export const name = 'dev-dashboard';

/** 配置声明——Cordis 从入口模块的命名空间读它；volatile 字段进自动设置页、在线生效。 */
export const Config = z.object({
  skillRoot: z.string().default('').description('配套 skill 的安装目录（默认 DSH 全局技能目录）').volatile(),
  notifyEnabled: z.boolean().default(true).description('双向闭环：面板上的拍板/指令直接发送给当前会话（关闭后退回复制文本）').volatile(),
  timelineShow: z.number().min(5).max(200).default(30).description('时间线默认显示条数（更早的收在展开按钮后）').volatile(),
});

/** 硬依赖为空：所有增强能力都走可选接线，缺服务时退化为只读面板。 */
export const inject = [];

/** 全局技能目录：优先插件配置，其次 DSH_HOME，最后 ~/.dsh/skills。刻意不用组合层的 !!js 插值（第三方包上未经验证）。 */
export function resolveSkillRoot(config){
  if (config && typeof config.skillRoot === 'string' && config.skillRoot) return config.skillRoot;
  if (process.env.DSH_HOME) return join(process.env.DSH_HOME, 'skills');
  try { return join(homedir(), '.dsh', 'skills'); } catch (e) { return null; }
}

function readVersion(skillDir){
  try {
    const m = readFileSync(join(skillDir, 'manifest.yaml'), 'utf8').match(/^version:\s*(\S+)/m);
    return m ? m[1] : '';
  } catch (e) { return ''; }
}

function readMarker(markerPath){
  try { return JSON.parse(readFileSync(markerPath, 'utf8')); } catch (e) { return null; }
}

function writeMarker(markerPath, version){
  writeFileSync(markerPath, JSON.stringify({
    plugin: 'dsh-plugin-control-your-development', version,
    installedAt: new Date().toISOString()
  }, null, 2) + '\n');
}

/**
 * 把包内 skill 装到全局技能目录。
 * 只在「没有」或「是本插件装的且版本变化」时写入；检测到用户自己的副本就保留不动。
 */
export function provisionSkill(skillRoot, log = () => {}){
  const src = join(PKG, 'skill', SKILL_NAME);
  if (!skillRoot) return 'skipped:no-target';
  if (!existsSync(src)) return 'skipped:no-source';
  const dest = join(skillRoot, SKILL_NAME);
  const markerPath = join(dest, MARKER);
  const version = readVersion(src);
  if (!existsSync(dest)){
    mkdirSync(skillRoot, { recursive: true });
    cpSync(src, dest, { recursive: true });
    writeMarker(markerPath, version);
    log('已安装配套 skill ' + SKILL_NAME + ' v' + version + '；任何工作区都能用了');
    return 'installed';
  }
  const marker = readMarker(markerPath) || readMarker(join(dest, LEGACY_MARKER));
  if (!marker){
    log('全局已存在 ' + SKILL_NAME + '（不是本插件装的），保留不动');
    return 'kept-user-copy';
  }
  if (marker.version === version) return 'up-to-date';
  cpSync(src, dest, { recursive: true, force: true });
  writeMarker(markerPath, version);
  log('配套 skill 已更新到 v' + version + '（原 v' + marker.version + '）');
  return 'updated';
}

/* ---------- 双向闭环（v0.5）：面板 → 会话 ---------- */

const RPC_NS = 'control-your-development';
const INBOX = '.inbox.jsonl';

/** 会话的工作区绝对路径：优先会话档案的 header.cwd，其次活 agent 的 session。 */
function sessionCwd(ctx, sessionId){
  try {
    const sess = ctx.get('sessions') && ctx.get('sessions').get(sessionId);
    const cwd = sess && sess.header && (sess.header.cwd || (sess.header.meta && sess.header.meta.cwd));
    if (typeof cwd === 'string' && isAbsolute(cwd)) return cwd;
  } catch (e) { /* 服务不在或形状不符都往下走 */ }
  try {
    const agent = ctx.get('agents') && ctx.get('agents').get(sessionId);
    const cwd = agent && agent.session && agent.session.header &&
      (agent.session.header.cwd || (agent.session.header.meta && agent.session.header.meta.cwd));
    if (typeof cwd === 'string' && isAbsolute(cwd)) return cwd;
  } catch (e) { /* 同上 */ }
  return null;
}

/** 投递一条面板通知：agent 在线 → steer；不在线 → 追加 .inbox.jsonl（skill update 开头收取）。
 *  steerFirst=false 时直接进信箱（设置里关了双向闭环）。 */
function deliverNotice(ctx, sessionId, kind, text, summary, steerFirst = true){
  if (!sessionId || typeof sessionId !== 'string') return { ok: false, error: { code: 'invalid_args', message: '缺少会话', details: {} } };
  const agent = steerFirst && ctx.get('agents') && ctx.get('agents').get(sessionId);
  if (agent){
    try {
      agent.steer(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'control-your-development', form: 'notice', summary: boundContextSummary(summary || text) },
      }));
      return { ok: true, value: { delivered: 'steered' } };
    } catch (e) {
      // steer 失败不丢消息：继续走信箱兜底
    }
  }
  const cwd = sessionCwd(ctx, sessionId);
  if (!cwd) return { ok: false, error: { code: steerFirst ? 'no-workspace' : 'disabled', message: steerFirst ? '拿不到该会话的工作区路径，且会话不在线' : '双向闭环已在设置中关闭', details: {} } };
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), type: kind || 'command', text }) + '\n';
    appendFileSync(join(cwd, 'dev-dashboard', INBOX), line, 'utf8');
    return { ok: true, value: { delivered: 'queued' } };
  } catch (e) {
    return { ok: false, error: { code: 'io_error', message: String((e && e.message) || e), details: {} } };
  }
}

/** 设置服务里我们那一行（ns = cordis.patch.yml 的 insert.id）。 */
function ownSettingsRow(port){
  try {
    const rows = port.describe({ redactSecrets: true }) || [];
    return rows.find(r => r.ns === 'dev-dashboard') || null;
  } catch (e) { return null; }
}

const CONFIG_KEYS = ['skillRoot', 'notifyEnabled', 'timelineShow'];

function readPluginConfig(ctx, live){
  const values = live ? live.values() : {};
  const port = ctx.get('settings');
  const row = port ? ownSettingsRow(port) : null;
  if (!port || !row){
    return { available: false, writable: false, revision: 0, values, defaults: values, overridden: [] };
  }
  const cur = {};
  const src = (row.value && typeof row.value === 'object') ? row.value : {};
  for (const k of CONFIG_KEYS) cur[k] = (k in src) ? src[k] : values[k];
  const base = (row.base && typeof row.base === 'object') ? row.base : {};
  const defs = { ...cur };
  for (const k of CONFIG_KEYS) if (k in base) defs[k] = base[k];
  const user = (row.user && typeof row.user === 'object') ? row.user : {};
  return { available: true, writable: !!port.writable, revision: row.revision || 0,
           values: cur, defaults: defs,
           overridden: CONFIG_KEYS.filter(k => Object.hasOwn(user, k)) };
}

function checkConfigValue(key, value){
  switch (key){
    case 'skillRoot': return typeof value === 'string' ? null : 'skillRoot 要是字符串';
    case 'notifyEnabled': return typeof value === 'boolean' ? null : '双向闭环开关要是开或关';
    case 'timelineShow':
      return (typeof value === 'number' && Number.isInteger(value) && value >= 5 && value <= 200) ? null : '时间线条数要是 5–200 的整数';
  }
  return '不认识的设置项 ' + key;
}

async function writePluginConfig(ctx, live, write){
  const port = ctx.get('settings');
  const row = port ? ownSettingsRow(port) : null;
  if (!port || !row || !port.writable){
    return { ok: false, error: { code: 'unavailable', message: '这里改不了设置（设置服务不可用或只读）', details: {} } };
  }
  const ops = [];
  for (const [key, value] of Object.entries(write.set || {})){
    if (!CONFIG_KEYS.includes(key)) return { ok: false, error: { code: 'invalid_args', message: '不认识的设置项 ' + key, details: {} } };
    const problem = checkConfigValue(key, value);
    if (problem) return { ok: false, error: { code: 'invalid_args', message: problem, details: {} } };
    ops.push({ op: 'set', path: [key], value });
  }
  for (const key of write.reset || []){
    if (!CONFIG_KEYS.includes(key)) return { ok: false, error: { code: 'invalid_args', message: '不认识的设置项 ' + key, details: {} } };
    ops.push({ op: 'unset', path: [key] });
  }
  if (!ops.length) return { ok: true, value: readPluginConfig(ctx, live) };
  try {
    await port.mutate(row.ns, ops, typeof write.revision === 'number' ? write.revision : undefined);
  } catch (e) {
    if (e && e.code === 'SETTINGS_CONFLICT'){
      return { ok: false, error: { code: 'conflict', message: '设置刚被别处改过，请重新打开设置', details: {} } };
    }
    return { ok: false, error: { code: 'invalid_args', message: String((e && e.message) || e), details: {} } };
  }
  return { ok: true, value: readPluginConfig(ctx, live) };
}

/** 标准信封解码/作答（与生态插件同一条路：/api 通道上的精确 Fetch 路由）。 */
function makeFetchHandler(ctx, live){
  return async function serve(request){
    let body;
    try { body = await request.json(); }
    catch (e) { return new Response('body is not JSON', { status: 400 }); }
    const rpcId = body && typeof body.rpcId === 'string' ? body.rpcId : '';
    const respond = result => Response.json({ type: 'server-response', rpcId, result });
    const fail = (code, message) => respond({ ok: false, error: { code, message, details: {} } });
    if (!body || body.type !== 'client-request' || typeof body.method !== 'string'){
      return respond({ ok: false, error: { code: 'bad-request', message: 'invalid client-request envelope', details: {} } });
    }
    try {
      const p = (body.payload && typeof body.payload === 'object') ? body.payload : {};
      switch (body.method){
        case RPC_NS + '/notify': {
          const steerFirst = live ? live.notifyEnabled() : true;
          return respond(deliverNotice(ctx, p.sessionId, p.kind, String(p.text || ''), String(p.summary || ''), steerFirst));
        }
        case RPC_NS + '/config/get':
          return respond({ ok: true, value: readPluginConfig(ctx, live) });
        case RPC_NS + '/config/set':
          return respond(await writePluginConfig(ctx, live, p));
        default:
          return fail('bad-request', 'unknown method ' + body.method);
      }
    } catch (e) {
      return fail('internal', String((e && e.message) || e));
    }
  };
}

export function apply(ctx, config){
  try {
    const result = provisionSkill(resolveSkillRoot(config), (m) => console.log('[dev-dashboard] ' + m));
    if (result !== 'up-to-date') ctx.logger?.debug?.('[dev-dashboard] skill provision: ' + result);
  } catch (e) {
    console.warn('[dev-dashboard] 安装配套 skill 失败（不影响面板使用）：' + ((e && e.message) || e));
  }

  // 活配置（Volatile 引用：设置页写入就地更新，无需重挂插件）
  const live = config && config.notifyEnabled ? {
    notifyEnabled: () => config.notifyEnabled.get(),
    values: () => ({
      skillRoot: config.skillRoot.get(),
      notifyEnabled: config.notifyEnabled.get(),
      timelineShow: config.timelineShow.get(),
    }),
  } : null;

  // 画布 RPC：只在 connection 可用时挂（无 web 的 profile 里插件照常只带 skill 安装）
  if (ctx.inject){
    ctx.inject(['connection'], (sub) => {
      const handler = makeFetchHandler(sub, live);
      for (const ep of ['notify', 'config/get', 'config/set']){
        sub.effect(() => {
          const dispose = sub.connection.fetch.register({
            path: '/api/' + RPC_NS + '/' + ep,
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: handler,
          });
          return () => { void dispose(); };
        }, 'dev-dashboard: rpc ' + ep);
      }
    });
  }
}
