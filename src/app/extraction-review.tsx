'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  generateAnalysisInput,
  getOptionalFieldHints,
  type AnalysisBlocker,
  type BlockingReason,
} from '@/lib/analysis-input';
import {
  EVIDENCE_FIXTURE,
  createInitialFields,
  getFixtureMeta,
} from '@/lib/extraction-fixture';
import {
  CONFIDENCE_LABELS,
  FIELD_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  type ExtractedField,
  type FieldConfidence,
} from '@/types/extraction';

/**
 * 识别结果核对组件（阶段 4.2a）。
 *
 * 严格边界：
 *   · 数据来源是 `src/lib/extraction-fixture.ts` 中的**固定样例**，
 *     **不是**真实视觉模型输出，本阶段不调用任何模型；
 *   · **不发起任何网络请求**、不上传文件、不读取环境变量；
 *   · **不写入** localStorage / sessionStorage / IndexedDB，刷新即恢复初始样例；
 *   · 不做 OCR、不做数据库读写、不做时间线/法规检索/材料生成。
 *
 * 三种状态各自独立，互不替代：
 *   · `confidence` —— 模型/识别结果的置信度，**只对 fixture 来源有意义**；
 *   · `source`     —— 数据从哪里来（fixture / user / model / unconfirmed）；
 *   · `confirmed`  —— 用户是否已明确确认。
 *
 * 因此用户手填**不会**获得模型置信度：`confidence` 保持原值不变，
 * 由渲染层按 `source` 显示「模型置信度：不适用（用户填写）」，
 * 避免把用户输入伪装成模型评估。
 *
 * 编辑与确认严格分离：
 *   · 「确认」只把 confirmed 置 true，不改 value / confidence / source；
 *   · 「编辑并保存」在内容确有变化时把 source 置 'user'、confirmed 置 false，
 *     必须再单独确认；
 *   · 若内容未实际变化（含仅增删首尾空格），保存只退出编辑，不改动任何字段状态。
 */

/** 低置信度与未知使用更醒目的样式，但状态同时以文本呈现，不只依赖颜色。 */
function confidenceClass(confidence: FieldConfidence): string {
  switch (confidence) {
    case 'high':
      return 'border-emerald-300 bg-emerald-50 text-emerald-800';
    case 'medium':
      return 'border-amber-300 bg-amber-50 text-amber-900';
    case 'low':
      return 'border-orange-300 bg-orange-50 text-orange-900';
    case 'unknown':
      return 'border-slate-300 bg-slate-100 text-slate-700';
  }
}

/**
 * fixture 原始字段的只读查找表。
 *
 * 「恢复样例状态」**只从这里取值**，绝不从当前已被修改的 fields 取值，
 * 否则恢复出来的会是用户自己的编辑内容。
 */
const FIXTURE_FIELDS: ReadonlyMap<string, ExtractedField> = new Map(
  EVIDENCE_FIXTURE.fields.map((field) => [field.key as string, field]),
);

/** 取某个字段在 fixture 中的原始数据（不可变引用）。 */
function getFixtureField(key: string): ExtractedField | undefined {
  return FIXTURE_FIELDS.get(key);
}

/**
 * 当前字段的数据状态是否与 fixture 原始状态不同。
 *
 * 比较范围：**值、置信度、来源、备注**——也就是「这个字段的内容」。
 *
 * 有意**不把 `confirmed` 计入**：
 *   · 确认/撤销确认已有专用控件（「确认该字段」/「撤销确认」）；
 *   · 如果 `confirmed` 也算差异，那么"只确认了字段"就会冒出「恢复样例状态」，
 *     而这个按钮实际上只是把确认状态翻回去，容易被误解成"仅撤销确认"；
 *   · 因此「恢复样例状态」只表达"把该字段的内容恢复成 fixture 的最初样子"，
 *     并在恢复时顺带把 `confirmed` 归零（内容既然回到初始，确认也应失效）。
 */
function isModifiedFromFixture(field: ExtractedField): boolean {
  const original = getFixtureField(field.key);
  if (original === undefined) return false;

  return (
    field.value !== original.value ||
    field.confidence !== original.confidence ||
    field.source !== original.source ||
    field.note !== original.note
  );
}

/**
 * 是否可提供「恢复样例状态」。
 *
 * 只要该字段的内容与 fixture 原始状态不同就显示——**两类字段一律提供**：
 *   · fixture 原本有值的字段 → 恢复成原始样例值；
 *   · fixture 原本就是 `value: null` 的字段 → 恢复成"未知"这一初始状态
 *     （**不伪造样例值**，只是回到最初的未知状态）。
 *
 * 若字段内容与 fixture 完全一致，则无需恢复，不显示该按钮。
 */
function canRestoreSample(field: ExtractedField): boolean {
  return isModifiedFromFixture(field);
}

/** 置信度徽标文案：按来源决定，用户填写不显示模型置信度。 */
function confidenceBadgeText(field: ExtractedField): string {
  if (field.source === 'user') {
    return field.value === null ? '用户标记为未知' : '模型置信度：不适用（用户填写）';
  }

  return `置信度：${CONFIDENCE_LABELS[field.confidence]}`;
}

/** 置信度徽标配色：用户来源统一用中性色，避免暗示模型评估。 */
function confidenceBadgeClass(field: ExtractedField): string {
  if (field.source === 'user') {
    return 'border-slate-300 bg-slate-50 text-slate-700';
  }

  return confidenceClass(field.confidence);
}

/**
 * 阻塞原因 → 面向用户的中文说明。
 *
 * 刻意不使用「不合法」「错误」这类措辞：字段没确认只是**流程还没走完**，
 * 不是用户填错了什么。
 */
function blockerText(reason: BlockingReason): string {
  switch (reason) {
    case 'MISSING_FIELD':
      return '该字段不在当前数据中';
    case 'NOT_CONFIRMED':
      return '尚未确认（即使已有值也不作为确定事实）';
    case 'CONFIRMED_NULL':
      return '已确认该字段未知，缺少必需信息';
    case 'EMPTY_VALUE':
      return '已确认但内容为空，没有可用值';
  }
}

/** 阻塞原因 → 徽标配色。同时始终给出文本，不只依赖颜色。 */
function blockerClass(reason: BlockingReason): string {
  switch (reason) {
    case 'MISSING_FIELD':
      return 'border-red-300 bg-red-50 text-red-900';
    case 'NOT_CONFIRMED':
      return 'border-amber-300 bg-amber-50 text-amber-900';
    case 'CONFIRMED_NULL':
      return 'border-orange-300 bg-orange-50 text-orange-900';
    case 'EMPTY_VALUE':
      return 'border-slate-300 bg-slate-100 text-slate-700';
  }
}

/**
 * 焦点目标。用描述式标识而非 DOM 查询，配合 ref 定位，
 * 不依赖 `document.querySelector`，也不使用键盘快捷键。
 */
type FocusTarget =
  | { kind: 'input' }
  | { kind: 'confirm'; key: string }
  | { kind: 'edit'; key: string }
  | { kind: 'progress' };

export default function ExtractionReview() {
  const meta = getFixtureMeta();

  /** 字段状态。初始值与「重置为样例」都通过 createInitialFields() 取得全新副本。 */
  const [fields, setFields] = useState<ExtractedField[]>(() => createInitialFields());
  /** 当前处于编辑态的字段 key；同一时间只编辑一个字段。 */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  /** 编辑态下的草稿文本。取消编辑时直接丢弃，不影响字段状态。 */
  const [draftValue, setDraftValue] = useState('');

  /**
   * 分析输入预览。
   *
   * **由当前 `fields` 派生**（useMemo 依赖 fields），因此每次确认 / 撤销确认 /
   * 编辑保存 / 重置都会重新计算，不会留下一份过期的旧结果。
   * 纯函数、不产生副作用、不发请求。
   */
  const analysisInput = useMemo(() => generateAnalysisInput(fields), [fields]);

  /**
   * 可选信息提示。
   *
   * 同样由当前分析输入派生——可选字段永远不参与 `ready` 判定，
   * 这里只是把「哪些信息还缺」提示出来，不影响就绪状态。
   */
  const optionalHints = useMemo(
    () => getOptionalFieldHints(analysisInput),
    [analysisInput],
  );

  /** 一次性的待处理焦点请求。在条件渲染提交之后由 effect 消费。 */
  const [focusRequest, setFocusRequest] = useState<{
    target: FocusTarget;
    seq: number;
  } | null>(null);

  /** 自增序号，保证「同一目标连续请求两次」也能重新触发 effect。 */
  const focusSeqRef = useRef(0);
  /** 各字段「确认 / 撤销确认」按钮 */
  const confirmRefs = useRef(new Map<string, HTMLButtonElement | null>());
  /** 各字段「修改此字段」按钮 */
  const editRefs = useRef(new Map<string, HTMLButtonElement | null>());
  /** 当前唯一可见的编辑输入框 */
  const draftInputRef = useRef<HTMLInputElement | null>(null);
  /** 确认进度文本：作为稳定的焦点落点 */
  const progressRef = useRef<HTMLParagraphElement | null>(null);

  /** 登记一次焦点请求（在后续渲染提交后才真正执行）。 */
  const requestFocus = useCallback((target: FocusTarget) => {
    focusSeqRef.current += 1;
    setFocusRequest({ target, seq: focusSeqRef.current });
  }, []);

  /**
   * 执行焦点请求。
   * 依赖 [focusRequest]，因此在 React 完成本次条件渲染之后才运行；
   * 每次请求只执行一次，随后清空，不会在每次渲染时抢焦点。
   * 初始加载时 focusRequest 为 null，因此页面不会自动聚焦任何输入框。
   */
  useEffect(() => {
    if (focusRequest === null) return;

    const { target } = focusRequest;
    let element: HTMLElement | null = null;

    switch (target.kind) {
      case 'input':
        element = draftInputRef.current;
        break;
      case 'confirm':
        element = confirmRefs.current.get(target.key) ?? null;
        break;
      case 'edit':
        element = editRefs.current.get(target.key) ?? null;
        break;
      case 'progress':
        element = progressRef.current;
        break;
    }

    element?.focus();
    setFocusRequest(null);
  }, [focusRequest]);

  /** 更新单个字段（按 key 定位，只替换该字段对象）。 */
  const updateField = useCallback(
    (key: string, patch: Partial<ExtractedField>) => {
      setFields((previous) =>
        previous.map((field) => (field.key === key ? { ...field, ...patch } : field)),
      );
    },
    [],
  );

  /**
   * 确认：只设置 confirmed，不动 value / confidence / source。
   *
   * 焦点**留在当前字段**：确认后该字段的确认按钮会被「撤销确认」按钮替换，
   * 因此把焦点交给同一字段的「撤销确认」按钮。
   * 界面**不再自动跳到下一个字段**——前进/后退由用户自己用 Tab / Shift+Tab 决定。
   */
  const handleConfirm = useCallback(
    (field: ExtractedField) => {
      updateField(field.key, { confirmed: true });
      requestFocus({ kind: 'confirm', key: field.key });
    },
    [requestFocus, updateField],
  );

  /** 撤销确认。焦点回到该字段当前的确认按钮。 */
  const handleUnconfirm = useCallback(
    (field: ExtractedField) => {
      updateField(field.key, { confirmed: false });
      requestFocus({ kind: 'confirm', key: field.key });
    },
    [requestFocus, updateField],
  );

  /** 进入编辑态，草稿初始为当前值（null 视为空串），焦点进入输入框。 */
  const handleStartEdit = useCallback(
    (field: ExtractedField) => {
      setEditingKey(field.key);
      setDraftValue(field.value ?? '');
      requestFocus({ kind: 'input' });
    },
    [requestFocus],
  );

  /** 取消编辑：丢弃草稿，不改动 source / confirmed / value；焦点回到“修改此字段”。 */
  const handleCancelEdit = useCallback(
    (key: string) => {
      setEditingKey(null);
      setDraftValue('');
      requestFocus({ kind: 'edit', key });
    },
    [requestFocus],
  );

  /**
   * 保存编辑。
   *
   * 先做规范化比较（`null` 与空串都视为空值、忽略首尾空格）：
   *   · **内容没有实际变化 → 完全不写回字段状态**，只退出编辑。
   *     用户只是打开了编辑框、没改东西就保存，既不是"修改"，也不是"标记未知"，
   *     因此 value / confidence / source / confirmed 全部保持原样
   *     （原本已确认的仍是已确认，用户来源的仍是用户来源，不会退回 fixture）。
   *   · 内容确有变化 → 走下面的写回逻辑。
   *
   * 内容变化时：`source` 改为 'user'，`confirmed` 归零（必须重新确认）。
   * `confidence` 一律**不修改**：用户手填不产生模型置信度，
   * 界面会按 source 显示「模型置信度：不适用（用户填写）」。
   * 内容为空即视为该字段未知（value: null），同样仍未确认。
   *
   * 比较基准是**进入编辑时的 `field.value`**，不从 fixture 反推。
   */
  const handleSaveEdit = useCallback(
    (field: ExtractedField) => {
      const trimmed = draftValue.trim();
      // 进入编辑时的字段值作为基准；null 与空字符串都归一为空串
      const originalValue = field.value?.trim() ?? '';
      const hasChanged = originalValue !== trimmed;

      // 内容未变化：不调用 updateField，退出编辑并清空草稿，焦点回到该字段当前的确认按钮
      if (!hasChanged) {
        setEditingKey(null);
        setDraftValue('');
        requestFocus({ kind: 'confirm', key: field.key });
        return;
      }

      if (trimmed === '') {
        updateField(field.key, {
          value: null,
          confidence: 'unknown',
          source: 'user',
          confirmed: false,
        });
      } else {
        updateField(field.key, {
          value: trimmed,
          source: 'user',
          confirmed: false,
        });
      }

      setEditingKey(null);
      setDraftValue('');
      requestFocus({ kind: 'confirm', key: field.key });
    },
    [draftValue, requestFocus, updateField],
  );

  /**
   * 编辑输入框的键盘处理：Enter 保存、Escape 取消。
   *
   * 只响应「单独按」的按键：
   *   · 带 Shift / Ctrl / Meta / Alt 的 Enter 不拦截，保留浏览器默认行为；
   *   · **输入法组合期间一律不处理**——中文候选词窗口里的 Enter 是选词、
   *     Escape 是关闭候选，若在这里拦截就会变成误保存或误取消；
   *     判断依据是 `nativeEvent.isComposing`，并额外兼容常见输入法上报的 229 键码。
   *
   * 两个分支都复用既有逻辑（handleSaveEdit / handleCancelEdit），
   * 不复制字段更新代码，因此来源、置信度文案与焦点管理语义完全不变。
   *
   * 注意：Enter **只保存编辑**，不等于「确认该字段」——
   * 保存后该字段仍是未确认状态，必须再单独执行确认。
   */
  const handleEditorKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>, field: ExtractedField) => {
      // 处于输入法组合（选词）状态：不保存、也不取消
      const isComposing =
        event.nativeEvent.isComposing || event.keyCode === 229;

      if (event.key === 'Enter') {
        if (isComposing) return;
        // 组合键 Enter 交给浏览器，不当作保存
        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;

        event.preventDefault();
        handleSaveEdit(field);
        return;
      }

      if (event.key === 'Escape') {
        if (isComposing) return;

        event.preventDefault();
        handleCancelEdit(field.key);
      }
    },
    [handleCancelEdit, handleSaveEdit],
  );

  /** 标记未知：置为空值与未知置信度，仍需用户另行确认；焦点到该字段的确认按钮。 */
  const handleMarkUnknown = useCallback(
    (field: ExtractedField) => {
      updateField(field.key, {
        value: null,
        confidence: 'unknown',
        source: 'user',
        confirmed: false,
      });
      setEditingKey(null);
      setDraftValue('');
      requestFocus({ kind: 'confirm', key: field.key });
    },
    [requestFocus, updateField],
  );

  /**
   * 恢复当前字段的样例状态：**只影响这一个字段**，其他字段完全不动。
   *
   * 取值来源是 fixture 原始不可变数据（`FIXTURE_FIELDS` / `getFixtureField`），
   * **不是**当前已修改的 `fields`，否则恢复出来的会是用户自己的编辑内容。
   *
   * 两类字段统一处理：
   *   · fixture 原本有值 → 恢复原始样例值、置信度、备注与 `source: 'fixture'`；
   *   · fixture 原本 `value: null` → 恢复成"未知"这一初始状态
   *     （`value: null`、原始置信度、原始备注、`source: 'fixture'`），不伪造样例值。
   *
   * 恢复后 `confirmed` 一律归零：内容既然回到初始状态，此前的确认也失效。
   * 焦点回到该字段的确认按钮（若恢复后该字段未知，按钮文案为「确认「X」未知」）。
   */
  const handleRestoreSample = useCallback(
    (field: ExtractedField) => {
      const original = getFixtureField(field.key);
      if (original === undefined) return;

      setFields((previous) =>
        previous.map((item) =>
          item.key === field.key ? { ...original, confirmed: false } : item,
        ),
      );
      setEditingKey(null);
      setDraftValue('');
      requestFocus({ kind: 'confirm', key: field.key });
    },
    [requestFocus],
  );

  /**
   * 全部确认：保留各字段当前的 value / source / confidence，只把 confirmed 置 true。
   * 按钮随后变为 disabled，因此焦点移到确认进度，不停留在不可用的按钮上。
   */
  const handleConfirmAll = useCallback(() => {
    setFields((previous) => previous.map((field) => ({ ...field, confirmed: true })));
    setEditingKey(null);
    setDraftValue('');
    requestFocus({ kind: 'progress' });
  }, [requestFocus]);

  /**
   * 重置为样例：取全新副本，全部回到 source 'fixture'、confirmed false 与原始值。
   * 重置按钮本身不会被移除，焦点自然保留在它上面，因此不额外请求焦点。
   */
  const handleReset = useCallback(() => {
    setFields(createInitialFields());
    setEditingKey(null);
    setDraftValue('');
  }, []);

  const confirmedCount = fields.filter((field) => field.confirmed).length;
  const allConfirmed = confirmedCount === fields.length;

  return (
    <section
      aria-labelledby="extraction-heading"
      className="mt-8 rounded-lg border border-slate-200 bg-white p-4 sm:p-5"
    >
      <h2
        id="extraction-heading"
        className="text-base font-semibold text-slate-900 sm:text-lg"
      >
        识别结果核对（本地模拟）
      </h2>

      {/* ---------- 键盘操作提示（辅助说明，不抢占主内容层级） ---------- */}
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        键盘操作：Tab / Shift+Tab 前后移动；Enter 执行按钮；编辑时 Enter 保存、Escape
        取消。
      </p>

      {/* ---------- 固定样例免责声明：必须醒目、不得省略 ---------- */}
      <div
        role="note"
        className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900"
      >
        <p className="font-semibold">以下内容是固定样例数据，不是真实识别结果。</p>
        <p className="mt-1">
          本页<strong className="font-semibold">未调用任何视觉模型</strong>，也
          <strong className="font-semibold">没有上传任何文件</strong>。
          这些字段仅用于演示「逐字段核对」的界面与操作流程，与实际选择的文件无关。
        </p>
        <p className="mt-1 text-xs">
          （内容为合成示例，不含任何真实商户、订单或个人信息。）
        </p>
      </div>

      {/* ---------- 整体说明与状态 ---------- */}
      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-slate-500">数据来源</dt>
          <dd className="mt-0.5 text-slate-800">{SOURCE_LABELS.fixture}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">整体状态</dt>
          <dd className="mt-0.5 text-slate-800">{STATUS_LABELS[meta.status]}</dd>
        </div>
      </dl>

      {meta.globalNote !== undefined && (
        <p className="mt-2 text-xs leading-relaxed text-slate-500">{meta.globalNote}</p>
      )}

      {/* ---------- 确认进度（可编程聚焦的稳定落点） ---------- */}
      <p
        ref={progressRef}
        tabIndex={-1}
        aria-live="polite"
        className="mt-3 rounded text-sm text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        已确认{' '}
        <strong className="font-semibold text-slate-900">{confirmedCount}</strong> /{' '}
        {fields.length} 个字段
      </p>

      {/* ---------- 字段列表 ---------- */}
      <ul className="mt-3 space-y-3">
        {fields.map((field) => {
          const isEditing = editingKey === field.key;
          const isUnknownValue = field.value === null;
          const showRestore = canRestoreSample(field);

          return (
            <li
              key={field.key}
              className="rounded-md border border-slate-200 p-3 sm:p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    {field.label}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {field.key}
                    </span>
                  </p>

                  {/* 当前值 */}
                  {isUnknownValue ? (
                    <p className="mt-1 text-sm font-medium text-slate-500">
                      未能识别（没有可确认的值）
                    </p>
                  ) : (
                    <p className="mt-1 break-words text-sm text-slate-800">
                      {field.value}
                    </p>
                  )}

                  {/* 置信度 + 来源 + 确认状态：全部为文本，不依赖颜色 */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${confidenceBadgeClass(
                        field,
                      )}`}
                    >
                      {confidenceBadgeText(field)}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                      来源：{SOURCE_LABELS[field.source]}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                        field.confirmed
                          ? 'border-blue-300 bg-blue-50 text-blue-800'
                          : 'border-slate-300 bg-white text-slate-600'
                      }`}
                    >
                      {field.confirmed ? '已确认' : '未确认'}
                    </span>
                  </div>

                  {/* 备注 */}
                  {field.note !== undefined && (
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      备注：{field.note}
                    </p>
                  )}
                </div>
              </div>

              {/* ---------- 编辑表单 ---------- */}
              {isEditing ? (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <label
                    htmlFor={`extraction-input-${field.key}`}
                    className="block text-xs font-medium text-slate-700"
                  >
                    修改「{field.label}」（留空表示该字段未知）
                  </label>
                  <input
                    ref={(element) => {
                      draftInputRef.current = element;
                    }}
                    id={`extraction-input-${field.key}`}
                    type="text"
                    value={draftValue}
                    onChange={(event) => setDraftValue(event.target.value)}
                    onKeyDown={(event) => handleEditorKeyDown(event, field)}
                    className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(field)}
                      className="field-action-button rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
                    >
                      保存修改
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelEdit(field.key)}
                      className="field-action-button rounded-md border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-200"
                    >
                      取消修改
                    </button>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">
                    保存后该字段来源会变为「用户修改」，并回到未确认状态，需要再单独确认。
                    用户填写的值不会被标注为模型置信度；若内容没有实际改动，保存不会改变该字段。
                  </p>
                </div>
              ) : (
                /* ---------- 未在编辑：操作按钮 ---------- */
                <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  {field.confirmed ? (
                    <button
                      type="button"
                      ref={(element) => {
                        confirmRefs.current.set(field.key, element);
                      }}
                      onClick={() => handleUnconfirm(field)}
                      className="field-action-button rounded-md border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-200"
                    >
                      撤销确认
                    </button>
                  ) : (
                    <button
                      type="button"
                      ref={(element) => {
                        confirmRefs.current.set(field.key, element);
                      }}
                      onClick={() => handleConfirm(field)}
                      /* 值为 null 时按钮必须明确表达「确认该字段未知」 */
                      className="field-action-button rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
                    >
                      {isUnknownValue ? `确认「${field.label}」未知` : '确认该字段'}
                    </button>
                  )}

                  <button
                    type="button"
                    ref={(element) => {
                      editRefs.current.set(field.key, element);
                    }}
                    onClick={() => handleStartEdit(field)}
                    className="field-action-button rounded-md border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-200"
                  >
                    修改此字段
                  </button>

                  {!isUnknownValue && (
                    <button
                      type="button"
                      onClick={() => handleMarkUnknown(field)}
                      className="field-action-button rounded-md border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-200"
                    >
                      标记为未知
                    </button>
                  )}

                  {showRestore && (
                    <button
                      type="button"
                      onClick={() => handleRestoreSample(field)}
                      className="field-action-button rounded-md border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-200"
                    >
                      恢复样例状态
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* ---------- 全局操作 ---------- */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={handleConfirmAll}
          disabled={allConfirmed}
          className="field-action-button rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:bg-slate-400 disabled:hover:bg-slate-400"
        >
          全部确认
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="field-action-button rounded-md border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-200"
        >
          重置为样例
        </button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        「重置为样例」只是把本页字段恢复成上方的固定样例，不会重新识别、也不会请求任何服务。
        「恢复样例状态」只影响当前一个字段，取值来自固定样例本身；对样例中本就未知的字段，
        恢复后回到"未知"状态，不会伪造样例值。
        本页不使用任何持久化存储：刷新页面后会恢复初始样例，编辑与确认状态随之清除。
      </p>

      {/* ==================================================================
          分析输入预览（阶段 4.2d 前置）
          ------------------------------------------------------------------
          完全由当前 fields 派生，复用上方的编辑与确认结果，不另建一套编辑 UI。
          这里只做「已确认输入」的完整性检查与展示：
            · 不生成任何法律结论、权益判断或条款引用；
            · 不发起任何网络请求。
         ================================================================== */}
      <section
        aria-labelledby="analysis-input-heading"
        className="mt-6 border-t-2 border-slate-200 pt-4"
      >
        <h3
          id="analysis-input-heading"
          className="text-sm font-semibold text-slate-900 sm:text-base"
        >
          分析输入预览（本地 fixture 演示）
        </h3>

        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          这里只展示<strong className="font-semibold">已确认输入</strong>的整理结果，<strong className="font-semibold">不生成法律结论</strong>、
          <strong className="font-semibold">不发送网络请求</strong>。
          内容来自上方固定样例与你当前的确认操作，既不是真实用户案件，也不是真实识别结果。
        </p>

        {/* ---------- 就绪状态总览 ---------- */}
        <div
          role="status"
          className={`mt-3 rounded-md border px-3 py-2 text-sm leading-relaxed ${
            analysisInput.ready
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          <p className="font-semibold">
            {analysisInput.ready
              ? '基础输入门槛已满足（本阶段仅检查字段完整性）'
              : `尚未就绪：${analysisInput.blockers.length} 项必需信息待处理`}
          </p>
          <p className="mt-1 text-xs">
            必需字段：
            {analysisInput.requiredKeys
              .map((key) => FIELD_LABELS[key])
              .join(' / ')}
            。这只是本阶段的分析输入门槛，不是法律判断规则，也不代表这几个字段足以得出任何法律结论。
          </p>
        </div>

        {/* ---------- 未就绪：阻塞原因 ---------- */}
        {!analysisInput.ready && (
          <div className="mt-3">
            <p className="text-xs font-medium text-slate-600">阻塞原因</p>
            <ul className="mt-2 space-y-2">
              {analysisInput.blockers.map((blocker: AnalysisBlocker) => (
                <li
                  key={blocker.key}
                  className="rounded-md border border-slate-200 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {blocker.label}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${blockerClass(
                        blocker.reason,
                      )}`}
                    >
                      {blockerText(blocker.reason)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    来源：
                    {blocker.source === null
                      ? '无（字段缺失）'
                      : SOURCE_LABELS[blocker.source]}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---------- 就绪：分析输入字段 ---------- */}
        {analysisInput.ready && (
          <div className="mt-3">
            <p className="text-xs font-medium text-slate-600">
              已纳入分析输入（{analysisInput.confirmedFields.length} 个字段）
            </p>
            <dl className="mt-2 space-y-2">
              {analysisInput.confirmedFields.map((field) => (
                <div
                  key={field.key}
                  className="rounded-md border border-slate-200 p-3"
                >
                  <dt className="text-sm font-semibold text-slate-900">
                    {field.label}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {field.key}
                    </span>
                  </dt>
                  <dd className="mt-1 text-sm text-slate-800">
                    <span
                      className={
                        field.key === 'orderId' ? 'break-all' : 'break-words'
                      }
                    >
                      {field.value}
                    </span>
                  </dd>
                  <dd className="mt-1 text-xs text-slate-500">
                    来源：{SOURCE_LABELS[field.source]} ・ 状态：已确认
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* ---------- 已确认的未知字段（与「未确认」分开呈现） ---------- */}
        {analysisInput.confirmedUnknown.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-slate-600">
              已确认未知（{analysisInput.confirmedUnknown.length} 个字段）
            </p>
            <p className="mt-1 text-xs text-slate-500">
              这些字段由你明确确认为「不知道」，保留为待查缺口，<strong className="font-semibold">不会补造任何值</strong>。
            </p>
            <ul className="mt-2 space-y-1">
              {analysisInput.confirmedUnknown.map((field) => (
                <li
                  key={field.key}
                  className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600"
                >
                  <span className="font-medium text-slate-800">{field.label}</span>
                  <span className="ml-2">未提供</span>
                  <span className="ml-2">来源：{SOURCE_LABELS[field.source]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---------- 未确认字段（不作为确定事实） ---------- */}
        {analysisInput.unresolved.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-slate-600">
              未纳入确定事实（{analysisInput.unresolved.length} 个字段）
            </p>
            <ul className="mt-2 space-y-1">
              {analysisInput.unresolved.map((field) => (
                <li
                  key={field.key}
                  className="rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-600"
                >
                  <span className="font-medium text-slate-800">{field.label}</span>
                  <span className="ml-2">
                    {field.reason === 'NOT_CONFIRMED'
                      ? '未确认'
                      : '已确认但内容为空'}
                  </span>
                  {field.value !== null && (
                    <span className="ml-2 break-all">
                      当前值：{field.value}
                    </span>
                  )}
                  <span className="ml-2">来源：{SOURCE_LABELS[field.source]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---------- 可选信息提示（不影响就绪状态） ---------- */}
        {optionalHints.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-slate-600">可选信息提示</p>
            <ul className="mt-2 space-y-1">
              {optionalHints.map((hint) => (
                <li
                  key={hint}
                  className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700"
                >
                  {hint}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              这些只是<strong className="font-semibold">输入完整性提示</strong>：可选字段不参与就绪判定，也不构成阻塞。
              本区域仍是本地 fixture 演示，不生成法律结论、不发送网络请求。
            </p>
          </div>
        )}

        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          本预览每次确认、撤销确认、保存编辑或重置都会重新计算，始终对应上面当前的字段状态；
          它不写入任何存储，也不把数据交给任何接口。以上内容只是输入整理结果，
          <strong className="font-semibold">不是权益分析结论</strong>。
        </p>
      </section>

      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        <span className="font-medium text-slate-600">字段范围：</span>
        {Object.values(FIELD_LABELS).join(' / ')}。本阶段不包含订单状态、退款状态、
        支付方式、收货地址或商家联系方式等其他字段。
      </p>
    </section>
  );
}
