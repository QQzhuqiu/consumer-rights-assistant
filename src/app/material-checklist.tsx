'use client';

/**
 * 材料记录清单（你填写的材料情况）—— 阶段 6 第二步。
 *
 * 本组件只做两件事：
 *   1. 按用户填写的原文，保守判断「原文里有没有提到某一类材料」；
 *   2. 提供一个**纯本地**的「已记录」勾选，方便用户自己核对。
 *
 * 严格边界：
 *   · 只读取页面传入的 `userContext`，不复制、不留快照、不建 Context；
 *   · 勾选状态是本组件的**本地 state**，不持久化，刷新即清空；
 *   · 不判断材料真伪、充分性、证明力或法律效力；
 *   · 不提示「必须提供」，不暗示缺材料就不能处理；
 *   · 不发请求、不上传、不调模型、不写存储。
 */

import { useMemo, useState } from 'react';

import type { UserCaseContext } from '@/types/user-case';
import {
  MATERIAL_STATUS_LABELS,
  buildMaterialChecklist,
} from '@/lib/material-checklist';

type MaterialChecklistProps = {
  userContext: UserCaseContext;
};

/** 状态徽标样式：只在「原文中提到」时用较重底色，但两边都有文字。 */
const STATUS_BADGE_CLASS: Record<'mentioned' | 'not_mentioned', string> = {
  mentioned: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  not_mentioned: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export default function MaterialChecklist({ userContext }: MaterialChecklistProps) {
  /**
   * 勾选状态：仅本地 UI 状态，不持久化、不参与任何判断。
   * 记录的是「在当前页面点过」，不是「材料真实存在」。
   */
  const [recorded, setRecorded] = useState<Record<string, boolean>>({});

  const items = useMemo(() => buildMaterialChecklist(userContext), [userContext]);

  const recordedCount = items.filter((item) => recorded[item.id] === true).length;

  return (
    <section
      aria-labelledby="material-checklist-heading"
      className="mt-8 rounded-lg border border-slate-200 bg-white p-4 sm:p-5"
    >
      <h2
        id="material-checklist-heading"
        className="text-base font-semibold text-slate-900 sm:text-lg"
      >
        材料记录清单（你填写的材料情况）
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        以下内容仅按当前页面输入整理，不代表事实已被独立验证。
      </p>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        这一栏只记录你在材料情况里<strong className="font-semibold">提到过什么</strong>，
        不判断材料是否充分或是否有效。
      </p>

      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-md border border-slate-200 bg-slate-50 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-900">
                <input
                  type="checkbox"
                  checked={recorded[item.id] === true}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setRecorded((previous) => ({
                      ...previous,
                      [item.id]: next,
                    }));
                  }}
                  className="h-4 w-4 shrink-0 rounded border-slate-300 accent-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700"
                />
                {item.label}
              </label>
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE_CLASS[item.status]}`}
              >
                {MATERIAL_STATUS_LABELS[item.status]}
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-slate-600">
              {item.note}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        「其他材料」只按你的原文展示，不会自动归到上面任何一类。
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        「已记录」只表示你在当前页面做了标记，
        <strong className="font-semibold">不代表材料真实性或法律效力</strong>；
        刷新页面后清空（当前共标记 {recordedCount} 项）。
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        「原文中未提到」只说明这次没写到，
        <strong className="font-semibold">不代表你没有这份材料</strong>，也不构成任何要求。
      </p>
    </section>
  );
}
