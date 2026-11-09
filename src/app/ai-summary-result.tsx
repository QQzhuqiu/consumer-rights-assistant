'use client';

/**
 * 「AI 事实整理摘要」区块（阶段 7）。
 *
 * ============================================================================
 * 本文件同时承担两件事（说明在此，避免文件名引起误解）
 * ============================================================================
 *   1. 这一区块的**外壳与状态**：标题、说明、触发按钮、确认对话框的开合、
 *      请求状态，以及结果的只读展示（文件名 `-result` 指的是它主要负责的部分）；
 *   2. 从页面已有的 `fields` / `userContext` **派生**发送内容，不复制页面状态。
 *
 * 之所以把外壳放在这里而不是 `page.tsx`，是为了让页面只需要多一行接入，
 * 不把 AI 相关的状态与请求逻辑塞进首页。
 *
 * ============================================================================
 * 数据流向（每一步都必须是用户主动触发的）
 * ============================================================================
 *   用户点击「查看发送内容并生成」
 *     → 打开确认对话框，逐条列出将要发送的文本（此时**尚未发送任何数据**）
 *     → 用户勾选要发送的陈述栏，点击「确认发送」
 *     → 请求同源服务端接口 `/api/summarize`（密钥与模型只在服务端）
 *     → 结果只写入本组件 state，**只读展示**
 *
 * 严格边界：
 *   · 页面加载、字段变更、勾选变更都**不会**发起请求；
 *   · 结果**不写回** `fields` 或 `userContext`，不替用户确认任何字段；
 *   · 不持久化——刷新页面后结果清空；
 *   · 不显示准确率、耗时或费用承诺；
 *   · 不把结果称为「法律分析」或「权益分析」。
 */

import { useCallback, useMemo, useState } from 'react';

import {
  AI_SUMMARY_FALLBACK_MESSAGE,
  buildLocalSummary,
} from '@/lib/ai-summary-local';
import { FACT_TIMELINE_STATUS_LABELS, buildFactTimeline } from '@/lib/fact-timeline';
import { buildMaterialChecklist } from '@/lib/material-checklist';
import {
  AI_SUMMARY_SENDABLE_FIELD_KEYS,
  AI_SUMMARY_SOURCE_LABELS,
  AI_SUMMARY_USER_CONTEXT_KEYS,
} from '@/types/ai-summary';
import type {
  AISummaryConfirmedField,
  AISummaryInput,
  AISummaryResult,
  AISummaryUserContextKey,
} from '@/types/ai-summary';
import type { ExtractedField } from '@/types/extraction';
import type { UserCaseContext } from '@/types/user-case';

import AISummaryConfirmDialog from './ai-summary-confirm-dialog';

type AISummarySectionProps = {
  /** 页面上的凭证字段（只读取，绝不写回）。 */
  fields: ExtractedField[];
  /** 页面上的用户陈述（只读取，绝不写回）。 */
  userContext: UserCaseContext;
};

/**
 * 时间线条目 → 对应的用户陈述键。
 *
 * `null` 表示该条目来自凭证字段（只有已确认的交易日期才会出现）。
 * 这个映射用于**只发送用户勾选过的内容**：
 * 没勾选「事情经过」时，时间线里的「事情经过」条目也不能被发送出去。
 */
const TIMELINE_USER_KEY: Record<string, AISummaryUserContextKey | null> = {
  'transaction-date': null,
  'issue-discovered': 'issueDiscoveredAt',
  'incident-description': 'incidentDescription',
  'merchant-response': 'merchantResponseSummary',
};

/** 只有已确认且有值的凭证字段才允许发送，且订单号不在范围内。 */
function pickConfirmedFields(fields: ExtractedField[]): AISummaryConfirmedField[] {
  const allowed = new Set<string>(AI_SUMMARY_SENDABLE_FIELD_KEYS);
  const picked: AISummaryConfirmedField[] = [];
  for (const field of fields) {
    if (!allowed.has(field.key)) continue;
    if (!field.confirmed) continue;
    const value = field.value;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed === '') continue;
    picked.push({ key: field.key, label: field.label, value: trimmed });
  }
  return picked;
}

/** 窄范围判断：非 null、非数组的对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 只接受字符串数组；含非字符串项即视为不可信。 */
function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    result.push(item);
  }
  return result;
}

/**
 * 校验服务端返回的结果结构。
 *
 * 服务端返回值同样按**不可信输入**处理：结构不符就退回本地整理结果，
 * 绝不把未校验的内容直接渲染。
 */
function readResult(value: unknown): AISummaryResult | null {
  if (!isRecord(value)) return null;

  const source = value.source;
  if (source !== 'ai' && source !== 'local') return null;

  const summary = value.summary;
  if (typeof summary !== 'string' || summary.trim() === '') return null;

  const knownInfo = toStringArray(value.knownInfo);
  const unknownInfo = toStringArray(value.unknownInfo);
  const suggestions = toStringArray(value.suggestions);
  if (knownInfo === null || unknownInfo === null || suggestions === null) {
    return null;
  }

  const result: AISummaryResult = {
    summary,
    knownInfo,
    unknownInfo,
    suggestions,
    source,
  };

  if (typeof value.model === 'string') result.model = value.model;
  if (typeof value.generatedAt === 'string') result.generatedAt = value.generatedAt;
  if (typeof value.message === 'string') result.message = value.message;

  return result;
}

export default function AISummarySection({
  fields,
  userContext,
}: AISummarySectionProps) {
  /** 确认对话框是否打开。 */
  const [dialogOpen, setDialogOpen] = useState(false);
  /** 是否正在请求。 */
  const [loading, setLoading] = useState(false);
  /** 结果：只存在于本组件，刷新即清空。 */
  const [result, setResult] = useState<AISummaryResult | null>(null);
  /** 用户勾选要发送的陈述栏（默认全不勾选）。 */
  const [selectedKeys, setSelectedKeys] = useState<
    Partial<Record<AISummaryUserContextKey, boolean>>
  >({});

  /**
   * 将要发送的已确认凭证字段。
   *
   * 只读派生，不复制页面状态；`useMemo` 依赖真实的 `fields`。
   */
  const confirmedFields = useMemo(
    () => pickConfirmedFields(fields),
    [fields],
  );

  const toggleKey = useCallback((key: AISummaryUserContextKey) => {
    setSelectedKeys((previous) => ({
      ...previous,
      [key]: previous[key] !== true,
    }));
  }, []);

  /**
   * 按用户勾选构造发送输入。
   *
   * 关键点：派生内容（时间线、材料清单）也受勾选约束——
   * 没勾选 `evidenceNotes` 时，材料清单**整体不发送**，
   * 因为它的 `note` 会直接引用用户原文。否则勾选就形同虚设。
   */
  const buildInput = useCallback((): AISummaryInput => {
    const selected = selectedKeys;
    const sentContext: Partial<Record<AISummaryUserContextKey, string>> = {};
    const skipped: AISummaryUserContextKey[] = [];

    for (const key of AI_SUMMARY_USER_CONTEXT_KEYS) {
      const raw = userContext[key];
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (trimmed === '') continue; // 空的既不发送，也不记为"跳过"
      if (selected[key] === true) {
        sentContext[key] = trimmed;
      } else {
        skipped.push(key);
      }
    }

    const timeline = buildFactTimeline(fields, userContext)
      .filter((item) => {
        const userKey = TIMELINE_USER_KEY[item.id] ?? null;
        if (userKey === null) return true; // 凭证字段来源
        return sentContext[userKey] !== undefined;
      })
      .map((item) => ({
        label: item.label,
        value: item.value,
        source: item.source,
        status: FACT_TIMELINE_STATUS_LABELS[item.status],
      }));

    // 材料清单的 note 会引用原文，因此只有勾选「证据材料情况」时才发送
    const materials =
      sentContext.evidenceNotes === undefined
        ? []
        : buildMaterialChecklist(userContext).map((item) => ({
            label: item.label,
            note: item.note,
            status: item.status,
          }));

    return {
      confirmedFields,
      userContext: sentContext,
      userSkippedKeys: skipped,
      timeline,
      materials,
    };
  }, [confirmedFields, fields, selectedKeys, userContext]);

  /** 请求服务端生成摘要；任何失败都退回本地整理结果。 */
  const handleConfirm = useCallback(async () => {
    const input = buildInput();
    setLoading(true);

    try {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (response.ok && isRecord(body) && body.success === true) {
        const parsed = readResult(body.result);
        if (parsed !== null) {
          setResult(parsed);
          setDialogOpen(false);
          return;
        }
      }

      // 服务端拒绝或返回结构不符：显示本地整理结果，并说明原因
      setResult(buildLocalSummary(input, AI_SUMMARY_FALLBACK_MESSAGE));
      setDialogOpen(false);
    } catch {
      // 网络层失败：本地整理结果，绝不声称"已生成降级摘要"
      setResult(buildLocalSummary(input, AI_SUMMARY_FALLBACK_MESSAGE));
      setDialogOpen(false);
    } finally {
      setLoading(false);
    }
  }, [buildInput]);

  const handleCancel = useCallback(() => {
    if (loading) return;
    setDialogOpen(false);
  }, [loading]);

  const sourceLabel = result === null ? null : AI_SUMMARY_SOURCE_LABELS[result.source];

  return (
    <section
      aria-labelledby="ai-summary-heading"
      className="mt-8 rounded-lg border border-slate-200 bg-white p-4 sm:p-5"
    >
      <h2
        id="ai-summary-heading"
        className="text-base font-semibold text-slate-900 sm:text-lg"
      >
        AI 事实整理摘要
      </h2>

      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        把你已经确认的凭证字段和填写的事实陈述，交给官方 DeepSeek 文本接口整理成一份摘要，
        并列出还缺少哪些信息。
      </p>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        这是<strong className="font-semibold">信息整理</strong>，不是法律分析，
        也不判断谁对谁错。结果只在本页面展示，
        <strong className="font-semibold">不会修改你填写的任何内容</strong>。
      </p>

      {/* ---------- 未生成时的说明与触发按钮 ---------- */}
      {result === null ? (
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm leading-relaxed text-slate-700">
            当前还没有生成摘要。点击下面的按钮后，会先弹出一个确认界面，
            逐条列出将要发送的内容；只有你确认后才会真正发送。
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            默认只发送已确认的商家名称、商品或服务名称、金额、交易日期；
            订单号不发送，用户陈述需要你自己勾选，未确认的字段不会发送。
          </p>
          {/*
            主操作按钮：沿用项目既有的主操作配方（bg-slate-800 + 白色文字），
            与 extraction-review / mock-extraction-preview 里的主按钮同一套语言。
            这里只做了三件事：加深底色、加大点击区域（px-4 py-2.5）、提高字重（font-semibold）。
            「重新生成」使用完全相同的配方，保证两个主操作视觉一致。
          */}
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            disabled={loading}
            className="field-action-button mt-3 rounded-md bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:hover:bg-slate-300"
          >
            查看发送内容并生成
          </button>
        </div>
      ) : null}

      {/* ---------- 结果 ---------- */}
      {result !== null ? (
        <div className="mt-4 min-w-0">
          {/* 来源必须显示文字，不能只靠颜色 */}
          {/*
            flex 子项默认 min-width: auto，遇到不可断的长字符串时无法收缩，
            会把容器撑宽并溢出到父级之外；这里显式 min-w-0 允许收缩，
            再配合下面的 break-all 让模型标识在必要时断行。
          */}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                result.source === 'ai'
                  ? 'bg-sky-50 text-sky-700 ring-sky-200'
                  : 'bg-slate-100 text-slate-700 ring-slate-200'
              }`}
            >
              {sourceLabel}
            </span>
            {result.source === 'ai' && result.model !== undefined ? (
              <span className="min-w-0 break-all text-xs text-slate-500">
                模型：{result.model}
              </span>
            ) : null}
            {result.source === 'ai' && result.generatedAt !== undefined ? (
              <span className="min-w-0 text-xs text-slate-500">
                生成时间：{new Date(result.generatedAt).toLocaleString('zh-CN')}
              </span>
            ) : null}
          </div>

          {/* 说明 / 失败原因 */}
          {result.message !== undefined ? (
            <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900">
              {result.message}
            </p>
          ) : null}

          {/* 摘要正文 */}
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-900">摘要</p>
            <p className="mt-1.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-slate-700">
              {result.summary}
            </p>
          </div>

          {/* 已知信息 */}
          <div className="mt-3 rounded-md border border-slate-200 p-3">
            <p className="text-sm font-semibold text-slate-900">
              已整理的信息（含来源）
            </p>
            {result.knownInfo.length === 0 ? (
              <p className="mt-1.5 text-sm text-slate-600">（暂无）</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {result.knownInfo.map((item, index) => (
                  <li
                    key={`known-${index}`}
                    className="text-sm leading-relaxed break-words whitespace-pre-wrap text-slate-700"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 未知信息 */}
          <div className="mt-3 rounded-md border border-slate-200 p-3">
            <p className="text-sm font-semibold text-slate-900">
              尚未提供或未确认的信息
            </p>
            {result.unknownInfo.length === 0 ? (
              <p className="mt-1.5 text-sm text-slate-600">（暂无）</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {result.unknownInfo.map((item, index) => (
                  <li
                    key={`unknown-${index}`}
                    className="text-sm leading-relaxed break-words whitespace-pre-wrap text-slate-700"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 补充信息提示 */}
          <div className="mt-3 rounded-md border border-slate-200 p-3">
            <p className="text-sm font-semibold text-slate-900">
              可以补充的信息（仅限事实层面）
            </p>
            {result.suggestions.length === 0 ? (
              <p className="mt-1.5 text-sm text-slate-600">（暂无）</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {result.suggestions.map((item, index) => (
                  <li
                    key={`suggestion-${index}`}
                    className="text-sm leading-relaxed break-words whitespace-pre-wrap text-slate-700"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            disabled={loading}
            className="field-action-button mt-3 rounded-md bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:hover:bg-slate-300"
          >
            重新生成
          </button>
          <p className="mt-1 text-xs text-slate-500">
            每次生成都需要重新确认发送内容。
          </p>
        </div>
      ) : null}

      {/* ---------- 边界说明 ---------- */}
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        结果仅供信息整理参考，<strong className="font-semibold">不构成法律意见</strong>，
        也不代表事实已被核实、权益已经成立。刷新页面后结果清空，不保存任何内容。
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        本页不做自动个人信息识别或脱敏；是否需要发送某段自由文本，由你在确认界面自行决定。
      </p>

      {/* ---------- 确认对话框 ---------- */}
      {dialogOpen ? (
        <AISummaryConfirmDialog
          confirmedFields={confirmedFields}
          userContext={userContext}
          selectedKeys={selectedKeys}
          onToggleKey={toggleKey}
          onCancel={handleCancel}
          onConfirm={handleConfirm}
          loading={loading}
        />
      ) : null}
    </section>
  );
}
