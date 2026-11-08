/**
 * 「用户事实陈述与处理诉求」的类型定义与纯函数。
 *
 * ============================================================================
 * 这是**用户自己填写的陈述**，不是凭证提取结果
 * ============================================================================
 *   · 这里的每个值都来自用户手动输入 / 手动选择，**没有经过任何提取或识别**；
 *   · 因此不带 `source`、`confidence`、`confirmed` 这类凭证字段才有的元数据；
 *   · 也**绝不**进入 `ExtractedField`、不进入 `AnalysisInputResult`；
 *   · 更不会被称作「已确认事实」——用户填了什么叫什么，事实是否成立另说。
 *
 * ============================================================================
 * 与凭证字段（4.2a / 4.2c）的关系
 * ============================================================================
 * 完全隔离：
 *   · 不读写 fixture 字段状态；
 *   · 不读写 mock 识别结果；
 *   · 不改变 `AnalysisInputResult.ready` / `blockers` / `confirmedFields` 等任何字段；
 *   · 本模块是纯数据定义 + 纯函数，无 React 依赖、无网络、无存储。
 *
 * 空值约定：未填写的文本用 `''`，未选择的单选也用 `''`，**不使用 `null`**。
 * 这样「没填」只有一种表示，不会出现 `null` 与 `''` 两种含义不清的空值。
 */

/** 商家是否回应：只会是这三种之一，或者「还没选」(`''`)。 */
export type MerchantResponseStatus =
  | 'no_response'
  | 'responded'
  | 'unclear';

/** 用户希望的处理方式：只会是这五种之一，或者「还没选」(`''`)。 */
export type DesiredResolution =
  | 'refund'
  | 'exchange'
  | 'repair'
  | 'explanation'
  | 'other';

/**
 * 用户填写的事实陈述与处理诉求。
 *
 * 全部字段都是用户手填的原文，**不做解析、不做补写、不做推断**。
 * 例如「发现问题的时间」允许直接写「不清楚」「记不清」，不需要是合法日期。
 */
export type UserCaseContext = {
  /** 事情经过。用户原文，最多 500 字。 */
  incidentDescription: string;
  /** 发现问题的时间或阶段。用户原文，不强制解析为日期。 */
  issueDiscoveredAt: string;
  /** 商家是否回应。未选择时为 `''`。 */
  merchantResponseStatus: MerchantResponseStatus | '';
  /** 商家回应摘要。仅在选择「已回应」时填写，最多 300 字。 */
  merchantResponseSummary: string;
  /** 希望如何处理。未选择时为 `''`。 */
  desiredResolution: DesiredResolution | '';
  /** 「其他」处理诉求的补充说明。仅在选择「其他」时填写，最多 200 字。 */
  desiredResolutionOther: string;
  /** 其他证据材料情况。用户原文，最多 300 字。 */
  evidenceNotes: string;
};

/** 用户填写的进度状态。用于页面上「尚未填写 / 已填写 X / Y 项」的展示。 */
export type UserCaseContextStatus = {
  /** 是否至少填写了一项。**不表示**填写完整，也**不表示**事实已核实。 */
  filled: boolean;
  /** 用户实际填写 / 选择的项目数。 */
  filledCount: number;
  /** 计入统计的项目总数，固定不变。 */
  totalCount: number;
};

/**
 * 各文本字段的字数上限（单位：字符）。
 *
 * 集中在一处，便于页面与测试共用同一套数字。
 * 计数口径：按 JavaScript 字符串长度计（中文与英文都算 1）。
 */
export const USER_CASE_LIMITS = {
  /** 事情经过 */
  incidentDescription: 500,
  /** 商家回应摘要 */
  merchantResponseSummary: 300,
  /** 其他处理诉求 */
  desiredResolutionOther: 200,
  /** 证据材料情况 */
  evidenceNotes: 300,
} as const;

/** 商家回应状态的可选项。UI 用它渲染单选，保证文案与取值一一对应。 */
export const MERCHANT_RESPONSE_OPTIONS: ReadonlyArray<{
  value: MerchantResponseStatus;
  label: string;
}> = [
  { value: 'no_response', label: '尚未回应' },
  { value: 'responded', label: '已回应' },
  { value: 'unclear', label: '不清楚' },
];

/** 处理诉求的可选项。顺序即页面展示顺序。 */
export const RESOLUTION_OPTIONS: ReadonlyArray<{
  value: DesiredResolution;
  label: string;
}> = [
  { value: 'refund', label: '退款' },
  { value: 'exchange', label: '换货' },
  { value: 'repair', label: '维修' },
  { value: 'explanation', label: '要求商家解释情况' },
  { value: 'other', label: '其他' },
];

/**
 * 计入填写统计的项目总数：**固定 7 项**，不随用户选择变化。
 *
 * 逐项列出，避免以后改字段时忘记同步：
 *   1. 事情经过（文本）
 *   2. 发现问题的时间或阶段（文本）
 *   3. 商家是否回应（单选）
 *   4. 商家回应摘要（文本，仅在「已回应」时才有意义）
 *   5. 希望如何处理（单选）
 *   6. 其他处理诉求（文本，仅在选择「其他」且非空时计入）
 *   7. 证据材料情况（文本）
 *
 * 说明：第 6 项是**条件项**，未选「其他」时它天然拿不到，因此
 * `filledCount` 的天花板并不总是 7。
 *
 * 因为分母会随选择浮动、容易让人误以为「差一项没填完」，
 * **界面不再显示这个分母**——只显示「已填写 X 项」。
 * 这个常量仍保留：它是内部统计口径的稳定基准，也便于测试与将来做更细的进度展示。
 */
export const USER_CASE_TOTAL_ITEM_COUNT = 7;

/** 初始状态：所有字段都是空串 / 未选择。 */
export const EMPTY_USER_CASE_CONTEXT: UserCaseContext = {
  incidentDescription: '',
  issueDiscoveredAt: '',
  merchantResponseStatus: '',
  merchantResponseSummary: '',
  desiredResolution: '',
  desiredResolutionOther: '',
  evidenceNotes: '',
};

/** 文本是否算「填写了」：去掉首尾空白后仍有内容。 */
function hasText(value: string): boolean {
  return value.trim() !== '';
}

/**
 * 计算用户填写进度。
 *
 * 纯函数：不修改传入的 `context`，无副作用。
 * 只统计用户**实际填写或选择**的项目：
 *   · 文本字段：去空白后非空才计数；
 *   · 单选字段：选了就计数；
 *   · 「其他处理诉求」：**只有**在选择「其他」且该文本非空时才计数。
 */
export function getUserCaseContextStatus(
  context: UserCaseContext,
): UserCaseContextStatus {
  let filledCount = 0;

  if (hasText(context.incidentDescription)) filledCount += 1;
  if (hasText(context.issueDiscoveredAt)) filledCount += 1;
  if (context.merchantResponseStatus !== '') filledCount += 1;
  if (hasText(context.merchantResponseSummary)) filledCount += 1;
  if (context.desiredResolution !== '') filledCount += 1;

  // 条件项：选了「其他」并且写了内容，才算一项
  if (
    context.desiredResolution === 'other' &&
    hasText(context.desiredResolutionOther)
  ) {
    filledCount += 1;
  }

  if (hasText(context.evidenceNotes)) filledCount += 1;

  return {
    filled: filledCount > 0,
    filledCount,
    totalCount: USER_CASE_TOTAL_ITEM_COUNT,
  };
}
