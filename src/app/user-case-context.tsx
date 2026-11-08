'use client';

import { useCallback, useMemo } from 'react';

import type {
  DesiredResolution,
  MerchantResponseStatus,
  UserCaseContext,
} from '@/types/user-case';
import {
  EMPTY_USER_CASE_CONTEXT,
  MERCHANT_RESPONSE_OPTIONS,
  RESOLUTION_OPTIONS,
  USER_CASE_LIMITS,
  getUserCaseContextStatus,
} from '@/types/user-case';

/**
 * 「用户事实陈述（你填写的内容）」— 独立的本地输入区域。
 *
 * ============================================================================
 * 这块区域是什么
 * ============================================================================
 * 让用户用自己的话把「事情经过 / 什么时候发现的 / 商家有没有回应 /
 * 希望怎么处理 / 手上还有哪些材料」记下来，方便后续整理。
 *
 * ============================================================================
 * 这块区域不是什么（重要）
 * ============================================================================
 *   · **不是**凭证提取结果 —— 这里没有图片、没有识别、没有模型；
 *   · **不是**「已确认事实」—— 只是用户自己写的陈述，事实是否成立另说；
 *   · **不是**权益分析或法律意见 —— 只记录「用户希望怎么处理」，不判断能否实现；
 *   · 不进入 `AnalysisInputResult`，不改变 `ready` / `blockers`，
 *     也不影响 4.2a 的 fixture 与 4.2c 的 mock 区域；
 *   · 不调用模型、不发网络请求、不读环境变量、不写任何存储，
 *     刷新页面即丢失（本轮刻意不做持久化）。
 *
 * 状态由父组件（`page.tsx`）持有，本组件只接收当前值并通过 `onContextChange`
 * 把更新后的**完整对象**写回，自己不保留副本——避免出现两份可能不一致的 state。
 */

/** 本组件的 props：受控输入。 */
type UserCaseContextSectionProps = {
  /** 当前用户陈述（完整对象）。 */
  context: UserCaseContext;
  /** 写回更新后的完整对象。支持函数式更新，行为与原 `useState` 一致。 */
  onContextChange: React.Dispatch<React.SetStateAction<UserCaseContext>>;
};

/** 单选项的渲染配置，避免两组单选各写一遍重复的 JSX。 */
type RadioOption<T extends string> = {
  value: T;
  label: string;
};

/** 一组单选按钮。用 fieldset/legend 保证键盘与读屏可用。 */
function RadioGroup<T extends string>({
  name,
  legend,
  hint,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  hint?: string;
  options: ReadonlyArray<RadioOption<T>>;
  value: T | '';
  onChange: (next: T) => void;
}) {
  const hintId = hint ? `${name}-hint` : undefined;

  return (
    <fieldset aria-describedby={hintId}>
      <legend className="text-sm font-medium text-slate-800">{legend}</legend>
      {hint ? (
        <p id={hintId} className="mt-1 text-xs leading-relaxed text-slate-500">
          {hint}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => {
          const inputId = `${name}-${option.value}`;
          return (
            <label
              key={option.value}
              htmlFor={inputId}
              className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-slate-700"
            >
              <input
                type="radio"
                id={inputId}
                name={name}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                className="h-4 w-4 accent-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** 文本域的公共样式：与页面其他卡片内的输入风格保持一致。 */
const TEXTAREA_CLASS =
  'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';

/** 输入框（单行）样式。 */
const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';

/** 字数计数器的样式。 */
const COUNTER_CLASS = 'mt-1 text-right text-xs text-slate-500';

/** 次要按钮（清空）的样式，与 4.2a 的次要按钮保持一致。 */
const CLEAR_BUTTON_CLASS =
  'field-action-button rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

export default function UserCaseContextSection({
  context,
  onContextChange,
}: UserCaseContextSectionProps) {
  /**
   * 填写进度。
   *
   * 这里展示的「已填写 X 项」是**用户输入进度**，
   * 与凭证字段的 `AnalysisInputResult.ready` 是两个互不相干的概念。
   */
  const status = useMemo(() => getUserCaseContextStatus(context), [context]);

  /**
   * 事情经过：超过 500 字的部分直接截断，
   * 保证粘贴超长内容也不会突破字数限制。
   */
  const handleIncidentChange = useCallback((value: string) => {
    onContextChange((prev) => ({
      ...prev,
      incidentDescription: value.slice(0, USER_CASE_LIMITS.incidentDescription),
    }));
  }, [onContextChange]);

  /**
   * 发现问题的时间或阶段：**不设字数上限**（也可能不设日期格式要求），
   * 但仍去掉首尾空白以免只输入空格被当成已填写。
   * 这里保留原样输入，只做长度上的温和约束，避免异常长文本撑坏界面。
   */
  const handleDiscoveredChange = useCallback((value: string) => {
    onContextChange((prev) => ({ ...prev, issueDiscoveredAt: value.slice(0, 100) }));
  }, [onContextChange]);

  /** 证据材料情况：最多 300 字。 */
  const handleEvidenceChange = useCallback((value: string) => {
    onContextChange((prev) => ({
      ...prev,
      evidenceNotes: value.slice(0, USER_CASE_LIMITS.evidenceNotes),
    }));
  }, [onContextChange]);

  /** 商家回应摘要：仅在「已回应」时才有意义。 */
  const handleMerchantSummaryChange = useCallback((value: string) => {
    onContextChange((prev) => ({
      ...prev,
      merchantResponseSummary: value.slice(0, USER_CASE_LIMITS.merchantResponseSummary),
    }));
  }, [onContextChange]);

  /** 其他处理诉求：仅在选了「其他」时才有意义。 */
  const handleOtherResolutionChange = useCallback((value: string) => {
    onContextChange((prev) => ({
      ...prev,
      desiredResolutionOther: value.slice(0, USER_CASE_LIMITS.desiredResolutionOther),
    }));
  }, [onContextChange]);

  /**
   * 切换商家回应状态。
   *
   * 离开「已回应」时把摘要清空——否则会出现「摘要不算数却仍占着字数/统计」的
   * 隐性状态：用户看不到那个输入框，却还在计数里。清空让界面与数据一致。
   */
  const handleMerchantStatusChange = useCallback((next: MerchantResponseStatus) => {
    onContextChange((prev) => ({
      ...prev,
      merchantResponseStatus: next,
      merchantResponseSummary: next === 'responded' ? prev.merchantResponseSummary : '',
    }));
  }, [onContextChange]);

  /**
   * 切换处理诉求。
   *
   * 同理：离开「其他」时清空补充说明，避免隐藏字段继续计入填写进度。
   */
  const handleResolutionChange = useCallback((next: DesiredResolution) => {
    onContextChange((prev) => ({
      ...prev,
      desiredResolution: next,
      desiredResolutionOther: next === 'other' ? prev.desiredResolutionOther : '',
    }));
  }, [onContextChange]);

  /** 清空全部本地字段，恢复到初始的「尚未填写」。不影响其他任何区域。 */
  const handleClear = useCallback(() => {
    onContextChange(EMPTY_USER_CASE_CONTEXT);
  }, [onContextChange]);

  const showMerchantSummary = context.merchantResponseStatus === 'responded';
  const showOtherResolution = context.desiredResolution === 'other';

  return (
    <section
      aria-labelledby="user-case-heading"
      className="mt-8 rounded-lg border border-slate-200 bg-white p-4 sm:p-5"
    >
      <h2
        id="user-case-heading"
        className="text-base font-semibold text-slate-900 sm:text-lg"
      >
        用户事实陈述（你填写的内容）
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        以下内容由你填写，仅作为后续信息整理参考，不是凭证提取结果，也不代表事实已被独立验证。
      </p>

      {/* ---------- 填写进度（独立于凭证字段的 ready） ---------- */}
      {/*
        只显示「已填写 X 项」，不显示分母。
        原因：其中「其他处理诉求」是条件项，未选「其他」时天然拿不到，
        分母会随选择浮动，容易让人误以为「还差一项没填完」。
        另外这里刻意不说「已完成 / 填写完整 / 资料齐全」——
        filled 只代表填写过至少一项，不代表内容完整，也不代表事实已验证。
      */}
      <p
        role="status"
        aria-live="polite"
        className="mt-3 inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"
      >
        {status.filled ? `已填写 ${status.filledCount} 项` : '尚未填写'}
      </p>

      {/* ---------- 1. 事情经过 ---------- */}
      <div className="mt-4">
        <label htmlFor="user-case-incident" className="text-sm font-medium text-slate-800">
          事情经过
        </label>
        <textarea
          id="user-case-incident"
          rows={4}
          value={context.incidentDescription}
          onChange={(event) => handleIncidentChange(event.target.value)}
          maxLength={USER_CASE_LIMITS.incidentDescription}
          aria-describedby="user-case-incident-counter"
          placeholder="用自己的话写清楚发生了什么即可，不必写得很正式。"
          className={TEXTAREA_CLASS}
        />
        <p id="user-case-incident-counter" className={COUNTER_CLASS}>
          {context.incidentDescription.length} / {USER_CASE_LIMITS.incidentDescription} 字
        </p>
      </div>

      {/* ---------- 2. 发现问题的时间或阶段 ---------- */}
      <div className="mt-3">
        <label htmlFor="user-case-discovered" className="text-sm font-medium text-slate-800">
          发现问题的时间或阶段
        </label>
        <input
          id="user-case-discovered"
          type="text"
          value={context.issueDiscoveredAt}
          onChange={(event) => handleDiscoveredChange(event.target.value)}
          aria-describedby="user-case-discovered-hint"
          placeholder="例如：10 月 15 日收到货当天"
          className={INPUT_CLASS}
        />
        <p id="user-case-discovered-hint" className="mt-1 text-xs leading-relaxed text-slate-500">
          写不确定也可以，例如「不清楚」「记不清」。这里不会把你的原文当成日期解析。
        </p>
      </div>

      {/* ---------- 3. 商家是否回应 ---------- */}
      <div className="mt-3">
        <RadioGroup
          name="user-case-merchant-status"
          legend="商家是否回应"
          options={MERCHANT_RESPONSE_OPTIONS}
          value={context.merchantResponseStatus}
          onChange={handleMerchantStatusChange}
        />
      </div>

      {/* ---------- 4. 商家回应摘要（仅「已回应」时显示） ---------- */}
      {showMerchantSummary ? (
        <div className="mt-3">
          <label htmlFor="user-case-merchant-summary" className="text-sm font-medium text-slate-800">
            商家回应摘要
          </label>
          <textarea
            id="user-case-merchant-summary"
            rows={3}
            value={context.merchantResponseSummary}
            onChange={(event) => handleMerchantSummaryChange(event.target.value)}
            maxLength={USER_CASE_LIMITS.merchantResponseSummary}
            aria-describedby="user-case-merchant-summary-counter"
            placeholder="商家大致怎么说的？照原意写即可。"
            className={TEXTAREA_CLASS}
          />
          <p id="user-case-merchant-summary-counter" className={COUNTER_CLASS}>
            {context.merchantResponseSummary.length} / {USER_CASE_LIMITS.merchantResponseSummary} 字
          </p>
        </div>
      ) : null}

      {/* ---------- 5. 希望如何处理 ---------- */}
      <div className="mt-3">
        <RadioGroup
          name="user-case-resolution"
          legend="希望如何处理"
          hint="请选择你希望记录的处理方式。这只是你当前填写的期望，不代表结果一定能够实现。"
          options={RESOLUTION_OPTIONS}
          value={context.desiredResolution}
          onChange={handleResolutionChange}
        />
      </div>

      {/* ---------- 6. 其他处理诉求（仅选「其他」时显示） ---------- */}
      {showOtherResolution ? (
        <div className="mt-3">
          <label htmlFor="user-case-resolution-other" className="text-sm font-medium text-slate-800">
            其他处理诉求
          </label>
          <textarea
            id="user-case-resolution-other"
            rows={2}
            value={context.desiredResolutionOther}
            onChange={(event) => handleOtherResolutionChange(event.target.value)}
            maxLength={USER_CASE_LIMITS.desiredResolutionOther}
            aria-describedby="user-case-resolution-other-counter"
            placeholder="简单写一下你希望的处理方式。"
            className={TEXTAREA_CLASS}
          />
          <p id="user-case-resolution-other-counter" className={COUNTER_CLASS}>
            {context.desiredResolutionOther.length} / {USER_CASE_LIMITS.desiredResolutionOther} 字
          </p>
        </div>
      ) : null}

      {/* ---------- 7. 证据材料情况 ---------- */}
      <div className="mt-3">
        <label htmlFor="user-case-evidence" className="text-sm font-medium text-slate-800">
          证据材料情况
        </label>
        <textarea
          id="user-case-evidence"
          rows={3}
          value={context.evidenceNotes}
          onChange={(event) => handleEvidenceChange(event.target.value)}
          maxLength={USER_CASE_LIMITS.evidenceNotes}
          aria-describedby="user-case-evidence-hint user-case-evidence-counter"
          placeholder="手上有哪些材料，写个大概就行。"
          className={TEXTAREA_CLASS}
        />
        <p id="user-case-evidence-hint" className="mt-1 text-xs leading-relaxed text-slate-500">
          例如：付款凭证、订单记录、聊天记录、图片或其他材料。这里不需要上传文件。
        </p>
        <p id="user-case-evidence-counter" className={COUNTER_CLASS}>
          {context.evidenceNotes.length} / {USER_CASE_LIMITS.evidenceNotes} 字
        </p>
      </div>

      {/* ---------- 清空 ---------- */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleClear}
          disabled={!status.filled}
          className={CLEAR_BUTTON_CLASS}
        >
          清空以上内容
        </button>
        <p className="text-xs leading-relaxed text-slate-500">
          清空只影响本区域的本地内容，不会改动上方的凭证字段与本地 mock 识别结果。
        </p>
      </div>

      {/* ---------- 底部边界说明 ---------- */}
      <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
        以上内容为你填写的陈述，不代表事实已被独立验证，也不构成法律意见。
        这些文字仅保存在当前页面中，刷新即丢失，不会上传、不会发送给任何接口。
      </p>
    </section>
  );
}
