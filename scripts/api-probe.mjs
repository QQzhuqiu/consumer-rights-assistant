#!/usr/bin/env node
/**
 * api-probe.mjs —— 一次性最小 API 连通性测试脚本
 *
 * ============================================================================
 * ⚠️ 重要前提：本脚本实现的协议形态是「待验证假设」，不是已确认事实
 * ============================================================================
 *
 * 以下三点目前均为**未经验证的假设**：
 *   1. 请求路径为 `{baseUrl}/v1/chat/completions`（即 OpenAI 兼容形态）
 *   2. 请求体为 `{ model, messages, max_tokens }`
 *   3. 认证方式为 `Authorization: Bearer <key>`
 *
 * 中转站的真实协议、端点路径、鉴权头名称与前缀、模型 ID 均**未经核实**。
 *
 * 因此：**本次请求若失败，不能据此断定模型不可用。**
 * 失败原因完全可能是协议不匹配、路径错误、鉴权格式不符、模型 ID 不对，
 * 或中转站临时故障。任何失败结论都必须限定为「以该假设形态调用失败」。
 *
 * 同理，调用成功也只能证明「在该假设形态下可用」，不能外推为：
 * 模型的真实能力、上下文长度、是否支持图片、价格、限流策略。
 *
 * ============================================================================
 * 安全约束（硬性）
 * ============================================================================
 *   - 只读取被选中 provider 的三个变量，其余变量不进入内存
 *   - 不打印密钥、密钥长度、前缀、后缀
 *   - 不打印请求头值
 *   - 不打印完整响应体（成功或失败都不打印）
 *   - 不把请求/响应写入任何文件
 *   - 只发一次请求，不重试、不并发
 *
 * ============================================================================
 * 用法
 * ============================================================================
 *   node scripts/api-probe.mjs --provider <gpt|claude|deepseek> \
 *                              --protocol openai-chat \
 *                              --auth-mode bearer
 *
 * 必填参数：
 *   --provider    gpt | claude | deepseek
 *   --protocol    目前仅支持显式值 openai-chat（不会静默使用默认值）
 *   --auth-mode   目前仅支持显式值 bearer（不会静默使用默认值）
 *
 * 退出码：
 *   0  请求返回 2xx
 *   2  参数缺失或不支持（协议/认证未显式确认）——不发送请求
 *   3  配置缺失、变量为空或基址不安全——不发送请求
 *   4  请求失败（非 2xx、超时、网络错误）——不重试
 *   5  意外异常
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ============================================================================
// 常量
// ============================================================================

/** 提供方 -> 三个变量名的静态映射。只取被选中那一行的键。 */
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
  deepseek: {
    label: 'deepseek',
    baseUrl: 'DEEPSEEK_API_BASE_URL',
    apiKey: 'DEEPSEEK_API_KEY',
    modelId: 'DEEPSEEK_MODEL_ID',
  },
};

/** 允许的协议值。必须显式传入，无默认值。 */
const ALLOWED_PROTOCOLS = ['openai-chat'];

/** 允许的认证模式值。必须显式传入，无默认值。 */
const ALLOWED_AUTH_MODES = ['bearer'];

/** 极短提示词：尽量只验证通路，不消耗无用额度。 */
const PROBE_PROMPT = 'hi';

/** 极小输出上限：把单次支出压到该协议下的最小值。 */
const MAX_TOKENS = 16;

/** 单请求硬超时（毫秒）。 */
const TIMEOUT_MS = 30000;

/** .env.local 相对本脚本的位置（项目根目录）。 */
const ENV_FILE = resolve(process.cwd(), '.env.local');

// ============================================================================
// 参数解析
// ============================================================================

/**
 * 从 process.argv 解析 `--key value` 形式的参数。
 * 只做字符串提取，不产生默认值。
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (typeof token !== 'string' || !token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true; // 只给了开关没给值
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

// ============================================================================
// .env.local 解析（只取白名单键，不展开进 process.env）
// ============================================================================

/**
 * 读取指定的若干个键。
 *
 * 设计要点：
 *  - 不把整个文件注入 process.env，避免被后续代码或错误栈带出去；
 *  - 只返回被请求的那几个键的值，其余键的值连内存都不进；
 *  - 支持的语法：`KEY=value`、`KEY = value`、`export KEY=value`；
 *    忽略 `#` 注释行与空行；
 *  - 若值被成对引号包裹，去掉外层引号（不解析转义，保持原样）。
 *
 * @param {string} filePath .env.local 路径
 * @param {string[]} wantedKeys 需要读取的键名
 * @returns {{values: Record<string,string>, missing: string[]}}
 */
function readWantedEnv(filePath, wantedKeys) {
  const values = Object.create(null);

  if (!existsSync(filePath)) {
    return { values, missing: [...wantedKeys] };
  }

  const raw = readFileSync(filePath, 'utf8');
  const wanted = new Set(wantedKeys);

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const withoutExport = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;

    const eq = withoutExport.indexOf('=');
    if (eq === -1) continue;

    const name = withoutExport.slice(0, eq).trim();
    if (!wanted.has(name)) continue; // 不在白名单：直接丢弃，绝不保留

    let value = withoutExport.slice(eq + 1).trim();

    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }

    values[name] = value;
  }

  const missing = wantedKeys.filter((k) => {
    const v = values[k];
    return typeof v !== 'string' || v.trim() === '';
  });

  return { values, missing };
}

// ============================================================================
// 基址安全检查（不打印基址本身）
// ============================================================================

/**
 * 检查基址是否形如 http(s):// 且**不含** userinfo（`user:pass@`）。
 *
 * 含 userinfo 时返回 { ok:false, reason:'userinfo' }，调用方必须拒绝执行。
 * 该函数**不返回、不打印**基址字符串。
 */
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

/** 拼接 `{base}/v1/chat/completions`，容忍基址末尾多余斜杠。 */
function buildEndpoint(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed}/v1/chat/completions`;
}

// ============================================================================
// 输出
// ============================================================================

/**
 * 输出一行结果。字段固定，避免任何自由文本把敏感信息带出去。
 */
function printResult({ provider, requestedModel, status, returnedModel, usage, latencyMs }) {
  const lines = [
    '----------------------------------------',
    `provider        : ${provider}`,
    `请求模型 ID     : ${requestedModel}`,
    `HTTP 状态码     : ${status}`,
    `响应 model 字段 : ${returnedModel}`,
    `usage           : ${usage}`,
    `延迟            : ${latencyMs} ms`,
    '费用            : 未知',
    '----------------------------------------',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

/** 输出失败信息。只报状态码与分类，不打印响应体。 */
function printFailure({ provider, requestedModel, status, latencyMs, category }) {
  const lines = [
    '----------------------------------------',
    `provider        : ${provider}`,
    `请求模型 ID     : ${requestedModel}`,
    `HTTP 状态码     : ${status}`,
    `响应 model 字段 : 无`,
    'usage           : 无',
    `延迟            : ${latencyMs} ms`,
    '费用            : 未知',
    `失败分类        : ${category}`,
    '----------------------------------------',
    '注意：本次失败**不能**据此断定模型不可用。',
    '      原因可能是协议不匹配、路径错误、鉴权格式不符、',
    '      模型 ID 不对或中转站临时故障。',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

/** 统一的"拒绝执行"出口：不发请求。 */
function refuse(code, message) {
  process.stderr.write(`[拒绝执行] ${message}\n`);
  process.exit(code);
}

/** 由 HTTP 状态码给出粗分类（不含响应体内容）。 */
function classifyStatus(status) {
  if (status === 400) return '400 请求格式或参数不被接受';
  if (status === 401) return '401 鉴权未通过';
  if (status === 403) return '403 权限不足或访问被拒';
  if (status === 404) return '404 路径或模型不存在';
  if (status === 429) return '429 限流或额度不足（不重试）';
  if (status >= 500) return `${status} 服务端错误（不重试）`;
  return `${status} 非 2xx 响应`;
}

/** 把 usage 对象转成一段不含敏感信息的紧凑文本。 */
function formatUsage(usage) {
  if (usage === null || typeof usage !== 'object') return '无';
  const keys = Object.keys(usage);
  if (keys.length === 0) return '无';
  const parts = [];
  for (const k of keys) {
    const v = usage[k];
    if (typeof v === 'number' || typeof v === 'string') {
      parts.push(`${k}=${v}`);
    } else if (v !== null && typeof v === 'object') {
      // 只展开一层，避免无限递归产生大段输出
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

// ============================================================================
// 主流程
// ============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // ---- 门禁 1：provider 必须显式给出且在允许集合内 ----
  const providerName = typeof args.provider === 'string' ? args.provider : null;
  if (providerName === null) {
    refuse(
      2,
      '缺少 --provider。允许值：gpt | claude | deepseek。脚本不提供默认提供方。',
    );
  }
  const provider = PROVIDERS[providerName];
  if (provider === undefined) {
    refuse(
      2,
      `不支持的 --provider 值（原值不在此复述）。允许值：${Object.keys(PROVIDERS).join(' | ')}。`,
    );
  }

  // ---- 门禁 2：协议必须显式确认，禁止静默默认 ----
  if (args.protocol !== undefined && args.protocol !== true) {
    // 已给出值，继续校验
  } else {
    refuse(
      2,
      '缺少 --protocol。当前仅支持显式值 openai-chat。'
        + '脚本不会静默假设协议；未确认协议前不发送任何请求。',
    );
  }
  if (!ALLOWED_PROTOCOLS.includes(args.protocol)) {
    refuse(
      2,
      `不支持的 --protocol。当前仅支持：${ALLOWED_PROTOCOLS.join(' | ')}。`,
    );
  }

  // ---- 门禁 3：认证模式必须显式确认，禁止静默默认 ----
  if (args['auth-mode'] !== undefined && args['auth-mode'] !== true) {
    // 已给出值，继续校验
  } else {
    refuse(
      2,
      '缺少 --auth-mode。当前仅支持显式值 bearer。'
        + '脚本不会静默假设认证格式；未确认前不发送任何请求。',
    );
  }
  if (!ALLOWED_AUTH_MODES.includes(args['auth-mode'])) {
    refuse(
      2,
      `不支持的 --auth-mode。当前仅支持：${ALLOWED_AUTH_MODES.join(' | ')}。`,
    );
  }

  // ---- 读取被选中 provider 的三个变量（唯一一次文件读取） ----
  const wantedKeys = [provider.baseUrl, provider.apiKey, provider.modelId];
  const { values, missing } = readWantedEnv(ENV_FILE, wantedKeys);

  if (missing.length > 0) {
    // 只报键名，绝不报值
    refuse(
      3,
      `配置缺失或为空（只列键名）：${missing.join(', ')}。`
        + '请在本机 .env.local 中补齐对应提供方的三项变量。',
    );
  }

  const baseUrl = values[provider.baseUrl];
  const apiKey = values[provider.apiKey];
  const modelId = values[provider.modelId];

  // ---- 基址安全：含 userinfo 则拒绝（不打印该串） ----
  const safety = checkBaseUrlSafety(baseUrl);
  if (!safety.ok) {
    const reasonText = {
      userinfo: '基址中疑似包含账号或密码（userinfo 形态）。为免凭据扩散，拒绝执行，且不显示该值。',
      scheme: '基址不是 http:// 或 https:// 开头。',
      unparsable: '基址无法解析为合法 URL。',
    }[safety.reason];
    refuse(3, reasonText);
  }

  // ---- 组装请求（形态为待验证假设） ----
  const endpoint = buildEndpoint(baseUrl);
  const body = {
    model: modelId,
    messages: [{ role: 'user', content: PROBE_PROMPT }],
    max_tokens: MAX_TOKENS,
  };

  const headers = {
    'Content-Type': 'application/json',
    // 认证头名称与前缀均为待验证假设
    Authorization: `Bearer ${apiKey}`,
  };

  process.stdout.write(
    '发起 1 次请求（协议形态为待验证假设：OpenAI 兼容路径 + Bearer 认证）。\n'
      + '不重试、不并发、超时 30 秒。\n',
  );

  // ---- 单次请求，无重试 ----
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    // 只报错误类型名，不打印可能含 URL 或头的完整消息
    const errName = err && err.name ? String(err.name) : 'Error';
    const category = errName === 'TimeoutError' || errName === 'AbortError'
      ? `超时（>${TIMEOUT_MS}ms，不重试）`
      : `网络错误（${errName}，不重试）`;
    printFailure({
      provider: providerName,
      requestedModel: modelId,
      status: '无（请求未完成）',
      latencyMs,
      category,
    });
    process.exit(4);
  }

  const latencyMs = Date.now() - startedAt;
  const status = response.status;

  // ---- 非 2xx：立即结束，不读正文、不打印正文 ----
  if (!response.ok) {
    printFailure({
      provider: providerName,
      requestedModel: modelId,
      status: String(status),
      latencyMs,
      category: classifyStatus(status),
    });
    process.exit(4);
  }

  // ---- 2xx：只从正文提取 model 与 usage 两个字段，正文本身不外泄 ----
  let returnedModel = '无';
  let usage = '无';
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.model === 'string' && parsed.model !== '') {
          returnedModel = parsed.model;
        }
        if (parsed.usage !== undefined) {
          usage = formatUsage(parsed.usage);
        }
      }
    } catch {
      // 正文不是 JSON：不做任何输出，仅记为"无"
      returnedModel = '无';
      usage = '无';
    }
    // text 变量在此作用域结束即被丢弃，不写盘、不打印
  } catch {
    returnedModel = '无';
    usage = '无';
  }

  printResult({
    provider: providerName,
    requestedModel: modelId,
    status: String(status),
    returnedModel,
    usage,
    latencyMs,
  });

  process.exit(0);
}

main().catch((err) => {
  const errName = err && err.name ? String(err.name) : 'Error';
  process.stderr.write(`[意外异常] ${errName}（不重试）\n`);
  process.exit(5);
});
