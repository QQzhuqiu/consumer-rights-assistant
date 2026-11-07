#!/usr/bin/env node
/**
 * vision-probe.mjs —— 一次性「图片输入」探针（阶段 4.2b 第二部分）
 *
 * ============================================================================
 * ⚠️ 本脚本的协议形态是「用户显式选择的待验证假设」，不是已确认事实
 * ============================================================================
 *
 * 本次采用的假设（由用户在调用前明确选择）：
 *   1. 请求路径仍为 `{baseUrl}/v1/chat/completions`（OpenAI 兼容）
 *   2. 鉴权仍为 `Authorization: Bearer <key>`
 *   3. 图片以 **Base64 内嵌**、**OpenAI 兼容 `image_url`** 形态放进 content 数组：
 *        messages[0].content = [
 *          { type: 'text',      text: '...' },
 *          { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } },
 *        ]
 *
 * **以上三点均未经验证。** 因此：
 *   - 本次请求失败**不能**据此断定 `gpt-6.1-sol` 不支持图片；
 *     失败原因可能是形态不匹配、模型不支持、线路限制、额度问题等；
 *   - 本次请求成功也只证明「在该形态下可用」，不外推为其他模型/线路/形态可用。
 *
 * ============================================================================
 * 硬性约束（本次授权范围）
 * ============================================================================
 *   - 只发起 **1 次** 请求，不重试、不并发；超时后不重发；
 *   - 配置读取范围见下节「配置读取」；
 *   - 不打印密钥、密钥长度、前缀/后缀、请求头值、完整 Base64、完整响应正文；
 *   - 不把请求或响应写入任何文件；
 *   - 图片只从本地 `data/vision-probe/` 读取，不上传公网、不使用第三方图床；
 *   - 不读取期望值文件（`vision-probe-expected.json`）与样例定义文件
 *     （`vision-probe-samples.json`），不把期望答案发送给任何服务。
 *
 * ============================================================================
 * 配置读取（本文件的实际行为）
 * ============================================================================
 * 只保留当前所选 provider 所需的三项配置：
 *   - base URL、API key、model ID。
 *
 * 实现方式是**流式逐行读取** `.env.local`（`createReadStream` + `readline`），
 * **不会把整个文件聚合成单一字符串**；每行解析后立即丢弃，只有命中那三个键的
 * 值被保留。其他 provider 的配置值**不会被保留、不会被使用、不会被打印、
 * 不会被发送**；未命中的行处理完即不再持有。
 *
 * 仍需如实说明的边界：文件内容在读取过程中会**逐行流过进程内存**（这是逐行
 * 读取的必然结果），只是不会被汇总、保存或输出。因此不要把它理解为
 * 「其他内容从未经过内存」。
 *
 * `.env.local` 相对**项目根目录**解析（不是当前 shell 工作目录），
 * 以免从意外的目录读取到另一份同名文件。
 *
 * ============================================================================
 * 参数与图片路径校验
 * ============================================================================
 *   - `--protocol`、`--auth-mode` 必须显式传入，无静默默认值；
 *   - `--max-tokens`、`--timeout-ms` **必须带值且为正整数**：
 *       缺少该选项          → 退出码 2
 *       提供了选项但缺少值  → 退出码 2（后一个参数若也以 `--` 开头，视为缺值）
 *       值为空 / 非整数 / 0 / 负数 → 退出码 2
 *     以上均在发请求**之前**拒绝，不会被当成网络错误。
 *   - `--image` 必须是 `data/vision-probe/` 目录**之下**的图片文件：
 *       允许相对路径或该目录下的绝对路径；
 *       拒绝目录本身、目录外的文件、经 `..` 逃逸的路径；
 *       拒绝真实路径（符号链接解析后）落在目录之外的文件——采用**保守拒绝**策略；
 *       拒绝不存在、空文件、不支持的扩展名；
 *     以上均返回退出码 3。
 *   允许目录相对**项目根目录**解析，不使用当前 shell 工作目录作为安全边界。
 *
 * ============================================================================
 * 用法
 * ============================================================================
 *   node scripts/vision-probe.mjs \
 *        --provider gpt \
 *        --protocol openai-chat-image-url \
 *        --auth-mode bearer \
 *        --image data/vision-probe/complete.png \
 *        --max-tokens 300 \
 *        --timeout-ms 30000
 *
 * 退出码：
 *   0  请求返回 2xx（且响应可解析）
 *   2  参数缺失、缺值或非法（含 `--max-tokens` / `--timeout-ms` 缺值）——不发送请求
 *   3  配置缺失、变量为空、基址不安全，或图片路径/文件不符合允许范围——不发送请求
 *   4  请求失败（非 2xx、超时、网络错误）——不重试
 *   5  意外异常
 */

import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

// ============================================================================
// 常量
// ============================================================================

/** 本脚本所在目录 / 项目根目录（不依赖当前 shell 工作目录）。 */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');

/** 允许发送的本地图片目录（相对项目根解析）。 */
const ALLOWED_IMAGE_DIR = resolve(PROJECT_ROOT, 'data', 'vision-probe');

/** 提供方 -> 三项变量名。只取被选中那一行的键。 */
const PROVIDERS = {
  gpt: {
    label: 'gpt',
    baseUrl: 'GPT_API_BASE_URL',
    apiKey: 'GPT_API_KEY',
    modelId: 'GPT_MODEL_ID',
  },
  claude: {
    label: 'claude',
    baseUrl: 'CLAUDE_API_BASE_URL',
    apiKey: 'CLAUDE_API_KEY',
    modelId: 'CLAUDE_MODEL_ID',
  },
};

/** 允许的协议值，必须显式传入，无默认值。 */
const ALLOWED_PROTOCOLS = ['openai-chat-image-url'];

/** 允许的认证模式，必须显式传入，无默认值。 */
const ALLOWED_AUTH_MODES = ['bearer'];

/** 支持的图片 MIME 类型（按扩展名映射）。 */
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * 提示词：要求模型只输出约定字段的 JSON。
 * 刻意不透露任何期望答案，也不引用样例定义文件。
 */
const PROMPT_TEXT = [
  '请识别这张消费凭证图片中的信息，并以 JSON 对象输出，且只输出 JSON，不要任何解释。',
  '必须包含且仅包含以下五个键：',
  'merchantName（商家名称，字符串）、',
  'itemName（商品或服务名称，字符串）、',
  'amount（金额，不带货币符号、保留两位小数的字符串，例如 199.00）、',
  'transactionDate（交易日期，YYYY-MM-DD 字符串）、',
  'orderId（订单号，字符串）。',
  '如果某个字段在图片中不存在或无法确定，请把该字段的值设为 null，不要猜测或编造。',
].join('');

/** `.env.local` 相对项目根目录的位置。 */
const ENV_FILE = resolve(PROJECT_ROOT, '.env.local');

/**
 * 参数解析时用于标记「提供了选项但没有值」。
 * 与「未提供该选项」（undefined）严格区分。
 */
const MISSING_VALUE = Symbol('missing-value');

// ============================================================================
// 参数解析
// ============================================================================

/**
 * 从 process.argv 解析 `--key value` 形式的参数。
 *
 * 关键行为：如果 `--key` 后面没有值，或后一个 token 也以 `--` 开头，
 * 则该键记为 `MISSING_VALUE`（不是 `true`，也不是被静默当作有值）。
 */
function parseArgs(argv) {
  const out = Object.create(null);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (typeof token !== 'string' || !token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = MISSING_VALUE; // 提供了选项，但缺少值
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

// ============================================================================
// .env.local 读取（流式逐行，不聚合整文件）
// ============================================================================

/**
 * 解析单行 `.env` 内容。
 * 返回 `{ name, value }` 或 `null`（空行、注释行、无等号行）。
 * 处理：可选 `export ` 前缀、UTF-8 BOM、简单单/双引号包裹。
 */
function parseEnvLine(line) {
  if (typeof line !== 'string') return null;

  let trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;

  // 处理可能的 UTF-8 BOM（只会出现在首行）
  if (trimmed.charCodeAt(0) === 0xfeff) trimmed = trimmed.slice(1).trim();
  if (trimmed === '') return null;

  const withoutExport = trimmed.startsWith('export ')
    ? trimmed.slice('export '.length).trim()
    : trimmed;

  const eq = withoutExport.indexOf('=');
  if (eq === -1) return null;

  const name = withoutExport.slice(0, eq).trim();
  if (name === '') return null;

  let value = withoutExport.slice(eq + 1).trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1);
    }
  }

  return { name, value };
}

/**
 * 流式逐行读取 `.env.local`，只保留 `wantedKeys` 中命中的键。
 *
 * 不把整个文件拼接到单一字符串；每行处理完即丢弃。
 * `crlfDelay: Infinity` 让 readline 正确处理 Windows CRLF。
 *
 * 返回 `{ values, missing }`；`missing` 中只含键名，不含任何值。
 */
async function readWantedEnv(filePath, wantedKeys) {
  const values = Object.create(null);
  const wanted = new Set(wantedKeys);

  if (!existsSync(filePath)) {
    return { values, missing: [...wantedKeys] };
  }

  let stream = null;
  let rl = null;

  try {
    stream = createReadStream(filePath, { encoding: 'utf8' });
    rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      const parsed = parseEnvLine(line);
      // 未命中的行：解析后即丢弃，不保留任何内容
      if (parsed === null) continue;
      if (!wanted.has(parsed.name)) continue;

      // 同一个键出现多次时，保留第一次出现的值
      if (values[parsed.name] === undefined) {
        values[parsed.name] = parsed.value;
      }
    }
  } catch {
    // 读取失败不抛异常：交给下面的 missing 检查统一按「配置缺失」处理
  } finally {
    try {
      if (rl !== null) rl.close();
    } catch {
      // 忽略关闭异常
    }
    try {
      if (stream !== null) stream.destroy();
    } catch {
      // 忽略销毁异常
    }
  }

  const missing = wantedKeys.filter((k) => {
    const v = values[k];
    return typeof v !== 'string' || v.trim() === '';
  });

  return { values, missing };
}

// ============================================================================
// 基址安全（不打印基址本身）
// ============================================================================

function checkBaseUrlSafety(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { ok: false, reason: 'unparsable' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'scheme' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'userinfo' };
  }
  return { ok: true, reason: null };
}

function buildEndpoint(baseUrl) {
  return `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
}

// ============================================================================
// 图片路径范围校验
// ============================================================================

/**
 * 判断 `child` 是否严格位于 `parent` 之下（不含 `parent` 本身）。
 * 通过 `relative()` 判断，可正确处理 `..` 逃逸与目录本身两种情况。
 */
function isStrictlyInside(parent, child) {
  const rel = relative(parent, child);
  if (rel === '') return false; // 就是目录本身
  if (isAbsolute(rel)) return false; // 不同盘符等
  if (rel === '..' || rel.startsWith('..' + '\\') || rel.startsWith('../')) return false;
  return true;
}

/**
 * 校验 `--image` 的值并返回可用的绝对路径与 MIME。
 * 不满足条件时直接以退出码 3 拒绝（在发请求之前）。
 */
function resolveAllowedImage(rawImageArg) {
  const imagePath = resolve(PROJECT_ROOT, rawImageArg);

  // ---- 词法路径必须在允许目录之内（拒绝目录本身、目录外、.. 逃逸） ----
  if (!isStrictlyInside(ALLOWED_IMAGE_DIR, imagePath)) {
    refuse(
      3,
      `图片路径不在允许目录内。只允许 data/vision-probe/ 下的图片文件；`
        + `拒绝目录本身与目录外路径。收到文件名：${basename(imagePath)}`,
    );
  }

  // ---- 必须存在 ----
  if (!existsSync(imagePath)) {
    refuse(3, `图片文件不存在。收到文件名：${basename(imagePath)}`);
  }

  // ---- 必须是普通文件（拒绝目录本身） ----
  let stats;
  try {
    stats = statSync(imagePath);
  } catch {
    refuse(3, `图片文件无法读取（stat 失败）。收到文件名：${basename(imagePath)}`);
  }
  if (stats.isDirectory()) {
    refuse(3, `传入的是目录而不是图片文件：${basename(imagePath)}`);
  }
  if (!stats.isFile()) {
    refuse(3, `传入的不是普通文件：${basename(imagePath)}`);
  }

  // ---- 真实路径（符号链接解析后）也必须在允许目录之内：保守拒绝 ----
  let realAllowedDir;
  try {
    realAllowedDir = realpathSync(ALLOWED_IMAGE_DIR);
  } catch {
    realAllowedDir = ALLOWED_IMAGE_DIR;
  }
  let realImagePath;
  try {
    realImagePath = realpathSync(imagePath);
  } catch {
    refuse(3, `图片文件真实路径无法解析（可能是失效的符号链接）：${basename(imagePath)}`);
  }
  if (!isStrictlyInside(realAllowedDir, realImagePath)) {
    refuse(
      3,
      `图片的真实路径落在允许目录之外（可能是符号链接指向外部）。`
        + `按保守策略拒绝。收到文件名：${basename(imagePath)}`,
    );
  }

  // ---- 扩展名 / MIME ----
  const dotIndex = imagePath.lastIndexOf('.');
  const ext = dotIndex === -1 ? '' : imagePath.slice(dotIndex).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (mime === undefined) {
    refuse(
      3,
      `不支持的图片扩展名「${ext || '无'}」。仅支持 ${Object.keys(MIME_BY_EXT).join(' / ')}。`,
    );
  }

  // ---- 不能为空文件 ----
  if (stats.size === 0) {
    refuse(3, `图片文件为空：${basename(imagePath)}`);
  }

  return { imagePath, mime, imageBytes: stats.size };
}

// ============================================================================
// 输出
// ============================================================================

function refuse(code, message) {
  process.stderr.write(`[拒绝执行] ${message}\n`);
  process.exit(code);
}

function classifyStatus(status) {
  if (status === 400) return '400 请求格式或参数不被接受';
  if (status === 401) return '401 鉴权未通过';
  if (status === 403) return '403 权限不足或访问被拒';
  if (status === 404) return '404 路径或模型不存在';
  if (status === 413) return '413 请求体过大（图片可能超出限制）';
  if (status === 422) return '422 语义错误（可能是图片形态不被接受）';
  if (status === 429) return '429 限流或额度不足（不重试）';
  if (status >= 500) return `${status} 服务端错误（不重试）`;
  return `${status} 非 2xx 响应`;
}

function formatUsage(usage) {
  if (usage === null || typeof usage !== 'object') return '无';
  const parts = [];
  for (const k of Object.keys(usage)) {
    const v = usage[k];
    if (typeof v === 'number' || typeof v === 'string') {
      parts.push(`${k}=${v}`);
    } else if (v !== null && typeof v === 'object') {
      for (const k2 of Object.keys(v)) {
        const v2 = v[k2];
        if (typeof v2 === 'number' || typeof v2 === 'string') {
          parts.push(`${k}.${k2}=${v2}`);
        }
      }
    }
  }
  return parts.length > 0 ? parts.join(', ') : '无';
}

/**
 * 只提取响应里的文本内容用于展示，并截断。
 * 不打印完整响应体，不打印任何请求头。
 */
function extractContent(parsed) {
  try {
    const choices = parsed && parsed.choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const message = choices[0] && choices[0].message;
    if (!message) return null;
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
        .join('');
    }
  } catch {
    return null;
  }
  return null;
}

/** 只报告消息长度与存在的键，不打印错误正文（可能回显请求片段）。 */
function summarizeFailureBody(text) {
  if (typeof text !== 'string' || text === '') return '无';
  let keys = '无';
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      keys = Object.keys(parsed).join(', ') || '无';
      const err = parsed.error;
      if (err && typeof err === 'object') {
        const inner = [];
        if (typeof err.type === 'string') inner.push(`type=${err.type}`);
        if (typeof err.code === 'string' || typeof err.code === 'number') inner.push(`code=${err.code}`);
        if (inner.length > 0) keys += ` | error: ${inner.join(', ')}`;
      }
    }
  } catch {
    keys = '非 JSON';
  }
  return `长度=${text.length} 字符；顶层键=${keys}`;
}

// ============================================================================
// 带值参数的严格校验
// ============================================================================

/**
 * 校验一个「必须是字符串值」的选项（provider / protocol / auth-mode / image）。
 * 区分：未提供 → 由调用方判断；缺值 → 退出码 2；非字符串 → 退出码 2。
 */
function requireStringArg(args, flagName) {
  const raw = args[flagName];
  if (raw === undefined) {
    refuse(2, `缺少 --${flagName}。`);
  }
  if (raw === MISSING_VALUE) {
    refuse(2, `--${flagName} 后缺少值（后一个参数也是选项开头，或已到命令末尾）。`);
  }
  if (typeof raw !== 'string' || raw.trim() === '') {
    refuse(2, `--${flagName} 的值非法（不能为空）。`);
  }
  return raw;
}

/**
 * 校验一个「必须是正整数」的选项。
 * 缺值、空串、非纯整数、0、负数、超出安全整数范围一律退出码 2。
 */
function requirePositiveIntArg(args, flagName) {
  const raw = args[flagName];
  if (raw === undefined) {
    refuse(2, `缺少 --${flagName}（必须为正整数）。`);
  }
  if (raw === MISSING_VALUE) {
    refuse(2, `--${flagName} 后缺少值（后一个参数也是选项开头，或已到命令末尾）。`);
  }
  if (typeof raw !== 'string') {
    refuse(2, `--${flagName} 的值非法（必须为正整数）。`);
  }

  const text = raw.trim();
  if (text === '') {
    refuse(2, `--${flagName} 的值为空（必须为正整数）。`);
  }
  // 只接受纯十进制数字：拒绝小数、正负号、科学计数法、十六进制等
  if (!/^\d+$/.test(text)) {
    refuse(2, `--${flagName} 必须为纯正整数，收到非整数值。`);
  }

  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) {
    refuse(2, `--${flagName} 必须为正整数。`);
  }
  return value;
}

// ============================================================================
// 主流程
// ============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // ---- 门禁 1：provider ----
  const providerName = requireStringArg(args, 'provider');
  const provider = PROVIDERS[providerName];
  if (provider === undefined) {
    refuse(2, `不支持的 --provider。允许值：${Object.keys(PROVIDERS).join(' | ')}。`);
  }

  // ---- 门禁 2：协议必须显式确认 ----
  const protocol = requireStringArg(args, 'protocol');
  if (!ALLOWED_PROTOCOLS.includes(protocol)) {
    refuse(2, `不支持的 --protocol。当前仅支持 ${ALLOWED_PROTOCOLS.join(' | ')}。`);
  }

  // ---- 门禁 3：认证模式必须显式确认 ----
  const authMode = requireStringArg(args, 'auth-mode');
  if (!ALLOWED_AUTH_MODES.includes(authMode)) {
    refuse(2, `不支持的 --auth-mode。当前仅支持 ${ALLOWED_AUTH_MODES.join(' | ')}。`);
  }

  // ---- 门禁 4：图片路径必须位于 data/vision-probe/ ----
  const rawImage = requireStringArg(args, 'image');
  const { imagePath, mime, imageBytes } = resolveAllowedImage(rawImage);

  // ---- 门禁 5：max-tokens / timeout 必须是带值的正整数 ----
  const maxTokens = requirePositiveIntArg(args, 'max-tokens');
  const timeoutMs = requirePositiveIntArg(args, 'timeout-ms');

  // ---- 读取配置（流式逐行，只保留三项） ----
  const wantedKeys = [provider.baseUrl, provider.apiKey, provider.modelId];
  const { values, missing } = await readWantedEnv(ENV_FILE, wantedKeys);
  if (missing.length > 0) {
    refuse(3, `配置缺失或为空（只列键名）：${missing.join(', ')}。`);
  }

  const baseUrl = values[provider.baseUrl];
  const apiKey = values[provider.apiKey];
  const modelId = values[provider.modelId];

  const safety = checkBaseUrlSafety(baseUrl);
  if (!safety.ok) {
    const reasonText = {
      userinfo: '基址中疑似包含账号或密码（userinfo 形态）。拒绝执行，且不显示该值。',
      scheme: '基址不是 http:// 或 https:// 开头。',
      unparsable: '基址无法解析为合法 URL。',
    }[safety.reason];
    refuse(3, reasonText);
  }

  // ---- 组装 Base64 data URL（不打印内容） ----
  const base64 = readFileSync(imagePath).toString('base64');
  const dataUrl = `data:${mime};base64,${base64}`;

  const endpoint = buildEndpoint(baseUrl);
  const body = {
    model: modelId,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT_TEXT },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: maxTokens,
  };

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  // ---- 发前摘要（不含敏感内容） ----
  const out = process.stdout;
  out.write('----------------------------------------\n');
  out.write('图片探针（一次性，不重试）\n');
  out.write(`provider        : ${providerName}\n`);
  out.write(`请求模型 ID     : ${modelId}\n`);
  out.write(`图片文件        : data/vision-probe/${basename(imagePath)}\n`);
  out.write(`图片大小        : ${imageBytes} 字节\n`);
  out.write(`MIME            : ${mime}\n`);
  out.write(`Base64 长度     : ${base64.length} 字符（估算，非像素推算）\n`);
  out.write(`max_tokens      : ${maxTokens}\n`);
  out.write(`超时            : ${timeoutMs} ms\n`);
  out.write('协议形态        : OpenAI 兼容 /v1/chat/completions + Bearer + image_url(Base64)【未验证假设】\n');
  out.write('----------------------------------------\n');

  // ---- 单次请求，无重试 ----
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const errName = err && err.name ? String(err.name) : 'Error';
    const category = errName === 'TimeoutError' || errName === 'AbortError'
      ? `超时（>${timeoutMs}ms，不重试）`
      : `网络错误（${errName}，不重试）`;
    out.write('----------------------------------------\n');
    out.write(`HTTP 状态码     : 无（请求未完成）\n`);
    out.write(`延迟            : ${latencyMs} ms\n`);
    out.write(`失败分类        : ${category}\n`);
    out.write('费用            : 未知\n');
    out.write('----------------------------------------\n');
    out.write('注意：本次失败不能据此断定模型不支持图片。\n');
    process.exit(4);
  }

  const latencyMs = Date.now() - startedAt;
  const status = response.status;

  // ---- 非 2xx：只报状态与结构摘要，不打印正文 ----
  if (!response.ok) {
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {
      bodyText = '';
    }
    out.write('----------------------------------------\n');
    out.write(`HTTP 状态码     : ${status}\n`);
    out.write(`失败分类        : ${classifyStatus(status)}\n`);
    out.write(`响应体摘要      : ${summarizeFailureBody(bodyText)}\n`);
    out.write(`延迟            : ${latencyMs} ms\n`);
    out.write('费用            : 未知\n');
    out.write('----------------------------------------\n');
    out.write('注意：本次失败不能据此断定模型不支持图片。\n');
    out.write('      原因可能是协议形态不匹配、模型不支持图片、线路限制或额度问题。\n');
    process.exit(4);
  }

  // ---- 2xx：提取 model / usage / 文本内容（截断展示） ----
  let returnedModel = '无';
  let usage = '无';
  let content = null;
  let bodyLength = 0;

  try {
    const text = await response.text();
    bodyLength = text.length;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.model === 'string' && parsed.model !== '') {
          returnedModel = parsed.model;
        }
        if (parsed.usage !== undefined) {
          usage = formatUsage(parsed.usage);
        }
        content = extractContent(parsed);
      }
    } catch {
      content = null;
    }
  } catch {
    content = null;
  }

  const MAX_SHOW = 2000;
  let contentShown = '无';
  if (typeof content === 'string') {
    contentShown = content.length > MAX_SHOW
      ? `${content.slice(0, MAX_SHOW)}\n…（已截断，共 ${content.length} 字符）`
      : content;
  }

  out.write('----------------------------------------\n');
  out.write(`HTTP 状态码     : ${status}\n`);
  out.write(`响应 model 字段 : ${returnedModel}\n`);
  out.write(`usage           : ${usage}\n`);
  out.write(`延迟            : ${latencyMs} ms\n`);
  out.write(`响应体长度      : ${bodyLength} 字符\n`);
  out.write('费用            : 未知\n');
  out.write('----------------------------------------\n');
  out.write('模型返回的文本内容：\n');
  out.write('----------------------------------------\n');
  out.write(`${contentShown}\n`);
  out.write('----------------------------------------\n');
  out.write('注意：以上为单次调用结果，不能外推为模型的稳定能力或准确率。\n');

  process.exit(0);
}

main().catch((err) => {
  const errName = err && err.name ? String(err.name) : 'Error';
  process.stderr.write(`[意外异常] ${errName}（不重试）\n`);
  process.exit(5);
});