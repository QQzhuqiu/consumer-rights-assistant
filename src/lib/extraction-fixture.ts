import type { ExtractedField, ExtractionResult } from '@/types/extraction';

/**
 * 阶段 4.2a 的**固定样例数据**。
 *
 * 重要：这里的数据**全部是合成的演示样例**，用于验证字段结构与核对界面，
 * **不是**任何视觉模型的输出，**不是**真实消费凭证的内容。
 *
 * 因此每个字段的 `source` 一律为 `'fixture'`，本阶段**绝不产生** `source: 'model'`。
 */

/** 深拷贝单个字段，避免界面上的编辑直接改写共享的 fixture 常量。 */
function cloneField(field: ExtractedField): ExtractedField {
  return { ...field };
}

/** 初始固定样例。`confirmed` 全部为 `false`。 */
export const EVIDENCE_FIXTURE: ExtractionResult = {
  status: 'partial',
  globalNote:
    '本示例数据为界面演示用的固定样例，不是真实识别结果，未调用任何模型。',
  fields: [
    {
      key: 'merchantName',
      label: '商家名称',
      value: '某某电商旗舰店',
      confidence: 'high',
      source: 'fixture',
      confirmed: false,
    },
    {
      key: 'itemName',
      label: '商品/服务名称',
      value: '蓝牙耳机 Pro Max',
      confidence: 'medium',
      source: 'fixture',
      confirmed: false,
    },
    {
      key: 'amount',
      label: '金额',
      value: '299',
      confidence: 'low',
      source: 'fixture',
      note: '金额缺少货币符号，请确认单位。',
      confirmed: false,
    },
    {
      key: 'transactionDate',
      label: '交易日期',
      value: null,
      confidence: 'unknown',
      source: 'fixture',
      note: '示例中未提供可确认的交易日期。',
      confirmed: false,
    },
    {
      key: 'orderId',
      label: '订单号',
      value: null,
      confidence: 'unknown',
      source: 'fixture',
      note: '示例中未找到订单号。',
      confirmed: false,
    },
  ],
};

/**
 * 返回一份与共享常量完全脱离的字段数组副本。
 *
 * 每次调用都会新建数组与每个字段对象，因此界面上的任何修改都不会污染
 * `EVIDENCE_FIXTURE`。用于初始化状态与「重置为样例」。
 */
export function createInitialFields(): ExtractedField[] {
  return EVIDENCE_FIXTURE.fields.map(cloneField);
}

/** 取出固定样例的整体说明与状态（值类型，无需拷贝）。 */
export function getFixtureMeta(): Pick<ExtractionResult, 'status' | 'globalNote'> {
  return {
    status: EVIDENCE_FIXTURE.status,
    globalNote: EVIDENCE_FIXTURE.globalNote,
  };
}
