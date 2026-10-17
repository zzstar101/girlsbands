// Read-only historical content-review preview. It reads an offline JSONL export (produced by
// scripts/export-content-review.sql) and writes JSON + Markdown. It never opens a database, never
// writes to one, never calls the network, and never merges or reclassifies anything.
//
//   bun scripts/preview-content-review.ts --input /tmp/content-review.rows.jsonl \
//     --out-dir .data/content-review
//
// Only http(s) source links are rendered as links; every other scheme stays inert text. All row text
// is escaped before it reaches Markdown, so titles/summaries cannot inject HTML.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildContentReview,
  parseReviewRows,
  renderContentReviewMarkdown,
} from "@girlsbands/backend/operations/content-review";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`历史内容整理只读预览

用法：
  bun scripts/preview-content-review.ts --input <rows.jsonl> [--out-dir .data/content-review]

输入：
  scripts/export-content-review.sql 的 psql 输出（每行一个 ReviewRow JSON），也接受 JSON 数组。

输出：
  <out-dir>/content-review.json  候选与日常分区的结构化结果
  <out-dir>/content-review.md    供人工复核的安全 Markdown

边界：
  不连数据库、不发网络请求、不写数据库、不自动合并或改分类。`);
  process.exit(0);
}

function argument(name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const value = args[i]!;
    if (value === name) return args[i + 1];
    if (value.startsWith(`${name}=`)) return value.slice(name.length + 1);
  }
  return undefined;
}

const inputPath = argument("--input");
const outDir = argument("--out-dir") ?? ".data/content-review";

if (!inputPath) {
  console.error("缺少 --input。用法：bun scripts/preview-content-review.ts --input <rows.jsonl> [--out-dir .data/content-review]");
  process.exit(2);
}

try {
  const text = readFileSync(inputPath, "utf8");
  const rows = parseReviewRows(text);
  const review = buildContentReview(rows);
  const generatedAt = new Date();
  const jsonPath = resolve(outDir, "content-review.json");
  const markdownPath = resolve(outDir, "content-review.md");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    jsonPath,
    `${JSON.stringify({ generatedAt: generatedAt.toISOString(), input: resolve(inputPath), ...review }, null, 2)}\n`,
  );
  writeFileSync(
    markdownPath,
    renderContentReviewMarkdown(review, rows, { generatedAt, input: resolve(inputPath) }),
  );

  console.log(`读取 ${review.rowCount} 行`);
  console.log(`候选 ${review.counts.duplicateCandidates} 组；日常保留 ${review.counts.dailyKeep}，移出工作消息 ${review.counts.dailyRemoveWork}，排除纯转帖 ${review.counts.dailyRemoveReposts}，待人工检查 ${review.counts.dailyReview}`);
  console.log(`JSON：${jsonPath}`);
  console.log(`Markdown：${markdownPath}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`预览失败：${message}`);
  process.exit(1);
}
