/**
 * 「本地整理结果」—— 纯函数模块（阶段 7）。
 *
 * ============================================================================
 * 这不是「本地 AI」，也不是「降级摘要」
 * ============================================================================
 * 本模块**不调用任何模型**，只根据当前输入做两件事：
 *   1. 统计已经提供了哪些信息（按来源分开标注）；
 *   2. 列出还没有提供或未确认的信息。
 *
 * 因此它在界面上必须显示为「本地整理结果」，绝不能叫「AI 摘要」，
 * 也不能因为它出现在 AI 区块里就暗示「模型已经生成过内容」。
 *
 * 严格边界：
 *   · 不新增任何事实——只复述输入里已有的值；
 *   · 不推断因果、不比较时间先后、不猜测缺失内容；
 *   · 不作法律判断（不判断违法、责任、退款赔偿权利、成功率）；
 *   · 不引用或生成法律条文；
 *   · 不修改传入的输入对象（纯函数，无副作用）；
 *   · 不发网络请求、不读环境变量、不读写存储。
 */

import { FIELD_LABELS } from '@/types/extraction';
import {
  AI_SUMMARY_EVIDENCE_PREFIX,
  AI_SUMMARY_LIMITS,
  AI_SUMMARY_SENDABLE_FIELD_KEYS,
  AI_SUMMARY_USER_CONTEXT_KEYS,
  AI_SUMMARY_USER_CONTEXT_LABELS,
  AI_SUMMARY_USER_PREFIX,
} from '@/types/ai-summary';
import type {
  AISummaryInput,
  AISummaryResult,
  AISummaryUserContextKey,
} from '@/types/ai-summary';

/** 按上限截断文本，并在截断处加省略号。纯函数。 */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/** 空白视为未提供，与项目其他模块保持一致。 */
function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** 把数组裁到上限，避免输出无限增长。 */
function take<T>(list: readonly T[], max: number): T[] {
  return list.slice(0, max);
}

/**
 * 该用户陈述栏在当前输入下是否「适用」。
 *
 * 两个条件字段只在对应选择成立时才有意义：
 *   · 「商家回应摘要」只在「已回应」时才有意义；
 *   · 「其他处理诉求」只在选择「其他」时才有意义。
 *
 * 如果连它的前置选择都没发送，就**无法判断**是否适用，
 * 此时返回 `false`，避免写出「尚未填写」这种可能是错的判断。
 */
function isApplicable(
  key: AISummaryUserContextKey,
  context: AISummaryInput['userContext'],
): boolean {
  if (key === 'merchantResponseSummary') {
    return context.merchantResponseStatus === 'responded';
  }
  if (key === 'desiredResolutionOther') {
    return context.desiredResolution === 'other';
  }
  return true;
}

/**
 * 生成本地整理结果。
 *
 * @param input   当前要整理的内容（与发送给模型的内容一致）。
 * @param message 可选的说明文案，用于解释为什么显示本地结果而不是 AI 结果。
 */
export function buildLocalSummary(
  input: AISummaryInput,
  message?: string,
): AISummaryResult {
  const confirmed = input.confirmedFields ?? [];
  const sentContext = input.userContext ?? {};
  const skipped = new Set<AISummaryUserContextKey>(input.userSkippedKeys ?? []);

  // ---- 1. 已知信息：按来源分行标注，绝不混写 ----
  const knownInfo: string[] = [];

  for (const field of confirmed) {
    knownInfo.push(
      `${AI_SUMMARY_EVIDENCE_PREFIX}${field.label} — ${clip(
        field.value,
        AI_SUMMARY_LIMITS.listItemLength,
      )}`,
    );
  }

  for (const key of AI_SUMMARY_USER_CONTEXT_KEYS) {
    const value = sentContext[key];
    if (!hasText(value)) continue;
    knownInfo.push(
      `${AI_SUMMARY_USER_PREFIX}${AI_SUMMARY_USER_CONTEXT_LABELS[key]} — ${clip(
        value,
        AI_SUMMARY_LIMITS.listItemLength,
      )}`,
    );
  }

  // ---- 2. 未知信息：只列缺失 / 未确认 / 未发送，不做任何推断 ----
  const unknownInfo: string[] = [];

  // 2.1 凭证字段：不在已确认列表里的，就是「尚未确认」
  const confirmedKeys = new Set(confirmed.map((field) => field.key));
  for (const key of AI_SUMMARY_SENDABLE_FIELD_KEYS) {
    if (!confirmedKeys.has(key)) {
      unknownInfo.push(`${FIELD_LABELS[key]}：尚未确认`);
    }
  }

  // 2.2 用户陈述：区分「未选择发送」与「尚未填写」两种情况
  for (const key of AI_SUMMARY_USER_CONTEXT_KEYS) {
    if (hasText(sentContext[key])) continue;
    if (!isApplicable(key, sentContext)) continue;

    const label = AI_SUMMARY_USER_CONTEXT_LABELS[key];
    if (skipped.has(key)) {
      unknownInfo.push(`${label}：本次未选择发送`);
    } else {
      unknownInfo.push(`${label}：尚未填写`);
    }
  }

  // ---- 3. 补充提示：只针对「信息是否齐全」，不涉及任何法律判断 ----
  const suggestions: string[] = [];

  if (!confirmedKeys.has('merchantName')) {
    suggestions.push('可以在凭证核对区确认商家名称，便于后续整理时指向明确的对方。');
  }
  if (!confirmedKeys.has('amount')) {
    suggestions.push('可以在凭证核对区确认金额。');
  }
  if (!confirmedKeys.has('transactionDate')) {
    suggestions.push('可以在凭证核对区确认交易日期；若确实记不清，也可以保持未确认。');
  }
  if (!hasText(sentContext.incidentDescription)) {
    suggestions.push('可以补充事情经过，说明下单、收货和发现问题的大致过程。');
  }
  if (!hasText(sentContext.issueDiscoveredAt)) {
    suggestions.push('可以补充发现问题的时间或阶段，写「记不清」也可以。');
  }
  if (!hasText(sentContext.evidenceNotes)) {
    suggestions.push('可以补充你目前手上有哪些材料。');
  } else {
    const mentioned = (input.materials ?? []).some(
      (item) => item.status === 'mentioned',
    );
    if (!mentioned) {
      suggestions.push(
        '材料情况里还没有提到常见材料类别，可以再补充说明具体有哪些。',
      );
    }
  }

  // ---- 4. 组装结果 ----
  const summary =
    confirmed.length === 0 && knownInfo.length === 0
      ? '目前还没有可整理的内容。你可以先在凭证核对区确认字段，或填写用户陈述。'
      : `本地整理：已确认凭证字段 ${confirmed.length} 项，用户填写 ${Math.max(
          knownInfo.length - confirmed.length,
          0,
        )} 栏。以下内容只按当前输入罗列，不构成任何判断或结论。`;

  return {
    summary,
    knownInfo: take(knownInfo, AI_SUMMARY_LIMITS.listItems),
    unknownInfo: take(unknownInfo, AI_SUMMARY_LIMITS.listItems),
    suggestions: take(suggestions, AI_SUMMARY_LIMITS.listItems),
    source: 'local',
    ...(message === undefined ? {} : { message }),
  };
}

/**
 * 失败 / 降级时的标准说明文案。
 *
 * 集中一处，保证界面文案一致，也便于测试断言。
 * 注意措辞：说的是「真实 AI 摘要生成失败」，而不是「已生成降级摘要」。
 */
export const AI_SUMMARY_FALLBACK_MESSAGE =
  '真实 AI 摘要生成失败，本次只显示本地整理结果；你的原始输入没有被修改。';

/** API Key 未配置时的说明文案。 */
export const AI_SUMMARY_NO_KEY_MESSAGE =
  '服务端未配置 DEEPSEEK_API_KEY，本次只显示本地整理结果，未向任何外部服务发送数据。';
