/**
 * 事实时间线的本地整理逻辑（纯函数，无副作用）。
 *
 * 本文件**只做一件事**：把页面上**已经存在**的输入，按条目原样摊开。
 *
 * 严格边界：
 *   · 不推断事实，不补充缺失信息，不猜测日期；
 *   · **不根据字段顺序推断事件先后**——返回数组的顺序只是固定的展示顺序，
 *     不是「谁先谁后」的结论；
 *   · 不把用户填写的内容改写成「已确认事实」；
 *   · 不生成法律结论、责任判断或因果关系；
 *   · 不修改传入的 `fields` 与 `userContext`；
 *   · 不发请求、不读存储、不读环境变量。
 *
 * 数据来源必须可区分：
 *   · `'evidence'` —— 来自凭证字段（本轮只有已确认的交易日期）；
 *   · `'user'`     —— 来自用户自己填写的事实陈述。
 */

import type { ExtractedField } from '@/types/extraction';
import type { UserCaseContext } from '@/types/user-case';

/** 条目来源。界面必须把它显示成「凭证字段」或「用户填写」。 */
export type FactTimelineSource = 'evidence' | 'user';

/**
 * 条目状态。
 *
 *   · `'known'`        —— 该项有可用内容，按原文展示；
 *   · `'unknown'`      —— 用户已明确标记该凭证字段为未知（有值字段被确认未知）；
 *   · `'not_provided'` —— 用户尚未提供该项内容。
 */
export type FactTimelineStatus = 'known' | 'unknown' | 'not_provided';

/** 一条时间线条目。 */
export type FactTimelineItem = {
  /** 稳定标识，用于 React key；不含任何用户内容 */
  id: string;
  /** 条目标题，例如「交易时间」「发现问题」 */
  label: string;
  /** 条目内容。**原文照录**，不做改写、不做摘要 */
  value: string;
  /** 来源：凭证字段 / 用户填写 */
  source: FactTimelineSource;
  /** 该条目的状态 */
  status: FactTimelineStatus;
  /**
   * 可选补充说明。
   *
   * 目前只用于标注「时间：用户未提供具体日期」这类**事实性**提示，
   * 不用于表达任何判断。
   */
  note?: string;
};

/** 来源 → 中文标签。界面必须显示文本，不能只靠颜色区分。 */
export const FACT_TIMELINE_SOURCE_LABELS: Record<FactTimelineSource, string> = {
  evidence: '凭证字段',
  user: '用户填写',
};

/** 状态 → 中文标签。 */
export const FACT_TIMELINE_STATUS_LABELS: Record<FactTimelineStatus, string> = {
  known: '已整理',
  unknown: '已标记未知',
  not_provided: '尚未提供',
};

/** 时间未提供时的固定说明文案。 */
export const NO_CONCRETE_DATE_NOTE = '时间：用户未提供具体日期';

/** 没有任何可展示条目时的空态文案。 */
export const EMPTY_TIMELINE_TEXT = '目前没有可整理的时间线内容';

/** 取文本：空白字符串一律视为「没有内容」。不做任何改写，只 trim 判断。 */
function text(value: string): string | null {
  return value.trim() === '' ? null : value.trim();
}

/**
 * 判断一段文字里是否出现**数字**。
 *
 * 这是一个刻意保守的检查：它**只**回答「有没有数字」，
 * **不**解析日期、**不**推断时间、**不**补全格式。
 * 没有数字时，可以确定用户没给具体日期；有数字时也**不**断言它一定是日期。
 */
function hasDigit(value: string): boolean {
  return /\d/.test(value);
}

/**
 * 从凭证字段里找到交易日期。
 *
 * 只接受**已确认且有值**的字段；未确认的字段不参与，避免把未确认内容当作事实。
 */
function findConfirmedTransactionDate(fields: ExtractedField[]): {
  present: boolean;
  value: string | null;
  unknown: boolean;
} {
  const field = fields.find((item) => item.key === 'transactionDate');
  if (field === undefined || !field.confirmed) {
    return { present: false, value: null, unknown: false };
  }
  const value = field.value === null ? null : text(field.value);
  if (value === null) {
    // 已确认，但没有值 —— 用户明确确认「这一项未知」。
    return { present: true, value: null, unknown: true };
  }
  return { present: true, value, unknown: false };
}

/**
 * 把当前输入整理成时间线条目。
 *
 * **这个函数不排序、不比较日期、不推断先后。** 返回顺序是固定展示顺序：
 * 交易时间 → 发现问题 → 事情经过 → 商家回应。
 * 界面必须明确说明该顺序不代表事件实际先后。
 *
 * @param fields      页面上的凭证字段（只读取 transactionDate）
 * @param userContext 用户填写的事实陈述
 * @returns 条目数组；没有任何内容时返回空数组
 */
export function buildFactTimeline(
  fields: ExtractedField[],
  userContext: UserCaseContext,
): FactTimelineItem[] {
  const items: FactTimelineItem[] = [];

  // ---- 1. 交易时间（凭证字段） ----
  const transaction = findConfirmedTransactionDate(fields);
  if (transaction.present && transaction.value !== null) {
    items.push({
      id: 'transaction-date',
      label: '交易时间',
      value: transaction.value,
      source: 'evidence',
      status: 'known',
    });
  } else if (transaction.present && transaction.unknown) {
    items.push({
      id: 'transaction-date',
      label: '交易时间',
      value: '尚未提供',
      source: 'evidence',
      status: 'unknown',
    });
  }
  // 未确认的字段不生成条目：不把未确认内容当作事实。

  // ---- 2. 发现问题（用户填写） ----
  const discovered = text(userContext.issueDiscoveredAt);
  if (discovered !== null) {
    items.push({
      id: 'issue-discovered',
      label: '发现问题',
      value: discovered, // 原文照录
      source: 'user',
      status: 'known',
      // 没有数字 → 可以确定用户没给具体日期。有数字时不断言它是日期。
      ...(hasDigit(discovered) ? {} : { note: NO_CONCRETE_DATE_NOTE }),
    });
  }

  // ---- 3. 事情经过（用户填写） ----
  const description = text(userContext.incidentDescription);
  if (description !== null) {
    items.push({
      id: 'incident-description',
      label: '事情经过',
      value: description, // 原文照录，不改写、不摘要
      source: 'user',
      status: 'known',
      ...(hasDigit(description) ? {} : { note: NO_CONCRETE_DATE_NOTE }),
    });
  }

  // ---- 4. 商家回应（用户填写，且必须选了「已回应」并有摘要） ----
  const responseSummary = text(userContext.merchantResponseSummary);
  if (userContext.merchantResponseStatus === 'responded' && responseSummary !== null) {
    items.push({
      id: 'merchant-response',
      label: '商家回应',
      value: responseSummary, // 原文照录
      source: 'user',
      status: 'known',
    });
  }

  return items;
}
