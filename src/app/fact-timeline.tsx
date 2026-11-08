'use client';

/**
 * 事实时间线（本地整理）—— 阶段 6 第一步。
 *
 * 本组件是**纯消费者**：
 *   · 只读取页面传入的 `fields` 与 `userContext`，不复制、不留快照、不建 Context；
 *   · 自身**不持有任何 state**（勾选类交互在材料清单里，这里没有）；
 *   · 不写回任何东西，不进入 `AnalysisInputResult`；
 *   · 不发请求、不上传、不调模型、不持久化。
 *
 * 它只把已有输入按条目摊开，**不推断事实、不推断日期、不推断事件先后**，
 * 也不生成任何法律结论或责任判断。
 */

import { useMemo } from 'react';

import type { ExtractedField } from '@/types/extraction';
import type { UserCaseContext } from '@/types/user-case';
import {
  EMPTY_TIMELINE_TEXT,
  FACT_TIMELINE_SOURCE_LABELS,
  FACT_TIMELINE_STATUS_LABELS,
  buildFactTimeline,
} from '@/lib/fact-timeline';

type FactTimelineProps = {
  fields: ExtractedField[];
  userContext: UserCaseContext;
};

/** 来源徽标样式：凭证字段与用户填写用不同底色，且始终带文字。 */
const SOURCE_BADGE_CLASS: Record<'evidence' | 'user', string> = {
  evidence: 'bg-slate-100 text-slate-700 ring-slate-200',
  user: 'bg-sky-50 text-sky-700 ring-sky-200',
};

export default function FactTimeline({ fields, userContext }: FactTimelineProps) {
  /**
   * 纯函数调用。依赖项只包含真实输入，避免无谓重算。
   * `buildFactTimeline` 不排序、不比较日期，返回顺序即为固定展示顺序。
   */
  const items = useMemo(
    () => buildFactTimeline(fields, userContext),
    [fields, userContext],
  );

  return (
    <section
      aria-labelledby="fact-timeline-heading"
      className="mt-8 rounded-lg border border-slate-200 bg-white p-4 sm:p-5"
    >
      <h2
        id="fact-timeline-heading"
        className="text-base font-semibold text-slate-900 sm:text-lg"
      >
        事实时间线（本地整理）
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        以下内容仅按当前页面输入整理，不代表事实已被独立验证。
      </p>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        时间未知或未提供时，保留当前原文，不进行推测。
      </p>

      {items.length === 0 ? (
        <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          {EMPTY_TIMELINE_TEXT}
        </p>
      ) : (
        <>
          <ol className="mt-4 space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-md border border-slate-200 bg-slate-50 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    {item.label}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${SOURCE_BADGE_CLASS[item.source]}`}
                  >
                    {FACT_TIMELINE_SOURCE_LABELS[item.source]}
                  </span>
                  <span className="rounded bg-white px-1.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                    {FACT_TIMELINE_STATUS_LABELS[item.status]}
                  </span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-slate-700">
                  {item.value}
                </p>
                {item.note === undefined ? null : (
                  <p className="mt-1 text-xs text-slate-500">{item.note}</p>
                )}
              </li>
            ))}
          </ol>

          {/*
            必须声明：条目顺序是固定展示顺序，不是时间先后结论。
            否则读者可能把「交易时间」在前误解为「交易发生在发现问题之前」。
          */}
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            条目按固定顺序展示，<strong className="font-semibold">不代表事件实际先后</strong>；
            这里不比较时间、不推断因果。
          </p>
        </>
      )}

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        「凭证字段」来自识别结果核对区中<strong className="font-semibold">已确认</strong>的字段；
        「用户填写」是你自己在事实陈述里写下的原文，两者不会混为一谈。
      </p>
    </section>
  );
}
