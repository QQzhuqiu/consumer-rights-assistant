/**
 * 凭证识别结果的字段类型（阶段 4.2a）。
 *
 * 本文件**只包含类型定义与常量映射**，不含任何运行时副作用：
 *   · 不调用浏览器 API；
 *   · 不发起网络请求；
 *   · 不读写任何存储。
 *
 * 核心设计意图：**必须能区分数据来源**。
 *   · `'fixture'`      —— 界面演示用的固定样例，**不是**模型输出；
 *   · `'mock'`         —— 本地 mock 契约注入的测试载荷，**未经任何模型识别**；
 *   · `'model'`        —— 真实视觉模型识别结果（本阶段**不会产生**该值，仅为类型预留）；
 *   · `'user'`         —— 用户手动修改或手动标记为未知；
 *   · `'unconfirmed'`  —— 尚未确定来源。
 *
 * `'mock'` 与 `'model'` 必须严格区分：mock 数据只是为了让下游先固定契约形状，
 * 在真正接入模型之前，任何界面都不得把它展示成真实模型识别结果。
 *
 * 任何界面都不得把 `'fixture'` 的数据展示成真实识别结果。
 */

/** 字段置信度。`'unknown'` 表示无法判断或未能识别。 */
export type FieldConfidence = 'high' | 'medium' | 'low' | 'unknown';

/** 字段数据来源。 */
export type FieldSource = 'fixture' | 'mock' | 'model' | 'user' | 'unconfirmed';

/** 第一版支持的 5 个字段。不扩展其他字段。 */
export type ExtractionFieldKey =
  | 'merchantName'
  | 'itemName'
  | 'amount'
  | 'transactionDate'
  | 'orderId';

/** 整体识别状态。 */
export type ExtractionStatus = 'success' | 'partial' | 'failed';

/** 单个字段。 */
export type ExtractedField = {
  /** 字段标识 */
  key: ExtractionFieldKey;
  /** 面向用户的中文标签 */
  label: string;
  /** 字段值；`null` 表示当前没有可确认的值 */
  value: string | null;
  /** 置信度 */
  confidence: FieldConfidence;
  /** 数据来源 */
  source: FieldSource;
  /** 可选备注，用于说明低置信或缺失的原因 */
  note?: string;
  /** 用户是否已确认（含「确认该字段未知」） */
  confirmed: boolean;
};

/** 一次识别结果的完整结构。 */
export type ExtractionResult = {
  fields: ExtractedField[];
  /** 整体说明，必须写清数据来源 */
  globalNote?: string;
  status: ExtractionStatus;
};

/* ==========================================================================
 * 展示用文案映射
 * 放在类型文件内，因为它们是纯常量、无副作用，且与类型一一对应。
 * ========================================================================== */

/** 置信度 → 中文说明。界面必须显示文本，不能只靠颜色。 */
export const CONFIDENCE_LABELS: Record<FieldConfidence, string> = {
  high: '高置信度',
  medium: '中置信度',
  low: '低置信度',
  unknown: '无法判断/未识别',
};

/** 来源 → 中文说明。明确区分固定样例、mock 测试载荷与真实模型输出。 */
export const SOURCE_LABELS: Record<FieldSource, string> = {
  fixture: '固定样例数据',
  mock: 'mock 测试数据（未调用模型）',
  model: '模型识别结果',
  user: '用户修改',
  unconfirmed: '来源未定',
};

/** 整体状态 → 中文说明。 */
export const STATUS_LABELS: Record<ExtractionStatus, string> = {
  success: '全部字段已提取',
  partial: '部分字段未能提取',
  failed: '未能提取任何字段',
};

/** 5 个字段的固定顺序与中文标签，供 fixture 与界面共用。 */
export const FIELD_LABELS: Record<ExtractionFieldKey, string> = {
  merchantName: '商家名称',
  itemName: '商品/服务名称',
  amount: '金额',
  transactionDate: '交易日期',
  orderId: '订单号',
};
