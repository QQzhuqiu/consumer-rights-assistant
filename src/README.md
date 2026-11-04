# src —— 源代码目录

当前状态：**已含 Next.js 界面骨架**（阶段三）。目录不再为空。

阶段三只建立**可本地运行的界面骨架**：单页面 + 4 个静态占位卡片。
**没有**上传、OCR/图片识别、数据库、时间线分析、法规检索、材料生成、账号登录或任何 API 调用。

## 实际结构

```
src/
├── app/
│   ├── layout.tsx     根布局（html/body、站点元信息、全局样式引入）
│   ├── page.tsx       首页：产品名称、简短说明、边界提示、4 个占位卡片
│   └── globals.css    Tailwind v4 入口（@import "tailwindcss"）与本项目主题补充
└── .gitkeep
```

说明：`.gitkeep` 予以保留（阶段一遗留的空目录标记文件），不影响构建。

## 配置与依赖位置

配置文件在**仓库根目录**，不在 `src/` 下：

| 文件 | 用途 |
| --- | --- |
| `package.json` | 依赖清单与 npm 脚本（`dev` / `build` / `start` / `typecheck`） |
| `package-lock.json` | npm 锁文件（lockfileVersion 3） |
| `tsconfig.json` | TypeScript 配置；路径别名 `@/*` → `./src/*` |
| `next.config.ts` | Next.js 配置（仅开启 `reactStrictMode`） |
| `postcss.config.mjs` | Tailwind v4 的 PostCSS 集成（`@tailwindcss/postcss`） |

**Tailwind v4 说明**：v4 不再需要 `tailwind.config.js/ts`；主题与字体栈在 `globals.css` 中用 `@theme` 声明。断点沿用 v4 内置默认值（`sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536`），未做覆盖。

## 未来可能的子目录划分（**仅规划，尚未创建**）

| 子目录（规划） | 用途 | 引入阶段 |
| --- | --- | --- |
| `lib/` 或 `core/` | 凭证识别编排、事实整理、法规检索等纯逻辑 | 阶段 4 起 |
| `lib/ai/` | 最小模型调用适配层（文本 / 图片分开） | 图片识别阶段，且需先完成能力验证 |

## 约定

- 新建任何目录前先更新本文档，避免出现「无说明的空壳目录」。
- 不提交 `node_modules/`、`.next/`、`dist/`、`out/`（已在 `.gitignore` 中忽略）。
- **页面不得直连模型服务**：任何模型调用都只能发生在服务端，且密钥不得进入客户端代码。
- 所有结论必须区分 **用户陈述 / 材料提取结果 / AI 推断**，不得混写。
