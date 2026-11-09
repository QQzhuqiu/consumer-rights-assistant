import { NextResponse } from 'next/server';

import {
  AI_SUMMARY_NO_KEY_MESSAGE,
  buildLocalSummary,
} from '@/lib/ai-summary-local';
import {
  requestAISummary,
  validateAISummaryInput,
} from '@/lib/ai-summary-prompt';
import type { AISummaryInput } from '@/types/ai-summary';

/**
 * POST /api/summarize —— 「AI 事实整理摘要」服务端接口（阶段 7）。
 *
 * ============================================================================
 * 这是项目里唯一真正调用外部模型的地方
 * ============================================================================
 * 调用官方 DeepSeek 的 OpenAI 兼容文本接口，模型固定为 `deepseek-flash`。
 * 参与实际传输与模型契约的细节（接口地址、模型名、请求体、响应解释）全部在
 * `src/lib/ai-summary-prompt.ts` 中，本文件只做三件事：
 *   1. 校验请求体（限长、限条数、白名单）；
 *   2. 在**服务端**读取 API Key；
 *   3. 把结果或本地整理结果包成响应。
 *
 * 关键保护：
 *   · API Key **只在服务端**读取（`process.env.DEEPSEEK_API_KEY`），
 *     不出现在任何客户端代码、响应体或错误信息里；
 *   · 接口地址与模型名是常量，不接受客户端传入——
 *     客户端若尝试带上 `model` / `url` / `systemPrompt` 之类的键，
 *     会被 `validateAISummaryInput` 的顶层白名单直接拒绝；
 *   · 不把上游原始响应、堆栈或内部细节返回给前端；
 *   · **不记录**用户原始输入、API Key 或模型完整响应到任何日志
 *     （本文件没有任何日志调用）；
 *   · 不实现基于 IP 的配额：没有用户认证，`x-forwarded-for` 可伪造，
 *     因此这里**不做**也不**声称**有可靠的配额机制；
 *   · 不向请求体添加 `user_id`：当前没有账号体系，
 *     也不用 IP、设备指纹或任何个人信息充当 `user_id`。
 *
 * 失败策略：
 *   任何上游异常（无 Key、超时、HTTP 错误、空内容、JSON 解析失败、
 *   结构校验失败、`finish_reason === 'length'`、措辞越界）都退回
 *   **本地整理结果**，并附一条说明。它叫「本地整理结果」，
 *   **不是**「降级摘要」，也**不是**「本地 AI 生成」。
 */

/** 强制 Node.js 运行时：需要读取服务端环境变量。 */
export const runtime = 'nodejs';

/** 统一错误响应。只返回稳定错误码与简短中文说明。 */
function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

/** 用本地整理结果构造成功响应（来源固定为 local）。 */
function localResponse(input: AISummaryInput, message: string) {
  return NextResponse.json({
    success: true,
    result: buildLocalSummary(input, message),
  });
}

/** POST /api/summarize */
export async function POST(request: Request) {
  // ---- 1. 解析 JSON ----
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // 不把解析异常对象序列化给客户端
    return errorResponse('INVALID_JSON', '请求体不是合法的 JSON。', 400);
  }

  // ---- 2. 运行时校验（限长、限条数、顶层键白名单）----
  const validatedInput = validateAISummaryInput(body);
  if (!validatedInput.ok) {
    // 输入不合法是调用方问题，无法据此生成本地整理结果，因此直接 400
    return errorResponse(validatedInput.code, validatedInput.message, 400);
  }

  const input = validatedInput.input;

  // ---- 3. 读取服务端 API Key（缺失不是错误，直接给本地整理结果）----
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    return localResponse(input, AI_SUMMARY_NO_KEY_MESSAGE);
  }

  // ---- 4. 调用模型 ----
  const outcome = await requestAISummary(apiKey.trim(), input);
  if (!outcome.ok) {
    return localResponse(input, outcome.message);
  }

  return NextResponse.json({ success: true, result: outcome.result });
}

/** GET：本接口只接受 POST。 */
export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: '该接口只接受 POST 请求。' },
    },
    { status: 405, headers: { Allow: 'POST' } },
  );
}

/**
 * 不实现 PUT / PATCH / DELETE。
 * 未导出对应处理函数时，Next.js 会自动对这些方法返回 405。
 */
