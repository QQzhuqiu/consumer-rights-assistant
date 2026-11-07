import { NextResponse } from 'next/server';

import { validateExtractionPayload } from '@/lib/validate-extraction';
import type { ExtractedField, FieldSource } from '@/types/extraction';

/**
 * 阶段 4.2c-1：**本地 mock 结果注入接口**。
 *
 * ============================================================================
 * 这个接口不是图片识别接口
 * ============================================================================
 * 它只做一件事：接收调用方通过 JSON 注入的「已经形如模型结果」的字段对象，
 * 用统一的运行时校验过关后，按契约形状返回给前端。
 *
 * 明确**不做**的事：
 *   · 不接收图片，不处理 multipart，不解析 Base64；
 *   · 不调用任何模型或外部服务（无 fetch、无 SDK）；
 *   · 不读取 `.env.local` 或任何密钥，不使用 `process.env`；
 *   · 不保存请求或响应到任何文件或数据库；
 *   · 不返回上游地址、内部堆栈或完整原始响应。
 *
 * ============================================================================
 * 来源标记：一律 `'mock'`，**绝不是** `'model'`
 * ============================================================================
 * 本接口返回的字段值来自**调用方注入的测试载荷**，**并没有经过任何模型识别**。
 *
 * 因此来源必须如实标为 `'mock'`：
 *   · 标成 `'model'` 会让下游界面把 mock 数据误显示成「真实模型识别结果」，
 *     这正是 `src/types/extraction.ts` 明确禁止的做法；
 *   · 标成 `'fixture'` 也不准确——fixture 指的是 4.2a 界面那套固定样例常量。
 *
 * `'mock'` 这个来源值由调用方（也就是本文件）决定，**不由校验模块决定**：
 * 校验模块只负责把不可信输入规范化成五个字段值，不替任何人判定数据从哪来。
 *
 * 将来接入真实模型时，只需在这里把来源换成 `'model'`，
 * 前端读取 `source` 的逻辑无需改动。
 */

/** 本接口产出的数据来源。集中在一处定义，便于审查与后续替换。 */
const RESPONSE_SOURCE: FieldSource = 'mock';

/** 统一错误响应。只返回稳定错误码与面向开发 UI 的简短中文说明。 */
function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status },
  );
}

/**
 * POST /api/extract
 *
 * 请求体（JSON）：
 *   {
 *     "provider": "mock",
 *     "result": {
 *       "merchantName": "…",
 *       "itemName": "…",
 *       "amount": "199.00",
 *       "transactionDate": "2026-10-15",
 *       "orderId": "…"
 *     }
 *   }
 *
 * 成功（200），注意 `source` 为 `"mock"`：
 *   {
 *     "success": true,
 *     "source": "mock",
 *     "fields": [
 *       {
 *         "key": "merchantName",
 *         "label": "商家名称",
 *         "value": "…",
 *         "confidence": "unknown",
 *         "source": "mock",
 *         "confirmed": false
 *       },
 *       …其余四个字段…
 *     ]
 *   }
 */
export async function POST(request: Request) {
  // ---- 1. 解析 JSON ----
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // 不把解析异常对象序列化给客户端
    return errorResponse('INVALID_JSON', '请求体不是合法的 JSON。', 400);
  }

  // ---- 2. body 必须是对象（拒绝数组、null、字符串、数字等） ----
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse('INVALID_BODY', '请求体必须是一个 JSON 对象。', 400);
  }

  const payload = body as Record<string, unknown>;

  // ---- 3. 只实现 mock 提供方 ----
  // 缺省、拼错、或指向真实模型时，一律按「未实现」处理，而不是静默降级成 mock。
  if (payload.provider !== 'mock') {
    return errorResponse(
      'NOT_IMPLEMENTED',
      '当前只支持本地 mock 结果注入，尚未接入真实模型。',
      501,
    );
  }

  // ---- 4. 必须提供 result ----
  if (payload.result === undefined) {
    return errorResponse('MISSING_RESULT', '缺少 result 字段。', 400);
  }

  // ---- 5. 运行时校验 ----
  const validated = validateExtractionPayload(payload.result);
  if (!validated.ok) {
    // 直接透传校验模块的稳定错误码，不附加内部细节
    return errorResponse(validated.code, validated.message, 422);
  }

  // ---- 6. 组装字段并返回 ----
  // 来源在此处显式赋值（不是校验模块给的）：
  // 本接口是 mock 注入，因此一律 'mock'，绝不冒用 'model'。
  // confidence 固定 'unknown'（没有经过校准的置信度来源），
  // confirmed 固定 false（是否确认只能由用户操作产生）。
  const fields: ExtractedField[] = validated.fields.map((field) => ({
    ...field,
    confidence: 'unknown',
    source: RESPONSE_SOURCE,
    confirmed: false,
  }));

  return NextResponse.json({
    success: true,
    source: RESPONSE_SOURCE,
    fields,
  });
}

/**
 * GET /api/extract
 *
 * 本接口只写不读：没有可查询的状态，返回 405 并给出标准错误信封，
 * 便于前端在误用时拿到一致的形状，而不是 Next 默认的空响应。
 */
export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: '该接口只接受 POST 请求。',
      },
    },
    { status: 405, headers: { Allow: 'POST' } },
  );
}

/**
 * 不实现 PUT / PATCH / DELETE。
 * 未导出对应处理函数时，Next.js 会自动对这些方法返回 405。
 */
