import type { ExtractedField, FieldConfidence, ExtractionFieldKey } from '@/types/extraction';

/**
 * 阶段 4.2c-2：`/api/extract` 的**客户端封装**（本地 mock 契约）。
 *
 * 边界（必须保持）：
 *   · 只请求**项目相对路径** `/api/extract`，不访问任何外部 URL；
 *   · 不读取环境变量，不读取密钥；
 *   · 不读取、不编码、不上传任何图片，不处理 Base64；
 *   · 不把错误响应当作成功结果；
 *   · **不伪造 `model` 来源**：本接口是本地 mock 注入，来源只能是 `'mock'`。
 *
 * 这个文件只做「请求 + 校验 + 归一化」，不含任何 UI 逻辑。
 */

/** 本模块唯一允许访问的地址：项目自身的相对路径。 */
const ENDPOINT = '/api/extract';

/**
 * 请求体：使用 `/api/extract` 已定义的 mock 契约。
 * 内容全部是**合成测试数据**，不含任何真实商户、订单或个人信息。
 */
const MOCK_REQUEST_BODY = {
  provider: 'mock',
  result: {
    merchantName: '合成测试商城',
    itemName: '演示耳机 Pro',
    amount: '199.00',
    transactionDate: '2026-10-15',
    orderId: 'SYNTH-20261015-001',
  },
} as const;

/** 契约要求的五个字段，用于核对返回结构。 */
const EXPECTED_FIELD_KEYS: readonly ExtractionFieldKey[] = [
  'merchantName',
  'itemName',
  'amount',
  'transactionDate',
  'orderId',
];

/** 允许的置信度取值。 */
const ALLOWED_CONFIDENCE: readonly FieldConfidence[] = [
  'high',
  'medium',
  'low',
  'unknown',
];

/** 成功结果。`source` 固定为 `'mock'`——本接口不会返回真实模型结果。 */
export type MockExtractionSuccess = {
  ok: true;
  source: 'mock';
  fields: ExtractedField[];
};

/**
 * 失败结果。
 * `code` 是稳定错误码（来自服务端 `error.code`，或本模块自定义的本地错误码），
 * `message` 是可以直接展示给用户看的中文说明，**不含**堆栈、请求对象、服务地址或原始响应。
 */
export type MockExtractionFailure = {
  ok: false;
  code: string;
  message: string;
};

/** 调用的最终结果：成功或失败，二者必居其一。 */
export type MockExtractionOutcome = MockExtractionSuccess | MockExtractionFailure;

/** 构造失败结果。 */
function failure(code: string, message: string): MockExtractionFailure {
  return { ok: false, code, message };
}

/** 判断一个值是否为「非 null、非数组」的对象，用于安全地读取未知结构。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 判断服务端的错误信封 `{ error: { code, message } }` 是否成形。 */
function readErrorEnvelope(
  value: unknown,
): { code: string; message: string } | null {
  if (!isRecord(value)) return null;
  const error = value.error;
  if (!isRecord(error)) return null;
  const code = error.code;
  const message = error.message;
  if (typeof code !== 'string' || code === '') return null;
  if (typeof message !== 'string' || message === '') return null;
  return { code, message };
}

/**
 * 校验单个字段是否符合本接口的契约。
 *
 * 关键点：**`source` 必须是 `'mock'`**。
 * 如果服务端将来返回 `'model'`（例如换成真实模型适配层），
 * 这里会主动拒绝，避免界面把 mock 数据误显示成模型结果——
 * 届时必须显式修改本封装，而不是让来源悄悄变化。
 */
function isMockExtractedField(value: unknown): value is ExtractedField {
  if (!isRecord(value)) return false;

  const key = value.key;
  if (typeof key !== 'string') return false;
  if (!EXPECTED_FIELD_KEYS.includes(key as ExtractionFieldKey)) return false;

  if (typeof value.label !== 'string' || value.label === '') return false;

  const fieldValue = value.value;
  if (fieldValue !== null && typeof fieldValue !== 'string') return false;

  if (typeof value.confidence !== 'string') return false;
  if (!ALLOWED_CONFIDENCE.includes(value.confidence as FieldConfidence)) return false;

  if (value.source !== 'mock') return false;

  if (typeof value.confirmed !== 'boolean') return false;

  return true;
}

/**
 * 调用本地 `/api/extract`，返回已校验的结果。
 *
 * 不会抛出异常：所有失败路径都归约为 `{ ok: false, code, message }`，
 * 调用方只需区分成功/失败，不必写 try/catch。
 */
export async function extractMockResult(): Promise<MockExtractionOutcome> {
  // ---- 1. 发请求（只可能是项目相对路径） ----
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(MOCK_REQUEST_BODY),
    });
  } catch {
    // 网络层失败：不把原始异常对象带给界面
    return failure('REQUEST_FAILED', '无法访问本地接口，请确认开发服务器正在运行。');
  }

  // ---- 2. 响应体必须是合法 JSON ----
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return failure('INVALID_RESPONSE', '本地接口返回的内容不是合法 JSON。');
  }

  // ---- 3. 非 2xx：按错误信封处理，绝不当成功 ----
  if (!response.ok) {
    const envelope = readErrorEnvelope(body);
    if (envelope !== null) {
      return failure(envelope.code, envelope.message);
    }
    // 服务端未给出稳定错误码时，只报状态码，不回显原始响应
    return failure(
      'REQUEST_REJECTED',
      `本地接口返回 HTTP ${response.status}，且未提供可读的错误信息。`,
    );
  }

  // ---- 4. 2xx 也要逐项核对契约 ----
  if (!isRecord(body)) {
    return failure('UNEXPECTED_RESPONSE', '本地接口返回的结构不是对象。');
  }

  // 有些实现会用 200 返回 `success: false`，这里一并按失败处理
  if (body.success !== true) {
    const envelope = readErrorEnvelope(body);
    if (envelope !== null) {
      return failure(envelope.code, envelope.message);
    }
    return failure('UNEXPECTED_RESPONSE', '本地接口没有返回成功标记。');
  }

  // 来源必须明确是 mock，否则拒绝展示
  if (body.source !== 'mock') {
    return failure(
      'UNEXPECTED_SOURCE',
      '本地接口返回的来源不是 mock，已拒绝展示，以免把测试数据误当成模型结果。',
    );
  }

  // 必须恰好五个字段，且每个字段结构符合契约
  const fields = body.fields;
  if (!Array.isArray(fields) || fields.length !== EXPECTED_FIELD_KEYS.length) {
    return failure(
      'UNEXPECTED_FIELDS',
      `本地接口返回的字段数量不是 ${EXPECTED_FIELD_KEYS.length} 个。`,
    );
  }
  if (!fields.every(isMockExtractedField)) {
    return failure('UNEXPECTED_FIELDS', '本地接口返回的字段结构不符合契约。');
  }

  return { ok: true, source: 'mock', fields };
}
