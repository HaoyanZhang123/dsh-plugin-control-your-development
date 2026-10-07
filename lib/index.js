// dsh-plugin-dev-dashboard 宿主侧入口。
// ① 给 Loader 一个可挂载的锚点（面板本体是纯浏览器端）；
// ② 一键安装的最后一公里——把包内自带的 skill 装到全局技能目录，任何工作区都能用。
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const PKG = dirname(dirname(fileURLToPath(import.meta.url)));   // <包根>
const SKILL_NAME = 'control-your-development';
const MARKER = '.installed-by-dsh-plugin-dev-dashboard.json';

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
    plugin: 'dsh-plugin-dev-dashboard', version,
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
  const marker = readMarker(markerPath);
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

export function apply(ctx, config){
  try {
    const result = provisionSkill(resolveSkillRoot(config), (m) => console.log('[dev-dashboard] ' + m));
    if (result !== 'up-to-date') ctx.logger?.debug?.('[dev-dashboard] skill provision: ' + result);
  } catch (e) {
    console.warn('[dev-dashboard] 安装配套 skill 失败（不影响面板使用）：' + ((e && e.message) || e));
  }
}

export const inject = [];
