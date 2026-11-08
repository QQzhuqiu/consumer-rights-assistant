'use client';

import { useCallback, useRef, useState } from 'react';

import { createInitialFields } from '@/lib/extraction-fixture';
import type { ExtractedField } from '@/types/extraction';
import type { UserCaseContext } from '@/types/user-case';
import { EMPTY_USER_CASE_CONTEXT } from '@/types/user-case';

import EvidencePreview from './evidence-preview';
import ExtractionReview from './extraction-review';
import MockExtractionPreview from './mock-extraction-preview';
import OfflineAnalysisPreparation from './offline-analysis-preparation';
import UserCaseContextSection from './user-case-context';

type PlaceholderCard = {
  /** 卡片标题 */
  title: string;
  /** 一句话说明这项功能将来做什么 */
  summary: string;
  /** 该功能确定不做的事，用于事前划清边界 */
  boundary: string;
};

/**
 * 4 个静态功能占位卡片。
 *
 * 说明：本阶段只建立界面骨架，卡片为纯静态展示，**不含任何交互、表单、上传入口或数据请求**。
 * 所有卡片统一显示「即将推出」空状态。
 */
const PLACEHOLDER_CARDS: PlaceholderCard[] = [
  {
    title: '上传凭证',
    summary: '上传订单截图、支付记录、聊天记录等材料，用于后续整理事实。',
    boundary: '不会在未获确认前上传或外发任何文件。',
  },
  {
    title: '事实时间线',
    summary: '把材料中的关键节点整理成时间线，并标出证据缺口。',
    boundary: '不补写材料中没有的时间与情节。',
  },
  {
    title: '法规检索',
    summary: '从本地法规语料中检索相关条文，保留官方来源与生效状态。',
    boundary: '检索不到时明确显示「未找到相关法规」，不编造条号。',
  },
  {
    title: '材料草稿',
    summary: '基于已整理的事实与法条，生成沟通材料的草稿。',
    boundary: '只产出草稿，不代替用户提交投诉或签署文件。',
  },
];

/**
 * 首页。
 *
 * 为什么需要 'use client'：
 *   光晕需跟随鼠标在卡片内的位置。若用 React state 保存坐标，每次 pointermove 都会
 *   触发重渲染，鼠标移动越频繁开销越大，反而破坏「丝滑」手感。因此这里改用
 *   useRef 直接写入 CSS 自定义属性 --glow-x / --glow-y，浏览器只需重算该元素样式，
 *   不产生任何 React 重渲染。
 *
 * 卡片本身仍然是**非交互静态占位**：没有点击行为、没有路由、没有上传、没有 API 调用。
 */
export default function HomePage() {
  /**
   * 页面级业务状态（阶段 5 前置：状态提升）。
   *
   * 这两份 state 原本各自留在子组件内部，外部看不到。提升到这里是为了让
   * 同一层的后续消费者（如离线分析准备）能读到**真实**的当前状态，
   * 而不必复制一份可能过期的副本。
   *
   * 说明：
   *   · 这里持有的是**唯一一份**业务状态，子组件受控，不再自建副本；
   *   · 4.2c 的 mock 识别结果仍完全留在 `MockExtractionPreview` 内部，
   *     与本状态互不读写；
   *   · 纯内存，不持久化、不发请求、不调用模型。
   */

  /**
   * 凭证字段（4.2a）。
   *
   * 初始值用 `createInitialFields()` 而非直接引用 `EVIDENCE_FIXTURE.fields`：
   * 它每次返回与常量完全脱离的新数组与新对象，避免界面编辑污染共享样例。
   */
  const [fields, setFields] = useState<ExtractedField[]>(() => createInitialFields());

  /** 用户事实陈述（4.2e）。初始为全部空白，与凭证字段完全独立。 */
  const [userContext, setUserContext] =
    useState<UserCaseContext>(EMPTY_USER_CASE_CONTEXT);

  /** 每个卡片元素到其待处理 rAF 句柄的映射，用于 pointermove 合并节流 */
  const rafIdsRef = useRef<Map<HTMLElement, number>>(new Map());

  /**
   * 处理卡片内的指针移动：把指针位置换算成百分比写入 CSS 变量。
   * 使用 requestAnimationFrame 节流——同一帧内多次 pointermove 只写一次样式。
   */
  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLLIElement>) => {
    const element = event.currentTarget;
    const pending = rafIdsRef.current.get(element);
    // 同一帧内已有待处理任务则跳过，避免无谓的样式写入
    if (pending !== undefined) return;

    const { clientX, clientY } = event;

    const rafId = requestAnimationFrame(() => {
      rafIdsRef.current.delete(element);

      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const x = ((clientX - rect.left) / rect.width) * 100;
      const y = ((clientY - rect.top) / rect.height) * 100;

      // 直接写 CSS 变量，绕开 React 渲染流程
      element.style.setProperty('--glow-x', `${x.toFixed(2)}%`);
      element.style.setProperty('--glow-y', `${y.toFixed(2)}%`);
    });

    rafIdsRef.current.set(element, rafId);
  }, []);

  /** 指针离开卡片时取消尚未执行的 rAF，避免移出后光晕位置被延迟更新 */
  const handlePointerLeave = useCallback((event: React.PointerEvent<HTMLLIElement>) => {
    const element = event.currentTarget;
    const pending = rafIdsRef.current.get(element);
    if (pending !== undefined) {
      cancelAnimationFrame(pending);
      rafIdsRef.current.delete(element);
    }
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      {/* ---------- 页头：产品名称与简短说明 ---------- */}
      <header className="border-b border-slate-200 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          凭证明白 · AI消费权益助手
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 sm:text-base">
          面向普通消费者的消费纠纷事实整理与法规查证助手。
        </p>
      </header>

      {/* ---------- 首屏边界提示（本阶段最重要的信息） ---------- */}
      <section
        aria-labelledby="boundary-heading"
        className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 sm:p-5"
      >
        <h2
          id="boundary-heading"
          className="text-sm font-semibold text-amber-900 sm:text-base"
        >
          使用前请先了解
        </h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-amber-900">
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-1 shrink-0 font-semibold">
              ·
            </span>
            <span>
              AI 输出仅用于信息整理辅助，<strong className="font-semibold">不替代法律意见</strong>。
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-1 shrink-0 font-semibold">
              ·
            </span>
            <span>
              用户陈述、材料提取结果与 AI 推断<strong className="font-semibold">应明确区分</strong>，
              三者不会混为一谈。
            </span>
          </li>
        </ul>
      </section>

      {/* ---------- 阶段四：本地证据预览 ---------- */}
      <EvidencePreview />

      {/* ---------- 阶段 4.2a：fixture 样例核对（固定样例，未调用模型） ---------- */}
      <ExtractionReview fields={fields} onFieldsChange={setFields} />

      {/*
        ---------- 用户事实陈述（用户自己填写） ----------
        与上面两个区域严格独立：
          · 内容由用户手输，不是凭证提取结果，也不叫「已确认事实」；
          · 自己的 useState 状态，不读写 4.2a 的 fixture 与 4.2c 的 mock 结果；
          · 不进入 AnalysisInputResult，不改变 ready / blockers；
          · 不发请求、不上传文件、不做持久化。
      */}
      <UserCaseContextSection
        context={userContext}
        onContextChange={setUserContext}
      />

      {/*
        ---------- 阶段 5：离线分析准备（本地整理） ----------
        只读消费者，不持有 state、不写回任何东西：
          · 读取上面两处已提升到页面的**同一份** state，不复制、不留快照；
          · 完整性判定复用 analysis-input.ts 的既有函数，不另写规则；
          · 用户陈述不进入 AnalysisInputResult，也不混入凭证字段的 blockers；
          · 拿不到 4.2c 的 mock 结果，因此 mock 不参与任何计算；
          · 不发请求、不调模型、不上传、不持久化、不生成权益或法律结论。
      */}
      <OfflineAnalysisPreparation fields={fields} userContext={userContext} />

      {/*
        ---------- 阶段 4.2c-2：本地 mock 识别 ----------
        与上面两个区域严格独立：
          · 自己的状态、自己的数据，不读写 4.2a 的 fixture 状态；
          · 结果不传入 ExtractionReview；
          · 只请求本机相对路径 /api/extract，未调用任何模型。
      */}
      <MockExtractionPreview />

      {/* ---------- 4 个静态占位卡片 ---------- */}
      <section aria-labelledby="cards-heading" className="mt-8">
        <h2
          id="cards-heading"
          className="text-base font-semibold text-slate-900 sm:text-lg"
        >
          计划中的功能
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          下列功能均尚未实现，当前仅展示界面占位。
        </p>

        {/*
          响应式网格（Tailwind 默认断点）：
            · 默认（<768px）            → 单列
            · md:（≥768px）与 lg:（≥1024px）之间 → 单列，但卡片内容更宽松
            · lg:（≥1024px）与 xl: 之间 → 两列
            · xl: 及以上                → 两列
          即：桌面 ≥1024px 两列，窄屏 <768px 单列。
        */}
        <ul className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {PLACEHOLDER_CARDS.map((card) => (
            <li
              key={card.title}
              className="card-surface flex flex-col rounded-lg border border-slate-200 bg-white p-4 sm:p-5"
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-900">
                  {card.title}
                </h3>
                <span className="inline-flex shrink-0 items-center rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                  即将推出
                </span>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                {card.summary}
              </p>

              <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
                <span className="font-medium text-slate-600">边界：</span>
                {card.boundary}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------- 页脚 ---------- */}
      <footer className="mt-10 border-t border-slate-200 pt-6 text-xs leading-relaxed text-slate-500">
        <p>
          当前没有任何上传、真实模型识别、数据库、检索或材料生成功能；凭证文件仅在你的浏览器内
          预览。「本地 mock 识别」只请求本机占位接口，用于验证数据流，不会向任何外部服务发送数据。
        </p>
        <p className="mt-2">输出仅供参考，不构成法律意见，也不能替代律师或其他专业人士的建议。</p>
      </footer>
    </div>
  );
}
