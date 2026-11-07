#!/usr/bin/env node
/**
 * validate-vision-result.mjs —— 纯本地 JSON 响应校验器（阶段 4.2b）
 *
 * ============================================================================
 * 用途与边界
 * ============================================================================
 * 只读取本地 JSON 文件（模型响应样例或手工构造的 mock 提取文件），
 * 按约定校验字段结构与格式，并与 scripts/fixtures/vision-probe-expected.json
 * 中对应样例的期望值做比对。
 *
 * **硬性边界**：
 *   - 不联网、不加载密钥、不读取 .env.local；
 *   - 不调用任何模型或服务；
 *   - 校验对象是本地 JSON，不是真实模型识别结果；
 *   - mock 文件的匹配结论**不代表**模型识别准确率；
 *   - 不校验模型置信度、用户确认等界面字段（那是 4.2a 的 UI 概念）。
 *
 * ============================================================================
 * 校验规则（与阶段 4.2b 约定一致）
 * ============================================================================
 *   1. 输入必须是有效 JSON；
 *   2. 顶层必须是非 null、非数组的对象；
 *   3. 五个字段（merchantName / itemName / amount / transactionDate / orderId）
 *      必须全部存在；
 *   4. 每个字段只能是 string 或 null；
 *   5. 数字、布尔、数组、对象等错误类型必须明确报错，不能静默转成 null；
 *   6. 空字符串或仅空白字符串报告为不符合约定；
 *   7. 多余字段明确报告，不静默丢弃；
 *   8. amount 格式：^\d+\.\d{2}$（不含货币前缀，保留两位小数）；
 *      transactionDate 格式：^\d{4}-\d{2}-\d{2}$；
 *      格式正确不等于内容真实；
 *   9. 与期望样例逐字段比对，报告匹配 / 差异 / 「应为 null 却返回有值」；
 *  10. 验证失败返回非零退出码。
 *
 * ============================================================================
 * 用法
 * ============================================================================
 *   node scripts/validate-vision-result.mjs <json 文件> <样例 id>
 *   node scripts/validate-vision-result.mjs <json 文件> --list
 *
 * 退出码：
 *   0  校验通过
 *   2  用法错误（缺参数、样例 id 不存在）
 *   3  文件读取失败
 *   4  结构校验失败
 *   5  与期望值比对不匹配
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 允许的五个字段，顺序即展示顺序。 */
const FIELD_KEYS = [
  'merchantName',
  'itemName',
  'amount',
  'transactionDate',
  'orderId',
];

/** 期望值文件（相对仓库根目录）。 */
const EXPECTED_FILE = resolve(process.cwd(), 'scripts/fixtures/vision-probe-expected.json');

// ---------------------------------------------------------------------------
// 输出辅助
// ---------------------------------------------------------------------------

const problems = [];

/** 记录一个错误。 */
function fail(message) {
  problems.push({ level: '错误', message });
  process.stderr.write(`  [错误] ${message}\n`);
}

/** 记录一个提醒（不计入失败）。 */
function warn(message) {
  process.stderr.write(`  [提醒] ${message}\n`);
}

/** 输出一行信息。 */
function info(message) {
  process.stdout.write(`  ${message}\n`);
}

/** 输出用法说明。 */
function printUsage() {
  process.stdout.write(
    '用法：node scripts/validate-vision-result.mjs <json 文件> <样例 id>\n'
      + '      node scripts/validate-vision-result.mjs <json 文件> --list\n',
  );
}

// ---------------------------------------------------------------------------
// 样例解析
// ---------------------------------------------------------------------------

/**
 * 读取期望值文件，返回按 id 索引的 Map。
 * 只读一次；文件本身是仓库内的静态 fixture，不含敏感信息。
 */
function loadExpected() {
  let raw;
  try {
    raw = readFileSync(EXPECTED_FILE, 'utf8');
  } catch (err) {
    process.stderr.write(`[错误] 无法读取期望值文件：${EXPECTED_FILE}\n`);
    process.stderr.write(`       ${err && err.code ? err.code : err}\n`);
    process.exit(3);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write('[错误] 期望值文件不是有效 JSON。\n');
    process.exit(3);
  }

  const map = new Map();
  if (parsed && Array.isArray(parsed.samples)) {
    for (const sample of parsed.samples) {
      if (sample && typeof sample.id === 'string') {
        map.set(sample.id, sample);
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// 结构校验（对应规则 1–7）
// ---------------------------------------------------------------------------

/**
 * 校验顶层结构与字段类型。
 * 返回 true 表示结构层面已通过；false 表示存在结构错误（已逐条记录）。
 */
function validateStructure(data) {
  // ---- 规则 2：顶层必须是非 null、非数组对象 ----
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    const kind = data === null ? 'null' : Array.isArray(data) ? '数组' : typeof data;
    fail(`顶层必须是 JSON 对象，实际是 ${kind}。`);
    return false;
  }

  // ---- 规则 3：五个字段必须全部存在 ----
  const missingKeys = FIELD_KEYS.filter((key) => !(key in data));
  if (missingKeys.length > 0) {
    fail(`缺少必需字段：${missingKeys.join('、')}。`);
  }

  // ---- 规则 7：多余字段明确报告 ----
  const allowed = new Set(FIELD_KEYS);
  const extraKeys = Object.keys(data).filter((key) => !allowed.has(key));
  for (const key of extraKeys) {
    fail(`存在多余字段「${key}」，校验器不会静默丢弃它。`);
  }

  // ---- 规则 4 + 5：只能是 string 或 null，其他类型明确报错 ----
  for (const key of FIELD_KEYS) {
    if (!(key in data)) continue; // 缺键已在上面报告

    const value = data[key];
    const type = value === null ? 'null' : typeof value;

    if (type === 'string') {
      // ---- 规则 6：空字符串或仅空白 ----
      if (value.trim() === '') {
        fail(`字段「${key}」是空字符串或仅空白，不符合约定；应为具体值或 null。`);
      }
    } else if (type === 'null') {
      // 合法
    } else {
      // ---- 规则 5：错误类型必须明确报错，不静默转 null ----
      const typeNames = {
        number: '数字',
        boolean: '布尔',
        object: '对象',
        undefined: 'undefined',
        function: '函数',
        symbol: 'symbol',
        bigint: 'bigint',
      };
      fail(`字段「${key}」类型是${typeNames[type] ?? type}，只允许 string 或 null。`);
    }
  }

  return missingKeys.length === 0 && extraKeys.length === 0;
}

// ---------------------------------------------------------------------------
// 格式校验（对应规则 8）
// ---------------------------------------------------------------------------

/** amount 必须是不含货币前缀、保留两位小数的字符串。 */
function validateAmount(value) {
  if (typeof value !== 'string') return; // 类型错误已在结构校验中报告
  if (!/^\d+\.\d{2}$/.test(value)) {
    fail(`字段「amount」格式不符：期望「数字.两位小数」（例如 199.00），实际「${value}」。`);
  }
}

/** transactionDate 必须是 YYYY-MM-DD 字符串或 null。 */
function validateTransactionDate(value) {
  if (typeof value !== 'string') return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`字段「transactionDate」格式不符：期望 YYYY-MM-DD，实际「${value}」。`);
  }
}

// ---------------------------------------------------------------------------
// 与期望样例比对（对应规则 9）
// ---------------------------------------------------------------------------

/**
 * 与期望样例逐字段比对。
 * 返回 true 表示全部匹配。
 */
function compareWithExpected(data, expected) {
  let allMatch = true;

  for (const key of FIELD_KEYS) {
    if (!(key in data)) continue; // 缺键已在结构校验中报告

    const actual = data[key];
    const want = expected[key];

    if (actual === want) {
      const shown = actual === null ? 'null' : `「${actual}」`;
      info(`  ${key.padEnd(18)} 匹配 ${shown}`);
      continue;
    }

    // ---- 应为 null 却返回有值：单独强调 ----
    if (want === null && actual !== null) {
      fail(
        `字段「${key}」应为 null（样例中该字段未印刷），实际返回「${actual}」。`
          + '这是把图中没有的信息编造出来的典型表现，必须报告。',
      );
      allMatch = false;
      continue;
    }

    // ---- 值不一致 ----
    fail(
      `字段「${key}」不匹配：期望「${want === null ? 'null' : want}」，实际「${actual === null ? 'null' : actual}」。`,
    );
    allMatch = false;
  }

  return allMatch;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length === 0 ? 2 : 0);
  }

  const filePath = args[0];
  const sampleId = args[1];

  if (!filePath || filePath.startsWith('--')) {
    printUsage();
    process.exit(2);
  }

  const expectedMap = loadExpected();

  if (sampleId === '--list') {
    process.stdout.write('可用样例：\n');
    for (const [id, sample] of expectedMap) {
      process.stdout.write(`  ${id}  (${sample.imageFile ?? '未知文件'})\n`);
    }
    process.exit(0);
  }

  if (typeof sampleId !== 'string' || sampleId === '') {
    printUsage();
    process.stderr.write('[错误] 缺少样例 id。\n');
    process.exit(2);
  }

  const expected = expectedMap.get(sampleId);
  if (expected === undefined) {
    process.stderr.write(`[错误] 样例 id「${sampleId}」不存在。可用样例：\n`);
    for (const id of expectedMap.keys()) {
      process.stderr.write(`  ${id}\n`);
    }
    process.exit(2);
  }

  // ---- 规则 1：读取并解析 JSON ----
  let raw;
  try {
    raw = readFileSync(resolve(filePath), 'utf8');
  } catch (err) {
    process.stderr.write(`[错误] 无法读取文件「${filePath}」。\n`);
    process.stderr.write(`       ${err && err.code ? err.code : err}\n`);
    process.exit(3);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    fail(`文件不是有效 JSON：${err && err.message ? err.message : err}`);
    printSummary();
    process.exit(4);
  }

  // ---- 标题 ----
  process.stdout.write(`\n校验目标：${filePath}\n`);
  process.stdout.write(`对比样例：${sampleId}\n`);
  process.stdout.write('-'.repeat(60) + '\n');

  // ---- 结构与格式 ----
  const structureOk = validateStructure(data);

  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    validateAmount(data.amount);
    validateTransactionDate(data.transactionDate);
  }

  // ---- 与期望比对 ----
  let matchOk = true;
  if (structureOk) {
    process.stdout.write('\n与期望样例比对：\n');
    matchOk = compareWithExpected(data, expected);
  }

  printSummary();

  // ---- 规则 10：失败返回非零退出码 ----
  if (!structureOk) process.exit(4);
  if (!matchOk) process.exit(5);
}

/** 输出汇总并返回。 */
function printSummary() {
  process.stdout.write('-'.repeat(60) + '\n');
  if (problems.length === 0) {
    process.stdout.write('校验通过：结构与格式均符合约定，且与期望样例一致。\n');
    process.stdout.write('注意：这是对本地 JSON 的校验结论，不代表任何模型识别能力。\n');
  } else {
    process.stdout.write(`校验未通过：共 ${problems.length} 项错误。\n`);
  }
}

main();
