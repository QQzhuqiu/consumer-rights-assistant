# src —— 源代码目录

当前状态：**Next.js App Router 界面与本地输入整理**已完成（阶段 3—6），
并新增**一项受控的真实模型能力**——阶段 7「AI 事实整理摘要」（提交 `41be93a`）。
目录不再为空。

> **所有浏览器验收均由用户本人在本机浏览器完成并报告；代理未执行浏览器验收。**
> 阶段 7 的真实接口调用成功路径**未经代理验证**：代理未调用真实 DeepSeek API。

## 当前实际结构

```
src/
├── .gitkeep                      阶段一遗留的空目录标记文件（保留，不影响构建）
├── README.md                     本文件
├── app/
│   ├── layout.tsx                根布局（html/body、站点元信息、全局样式引入）
│   ├── page.tsx                  首页：唯一状态源（fields / userContext），按序挂载下列区块
│   ├── globals.css               Tailwind v4 入口（@import "tailwindcss"）、@theme 主题补充、
│   │                             卡片与按钮微交互、弹窗视口/滚动样式（.dialog-viewport / .dialog-scroll）
│   ├── evidence-preview.tsx      阶段 4.1 凭证选择与浏览器本地预览（客户端组件）
│   ├── extraction-review.tsx     阶段 4.2a—4.2d 识别字段核对（受控组件，固定样例驱动）
│   ├── user-case-context.tsx     阶段 4.2e 用户事实陈述与处理诉求七字段（受控组件）
│   ├── offline-analysis-preparation.tsx  阶段 5 离线分析准备（只读汇总视图）
│   ├── fact-timeline.tsx         阶段 6 事实时间线（只读展示）
│   ├── material-checklist.tsx    阶段 6 材料记录清单（只读展示 + 组件内本地勾选）
│   ├── ai-summary-result.tsx     阶段 7 AI 摘要区块：触发按钮、确认弹窗开合、请求、结果只读展示
│   ├── ai-summary-confirm-dialog.tsx  阶段 7 发送前确认弹窗（列出将发送内容 + 隐私提示 + 滚动锁定）
│   ├── mock-extraction-preview.tsx    阶段 4.2c 本地 mock 识别预览（请求 /api/extract）
│   └── api/
│       ├── extract/route.ts      本地 mock 结果注入接口（见下）
│       └── summarize/route.ts    服务端 DeepSeek 文本摘要路由（见下）
├── lib/
│   ├── extraction-fixture.ts     固定合成样例数据与克隆/重置纯函数（不含真实凭证内容）
│   ├── analysis-input.ts         已确认字段 → 分析输入的纯函数派生
│   ├── fact-timeline.ts          buildFactTimeline 纯函数（不排序、不解析日期）
│   ├── material-checklist.ts     buildMaterialChecklist 纯函数（窄词表保守匹配）
│   ├── extract-api.ts            客户端 fetch 封装，仅调用同源 /api/extract
│   ├── validate-extraction.ts    手写窄范围运行时校验（未引入 schema 库）
│   ├── ai-summary-local.ts       buildLocalSummary 纯函数：无密钥/失败时显示的「本地整理结果」
│   └── ai-summary-prompt.ts      系统提示词、输入校验、输出校验、上游调用封装（含端点与模型常量）
└── types/
    ├── extraction.ts             识别字段类型与展示文案常量
    ├── user-case.ts              用户陈述类型、上限常量与选项
    └── ai-summary.ts             AI 摘要输入/输出类型、可发送字段白名单、上限常量、隐私提示原文
```

## 两个 API 路由的实际行为

| 路由 | 性质 | 实际行为（以代码为准） |
| --- | --- | --- |
| `app/api/extract/route.ts` | **本地 mock / 本地测试接口** | 只接受 `provider === 'mock'`；其余取值一律按「未实现」返回，不静默降级。响应 `source` **固定为 `'mock'`，绝不是 `'model'`**。不读环境变量、不联网 |
| `app/api/summarize/route.ts` | **服务端 DeepSeek 文本摘要路由** | 只接受 `POST`（`GET` 返回 405）；校验请求体结构与长度；**在服务端**读取 `process.env.DEEPSEEK_API_KEY`；`runtime = 'nodejs'`；失败或无密钥时返回带明确标记的**本地整理结果**，不伪称为 AI 摘要 |

## 分层约定

- **页面组件**（`app/*.tsx`）：只负责展示与交互，不直接持有业务真相。
  `page.tsx` 是 `fields` / `userContext` 的唯一状态源，其余区块通过 props 读写。
- **纯本地整理逻辑**（`lib/fact-timeline.ts`、`lib/material-checklist.ts`、`lib/analysis-input.ts`、
  `lib/ai-summary-local.ts`）：纯函数，无副作用、无网络、无存储，可离线测试。
- **模型调用**：只发生在服务端路由 `app/api/summarize/route.ts`。
  客户端组件（`ai-summary-result.tsx`、`ai-summary-confirm-dialog.tsx`）**不含** `fetch` 直连、
  不含密钥、不含 `process.env`；弹窗内**没有任何请求**，只有点击「确认发送」后由父组件发起同源请求。
- **类型定义**（`types/*.ts`）：纯类型与常量，无运行时副作用。

> `src/lib/ai/` 目录**仍未创建**。阶段 7 的模型调用没有走独立的适配层目录，
> 而是集中在 `lib/ai-summary-prompt.ts`（端点与模型名为该文件内的常量，不接受外部指定）。

## 配置与依赖位置

配置文件在**仓库根目录**，不在 `src/` 下：

| 文件 | 用途 |
| --- | --- |
| `package.json` | 依赖清单与 npm 脚本（`dev` / `build` / `start` / `typecheck`） |
| `package-lock.json` | npm 锁文件（lockfileVersion 3） |
| `tsconfig.json` | TypeScript 配置；路径别名 `@/*` → `./src/*` |
| `next.config.ts` | Next.js 配置（仅开启 `reactStrictMode`） |
| `postcss.config.mjs` | Tailwind v4 的 PostCSS 集成（`@tailwindcss/postcss`） |

**Tailwind v4 说明**：v4 不再需要 `tailwind.config.js/ts`；主题与字体栈在 `globals.css` 中用 `@theme` 声明。
断点沿用 v4 内置默认值（`sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536`），未做覆盖。

## 当前仍未实现

凭证图片的真实模型识别、图片上传到服务端、法规检索、法律规则判断、权益分析、
材料正文自动生成、数据库与历史记录——**均未实现**。
`.env.local` 不提交；任何密钥都不得进入客户端代码或本目录下的文档。

## 约定

- 新建任何目录前先更新本文档，避免出现「无说明的空壳目录」。
- 不提交 `node_modules/`、`.next/`、`dist/`、`out/`（已在 `.gitignore` 中忽略）。
- **页面不得直连模型服务**：模型调用只能发生在服务端，密钥不得进入客户端代码。
- 所有结论必须区分 **用户陈述 / 材料提取结果 / 本地整理结果 / DeepSeek 生成**，不得混写。
