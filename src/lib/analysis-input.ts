import { FIELD_LABELS } from '@/types/extraction';
import type {
  ExtractedField,
  ExtractionFieldKey,
  FieldSource,
} from '@/types/extraction';

/**
 * 阶段 4.2d 前置：**已确认字段 → 分析输入**的纯函数转换。
 *
 * ============================================================================
 * 这个模块不做什么
 * ============================================================================
 *   · **不生成任何法律结论、权益判断或条款引用**——它只做「输入完整性检查」；
 *   · 不调用模型、不发起网络请求、不读取环境变量、不读写存储；
 *   · 不修改传入的字段数组（无副作用、无变异）；
 *   · 不补造、不推断、不改写任何字段值——值是什么就原样搬过去。
 *
 * ============================================================================
 * 必需字段是「输入门槛」，不是法律判断规则
 * ============================================================================
 * 本阶段把 `merchantName`（商家名称）与 `amount`（金额）当作基础输入的必需字段：
 * 没有这两项就无法描述「向谁、多少钱」这一最小事实。
 *
 * 这**只是** 4.2d 的输入完整性门槛，**不是**法律判断规则，
 * 也**不代表**这两个字段足以作出任何法律结论。
 * 后续阶段若调整门槛，只应改 `REQUIRED_ANALYSIS_FIELD_KEYS` 这一处。
 *
 * ============================================================================
 * 三分类（互斥）
 * ============================================================================
 *   1. **已确认且有值** → 进入 `confirmedFields`，作为确定输入；
 *   2. **已确认但值为 `null`** → 进入 `confirmedUnknown`，
 *      表示「用户确认自己也不知道」，与「未确认」是两回事；
 *   3. **未确认** → 进入 `unresolved`，**不作为确定事实**纳入。
 *
 * 另有两种边界单独处理，绝不与 `null` 混为一谈：
 *   · 已确认但值是空字符串 / 纯空白（`EMPTY_VALUE`）→ 视为**没有可用值**，
 *     但**不**改写成 `null`；
 *   · 字段整个缺失（`MISSING_FIELD`）→ 属契约异常，单独报告。
 *
 * 说明：现有编辑逻辑（`extraction-review.tsx` 的 `handleSaveEdit`）在保存时
 * 已把空内容规范化为 `value: null`，因此正常交互下不会产生空串。
 * 这里仍然单独识别空串，是为了**不把空串偷偷当成 `null`**。
 */

/** 本阶段的基础输入必需字段。刻意集中在一处，便于后续调整门槛。 */
export const REQUIRED_ANALYSIS_FIELD_KEYS = [
  'merchantName',
  'amount',
] as const satisfies readonly ExtractionFieldKey[];

/** 一种「进入分析输入」的已确认字段。保留来源，供下游区分数据从哪来。 */
export type AnalysisInputField = {
  key: ExtractionFieldKey;
  label: string;
  /** 已确认且非 null 的值。原样保留，不做裁剪或改写。 */
  value: string;
  /** 数据来源（fixture / mock / model / user / unconfirmed），原样保留。 */
  source: FieldSource;
  confirmed: true;
  note?: string;
};

/** 用户**明确确认**为未知的字段（已确认 + 值为 null）。 */
export type ConfirmedUnknownField = {
  key: ExtractionFieldKey;
  label: string;
  source: FieldSource;
  confirmed: true;
  note?: string;
};

/** 未进入确定事实的原因。 */
export type UnresolvedReason = 'NOT_CONFIRMED' | 'EMPTY_VALUE';

/** 未确认或没有可用值的字段。**不作为确定事实**。 */
export type UnresolvedField = {
  key: ExtractionFieldKey;
  label: string;
  /** 当前值；未确认字段可能本来就有值（来自样例或用户填写），但不能当作事实。 */
  value: string | null;
  source: FieldSource;
  confirmed: boolean;
  reason: UnresolvedReason;
};

/** 阻塞原因。 */
export type BlockingReason =
  | 'MISSING_FIELD'
  | 'NOT_CONFIRMED'
  | 'CONFIRMED_NULL'
  | 'EMPTY_VALUE';

/** 一条阻塞项。只由**必需字段**产生。 */
export type AnalysisBlocker = {
  key: ExtractionFieldKey;
  label: string;
  reason: BlockingReason;
  /** 字段缺失时为 null（没有任何来源可言）。 */
  source: FieldSource | null;
};

/** 生成结果。 */
export type AnalysisInputResult = {
  /**
   * 所有必需字段都已确认且有可用值时为 true。
   *
   * ==========================================================================
   * `ready: true` **只**表示：输入达到了「下一步离线规则分析」所需的最低完整度。
   * ==========================================================================
   * 它**不**表示、也**不**暗示以下任何一项：
   *   · 不表示权益成立；
   *   · 不表示商家违法；
   *   · 不表示用户一定有权退款或赔偿；
   *   · 不表示投诉成功；
   *   · 不表示应该起诉；
   *   · 不表示字段值的真实性或合法性已经确认。
   *
   * 换言之，`ready` 是一个**输入收集进度**信号，不是任何形式的结论。
   */
  ready: boolean;
  /** 本阶段视为必需的字段清单（只读）。 */
  requiredKeys: readonly ExtractionFieldKey[];
  /** 已确认且有值的字段——真正的分析输入。 */
  confirmedFields: AnalysisInputField[];
  /** 已确认但为 null 的字段——用户确认的未知项。 */
  confirmedUnknown: ConfirmedUnknownField[];
  /** 未确认或值为空白的字段——不作为确定事实。 */
  unresolved: UnresolvedField[];
  /** 阻塞项：仅与必需字段有关；为空即 ready。 */
  blockers: AnalysisBlocker[];
};

/** 值是否为「有可用内容」：排除 null 与纯空白字符串。 */
function hasUsableValue(value: string | null): value is string {
  return value !== null && value.trim() !== '';
}

/**
 * 把当前字段状态转换成分析输入。
 *
 * 纯函数：相同输入必得相同输出，不修改入参，无副作用。
 * 每次字段状态变化都应重新调用（不要缓存成一次性结果）。
 */
export function generateAnalysisInput(
  fields: ExtractedField[],
): AnalysisInputResult {
  /** 按 key 建索引，便于判定必需字段是否存在。 */
  const byKey = new Map<ExtractionFieldKey, ExtractedField>();
  for (const field of fields) {
    byKey.set(field.key, field);
  }

  const confirmedFields: AnalysisInputField[] = [];
  const confirmedUnknown: ConfirmedUnknownField[] = [];
  const unresolved: UnresolvedField[] = [];

  for (const field of fields) {
    if (field.confirmed) {
      if (field.value === null) {
        // 已确认的未知：与「未确认」明确区分
        const entry: ConfirmedUnknownField = {
          key: field.key,
          label: field.label,
          source: field.source,
          confirmed: true,
        };
        if (field.note !== undefined) entry.note = field.note;
        confirmedUnknown.push(entry);
        continue;
      }

      if (hasUsableValue(field.value)) {
        // 已确认且有值：进入分析输入，值原样保留
        const entry: AnalysisInputField = {
          key: field.key,
          label: field.label,
          value: field.value,
          source: field.source,
          confirmed: true,
        };
        if (field.note !== undefined) entry.note = field.note;
        confirmedFields.push(entry);
        continue;
      }

      // 已确认但值为空白：没有可用值，但**不是** null
      unresolved.push({
        key: field.key,
        label: field.label,
        value: field.value,
        source: field.source,
        confirmed: true,
        reason: 'EMPTY_VALUE',
      });
      continue;
    }

    // 未确认：即使有值也不作为确定事实
    unresolved.push({
      key: field.key,
      label: field.label,
      value: field.value,
      source: field.source,
      confirmed: false,
      reason: 'NOT_CONFIRMED',
    });
  }

  const blockers: AnalysisBlocker[] = [];

  for (const key of REQUIRED_ANALYSIS_FIELD_KEYS) {
    const label = FIELD_LABELS[key];
    const field = byKey.get(key);

    if (field === undefined) {
      blockers.push({ key, label, reason: 'MISSING_FIELD', source: null });
      continue;
    }

    if (!field.confirmed) {
      // 未确认时，即使有值也阻塞
      blockers.push({ key, label, reason: 'NOT_CONFIRMED', source: field.source });
      continue;
    }

    if (field.value === null) {
      blockers.push({ key, label, reason: 'CONFIRMED_NULL', source: field.source });
      continue;
    }

    if (!hasUsableValue(field.value)) {
      blockers.push({ key, label, reason: 'EMPTY_VALUE', source: field.source });
      continue;
    }
  }

  return {
    ready: blockers.length === 0,
    requiredKeys: REQUIRED_ANALYSIS_FIELD_KEYS,
    confirmedFields,
    confirmedUnknown,
    unresolved,
    blockers,
  };
}

/**
 * 本阶段的可选字段。
 *
 * 「可选」只表示**它们不参与 `ready` 判定**，不表示它们不重要：
 * 缺少这些信息会降低后续分析的完整度，所以单独给出提示。
 */
export const OPTIONAL_ANALYSIS_FIELD_KEYS = [
  'transactionDate',
  'orderId',
  'itemName',
] as const satisfies readonly ExtractionFieldKey[];

/**
 * 生成**可选字段**的输入提示。
 *
 * ============================================================================
 * 这个函数不做的事
 * ============================================================================
 *   · **不改变 `ready`**——可选字段永远不参与就绪判定；
 *   · **不往 `blockers` 里加任何东西**——可选字段缺失不是阻塞项；
 *   · **不修改入参 `result`**，也不修改任何字段值（纯函数）；
 *   · **不生成任何法律判断**——提示只是「输入信息提示」，
 *     与法律结论、权益判断、投诉或赔偿建议无关。
 *
 * ============================================================================
 * 对每个可选字段的三种提示
 * ============================================================================
 *   1. 已确认且有值      → **不生成提示**（信息已经齐全）；
 *   2. 已确认且为 null   → 「已确认未知，后续分析将不包含该信息」；
 *   3. 未确认（含缺失）  → 「尚未确认，可能影响后续分析准确性」。
 *
 * 边界说明：已确认但值为空白的可选字段（`EMPTY_VALUE`），下游同样拿不到可用值，
 * 因此按第 2 类给出「已确认未知」提示；**但不会把空串改写成 `null`**，
 * 字段状态本身保持不变。
 */
export function getOptionalFieldHints(result: AnalysisInputResult): string[] {
  /** 已确认且有值的可选字段：无需提示。 */
  const withValue = new Set<ExtractionFieldKey>(
    result.confirmedFields.map((field) => field.key),
  );
  /** 已确认但为 null 的可选字段。 */
  const confirmedUnknownKeys = new Set<ExtractionFieldKey>(
    result.confirmedUnknown.map((field) => field.key),
  );
  /** 已确认但值为空白的可选字段：同样拿不到可用值。 */
  const emptyValueKeys = new Set<ExtractionFieldKey>(
    result.unresolved
      .filter((field) => field.reason === 'EMPTY_VALUE')
      .map((field) => field.key),
  );

  const hints: string[] = [];

  for (const key of OPTIONAL_ANALYSIS_FIELD_KEYS) {
    // 标签统一取自 FIELD_LABELS，不在这里重复定义
    const label = FIELD_LABELS[key];

    if (withValue.has(key)) {
      continue;
    }

    if (confirmedUnknownKeys.has(key) || emptyValueKeys.has(key)) {
      hints.push(`${label}已确认未知，后续分析将不包含该信息`);
      continue;
    }

    hints.push(`${label}尚未确认，可能影响后续分析准确性`);
  }

  return hints;
}

/* ============================================================================
 * 材料补充建议（离线事实整理）
 * ============================================================================
 * 这一节把「当前输入有哪些缺口」整理成中性提示，**只做事实整理**：
 *   · 不判断权益是否成立、不判断商家是否违法；
 *   · 不给出投诉方案、赔偿建议、维权策略或诉讼意见；
 *   · 不评估证据强弱，也不把 `confidence` 当作证据强度；
 *   · 不把 `source` 转换成任何法律依据；
 *   · 不补造、不推断、不改写任何字段值。
 *
 * ============================================================================
 * 职责划分：只覆盖**必需字段**与**材料保留**
 * ============================================================================
 * 本函数**不管可选字段**——可选字段的未确认 / 已确认未知状态由
 * `getOptionalFieldHints` 在「可选信息提示」区块统一呈现。
 * 两边各说一遍会造成同义重复，所以这里刻意不遍历
 * `OPTIONAL_ANALYSIS_FIELD_KEYS`，也不产出 `OPTIONAL_SUGGESTED`。
 *
 * 因此本函数的输出只有两类：
 *   1. 必需字段的补充 / 确认提示（来自 `blockers`，按其原有顺序）；
 *   2. `ready === true` 时的原始材料保留提醒。
 *
 * 提示顺序稳定：先 `blockers` 原序，最后证据保全。
 */

/** 材料提示的分类。仅用于组织展示，不含任何判断含义。 */
export type MaterialHintCategory =
  /** 必需字段缺失 / 已确认为未知 / 已确认但内容为空。 */
  | 'REQUIRED_MISSING'
  /** 必需字段尚未确认。 */
  | 'REQUIRED_UNCONFIRMED'
  /**
   * 可选字段的补充建议。
   *
   * **当前不产出**：可选字段状态统一由 `getOptionalFieldHints` 呈现，
   * 以免与「可选信息提示」区块重复。保留此分类仅用于未来扩展。
   */
  | 'OPTIONAL_SUGGESTED'
  /** 输入已达最低完整度时，提醒保留原始材料。 */
  | 'EVIDENCE_PRESERVATION';

/** 一条材料补充建议。 */
export type MaterialHint = {
  category: MaterialHintCategory;
  /** 面向用户的中性文案：只说「缺什么 / 建议补什么」，不下结论。 */
  text: string;
  /** 关联字段；仅用于数据结构，UI 不必展示内部 key。 */
  relatedField?: ExtractionFieldKey;
};

/**
 * 根据当前分析输入生成**材料补充建议**。
 *
 * 纯函数：不修改入参 `result`、无副作用、无 React 依赖、无网络、无存储。
 * **不改变 `ready`，也不改变 `blockers`**——它只是把已有信息换个说法提醒用户。
 */
export function generateMaterialHints(
  result: AnalysisInputResult,
): MaterialHint[] {
  const hints: MaterialHint[] = [];

  // ---------- 1. 必需字段阻塞（复用 result.blockers，不重新判定） ----------
  for (const blocker of result.blockers) {
    switch (blocker.reason) {
      case 'MISSING_FIELD':
        hints.push({
          category: 'REQUIRED_MISSING',
          text: `请补充${blocker.label}信息`,
          relatedField: blocker.key,
        });
        break;
      case 'NOT_CONFIRMED':
        hints.push({
          category: 'REQUIRED_UNCONFIRMED',
          text: `请确认${blocker.label}是否准确`,
          relatedField: blocker.key,
        });
        break;
      case 'CONFIRMED_NULL':
        hints.push({
          category: 'REQUIRED_MISSING',
          text: `${blocker.label}为必需信息，请尽量提供`,
          relatedField: blocker.key,
        });
        break;
      case 'EMPTY_VALUE':
        // 归入缺信息，用中性措辞；不把空串改写成 null
        hints.push({
          category: 'REQUIRED_MISSING',
          text: `请补充${blocker.label}信息`,
          relatedField: blocker.key,
        });
        break;
    }
  }

  // ---------- 2. 可选字段：**不在此处生成提示** ----------
  //
  // 职责划分（避免同一件事在两个区块各说一遍）：
  //   · 「可选信息提示」（`getOptionalFieldHints`）负责展示可选字段的
  //     未确认 / 已确认未知状态；
  //   · 「材料补充建议」（本函数）只负责**必需字段**的补充与确认，
  //     以及就绪后的原始材料保留提醒。
  //
  // 因此这里**不遍历** `OPTIONAL_ANALYSIS_FIELD_KEYS`，也不生成
  // `OPTIONAL_SUGGESTED`。该分类保留在类型中，仅用于未来扩展，
  // 当前函数不会产出它。
  //
  // 注意：可选字段**从不**进入 `blockers`，也不影响 `ready`。

  // ---------- 3. 证据保全：仅在输入达到最低完整度时提示 ----------
  if (result.ready) {
    hints.push({
      category: 'EVIDENCE_PRESERVATION',
      text: '建议保留付款凭证、商家沟通记录等原始材料',
    });
  }

  return hints;
}
