# 历史内容整理只读预览

给站主和 Lead 在清理历史内容前看的一份清单：哪些**精选**可能指向同一件事、哪些**成员消息**现在被放错在日常分区。它只提出人工复核项，**不合并、不改分类、不写数据库、不通知任何人**。真正的修改要另开一个经确认的改动。日期纠错不由相似度工具自动推断：另附逐条核对原文的人工清单，区分错误日期、截止方向和官方真实改期；本轮实例见交付的“优先人工确认清单”。

```
scripts/export-content-review.sql   →   JSONL   →   scripts/preview-content-review.ts   →   JSON + Markdown
（有库权限的人只读导出）                 （离线）       （不连库、不联网）                    （人工复核）
```

这个预览工具本身不连线上库：导出由 Lead 在能连库的机器上执行，再把文件交给 CLI。CLI 只读输入文件、只写输出目录。

## 文件

| 文件 | 作用 |
|---|---|
| `packages/backend/src/operations/content-review.ts` | 纯函数：`buildContentReview`、`parseReviewRows`、`renderContentReviewMarkdown`，以及 `ReviewRow` 等类型 |
| `scripts/export-content-review.sql` | 只读导出：公开精选 + 最近 7 天成员账号，最多 2500 行，输出 JSONL |
| `scripts/preview-content-review.ts` | 离线 CLI：读 JSONL，写 `content-review.json` 与 `content-review.md` |
| `tests/content-review.test.ts` | 单元测试：去重候选、日常分区、输入不变、输入校验、Markdown 转义、SQL 契约 |

## 用法

### 1. 只读导出（Lead 执行）

在能连目标库的机器上（生产只读账号或本地副本都可以）：

```bash
psql "$DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
  -f scripts/export-content-review.sql > /tmp/content-review.rows.jsonl
```

`-q` 不能省：否则 psql 会把 `SET` / `BEGIN` / `COMMIT` 的命令标签也写进 stdout，CLI 会把它们当成坏行。`-A -t` 让每一行是一个紧凑的 JSON 对象。SQL 自己会：

- `SET default_transaction_read_only = on`，再 `BEGIN TRANSACTION READ ONLY`；
- `SET LOCAL statement_timeout = '30s'`、`lock_timeout = '5s'`、`idle_in_transaction_session_timeout = '60s'`；
- 只 `SELECT`，不建临时表、不 `COPY`、不写文件；
- 最多 2500 行，按 `timeline_at DESC` 取最新的。

选行规则：

- **公开精选**：`visibility = 'public'`、`selected`，且已过发布门槛（`visible_after <= now()`）；
- **最近 7 天成员账号**：来源带 `成员` 标签、有 `owner_entity_id`、`participation_mode = 'editorial'`，`timeline_at` 在 7 天内；只取旧日常入口可显示的 X 全文帖子（已入池，或有中文标题/摘要的 daily），含工作消息和纯转帖。未入池且非 daily 的帖子不计作“从日常移出”；成员分支同样遵守 `visible_after` 发布门槛；
- 两类都只取 `visibility = 'public'`，所以 `withdrawn` 与 `summary-only` 不会出现。

### 2. 生成预览（本工具，离线）

```bash
bun scripts/preview-content-review.ts \
  --input /tmp/content-review.rows.jsonl \
  --out-dir .data/content-review
```

输出：

- `.data/content-review/content-review.json`：结构化结果，含候选、日常分区、每条候选的两侧证据；
- `.data/content-review/content-review.md`：给人读的安全 Markdown。

`.data/` 已在 `.gitignore` 里。命令不连数据库、不发 HTTP 请求、不调用模型、不写数据库；只读 `--input`，只写 `--out-dir`。

### 输入格式

一行一个 `ReviewRow` JSON，也接受一个 JSON 数组（方便手写小样本）：

```json
{"id":"a1","title":"…","summary":"…","category":"ticket","selected":true,"eligible":true,"factId":12,"factPublicId":"…","factVersion":2,"scope":"single","member":true,"retweet":false,"quotedUrl":"https://x.com/…","originalUrl":"https://…","sourceName":"官方","body":"…","revision":3,"timelineAt":"…"}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 文章 id |
| `title` / `summary` | string / string\|null | 公开中文标题、摘要 |
| `category` | string\|null | 公开分类；`daily` 是日常 |
| `selected` / `eligible` | boolean | 精选 / 入池 |
| `factId` | integer\|null | 内部事实 id；没有事实时为 null |
| `factPublicId` / `factVersion` | string\|null, integer\|null | 事实公共 id 与版本，复核时可读 |
| `scope` | `single` / `composite` / `unknown` | 最近一次分析的范围 |
| `member` | boolean | 成员账号（与 `publication/scope.ts` 的 `memberSourceCondition` 同一条件） |
| `retweet` | boolean | 纯转帖（`x_post.retweetedBy` 是对象） |
| `quotedUrl` | string\|null | 引用的原帖地址 |
| `originalUrl` | string | 原文地址 |
| `sourceName` | string | 来源名 |
| `body` | string | 原文正文，导出时截断到 6000 字符 |
| `revision` | integer | 文章修订号 |
| `timelineAt` | string\|null | 时间线时间 |

`parseReviewRows` 会逐行校验：未知字段丢弃，缺字段、类型不对、尾随字符都带行号报错，不会静默产出一份看起来正常、实际缺数据的预览。

## 复核规则

### 精选：只提示，不判定重复

`duplicateCandidates` 只比较双方都已入选的报道，不把未入选旁证算作重复精选卡；每条 `status` 都是 `needs-review`。任何一条都不会被自动合并，也不会被写成“重复”。原因按强度取一个：

| `reason` | 触发条件 | 含义 |
|---|---|---|
| `shared-quote` | 两条内容引用同一个 `quotedUrl` | 同引用是重合证据，不是同一事实；后续进展可以引用原公告 |
| `similar-title` | 标题规范化（NFKC、小写、去 URL/标点/符号）后完全相同，或 Dice 相似度 ≥ 0.90 且长度足够 | 只说明标题像，不等于同一件事 |

**同一事实且两条都是 `single` 的 pair 会被排除**：精选座位已经把它们折叠成一条，没有剩余的人工动作。正常 composite 投影没有主事实 id，因此不声称能仅靠 `factId` 找出综合稿与单篇的关系；这类仍需同引用或相似标题证据，漏召回时人工补充。

每个候选保留两侧的：`id`、标题、摘要、原文链接、来源、事实 id / 公共 id / 版本、修订号、`scope`、`timelineAt`。`similarity` 只在 `similar-title` 时给出。

### 日常：成员分区

只处理 `member = true` 的行：

| 结果 | 条件 | 预览动作 |
|---|---|---|
| `keep` | 分类是 `daily` | 保留在日常 |
| `removeWork` | 不是 `daily` | 移出日常（工作消息只走消息侧） |
| `removeReposts` | `retweet = true` | 排除（纯转帖不进日常，优先于分类） |
| `review` | 分类是 `daily`，但 `selected` 或 `eligible` 为真 | **只提示人工检查**：可能含实质工作信息，本次不改分类 |

`review` 是信号冲突提示，不是重分类决定。工具不读正文语义，判断不了“感想 / 自拍 / 幕后日常”与“有实质工作信息的混合帖”；这类重分类必须人工看原帖后另做。没有 `selected` / `eligible` 标记的 daily 帖不会出现在提示里，所以 `review` 为空不代表日常一定干净。

输入行不会被修改（测试会对比 JSON 前后），`buildContentReview` 只读不写。

## 输出

`content-review.json`：

```json
{
  "generatedAt": "…",
  "input": "…",
  "rowCount": 6,
  "duplicateCandidates": [{ "a": "…", "b": "…", "reason": "shared-quote", "status": "needs-review", "evidence": { "a": {}, "b": {} } }],
  "dailyLane": {
    "keep": ["…"],
    "removeWork": ["…"],
    "removeReposts": ["…"],
    "review": [{ "id": "…", "reason": "…" }],
    "evidence": []
  },
  "counts": {}
}
```

`content-review.md` 分两节：候选（每条带状态、原因、说明和两侧证据）与日常分区（保留 / 移出工作消息 / 排除纯转帖 / 仅提示人工检查）。所有行文本先转义：`<`、`>`、`&`、反引号、Markdown 链接/强调符号都不能生效；换行压成空格。**只有 `http:` / `https:` 地址会渲染成链接**，`javascript:`、`data:` 等协议按纯文本代码显示并标注“未渲染”。标题里的 `<script>` 或摘要里的 `[x](javascript:…)` 都只会是字面文本。

## 测试

```bash
DATABASE_URL=postgres://postgres:local-test-only@127.0.0.1:15439/girlsbands_test \
  bun tests/run.ts tests/content-review.test.ts
```

当前结果：`8 pass, 0 fail`。包含 Lead 写的 3 个验收用例（不同事实的相似标题、不同进展的同引用、日常分区与输入不变）与 5 个补充用例（同一事实但未折叠、日常冲突只提示、Markdown/HTML 与非 HTTP 链接、JSONL 校验、SQL 只读与列契约）。

本机验证 SQL 时用的是隔离 Docker 测试库 `girlsbands-repair-test-db`（127.0.0.1:15439）里的临时库；样例输出写在 `.data/content-review-smoke/`（gitignored），只用于冒烟，不是生产数据。

## 限制

- **不做语义去重**：只看标题形状、同引用、同事实。换一种说法讲同一件事会漏；标题相近的两件事会多报。所有候选都要人看。
- **不判断日常内容类型**：`review` 只看 `daily` 与精选/入池标记的冲突，不判断感想、自拍、幕后或混合帖；`review` 为空不等于日常已清理干净。
- **导出有上限**：最多 2500 行、按最新排序；更早的精选不会进入这次预览。正文只取前 6000 字符。
- **`scope` 取最近一次分析**，缺失记 `unknown`。没有分析记录的老数据会因此按“未折叠”进入同事实候选，这是保守行为，不是合并建议。
- **导出由 Lead 执行**：本工具和本实现不连接线上库、不读取生产数据；CLI 无网络、无数据库写入。
- **预览不改任何东西**：要把某条候选合并、把某条消息移出日常或改分类，需要另开一个明确批准的改动，并保留原文与版本记录。
