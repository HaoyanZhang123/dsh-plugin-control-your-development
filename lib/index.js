// src/shared/version.ts
var VERSION = "1.5.5";

// src/shared/events/limits.ts
var LIMITS = {
  /** 单次 scan 请求最多接受的会话数（04 §2.4）。 */
  maxSessions: 3e3,
  /** 单会话事件数上限；超出停止解析并标 `truncated.events`（04 §3.7）。 */
  maxEvents: 5e5,
  /** 单会话保留的最近轮次数（04 §3.7）。 */
  maxTurns: 2e3,
  /** 单轮最多文件数（04 §3.4 规则 7）。 */
  maxFilesPerTurn: 200,
  /** 单会话最多文件节点（04 §3.7）。 */
  maxFilesPerSession: 2e4,
  /** 单会话最多命令记录（04 §3.7）。 */
  maxCommands: 2e3,
  /** 单会话 messageId→turn 映射条数（04 §3.7）。 */
  maxMessageTurns: 1e4,
  /**
   * 单个会话保留的思维链样本数上限（D-35）。
   *
   * 一条样本 = 一次 assistant 回复的 reasoning 集合（不是一句话），
   * 2000 条足以覆盖超长会话，同时给 host 内存一个硬边界；
   * 超限必须标 `reasoningTruncated`，不许静默丢。
   */
  maxReasoningSamples: 2e3,
  /** 单 workspace 文件节点上限（04 §3.7）。 */
  maxFileNodes: 2e4,
  /** 单 workspace 共现边上限（04 §4.4）。 */
  maxEdges: 2e4,
  /** 每个 turn 参与共现边的 top-k 文件（04 §4.4）。 */
  maxCoTurnFiles: 12,
  /** 每条边保留的证据样本数（04 §4.4）。 */
  edgeEvidence: 3,
  /** FileNode.sessionIds 最多保留的会话 id 数（04 §4.2）。 */
  maxFileSessionIds: 20,
  /** detail 缓存会话数（04 §3.7：LRU 20）。 */
  maxDetailCache: 20,
  /** 跨扫描复用的会话摘要缓存上限（防止内存无界）。 */
  maxDigests: 500,
  /** session.errors 数组最多保留的条数（counts.errors 仍是真实总数）。 */
  maxErrors: 200,
  /** 单会话 subagents 列表上限（防止异常日志撑爆响应）。 */
  maxSubagents: 1e3,
  /** 字符串：标题（04 §3.7）。 */
  title: 200,
  /** 字符串：命令（04 §3.7）。 */
  command: 500,
  /** 字符串：用户/回复摘要（04 §3.7）。 */
  summary: 160,
  /** 字符串：错误信息。 */
  error: 200,
  /** 单条路径最大长度；超出视为非法（不是工作区文件）。 */
  maxPathLength: 1024,
  /** snapshot 响应体上限：8 MB（04 §2.3）。 */
  responseBytes: 8 * 1024 * 1024,
  /** host 保留的 rev→changes 日志条数；更旧的 sinceRev 触发 reset 全量。 */
  snapshotLog: 300,
  /** 扫描状态 60 秒无客户端轮询则自动取消（04 §2.4）。 */
  idleTimeoutMs: 6e4,
  /** 扫描 CPU 让步间隔（04 §8：每 50ms 让出）。 */
  yieldIntervalMs: 50
};
function truncateText(value, max) {
  if (value.length <= max) return value;
  if (max <= 0) return "";
  return value.slice(0, max - 1) + "…";
}
function countLines(text) {
  if (text === "") return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) lines += 1;
  }
  if (text.endsWith("\n")) lines -= 1;
  return lines < 0 ? 0 : lines;
}
function utf8Length(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 128) bytes += 1;
    else if (code < 2048) bytes += 2;
    else if (code >= 55296 && code <= 56319) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

// src/shared/events/paths.ts
var MAX_PATH_LENGTH = 1024;
function toPosix(value) {
  return value.replace(/\\/g, "/");
}
function hasControlChars(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
function isAbsolutePath(value) {
  return /^[A-Za-z]:\//.test(value) || value.startsWith("/");
}
function normalizeCwd(cwd) {
  if (typeof cwd !== "string") return "";
  const trimmed = cwd.trim();
  if (trimmed === "" || hasControlChars(trimmed)) return "";
  let posix = toPosix(trimmed);
  posix = posix.replace(/\/{2,}/g, "/");
  if (posix.length > 1 && posix.endsWith("/")) posix = posix.slice(0, -1);
  return posix;
}
function normalizeAbsolute(value) {
  let drive = "";
  let rest = value;
  const match = /^([A-Za-z]):\//.exec(value);
  if (match) {
    drive = `${match[1]}:`;
    rest = value.slice(match[0].length);
    return joinSegments(drive, rest);
  }
  if (value.startsWith("/")) {
    return joinSegments("", value.slice(1));
  }
  return null;
}
function joinSegments(prefix, rest) {
  const stack = [];
  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return prefix === "" ? `/${stack.join("/")}` : `${prefix}/${stack.join("/")}`;
}
function resolveWorkspacePath(raw, cwd) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > MAX_PATH_LENGTH) return null;
  if (hasControlChars(trimmed)) return null;
  const base = normalizeCwd(cwd);
  if (base === "") return null;
  const posix = toPosix(trimmed);
  let absolute;
  if (isAbsolutePath(posix)) {
    absolute = normalizeAbsolute(posix.replace(/\/{2,}/g, "/"));
  } else {
    absolute = normalizeAbsolute(`${base}/${posix}`);
  }
  if (absolute === null) return null;
  const baseKey = base.toLowerCase();
  const absoluteKey = absolute.toLowerCase();
  if (absoluteKey === baseKey) return null;
  if (!absoluteKey.startsWith(`${baseKey}/`)) return null;
  const relative = absolute.slice(base.length + 1);
  if (relative === "") return null;
  return { path: relative, key: relative.toLowerCase() };
}
function isAbsoluteCwd(cwd) {
  const normalized = normalizeCwd(cwd);
  if (normalized === "") return false;
  return isAbsolutePath(normalized);
}
function sameWorkspaceCwd(a, b) {
  const left = normalizeCwd(a ?? "");
  const right = normalizeCwd(b ?? "");
  if (left === "" || right === "") return false;
  return left.toLowerCase() === right.toLowerCase();
}
function looksLikeFile(path) {
  if (path.endsWith("/")) return false;
  const slash = path.lastIndexOf("/");
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = base.lastIndexOf(".");
  return dot > 0 && dot < base.length - 1;
}
var TEXT_EXT = /* @__PURE__ */ new Set([
  // 文档
  "md",
  "mdx",
  "markdown",
  "txt",
  "rst",
  "pdf",
  "doc",
  "docx",
  "odt",
  "rtf",
  // 配置（33 §5：配置并入文本）
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "env",
  "properties",
  "lock",
  "gitignore",
  "editorconfig"
]);
var CODE_EXT = /* @__PURE__ */ new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "php",
  "swift",
  "scala",
  "sh",
  "bash",
  "ps1",
  "psm1",
  "lua",
  "sql",
  "vue",
  "svelte",
  "astro",
  // 33 §5：标记/样式语言按代码算（旧实现把它们判成 other，是 bug）
  "html",
  "htm",
  "css",
  "scss",
  "less",
  "sass"
]);
var DATA_EXT = /* @__PURE__ */ new Set(["json", "jsonl", "ndjson", "csv", "tsv", "xml", "parquet", "db", "sqlite", "xlsx", "xls", "arrow"]);
var MEDIA_EXT = /* @__PURE__ */ new Set([
  // 图片
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "tif",
  "tiff",
  "avif",
  "heic",
  // 音频
  "mp3",
  "wav",
  "flac",
  "aac",
  "ogg",
  "m4a",
  "opus",
  "wma",
  // 视频
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "m4v",
  "mpg",
  "mpeg",
  "wmv"
]);
function familyOf(path) {
  const base = baseName(path);
  if (base.length > 1 && base.startsWith(".")) return "text";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    const lowered = base.toLowerCase();
    if (lowered === "makefile" || lowered === "dockerfile") return "code";
    return "other";
  }
  if (dot === base.length - 1) return "other";
  const ext = base.slice(dot + 1).toLowerCase();
  if (TEXT_EXT.has(ext)) return "text";
  if (CODE_EXT.has(ext)) return "code";
  if (DATA_EXT.has(ext)) return "data";
  if (MEDIA_EXT.has(ext)) return "media";
  return "other";
}
function baseName(path) {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}
function dirName(path) {
  const slash = path.lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash) : "";
}

// src/shared/events/reasoning.ts
function asRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  return value;
}
function asString(value) {
  return typeof value === "string" ? value : void 0;
}
function asFiniteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
function splitAssistantContent(value) {
  const direct = asString(value);
  if (direct !== void 0) return { reasoning: [], answer: direct };
  if (!Array.isArray(value)) return { reasoning: [], answer: "" };
  const reasoning = [];
  const answers = [];
  for (const block of value) {
    const record = asRecord(block);
    if (record === void 0) continue;
    const text = asString(record.text);
    if (text === void 0 || text === "") continue;
    if (asString(record.type) === "reasoning") reasoning.push(text);
    else answers.push(text);
  }
  return { reasoning, answer: answers.join("\n") };
}
function readUsage(data) {
  const candidates = [];
  if (data.usage !== void 0) candidates.push(data.usage);
  const stream = asRecord(data.stream);
  if (stream !== void 0 && stream.usage !== void 0) candidates.push(stream.usage);
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (record === void 0) continue;
    const reasoningTokens = asFiniteNonNegative(record.reasoningTokens);
    const totalRaw = asFiniteNonNegative(record.totalTokens);
    const outputTokens = asFiniteNonNegative(record.outputTokens);
    if (reasoningTokens === void 0 && totalRaw === void 0 && outputTokens === void 0) continue;
    const facts = {};
    if (reasoningTokens !== void 0) facts.reasoningTokens = reasoningTokens;
    if (outputTokens !== void 0) facts.outputTokens = outputTokens;
    if (totalRaw !== void 0) facts.totalTokens = totalRaw;
    return facts;
  }
  return {};
}
function samplesFromAssistantMessage(input) {
  const data = input.data;
  const message = asRecord(data.message);
  const content = message?.content ?? data.content;
  const split = splitAssistantContent(content);
  if (split.reasoning.length === 0) return [];
  const usage = readUsage(data);
  const interrupted = data.interrupted === true;
  const source = asRecord(message?.source);
  const model = asString(source?.model) ?? input.model ?? void 0;
  const sample = {
    /* 多个 reasoning 块合成一条样本：它们属于同一次回复，token 是整条回复的。 */
    text: split.reasoning.join("\n"),
    answerText: split.answer,
    sessionId: input.sessionId,
    turn: input.turn,
    at: input.at,
    kind: interrupted ? "attempt" : "committed",
    ...usage.reasoningTokens === void 0 ? {} : { tokens: usage.reasoningTokens },
    ...usage.outputTokens === void 0 ? {} : { outputTokens: usage.outputTokens },
    ...usage.totalTokens === void 0 ? {} : { totalTokens: usage.totalTokens },
    ...model === void 0 || model === "" ? {} : { model },
    ...input.preset === void 0 || input.preset === "" ? {} : { preset: input.preset }
  };
  return [sample];
}

// src/shared/events/reduce.ts
var COMMAND_TOOLS = /* @__PURE__ */ new Set(["bash", "pwsh", "run_code", "shell"]);
var FILE_TOOLS = /* @__PURE__ */ new Set(["read", "read_image", "write", "edit", "str_replace_editor", "grep", "glob"]);
var DELETE_COMMAND_PATTERN = /(?:^|[\n;|&])\s*(?:(?:cmd|powershell|pwsh)(?:\.exe)?\s+(?:\/c|-command|-c)\s+)?(?:sudo\s+)?(?:rm|del|rmdir|unlink|remove-item)\b|(?:^|[\n;|&])\s*git\s+rm\b/i;
var DEFAULT_LIMITS = {
  maxEvents: LIMITS.maxEvents,
  maxTurns: LIMITS.maxTurns,
  maxFilesPerTurn: LIMITS.maxFilesPerTurn,
  maxFilesPerSession: LIMITS.maxFilesPerSession,
  maxCommands: LIMITS.maxCommands,
  maxMessageTurns: LIMITS.maxMessageTurns,
  maxErrors: LIMITS.maxErrors,
  maxSubagents: LIMITS.maxSubagents
};
function asRecord2(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  return value;
}
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function asString2(value) {
  return typeof value === "string" ? value : void 0;
}
function asArray(value) {
  return Array.isArray(value) ? value : void 0;
}
function textFromContent(value) {
  const direct = asString2(value);
  if (direct !== void 0) return direct;
  const blocks = asArray(value);
  if (blocks === void 0) return void 0;
  const parts = [];
  for (const block of blocks) {
    const record = asRecord2(block);
    if (record === void 0) continue;
    const text = asString2(record.text);
    if (text !== void 0 && text !== "") parts.push(text);
  }
  if (parts.length === 0) return void 0;
  return parts.join("\n");
}
function parseArguments(value) {
  const record = asRecord2(value);
  if (record !== void 0) return record;
  const text = asString2(value);
  if (text === void 0 || text.trim() === "") return void 0;
  try {
    return asRecord2(JSON.parse(text));
  } catch {
    return void 0;
  }
}
function statusOfEndKind(kind) {
  if (kind === "completed") return "completed";
  if (kind === "aborted") return "aborted";
  return "unknown";
}
function endKindOf(value) {
  switch (value) {
    case "completed":
    case "aborted":
    case "error":
    case "interrupted":
    case "blocked":
    case "max-tokens":
    case "forked":
      return value;
    default:
      return "other";
  }
}
function programOf(args, description) {
  const command = asString2(args?.command);
  const candidate = command ?? description;
  if (candidate === void 0) return "?";
  const trimmed = candidate.trim();
  if (trimmed === "") return "?";
  const first = trimmed.split(/\s+/, 1)[0];
  return first === "" ? "?" : truncateText(first, 64);
}
function commandTextOf(name2, args, description) {
  const raw = asString2(args?.command) ?? asString2(args?.code) ?? description;
  if (raw === void 0) return void 0;
  const trimmed = raw.trim();
  if (trimmed === "") return void 0;
  return truncateText(trimmed, LIMITS.command);
}
function isDeleteCommand(args) {
  const command = asString2(args?.command);
  if (command === void 0 || command.trim() === "") return false;
  return DELETE_COMMAND_PATTERN.test(command);
}
function countDeleteCommand(turn, args) {
  if (turn === void 0) return;
  if (!isDeleteCommand(args)) return;
  turn.deleteCommands += 1;
}
function newTurn(n, start) {
  return {
    n,
    start,
    status: "running",
    files: /* @__PURE__ */ new Map(),
    commands: [],
    subagents: /* @__PURE__ */ new Set(),
    errors: 0,
    toolCalls: 0,
    toolFailures: 0,
    deleteCommands: 0,
    messageIds: []
  };
}
function turnOf(state, n) {
  if (n === null || !Number.isInteger(n) || n < 0) return void 0;
  return state.turns.get(n);
}
function ensureTurn(state, n, time) {
  const existing = state.turns.get(n);
  if (existing !== void 0) return existing;
  const turn = newTurn(n, time);
  state.turns.set(n, turn);
  state.turnOrder.push(n);
  if (state.turnOrder.length > state.limits.maxTurns) {
    const dropped = state.turnOrder.shift();
    if (dropped !== void 0) state.turns.delete(dropped);
    state.truncated.turns = true;
  }
  state.currentTurn = n;
  return turn;
}
function recordError(state, message) {
  state.errorCount += 1;
  if (state.errors.length < state.limits.maxErrors) {
    state.errors.push(truncateText(message, LIMITS.error));
  } else {
    state.truncated.errors = true;
  }
}
function registerFileKey(state, key, path) {
  if (state.fileKeys.has(key)) return true;
  if (state.fileKeys.size >= state.limits.maxFilesPerSession) {
    state.truncated.files = true;
    return false;
  }
  state.fileKeys.set(key, path);
  return true;
}
function addTurnFile(state, turn, op, resolved, added, removed, time) {
  if (!registerFileKey(state, resolved.key, resolved.path)) return;
  let file = turn.files.get(resolved.key);
  if (file === void 0) {
    if (turn.files.size >= state.limits.maxFilesPerTurn) {
      state.truncated.filesPerTurn = true;
      return;
    }
    state.touchSeq += 1;
    file = {
      path: resolved.path,
      key: resolved.key,
      ops: /* @__PURE__ */ new Set(),
      reads: 0,
      writes: 0,
      searches: 0,
      added: 0,
      removed: 0,
      firstAt: time,
      lastAt: time,
      seq: state.touchSeq
    };
    turn.files.set(resolved.key, file);
  }
  file.ops.add(op);
  if (op === "read") file.reads += 1;
  else if (op === "write") file.writes += 1;
  else file.searches += 1;
  file.added += added;
  file.removed += removed;
  file.lastAt = Math.max(file.lastAt, time);
}
function addUnassigned(state, op, resolved, added, removed, time) {
  if (!registerFileKey(state, resolved.key, resolved.path)) return;
  const existing = state.unassignedFiles.get(resolved.key);
  if (existing !== void 0) {
    if (!existing.ops.includes(op)) existing.ops.push(op);
    if (op === "read") existing.reads += 1;
    else if (op === "write") existing.writes += 1;
    else existing.searches += 1;
    existing.added += added;
    existing.removed += removed;
    existing.lastAt = Math.max(existing.lastAt, time);
    return;
  }
  state.touchSeq += 1;
  state.unassignedFiles.set(resolved.key, {
    sessionId: state.header.id,
    turn: null,
    path: resolved.path,
    key: resolved.key,
    ops: [op],
    reads: op === "read" ? 1 : 0,
    writes: op === "write" ? 1 : 0,
    searches: op === "search" ? 1 : 0,
    added,
    removed,
    firstAt: time,
    lastAt: time,
    seq: state.touchSeq
  });
}
function recordFileOp(state, turn, op, rawPath, added, removed, time) {
  const resolved = resolveWorkspacePath(rawPath, state.cwd);
  if (resolved === null) {
    state.outsideWorkspace += 1;
    return;
  }
  if (turn === void 0) {
    addUnassigned(state, op, resolved, added, removed, time);
    return;
  }
  addTurnFile(state, turn, op, resolved, added, removed, time);
}
function pushCommand(state, turn, record) {
  if (state.commandCount >= state.limits.maxCommands) {
    state.truncated.commands = true;
    return;
  }
  state.commandCount += 1;
  if (turn === void 0) {
    state.unassignedCommands.push(record);
    return;
  }
  turn.commands.push(record);
}
function resultPathsOf(name2, meta) {
  if (meta === void 0) return [];
  const paths = [];
  const files = asArray(meta.files);
  if (files !== void 0) {
    for (const entry of files) {
      const record = asRecord2(entry);
      const path = asString2(record?.path);
      if (path !== void 0 && path !== "") paths.push(path);
    }
  }
  const direct = asArray(meta.paths);
  if (direct !== void 0) {
    for (const entry of direct) {
      if (typeof entry === "string" && entry !== "") paths.push(entry);
    }
  }
  const single = asString2(meta.path);
  if (single !== void 0 && single !== "" && (name2 === "grep" || name2 === "glob")) paths.push(single);
  return paths;
}
function finishCall(state, call, status, endedAt, meta) {
  if (call.finalized) return;
  call.finalized = true;
  const turn = call.turn === null ? void 0 : state.turns.get(call.turn);
  if (status === "error") state.toolFailures += 1;
  if (COMMAND_TOOLS.has(call.name)) {
    const description = asString2(call.args?.description);
    const text = commandTextOf(call.name, call.args, description);
    const durationMs = Math.max(0, endedAt - call.startedAt);
    const record = {
      id: call.callId,
      tool: call.name,
      program: programOf(call.args, description),
      status,
      startedAt: call.startedAt,
      endedAt,
      durationMs
    };
    if (text !== void 0) record.text = text;
    if (text !== void 0 && text.length >= LIMITS.command) record.truncated = true;
    pushCommand(state, turn, record);
    return;
  }
  if (!FILE_TOOLS.has(call.name)) return;
  const args = call.args;
  const path = asString2(args?.file_path) ?? asString2(args?.path);
  if (call.name === "read" || call.name === "read_image") {
    if (path !== void 0) recordFileOp(state, turn, "read", path, 0, 0, endedAt);
    return;
  }
  if (call.name === "write") {
    const content = asString2(args?.content) ?? asString2(args?.file_text) ?? "";
    if (path !== void 0) recordFileOp(state, turn, "write", path, countLines(content), 0, endedAt);
    return;
  }
  if (call.name === "edit") {
    const added = asString2(args?.new_string) ?? asString2(args?.new_str) ?? asString2(args?.content) ?? "";
    const removed = asString2(args?.old_string) ?? asString2(args?.old_str) ?? "";
    if (path !== void 0) recordFileOp(state, turn, "write", path, countLines(added), countLines(removed), endedAt);
    return;
  }
  if (call.name === "str_replace_editor") {
    const action = asString2(args?.command) ?? asString2(args?.action);
    const editorPath = asString2(args?.path);
    if (action === "view" || action === void 0) {
      if (editorPath !== void 0) recordFileOp(state, turn, "read", editorPath, 0, 0, endedAt);
      return;
    }
    const added = asString2(args?.new_str) ?? asString2(args?.new_string) ?? asString2(args?.file_text) ?? asString2(args?.content) ?? "";
    const removed = asString2(args?.old_str) ?? asString2(args?.old_string) ?? "";
    if (editorPath !== void 0) recordFileOp(state, turn, "write", editorPath, countLines(added), countLines(removed), endedAt);
    return;
  }
  const resultPaths = resultPathsOf(call.name, meta);
  for (const resultPath of resultPaths) {
    recordFileOp(state, turn, "search", resultPath, 0, 0, endedAt);
  }
  if (path !== void 0 && looksLikeFile(path) && !resultPaths.includes(path)) {
    recordFileOp(state, turn, "search", path, 0, 0, endedAt);
  }
}
function reduceSession(header, events, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits ?? {} };
  const state = {
    header,
    cwd: typeof options.cwd === "string" && options.cwd !== "" ? options.cwd : header.cwd ?? "",
    limits,
    turns: /* @__PURE__ */ new Map(),
    turnOrder: [],
    currentTurn: null,
    calls: /* @__PURE__ */ new Map(),
    messageTurns: /* @__PURE__ */ new Map(),
    messageTurnsTruncated: false,
    fileKeys: /* @__PURE__ */ new Map(),
    commandCount: 0,
    jobs: /* @__PURE__ */ new Map(),
    subagents: /* @__PURE__ */ new Map(),
    errors: [],
    errorCount: 0,
    toolCalls: 0,
    toolFailures: 0,
    steps: 0,
    unknownEvents: 0,
    outsideWorkspace: 0,
    eventsRead: 0,
    lastTime: 0,
    truncated: {},
    partial: false,
    unassignedFiles: /* @__PURE__ */ new Map(),
    unassignedCommands: [],
    touchSeq: 0,
    reasoning: [],
    reasoningTruncated: false,
    ...header.agentPreset === void 0 || header.agentPreset === "" ? {} : { preset: header.agentPreset }
  };
  for (const child of options.children ?? []) {
    state.subagents.set(child.id, { ...child });
  }
  const headerStartedAt = Number.isFinite(header.createdAt) && header.createdAt >= 0 ? header.createdAt : 0;
  let firstEventTime = 0;
  for (const event of events) {
    if (state.eventsRead >= state.limits.maxEvents) {
      state.truncated.events = true;
      state.partial = true;
      break;
    }
    state.eventsRead += 1;
    const time = asNumber(event.time);
    if (time !== void 0 && time >= 0) {
      if (firstEventTime === 0) firstEventTime = time;
      state.lastTime = Math.max(state.lastTime, time);
    }
    const at = time ?? state.lastTime;
    const data = asRecord2(event.data) ?? {};
    switch (event.type) {
      case "session": {
        if (state.title === void 0) {
          const title = asString2(data.title);
          if (title !== void 0) state.title = truncateText(title, LIMITS.title);
        }
        break;
      }
      case "session/title": {
        const title = asString2(data.title);
        if (title !== void 0) state.title = truncateText(title, LIMITS.title);
        break;
      }
      case "request/context": {
        const provider = asString2(data.provider);
        const model = asString2(data.model);
        if (provider !== void 0) state.provider = provider;
        if (model !== void 0) state.model = model;
        break;
      }
      /* preset 变更：只记最后一次，供思维链按 preset 归组（没有就是未知，不猜）。 */
      case "agent-preset/selected": {
        const preset = asString2(data.agentPreset) ?? asString2(data.preset);
        if (preset !== void 0 && preset !== "") state.preset = preset;
        break;
      }
      case "turn/start": {
        const n = asNumber(data.turn);
        if (n === void 0) {
          state.unknownEvents += 1;
          break;
        }
        ensureTurn(state, n, at);
        state.currentTurn = n;
        break;
      }
      case "turn/end": {
        const n = asNumber(data.turn);
        const turn = turnOf(state, n ?? null);
        if (turn === void 0) {
          state.unknownEvents += 1;
          break;
        }
        const reason = asRecord2(data.reason);
        const kind = endKindOf(reason?.kind);
        turn.endKind = kind;
        turn.status = statusOfEndKind(kind);
        turn.end = at;
        if (kind === "error") {
          const failure2 = asRecord2(reason?.error);
          const code = asString2(failure2?.code) ?? asString2(failure2?.message) ?? "error";
          recordError(state, `turn ${turn.n}: ${code}`);
          turn.errors += 1;
        } else if (kind === "interrupted" || kind === "blocked" || kind === "max-tokens" || kind === "forked" || kind === "other") {
        }
        break;
      }
      case "step/start": {
        state.steps += 1;
        break;
      }
      case "step/end": {
        break;
      }
      case "user/message": {
        const text = textFromContent(data.content);
        const currentNode = state.currentTurn === null ? void 0 : state.turns.get(state.currentTurn);
        if (text !== void 0 && currentNode !== void 0 && currentNode.userText === void 0) {
          currentNode.userText = truncateText(text, LIMITS.summary);
        }
        break;
      }
      case "assistant/message": {
        const message = asRecord2(data.message);
        const id = asString2(message?.id);
        const n = asNumber(data.turn);
        const turn = turnOf(state, n ?? state.currentTurn);
        const split = splitAssistantContent(message?.content);
        const text = split.answer === "" ? void 0 : split.answer;
        if (text !== void 0) {
          if (turn !== void 0) turn.assistantText = truncateText(text, LIMITS.summary);
        }
        if (split.reasoning.length > 0 && state.reasoning.length < LIMITS.maxReasoningSamples) {
          const samples = samplesFromAssistantMessage({
            data,
            sessionId: state.header.id,
            turn: n ?? state.currentTurn,
            ...state.model === void 0 ? {} : { model: state.model },
            ...state.preset === void 0 ? {} : { preset: state.preset },
            at
          });
          for (const sample of samples) {
            if (state.reasoning.length >= LIMITS.maxReasoningSamples) {
              state.reasoningTruncated = true;
              break;
            }
            state.reasoning.push(sample);
          }
        } else if (split.reasoning.length > 0) {
          state.reasoningTruncated = true;
        }
        const interrupted = data.interrupted === true;
        if (id !== void 0) {
          if (turn !== void 0) {
            turn.messageIds.push(id);
            if (!interrupted) turn.finalMessageId = id;
          }
          if (n !== void 0) {
            if (state.messageTurns.size >= state.limits.maxMessageTurns && !state.messageTurns.has(id)) {
              state.messageTurnsTruncated = true;
            } else {
              state.messageTurns.set(id, n);
            }
          }
        }
        break;
      }
      case "tool/call": {
        const callId = asString2(data.callId);
        const name2 = asString2(data.name);
        if (callId === void 0 || name2 === void 0) {
          state.unknownEvents += 1;
          break;
        }
        const n = asNumber(data.turn);
        state.toolCalls += 1;
        const args = parseArguments(data.arguments);
        state.calls.set(callId, {
          callId,
          name: name2,
          turn: n ?? null,
          startedAt: at,
          args,
          sub: false,
          finalized: false
        });
        const turn = turnOf(state, n ?? state.currentTurn);
        if (turn !== void 0) {
          turn.toolCalls += 1;
          if (COMMAND_TOOLS.has(name2)) countDeleteCommand(turn, args);
        }
        break;
      }
      case "tool/result": {
        const message = asRecord2(data.message);
        const source = asRecord2(message?.source);
        const callId = asString2(source?.callId) ?? asString2(message?.toolCallId) ?? asString2(data.callId);
        const call = callId === void 0 ? void 0 : state.calls.get(callId);
        if (call === void 0) {
          state.unknownEvents += 1;
          break;
        }
        const failed = message?.isError === true || data.error !== void 0;
        finishCall(state, call, failed ? "error" : "success", at, asRecord2(data.meta));
        if (failed) {
          const errorRecord = asRecord2(data.error);
          const code = asString2(errorRecord?.code) ?? "tool-error";
          recordError(state, `${call.name}: ${code}`);
          const turn = call.turn === null ? void 0 : state.turns.get(call.turn);
          if (turn !== void 0) {
            turn.errors += 1;
            turn.toolFailures += 1;
          }
        }
        break;
      }
      case "tool/ptc-dispatch-start": {
        const subCallId = asString2(data.subCallId);
        const name2 = asString2(data.name);
        if (subCallId === void 0 || name2 === void 0) {
          state.unknownEvents += 1;
          break;
        }
        const rootCallId = asString2(data.rootCallId);
        const parentCallId = asString2(data.parentCallId);
        const rootCall = rootCallId === void 0 ? void 0 : state.calls.get(rootCallId);
        const parentCall = parentCallId === void 0 ? void 0 : state.calls.get(parentCallId);
        const turnNumber = rootCall?.turn ?? parentCall?.turn ?? null;
        state.toolCalls += 1;
        const subArgs = parseArguments(data.arguments);
        state.calls.set(subCallId, {
          callId: subCallId,
          name: name2,
          turn: turnNumber,
          startedAt: at,
          args: subArgs,
          sub: true,
          finalized: false
        });
        const turn = turnNumber === null ? void 0 : state.turns.get(turnNumber);
        if (turn !== void 0) {
          turn.toolCalls += 1;
          if (COMMAND_TOOLS.has(name2)) countDeleteCommand(turn, subArgs);
        }
        break;
      }
      case "tool/ptc-dispatch": {
        const subCallId = asString2(data.subCallId);
        const call = subCallId === void 0 ? void 0 : state.calls.get(subCallId);
        if (call === void 0) {
          state.unknownEvents += 1;
          break;
        }
        const failed = data.isError === true || data.error !== void 0;
        if (call.args === void 0) call.args = parseArguments(data.arguments);
        finishCall(state, call, failed ? "error" : "success", at, asRecord2(data.meta));
        if (failed) {
          const errorRecord = asRecord2(data.error);
          const code = asString2(errorRecord?.code) ?? "ptc-error";
          recordError(state, `${call.name}: ${code}`);
          const turn = call.turn === null ? void 0 : state.turns.get(call.turn);
          if (turn !== void 0) {
            turn.errors += 1;
            turn.toolFailures += 1;
          }
        }
        break;
      }
      case "job/registered": {
        const jobId = asString2(data.jobId);
        if (jobId === void 0) {
          state.unknownEvents += 1;
          break;
        }
        if (state.jobs.size < 1e3) {
          const job = { id: jobId, status: "unknown" };
          const owner = asString2(data.owner);
          const kind = asString2(data.kind);
          const label = asString2(data.label);
          const startedAt2 = asNumber(data.startedAt);
          if (owner !== void 0) job.owner = owner;
          if (kind !== void 0) job.kind = kind;
          if (label !== void 0) job.label = truncateText(label, LIMITS.title);
          if (startedAt2 !== void 0) job.startedAt = startedAt2;
          state.jobs.set(jobId, job);
        }
        break;
      }
      case "job/settled": {
        const jobId = asString2(data.jobId);
        const job = jobId === void 0 ? void 0 : state.jobs.get(jobId);
        if (job === void 0) {
          state.unknownEvents += 1;
          break;
        }
        const status2 = data.status === "completed" ? "completed" : data.status === "killed" ? "killed" : "unknown";
        job.status = status2;
        const finishedAt = asNumber(data.finishedAt);
        if (finishedAt !== void 0) job.finishedAt = finishedAt;
        break;
      }
      case "subagent/catalog": {
        const childId = asString2(data.childId);
        if (childId === void 0) {
          state.unknownEvents += 1;
          break;
        }
        if (state.subagents.size >= state.limits.maxSubagents) {
          state.truncated.subagents = true;
          break;
        }
        if (!state.subagents.has(childId)) {
          const label = asString2(data.label);
          const record = { id: childId };
          if (label !== void 0) record.title = truncateText(label, LIMITS.title);
          state.subagents.set(childId, record);
        }
        {
          const n = asNumber(data.turn);
          const turn = turnOf(state, n ?? null);
          if (turn !== void 0 && !turn.subagents.has(childId)) turn.subagents.add(childId);
        }
        break;
      }
      case "agent/inbox/spliced": {
        break;
      }
      default: {
        state.unknownEvents += 1;
        break;
      }
    }
  }
  for (const call of state.calls.values()) {
    if (call.finalized) continue;
    finishCall(state, call, "unknown", state.lastTime);
  }
  const lastTurnNumber = state.turnOrder.length > 0 ? state.turnOrder[state.turnOrder.length - 1] : void 0;
  let openTurn = false;
  for (const n of state.turnOrder) {
    const turn = state.turns.get(n);
    if (turn === void 0) continue;
    if (turn.status === "running" && turn.end === void 0) {
      openTurn = true;
      if (n === lastTurnNumber && options.running === true) {
        turn.status = "running";
      } else {
        turn.status = "unknown";
      }
    }
  }
  if (openTurn) state.partial = true;
  const startedAt = headerStartedAt > 0 ? headerStartedAt : firstEventTime;
  const turns = [];
  const touches = [];
  for (const n of state.turnOrder) {
    const turn = state.turns.get(n);
    if (turn === void 0) continue;
    const files = [];
    for (const file of turn.files.values()) {
      files.push({
        path: file.path,
        ops: Array.from(file.ops),
        added: file.added,
        removed: file.removed
      });
      touches.push({
        sessionId: header.id,
        turn: turn.n,
        path: file.path,
        key: file.key,
        ops: Array.from(file.ops),
        reads: file.reads,
        writes: file.writes,
        searches: file.searches,
        added: file.added,
        removed: file.removed,
        firstAt: file.firstAt,
        lastAt: file.lastAt,
        seq: file.seq
      });
    }
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const turnDetail = {
      n: turn.n,
      start: turn.start,
      status: turn.status,
      files,
      commands: turn.commands,
      subagents: Array.from(turn.subagents).sort(),
      errors: turn.errors,
      toolCalls: turn.toolCalls,
      toolFailures: turn.toolFailures,
      messageIds: turn.messageIds
    };
    if (turn.end !== void 0) turnDetail.end = turn.end;
    if (turn.endKind !== void 0) turnDetail.endKind = turn.endKind;
    if (turn.deleteCommands > 0) turnDetail.deleteCommands = turn.deleteCommands;
    if (turn.finalMessageId !== void 0) turnDetail.finalMessageId = turn.finalMessageId;
    if (turn.userText !== void 0) turnDetail.userText = turn.userText;
    if (turn.assistantText !== void 0) turnDetail.assistantText = turn.assistantText;
    turns.push(turnDetail);
  }
  for (const file of state.unassignedFiles.values()) touches.push(file);
  touches.sort((a, b) => {
    const turnA = a.turn === null ? Number.MAX_SAFE_INTEGER : a.turn;
    const turnB = b.turn === null ? Number.MAX_SAFE_INTEGER : b.turn;
    if (turnA !== turnB) return turnA - turnB;
    return a.seq - b.seq;
  });
  if (state.messageTurnsTruncated) state.truncated.messageTurns = true;
  const lastTurn = lastTurnNumber === void 0 ? void 0 : state.turns.get(lastTurnNumber);
  const status = lastTurn === void 0 ? "unknown" : lastTurn.status;
  const endedAt = (() => {
    let latest;
    for (const n of state.turnOrder) {
      const turn = state.turns.get(n);
      if (turn?.end !== void 0 && (latest === void 0 || turn.end > latest)) latest = turn.end;
    }
    return latest;
  })();
  const messageTurns = {};
  for (const [id, n] of state.messageTurns) messageTurns[id] = n;
  const running = options.running === true;
  const subagents = Array.from(state.subagents.values()).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const detail = {
    id: header.id,
    rootId: options.rootId ?? header.id,
    cwd: state.cwd,
    startedAt,
    updatedAt: state.lastTime > 0 ? state.lastTime : startedAt,
    status,
    turns,
    subagents,
    messageTurns,
    errors: state.errors,
    counts: {
      turns: state.turnOrder.length,
      steps: state.steps,
      toolCalls: state.toolCalls,
      toolFailures: state.toolFailures,
      files: state.fileKeys.size,
      commands: state.commandCount,
      subagents: subagents.length,
      errors: state.errorCount
    },
    jobs: Array.from(state.jobs.values())
  };
  if (header.parentSession !== void 0) detail.parentId = header.parentSession;
  if (state.title !== void 0) detail.title = state.title;
  if (header.origin !== void 0) detail.origin = header.origin;
  if (state.model !== void 0) detail.model = state.model;
  if (state.provider !== void 0) detail.provider = state.provider;
  if (endedAt !== void 0) detail.endedAt = endedAt;
  if (running) detail.running = true;
  if (state.partial) detail.partial = true;
  if (Object.keys(state.truncated).length > 0) detail.truncated = state.truncated;
  if (state.unassignedFiles.size > 0 || state.unassignedCommands.length > 0) {
    detail.unassigned = {
      files: Array.from(state.unassignedFiles.values()),
      commands: state.unassignedCommands
    };
  }
  if (state.reasoning.length > 0) detail.reasoning = state.reasoning;
  if (state.reasoningTruncated) detail.reasoningTruncated = true;
  if (state.preset !== void 0) detail.preset = state.preset;
  return {
    detail,
    touches,
    outsideWorkspace: state.outsideWorkspace,
    unknownEvents: state.unknownEvents,
    eventsRead: state.eventsRead
  };
}
function fileNodeFromTouches(path, touches, sessionIds, sessionCount, turnCount) {
  let reads = 0;
  let writes = 0;
  let searches = 0;
  let added = 0;
  let removed = 0;
  let firstAt = Number.POSITIVE_INFINITY;
  let lastAt = 0;
  for (const touch of touches) {
    reads += touch.reads;
    writes += touch.writes;
    searches += touch.searches;
    added += touch.added;
    removed += touch.removed;
    if (touch.firstAt < firstAt) firstAt = touch.firstAt;
    if (touch.lastAt > lastAt) lastAt = touch.lastAt;
  }
  if (!Number.isFinite(firstAt)) firstAt = 0;
  return {
    path,
    name: baseName(path),
    dir: dirName(path),
    family: familyOf(path),
    firstAt,
    lastAt,
    reads,
    writes,
    searches,
    added,
    removed,
    ops: reads + writes + searches,
    sessionIds: Array.from(sessionIds),
    sessionCount,
    turnCount
  };
}

// src/shared/events/normalize.ts
var SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
function isSessionId(value) {
  return typeof value === "string" && SESSION_ID_RE.test(value) && value !== "." && value !== "..";
}
function optionalText(value) {
  return typeof value === "string" && value !== "" ? value : void 0;
}
function normalizeScanSessions(input) {
  const sessions = [];
  const skipped = [];
  if (!Array.isArray(input)) {
    skipped.push({ id: null, reason: "not-object" });
    return { sessions, skipped };
  }
  const seen = /* @__PURE__ */ new Set();
  for (const entry of input) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      skipped.push({ id: null, reason: "not-object" });
      continue;
    }
    const row = entry;
    const id = row.id;
    if (!isSessionId(id)) {
      skipped.push({ id: typeof id === "string" ? id.slice(0, 200) : null, reason: "invalid-id" });
      continue;
    }
    if (seen.has(id)) {
      skipped.push({ id, reason: "duplicate" });
      continue;
    }
    const updatedAt = row.updatedAt;
    if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt) || updatedAt < 0) {
      skipped.push({ id, reason: "invalid-updatedAt" });
      continue;
    }
    seen.add(id);
    const session = {
      id,
      updatedAt,
      running: row.running === true
    };
    const parentId = optionalText(row.parentId);
    if (parentId !== void 0) session.parentId = parentId;
    const title = optionalText(row.title);
    if (title !== void 0) session.title = title;
    const origin = optionalText(row.origin);
    if (origin !== void 0) session.origin = origin;
    if (row.archived === true) session.archived = true;
    sessions.push(session);
  }
  return { sessions, skipped };
}
function normalizeRefreshIds(input, validIds) {
  if (!Array.isArray(input)) return { ids: [], dropped: 0 };
  const ids = [];
  const seen = /* @__PURE__ */ new Set();
  let dropped = 0;
  for (const entry of input) {
    if (!isSessionId(entry) || !validIds.has(entry) || seen.has(entry)) {
      dropped += 1;
      continue;
    }
    seen.add(entry);
    ids.push(entry);
  }
  return { ids, dropped };
}

// src/shared/relations/path.ts
var WINDOWS_DRIVE = /^[a-zA-Z]:\//;
function toPosix2(path) {
  return path.replace(/\\/g, "/");
}
function hasWindowsDrive(path) {
  const value = toPosix2(path.trim());
  return WINDOWS_DRIVE.test(value) || value.startsWith("//");
}
function isAbsolutePath2(path) {
  const value = toPosix2(path.trim());
  return value.startsWith("/") || WINDOWS_DRIVE.test(value) || value.startsWith("//");
}
function trimTrailingSlash(path) {
  const value = toPosix2(path);
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}
function normalizeRelative(input) {
  const raw = toPosix2(input.trim());
  const segments = [];
  let escaped = false;
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        escaped = true;
        continue;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return { path: segments.join("/"), escaped };
}
function needsCaseFold(path) {
  return hasWindowsDrive(path) || /^[a-zA-Z]:/.test(toPosix2(path));
}
function containsPath(cwd, target, caseInsensitive) {
  const left = trimTrailingSlash(cwd);
  const right = trimTrailingSlash(target);
  if (left === "" || right === "") return false;
  const fold = caseInsensitive ?? (needsCaseFold(left) || needsCaseFold(right));
  const a = fold ? toPosix2(left).toLowerCase() : toPosix2(left);
  const b = fold ? toPosix2(right).toLowerCase() : toPosix2(right);
  if (b === a) return false;
  return b.startsWith(`${a}/`);
}

// src/host/scan.ts
function pickAuthoritativeCwd(headers) {
  const counts = /* @__PURE__ */ new Map();
  let order = 0;
  for (const header of headers.values()) {
    const cwd = normalizeCwd(typeof header.cwd === "string" ? header.cwd : "");
    if (cwd === "") continue;
    const existing = counts.get(cwd);
    if (existing === void 0) counts.set(cwd, { count: 1, firstAt: order });
    else existing.count += 1;
    order += 1;
  }
  let best;
  let bestCount = 0;
  let bestFirst = Number.POSITIVE_INFINITY;
  for (const [cwd, stat] of counts) {
    if (stat.count > bestCount || stat.count === bestCount && stat.firstAt < bestFirst) {
      best = cwd;
      bestCount = stat.count;
      bestFirst = stat.firstAt;
    }
  }
  return best;
}
function isSameOrInside(root, target) {
  const left = normalizeCwd(root);
  const right = normalizeCwd(typeof target === "string" ? target : "");
  if (left === "" || right === "") return false;
  if (sameWorkspaceCwd(left, right)) return true;
  return containsPath(left, right);
}
function errorName(error) {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name2 = error.name;
    if (typeof name2 === "string") return name2;
  }
  return "";
}
function mapReadError(error) {
  const name2 = errorName(error);
  if (name2 === "SessionFormatUnsupportedError") {
    return { code: "threadline/format-unsupported", message: "session format unsupported" };
  }
  if (name2 === "SessionPersistenceCorruptionError" || name2 === "SessionPersistenceNotFoundError" || name2 === "SessionNotFoundError" || name2 === "SessionHandleClosedError") {
    return { code: "threadline/session-unreadable", message: "session log unreadable", detail: name2 };
  }
  if (name2 === "SessionReadOnlyError") {
    return { code: "threadline/internal", message: "unexpected read-only violation", detail: name2 };
  }
  return { code: "threadline/internal", message: "scan failed", detail: name2 === "" ? void 0 : name2 };
}
var WEEK_MS = 7 * 24 * 60 * 60 * 1e3;
function byUpdatedDesc(a, b) {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
function orderSessions(inputs, parents, now) {
  const byId = new Map(inputs.map((input) => [input.id, input]));
  const children = /* @__PURE__ */ new Map();
  for (const input of inputs) {
    const parent = parents.get(input.id);
    if (parent === void 0 || !byId.has(parent)) continue;
    const list = children.get(parent);
    if (list === void 0) children.set(parent, [input.id]);
    else list.push(input.id);
  }
  for (const list of children.values()) {
    list.sort((a, b) => byUpdatedDesc(byId.get(a), byId.get(b)));
  }
  const order = [];
  const placed = /* @__PURE__ */ new Set();
  const visit = (id) => {
    if (placed.has(id)) return;
    const parent = parents.get(id);
    if (parent !== void 0 && byId.has(parent) && !placed.has(parent)) visit(parent);
    if (placed.has(id)) return;
    placed.add(id);
    order.push(id);
    for (const child of children.get(id) ?? []) visit(child);
  };
  const running = inputs.filter((input) => input.running && input.archived !== true).sort(byUpdatedDesc);
  const recent = inputs.filter((input) => !input.running && input.archived !== true && input.updatedAt >= now - WEEK_MS).sort(byUpdatedDesc);
  const older = inputs.filter((input) => !input.running && input.archived !== true && input.updatedAt < now - WEEK_MS).sort(byUpdatedDesc);
  const archived = inputs.filter((input) => input.archived === true).sort(byUpdatedDesc);
  for (const group of [running, recent, older, archived]) {
    for (const input of group) visit(input.id);
  }
  for (const input of inputs) visit(input.id);
  return order;
}
function buildEdgeContributions(sessionId, touches) {
  const byTurn = /* @__PURE__ */ new Map();
  for (const touch of touches) {
    if (touch.turn === null) continue;
    const list = byTurn.get(touch.turn);
    if (list === void 0) byTurn.set(touch.turn, [touch]);
    else list.push(touch);
  }
  const edges = /* @__PURE__ */ new Map();
  for (const [turn, files] of byTurn) {
    const ranked = files.slice().sort((a, b) => {
      const opsA = a.reads + a.writes + a.searches;
      const opsB = b.reads + b.writes + b.searches;
      if (opsB !== opsA) return opsB - opsA;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    }).slice(0, LIMITS.maxCoTurnFiles).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    for (let i = 0; i < ranked.length; i += 1) {
      for (let j = i + 1; j < ranked.length; j += 1) {
        const from = ranked[i];
        const to = ranked[j];
        const key = `${from.key}
${to.key}`;
        const existing = edges.get(key);
        if (existing !== void 0) {
          existing.weight += 1;
          existing.evidence.push({ sessionId, turn });
          continue;
        }
        edges.set(key, { from: from.path, to: to.path, weight: 1, evidence: [{ sessionId, turn }] });
      }
    }
  }
  for (const edge of edges.values()) {
    if (edge.evidence.length > LIMITS.edgeEvidence) edge.evidence = edge.evidence.slice(-LIMITS.edgeEvidence);
  }
  return Array.from(edges.values());
}
function digestFromReduction(updatedAt, detail, touches) {
  return {
    updatedAt,
    info: {
      id: detail.id,
      ...detail.parentId === void 0 ? {} : { parentId: detail.parentId },
      ...detail.title === void 0 ? {} : { title: detail.title },
      cwd: detail.cwd,
      ...detail.origin === void 0 ? {} : { origin: detail.origin },
      archived: detail.archived === true,
      running: detail.running === true,
      startedAt: detail.startedAt,
      ...detail.endedAt === void 0 ? {} : { endedAt: detail.endedAt },
      updatedAt: detail.updatedAt,
      ...detail.model === void 0 ? {} : { model: detail.model },
      ...detail.provider === void 0 ? {} : { provider: detail.provider },
      status: detail.status,
      turns: detail.counts.turns,
      files: detail.counts.files,
      commands: detail.counts.commands,
      errors: detail.counts.errors
    },
    touches: touches.slice(),
    edges: buildEdgeContributions(detail.id, touches),
    catalogChildren: detail.subagents.map((child) => child.id)
  };
}
function edgeKey(from, to) {
  return `${from.toLowerCase()}\0${to.toLowerCase()}`;
}
function unionChildren(catalog, requestChildren) {
  const set = new Set(catalog);
  for (const id of requestChildren) set.add(id);
  return Array.from(set);
}
var ScanManager = class {
  services;
  options;
  workspaces = /* @__PURE__ */ new Map();
  scans = /* @__PURE__ */ new Map();
  detailCache = /* @__PURE__ */ new Map();
  lastScan;
  scanCounter = 0;
  disposed = false;
  constructor(services, options = {}) {
    this.services = services;
    this.options = options;
  }
  now() {
    return this.options.now?.() ?? Date.now();
  }
  async yieldNow() {
    if (this.options.yield !== void 0) await this.options.yield();
    else await new Promise((resolve) => setTimeout(resolve, 0));
  }
  responseBytes() {
    return this.options.responseBytes ?? LIMITS.responseBytes;
  }
  reduceLimits() {
    return this.options.reduceLimits;
  }
  /* ---------------- scan ---------------- */
  /**
   * `POST /scan`：校验归属后启动后台扫描，立即返回 scanId/total/order。
   *
   * `tolerance` 携带协议层已容错掉的计数（脏行、被丢弃的 refresh id），
   * 与归属阶段的跳过数合并后一并在响应里上报 —— 容错必须可见。
   */
  async startRequest(request, tolerance = {}) {
    const persistence = this.services.getPersistence();
    if (persistence === void 0) {
      return { ok: false, error: { code: "threadline/capability-missing", message: "session persistence unavailable" } };
    }
    const ownership = await this.validateOwnership(persistence, request);
    if (!ownership.ok || ownership.headers === void 0 || ownership.parents === void 0) {
      return {
        ok: false,
        error: ownership.error ?? { code: "threadline/bad-request", message: "session ownership rejected" }
      };
    }
    const authoritativeCwd = ownership.cwd !== void 0 && ownership.cwd !== "" ? ownership.cwd : request.cwd;
    const sessions = request.sessions.filter((input) => ownership.headers?.has(input.id) === true);
    const workspace = this.workspaceFor(request.workspaceId, authoritativeCwd);
    if (workspace.activeScanId !== void 0) this.cancelScan(workspace.activeScanId);
    const order = orderSessions(sessions, ownership.parents, this.now());
    const requestChildren = /* @__PURE__ */ new Map();
    for (const [id, parent] of ownership.parents) {
      if (parent === void 0 || !ownership.headers.has(parent)) continue;
      const list = requestChildren.get(parent);
      if (list === void 0) requestChildren.set(parent, [id]);
      else list.push(id);
    }
    const scanId = `scan-${this.scanCounter += 1}`;
    const state = {
      scanId,
      workspaceId: request.workspaceId,
      generation: request.generation,
      cwd: request.cwd,
      rev: 0,
      minRev: 1,
      changes: [],
      progress: { total: order.length, scanned: 0, failed: 0, cached: 0, phase: "starting" },
      sessions: /* @__PURE__ */ new Map(),
      files: /* @__PURE__ */ new Map(),
      edges: /* @__PURE__ */ new Map(),
      errors: [],
      requestChildren,
      inputs: new Map(sessions.map((input) => [input.id, input])),
      done: false,
      cancelled: false,
      startedAt: this.now(),
      lastPollAt: this.now(),
      abort: new AbortController(),
      filesTruncated: false,
      edgesTruncated: false
    };
    workspace.activeScanId = scanId;
    this.scans.set(scanId, state);
    this.lastScan = state;
    this.trimScanRegistry();
    this.armIdleTimer(state);
    const inputs = new Map(sessions.map((input) => [input.id, input]));
    const refresh = new Set(request.refresh ?? []);
    void this.runScan(state, workspace, inputs, ownership.headers, order, refresh).catch(() => {
      if (!state.cancelled) {
        state.progress.phase = "failed";
        state.done = true;
      }
    });
    const skippedSummary = {
      request: tolerance.skipped?.length ?? 0,
      ownership: Math.max(0, request.sessions.length - sessions.length),
      refresh: tolerance.refreshDropped ?? 0
    };
    const payload = { scanId, rev: 0, total: order.length, order };
    if (skippedSummary.request > 0 || skippedSummary.ownership > 0 || skippedSummary.refresh > 0) {
      payload.skipped = skippedSummary;
    }
    return { ok: true, ...payload };
  }
  /**
   * 归属校验：判定每个会话是否属于本次扫描，并给出**权威 cwd**。
   *
   * 2026-11-09 改为**逐行容错**（原来是"一个不合规就整条拒绝"）：
   * - 读不出 header → 跳过该会话（持久层单条坏不该毁掉整个工作区）；
   * - 既不是同 cwd、也不在任一请求会话的子树下、父会话又不在请求里 → 跳过；
   * - **全部跳过**才返回 `bad-request`（那才是真的 workspace 不匹配，必须响亮失败）。
   *
   * 权威 cwd 取**会话 header 里的众数**，客户端传的 cwd 只作兜底：
   * 客户端 cwd 与会话 header cwd 是两份事实来源，以客户端那份为准时任何形态差异都会整条失败。
   */
  async validateOwnership(persistence, request) {
    const requestedIds = new Set(request.sessions.map((input) => input.id));
    const headers = /* @__PURE__ */ new Map();
    const query = this.services.getSessionQuery();
    if (query?.listSessions !== void 0) {
      let listed = [];
      try {
        listed = await query.listSessions();
      } catch {
        listed = [];
      }
      for (const entry of listed) {
        const candidate = entry;
        const header = candidate.header ?? candidate;
        if (header === void 0 || typeof header.id !== "string") continue;
        if (!requestedIds.has(header.id)) continue;
        headers.set(header.id, header);
      }
    }
    for (const input of request.sessions) {
      if (headers.has(input.id)) continue;
      const header = await this.readHeader(persistence, input.id);
      if (header !== void 0) headers.set(input.id, header);
    }
    const authoritativeCwd = pickAuthoritativeCwd(headers) ?? normalizeCwd(request.cwd);
    const kept = /* @__PURE__ */ new Map();
    for (const input of request.sessions) {
      const header = headers.get(input.id);
      if (header === void 0) continue;
      const parent = header.parentSession;
      if (parent !== void 0 && requestedIds.has(parent)) {
        kept.set(input.id, header);
        continue;
      }
      if (isSameOrInside(authoritativeCwd, header.cwd)) kept.set(input.id, header);
    }
    if (kept.size === 0 && request.sessions.length > 0) {
      return {
        ok: false,
        error: {
          code: "threadline/bad-request",
          message: "no session in the request belongs to this workspace"
        }
      };
    }
    const parents = /* @__PURE__ */ new Map();
    for (const [id, header] of kept) parents.set(id, header.parentSession);
    return { ok: true, headers: kept, parents, cwd: authoritativeCwd };
  }
  async readHeader(persistence, id) {
    try {
      if (persistence.stat !== void 0) {
        const stat = await persistence.stat(id);
        if (stat?.header !== void 0) return stat.header;
      }
      const handle = await persistence.open(id, "read");
      try {
        return handle.header;
      } finally {
        await handle.close?.();
      }
    } catch {
      return void 0;
    }
  }
  workspaceFor(workspaceId, cwd) {
    const existing = this.workspaces.get(workspaceId);
    if (existing !== void 0) {
      existing.cwd = cwd;
      return existing;
    }
    const created = { workspaceId, cwd, digests: /* @__PURE__ */ new Map() };
    this.workspaces.set(workspaceId, created);
    return created;
  }
  async runScan(state, workspace, inputs, headers, order, refresh) {
    state.progress.phase = "scanning";
    let lastYieldAt = this.now();
    let processed = 0;
    for (const id of order) {
      if (state.cancelled || this.disposed) return;
      const input = inputs.get(id);
      if (input === void 0) continue;
      state.progress.currentId = id;
      const patch = this.emptyPatch();
      await this.processSession(state, workspace, input, headers.get(id), refresh, patch);
      state.rev += 1;
      this.pushChanges(state, state.rev, patch);
      processed += 1;
      if (this.options.yield !== void 0) {
        if (processed < order.length) await this.yieldNow();
        lastYieldAt = this.now();
        continue;
      }
      const now = this.now();
      if (now - lastYieldAt >= LIMITS.yieldIntervalMs || processed % 16 === 0) {
        await this.yieldNow();
        lastYieldAt = this.now();
      }
    }
    if (state.cancelled || this.disposed) return;
    state.progress.currentId = void 0;
    state.progress.phase = "complete";
    state.done = true;
  }
  async processSession(state, workspace, input, header, refresh, patch) {
    const cached = workspace.digests.get(input.id);
    if (cached !== void 0 && cached.updatedAt === input.updatedAt && !refresh.has(input.id)) {
      state.progress.cached += 1;
      this.applyDigest(state, cached, input, patch);
      state.progress.scanned += 1;
      return;
    }
    const persistence = this.services.getPersistence();
    if (persistence === void 0) {
      state.progress.failed += 1;
      this.recordScanError(state, patch, {
        sessionId: input.id,
        code: "threadline/capability-missing",
        message: "session persistence unavailable"
      });
      return;
    }
    let handle;
    try {
      handle = await persistence.open(input.id, "read", { signal: state.abort.signal });
      const read = await handle.read(0, void 0, { signal: state.abort.signal });
      const events = Array.isArray(read?.events) ? read.events : [];
      const openHeader = handle.header ?? header ?? { id: input.id, createdAt: input.updatedAt };
      const reduction = reduceSession(openHeader, events, {
        cwd: this.cwdFor(openHeader, state.cwd),
        running: input.running,
        limits: this.reduceLimits()
      });
      const digest = digestFromReduction(input.updatedAt, reduction.detail, reduction.touches);
      workspace.digests.set(input.id, digest);
      this.trimDigests(workspace);
      this.applyDigest(state, digest, input, patch);
      state.progress.scanned += 1;
    } catch (error) {
      if (state.cancelled) return;
      state.progress.failed += 1;
      const mapped = mapReadError(error);
      this.recordScanError(state, patch, {
        sessionId: input.id,
        code: mapped.code,
        message: mapped.message,
        ...mapped.detail === void 0 ? {} : { detail: mapped.detail }
      });
    } finally {
      try {
        await handle?.close?.();
      } catch {
      }
    }
  }
  cwdFor(header, fallback) {
    return header.cwd !== void 0 && header.cwd !== "" ? header.cwd : fallback;
  }
  emptyPatch() {
    return { sessions: [], files: [], edges: [], removedFiles: [], removedEdges: [], errors: [] };
  }
  recordScanError(state, patch, error) {
    if (state.errors.length < LIMITS.maxErrors) state.errors.push(error);
    patch.errors.push(error);
  }
  /** 把一份会话贡献（新归约或缓存摘要）合并进扫描状态。 */
  applyDigest(state, digest, input, patch) {
    const summary = {
      id: digest.info.id,
      ...digest.info.parentId === void 0 ? {} : { parentId: digest.info.parentId },
      rootId: digest.info.id,
      ...digest.info.title === void 0 ? {} : { title: digest.info.title },
      cwd: digest.info.cwd,
      ...digest.info.origin === void 0 ? {} : { origin: digest.info.origin },
      archived: input.archived === true,
      running: input.running || digest.info.running,
      startedAt: digest.info.startedAt,
      ...digest.info.endedAt === void 0 ? {} : { endedAt: digest.info.endedAt },
      updatedAt: digest.info.updatedAt,
      ...digest.info.model === void 0 ? {} : { model: digest.info.model },
      ...digest.info.provider === void 0 ? {} : { provider: digest.info.provider },
      status: digest.info.status,
      turns: digest.info.turns,
      files: digest.info.files,
      commands: digest.info.commands,
      subagents: unionChildren(digest.catalogChildren, state.requestChildren.get(digest.info.id) ?? []).length,
      errors: digest.info.errors
    };
    const parentId = digest.info.parentId;
    if (parentId !== void 0) {
      const parent = state.sessions.get(parentId);
      if (parent !== void 0) summary.rootId = parent.rootId;
    }
    state.sessions.set(summary.id, summary);
    patch.sessions.push(summary);
    this.applyFiles(state, digest, patch);
    this.applyEdges(state, digest, patch);
  }
  applyFiles(state, digest, patch) {
    const byPath = /* @__PURE__ */ new Map();
    for (const touch of digest.touches) {
      const list = byPath.get(touch.key);
      if (list === void 0) byPath.set(touch.key, [touch]);
      else list.push(touch);
    }
    const sessionId = digest.info.id;
    for (const [key, touches] of byPath) {
      const turns = /* @__PURE__ */ new Set();
      for (const touch of touches) if (touch.turn !== null) turns.add(touch.turn);
      const existing = state.files.get(key);
      if (existing === void 0) {
        const node = fileNodeFromTouches(touches[0].path, touches, [sessionId], 1, turns.size);
        state.files.set(key, node);
        patch.files.push(node);
        continue;
      }
      let reads = 0;
      let writes = 0;
      let searches = 0;
      let added = 0;
      let removed = 0;
      let firstAt = existing.firstAt;
      let lastAt = existing.lastAt;
      for (const touch of touches) {
        reads += touch.reads;
        writes += touch.writes;
        searches += touch.searches;
        added += touch.added;
        removed += touch.removed;
        if (touch.firstAt < firstAt) firstAt = touch.firstAt;
        if (touch.lastAt > lastAt) lastAt = touch.lastAt;
      }
      existing.reads += reads;
      existing.writes += writes;
      existing.searches += searches;
      existing.added += added;
      existing.removed += removed;
      existing.ops = existing.reads + existing.writes + existing.searches;
      existing.firstAt = firstAt;
      existing.lastAt = lastAt;
      if (!existing.sessionIds.includes(sessionId)) {
        existing.sessionCount += 1;
        if (existing.sessionIds.length < LIMITS.maxFileSessionIds) existing.sessionIds.push(sessionId);
      }
      existing.turnCount += turns.size;
      patch.files.push({ ...existing, sessionIds: existing.sessionIds.slice() });
    }
    this.pruneFiles(state, patch);
  }
  applyEdges(state, digest, patch) {
    for (const contribution of digest.edges) {
      const key = edgeKey(contribution.from, contribution.to);
      const existing = state.edges.get(key);
      if (existing === void 0) {
        const edge = {
          type: "coTurn",
          from: contribution.from,
          to: contribution.to,
          weight: contribution.weight,
          evidence: contribution.evidence.slice(-LIMITS.edgeEvidence)
        };
        state.edges.set(key, edge);
        patch.edges.push(edge);
        continue;
      }
      existing.weight += contribution.weight;
      for (const sample of contribution.evidence) existing.evidence.push(sample);
      if (existing.evidence.length > LIMITS.edgeEvidence) existing.evidence = existing.evidence.slice(-LIMITS.edgeEvidence);
      patch.edges.push(existing);
    }
    this.pruneEdges(state, patch);
  }
  /** 文件节点超上限：按 ops 取 top，删掉的通知客户端（`removedFiles`）。 */
  pruneFiles(state, patch) {
    if (state.files.size <= LIMITS.maxFileNodes) return;
    state.filesTruncated = true;
    const ranked = Array.from(state.files.values()).sort((a, b) => {
      if (b.ops !== a.ops) return b.ops - a.ops;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
    const keep = /* @__PURE__ */ new Set();
    for (const node of ranked.slice(0, LIMITS.maxFileNodes)) keep.add(node.path.toLowerCase());
    for (const [key, node] of state.files) {
      if (keep.has(key)) continue;
      state.files.delete(key);
      if (!patch.removedFiles.includes(node.path)) patch.removedFiles.push(node.path);
    }
  }
  /** 共现边超上限：按权重取 top（同权重按 from/to 字典序，确定性）。 */
  pruneEdges(state, patch) {
    if (state.edges.size <= LIMITS.maxEdges) return;
    state.edgesTruncated = true;
    const ranked = Array.from(state.edges.entries()).sort((left, right) => {
      if (right[1].weight !== left[1].weight) return right[1].weight - left[1].weight;
      const a = edgeKey(left[1].from, left[1].to);
      const b = edgeKey(right[1].from, right[1].to);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const keep = /* @__PURE__ */ new Set();
    for (const [key] of ranked.slice(0, LIMITS.maxEdges)) keep.add(key);
    for (const [key, edge] of state.edges) {
      if (keep.has(key)) continue;
      state.edges.delete(key);
      patch.removedEdges.push(`${edge.from}\0${edge.to}`);
    }
  }
  pushChanges(state, rev, patch) {
    state.changes.push({ rev, patch });
    while (state.changes.length > LIMITS.snapshotLog) {
      const dropped = state.changes.shift();
      if (dropped !== void 0) state.minRev = dropped.rev + 1;
    }
  }
  trimDigests(workspace) {
    if (workspace.digests.size <= LIMITS.maxDigests) return;
    const ranked = Array.from(workspace.digests.entries()).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    const keep = new Set(ranked.slice(0, LIMITS.maxDigests).map(([id]) => id));
    for (const id of workspace.digests.keys()) {
      if (!keep.has(id)) workspace.digests.delete(id);
    }
  }
  /** 只保留最近的若干次扫描；仍被轮询的扫描不逐出。 */
  trimScanRegistry() {
    while (this.scans.size > 8) {
      const first = this.scans.entries().next();
      if (first.done === true) break;
      const [id, scan] = first.value;
      if (!scan.done) break;
      this.clearTimer(scan);
      this.scans.delete(id);
    }
  }
  cancelScan(scanId) {
    const scan = this.scans.get(scanId);
    if (scan === void 0) return;
    scan.cancelled = true;
    scan.done = true;
    try {
      scan.abort.abort();
    } catch {
    }
    this.clearTimer(scan);
    this.scans.delete(scanId);
    if (this.lastScan === scan) this.lastScan = void 0;
  }
  clearTimer(scan) {
    if (scan?.timer !== void 0) {
      clearTimeout(scan.timer);
      scan.timer = void 0;
    }
  }
  /** 60s 无轮询自动取消并释放（04 §2.4）。已完成的扫描保留摘要（detail 仍可用）。 */
  armIdleTimer(state) {
    this.clearTimer(state);
    const timeout = this.options.idleTimeoutMs ?? LIMITS.idleTimeoutMs;
    state.timer = setTimeout(() => {
      if (state.cancelled) return;
      const workspace = this.workspaces.get(state.workspaceId);
      if (workspace?.activeScanId === state.scanId) workspace.activeScanId = void 0;
      this.clearTimer(state);
      if (!state.done) {
        state.cancelled = true;
        try {
          state.abort.abort();
        } catch {
        }
        this.scans.delete(state.scanId);
        if (this.lastScan === state) this.lastScan = void 0;
        return;
      }
      state.changes = [];
      state.files.clear();
      state.edges.clear();
      state.minRev = state.rev + 1;
    }, timeout);
    const timer = state.timer;
    timer.unref?.();
  }
  touchIdle(state) {
    state.lastPollAt = this.now();
    this.armIdleTimer(state);
  }
  /* ---------------- snapshot ---------------- */
  /** `POST /snapshot`：增量或 reset 全量，严格 ≤ 8MB（裁剪时标 `truncated`）。 */
  snapshotRequest(request) {
    const state = this.scans.get(request.scanId);
    if (state === void 0) {
      return { ok: false, error: { code: "threadline/scan-not-found", message: "scan not found" } };
    }
    this.touchIdle(state);
    const since = request.sinceRev;
    const continuation = state.resetCursor !== void 0 && state.resetCursor.rev === state.rev && since >= state.rev;
    let reset;
    let patch;
    if (continuation) {
      reset = false;
      patch = this.fullPatch(state);
    } else if (since <= 0 || since > state.rev || since < state.minRev) {
      reset = true;
      patch = this.fullPatch(state);
    } else {
      reset = false;
      patch = this.incrementalPatch(state, since);
    }
    const fileOffset = continuation && state.resetCursor !== void 0 ? state.resetCursor.files : 0;
    const edgeOffset = continuation && state.resetCursor !== void 0 ? state.resetCursor.edges : 0;
    const payload = {
      scanId: state.scanId,
      rev: state.rev,
      reset,
      done: state.done,
      progress: { ...state.progress },
      changedSessions: patch.sessions,
      changedFiles: this.sortByOpsDesc(patch.files).slice(fileOffset),
      changedEdges: this.sortByWeightDesc(patch.edges).slice(edgeOffset),
      removedFiles: reset ? [] : patch.removedFiles,
      removedEdges: reset ? [] : patch.removedEdges,
      errors: patch.errors
    };
    const fitted = this.fitToBudget(payload, fileOffset, edgeOffset, continuation);
    return { ok: true, scanId: fitted.scanId, rev: fitted.rev, reset: fitted.reset, done: fitted.done, progress: fitted.progress, changedSessions: fitted.changedSessions, changedFiles: fitted.changedFiles, changedEdges: fitted.changedEdges, removedFiles: fitted.removedFiles, removedEdges: fitted.removedEdges, errors: fitted.errors, ...fitted.truncated === true ? { truncated: true } : {} };
  }
  fullPatch(state) {
    return {
      sessions: Array.from(state.sessions.values()),
      files: Array.from(state.files.values()),
      edges: Array.from(state.edges.values()),
      removedFiles: [],
      removedEdges: [],
      errors: state.errors.slice()
    };
  }
  incrementalPatch(state, sinceRev) {
    const patch = this.emptyPatch();
    const sessions = /* @__PURE__ */ new Map();
    const files = /* @__PURE__ */ new Map();
    const edges = /* @__PURE__ */ new Map();
    for (const entry of state.changes) {
      if (entry.rev <= sinceRev) continue;
      for (const session of entry.patch.sessions) sessions.set(session.id, session);
      for (const file of entry.patch.files) files.set(file.path.toLowerCase(), file);
      for (const edge of entry.patch.edges) edges.set(edgeKey(edge.from, edge.to), edge);
      for (const path of entry.patch.removedFiles) if (!patch.removedFiles.includes(path)) patch.removedFiles.push(path);
      for (const key of entry.patch.removedEdges) if (!patch.removedEdges.includes(key)) patch.removedEdges.push(key);
      for (const error of entry.patch.errors) patch.errors.push(error);
    }
    patch.sessions.push(...sessions.values());
    patch.files.push(...files.values());
    patch.edges.push(...edges.values());
    return patch;
  }
  sortByOpsDesc(files) {
    return files.slice().sort((a, b) => {
      if (b.ops !== a.ops) return b.ops - a.ops;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
  }
  sortByWeightDesc(edges) {
    return edges.slice().sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      const left = edgeKey(a.from, a.to);
      const right = edgeKey(b.from, b.to);
      return left < right ? -1 : left > right ? 1 : 0;
    });
  }
  /**
   * 8MB 上限：按「会话 → 文件 → 边」保底，边最先裁；裁剪后标 `truncated` 并记续页游标，
   * 保证客户端在同一 rev 内还能拿到其余数据（不静默丢）。
   */
  fitToBudget(payload, fileOffset, edgeOffset, continuation) {
    const cap = this.responseBytes();
    let files = payload.changedFiles;
    let edges = payload.changedEdges;
    let truncated = false;
    for (let guard = 0; guard <= 24; guard += 1) {
      const candidate = { ...payload, changedFiles: files, changedEdges: edges };
      const bytes = utf8Length(JSON.stringify({ ok: true, ...candidate, ...truncated ? { truncated: true } : {} }));
      if (bytes <= cap) {
        this.rememberResetCursor(payload, fileOffset, edgeOffset, files.length, edges.length, truncated, continuation);
        return truncated ? { ...candidate, truncated: true } : candidate;
      }
      truncated = true;
      const ratio = cap / Math.max(bytes, 1);
      if (edges.length > 0) {
        const keep = Math.max(0, Math.min(edges.length - 1, Math.floor(edges.length * ratio * 0.9)));
        edges = edges.slice(0, keep);
        continue;
      }
      if (files.length > 0) {
        const keep = Math.max(0, Math.min(files.length - 1, Math.floor(files.length * ratio * 0.9)));
        files = files.slice(0, keep);
        continue;
      }
      if (payload.changedSessions.length > 1) {
        const keep = Math.max(1, Math.floor(payload.changedSessions.length * ratio * 0.9));
        return {
          ...payload,
          changedSessions: payload.changedSessions.slice(0, keep),
          changedFiles: [],
          changedEdges: [],
          removedFiles: [],
          removedEdges: [],
          truncated: true
        };
      }
      return { ...payload, changedFiles: [], changedEdges: [], truncated: true };
    }
    return {
      scanId: payload.scanId,
      rev: payload.rev,
      reset: payload.reset,
      done: payload.done,
      progress: payload.progress,
      changedSessions: payload.changedSessions,
      changedFiles: [],
      changedEdges: [],
      removedFiles: [],
      removedEdges: [],
      errors: payload.errors,
      truncated: true
    };
  }
  /** reset 全量被裁后，同一 rev 内继续送下一页（reset=false，按 id/path 合并，不清空）。 */
  rememberResetCursor(payload, fileOffset, edgeOffset, keptFiles, keptEdges, truncated, continuation) {
    const state = this.scans.get(payload.scanId);
    if (state === void 0) return;
    if (!payload.reset && !continuation) {
      delete state.resetCursor;
      return;
    }
    if (!truncated) {
      delete state.resetCursor;
      return;
    }
    state.resetCursor = { rev: state.rev, files: fileOffset + keptFiles, edges: edgeOffset + keptEdges };
  }
  /* ---------------- detail ---------------- */
  /**
   * `POST /detail`：按需冷读单会话并归约；内存 LRU 20。
   *
   * 两条路径（T13e）：
   * 1. **有扫描上下文**：会话在当前扫描集合里 → 维持既有行为（缓存、children、running/archived）。
   * 2. **冷读**：没有 lastScan（或会话不在集合内）但请求带了合法 `cwd` → 用 header 自证归属后直接读；
   *    不依赖 `/scan` 的生命周期，所以「没开过 tab 就点每轮影响」也能工作。
   * 两者都没有 → `threadline/bad-request`（老客户端行为不变，消息写清原因）。
   */
  async detailRequest(request) {
    const persistence = this.services.getPersistence();
    if (persistence === void 0) {
      return { ok: false, error: { code: "threadline/capability-missing", message: "session persistence unavailable" } };
    }
    const scan = this.lastScan;
    const summary = scan?.sessions.get(request.sessionId);
    const input = scan?.inputs.get(request.sessionId);
    if (scan !== void 0 && (summary !== void 0 || input !== void 0)) {
      const context = summary ?? {
        id: request.sessionId,
        rootId: input?.parentId ?? request.sessionId,
        ...input?.title === void 0 ? {} : { title: input.title },
        cwd: scan.cwd,
        archived: input?.archived === true,
        running: input?.running === true,
        startedAt: 0,
        updatedAt: input?.updatedAt ?? 0,
        status: "unknown",
        turns: 0,
        files: 0,
        commands: 0,
        subagents: 0,
        errors: 0
      };
      const cached = this.detailCache.get(request.sessionId);
      if (cached !== void 0 && cached.updatedAt === context.updatedAt && request.refresh !== true) {
        this.detailCache.delete(request.sessionId);
        this.detailCache.set(request.sessionId, cached);
        return { ok: true, session: cached.detail };
      }
      return this.readDetail(
        persistence,
        request.sessionId,
        context,
        this.childrenOf(scan, request.sessionId),
        true
      );
    }
    if (request.updatedAt !== void 0 && request.refresh !== true) {
      const cached = this.detailCache.get(request.sessionId);
      if (cached !== void 0 && cached.updatedAt === request.updatedAt) {
        this.detailCache.delete(request.sessionId);
        this.detailCache.set(request.sessionId, cached);
        return { ok: true, session: cached.detail };
      }
    }
    if (request.cwd === void 0) {
      return {
        ok: false,
        error: {
          code: "threadline/bad-request",
          message: scan === void 0 ? "no scan in this workspace and no cwd provided" : "session is not in the current scan and no cwd provided"
        }
      };
    }
    return this.coldDetail(persistence, request.sessionId, request.cwd, request.updatedAt);
  }
  /**
   * 冷读 detail：归属只信 header，不信 sessionId 本身。
   *
   * 规则（与 scan 的归属校验同口径）：
   * - `header.cwd` 归一化后 === 请求 cwd → 放行；
   * - 否则若它是子会话（header.parentSession 非空），父会话 header 的 cwd === 请求 cwd 才放行，
   *   并在 detail 上如实标 `partial`（子会话 cwd 与请求 cwd 不同，上下文不完整，不编造）；
   * - 其它情况一律 `threadline/bad-request`（不放行）。
   *
   * 只读 header，不读正文；不新增路径参数、不用 Node fs。
   */
  async coldDetail(persistence, sessionId, cwd, updatedAt) {
    const target = normalizeCwd(cwd);
    if (target === "") {
      return { ok: false, error: { code: "threadline/bad-request", message: "invalid cwd" } };
    }
    const header = await this.readHeader(persistence, sessionId);
    if (header === void 0) {
      return { ok: false, error: { code: "threadline/session-unreadable", message: "session header unavailable" } };
    }
    let viaParent = false;
    if (!sameWorkspaceCwd(header.cwd, target)) {
      const parentId = header.parentSession;
      if (parentId === void 0 || parentId === "") {
        return { ok: false, error: { code: "threadline/bad-request", message: "session does not belong to this cwd" } };
      }
      const parentHeader = await this.readHeader(persistence, parentId);
      if (parentHeader === void 0) {
        return {
          ok: false,
          error: { code: "threadline/bad-request", message: "cannot verify session ownership for this cwd" }
        };
      }
      if (!sameWorkspaceCwd(parentHeader.cwd, target)) {
        return { ok: false, error: { code: "threadline/bad-request", message: "session does not belong to this cwd" } };
      }
      viaParent = true;
    }
    const context = {
      id: sessionId,
      rootId: sessionId,
      cwd: target,
      archived: false,
      running: false,
      startedAt: Number.isFinite(header.createdAt) && header.createdAt >= 0 ? header.createdAt : 0,
      updatedAt: 0,
      status: "unknown",
      turns: 0,
      files: 0,
      commands: 0,
      subagents: 0,
      errors: 0
    };
    if (updatedAt !== void 0 && Number.isFinite(updatedAt) && updatedAt >= 0) {
      context.updatedAt = updatedAt;
    }
    const response = await this.readDetail(persistence, sessionId, context, [], updatedAt !== void 0);
    if (response.ok === true && viaParent) {
      response.session.partial = true;
    }
    return response;
  }
  /** 打开日志 → 归约 → 组装 DetailResponse（扫描路径与冷读路径共用，避免两套解析）。 */
  async readDetail(persistence, sessionId, context, children, cache) {
    let handle;
    try {
      handle = await persistence.open(sessionId, "read");
      const read = await handle.read(0);
      const events = Array.isArray(read?.events) ? read.events : [];
      const header = handle.header ?? { id: sessionId, createdAt: context.startedAt };
      const reduction = reduceSession(header, events, {
        cwd: this.cwdFor(header, context.cwd),
        running: context.running,
        rootId: context.rootId,
        children,
        limits: this.reduceLimits()
      });
      const detail = reduction.detail;
      if (context.archived) detail.archived = true;
      if (context.running) detail.running = true;
      if (cache) this.cacheDetail(sessionId, context.updatedAt, detail);
      return { ok: true, session: detail };
    } catch (error) {
      const mapped = mapReadError(error);
      return {
        ok: false,
        error: { code: mapped.code, message: mapped.message, ...mapped.detail === void 0 ? {} : { detail: mapped.detail } }
      };
    } finally {
      try {
        await handle?.close?.();
      } catch {
      }
    }
  }
  childrenOf(scan, id) {
    const children = [];
    for (const candidate of scan.sessions.values()) {
      if (candidate.parentId !== id) continue;
      children.push({
        id: candidate.id,
        ...candidate.title === void 0 ? {} : { title: candidate.title },
        status: candidate.status
      });
    }
    children.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return children;
  }
  cacheDetail(id, updatedAt, detail) {
    if (this.detailCache.has(id)) this.detailCache.delete(id);
    this.detailCache.set(id, { updatedAt, detail });
    while (this.detailCache.size > LIMITS.maxDetailCache) {
      const oldest = this.detailCache.keys().next();
      if (oldest.done === true) break;
      this.detailCache.delete(oldest.value);
    }
  }
  /* ---------------- lifecycle ---------------- */
  /** 卸载：清定时器、abort 扫描、清内存索引（不写任何存储）。 */
  dispose() {
    this.disposed = true;
    for (const scan of this.scans.values()) {
      this.clearTimer(scan);
      scan.cancelled = true;
      try {
        scan.abort.abort();
      } catch {
      }
    }
    this.scans.clear();
    this.workspaces.clear();
    this.detailCache.clear();
    this.lastScan = void 0;
  }
};

// src/host/tree.ts
import { lstat, readdir, realpath } from "node:fs/promises";
var HOST_TREE_ENTRY_LIMIT = 2e3;
var HOST_TREE_MAX_PATH_LENGTH = 1024;
function fsErrorCode(error) {
  const value = error ?? {};
  return typeof value.code === "string" ? value.code : "";
}
var realTreeFs = {
  async readdir(path) {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: () => entry.isDirectory(),
      isFile: () => entry.isFile(),
      isSymbolicLink: () => entry.isSymbolicLink()
    }));
  },
  async lstat(path) {
    const stat = await lstat(path);
    return {
      isDirectory: () => stat.isDirectory(),
      isFile: () => stat.isFile(),
      isSymbolicLink: () => stat.isSymbolicLink(),
      size: stat.size
    };
  },
  realpath(path) {
    return realpath(path);
  }
};
function hasControlChars2(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
function validateTreeRelativePath(input) {
  if (typeof input !== "string") return { ok: false, reason: "empty-path" };
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, path: "" };
  if (trimmed.length > HOST_TREE_MAX_PATH_LENGTH) return { ok: false, reason: "too-long" };
  if (hasControlChars2(trimmed)) return { ok: false, reason: "invalid-chars" };
  if (isAbsolutePath2(trimmed)) return { ok: false, reason: "absolute-path" };
  const posix = toPosix2(trimmed);
  if (posix.split("/").some((segment) => segment === "..")) return { ok: false, reason: "escape-cwd" };
  const normalized = normalizeRelative(posix);
  if (normalized.escaped) return { ok: false, reason: "escape-cwd" };
  return { ok: true, path: normalized.path };
}
function isInsideCwd(cwd, target, caseInsensitive) {
  const base = trimTrailingSlash(cwd);
  const value = trimTrailingSlash(target);
  if (base === "" || value === "") return false;
  const fold = caseInsensitive ?? (needsCaseFoldHost(base) || needsCaseFoldHost(value));
  const left = fold ? toPosix2(base).toLowerCase() : toPosix2(base);
  const right = fold ? toPosix2(value).toLowerCase() : toPosix2(value);
  if (left === right) return true;
  return containsPath(base, value, fold);
}
function needsCaseFoldHost(path) {
  const posix = toPosix2(path);
  return /^[a-zA-Z]:/.test(posix) || posix.startsWith("//");
}
function absoluteTreePath(cwd, relative) {
  const base = trimTrailingSlash(toPosix2(normalizeCwd(cwd)));
  const rest = normalizeRelative(relative).path;
  return rest === "" ? base : `${base}/${rest}`;
}
async function readTreeSessionCwd(persistence, sessionId) {
  if (persistence === void 0) return void 0;
  try {
    if (typeof persistence.stat === "function") {
      const stat = await persistence.stat(sessionId);
      const cwd = stat?.header?.cwd;
      if (typeof cwd === "string" && cwd !== "") return cwd;
    }
    const handle = await persistence.open(sessionId, "read");
    try {
      const cwd = handle.header?.cwd;
      return typeof cwd === "string" && cwd !== "" ? cwd : void 0;
    } finally {
      await handle.close?.();
    }
  } catch {
    return void 0;
  }
}
function compareNames(left, right) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a !== b) return a < b ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}
async function listTreeDirectory(input) {
  const fs = input.fs ?? realTreeFs;
  const limit = Math.max(1, Math.trunc(input.limit ?? HOST_TREE_ENTRY_LIMIT));
  const caseInsensitive = input.caseInsensitive;
  const validation = validateTreeRelativePath(input.path);
  if (!validation.ok) return { ok: false, code: "rejected-path", reason: validation.reason };
  const relative = validation.path;
  const cwd = normalizeCwd(input.cwd);
  if (cwd === "" || !isAbsoluteCwd(cwd)) return { ok: false, code: "unreadable", reason: "unreadable" };
  const absolute = absoluteTreePath(cwd, relative);
  if (!isInsideCwd(cwd, absolute, caseInsensitive)) {
    return { ok: false, code: "outside-cwd", reason: "outside-cwd" };
  }
  let realBase;
  let realTarget;
  try {
    realBase = await fs.realpath(cwd);
  } catch (error) {
    return { ok: false, code: "unreadable", reason: fsErrorCode(error) === "ENOENT" ? "not-found" : "unreadable" };
  }
  try {
    realTarget = await fs.realpath(absolute);
  } catch (error) {
    const code = fsErrorCode(error);
    if (code === "ENOENT") return { ok: false, code: "not-found", reason: "not-found" };
    if (code === "ENOTDIR") return { ok: false, code: "not-directory", reason: "not-directory" };
    return { ok: false, code: "unreadable", reason: "unreadable" };
  }
  if (!isInsideCwd(realBase, realTarget, caseInsensitive)) {
    return { ok: false, code: "outside-cwd", reason: "outside-cwd" };
  }
  try {
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) {
      const targetStat = await fs.lstat(realTarget);
      if (!targetStat.isDirectory()) return { ok: false, code: "not-directory", reason: "not-directory" };
    } else if (!stat.isDirectory()) {
      return { ok: false, code: "not-directory", reason: "not-directory" };
    }
  } catch (error) {
    const code = fsErrorCode(error);
    if (code === "ENOENT") return { ok: false, code: "not-found", reason: "not-found" };
    if (code === "ENOTDIR") return { ok: false, code: "not-directory", reason: "not-directory" };
    return { ok: false, code: "unreadable", reason: "unreadable" };
  }
  let raw;
  try {
    raw = await fs.readdir(absolute);
  } catch (error) {
    const code = fsErrorCode(error);
    if (code === "ENOENT") return { ok: false, code: "not-found", reason: "not-found" };
    if (code === "ENOTDIR") return { ok: false, code: "not-directory", reason: "not-directory" };
    return { ok: false, code: "unreadable", reason: "unreadable" };
  }
  const sorted = raw.filter((entry) => typeof entry?.name === "string" && entry.name !== "" && entry.name !== "." && entry.name !== "..").slice().sort((left, right) => compareNames(left.name, right.name));
  const truncated = sorted.length > limit;
  const visible = truncated ? sorted.slice(0, limit) : sorted;
  const entries = [];
  let escapedLinks = 0;
  for (const entry of visible) {
    const entryAbsolute = absolute.endsWith("/") ? absolute + entry.name : `${absolute}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      let target;
      try {
        target = await fs.realpath(entryAbsolute);
      } catch {
        entries.push({ name: entry.name, type: "other" });
        escapedLinks += 1;
        continue;
      }
      if (!isInsideCwd(realBase, target, caseInsensitive)) {
        entries.push({ name: entry.name, type: "other" });
        escapedLinks += 1;
        continue;
      }
      try {
        const stat = await fs.lstat(target);
        if (stat.isDirectory()) {
          entries.push({ name: entry.name, type: "directory" });
        } else if (stat.isFile()) {
          entries.push({ name: entry.name, type: "file", size: normalizeSize(stat.size) });
        } else {
          entries.push({ name: entry.name, type: "other" });
        }
      } catch {
        entries.push({ name: entry.name, type: "other" });
      }
      continue;
    }
    if (entry.isDirectory()) {
      entries.push({ name: entry.name, type: "directory" });
      continue;
    }
    if (entry.isFile()) {
      try {
        const stat = await fs.lstat(entryAbsolute);
        const item = { name: entry.name, type: "file" };
        const size = normalizeSize(stat.size);
        entries.push(size === void 0 ? item : { ...item, size });
      } catch {
        entries.push({ name: entry.name, type: "file" });
      }
      continue;
    }
    entries.push({ name: entry.name, type: "other" });
  }
  return { ok: true, listing: { path: relative, entries, truncated }, escapedLinks };
}
function normalizeSize(size) {
  return typeof size === "number" && Number.isFinite(size) && size >= 0 ? Math.trunc(size) : void 0;
}
async function handleTreeRequest(deps, request) {
  const sessionId = request.sessionId;
  const cwd = await readTreeSessionCwd(deps.getPersistence(), sessionId);
  if (cwd === void 0) {
    const persistence = deps.getPersistence();
    if (persistence === void 0) return { ok: false, code: "threadline/capability-missing", message: "session persistence unavailable" };
    return { ok: false, code: "threadline/session-unreadable", message: "session cwd unavailable" };
  }
  const result = await listTreeDirectory({
    cwd,
    path: request.path ?? "",
    ...deps.fs === void 0 ? {} : { fs: deps.fs }
  });
  if (!result.ok) {
    deps.logger?.warn?.("threadline: tree request failed (" + result.code + ")");
    if (result.code === "unreadable") {
      return { ok: false, code: "threadline/internal", message: "tree read failed", detail: "unreadable" };
    }
    return { ok: false, code: "threadline/bad-request", message: "tree request rejected", detail: result.reason };
  }
  if (result.escapedLinks > 0) {
    deps.logger?.warn?.("threadline: tree skipped escaping links (" + String(result.escapedLinks) + ")");
  }
  return {
    ok: true,
    path: result.listing.path,
    entries: result.listing.entries,
    truncated: result.listing.truncated
  };
}

// src/host/routes.ts
var ROUTE_PATHS = {
  scan: "/api/dsh-threadline/scan",
  snapshot: "/api/dsh-threadline/snapshot",
  detail: "/api/dsh-threadline/detail",
  /**
   * 1.2.0 B1：目录列表（04 §9.5 的 host 只读例外，用户 2026-11-07 已批准）。
   * 只在 `remote.workspaceFiles.list` 不可用时由客户端调用。
   */
  tree: "/api/dsh-threadline/tree"
};
var SCAN_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
var MAX_SESSIONS = 3e3;
var MAX_CWD_LENGTH = 4096;
function failure(code, message) {
  return { ok: false, code, message };
}
function asRecord3(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  return value;
}
function asString3(value) {
  return typeof value === "string" ? value : void 0;
}
function asFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
async function readJsonBody(request) {
  try {
    const parsed = await request.json();
    return asRecord3(parsed);
  } catch {
    return void 0;
  }
}
function validateScanRequest(body) {
  const record = asRecord3(body);
  if (record === void 0) return failure("threadline/bad-request", "body must be an object");
  const workspaceId = asString3(record.workspaceId);
  if (workspaceId === void 0 || workspaceId.trim() === "" || workspaceId.length > 200) {
    return failure("threadline/bad-request", "invalid workspaceId");
  }
  const cwd = asString3(record.cwd);
  if (cwd === void 0 || cwd.trim() === "" || cwd.length > MAX_CWD_LENGTH || !isAbsoluteCwd(cwd)) {
    return failure("threadline/bad-request", "invalid cwd");
  }
  if (normalizeCwd(cwd) === "") return failure("threadline/bad-request", "invalid cwd");
  const generation = asFiniteNumber(record.generation);
  if (generation === void 0 || generation < 0 || !Number.isInteger(generation)) {
    return failure("threadline/bad-request", "invalid generation");
  }
  const rawSessions = record.sessions;
  if (!Array.isArray(rawSessions)) return failure("threadline/bad-request", "sessions must be an array");
  if (rawSessions.length > MAX_SESSIONS) return failure("threadline/bad-request", "too many sessions");
  const normalized = normalizeScanSessions(rawSessions);
  const sessions = normalized.sessions;
  const refreshResult = normalizeRefreshIds(
    record.refresh,
    new Set(sessions.map((session) => session.id))
  );
  const request = { workspaceId, cwd, generation, sessions };
  if (refreshResult.ids.length > 0) request.refresh = refreshResult.ids;
  return {
    ok: true,
    value: { request, skipped: normalized.skipped, refreshDropped: refreshResult.dropped }
  };
}
function validateSnapshotRequest(body) {
  const record = asRecord3(body);
  if (record === void 0) return failure("threadline/bad-request", "body must be an object");
  const scanId = asString3(record.scanId);
  if (scanId === void 0 || !SCAN_ID_RE.test(scanId) || scanId === "." || scanId === "..") {
    return failure("threadline/bad-request", "invalid scanId");
  }
  const sinceRev = asFiniteNumber(record.sinceRev);
  if (sinceRev === void 0 || sinceRev < 0 || !Number.isInteger(sinceRev)) {
    return failure("threadline/bad-request", "invalid sinceRev");
  }
  return { ok: true, value: { scanId, sinceRev } };
}
function validateDetailRequest(body) {
  const record = asRecord3(body);
  if (record === void 0) return failure("threadline/bad-request", "body must be an object");
  if (!isSessionId(record.sessionId)) return failure("threadline/bad-request", "invalid sessionId");
  const value = { sessionId: record.sessionId };
  if (record.generation !== void 0) {
    const generation = asFiniteNumber(record.generation);
    if (generation === void 0 || generation < 0 || !Number.isInteger(generation)) {
      return failure("threadline/bad-request", "invalid generation");
    }
    value.generation = generation;
  }
  if (record.refresh !== void 0) {
    if (typeof record.refresh !== "boolean") return failure("threadline/bad-request", "invalid refresh flag");
    value.refresh = record.refresh;
  }
  if (record.updatedAt !== void 0) {
    const updatedAt = asFiniteNumber(record.updatedAt);
    if (updatedAt !== void 0 && updatedAt >= 0) value.updatedAt = updatedAt;
  }
  if (record.cwd !== void 0) {
    const cwd = asString3(record.cwd);
    if (cwd === void 0 || cwd.trim() === "" || cwd.length > MAX_CWD_LENGTH || !isAbsoluteCwd(cwd)) {
      return failure("threadline/bad-request", "invalid cwd");
    }
    if (normalizeCwd(cwd) === "") return failure("threadline/bad-request", "invalid cwd");
    value.cwd = cwd;
  }
  return { ok: true, value };
}
var NO_STORE = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
function jsonResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: NO_STORE });
}
function errorResponse(code, message, detail) {
  return jsonResponse({ ok: false, error: { code, message, ...detail === void 0 ? {} : { detail } } });
}
function toResponse(result) {
  return jsonResponse(result);
}
function validateTreeRequest(body) {
  const record = asRecord3(body);
  if (record === void 0) return failure("threadline/bad-request", "body must be an object");
  if (!isSessionId(record.sessionId)) return failure("threadline/bad-request", "invalid sessionId");
  const rawPath = record.path;
  if (rawPath !== void 0 && typeof rawPath !== "string") {
    return failure("threadline/bad-request", "invalid path");
  }
  const path = rawPath ?? "";
  if (path.length > HOST_TREE_MAX_PATH_LENGTH) return failure("threadline/bad-request", "invalid path");
  return { ok: true, value: { sessionId: record.sessionId, path } };
}
function createRoutes(services, manager) {
  const scanner = manager ?? new ScanManager(services);
  let disposers = [];
  let registered = false;
  const handlers = [
    {
      path: ROUTE_PATHS.scan,
      async fetch(request) {
        const body = await readJsonBody(request);
        if (body === void 0) return errorResponse("threadline/bad-request", "invalid JSON body");
        const validation = validateScanRequest(body);
        if (!validation.ok) return errorResponse(validation.code, validation.message);
        try {
          return toResponse(
            await scanner.startRequest(validation.value.request, {
              skipped: validation.value.skipped,
              refreshDropped: validation.value.refreshDropped
            })
          );
        } catch {
          return errorResponse("threadline/internal", "scan failed");
        }
      }
    },
    {
      path: ROUTE_PATHS.snapshot,
      async fetch(request) {
        const body = await readJsonBody(request);
        if (body === void 0) return errorResponse("threadline/bad-request", "invalid JSON body");
        const validation = validateSnapshotRequest(body);
        if (!validation.ok) return errorResponse(validation.code, validation.message);
        try {
          return toResponse(scanner.snapshotRequest(validation.value));
        } catch {
          return errorResponse("threadline/internal", "snapshot failed");
        }
      }
    },
    {
      path: ROUTE_PATHS.detail,
      async fetch(request) {
        const body = await readJsonBody(request);
        if (body === void 0) return errorResponse("threadline/bad-request", "invalid JSON body");
        const validation = validateDetailRequest(body);
        if (!validation.ok) return errorResponse(validation.code, validation.message);
        try {
          return toResponse(await scanner.detailRequest(validation.value));
        } catch {
          return errorResponse("threadline/internal", "detail failed");
        }
      }
    },
    {
      // B1：只读目录列表（读 fs、零写；cwd 卡口/符号链接/上限都在 host/tree.ts 里）。
      path: ROUTE_PATHS.tree,
      async fetch(request) {
        const body = await readJsonBody(request);
        if (body === void 0) return errorResponse("threadline/bad-request", "invalid JSON body");
        const validation = validateTreeRequest(body);
        if (!validation.ok) return errorResponse(validation.code, validation.message);
        try {
          const result = await handleTreeRequest(
            {
              getPersistence: () => services.getPersistence(),
              ...services.logger === void 0 ? {} : { logger: services.logger }
            },
            validation.value
          );
          if (!result.ok) {
            return errorResponse(
              result.code,
              result.message,
              result.detail === void 0 ? void 0 : result.detail
            );
          }
          return toResponse({
            ok: true,
            path: result.path,
            entries: result.entries,
            truncated: result.truncated
          });
        } catch {
          return errorResponse("threadline/internal", "tree failed");
        }
      }
    }
  ];
  const invoke = async (kind, request) => {
    const handler = handlers.find((candidate) => candidate.path === ROUTE_PATHS[kind]);
    if (handler === void 0) return errorResponse("threadline/internal", "route missing");
    return handler.fetch(request);
  };
  return {
    manager: scanner,
    invoke,
    register() {
      if (registered) return true;
      const connection = services.connection;
      if (connection === void 0 || connection.fetch === void 0) return false;
      const created = [];
      try {
        for (const handler of handlers) {
          const disposal = connection.fetch.register({
            path: handler.path,
            methods: ["POST"],
            requestBody: "buffered",
            fetch: (request) => handler.fetch(request)
          });
          if (typeof disposal === "function") created.push(disposal);
          else if (typeof disposal === "object" && disposal !== null && typeof disposal.dispose === "function") {
            created.push(disposal.dispose.bind(disposal));
          }
        }
      } catch {
        for (const disposal of created.reverse()) {
          try {
            disposal();
          } catch {
          }
        }
        return false;
      }
      disposers = created;
      registered = true;
      return true;
    },
    dispose() {
      for (const disposal of disposers.reverse()) {
        try {
          disposal();
        } catch {
        }
      }
      disposers = [];
      registered = false;
      scanner.dispose();
    }
  };
}

// src/host/index.ts
var name = "dsh-plugin-control-your-development";
function pickService(scope, name2) {
  try {
    const viaGet = scope.get?.(name2);
    if (viaGet !== void 0) return viaGet;
  } catch {
  }
  try {
    return scope[name2];
  } catch {
    return void 0;
  }
}
function createHostServices(scope) {
  return {
    connection: pickService(scope, "connection"),
    getPersistence: () => pickService(scope, "sessionPersistence"),
    getSessionQuery: () => pickService(scope, "sessionQuery"),
    ...scope.logger === void 0 ? {} : { logger: scope.logger }
  };
}
function apply(ctx) {
  ctx.logger?.info?.(`threadline: host loaded (v${VERSION})`);
  ctx.inject?.(["connection", "sessionPersistence"], (scope) => {
    const services = createHostServices(scope);
    if (services.connection === void 0) {
      scope.logger?.warn?.("threadline: connection missing; UI will show hostUnavailable");
      return;
    }
    const routes = createRoutes(services);
    let registered = false;
    try {
      registered = routes.register();
    } catch {
      registered = false;
    }
    if (!registered) {
      scope.logger?.warn?.("threadline: local routes unavailable; UI will show hostUnavailable");
    }
    scope.effect?.(() => () => routes.dispose(), "threadline: routes");
  });
}
export {
  apply,
  createHostServices,
  name
};
