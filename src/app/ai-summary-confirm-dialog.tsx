'use client';

/**
 * 「发送前确认」对话框（阶段 7）。
 *
 * ============================================================================
 * 为什么必须先有这个对话框
 * ============================================================================
 * 调用外部模型意味着**数据离开本机**。因此发送之前必须让用户看到：
 *   · 到底哪些内容会被发送（逐条列出实际文本，不是只列标题）；
 *   · 哪些内容不会被发送；
 *   · 自由文本可能包含个人信息这一风险提示。
 *
 * 用户**必须主动点击「确认发送」**才会真正发起请求；
 * 点击「取消」或按 Escape 关闭都不发送任何数据。
 *
 * 严格边界：
 *   · 本组件不发起任何请求，只负责收集用户的选择并回调；
 *   · 不做自动 PII 识别，也不承诺脱敏——只如实提示风险；
 *   · 不读写任何存储，勾选状态由父组件持有。
 *
 * ============================================================================
 * 布局结构（为什么这样分三层）
 * ============================================================================
 *   遮罩层（fixed inset-0，全屏覆盖）
 *     └─ 视口盒 .dialog-viewport（height 100vh → 100dvh，含安全区内边距）
 *          └─ 弹窗面板（flex 纵向、max-h-full，高度永远不超过视口盒）
 *               ├─ 标题区（shrink-0，不滚动）——保证标题永远可见
 *               ├─ 滚动区 .dialog-scroll（min-h-0 + flex-1）——长内容在这里滚
 *               └─ 操作区（shrink-0，不滚动）——保证「确认发送 / 取消」永远可达
 *
 * 这样做的原因：
 *   · 旧实现把 `overflow-y-auto` 放在遮罩层上、并用 `items-center` 居中，
 *     当面板比视口高时，居中会把面板顶部推到滚动原点之上，顶部被裁切、
 *     标题看不到（这是 flex 居中 + 溢出的经典缺陷）；
 *   · 旧实现没有内部滚动容器，底部按钮只能靠滚动整个遮罩才够得到；
 *   · 旧实现没有锁背景，滚到弹窗边界会带动底层页面一起滚。
 */

import { useEffect, useRef } from 'react';

import {
  AI_SUMMARY_PRIVACY_NOTICE,
  AI_SUMMARY_USER_CONTEXT_KEYS,
  AI_SUMMARY_USER_CONTEXT_LABELS,
} from '@/types/ai-summary';
import type {
  AISummaryConfirmedField,
  AISummaryUserContextKey,
} from '@/types/ai-summary';
import type { UserCaseContext } from '@/types/user-case';
import { MERCHANT_RESPONSE_OPTIONS, RESOLUTION_OPTIONS } from '@/types/user-case';

type AISummaryConfirmDialogProps = {
  /** 将被发送的已确认凭证字段。 */
  confirmedFields: AISummaryConfirmedField[];
  /** 用户当前填写的完整陈述，用于展示可勾选的栏目。 */
  userContext: UserCaseContext;
  /** 用户已勾选要发送的陈述栏。 */
  selectedKeys: Partial<Record<AISummaryUserContextKey, boolean>>;
  /** 勾选切换回调。 */
  onToggleKey: (key: AISummaryUserContextKey) => void;
  /** 取消（不发送）。 */
  onCancel: () => void;
  /** 确认发送。 */
  onConfirm: () => void;
  /** 是否正在请求中。 */
  loading: boolean;
};

/**
 * 锁定背景滚动，并返回一个「精确还原」的释放函数。
 *
 * 关键点（避免污染页面上其它样式）：
 *   · 只保存**本函数会改动的那几个内联样式属性**，释放时逐个写回原值；
 *   · 原值为空字符串时也原样写回空字符串 —— 这等价于「恢复成原来的内联状态」，
 *     而不是把属性重置成某个默认值，因此不会误清掉页面其它地方写入的内联样式；
 *   · 打开时记录 `window.scrollY`，用 `position: fixed` + `top: -scrollY`
 *     把页面钉在当前滚动位置，释放时再 `scrollTo` 回到原位置；
 *   · 补偿滚动条宽度，避免锁定瞬间内容横向跳动；
 *   · 用 `released` 保证释放函数可被重复调用而无副作用（React 严格模式下
 *     开发期会挂载 → 卸载 → 再挂载，重复调用必须安全）。
 */
function lockPageScroll(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  const body = document.body;
  const root = document.documentElement;
  const scrollY = window.scrollY;

  const saved = {
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyLeft: body.style.left,
    bodyRight: body.style.right,
    bodyWidth: body.style.width,
    bodyOverflow: body.style.overflow,
    bodyPaddingRight: body.style.paddingRight,
    rootOverflow: root.style.overflow,
  };

  // 滚动条消失会让内容横向跳动，用等宽内边距补偿
  const scrollbarWidth = window.innerWidth - root.clientWidth;

  body.style.position = 'fixed';
  body.style.top = `-${scrollY}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
  body.style.overflow = 'hidden';
  if (scrollbarWidth > 0) {
    body.style.paddingRight = `${scrollbarWidth}px`;
  }
  root.style.overflow = 'hidden';

  let released = false;
  return () => {
    if (released) return;
    released = true;

    body.style.position = saved.bodyPosition;
    body.style.top = saved.bodyTop;
    body.style.left = saved.bodyLeft;
    body.style.right = saved.bodyRight;
    body.style.width = saved.bodyWidth;
    body.style.overflow = saved.bodyOverflow;
    body.style.paddingRight = saved.bodyPaddingRight;
    root.style.overflow = saved.rootOverflow;

    // 位置在样式还原之后恢复，否则 fixed 态下滚动无效
    window.scrollTo(0, scrollY);
  };
}

/** 把单选值翻译成中文标签，用于让用户确认到底会发送什么。 */
function optionLabel(
  key: AISummaryUserContextKey,
  raw: string,
): string {
  if (key === 'merchantResponseStatus') {
    return (
      MERCHANT_RESPONSE_OPTIONS.find((option) => option.value === raw)?.label ??
      raw
    );
  }
  if (key === 'desiredResolution') {
    return (
      RESOLUTION_OPTIONS.find((option) => option.value === raw)?.label ?? raw
    );
  }
  return raw;
}

/**
 * 某一栏当前是否有内容可发送。
 *
 * 两个条件性栏目只有在对应选择成立时才有意义：
 *   · 「商家回应摘要」需要先选「已回应」；
 *   · 「其他处理诉求」需要先选「其他」。
 */
function isSelectable(
  key: AISummaryUserContextKey,
  context: UserCaseContext,
): boolean {
  if (key === 'merchantResponseSummary') {
    return context.merchantResponseStatus === 'responded';
  }
  if (key === 'desiredResolutionOther') {
    return context.desiredResolution === 'other';
  }
  return true;
}

export default function AISummaryConfirmDialog({
  confirmedFields,
  userContext,
  selectedKeys,
  onToggleKey,
  onCancel,
  onConfirm,
  loading,
}: AISummaryConfirmDialogProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Escape 关闭：等同取消，不发送任何数据
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !loading) {
        onCancel();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel, loading]);

  // 挂载即「打开」：把滚动区归零，并锁住背景滚动。
  // 卸载（取消 / Escape / 确认后关闭 / 父组件移除）时自动释放，恢复原滚动位置。
  useEffect(() => {
    if (scrollRef.current !== null) {
      scrollRef.current.scrollTop = 0;
    }
    return lockPageScroll();
  }, []);

  const selectedCount = AI_SUMMARY_USER_CONTEXT_KEYS.filter(
    (key) => selectedKeys[key] === true,
  ).length;

  return (
    /* 遮罩：全屏覆盖；本身不响应点击关闭（当前实现也不支持遮罩关闭） */
    <div className="fixed inset-0 z-50 bg-slate-900/40">
      {/* 视口盒：高度被 100dvh 约束，内边距已含移动端安全区 */}
      <div className="dialog-viewport flex items-center justify-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-summary-confirm-heading"
          className="flex max-h-full w-full min-w-0 max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
        >
          {/* ---------- 标题区：始终可见 ---------- */}
          <div className="shrink-0 border-b border-slate-200 px-4 py-3 sm:px-5">
            <h3
              id="ai-summary-confirm-heading"
              className="text-base font-semibold break-words text-slate-900 sm:text-lg"
            >
              确认将要发送的内容
            </h3>
          </div>

          {/* ---------- 滚动区：只有这里滚动 ---------- */}
          <div
            ref={scrollRef}
            className="dialog-scroll min-w-0 flex-1 px-4 py-3 sm:px-5"
          >
            <p className="text-sm leading-relaxed break-words text-slate-600">
              点击「确认发送」后，下面列出的内容会被发送到
              <strong className="font-semibold">官方 DeepSeek 接口</strong>
              生成摘要。这一步<strong className="font-semibold">不会</strong>
              修改你的原始输入。
            </p>

            {/* ---------- 将发送：已确认凭证字段 ---------- */}
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">
                将发送的凭证字段（仅已确认）
              </p>
              {confirmedFields.length === 0 ? (
                <p className="mt-1.5 text-sm text-slate-600">
                  目前没有已确认的凭证字段，本次不会发送任何字段值。
                </p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {confirmedFields.map((field) => (
                    <li
                      key={field.key}
                      className="text-sm leading-relaxed break-words text-slate-700"
                    >
                      <span className="font-medium text-slate-900">
                        {field.label}：
                      </span>
                      {field.value}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ---------- 将发送：用户陈述（逐项勾选） ---------- */}
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">
                用户陈述（请选择要发送的栏目）
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                默认<strong className="font-semibold">一项都不发送</strong>，
                需要你自己勾选。已勾选 {selectedCount} 项。
              </p>

              <ul className="mt-2 space-y-2">
                {AI_SUMMARY_USER_CONTEXT_KEYS.map((key) => {
                  const raw = userContext[key];
                  const selectable = isSelectable(key, userContext);
                  const hasContent =
                    selectable && typeof raw === 'string' && raw.trim() !== '';
                  const checked = selectedKeys[key] === true;

                  return (
                    <li key={key} className="min-w-0 text-sm">
                      <label
                        className={`flex items-start gap-2 ${
                          hasContent && !loading
                            ? 'cursor-pointer'
                            : 'cursor-not-allowed'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked && hasContent}
                          disabled={!hasContent || loading}
                          onChange={() => onToggleKey(key)}
                          className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 accent-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700"
                        />
                        <span className="min-w-0">
                          <span className="font-medium text-slate-900">
                            {AI_SUMMARY_USER_CONTEXT_LABELS[key]}
                          </span>
                          {hasContent ? (
                            <span className="mt-0.5 block break-words whitespace-pre-wrap text-slate-700">
                              {optionLabel(key, raw)}
                            </span>
                          ) : (
                            <span className="mt-0.5 block text-slate-500">
                              {selectable ? '（未填写，无可发送内容）' : '（当前不适用）'}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* ---------- 不会发送 ---------- */}
            <div className="mt-3 rounded-md border border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-900">不会发送的内容</p>
              <ul className="mt-1.5 space-y-1 text-sm leading-relaxed break-words text-slate-600">
                <li>· 订单号（本轮不支持发送）</li>
                <li>· 未确认或未填写的凭证字段</li>
                <li>· 你没有勾选的用户陈述栏目</li>
                <li>· 你选择的凭证文件本身（文件始终只留在浏览器内，不会上传）</li>
              </ul>
            </div>

            {/* ---------- 隐私提示 ---------- */}
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">请注意个人信息</p>
              <p className="mt-1 text-sm leading-relaxed break-words text-amber-900">
                {AI_SUMMARY_PRIVACY_NOTICE}
              </p>
            </div>
          </div>

          {/* ---------- 操作区：始终可见、可点 ---------- */}
          <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className="field-action-button rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-slate-400 disabled:hover:bg-slate-400"
              >
                {loading ? '正在生成…' : '确认发送'}
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="field-action-button rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                取消
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {loading ? '请求进行中，请勿关闭页面。' : '取消不会发送任何数据。'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
