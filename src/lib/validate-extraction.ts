import { FIELD_LABELS } from '@/types/extraction';
import type { ExtractionFieldKey } from '@/types/extraction';

/**
 * 阶段 4.2c-1：识别结果的**运行时字段校验与规范化**。
 *
 * 这是一个**纯函数模块**，明确不产生任何副作用：
 *   · 不调用浏览器 API（无 localStorage / sessionStorage / indexedDB）；
 *   · 不发起任何网络请求；
 *   · 不读取环境变量，不读写文件；
 *   · 不引入任何第三方依赖（不用 zod 等）。
 *
 * 设计意图：模型（或注入的测试载荷）返回的 JSON 是**不可信输入**。
 * 任何进入界面的字段，必须先经过这里校验，绝不允许「先渲染再修正」。
 *
 * ============================================================================
 * 本模块**只做校验与规范化**，不判定数据来源、不生成置信度、不代用户确认
 * ============================================================================
 *   1. **来源（source）不由本模块决定。**
 *      来源是「这批数据从哪来」的事实，只有调用方知道——例如本地 mock 接口
 *      知道自己是 mock 载荷，将来的真实模型适配层知道自己是模型输出。
 *      校验模块如果自行填 `'model'`，就会把 mock 数据伪装成模型结果，
 *      因此这里**只返回值，不返回来源**。
 *   2. **不生成模型置信度。** 当前没有任何经过校准的置信度来源，
 *      不能冒充 high / medium / low。
 *   3. **不生成用户确认状态。** 是否确认只能由用户操作产生。
 *
 * 上述三项（source / confidence / confirmed）由调用方在组装 `ExtractedField`
 * 时显式赋值，责任清晰、可审查。
 */

/**
 * 校验通过后的**规范化字段**：只含字段标识、中文标签与值。
 *
 * 刻意**不包含** `source` / `confidence` / `confirmed`，
 * 以免校验模块替调用方做出来源或置信度判断。
 */
export type NormalizedExtractionField = {
  key: ExtractionFieldKey;
  label: string;
  value: string | null;
};

/** 校验结果：成功时给出规范化字段，失败时给出稳定错误码。 */
export type ValidationResult =
  | { ok: true; fields: NormalizedExtractionField[] }
  | { ok: false; code: string; message: string };

/**
 * 允许且必须存在的五个字段，顺序与 `FIELD_LABELS` 一致。
 * `satisfies` 保证这里的键名始终是 `ExtractionFieldKey` 的成员。
 */
const REQUIRED_FIELDS = [
  'merchantName',
  'itemName',
  'amount',
  'transactionDate',
  'orderId',
] as const satisfies readonly ExtractionFieldKey[];

/**
 * `transactionDate` 的**基本格式**：四位年-两位月-两位日。
 *
 * 注意边界：这里**只校验形态**，不校验日历有效性。
 * 也就是说 `2026-13-45` 这类「格式正确但日期不存在」的值仍会通过。
 * 日历有效性校验留待后续阶段，本阶段不擅自加严，也不对外声称已做。
 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 构造失败结果。 */
function fail(code: string, message: string): ValidationResult {
  return { ok: false, code, message };
}

/**
 * 校验一个「模型结果对象」是否可以安全地转成界面字段。
 *
 * 通过时返回五个**规范化字段**（`key` / `label` / `value`），
 * **不含** `source` / `confidence` / `confirmed`——这三项由调用方决定。
 *
 * 失败时返回稳定错误码，**不把任何非法类型静默转换成 `null`**。
 */
export function validateExtractionPayload(value: unknown): ValidationResult {
  // ---- 顶层必须是非 null、非数组的对象 ----
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('NOT_OBJECT', '识别结果必须是一个对象。');
  }

  const record = value as Record<string, unknown>;

  // ---- 拒绝额外字段 ----
  // 只报「存在未知字段」，不回显调用方传入的键名，避免把请求内容再反射出去。
  const allowed = new Set<string>(REQUIRED_FIELDS);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      return fail('EXTRA_FIELD', '识别结果包含未定义的字段。');
    }
  }

  // ---- 五个字段必须全部存在 ----
  // 注意语义：字段**存在但值为 null** 表示「图中没有该信息」，这是允许的；
  // 字段**整个缺失**才是错误，因为它意味着契约不完整。
  for (const key of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      return fail('MISSING_FIELD', `缺少字段：${FIELD_LABELS[key]}。`);
    }
  }

  // ---- 逐字段校验并规范化 ----
  const fields: NormalizedExtractionField[] = [];

  for (const key of REQUIRED_FIELDS) {
    const raw = record[key];
    const label = FIELD_LABELS[key];

    // `null` 是合法的「未识别」表示，原样保留，绝不补造值
    if (raw === null) {
      fields.push({ key, label, value: null });
      continue;
    }

    // 只接受字符串或 null：数字、布尔、对象、数组、undefined 一律拒绝，
    // 绝不「猜一个字符串」或「转成 null」蒙混过去。
    if (typeof raw !== 'string') {
      return fail('INVALID_TYPE', `${label}必须是字符串或 null。`);
    }

    // 空字符串与纯空白字符串都视为无效值
    if (raw.trim() === '') {
      return fail('EMPTY_VALUE', `${label}不能是空字符串或纯空白字符串。`);
    }

    // 日期只在非 null 时校验形态
    if (key === 'transactionDate' && !DATE_PATTERN.test(raw)) {
      return fail('INVALID_DATE', `${label}必须符合 YYYY-MM-DD 格式。`);
    }

    // 值原样保留，不做裁剪、不做格式改写，避免静默篡改模型输出
    fields.push({ key, label, value: raw });
  }

  return { ok: true, fields };
}
