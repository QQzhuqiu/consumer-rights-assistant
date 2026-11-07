# src —— 源代码目录

当前状态：**已含 Next.js 界面骨架**（阶段三完成）、**凭证选择与本地预览**（阶段 4.1，用户验收完成）与
**识别结果核对 UI**（阶段 4.2a，固定样例驱动，用户本机浏览器验收通过，待提交）。
目录不再为空。

现有代码**没有**上传、OCR/图片识别、数据库、时间线分析、法规检索、材料生成、账号登录或任何 API 调用。
阶段 4.1 的凭证文件仅存在于浏览器内存，不发送到任何服务。
阶段 4.2a 的字段数据来自**固定样例**（`lib/extraction-fixture.ts`），**不是模型输出**，也不上传、不持久化。

## 实际结构

```
src/
├── app/
│   ├── layout.tsx            根布局（html/body、站点元信息、全局样式引入）
│   ├── page.tsx              首页：产品名称、简短说明、边界提示、凭证预览、识别核对、4 个占位卡片
│   ├── evidence-preview.tsx  凭证选择与本地预览（阶段 4.1，客户端组件）
│   ├── extraction-review.tsx 识别结果字段核对（阶段 4.2a，客户端组件，固定样例）
│   └── globals.css           Tailwind v4 入口（@import "tailwindcss"）与本项目主题补充
├── lib/
│   └── extraction-fixture.ts 固定样例数据与克隆/重置纯函数（不含真实凭证内容）
├── types/
│   └── extraction.ts         识别结果字段类型与展示文案常量（纯类型，无副作用）
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

## 子目录状态

| 子目录 | 状态 | 用途 |
| --- | --- | --- |
| `types/` | ✅ **已创建**（阶段 4.2a） | 类型定义与展示文案常量，无运行时副作用 |
| `lib/` | ✅ **已创建**（阶段 4.2a） | 纯逻辑与固定样例数据；目前只有 `extraction-fixture.ts` |
| `lib/ai/` | ⬜ 尚未创建 | 最小模型调用适配层（文本 / 图片分开），需先完成图片能力验证 |

> 阶段 4.2a **未接入真实视觉模型**：`lib/` 目前只存放界面演示用的固定样例，
> 不含任何模型 SDK、网络请求或密钥读取。后续接入模型时，调用只能发生在服务端。

## 约定

- 新建任何目录前先更新本文档，避免出现「无说明的空壳目录」。
- 不提交 `node_modules/`、`.next/`、`dist/`、`out/`（已在 `.gitignore` 中忽略）。
- **页面不得直连模型服务**：任何模型调用都只能发生在服务端，且密钥不得进入客户端代码。
- 所有结论必须区分 **用户陈述 / 材料提取结果 / AI 推断**，不得混写。
