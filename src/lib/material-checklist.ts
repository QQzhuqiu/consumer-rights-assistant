/**
 * 材料记录清单的本地整理逻辑（纯函数，无副作用）。
 *
 * 本文件**只做一件事**：按用户自己写的材料说明，保守判断「原文里有没有提到
 * 某一类材料」。它**不是**证据效力判断，也**不是**材料是否充分的结论。
 *
 * 严格边界：
 *   · 匹配结果只有一个含义：**用户填写的原文中提到了这一类材料**；
 *   · 不判断材料真伪、充分性、证明力或法律效力；
 *   · 不提示「必须提供」，不暗示缺少材料就不能维权；
 *   · 不凭空添加材料类别，类别列表是固定的；
 *   · 不擅自把用户文字归类到「其他材料」以外的类别；
 *   · 不修改传入的 `userContext`，不改写用户原文；
 *   · 不发请求、不读存储、不读环境变量。
 */

import type { UserCaseContext } from '@/types/user-case';

/**
 * 材料类别的匹配状态。
 *
 *   · `'mentioned'`     —— 用户原文中明确出现了该类材料的关键词；
 *   · `'not_mentioned'` —— 用户原文中没有出现对应关键词。
 *
 * 注意：`'not_mentioned'` **只**表示「这次没提到」，
 * **不代表**用户没有这类材料，**更不代表**缺少它就影响什么。
 */
export type MaterialChecklistStatus = 'mentioned' | 'not_mentioned';

/** 一类材料在清单中的条目。 */
export type MaterialChecklistItem = {
  /** 稳定标识，用于 React key */
  id: string;
  /** 类别名称，例如「支付凭证」 */
  label: string;
  /** 说明：命中的关键词，或「原文中未提到」，或用户原文（其他材料） */
  note: string;
  /** 匹配状态 */
  status: MaterialChecklistStatus;
};

/** 状态 → 中文标签。 */
export const MATERIAL_STATUS_LABELS: Record<MaterialChecklistStatus, string> = {
  mentioned: '原文中提到',
  not_mentioned: '原文中未提到',
};

/** 材料情况尚未填写时的说明文案。 */
export const EMPTY_EVIDENCE_NOTES_TEXT = '尚未填写材料情况';

/** 「其他材料」一栏的固定标签。 */
export const OTHER_MATERIAL_LABEL = '其他材料';

/**
 * 固定类别的定义。
 *
 * `keywords` 为该类别在原文中的**保守匹配词**。
 * 关键词列表刻意保持窄：宁可漏判成「未提到」，也不要误判成「提到了」。
 */
const MATERIAL_CATEGORIES: ReadonlyArray<{
  id: string;
  label: string;
  keywords: readonly string[];
}> = [
  { id: 'payment', label: '支付凭证', keywords: ['支付', '付款', '银行流水'] },
  { id: 'order', label: '订单或交易记录', keywords: ['订单', '交易记录'] },
  {
    id: 'communication',
    label: '商家沟通记录',
    keywords: ['聊天', '客服', '短信', '邮件', '商家回复'],
  },
  {
    id: 'photo',
    label: '商品或服务状态照片',
    keywords: ['照片', '图片', '视频'],
  },
  {
    id: 'logistics',
    label: '物流或签收记录',
    keywords: ['物流', '快递', '签收'],
  },
] as const;

/** 取文本：空白一律视为「没填」。不改写原文，只 trim 判断与展示。 */
function normalize(value: string): string | null {
  return value.trim() === '' ? null : value.trim();
}

/**
 * 把用户填写的材料情况整理成清单。
 *
 * @param userContext 用户填写的事实陈述（只读取 `evidenceNotes`）
 * @returns 固定的六个类别条目；无内容时全部为 `'not_mentioned'`
 */
export function buildMaterialChecklist(
  userContext: UserCaseContext,
): MaterialChecklistItem[] {
  const raw = normalize(userContext.evidenceNotes);
  const items: MaterialChecklistItem[] = [];

  for (const category of MATERIAL_CATEGORIES) {
    if (raw === null) {
      items.push({
        id: category.id,
        label: category.label,
        note: EMPTY_EVIDENCE_NOTES_TEXT,
        status: 'not_mentioned',
      });
      continue;
    }

    const hits = category.keywords.filter((keyword) => raw.includes(keyword));
    if (hits.length > 0) {
      items.push({
        id: category.id,
        label: category.label,
        // 只陈述「命中了哪个词」，不做任何推断。
        note: `原文提到「${hits.join('」「')}」`,
        status: 'mentioned',
      });
    } else {
      items.push({
        id: category.id,
        label: category.label,
        note: '原文中未提到',
        status: 'not_mentioned',
      });
    }
  }

  // ---- 其他材料：只按原文展示，不做任何分类或扩展 ----
  items.push({
    id: 'other',
    label: OTHER_MATERIAL_LABEL,
    note: raw === null ? EMPTY_EVIDENCE_NOTES_TEXT : raw,
    status: 'not_mentioned',
  });

  return items;
}
