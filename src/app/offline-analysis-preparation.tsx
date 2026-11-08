'use client';

import { useMemo } from 'react';

import {
  generateAnalysisInput,
  type AnalysisBlocker,
  type BlockingReason,
} from '@/lib/analysis-input';
import { SOURCE_LABELS, type ExtractedField } from '@/types/extraction';
import {
  MERCHANT_RESPONSE_OPTIONS,
  RESOLUTION_OPTIONS,
  getUserCaseContextStatus,
  type UserCaseContext,
} from '@/types/user-case';

/**
 * 离线分析准备（本地整理）——阶段 5 第二步。
 *
 * ============================================================================
 * 这个模块只做一件事：把当前页面里**已经存在的两类输入**摆到一起看清楚。
 * ============================================================================
 *
 *   · 凭证字段（4.2a 已确认的部分）
 *   · 用户自己填写的事实陈述与处理诉求（4.2e）
 *
 * 它**不是**权益分析，**不是**法律意见，**不**生成责任判断、赔偿建议或投诉方案。
 * 它**不**调用模型、**不**发网络请求、**不**读任何存储、**不**上传任何东西。
 *
 * 严格边界：
 *   · 只读 props，不持有任何业务 state，不修改传入对象；
 *   · 完整性判定**全部**复用 `analysis-input.ts` 的既有函数，不另写规则；
 *   · 用户陈述**不进入** `confirmedFields`，也不混入凭证字段的 `blockers`；
 *   · 4.2c 的 mock 结果**不参与**任何计算——本组件拿不到它，也不该拿到。
 */

/** 本组件的 props：两类真实共享状态由 `page.tsx` 传入。 */
type OfflineAnalysisPreparationProps = {
  /** 凭证字段（4.2a，页面唯一一份）。 */
  fields: ExtractedField[];
  /** 用户事实陈述（4.2e，页面唯一一份）。 */
  userContext: UserCaseContext;
};

/** 区块标题样式。与页面其他区块保持一致。 */
const BLOCK_HEADING_CLASS =
  'text-sm font-semibold text-slate-900 sm:text-base';

/** 区块说明文字。 */
const BLOCK_NOTE_CLASS = 'mt-1 text-xs leading-relaxed text-slate-500';

/** 键值行的通用样式。 */
const ROW_CLASS = 'flex flex-wrap items-baseline gap-x-2 gap-y-1';

/** 键名（左侧标签）。 */
const ROW_LABEL_CLASS = 'text-xs font-medium text-slate-500';

/** 键值（右侧内容）。 */
const ROW_VALUE_CLASS = 'min-w-0 flex-1 break-words text-sm text-slate-800';

/** 「暂未填写 / 暂无」这类空态文案。 */
const EMPTY_TEXT_CLASS = 'mt-2 text-sm text-slate-500';

/**
 * 阻塞原因 → 面向用户的中性说明。
 *
 * 措辞只描述「这一项还缺什么」，不评价这件事该怎么处理。
 */
const BLOCKING_REASON_LABELS: Record<BlockingReason, string> = {
  MISSING_FIELD: '缺少该字段',
  NOT_CONFIRMED: '尚未确认',
  CONFIRMED_NULL: '已确认未知',
  EMPTY_VALUE: '内容为空',
};

/** 把用户陈述中「希望如何处理」的枚举值翻成中文标签。 */
function resolutionLabel(context: UserCaseContext): string | null {
  if (context.desiredResolution === '') return null;
  const option = RESOLUTION_OPTIONS.find((item) => item.value === context.desiredResolution);
  return option?.label ?? null;
}

/** 把用户陈述中「商家是否回应」的枚举值翻成中文标签。 */
function merchantResponseLabel(context: UserCaseContext): string | null {
  if (context.merchantResponseStatus === '') return null;
  const option = MERCHANT_RESPONSE_OPTIONS.find(
    (item) => item.value === context.merchantResponseStatus,
  );
  return option?.label ?? null;
}

/** 一条用户陈述展示项。`value` 为 null 表示用户没填。 */
type UserCaseRow = {
  /** 键名 */
  name: string;
  /** 用户填写的内容；null 表示暂未填写 */
  value: string | null;
};

/**
 * 汇总用户陈述的展示行。
 *
 * 只做「取出来 + 翻译枚举」，不做任何判断。
 * 纯函数：不修改入参。
 */
function buildUserCaseRows(context: UserCaseContext): UserCaseRow[] {
  const text = (value: string): string | null => (value.trim() === '' ? null : value.trim());

  return [
    { name: '事情经过', value: text(context.incidentDescription) },
    { name: '发现问题的时间或阶段', value: text(context.issueDiscoveredAt) },
    { name: '商家是否回应', value: merchantResponseLabel(context) },
    { name: '商家回应摘要', value: text(context.merchantResponseSummary) },
    { name: '希望如何处理', value: resolutionLabel(context) },
    { name: '其他处理诉求', value: text(context.desiredResolutionOther) },
    { name: '证据材料情况', value: text(context.evidenceNotes) },
  ];
}

/** 一个小节：标题 + 说明 + 内容。 */
function SubBlock({
  heading,
  note,
  children,
}: {
  heading: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <h4 className="text-sm font-medium text-slate-800">{heading}</h4>
      {note === undefined ? null : <p className={BLOCK_NOTE_CLASS}>{note}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** 一条阻塞说明。只展示字段名与原因，不带任何处理建议。 */
function BlockerLine({ blocker }: { blocker: AnalysisBlocker }) {
  return (
    <li className="text-sm text-slate-700">
      <span className="font-medium text-slate-800">{blocker.label}</span>
      <span className="text-slate-500">
        {' '}
        — {BLOCKING_REASON_LABELS[blocker.reason]}
      </span>
    </li>
  );
}

export default function OfflineAnalysisPreparation({
  fields,
  userContext,
}: OfflineAnalysisPreparationProps) {
  /**
   * 凭证输入。**由 props 的 `fields` 派生**，因此字段一改就重算，
   * 不会留一份过期结果。纯函数、无副作用、无请求。
   */
  const analysisInput = useMemo(() => generateAnalysisInput(fields), [fields]);

  /** 用户陈述的填写进度。同样由 props 派生。 */
  const userContextStatus = useMemo(
    () => getUserCaseContextStatus(userContext),
    [userContext],
  );

  /**
   * 用户陈述的展示行。
   *
   * 注：这里**不再**派生「可选信息提示」与「材料补充建议」——
   * 那两组内容已由上方 4.2d 的「识别结果核对」区块呈现，
   * 本模块只展示它独有的信息，避免同一件事在页面上说两遍。
   * `analysis-input.ts` 中的 `getOptionalFieldHints` / `generateMaterialHints`
   * 仍然存在、仍由 4.2d 使用，本模块只是不重复调用。
   */
  const userCaseRows = useMemo(() => buildUserCaseRows(userContext), [userContext]);

  /**
   * 三项状态语义：
   *
   *   · `evidenceReady`  —— 凭证**必需**字段都已确认且有值（复用 `ready`，未重算）；
   *   · `contextFilled`  —— 用户**至少填写了一项**陈述；
   *   · `minimumInputMet` —— 两者同时满足。
   *
   * `minimumInputMet` **只**表示两类输入都达到本阶段的最低门槛。
   * 它不表示权益成立、不表示商家违法、不表示用户有权退款或赔偿、
   * 不表示投诉会成功、也不表示事实真实性已经核实。
   *
   * 特意**不**把它命名为 `ready`，避免与 `AnalysisInputResult.ready`
   * 混为一谈，也不写进任何现有类型。
   */
  const evidenceReady = analysisInput.ready;
  const contextFilled = userContextStatus.filled;
  const minimumInputMet = evidenceReady && contextFilled;

  /**
   * 展示层去重：同一个必需字段未确认时，会**同时**出现在
   * `blockers` 与 `unresolved` 两个数组里（前者针对必需字段给出阻塞原因，
   * 后者收录所有未确认 / 空值字段）。若两个数组都直接渲染，该字段名会在
   * 「凭证字段阻塞」与「尚未确认的字段」两处各出现一次。
   *
   * 这里只在**展示层**做过滤：
   *   · 必需字段的阻塞状态 → 只由「凭证字段阻塞」呈现；
   *   · 「尚未确认的字段」只呈现没有被阻塞列表覆盖的其余字段（通常是可选字段）。
   *
   * 不修改 `analysisInput`、不修改 `blockers` / `unresolved` 原数组，
   * 也不改变 `ready` 与 `minimumInputMet` 的计算。
   */
  const blockerKeys = new Set(analysisInput.blockers.map((blocker) => blocker.key));
  const displayUnresolved = analysisInput.unresolved.filter(
    (field) => !blockerKeys.has(field.key),
  );

  const hasConfirmedFields = analysisInput.confirmedFields.length > 0;
  const hasUserCaseContent = userCaseRows.some((row) => row.value !== null);

  return (
    <section
      aria-labelledby="offline-preparation-heading"
      className="mt-8 rounded-lg border border-slate-200 bg-white p-4 sm:p-5"
    >
      <h2
        id="offline-preparation-heading"
        className="text-base font-semibold text-slate-900 sm:text-lg"
      >
        离线分析准备（本地整理）
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        这里只整理当前页面中的凭证信息和你填写的内容，不生成权益或法律结论。
      </p>

      {/* ---------- 状态区：两项独立状态 + 一项综合状态 ---------- */}
      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
        <dl className="space-y-1.5">
          <div className={ROW_CLASS}>
            <dt className={ROW_LABEL_CLASS}>凭证字段：</dt>
            <dd className={ROW_VALUE_CLASS}>
              {evidenceReady ? '已达到最低输入' : '仍需补充或确认'}
            </dd>
          </div>
          <div className={ROW_CLASS}>
            <dt className={ROW_LABEL_CLASS}>用户陈述：</dt>
            <dd className={ROW_VALUE_CLASS}>
              {contextFilled ? `已填写 ${userContextStatus.filledCount} 项` : '尚未填写'}
            </dd>
          </div>
        </dl>

        <p
          role="status"
          aria-live="polite"
          className="mt-3 border-t border-slate-200 pt-2.5 text-sm font-medium text-slate-800"
        >
          {minimumInputMet ? '已具备继续整理的最低输入' : '当前仍需补充或确认输入'}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          这只是输入收集进度，不代表事实已被独立验证，也不构成任何权益或法律结论。
        </p>
      </div>

      {/* ---------- 1. 已确认凭证信息 ---------- */}
      <div className="mt-6">
        <h3 className={BLOCK_HEADING_CLASS}>已确认凭证信息</h3>
        <p className={BLOCK_NOTE_CLASS}>
          来自上方「识别结果核对」中你已确认的凭证字段，不是模型识别结果，也不代表事实已被独立验证。
        </p>

        {hasConfirmedFields ? (
          <ul className="mt-2 space-y-1.5">
            {analysisInput.confirmedFields.map((field) => (
              <li key={field.key} className={ROW_CLASS}>
                <span className={ROW_LABEL_CLASS}>{field.label}</span>
                <span className={ROW_VALUE_CLASS}>{field.value}</span>
                <span className="text-xs text-slate-500">
                  来源：{SOURCE_LABELS[field.source]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={EMPTY_TEXT_CLASS}>暂无已确认的凭证字段</p>
        )}
      </div>

      {/* ---------- 2. 用户填写内容 ---------- */}
      <div className="mt-6">
        <h3 className={BLOCK_HEADING_CLASS}>用户填写内容</h3>
        <p className={BLOCK_NOTE_CLASS}>
          来源：用户填写。这些是你自己写下的陈述，不属于凭证字段，也不代表事实已被独立验证。
        </p>

        {hasUserCaseContent ? (
          <dl className="mt-2 space-y-1.5">
            {userCaseRows.map((row) => (
              <div key={row.name} className={ROW_CLASS}>
                <dt className={ROW_LABEL_CLASS}>{row.name}</dt>
                <dd
                  className={
                    row.value === null
                      ? 'min-w-0 flex-1 break-words text-sm text-slate-400'
                      : ROW_VALUE_CLASS
                  }
                >
                  {row.value ?? '暂未填写'}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={EMPTY_TEXT_CLASS}>暂未填写用户陈述</p>
        )}
      </div>

      {/* ---------- 3. 当前输入缺口 ---------- */}
      <div className="mt-6">
        <h3 className={BLOCK_HEADING_CLASS}>当前输入缺口</h3>
        <p className={BLOCK_NOTE_CLASS}>
          以下只列出还不能作为确定输入的部分，分项说明，不合并成笼统的「资料不足」。
        </p>

        {/* 3.1 凭证字段阻塞 */}
        {analysisInput.blockers.length > 0 ? (
          <SubBlock heading="凭证字段阻塞">
            <ul className="space-y-1">
              {analysisInput.blockers.map((blocker) => (
                <BlockerLine key={`${blocker.key}-${blocker.reason}`} blocker={blocker} />
              ))}
            </ul>
          </SubBlock>
        ) : null}

        {/* 3.2 已确认未知 */}
        {analysisInput.confirmedUnknown.length > 0 ? (
          <SubBlock heading="已确认未知">
            <ul className="space-y-1">
              {analysisInput.confirmedUnknown.map((field) => (
                <li key={field.key} className="text-sm text-slate-700">
                  <span className="font-medium text-slate-800">{field.label}</span>
                  <span className="text-slate-500"> — 你已确认这一项未知</span>
                </li>
              ))}
            </ul>
          </SubBlock>
        ) : null}

        {/* 3.3 尚未确认的字段（已排除上方「凭证字段阻塞」覆盖的必需字段） */}
        {displayUnresolved.length > 0 ? (
          <SubBlock heading="尚未确认的字段">
            <ul className="space-y-1">
              {displayUnresolved.map((field) => (
                <li key={field.key} className="text-sm text-slate-700">
                  <span className="font-medium text-slate-800">{field.label}</span>
                  <span className="text-slate-500">
                    {' '}
                    — {field.reason === 'NOT_CONFIRMED' ? '尚未确认' : '内容为空'}
                  </span>
                </li>
              ))}
            </ul>
          </SubBlock>
        ) : null}

        {/*
          说明：这里只列凭证字段自身的三类缺口。
          「可选信息提示」与「材料补充建议」由上方 4.2d 区块负责，本模块不重复展示。
        */}

        {/*
          全部为空时的兜底：不编造缺口，如实说明没有待补项。
          这里的判断必须与上面三个小节**实际渲染的数组**一致——
          用 displayUnresolved 而非 analysisInput.unresolved，
          否则当未确认字段全部已被阻塞列表覆盖时，会出现
          「三个小节都不显示，却也不说没有待补项」的空档。
        */}
        {analysisInput.blockers.length === 0 &&
        analysisInput.confirmedUnknown.length === 0 &&
        displayUnresolved.length === 0 ? (
          <p className={EMPTY_TEXT_CLASS}>当前没有待补充的凭证输入项</p>
        ) : null}
      </div>

      <p className="mt-6 border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-500">
        本区块只在当前页面内做整理，内容不会被上传，也不会发送给任何接口；刷新页面后这些整理结果即重新计算。
      </p>
    </section>
  );
}
