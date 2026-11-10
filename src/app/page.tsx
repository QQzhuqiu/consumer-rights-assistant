'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  AnimationEvent as ReactAnimationEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';

import { createInitialFields } from '@/lib/extraction-fixture';
import type { ExtractedField } from '@/types/extraction';
import type { UserCaseContext } from '@/types/user-case';
import { EMPTY_USER_CASE_CONTEXT } from '@/types/user-case';

import AISummarySection from './ai-summary-result';
import EvidencePreview from './evidence-preview';
import ExtractionReview from './extraction-review';
import FactTimeline from './fact-timeline';
import FlowHome from './flow-home';
import MaterialChecklist from './material-checklist';
import MockExtractionPreview from './mock-extraction-preview';
import OfflineAnalysisPreparation from './offline-analysis-preparation';
import UserCaseContextSection from './user-case-context';

/** 视图状态：入口首页 vs 工作区 */
type ViewMode = 'home' | 'workspace';

/** 四个步骤的稳定标识（仅用于内部状态比较，不进入 URL） */
type StepKey = 'evidence' | 'fields' | 'context' | 'result';

type StepDefinition = {
  key: StepKey;
  /** 导航上的短标签，保持 2—4 字，窄屏 2×2 也能放下 */
  label: string;
  /** 一句话说明，既帮助理解流程，也作为不依赖颜色的状态说明 */
  hint: string;
};

/**
 * 四步流程定义。
 *
 * 顺序即页面主张的处理顺序：凭证 → 字段核对 → 事实陈述 → 整理结果。
 * 但导航**不锁定**：任一步骤都可直接进入，不会因为「凭证未选」「字段未确认」
 * 或「陈述为空」而禁用按钮。这里也**不记录完成状态**——不显示对勾、不判断
 * 「已完成」，只标记「当前在第几步」，避免把「曾经访问过」伪装成「已经做完」。
 */
const STEPS: StepDefinition[] = [
  {
    key: 'evidence',
    label: '凭证',
    hint: '在本机选择并预览凭证文件；文件只留在浏览器内，不会上传。',
  },
  {
    key: 'fields',
    label: '字段核对',
    hint: '逐字段核对并确认凭证信息；下方另附本地 mock 识别，仅用于演示数据流。',
  },
  {
    key: 'context',
    label: '事实陈述',
    hint: '用你自己的话填写事实经过与处理诉求；这部分由你输入，不是凭证提取结果。',
  },
  {
    key: 'result',
    label: '整理结果',
    hint: '查看离线分析准备、事实时间线、材料记录清单与 AI 事实整理摘要。',
  },
];

/**
 * 步骤轨道与按钮的视觉配方。
 *
 * 三层关系的建立：
 *   · 轨道区域用半透明深蓝底（bg-primary-dim），在深色页面背景上形成第一层区域感；
 *   · 当前步骤是实心深蓝（bg-primary），白色文字，明确标识当前位置；
 *   · 未选中步骤是白色块（bg-white），鼠标悬停时浅蓝底（hover:bg-primary-soft）。
 *
 * 这样蓝色从页面背景 → 导航区域 → 当前步骤形成完整的视觉层次，
 * 而不是白底上孤立的蓝按钮。
 */
const ACTIVE_STEP_CLASS =
  'field-action-button flex w-full items-center gap-2 rounded-md border border-ocean-deep bg-ocean-deep px-3 py-2 text-left text-sm font-semibold text-white';

const INACTIVE_STEP_CLASS =
  'field-action-button flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:border-ocean-border hover:bg-ocean-soft hover:text-ocean-deep';

/** 步骤序号徽标：当前步骤反白，其余白底中性描边，两者都带文字序号，不只靠颜色区分 */
const ACTIVE_BADGE_CLASS =
  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ocean-primary text-xs font-semibold text-white';

const INACTIVE_BADGE_CLASS =
  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200';

/** 上一步：次要操作，浅描边 */
const PREV_BUTTON_CLASS =
  'field-action-button rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:border-slate-200 disabled:hover:bg-slate-50';

/** 下一步：同为导航操作，仅用更深的描边与文字略作强调，不与主操作争夺注意力 */
const NEXT_BUTTON_CLASS =
  'field-action-button rounded-md border border-slate-400 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:border-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:border-slate-200 disabled:hover:bg-slate-50';

/** 用户是否要求减少动态效果（SSR 期间无 window，按「不减少」处理，实际只在客户端调用） */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * 当前浏览器是否支持 circle() 形式的 clip-path。
 *
 * 用它决定转场走「圆形揭示」还是「淡出降级」，而不是靠 UA 猜测；
 * 拿不到 CSS.supports 时按不支持处理，走降级路径。
 */
function supportsCircleWipe(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  return CSS.supports('clip-path', 'circle(0px at 0px 0px)');
}

/**
 * 首页。
 *
 * 布局为「四步流程」：顶部步骤导航 + 当前步骤面板 + 上一步/下一步。
 *
 * 为什么步骤面板全部保持挂载、只用 hidden 隐藏：
 *   · `EvidencePreview` 卸载时会 `URL.revokeObjectURL` 释放预览地址，
 *     且文件对象本身只存在于该组件的 state 里；一旦卸载，已选凭证与预览
 *     就会丢失，还会触发一次创建/撤销，属于「提前撤销」。
 *   · `MaterialChecklist` 的「已记录」勾选、`AISummarySection` 的摘要结果与
 *     确认勾选、`MockExtractionPreview` 的 mock 结果、`ExtractionReview` 的
 *     编辑草稿都是组件内 state，卸载即丢失。
 *   · 因此这里**不提升业务状态、不新建 Context、不引入路由或存储**，
 *     最小方案就是让面板一直挂载，靠 `hidden` 控制可见性。
 *
 * `hidden` 属性对应 `display: none`：不可见时元素不参与布局、无法被 Tab 聚焦，
 * 也会从无障碍树中移除，因此不会出现「焦点跑进看不见的内容」。
 * 注意承载 `hidden` 的包装元素**不能**再带 `flex` / `block` 之类的 display 工具类，
 * 否则工具类的 display 会覆盖 `[hidden]` 的 UA 规则。
 */
export default function HomePage() {
  /**
   * 视图模式：入口首页 vs 工作区
   *
   * 刷新后回到首页，与既有的「刷新即清空」行为一致。
   */
  const [view, setView] = useState<ViewMode>('home');

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

  /**
   * 当前步骤：纯 UI 状态，不进入 URL、不写存储。
   * 刷新回到第一步，与既有的「刷新即清空」行为一致。
   */
  const [step, setStep] = useState<StepKey>('evidence');

  const activeIndex = STEPS.findIndex((item) => item.key === step);
  const activeStep = STEPS[activeIndex] ?? STEPS[0];
  const isFirst = activeIndex <= 0;
  const isLast = activeIndex >= STEPS.length - 1;

  /*
   * ---------- 工作区转场：圆形揭示 ----------
   *
   * 结构上什么都不改：四个面板仍然全部挂载，只用 `hidden` 切换可见性。
   * 转场是一层**一次性覆盖层**，盖在当前工作区之上，与面板本身无关：
   *   · pointer-events: none，绝不拦截点击，也不参与布局；
   *   · aria-hidden="true"，不进无障碍树；
   *   · 只在一次动画的时长内存在，onAnimationEnd 立即卸载，不留节点与 CSS 变量。
   *
   * 为什么起点在点击时记、尺寸却在 effect 里量：
   *   点击坐标是视口坐标，随时可记；但半径必须覆盖**切换后**的工作区边界，
   *   而不同步骤内容高度不同，工作区高度会在切换之后变化。
   *   所以等到面板已经交换完成的那次 effect 里再量 rect，再换算成局部坐标。
   *
   * 首帧不会闪出一块实心浅蓝：覆盖层基础样式带 opacity-0，动画由 keyframes
   * 从 0% 起接管（animations 的优先级高于普通声明）。因此「类名还没加上」的
   * 那一帧它是隐形的。
   */

  /** 工作区容器：量尺寸、换算局部坐标，同时作为覆盖层的定位基准 */
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  /** 覆盖层元素：转场结束后随状态一起卸载 */
  const wipeLayerRef = useRef<HTMLDivElement | null>(null);

  /** 本次切换的起点（视口坐标）与目标步骤，供切换后的 effect 消费 */
  const wipeOriginRef = useRef<{ key: StepKey; x: number; y: number } | null>(null);

  /** 是否挂载覆盖层：只在切换的一瞬间短暂为 true */
  const [wipeActive, setWipeActive] = useState(false);

  /**
   * 从入口首页进入指定步骤的工作区。
   *
   * 记录起点位置用于水波转场，然后切换到工作区视图。
   */
  const enterWorkspace = (
    key: StepKey,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fromKeyboard = event.detail === 0;
    const hasPointerPoint =
      !fromKeyboard && (event.clientX !== 0 || event.clientY !== 0);

    wipeOriginRef.current = {
      key,
      x: hasPointerPoint ? event.clientX : rect.left + rect.width / 2,
      y: hasPointerPoint ? event.clientY : rect.top + rect.height / 2,
    };

    // 设置目标步骤并切换到工作区
    setStep(key);
    setView('workspace');

    // 启动转场动画
    if (!prefersReducedMotion()) setWipeActive(true);
  };

  /**
   * 返回入口首页。
   * 四步面板不卸载，只有外层视图切换，因此各子组件的内存状态会保留。
   */
  const returnToHome = () => {
    setView('home');
  };

  /**
   * 页面级 Escape：只处理「工作区且没有更高优先级目标」的情况。
   *
   * AI 确认弹窗有自己的 Escape 取消逻辑；这里通过 role=dialog 让事件在页面级
   * 监听器中提前退出，避免弹窗关闭后同一次按键继续把工作区带回入口。
   * 编辑控件中的 Escape 也不离开工作区，交给控件或其组件自己的处理逻辑。
   */
  useEffect(() => {
    const handlePageEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || view !== 'workspace') return;

      const target = event.target;
      if (
        document.querySelector('[role="dialog"][aria-modal="true"]') !== null ||
        (target instanceof HTMLElement && target.closest('[role="dialog"]'))
      ) {
        return;
      }

      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      returnToHome();
    };

    document.addEventListener('keydown', handlePageEscape);
    return () => document.removeEventListener('keydown', handlePageEscape);
  }, [view]);

  /**
   * 切换步骤并记录本次转场起点。
   *
   * 坐标来源：
   *   · 指针/触摸：直接用点击位置（React 的 click 已覆盖触屏，无需另接 touch）；
   *   · 键盘激活：`event.detail === 0`，此时取**该按钮中心**作为起点。
   * 两者都会在切换后的 effect 里换算成工作区局部坐标，因此与页面滚动位置无关。
   */
  const activateStep = (
    key: StepKey,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (key === step) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const fromKeyboard = event.detail === 0;
    const hasPointerPoint =
      !fromKeyboard && (event.clientX !== 0 || event.clientY !== 0);

    wipeOriginRef.current = {
      key,
      x: hasPointerPoint ? event.clientX : rect.left + rect.width / 2,
      y: hasPointerPoint ? event.clientY : rect.top + rect.height / 2,
    };

    // 立即切换：旧面板隐藏、新面板显示。转场只是其上的装饰，不参与任何状态。
    setStep(key);

    // 减少动画偏好下干脆不挂载覆盖层，直接切换
    if (!prefersReducedMotion()) setWipeActive(true);
  };

  const goPrevious = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!isFirst) activateStep(STEPS[activeIndex - 1].key, event);
  };

  const goNext = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!isLast) activateStep(STEPS[activeIndex + 1].key, event);
  };

  /**
   * 步骤已经切换完成之后，启动这一次转场。
   *
   * 用 useEffect（而非 useLayoutEffect）以避免服务端渲染期间「useLayoutEffect
   * 不在服务端执行」的开发期告警；覆盖层首帧本来就是隐形的，晚一帧起播看不见。
   */
  useEffect(() => {
    const origin = wipeOriginRef.current;
    const layer = wipeLayerRef.current;
    const workspace = workspaceRef.current;

    wipeOriginRef.current = null;

    // 首屏挂载，或并非由切换触发（例如其他状态引起的重渲染）：不播放
    if (origin === null || origin.key !== step || layer === null || workspace === null) {
      return;
    }

    // 先清掉上一次可能残留的动画：快速连点时只播最后一次，绝不叠加
    layer.classList.remove('workspace-wipe', 'workspace-wipe-fade');
    layer.style.removeProperty('--wipe-x');
    layer.style.removeProperty('--wipe-y');
    layer.style.removeProperty('--wipe-r');

    if (prefersReducedMotion()) {
      setWipeActive(false);
      return;
    }

    const rect = workspace.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      setWipeActive(false);
      return;
    }

    // 视口坐标 → 工作区局部坐标
    const localX = origin.x - rect.left;
    const localY = origin.y - rect.top;

    if (!supportsCircleWipe()) {
      // 降级：不裁圆，只做一次 170ms 的浅色遮罩淡出（带 3px 轻微位移）
      void layer.offsetWidth; // 强制重排，断开上一帧，确保动画能重新开始
      layer.classList.add('workspace-wipe-fade');
      return;
    }

    // 半径取「起点到工作区四角」的最远距离，保证覆盖整个工作区边界
    const dx = Math.max(localX, rect.width - localX);
    const dy = Math.max(localY, rect.height - localY);

    layer.style.setProperty('--wipe-x', `${localX}px`);
    layer.style.setProperty('--wipe-y', `${localY}px`);
    layer.style.setProperty('--wipe-r', `${Math.hypot(dx, dy)}px`);
    void layer.offsetWidth; // 同上
    layer.classList.add('workspace-wipe');
  }, [step]);

  /** 转场结束：卸载覆盖层，不留遮罩、不留 pointer-events、不留 CSS 变量 */
  const handleWipeEnd = (event: ReactAnimationEvent<HTMLDivElement>) => {
    const { animationName } = event;
    if (animationName !== 'workspace-wipe' && animationName !== 'workspace-wipe-fade') {
      return;
    }
    setWipeActive(false);
  };

  /** 组件卸载时清掉可能仍在进行的转场状态 */
  useEffect(() => {
    return () => {
      const layer = wipeLayerRef.current;
      if (layer !== null) {
        layer.classList.remove('workspace-wipe', 'workspace-wipe-fade');
        layer.style.removeProperty('--wipe-x');
        layer.style.removeProperty('--wipe-y');
        layer.style.removeProperty('--wipe-r');
      }
      wipeOriginRef.current = null;
    };
  }, []);

  return (
    <div className="app-shell min-h-screen">
      <div className="mx-auto w-full max-w-6xl min-w-0 px-3 py-4 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <div hidden={view !== 'home'}>
          <FlowHome onEnterStep={enterWorkspace} />
        </div>
        <div hidden={view !== 'workspace'} className="workspace-view">
          <div className="workspace-topbar">
            <button
              type="button"
              onClick={returnToHome}
              className="workspace-back-button"
            >
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              <span>返回流程入口</span>
            </button>
            <span className="workspace-escape-hint" aria-hidden="true">
              Esc 返回入口
            </span>
          </div>

          <header className="workspace-heading">
            <span aria-hidden="true" className="workspace-heading-mark" />
            <div className="min-w-0">
              <p className="workspace-eyebrow">四步整理工作台</p>
              <h1>{activeStep.label}</h1>
              <p>{activeStep.hint}</p>
            </div>
            <span className="workspace-heading-wave" aria-hidden="true" />
          </header>

        {/* ---------- 首屏边界提示（保留：产品边界必须始终可见） ---------- */}
        <section
          aria-labelledby="boundary-heading"
          className="workspace-notice mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 sm:p-5"
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

      {/* ---------- 四步导航（步骤轨道） ---------- */}
      {/*
        轨道整块使用极浅蓝底 + 低饱和蓝边，构成页面里第二处「蓝色的面」。
        当前步骤落在其中，是唯一的实心克莱因蓝；未选中项是白色小块。
        由此蓝色先以「面（轨道）→ 线（边界）→ 点（当前步骤）」的顺序出现，
        不再是从白底灰线里突然冒出来的一颗蓝按钮。

        步骤状态不只靠颜色表达：这里同时给出「第 N 步，共 4 步」的文字，
        当前按钮另有 aria-current="step"，序号徽标本身也是文字。
        窄屏用 2×2 网格而非横向滚动，避免挤压内容或产生横向溢出。
      */}
      <nav
        aria-label="流程步骤"
        className="workspace-step-nav mt-6 rounded-lg border p-3 sm:p-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-xs font-semibold text-ocean-primary">
            第 {activeIndex + 1} 步，共 {STEPS.length} 步
          </p>
          <p className="text-xs text-slate-500">当前：{activeStep.label}</p>
        </div>
        <ol className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STEPS.map((item, index) => {
            const isActive = item.key === step;
            return (
              <li key={item.key} className="min-w-0">
                <button
                  type="button"
                  onClick={(event) => activateStep(item.key, event)}
                  aria-current={isActive ? 'step' : undefined}
                  className={isActive ? ACTIVE_STEP_CLASS : INACTIVE_STEP_CLASS}
                >
                  <span
                    aria-hidden="true"
                    className={isActive ? ACTIVE_BADGE_CLASS : INACTIVE_BADGE_CLASS}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 break-words">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/*
        ---------- 当前工作区 ----------
        四个面板始终挂载，仅用 hidden 切换可见性，因此步骤之间切换不会丢失：
          · 已选凭证文件与其对象 URL（卸载会 revokeObjectURL）；
          · 字段核对区的编辑草稿与焦点请求；
          · 用户陈述内容（受控，来自页面 state）；
          · 材料清单的「已记录」勾选；
          · AI 摘要结果与确认勾选；
          · 本地 mock 识别的结果。
        刷新页面后的行为与改动前完全一致（全部回到初始状态）。

        工作区本身只是一层容器：接近白色的表面 + 低饱和浅蓝边界，
        用来承托内部各区块原有的白色卡片，形成「页面浅底 → 工作区 → 区块」
        三层关系。它不包裹状态、不改变任何组件的挂载方式。
      */}
      <div
        ref={workspaceRef}
        className="workspace-shell relative mt-4 rounded-2xl border p-3 sm:p-5"
      >
        {/*
          转场覆盖层：只在切换的一瞬间挂载，pointer-events: none 不吃点击，
          aria-hidden 不进无障碍树，动画结束由 onAnimationEnd 卸载。
          基础样式带 opacity-0，动画从 0% 接管，因此加上类名之前它不可见。
          inset-0 使它不可能超出工作区；自身圆角与工作区一致，所以这里
          **故意不使用 overflow: hidden** —— 工作区内部包含 AI 确认弹窗
          （position: fixed），给祖先加裁剪会有把它困住的风险。
        */}
        {wipeActive ? (
          <div
            ref={wipeLayerRef}
            aria-hidden="true"
            onAnimationEnd={handleWipeEnd}
            className="pointer-events-none absolute inset-0 z-10 rounded-2xl bg-ocean-soft opacity-0"
          />
        ) : null}

        {/* 第 1 步：凭证 */}
        <div data-step-panel="evidence" hidden={step !== 'evidence'}>
          <EvidencePreview />
        </div>

        {/* 第 2 步：字段核对（含本地 mock 演示） */}
        <div data-step-panel="fields" hidden={step !== 'fields'}>
          <ExtractionReview fields={fields} onFieldsChange={setFields} />

          {/*
            ---------- 阶段 4.2c-2：本地 mock 识别 ----------
            与上面的字段核对严格独立：
              · 自己的状态、自己的数据，不读写 4.2a 的 fixture 状态；
              · 结果不传入 ExtractionReview；
              · 只请求本机相对路径 /api/extract，未调用任何模型。
            它保留在原位，是因为这是**测试/演示数据流**的能力，不是真实识别。
          */}
          <MockExtractionPreview />
        </div>

        {/* 第 3 步：事实陈述 */}
        <div data-step-panel="context" hidden={step !== 'context'}>
          {/*
            ---------- 用户事实陈述（用户自己填写） ----------
            与凭证字段严格独立：
              · 内容由用户手输，不是凭证提取结果，也不叫「已确认事实」；
              · 受控于页面 state，不读写 4.2a 的 fixture 与 4.2c 的 mock 结果；
              · 不进入 AnalysisInputResult，不改变 ready / blockers；
              · 不发请求、不上传文件、不做持久化。
          */}
          <UserCaseContextSection
            context={userContext}
            onContextChange={setUserContext}
          />
        </div>

        {/* 第 4 步：整理结果（全部为只读整理，除 AI 摘要需显式确认外不发送任何数据） */}
        <div data-step-panel="result" hidden={step !== 'result'}>
          {/*
            ---------- 阶段 5：离线分析准备（本地整理） ----------
            只读消费者，不持有 state、不写回任何东西：
              · 读取页面持有的**同一份** state，不复制、不留快照；
              · 完整性判定复用 analysis-input.ts 的既有函数，不另写规则；
              · 用户陈述不进入 AnalysisInputResult，也不混入凭证字段的 blockers；
              · 拿不到 4.2c 的 mock 结果，因此 mock 不参与任何计算。
          */}
          <OfflineAnalysisPreparation fields={fields} userContext={userContext} />

          {/*
            ---------- 阶段 6：事实时间线（本地整理） ----------
            只按已有输入罗列条目，不推断日期、不推断事件先后；
            不进入 AnalysisInputResult，不影响 ready / blockers。
          */}
          <FactTimeline fields={fields} userContext={userContext} />

          {/*
            ---------- 阶段 6：材料记录清单（本地整理） ----------
            只按用户填写的原文做保守关键词匹配，不判断材料效力；
            「已记录」勾选是本组件的本地 state，不持久化，刷新即清空。
          */}
          <MaterialChecklist userContext={userContext} />

          {/*
            ---------- 阶段 7：AI 事实整理摘要（真实模型调用） ----------
            本页唯一会向外部服务发送数据的地方，因此约束最严：
              · 只读页面持有的**同一份** state，绝不写回；
              · 页面加载、字段变更、步骤切换都不会触发请求；
              · 必须用户主动点击、并在确认界面逐项确认后才会调用服务端接口；
              · 服务端接口 /api/summarize 持有密钥与模型名，客户端无从指定；
              · 结果只存在该组件 state，刷新即清空，不做持久化；
              · 输出仅用于信息整理，不作法律判断，也不代替用户确认任何字段。
          */}
          <AISummarySection fields={fields} userContext={userContext} />
        </div>
      </div>

      {/* ---------- 上一步 / 下一步 ---------- */}
      {/*
        工作区已经自带边界，这里不再叠一条分隔线，避免「框线套框线」。
        两个按钮保持中性，不与主操作争夺注意力；步骤文字仍是文字化的状态说明。
      */}
      <div className="workspace-step-actions mt-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={goPrevious}
          disabled={isFirst}
          className={PREV_BUTTON_CLASS}
        >
          上一步
        </button>

        <p className="text-xs text-slate-500">
          {activeIndex + 1} / {STEPS.length} · {activeStep.label}
        </p>

        <button
          type="button"
          onClick={goNext}
          disabled={isLast}
          className={NEXT_BUTTON_CLASS}
        >
          下一步
        </button>
      </div>

      {/* ---------- 页脚：边界说明 ---------- */}
      <footer className="workspace-footer mt-8 border-t pt-5 text-xs leading-relaxed">
        <p>
          当前没有凭证图片的真实模型识别、数据库、法规检索或材料生成功能；凭证文件仅在你的浏览器内预览。
          「本地 mock 识别」只请求本机占位接口，用于验证数据流，不会向任何外部服务发送数据。
        </p>
        <p className="mt-2">
          「AI 事实整理摘要」只在你于确认界面点击「确认发送」之后，才把确认过的少量文本经本机服务端接口
          发往 DeepSeek 官方文本接口；凭证文件与凭证图片始终不会发送，页面也不做个人信息自动识别或脱敏。
        </p>
        <p className="mt-2">输出仅供参考，不构成法律意见，也不能替代律师或其他专业人士的建议。</p>
      </footer>
        </div>
      </div>
    </div>
  );
}
