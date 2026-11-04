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

export default function HomePage() {
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
              className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 sm:p-5"
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
          当前为界面骨架阶段：没有任何上传、识别、数据库、检索或材料生成功能，
          页面也不会向任何服务发送数据。
        </p>
        <p className="mt-2">输出仅供参考，不构成法律意见，也不能替代律师或其他专业人士的建议。</p>
      </footer>
    </div>
  );
}
