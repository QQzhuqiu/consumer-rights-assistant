/**
 * 「AI 事实整理摘要」的 prompt 与运行时校验（阶段 7）。
 *
 * ============================================================================
 * 本模块是两个"闸门"
 * ============================================================================
 *   1. **入口闸门**：`validateAISummaryInput` —— 客户端传来的输入是不可信的，
 *      必须逐字段校验、限长、限条数，并**拒绝一切未定义的键**。
 *      这一步同时承担了「拒绝客户端覆盖模型名 / 接口地址 / system prompt」的职责：
 *      因为 `model`、`url`、`system` 这类键都不在白名单里，会被直接拒绝，
 *      服务端使用的模型名与地址是**代码里的常量**，不接受任何外部指定。
 *   2. **出口闸门**：`validateAISummaryOutput` —— 模型返回的 JSON 同样不可信，
 *      必须校验结构、限长，并做一次**范围很窄**的措辞筛查。
 *
 * ============================================================================
 * 关于措辞筛查的能力边界（必须如实说明）
 * ============================================================================
 * `FORBIDDEN_OUTPUT_PATTERNS` 只是一组**窄关键词**，用来在模型明显越界时拒绝整份输出、
 * 退回本地整理结果。它：
 *   · **不是**内容安全过滤器，**不能**保证拦住所有越界表述；
 *   · 会产生**误杀**——如果用户原文里就写了「投诉」，模型忠实引用时也会被拒；
 *   · 拒绝的代价是可接受的（退回本地结果），所以这里选择「宁可拒绝」。
 *
 * 本文件是纯模块：不发网络请求、不读环境变量、不写存储、不引入第三方依赖。
 */

import { FIELD_LABELS } from '@/types/extraction';
import {
  AI_SUMMARY_LIMITS,
  AI_SUMMARY_SENDABLE_FIELD_KEYS,
  AI_SUMMARY_USER_CONTEXT_KEYS,
  AI_SUMMARY_USER_CONTEXT_LABELS,
} from '@/types/ai-summary';
import type {
  AISummaryConfirmedField,
  AISummaryInput,
  AISummaryMaterialItem,
  AISummaryTimelineItem,
  AISummaryUserContext,
  AISummaryUserContextKey,
} from '@/types/ai-summary';
import { MERCHANT_RESPONSE_OPTIONS, RESOLUTION_OPTIONS } from '@/types/user-case';

/* ==========================================================================
 * System prompt
 * ========================================================================== */

/**
 * 系统提示词。
 *
 * 必须包含 `json` 字样与 JSON 示例——这是官方 JSON Output 的硬性要求，
 * 否则模型可能返回非 JSON 内容（官方文档明确说明此时非 JSON 部分
 * 会被替换为空格，`content` 看起来会是空的）。
 */
export const SYSTEM_PROMPT = `你是「凭证明白」的事实整理助手。你的唯一任务是把用户提供的既有信息整理成结构化的 JSON 摘要。

严格边界（任何情况下都必须遵守）：
1. 只整理输入中已经存在的信息，不得补充、推测、联想或虚构任何事实。
2. 必须区分两类来源：「凭证字段」与「用户填写」，不得混为一谈，也不得把用户填写的内容说成已确认的凭证信息。
3. 不得判断商家是否违法、是否违反约定、是否存在过错或欺诈。
4. 不得认定责任归属，不得说「责任在谁」。
5. 不得判断用户是否有权退款、换货、维修或获得赔偿。
6. 不得提供投诉、起诉、诉讼、仲裁、举报或维权建议。
7. 不得预测任何结果或成功率。
8. 不得引用、生成或暗示任何法律条文、法规名称或法律意见。
9. 不得生成投诉函、起诉状、申诉材料或其他材料的正文。
10. 不得改写、润色、覆盖用户的原始陈述，也不得替用户确认任何信息。
11. 输出仅用于信息整理，不是法律意见，也不能替代专业人士。

你必须只输出一个 JSON 对象，不要输出 Markdown 代码块，不要输出任何解释性文字。

输出 JSON 的形状必须严格如下：
{
  "summary": "一段忠实概括，只覆盖输入中已有的信息，不超过 300 字",
  "knownInfo": [
    "凭证字段：商家名称 — 合成测试商城",
    "用户填写：事情经过 — 用户原文的忠实摘要"
  ],
  "unknownInfo": [
    "交易日期：尚未确认"
  ],
  "suggestions": [
    "可以补充发现问题的时间或阶段"
  ]
}

各字段要求：
- summary：字符串。只概括输入里已有的信息，不添加任何新事实。
- knownInfo：字符串数组。每条**必须**以「凭证字段：」或「用户填写：」开头，以便区分来源。
- unknownInfo：字符串数组。只列出输入中缺失、未确认或未选择发送的内容，不要推测它们的值。
- suggestions：字符串数组。只能是「补充哪类事实信息会更完整」这类提示，绝对不能是法律建议、维权建议或结果预测。
- 如果输入内容很少，就如实输出很少的内容；不要为了凑长度而扩写。`;

/* ==========================================================================
 * 用户提示词
 * ========================================================================== */

/** 把「商家是否回应」的取值翻译成中文标签。 */
function merchantResponseLabel(value: string | undefined): string | null {
  if (value === undefined) return null;
  const option = MERCHANT_RESPONSE_OPTIONS.find((item) => item.value === value);
  return option?.label ?? null;
}

/** 把「希望如何处理」的取值翻译成中文标签。 */
function resolutionLabel(value: string | undefined): string | null {
  if (value === undefined) return null;
  const option = RESOLUTION_OPTIONS.find((item) => item.value === value);
  return option?.label ?? null;
}

/**
 * 把已经校验过的输入渲染成用户提示词。
 *
 * 只做排版，不做任何加工：值来自输入，标签只是把枚举取值换成中文。
 * 明确标注「以下均为用户既有信息」，避免模型把它当成待办清单去补全。
 */
export function buildUserPrompt(input: AISummaryInput): string {
  const lines: string[] = [];

  lines.push('以下是从页面收集到的既有信息，请不要补充任何输入之外的内容。');
  lines.push('');

  // ---- 已确认凭证字段 ----
  lines.push('【已确认凭证字段】');
  if (input.confirmedFields.length === 0) {
    lines.push('- （无）');
  } else {
    for (const field of input.confirmedFields) {
      lines.push(`- ${field.label}：${field.value}`);
    }
  }
  lines.push('');

  // ---- 用户填写陈述 ----
  lines.push('【用户填写的事实陈述】');
  const sentEntries = AI_SUMMARY_USER_CONTEXT_KEYS.filter(
    (key) => input.userContext[key] !== undefined,
  );
  if (sentEntries.length === 0) {
    lines.push('- （无）');
  } else {
    for (const key of sentEntries) {
      const raw = input.userContext[key] ?? '';
      if (key === 'merchantResponseStatus') {
        const label = merchantResponseLabel(raw);
        lines.push(`- ${AI_SUMMARY_USER_CONTEXT_LABELS[key]}：${label ?? raw}`);
        continue;
      }
      if (key === 'desiredResolution') {
        const label = resolutionLabel(raw);
        lines.push(`- ${AI_SUMMARY_USER_CONTEXT_LABELS[key]}：${label ?? raw}`);
        continue;
      }
      lines.push(`- ${AI_SUMMARY_USER_CONTEXT_LABELS[key]}：${raw}`);
    }
  }
  lines.push('');

  // ---- 用户未选择发送的栏 ----
  if (input.userSkippedKeys.length > 0) {
    lines.push('【用户未选择发送的陈述栏】');
    for (const key of input.userSkippedKeys) {
      lines.push(`- ${AI_SUMMARY_USER_CONTEXT_LABELS[key]}`);
    }
    lines.push(
      '（这些栏目的内容没有提供给你，请在 unknownInfo 中如实标为「本次未选择发送」，不要猜测其内容。）',
    );
    lines.push('');
  }

  // ---- 本地整理的时间线 ----
  lines.push('【事实时间线（本地整理，仅供整理参考）】');
  if (input.timeline.length === 0) {
    lines.push('- （无）');
  } else {
    for (const item of input.timeline) {
      const sourceText = item.source === 'evidence' ? '凭证字段' : '用户填写';
      lines.push(`- ${item.label}：${item.value}（来源：${sourceText}，状态：${item.status}）`);
    }
    lines.push(
      '（时间线只按固定顺序罗列，不代表事件实际先后，不要据此推断因果关系。）',
    );
  }
  lines.push('');

  // ---- 本地整理的材料清单 ----
  lines.push('【材料记录清单（本地整理，仅表示用户原文是否提到）】');
  if (input.materials.length === 0) {
    lines.push('- （无）');
  } else {
    for (const item of input.materials) {
      const statusText =
        item.status === 'mentioned' ? '原文中提到' : '原文中未提到';
      lines.push(`- ${item.label}：${statusText}（${item.note}）`);
    }
    lines.push(
      '（「原文中未提到」只说明用户这次没写到，不代表用户没有这份材料。）',
    );
  }
  lines.push('');

  lines.push('请按系统提示词要求的 JSON 结构输出整理结果。');

  return lines.join('\n');
}

/* ==========================================================================
 * 入口校验
 * ========================================================================== */

/** 校验结果：成功时给出规范化输入，失败时给出稳定错误码。 */
export type AISummaryInputValidation =
  | { ok: true; input: AISummaryInput }
  | { ok: false; code: string; message: string };

/** 顶层允许出现的键。**任何**其它键都会被拒绝。 */
const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'confirmedFields',
  'userContext',
  'userSkippedKeys',
  'timeline',
  'materials',
]);

/** 凭证字段条目允许出现的键。 */
const ALLOWED_FIELD_KEYS = new Set(['key', 'label', 'value']);

/** 时间线条目允许出现的键。 */
const ALLOWED_TIMELINE_KEYS = new Set(['label', 'value', 'source', 'status']);

/** 材料条目允许出现的键。 */
const ALLOWED_MATERIAL_KEYS = new Set(['label', 'note', 'status']);

/** 可发送凭证字段键的集合，用于快速判定。 */
const SENDABLE_FIELD_KEYS = new Set<string>(AI_SUMMARY_SENDABLE_FIELD_KEYS);

/** 可发送用户陈述键的集合。 */
const USER_CONTEXT_KEY_SET = new Set<string>(AI_SUMMARY_USER_CONTEXT_KEYS);

/** 窄范围判定：非 null、非数组的对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 构造失败结果。 */
function failInput(
  code: string,
  message: string,
): AISummaryInputValidation {
  return { ok: false, code, message };
}

/** 判断对象是否只包含白名单中的键。 */
function hasOnlyAllowedKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

/**
 * 校验并规范化客户端提交的 AI 摘要输入。
 *
 * 失败时**不回显**调用方传入的键名或值，避免把请求内容反射回去。
 * 所有文本都会 `trim` 并按上限截断，不会原样转发超长内容。
 */
export function validateAISummaryInput(
  value: unknown,
): AISummaryInputValidation {
  if (!isRecord(value)) {
    return failInput('NOT_OBJECT', '请求体必须是一个 JSON 对象。');
  }

  // ---- 顶层键白名单 ----
  // 这一条同时挡住了 client 传入 model / url / systemPrompt 之类的覆盖尝试。
  if (!hasOnlyAllowedKeys(value, ALLOWED_TOP_LEVEL_KEYS)) {
    return failInput(
      'EXTRA_FIELD',
      '请求包含未定义的顶层字段；模型名、接口地址与系统提示词均由服务端固定，不接受客户端指定。',
    );
  }

  // ---- confirmedFields ----
  const rawFields = value.confirmedFields;
  if (!Array.isArray(rawFields)) {
    return failInput('MISSING_CONFIRMED_FIELDS', '缺少 confirmedFields 数组。');
  }
  if (rawFields.length > AI_SUMMARY_LIMITS.confirmedFields) {
    return failInput(
      'TOO_MANY_FIELDS',
      `已确认凭证字段最多 ${AI_SUMMARY_LIMITS.confirmedFields} 条。`,
    );
  }

  const confirmedFields: AISummaryConfirmedField[] = [];
  const seenFieldKeys = new Set<string>();

  for (const rawField of rawFields) {
    if (!isRecord(rawField)) {
      return failInput('INVALID_FIELD', '凭证字段条目必须是一个对象。');
    }
    if (!hasOnlyAllowedKeys(rawField, ALLOWED_FIELD_KEYS)) {
      return failInput('INVALID_FIELD', '凭证字段条目包含未定义的字段。');
    }

    const key = rawField.key;
    const label = rawField.label;
    const fieldValue = rawField.value;

    if (typeof key !== 'string' || !SENDABLE_FIELD_KEYS.has(key)) {
      // orderId 等不在白名单的键会走到这里，明确拒绝而不是静默丢弃
      return failInput(
        'FIELD_NOT_ALLOWED',
        '该凭证字段不在允许发送的范围内（订单号本轮不支持发送）。',
      );
    }
    if (seenFieldKeys.has(key)) {
      return failInput('DUPLICATE_FIELD', '凭证字段重复。');
    }
    if (typeof label !== 'string' || label.trim() === '') {
      return failInput('INVALID_FIELD', '凭证字段缺少标签。');
    }
    if (typeof fieldValue !== 'string' || fieldValue.trim() === '') {
      return failInput('INVALID_FIELD', '凭证字段的值必须是非空字符串。');
    }

    seenFieldKeys.add(key);
    confirmedFields.push({
      key,
      label: label.trim().slice(0, 40),
      value: fieldValue.trim().slice(0, AI_SUMMARY_LIMITS.confirmedFieldValue),
    });
  }

  // ---- userContext ----
  const rawContext = value.userContext;
  if (!isRecord(rawContext)) {
    return failInput('MISSING_USER_CONTEXT', '缺少 userContext 对象。');
  }
  const userContext: AISummaryUserContext = {};
  for (const [key, rawValue] of Object.entries(rawContext)) {
    if (!USER_CONTEXT_KEY_SET.has(key)) {
      return failInput('INVALID_USER_CONTEXT', '用户陈述包含未定义的字段。');
    }
    if (typeof rawValue !== 'string') {
      return failInput('INVALID_USER_CONTEXT', '用户陈述字段必须是字符串。');
    }
    const trimmed = rawValue.trim();
    if (trimmed === '') continue; // 空串等同于没提供
    userContext[key as AISummaryUserContextKey] = trimmed.slice(
      0,
      AI_SUMMARY_LIMITS.userContextValue,
    );
  }

  // ---- userSkippedKeys ----
  const rawSkipped = value.userSkippedKeys;
  const userSkippedKeys: AISummaryUserContextKey[] = [];
  if (rawSkipped !== undefined) {
    if (!Array.isArray(rawSkipped)) {
      return failInput('INVALID_SKIPPED', 'userSkippedKeys 必须是数组。');
    }
    if (rawSkipped.length > AI_SUMMARY_USER_CONTEXT_KEYS.length) {
      return failInput('INVALID_SKIPPED', 'userSkippedKeys 条数超出上限。');
    }
    const seen = new Set<string>();
    for (const item of rawSkipped) {
      if (typeof item !== 'string' || !USER_CONTEXT_KEY_SET.has(item)) {
        return failInput('INVALID_SKIPPED', 'userSkippedKeys 含未定义的字段名。');
      }
      if (seen.has(item)) continue;
      seen.add(item);
      userSkippedKeys.push(item as AISummaryUserContextKey);
    }
  }

  // ---- timeline ----
  const rawTimeline = value.timeline;
  const timeline: AISummaryTimelineItem[] = [];
  if (rawTimeline !== undefined) {
    if (!Array.isArray(rawTimeline)) {
      return failInput('INVALID_TIMELINE', 'timeline 必须是数组。');
    }
    if (rawTimeline.length > AI_SUMMARY_LIMITS.timelineItems) {
      return failInput(
        'TOO_MANY_TIMELINE',
        `时间线条目最多 ${AI_SUMMARY_LIMITS.timelineItems} 条。`,
      );
    }
    for (const rawItem of rawTimeline) {
      if (!isRecord(rawItem)) {
        return failInput('INVALID_TIMELINE', '时间线条目必须是一个对象。');
      }
      if (!hasOnlyAllowedKeys(rawItem, ALLOWED_TIMELINE_KEYS)) {
        return failInput('INVALID_TIMELINE', '时间线条目包含未定义的字段。');
      }
      const { label, value: itemValue, source, status } = rawItem;
      if (typeof label !== 'string' || typeof itemValue !== 'string') {
        return failInput('INVALID_TIMELINE', '时间线条目缺少文本。');
      }
      if (source !== 'evidence' && source !== 'user') {
        return failInput('INVALID_TIMELINE', '时间线条目来源必须是 evidence 或 user。');
      }
      if (typeof status !== 'string') {
        return failInput('INVALID_TIMELINE', '时间线条目缺少状态。');
      }
      timeline.push({
        label: label.trim().slice(0, AI_SUMMARY_LIMITS.timelineText),
        value: itemValue.trim().slice(0, AI_SUMMARY_LIMITS.timelineText),
        source,
        status: status.trim().slice(0, 40),
      });
    }
  }

  // ---- materials ----
  const rawMaterials = value.materials;
  const materials: AISummaryMaterialItem[] = [];
  if (rawMaterials !== undefined) {
    if (!Array.isArray(rawMaterials)) {
      return failInput('INVALID_MATERIALS', 'materials 必须是数组。');
    }
    if (rawMaterials.length > AI_SUMMARY_LIMITS.materialItems) {
      return failInput(
        'TOO_MANY_MATERIALS',
        `材料清单条目最多 ${AI_SUMMARY_LIMITS.materialItems} 条。`,
      );
    }
    for (const rawItem of rawMaterials) {
      if (!isRecord(rawItem)) {
        return failInput('INVALID_MATERIALS', '材料条目必须是一个对象。');
      }
      if (!hasOnlyAllowedKeys(rawItem, ALLOWED_MATERIAL_KEYS)) {
        return failInput('INVALID_MATERIALS', '材料条目包含未定义的字段。');
      }
      const { label, note, status } = rawItem;
      if (typeof label !== 'string' || typeof note !== 'string') {
        return failInput('INVALID_MATERIALS', '材料条目缺少文本。');
      }
      if (status !== 'mentioned' && status !== 'not_mentioned') {
        return failInput(
          'INVALID_MATERIALS',
          '材料条目状态必须是 mentioned 或 not_mentioned。',
        );
      }
      materials.push({
        label: label.trim().slice(0, AI_SUMMARY_LIMITS.materialText),
        note: note.trim().slice(0, AI_SUMMARY_LIMITS.materialText),
        status,
      });
    }
  }

  return {
    ok: true,
    input: { confirmedFields, userContext, userSkippedKeys, timeline, materials },
  };
}

/* ==========================================================================
 * 出口校验
 * ========================================================================== */

/** 模型输出的校验结果。 */
export type AISummaryOutputValidation =
  | {
      ok: true;
      summary: string;
      knownInfo: string[];
      unknownInfo: string[];
      suggestions: string[];
    }
  | { ok: false; code: string; message: string };

/**
 * 措辞筛查用的窄关键词表。
 *
 * 只覆盖「明显越界」的说法，命中即整份拒绝并退回本地结果。
 * 如前所述：这不是内容安全过滤器，也不保证拦住所有越界表述。
 */
export const FORBIDDEN_OUTPUT_PATTERNS: readonly RegExp[] = [
  /违法|违反|违约|过错|欺诈|侵权/,
  /责任(归属|在|应)|承担.{0,4}责任/,
  /(有权|可以|应当|应该).{0,6}(退款|赔偿|索赔|退货)/,
  /投诉|起诉|诉讼|仲裁|举报|维权/,
  /成功率|胜诉率|获赔概率/,
  /第.{1,4}条|《[^》]{1,40}》|民法典|消费者权益保护法|产品质量法/,
];

/** 把任意字符串数组规范化：去空白、去空项、限长、限条数。 */
function normalizeList(list: unknown, label: string): string[] | null {
  if (!Array.isArray(list)) return null;
  const result: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') return null;
    const trimmed = item.trim();
    if (trimmed === '') continue;
    result.push(trimmed.slice(0, AI_SUMMARY_LIMITS.listItemLength));
    if (result.length >= AI_SUMMARY_LIMITS.listItems) break;
  }
  void label;
  return result;
}

/**
 * 校验模型返回的 JSON 结构，并做窄范围措辞筛查。
 *
 * 任何一项不通过都返回稳定错误码，由调用方退回本地整理结果。
 * **不返回**模型原始文本，避免把上游内容透传给前端。
 */
export function validateAISummaryOutput(
  value: unknown,
): AISummaryOutputValidation {
  if (!isRecord(value)) {
    return { ok: false, code: 'NOT_OBJECT', message: '模型输出不是 JSON 对象。' };
  }

  // ---- summary ----
  const rawSummary = value.summary;
  if (typeof rawSummary !== 'string') {
    return { ok: false, code: 'MISSING_SUMMARY', message: '模型输出缺少 summary。' };
  }
  const summary = rawSummary.trim();
  if (summary === '') {
    return { ok: false, code: 'EMPTY_SUMMARY', message: '模型输出的 summary 为空。' };
  }

  // ---- 三个列表 ----
  const knownInfo = normalizeList(value.knownInfo, 'knownInfo');
  if (knownInfo === null) {
    return { ok: false, code: 'INVALID_KNOWN', message: '模型输出的 knownInfo 结构不合法。' };
  }
  const unknownInfo = normalizeList(value.unknownInfo, 'unknownInfo');
  if (unknownInfo === null) {
    return { ok: false, code: 'INVALID_UNKNOWN', message: '模型输出的 unknownInfo 结构不合法。' };
  }
  const suggestions = normalizeList(value.suggestions, 'suggestions');
  if (suggestions === null) {
    return { ok: false, code: 'INVALID_SUGGESTIONS', message: '模型输出的 suggestions 结构不合法。' };
  }

  const clippedSummary = summary.slice(0, AI_SUMMARY_LIMITS.summary);

  // ---- 措辞筛查（窄范围，命中即整份拒绝）----
  const combined = [clippedSummary, ...knownInfo, ...unknownInfo, ...suggestions].join('\n');
  for (const pattern of FORBIDDEN_OUTPUT_PATTERNS) {
    if (pattern.test(combined)) {
      return {
        ok: false,
        code: 'BOUNDARY_VIOLATION',
        message: '模型输出涉及本功能不允许的表述，已拒绝并退回本地整理结果。',
      };
    }
  }

  return {
    ok: true,
    summary: clippedSummary,
    knownInfo,
    unknownInfo,
    suggestions,
  };
}

/** 供测试与文档引用：允许发送的凭证字段标签列表。 */
export const SENDABLE_FIELD_LABELS = AI_SUMMARY_SENDABLE_FIELD_KEYS.map(
  (key) => FIELD_LABELS[key],
);

/* ==========================================================================
 * 上游调用（模型契约与传输）
 * ==========================================================================
 * 说明：本轮允许改动的库文件只有 `ai-summary-prompt.ts` 与 `ai-summary-local.ts`，
 * 因此把「模型契约 + 传输封装」放在本文件末尾，并单独成节，便于审查。
 *
 * 这样拆分的实际好处：`requestAISummary` 接受一个**可注入的 fetch**，
 * 于是「HTTP 4xx/5xx」「超时」「空 content」「非 JSON」「finish_reason=length」
 * 这些分支都能用假 fetch 在纯 Node 环境里测到，
 * 不必启动开发服务器、也不必调用真实接口。
 */

/** 上游接口地址。固定常量：不接受任何外部指定。 */
export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

/** 上游模型标识。固定常量：不接受任何外部指定。 */
export const DEEPSEEK_MODEL = 'deepseek-flash';

/** 最小可用的 fetch 形状，便于注入假实现。 */
export type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

/** 上游调用的结果。 */
export type AISummaryCallOutcome =
  | {
      ok: true;
      result: {
        summary: string;
        knownInfo: string[];
        unknownInfo: string[];
        suggestions: string[];
        source: 'ai';
        model: string;
        generatedAt: string;
      };
    }
  | { ok: false; message: string };

/** 失败 / 降级时的统一说明文案（与本地模块保持同一句，避免两处漂移）。 */
const FALLBACK_MESSAGE =
  '真实 AI 摘要生成失败，本次只显示本地整理结果；你的原始输入没有被修改。';

/**
 * 构造请求体。
 *
 * 请求地址、模型名、`response_format`、`max_tokens`、`temperature`、`stream`
 * **全部集中在这里**，不接受调用方或客户端覆盖。
 * 不传 `user_id`：当前没有账号体系，也不用 IP / 设备指纹充当 `user_id`。
 */
export function buildRequestBody(input: AISummaryInput) {
  return {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(input) },
    ],
    response_format: { type: 'json_object' },
    max_tokens: AI_SUMMARY_LIMITS.maxTokens,
    temperature: 0.2,
    stream: false,
  };
}

/**
 * 解释上游返回的 **JSON body**（不含 HTTP 状态判断）。
 *
 * 所有失败路径都归约为 `{ ok: false, message }`，绝不返回上游原始内容。
 */
export function interpretModelResponse(
  body: unknown,
): AISummaryCallOutcome {
  if (!isRecordForResponse(body)) {
    return { ok: false, message: FALLBACK_MESSAGE };
  }

  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return { ok: false, message: FALLBACK_MESSAGE };
  }

  const first = choices[0];
  if (typeof first !== 'object' || first === null || Array.isArray(first)) {
    return { ok: false, message: FALLBACK_MESSAGE };
  }
  const choice = first as Record<string, unknown>;

  // 输出被截断时不能当成功：JSON 很可能不完整
  if (choice.finish_reason === 'length') {
    return {
      ok: false,
      message:
        '模型输出达到长度上限，内容可能不完整，已退回本地整理结果；你的原始输入没有被修改。',
    };
  }

  const message = choice.message;
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return { ok: false, message: FALLBACK_MESSAGE };
  }
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== 'string') {
    return { ok: false, message: FALLBACK_MESSAGE };
  }

  // 空白 content：官方文档明确说明 JSON 模式下可能出现"看起来为空"的情况
  const trimmed = content.trim();
  if (trimmed === '') {
    return {
      ok: false,
      message:
        '模型返回了空白内容，本次只显示本地整理结果；你的原始输入没有被修改。',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      message:
        '模型返回的内容不是合法 JSON，本次只显示本地整理结果；你的原始输入没有被修改。',
    };
  }

  const validated = validateAISummaryOutput(parsed);
  if (!validated.ok) {
    return {
      ok: false,
      message: `${validated.message}（本次只显示本地整理结果。）`,
    };
  }

  return {
    ok: true,
    result: {
      summary: validated.summary,
      knownInfo: validated.knownInfo,
      unknownInfo: validated.unknownInfo,
      suggestions: validated.suggestions,
      source: 'ai',
      model: DEEPSEEK_MODEL,
      generatedAt: new Date().toISOString(),
    },
  };
}

/** 只判断是否为普通对象（内部用，避免与入口校验的同名函数混淆）。 */
function isRecordForResponse(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 调用选项：允许注入假 fetch 与更短的超时，便于测试。 */
export type RequestAISummaryOptions = {
  /** 注入的 fetch 实现；默认使用全局 fetch。 */
  fetchImpl?: FetchLike;
  /** 超时毫秒数；默认取 `AI_SUMMARY_LIMITS.requestTimeoutMs`。 */
  timeoutMs?: number;
};

/**
 * 调用官方 DeepSeek 文本接口并返回校验后的结果。
 *
 * 不抛异常：所有失败路径都归约为 `{ ok: false, message }`。
 * 不记录日志，不返回上游原始响应。
 */
export async function requestAISummary(
  apiKey: string,
  input: AISummaryInput,
  options: RequestAISummaryOptions = {},
): Promise<AISummaryCallOutcome> {
  const fetchImpl: FetchLike = options.fetchImpl ?? (globalThis.fetch as FetchLike);
  const timeoutMs = options.timeoutMs ?? AI_SUMMARY_LIMITS.requestTimeoutMs;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildRequestBody(input)),
      signal: controller.signal,
    });
  } catch {
    const isTimeout = controller.signal.aborted;
    return {
      ok: false,
      message: isTimeout
        ? FALLBACK_MESSAGE
        : '无法连接模型服务，本次只显示本地整理结果；你的原始输入没有被修改。',
    };
  } finally {
    clearTimeout(timer);
  }

  // HTTP 状态检查：非 2xx 一律不当作成功
  if (!response.ok) {
    return {
      ok: false,
      message: `模型服务返回 HTTP ${response.status}，本次只显示本地整理结果；你的原始输入没有被修改。`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, message: FALLBACK_MESSAGE };
  }

  return interpretModelResponse(body);
}
