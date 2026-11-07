'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { extractMockResult } from '@/lib/extract-api';
import {
  CONFIDENCE_LABELS,
  SOURCE_LABELS,
  type ExtractedField,
} from '@/types/extraction';

/**
 * 阶段 4.2c-2：**本地 mock 识别**区域（独立组件）。
 *
 * 与 4.2a 的「fixture 样例核对」严格分开：
 *   · 本组件自己的状态、自己的数据，**不读写 4.2a 的任何状态**；
 *   · 结果**不传入** `ExtractionReview`，也不复用 fixture 常量；
 *   · 只请求本机相对路径 `/api/extract`，**未调用任何模型**。
 *
 * 明确不做：文件上传、Base64、图片预览、PDF、字段编辑、确认持久化、
 * 真实模型调用、数据库存储。
 *
 * 状态机（仅本区域）：
 *   idle ──点击──▶ loading ──成功──▶ success
 *                    └────失败────▶ error ──再次点击──▶ loading
 */

/** 本区域的四种状态。 */
type Phase = 'idle' | 'loading' | 'success' | 'error';

export default function MockExtractionPreview() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>('');

  /** 组件是否仍挂载：卸载后不再更新状态，避免 React 警告。 */
  const mountedRef = useRef<boolean>(true);
  /** 是否已有请求在飞：用于防重复点击（state 更新是异步的，ref 更可靠）。 */
  const runningRef = useRef<boolean>(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleRun = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    setPhase('loading');
    setFields([]);
    setErrorMessage('');

    let outcome;
    try {
      outcome = await extractMockResult();
    } finally {
      runningRef.current = false;
    }

    // 组件已卸载：不再 setState
    if (!mountedRef.current) return;

    if (outcome.ok) {
      setFields(outcome.fields);
      setPhase('success');
      return;
    }

    setErrorMessage(outcome.message);
    setPhase('error');
  }, []);

  const isLoading = phase === 'loading';

  return (
    <section
      aria-labelledby="mock-extraction-heading"
      className="mt-8 rounded-lg border border-slate-200 bg-white p-4 sm:p-5"
    >
      <h2
        id="mock-extraction-heading"
        className="text-base font-semibold text-slate-900 sm:text-lg"
      >
        本地 mock 识别
      </h2>

      {/* ---------- 边界说明：必须醒目、必须出现「未调用模型」 ---------- */}
      <div
        role="note"
        className="mt-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700"
      >
        <p className="font-semibold">仅验证本地数据流，未调用模型。</p>
        <p className="mt-1">
          点击按钮只会请求本机的{' '}
          <code className="rounded bg-slate-200 px-1 py-0.5 text-xs">/api/extract</code>{' '}
          接口，返回的是页面内置的<strong className="font-semibold">合成测试数据</strong>，
          不是真实凭证的识别结果，也不会上传任何文件。
        </p>
      </div>

      {/* ---------- 操作区 ---------- */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleRun}
          disabled={isLoading}
          aria-busy={isLoading}
          className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300 disabled:text-slate-600"
        >
          {isLoading ? '处理中…' : '运行 mock 识别'}
        </button>

        {/* 该接口不接收任何文件，这里也不提供任何上传入口 */}
        <p className="text-xs text-slate-500">无需上传文件（本接口不接收图片）</p>
      </div>

      {/* ---------- 状态播报：屏幕阅读器与视觉用户共用同一段文本 ---------- */}
      <p aria-live="polite" className="mt-3 text-sm text-slate-600">
        {phase === 'idle' && '尚未运行。'}
        {phase === 'loading' && '处理中…'}
        {phase === 'success' && '已完成（本地 mock 数据）。'}
        {phase === 'error' && '调用失败。'}
      </p>

      {/* ---------- 错误状态 ---------- */}
      {phase === 'error' && (
        <div
          role="alert"
          className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-900"
        >
          <p className="font-semibold">未能取得 mock 识别结果</p>
          <p className="mt-1">{errorMessage}</p>
          <p className="mt-1 text-xs">可以再次点击上方按钮重试。</p>
        </div>
      )}

      {/* ---------- 成功状态：五个字段 ---------- */}
      {phase === 'success' && (
        <div className="mt-4">
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-slate-500">数据来源</dt>
              <dd className="mt-0.5 break-words text-slate-800">
                {SOURCE_LABELS.mock}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">字段数量</dt>
              <dd className="mt-0.5 text-slate-800">{fields.length} 个</dd>
            </div>
          </dl>

          <ul className="mt-3 space-y-3">
            {fields.map((field) => (
              <li
                key={field.key}
                className="rounded-md border border-slate-200 p-3 sm:p-4"
              >
                <p className="text-sm font-semibold text-slate-900">
                  {field.label}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {field.key}
                  </span>
                </p>

                {/* 值：null 明确显示为「未提供」，绝不补造内容 */}
                {field.value === null ? (
                  <p className="mt-1 text-sm font-medium text-slate-500">未提供</p>
                ) : (
                  <p
                    className={`mt-1 text-sm text-slate-800 ${
                      field.key === 'orderId' ? 'break-all' : 'break-words'
                    }`}
                  >
                    {field.value}
                  </p>
                )}

                {/*
                  来源 / 置信度 / 确认状态：全部以文本呈现，不只依赖颜色。
                  confidence 的 unknown 必须说明「不适用」，不能让人误以为
                  这是模型给出的置信度评估。
                */}
                <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                  <div className="flex items-center gap-1">
                    <dt className="font-medium text-slate-500">来源：</dt>
                    <dd>{SOURCE_LABELS[field.source]}</dd>
                  </div>
                  <div className="flex items-center gap-1">
                    <dt className="font-medium text-slate-500">置信度：</dt>
                    <dd>
                      {CONFIDENCE_LABELS[field.confidence]}
                      <span className="ml-1 text-slate-500">
                        （不适用，mock 数据未经模型评估）
                      </span>
                    </dd>
                  </div>
                  <div className="flex items-center gap-1">
                    <dt className="font-medium text-slate-500">状态：</dt>
                    <dd>{field.confirmed ? '已确认' : '未确认'}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>

          <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
            以上数值来自页面内置的合成测试数据，仅用于验证「页面 → 本地接口 → 页面」的数据流，
            不能作为任何凭证识别能力的证据。
          </p>
        </div>
      )}
    </section>
  );
}
