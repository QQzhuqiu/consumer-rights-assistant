/**
 * 「AI 事实整理摘要」的类型定义与常量（阶段 7）。
 *
 * ============================================================================
 * 这是项目里**第一条真实 AI 能力**，因此类型层面就要把边界写死
 * ============================================================================
 *   · 输入只允许来自页面上**已经存在**的两类内容：已确认凭证字段、用户填写的陈述；
 *   · 输出只允许是「整理摘要 / 已知信息 / 未知信息 / 补充提示」四类文本；
 *   · **没有**任何字段用于承载「是否违法」「责任归属」「能否退款」「成功率」；
 *   · 模型结果**不得**写回 `fields` 或 `userContext`，这一点由类型之外的组件约束保证。
 *
 * 本文件只包含类型与纯常量，不含任何运行时副作用：
 *   · 不发网络请求；
 *   · 不读取环境变量或密钥；
 *   · 不读写任何存储。
 */

import type { ExtractionFieldKey } from '@/types/extraction';
import type { FactTimelineSource } from '@/lib/fact-timeline';
import type { MaterialChecklistStatus } from '@/lib/material-checklist';
import type { UserCaseContext } from '@/types/user-case';

/* ==========================================================================
 * 可发送的字段范围
 * ========================================================================== */

/**
 * 允许发送给模型的**凭证字段**，按固定顺序。
 *
 * 关键点：**`orderId` 故意不在此列表中**。
 * 订单号属于可直接定位到具体交易的标识符，对「事实整理摘要」这一目标并非必需，
 * 因此本轮**直接不支持发送**，而不是先做勾选再放行。
 *
 * 只有 `confirmed === true` 且 `value !== null` 的字段才会被填入这份输入。
 * 未确认的凭证字段一律不进入 `confirmedFields`。
 */
export const AI_SUMMARY_SENDABLE_FIELD_KEYS = [
  'merchantName',
  'itemName',
  'amount',
  'transactionDate',
] as const satisfies readonly ExtractionFieldKey[];

/** 可发送凭证字段的键类型。 */
export type AISummarySendableFieldKey =
  (typeof AI_SUMMARY_SENDABLE_FIELD_KEYS)[number];

/**
 * 允许发送的**用户陈述字段**，按固定顺序。
 *
 * 用户可以在确认对话框里逐项勾选；**默认全不勾选**，
 * 由用户主动选择要发送哪些自由文本，避免自由文本在无提示的情况下整段外发。
 */
export const AI_SUMMARY_USER_CONTEXT_KEYS = [
  'incidentDescription',
  'issueDiscoveredAt',
  'merchantResponseStatus',
  'merchantResponseSummary',
  'desiredResolution',
  'desiredResolutionOther',
  'evidenceNotes',
] as const satisfies readonly (keyof UserCaseContext)[];

/** 可发送用户陈述字段的键类型。 */
export type AISummaryUserContextKey =
  (typeof AI_SUMMARY_USER_CONTEXT_KEYS)[number];

/** 用户陈述字段的中文标签，供页面与 prompt 共用，避免两处文案漂移。 */
export const AI_SUMMARY_USER_CONTEXT_LABELS: Record<
  AISummaryUserContextKey,
  string
> = {
  incidentDescription: '事情经过',
  issueDiscoveredAt: '发现问题的时间或阶段',
  merchantResponseStatus: '商家是否回应',
  merchantResponseSummary: '商家回应摘要',
  desiredResolution: '希望如何处理',
  desiredResolutionOther: '其他处理诉求',
  evidenceNotes: '证据材料情况',
};

/* ==========================================================================
 * 输入结构
 * ========================================================================== */

/** 一条已确认的凭证字段。 */
export type AISummaryConfirmedField = {
  key: string;
  label: string;
  value: string;
};

/**
 * 用户选择发送的用户陈述字段。
 *
 * 只包含用户**勾选且非空**的键；未勾选的键不会出现在这里。
 * 配合 `userSkippedKeys` 才能区分「用户没勾选」与「用户勾了但这栏本来就空」。
 */
export type AISummaryUserContext = Partial<
  Record<AISummaryUserContextKey, string>
>;

/** 一条时间线条目（由本地事实时间线派生，不是新增事实）。 */
export type AISummaryTimelineItem = {
  label: string;
  value: string;
  source: FactTimelineSource;
  status: string;
};

/** 一条材料清单条目（由本地材料清单派生，不是新增事实）。 */
export type AISummaryMaterialItem = {
  label: string;
  note: string;
  status: MaterialChecklistStatus;
};

/**
 * 发送给服务端的完整输入。
 *
 * ============================================================================
 * 为什么需要 `userSkippedKeys`
 * ============================================================================
 * 如果没有它，服务端只看到「`userContext` 里没有 `evidenceNotes`」，
 * 就无法区分下面两种完全不同的情况：
 *   · 用户**没勾选**发送这一栏 → 服务端不该说「尚未填写」；
 *   · 用户勾选了，但这一栏本来就是空的 → 才可以提示「尚未填写」。
 * 把这两种情况混为一谈会让本地整理结果写出**错误的事实判断**，
 * 因此这里显式记录「用户主动跳过了哪些栏」。
 */
export type AISummaryInput = {
  confirmedFields: AISummaryConfirmedField[];
  userContext: AISummaryUserContext;
  /** 用户勾选过、但当前内容为空或未选择的栏，用于区分「没勾」与「没填」。 */
  userSkippedKeys: AISummaryUserContextKey[];
  timeline: AISummaryTimelineItem[];
  materials: AISummaryMaterialItem[];
};

/* ==========================================================================
 * 输出结构
 * ========================================================================== */

/**
 * 摘要来源。
 *
 *   · `'ai'`    —— 真实调用官方 DeepSeek 文本接口并成功返回、且通过校验；
 *   · `'local'` —— **纯本地整理结果**，只做计数与罗列，**不是**「本地 AI 生成」。
 *
 * 两者在界面上必须显示为不同来源，且都不代表事实已核实。
 */
export type AISummarySource = 'ai' | 'local';

/**
 * 展示结果。
 *
 * **没有任何字段**能够承载法律结论、责任认定、退款赔偿判断或成功率，
 * 这是刻意设计：即使模型违规输出这类内容，也没有位置可以放。
 */
export type AISummaryResult = {
  /** 事实整理摘要正文。 */
  summary: string;
  /** 已知信息。每条必须以「凭证字段：」或「用户填写：」开头以标明来源。 */
  knownInfo: string[];
  /** 未知信息。只列缺失或未确认的内容。 */
  unknownInfo: string[];
  /** 补充信息提示。只能是事实信息层面，不得是法律建议。 */
  suggestions: string[];
  /** 来源：真实 AI 还是本地整理。 */
  source: AISummarySource;
  /** 实际使用的模型标识。仅当 `source === 'ai'` 时给出。 */
  model?: string;
  /** 生成时间（ISO 字符串）。仅当 `source === 'ai'` 时给出。 */
  generatedAt?: string;
  /** 面向用户的说明，用于解释降级原因或边界。 */
  message?: string;
};

/* ==========================================================================
 * 限制常量
 * ========================================================================== */

/**
 * 输入与输出的长度 / 条数上限。
 *
 * 集中在一处，服务端校验、本地整理与测试共用同一套数字。
 * 目的不是"性能优化"，而是：模型返回不可信，输入也不可全信，
 * 任何进入界面的文本都必须有明确的天花板。
 */
export const AI_SUMMARY_LIMITS = {
  /** 单条凭证字段值的最大字符数。 */
  confirmedFieldValue: 200,
  /** 已确认凭证字段的最大条数（等于可发送字段数）。 */
  confirmedFields: AI_SUMMARY_SENDABLE_FIELD_KEYS.length,
  /** 时间线条目的最大条数。 */
  timelineItems: 20,
  /** 时间线条目文本的最大字符数。 */
  timelineText: 200,
  /** 材料清单条目的最大条数。 */
  materialItems: 10,
  /** 材料条目文本的最大字符数。 */
  materialText: 300,
  /** 用户陈述单栏的最大字符数。与 `USER_CASE_LIMITS` 上限保持一致即可。 */
  userContextValue: 500,
  /** 摘要正文的最大字符数。 */
  summary: 600,
  /** 三个列表各自的最大条数。 */
  listItems: 12,
  /** 列表单条的最大字符数。 */
  listItemLength: 300,
  /** 服务端等待上游响应的最长时间（毫秒）。 */
  requestTimeoutMs: 25_000,
  /** 上游 `max_tokens`。 */
  maxTokens: 1000,
} as const;

/** 来源徽标文案。界面必须显示文字，不能只靠颜色区分。 */
export const AI_SUMMARY_SOURCE_LABELS: Record<AISummarySource, string> = {
  ai: 'DeepSeek 生成',
  local: '本地整理结果',
};

/** 已知信息必须带来源前缀，这两个常量供本地整理与校验共用。 */
export const AI_SUMMARY_EVIDENCE_PREFIX = '凭证字段：';
export const AI_SUMMARY_USER_PREFIX = '用户填写：';

/**
 * 确认对话框必须显示的隐私提示原文。
 *
 * 这里**不实现也不承诺**任何自动 PII 识别或脱敏——
 * 只如实告诉用户自由文本可能包含什么，把是否发送的决定权交回用户。
 */
export const AI_SUMMARY_PRIVACY_NOTICE =
  '你勾选的自由文本会原样发送到官方 DeepSeek 接口。这些内容可能包含姓名、手机号、身份证号、银行卡号、地址或其他个人信息，请自行确认后再发送。本页面不做自动识别，也不做自动脱敏。';
