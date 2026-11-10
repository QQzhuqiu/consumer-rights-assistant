'use client';

import type { MouseEvent as ReactMouseEvent } from 'react';

type StepKey = 'evidence' | 'fields' | 'context' | 'result';

type FlowNode = {
  key: StepKey;
  label: string;
  description: string;
  step: string;
};

const FLOW_NODES: FlowNode[] = [
  {
    key: 'evidence',
    label: '凭证',
    description: '选择并预览凭证文件',
    step: '01',
  },
  {
    key: 'fields',
    label: '字段核对',
    description: '逐项确认凭证信息',
    step: '02',
  },
  {
    key: 'context',
    label: '事实陈述',
    description: '补充经过与处理诉求',
    step: '03',
  },
  {
    key: 'result',
    label: '整理结果',
    description: '查看时间线与整理摘要',
    step: '04',
  },
];

type FlowHomeProps = {
  onEnterStep: (key: StepKey, event: ReactMouseEvent<HTMLButtonElement>) => void;
};

export default function FlowHome({ onEnterStep }: FlowHomeProps) {
  return (
    <main className="flow-home-scene">
      <ShellBackground />

      <header className="flow-home-header">
        <p className="flow-home-kicker">消费事实整理工具</p>
        <h1>凭证明白 · AI消费权益助手</h1>
        <p className="flow-home-intro">
          把消费材料整理成可核对的事实线索，帮助你更清楚地看见发生了什么。
        </p>
      </header>

      <nav aria-label="四步整理流程" className="flow-map">
        <div className="flow-map-label" aria-hidden="true">
          <span>整理路径</span>
          <span>从材料到事实</span>
        </div>

        <svg
          className="flow-paths"
          viewBox="0 0 920 560"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="flow-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="4"
              orient="auto"
            >
              <path d="M0 0 L8 4 L0 8" />
            </marker>
          </defs>
          <path d="M190 176 C255 116 324 106 382 178" />
          <path d="M538 178 C610 112 685 118 746 188" />
          <path d="M746 245 C720 332 646 378 566 394" />
          <path d="M430 402 C352 440 284 421 208 350" />
        </svg>

        <button
          type="button"
          className="flow-center-pearl"
          onClick={(event) => onEnterStep('evidence', event)}
          aria-label="开始整理，进入凭证步骤"
        >
          <span className="flow-pearl-shine" aria-hidden="true" />
          <span className="flow-center-mark" aria-hidden="true">明</span>
          <span className="flow-center-title">开始整理</span>
          <span className="flow-center-subtitle">凭证明白</span>
        </button>

        <ol className="flow-node-list">
          {FLOW_NODES.map((node) => (
            <li key={node.key} className={`flow-node flow-node-${node.key}`}>
              <button
                type="button"
                onClick={(event) => onEnterStep(node.key, event)}
                className="flow-node-button"
                aria-label={`${node.label}：${node.description}`}
              >
                <span className="flow-node-index" aria-hidden="true">{node.step}</span>
                <span className="flow-node-copy">
                  <span className="flow-node-label">{node.label}</span>
                  <span className="flow-node-description">{node.description}</span>
                </span>
                <span className="flow-node-arrow" aria-hidden="true">↗</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <footer className="flow-home-footer">
        <span>文件只在你的浏览器内预览</span>
        <span aria-hidden="true">·</span>
        <span>AI 摘要仅在你确认后发送少量文本</span>
      </footer>
    </main>
  );
}

function ShellBackground() {
  return (
    <svg
      className="shell-background"
      viewBox="0 0 1200 760"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path className="shell-outline shell-left" d="M42 492 C58 387 153 342 245 377 C317 404 349 474 333 544 C293 513 256 491 214 478 C152 459 95 466 42 492Z" />
      <path className="shell-rib" d="M72 469 C119 431 170 416 226 423 M91 449 C136 405 181 390 231 398 M119 418 C153 381 190 370 224 374 M161 387 C179 366 198 358 216 359" />
      <path className="shell-outline shell-right" d="M915 104 C1014 74 1107 125 1145 212 C1092 204 1045 210 1001 237 C968 257 940 287 921 326 C883 273 878 218 895 164 C900 142 907 122 915 104Z" />
      <path className="shell-rib" d="M916 142 C978 141 1032 162 1081 202 M902 178 C969 175 1024 193 1066 229 M899 217 C956 214 1003 229 1041 256 M906 258 C948 254 979 264 1003 282" />
      <path className="shell-wave" d="M0 644 C160 596 288 686 444 646 S733 589 900 642 S1077 690 1200 632" />
      <path className="shell-wave shell-wave-light" d="M0 682 C174 636 290 722 459 681 S736 628 905 679 S1084 719 1200 673" />
    </svg>
  );
}
