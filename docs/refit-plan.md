# 少女乐队's —— 改造计划

> 这份文档是 2026-09 一轮 `/grill-me` 问答的产物：先把项目背景和工程约束重新定死，再据此排出改动清单。
> 所有"定论"都是用户在问答里明确拍板的；"待核实"是还没查证的假设，动手前要先验证。

---

## 一、项目背景（定论）

| 项 | 定论 |
|---|---|
| 站点性质 | 公开情报站。**不做账号、不用注册** |
| 覆盖范围 | **名单制，三个企划**：BanG Dream! / GIRLS BAND CRY / ぼっち・ざ・ろっく。加第四个企划 = 加源 + 加 entity + 加主题，是定义清楚的小任务 |
| 地域范围 | **日本官方源 + 中国大陆同人活动现场**。大陆侧只收「邦O」（BanG Dream! 同人 ONLY）、「刺O」（GIRLS BAND CRY 同人 ONLY）及音乐番 ONLY 活动与其附带 livehouse 演出 |
| 内容品类 | **全品类**，不只票务（`industry/taxonomy.ts` 已有 10 类） |
| 核心卖点 | **中文看全** —— 日文官方源太多，这里中文一次看完。翻译/中文呈现是第一价值；截止雷达、时间线、聚簇精选都是支撑功能 |
| 全文版权 | **不管许可，全都站内全文**，且**给所有人看**（真公开，接受风险） |
| 全文档位 | **精选和全部动态都给全文** |
| 模型预算 | **不限量**。不再把花费当设计约束，但保留 `budgets` 熔断作安全网。配置按质量优先：预筛/评分/结构化用便宜的 flash，写作/翻译/归组复核换更强模型 |
| 上线 | **尽快上到自己的域名** |
| 站名 | **少女乐队's** |
| 域名 | **girlsbands.com**（暂定） |

### 首页与导航形态

- **按企划分首页**：三个企划各一个入口，点进去是各自的时间线。
- 一条消息涉及多企划时同时出现在多个企划页下（`analyses.subjects` 是数组，已确认支持）。
- 每个企划内做一个**日历**，方便排日程。

### 功能去留（定论）

| 保留 | 隐藏（cron 关掉、入口隐藏、**代码不删**） |
|---|---|
| 日报 | 编年史入口 |
| 周报 + 月报 | 普通主题页（47 个主题的列表 `/topics`） |
| 邮件订阅 | 话题页 |
| 热点榜 | |
| **乐队页** | |

> ⚠️ 关键细节：`apps/web/app/routes/topic.tsx:86` 写的是 `const band = tracksAsSubject(topic.group) ? subjectOfId(topic.slug) : null;`，`:131` 是 `tracksAsSubject(topic.group) ? <ChronicleBand …/> : <ChronicleRail …/>`。也就是说 **`/topic/:slug` 这个路由身兼两职：普通主题渲染时间轴，主体渲染乐队页**。所以"隐藏主题页"只能隐藏 `/topics` 列表和普通主题分支，`ENTITIES` 里那 22 个主体（4 企划 + 18 支乐队）的页面必须留着。

---

## 二、工程约束（定论）

### 命名

**全部跟域名走 `girlsbands`：**

| 位置 | 现在 | 改成 |
|---|---|---|
| npm 包名（7 个） | `@aihot/backend` `@aihot/contracts` `@aihot/api` `@aihot/web` `@aihot/worker` `@aihot/industry` | `@girlsbands/*` |
| 根包名 | `aihot` | `girlsbands` |
| 环境变量 | `AIHOT_CREDENTIALS_DIR` `AIHOT_DATA_DIR` `AIHOT_ENVIRONMENT` `AIHOT_RELEASE` | `GIRLSBANDS_*` |
| 配置键 | `_aihot`（52 处） | `_girlsbands` |
| 爬虫 UA | `AniBandRadarBot` | `GirlsBandsBot`（不能带中文和撇号） |
| MCP 前缀 | `aniband` | `girlsbands` |
| 后台 cookie | `aihot_admin` `aihot_oauth_state` | `girlsbands_admin` `girlsbands_oauth_state` |
| 备份文件名 | `aihot-<stamp>.dump` `aihot-files-<stamp>.tar.gz` | `girlsbands-*` |
| PgBoss | `application_name: "aihot-jobs"` | `girlsbands-jobs` |
| GitHub 仓库名 | `AniBand-Radar` | `girlsbands`（GitHub 会自动重定向旧地址） |

### 托管与网络

**香港源站 + DNSPod 分线路 + 双 CDN**（用户选 A）：

```
大陆访客 ──► DNSPod「中国境内」线路 ──► 腾讯 EdgeOne 国际站（港/日/新）──► 香港源站
海外访客 ──► DNSPod「境外」线路    ──► Cloudflare                      ──► 香港源站
```

- 预期大陆整页加载 **1.0–2.6s**（实测均值 联通 1.46s / 移动 1.83s / 电信 2.63s）
- 月成本 0 USD（EdgeOne 免费版 + Cloudflare 免费版 + DNSPod 免费版），只花源站 VPS
- **域名分三个**（用户选 B）：页面域名 / api 域名 / 静态资源域名
- **静态资源全部自己控制**，图片单独优化

### 三条必须接受的代价

1. EdgeOne 免费版**只有静态加速**，没有动态加速。本站页面是 SSR 现算的，动态回源偏慢。要动态加速需 +15 USD/月（Free Plan Add-on Suite）。
2. EdgeOne 免费版**没有源站防护**，拿不到官方回源 IP 段（`DescribeOriginACL` 仅付费套餐）。必须自己在源站用 iptables + ipset 做白名单，否则别人可以绕过 CDN 直接打源站 IP。
3. EdgeOne 免费版是**限量 beta、无 SLA**，腾讯随时可改规则。**兜底**：源站买香港优质线路（CN2 GIA / 三网优化，8–30 USD/月），任何一层挂了直接裸连。

### 中文质量保险（用户多选：A + B + D）

- **A 受控词表 + 硬校验**：乐队/成员/会场/碟名/票务平台中日对照，翻译写作时强制注入；官方源条目必须有中文标题，没有就重跑。
- **B 每周人工抽检 20 条**：查术语、人名、日期、价格。
- **D 翻译链路监控告警**：失败率、incomplete 块数、耗时。
- **不做 C（全量人工审核）** → 保持自动发布，不做审核队列。

---

## 三、改动清单

按工作流分组。每组给了**文件位置**和**验收标准**，可以直接照着做。

两个阶段：**W0–W6 是「把 AIHOT 改成少女乐队情报站」**（已完成，见下）；**W7–W18 是「从新闻聚合升级成 Event Intelligence」**（2026-10-05 定，在本节末尾，先看那张优先级表）。

### W0 · 品牌脱钩（✅ 已完成）

**已完成**（`npm run typecheck` 全绿，`git grep` 逐项验证）：

1. **包名**：7 个 `package.json` + 根 `package.json` 改成 `@girlsbands/{contracts,backend,industry,web,api,worker}` / `girlsbands`；278 个文件、888 处 `@aihot/` 导入全部改掉；`npm install` 已重跑，lockfile 已更新（仓库没有 tsconfig path alias，包导入全靠 workspace 包名）。
2. **环境变量**：`AIHOT_*` → `GIRLSBANDS_*`（4 个变量；`packages/backend/src/config.ts`、`operations/heartbeat.ts`、`apps/api/src/app.ts`、`subscriptions/send.ts`、`.env.example`、`docker-compose.yml`、6 个测试文件、`docs/deploy.md`）。
3. **配置键 `_aihot` → `_girlsbands`**：源码 4 个读取点（`ingest/items.ts`、`sources/config-keys.ts`、`sources/collect.ts`、`tests/collection-tail.test.ts`）+ `industry/sources.json` 26 处 + `docs/sources.md`；**新增迁移 `database/migrations/0055_rename_source_config_key.sql`**，把线上 27 行 `sources.config` 的 JSONB 键重写（已存在新键时不覆盖，最后无条件删旧键）。
4. **会话/备份/队列标识**：`girlsbands_admin` / `girlsbands_oauth_state` 会话 cookie、`girlsbands-<stamp>.dump` / `girlsbands-files-<stamp>.tar.gz` 备份名、PgBoss `girlsbands-jobs`；另外一并改掉 `apps/web` 的 localStorage/sessionStorage 键与缓存键、CSS `@keyframes`、`girlsbands-dev-edge`（Vite 插件名）、`x-girlsbands-ssr` 头、CI 库名 `girlsbands_ci`、docker 的库名/用户名/镜像名。
5. **文档口径**：`README.md` 整篇重写；`AGENTS.md`、`CONTRIBUTING.md`、`SECURITY.md`、`NOTICE`、`.github/ISSUE_TEMPLATE/*`、`docs/{customize,deploy,architecture}.md`、`industry/changelog.json` 全部改成本站口吻；上游链接统一到 `https://github.com/RinneBeat/girlsbands`。
6. **站名与品牌**：`SITE.name` → `少女乐队's`，连带 `homeTitle`、`organization.name`、`crawlerName` → `GirlsBandsBot`、`mcpPrefix` → `girlsbands`；邮件模板与 OG hero 的兜底品牌名同步。
7. **公开契约改名（计划外，用户拍板）**：`links.aihot` → `links.site` —— `reference/public-v1.openapi.json` 22 处 + `packages/backend/src/publication/*` + 2 个测试。站还没上线、零调用者，现在改是唯一便宜的机会。
8. **品牌字（计划外，用户挑的）**：站名改成 `少女乐队's`（**不做 `toUpperCase()`**），字族换成**站酷快乐体 ZCOOL KuaiLe**。新增子集 `assets/og-fonts/zcool-kuaile.ttf`（12,852 bytes / 246 字形 / 611 字符），由 `scripts/og/build-og-jp-font.ts` 的 `brandCharset()` 按 `SITE.name` 裁（ASCII + Latin-1 + 常用标点 + 站名的字）。字号：头图品牌行 22px → **30px**、字距 3 → 1；分享图角标 `nameMark(34)` → `nameMark(46)`、海报角标 `nameMark(44)` → `nameMark(60)`。三个模板版本号已同步升（`hero-2026-10-05.18` / `og-2026-10-05.3` / `poster-2026-10-05.3`）——**必须升，否则 `ogcache` 命中旧图、PNG 逐字节不变**。

**故意保留**：`LICENSE:3` 与 `NOTICE:2` 的 `Copyright (c) 2026 数字生命卡兹克`（MIT 要求署名）、`NOTICE:5` 的上游商标声明、`README.md` 一行「本站基于 AIHOT 框架改造」、`tests/email-rules.ts` 的 `/AIHOT|AI 评分|AI评分/` 护栏（故意检测上游文案泄漏）、迁移 `0055` 里的 `'_aihot'` 字面量（迁移必须写出旧键名才能执行）。

**验收**：
- `git grep -i "aniband\|myhot\|KKKKhazix"` 除本文档外零命中；`git grep -i aihot` 只剩上面那几处故意保留。
- `npm run typecheck` 全绿。
- `npm test`：本机必须带 `PATH="/opt/homebrew/opt/libpq/bin:$PATH"`（`pg_dump`/`pg_restore` 不在默认 PATH 里，否则备份相关的 2 个测试会 `spawn pg_dump ENOENT`）；测试库名要以 `_test` 结尾，例如 `DATABASE_URL=postgres://aniband:aniband@127.0.0.1:55432/girlsbands_test npm test`。
- `npm run build -w @girlsbands/web && node --test apps/web/tests/*.test.ts`。
- `docker compose up` 能起来 —— **未验**，等有服务器再做（W4）。

### W1 · 站点结构与内容范围 · ✅ 已完成 2026-10-05

用户 2026-10-05 逐条拍板（选择框）：1) 留 9 个「情报方向」主题页（Live／票务／发售／周边／直播／联动／成员／通知／媒体），关掉 19 个「内容形态」主题页和 `/topics` 总列表；2) 首页留着三个企划入口 + 4 个追踪入口两排；3) 企划页汇总旗下所有乐队和企划本身，混在一条时间线里；4) 新增「ぼっち・ざ・ろっく」企划条目，結束バンド 变成它旗下的乐队；5) `.ics` 三档（全站／每个企划／每支乐队）；6) 日历加两类日期：发售日、周边开订；7) 企划／乐队页默认精选，可切「全部」。

**落地的样子**

- **三种页面，一条规则**：`packages/backend/src/publication/topics.ts` 的 `hasPage(t) = t.group !== "genre"`、`findPageTopic(slug)`。22 个主体（4 企划 + 18 支乐队）+ 9 个方向 = 31 个页面；19 个内容形态只剩标签，没有 URL、不进站点地图。
- **企划页收整个系列**：`industry/taxonomy.ts` 的 `SERIES`（三条）+ `seriesOf(id)`（**页面语义**：系列 id 自己 → 整个系列；其它 id → 只有它自己，乐队页不能被同系列其它乐队串进来）+ `seriesKeyOf(id)`（成员反查，`parentOf` 用它）。`packages/backend/src/publication/rules.ts` 的 `entityTags(entityId)` 把主题的归类标签展开成「自己 + 同系列其它主体」，`titlePattern` 也带上整组的名字 ⇒ 企划页的精选、日历、.ics 一起收旗下乐队。
- **`?scope=all`**：`TopicPage` 加 `scope: "picked" | "all"`；`loadTopicPage(slug, page, now?, scope)` 的 `all` 走 `listedCondition(at) AND inTopic(t)` 分页（`poolIds`／`poolTotal`），精选走原来的 `seatedCondition`；`/api/site/topics/:slug?scope=all`；`topic.tsx` 用 `PillTabs`（精选 = `topic.total`／全部 = `topic.poolTotal`）切，切换都回第 1 页。
- **日历**：`upcomingDeadlines`／`deadlineWindow` 加 `subject?`（`p.tags && entityTags(subject)`）与 `from`／`to`；新增 `deadlineRange`、`deadlineMonths`、`jstDate`、`addDays`。`packages/backend/src/publication/calendar.ts` 造月历与 .ics：`calendarSubject(slug)`（只认企划／乐队）、`calendarMonths`（前 3 个月 ~ 后 12 个月）、`calendarPage(now, month, subject)`、`calendarIcs`（`X-WR-TIMEZONE:Asia/Tokyo`、RFC 5545 转义、75 octets 折行）。API：`GET /api/site/calendar/:subject?month=`、`GET /calendar.ics`、`GET /calendar/<slug>.ics`（`apps/api/src/routes/calendar.ts`）——**不能写 `/calendar/:subject.ics`**，find-my-way 不支持带后缀的参数段（和 `feeds.ts` 的 `/feed/category/:file` 同理）；`packages/contracts/src/http-policy.ts` 的 `API_OWNED_PATTERNS` 必须登记 `/^\/calendar(\.ics|\/[^/]+\.ics)$/`，否则 web 会把它当静态文件。
- **日期种类**：`DeadlineKind` 加 `release_start`（发售）与 `merch_start`（周边开订），`industry/prompts/structure.md` 跟着改；`apps/web/app/features/feed/deadlines.ts` 的 `DEADLINE_KINDS` 补色 class（`text-accent`／`text-ink-3`）。
- **界面**：`apps/web/app/routes/topic.tsx` 重写（`MonthCalendar` + 精选／全部 + 返回父企划或首页、crumbs 去掉「主题」中间层、`noindex: !topic.indexable || all`）；新增 `apps/web/app/features/topic/Calendar.tsx`（`lg` 七列月历／手机按天列表，今天按 JST 算，空月给一句话）与 `apps/web/app/features/feed/ProjectRail.tsx`（首页三个企划入口，写「N BANDS」）；`nav.ts` 新增「企划」组、去掉「全部主题」，手机底栏不动；`deadlines.tsx` 加全站 `.ics` 入口；`bands.ts` 的 `parentOf(id)` 给乐队页找父企划。
- **删掉的**：`apps/web/app/routes/topics.tsx`（总列表页）与它的路由、sitemap 里的 `/topics`、`SearchOverlay` 的「全部 N 个主题」、`more.tsx` 的「主题」行、OG 的 `topics` 卡片、`industry/chronicle.ts` 的 `CHRONICLE.forms`（19 条 genre）、`topic-chronicle.ts` 的 genre 分支与 `forms[slug]?.perMonth` 查表。`/api/site/topics` 端点保留（搜索框还在用）。**`ChronicleRail` 不是死代码**：9 个方向页在用。
- **新增主体要补 logo**：`assets/band-logos/manifest.json` 必须与 `ENTITIES` 一一对应，`bocchi-the-rock` 的字标取 `https://bocchi.rocks/tv/assets/img/common/footer/ttl_logo.svg`（TV 版官网页脚的作品标题 logo；`/omnibus` 那张是剧场总集编的），跑 `node scripts/fetch-band-logos.ts` 入库 —— `tests/email-hero.test.ts` 钉住了这条。

### W2 · 中文看全（核心价值，改动最深）· 1–6 ✅ 已完成 2026-10-05；7 已作废

**⚠️ 现状查证（改前）：`industry/sources.json` 里 26 个源，`site_fulltext` 为 true 的：0 个；`syndicate_fulltext` 为 true 的：0 个。全文档位当时是完全关着的。**

1. ✅ **打开全文档位**：`industry/sources.json` 只给 18 个 `participation_mode: "editorial"` 的源把 `site_fulltext` 改成 `true`；8 个 `hot_signal` 源保持关闭（站主决策 —— `hot_signal` 没有公开页面，`packages/backend/src/publication/rules.ts:33` 的 `hasItemPage` 要求 `sourceMode === "editorial"`）；`syndicate_fulltext` 26 个全关（它只喂 `packages/backend/src/publication/feeds.ts:112` 的 `<content:encoded>`，是另一个决定）。
   - 关卡在 `packages/backend/src/publication/rules.ts:46`：`return source.site_fulltext && bodyStatus === "ok" && hasBody ? "full" : "summary";`
   - **原稿说的「`scripts/seed.ts` 是 upsert，改完跑一次 seed 即可」是错的**：`scripts/seed.ts:32-36` 是 `ON CONFLICT (id) DO NOTHING`，老库的行不会跟着 JSON 变。所以新增了 `database/migrations/0056_site_fulltext_editorial.sql`（`UPDATE sources SET site_fulltext = true WHERE participation_mode = 'editorial' AND site_fulltext = false;`）；`scripts/migrate.ts` 按 `database/migrations/*.sql` 顺序执行、用 `schema_migrations` 按文件名记账、**没有 checksum**。
   - **这条还有后半截（部署时必须做）**：迁移只改 `sources` 行，**不动 `publications.body_mode`**。线上已有数据要靠 republish 重算 —— `packages/backend/src/admin/sources.ts:151` 的 `enqueue(QUEUES.republishSource, { sourceId }, { singletonKey: id }, tx)` → `packages/backend/src/jobs/publication.ts:16`（`QUEUES.republishSource = "publication.republish-source"`，`packages/backend/src/jobs/queue.ts:36`）。只改 `industry/sources.json` 不会触发它。
2. ✅ **去掉"只有精选才翻译"的门**：`packages/backend/src/editorial/translate.ts` 三处全部打开 —— `translateArticle` 不再 SELECT `p.selected`，早退条件变成 `if (row.visibility !== "public" || row.body_mode !== "full") return result({ status: "skipped", reason: "not a public full-text item" })`；`translateQuotes` 的 `WHERE p.channel = 'x' AND p.visibility = 'public' AND p.body_mode = 'full'`；`translatePending` 的 `WHERE p.visibility = 'public' AND p.body_mode = 'full' AND coalesce(a.language, '') <> 'zh'`。**刻意不额外要求 `p.eligible`**（story 页走 `packages/backend/src/publication/scope.ts:23` 的 `storyReportCondition`，本来就不要求 eligible；预筛 BLOCK 的条目只在直接 URL 可见，翻它无害且预算不限量）。读层不用改：`packages/backend/src/publication/detail.ts:78` 的 `loadItemDetail(id, language = "zh", now)` 只用 `hasItemPage({ visibility, sourceMode })`；`packages/backend/src/publication/items.ts:63-69` 的 `LEFT JOIN translations tr ON tr.article_id = p.article_id AND tr.lang = 'zh' AND tr.revision >= a.revision` 不带 selected。`apps/worker/src/schedules.ts:33` 的 `{ name: "content.translate", cron: "*/5 * * * *", run: () => translatePending() }` 是驱动。测试：`tests/translate.test.ts` 的「an item the site did not pick is translated too: the pool reads in Chinese, not only the picks」。
3. ✅ **受控词表**（2026-10-05 完成）：新建 `industry/glossary.ts`。`GLOSSARY` 共 **336 条**（3 企划 + 16 乐队 + 2 作品 + 161 成员 + 135 会场 + 19 票务平台，`usable()` 过滤后按 kind 计数），`tests/glossary.test.ts` **13 条全过**，`GLOSSARY_VERSION` 进 `TRANSLATE_PROMPT_VERSION`：`GlossaryKind = "project" | "band" | "work" | "member" | "venue" | "platform"`，条目是一组可接受的写法（`forms`，**不写 `A → B` 箭头** —— 指令是「用这一组里的写法」，不是「改写成另一个名字」）。
    - **写法顺序是有意义的（站主 2026-10 拍板：「中文圈有通用名就用通用名，不管官不官方」）**：**每组第一个写法是本站倾向使用的那个**。所以 `後藤ひとり` → `后藤一里`、`高松燈` → `高松灯`、`ぼっち・ざ・ろっく！` → `孤独摇滚` 都排在第一位，没有中文通用名的照抄原文（大部分中之人本名、日本会场）。注入的指令行是「下面这些专名只能用同一组里列出的写法（**优先第一个**），不要自己音译、意译或另起名字」—— 说「优先」不说「必须」，因为会场的第一种写法是规范化过的名字（`Zepp Haneda (TOKYO)`），原文只写 `Zepp Haneda` 时照原文写才对。
    - **企划与乐队（`ENTITIES`）刻意不重排**：它们的 `forms` 第一位仍是日文原名（`トゲナシトゲアリ`、`BanG Dream!`），中文通用写法（`刺刺`、`邦邦`、`结束乐队`、`少女乐队哭泣`）都留在后面的 aliases 里。中文圈提到乐队本来就直接写原名，把中文昵称提到第一位反而别扭。
    - `glossaryBlock(text)` 只列这段原文真出现的条目，按 kind 分组；`fold()` 做 NFKC + 去空格 + **删掉撇号**（所以 `Poppin'Party` / `Poppin’Party` / 全角 / 带空格都能对上）；纯 ASCII 短写法（`RAS`、`GBC`）要贴边界，否则会命中别的词中间；`WORK_TITLES` 把「ぼっち・ざ・ろっく！」「ぼざろ」从 結束バンド 的 forms 里剔出去另立 `work` 条目（`ENTITIES` 把它们放进 `otherNames` 是为了让结构抽取归对乐队，词表里混在一起会读成「ぼざろ 就是 結束バンド」）。
   - 注入点：`industry/prompts/translate-body.md` 与 `translate-post.md` 末尾 `{{glossary}}`；`packages/backend/src/editorial/translate.ts` 的 `SYSTEM_BODY`/`SYSTEM_POST` **从模块级常量改成按文章构造**（`promptText(name, { glossary: glossaryBlock(text) })`）；`packages/backend/src/editorial/writing.ts` 的 `glossaryForTexts()` 追加到 `understandUser` 与 `buildArticlePrompt`/`buildShortTweetPrompt`/`buildLongTweetPrompt`。
   - **刻意不注入**：`prefilterUser`（判 BLOCK/PASS 与名字无关）与 structure 步骤（`packages/backend/src/editorial/analyze.ts:181-184` 的 `grounded(quote)` 要求 fact 的每个字段都是原文逐字引用的子串，名字天然照抄）。
   - `industry/glossary-members.ts`（162 行：84 个角色名 + 78 个中之人，覆盖 16 支乐队；过 `usable()` 后是 161 个成员条目 —— 唯一整条消失的是 夢限大みゅーたいぷ 的 `愛`/`アイ`/`あい`/`AI`，四种写法全都太短，被 `usable()` 全丢掉）与 `industry/glossary-venues.ts`（135 条：日本 109 + 中国大陆 26）是两批研究产物，逐条带来源，直接提交进仓库（`.data/` 被 gitignore，CI 读不到）。
   - **成员表按规则 C 重做过一遍（2026-10-05）**：原稿第 2 列只填「已核实的官方简中」，通用译名写在备注里；按站主的规则 C 改成通用名优先后，**72 行填了中文通用名（63 行官方简中 + 9 行通用译名），90 行照抄原文**，实际改动 21 行（卢帕、后藤一里、山田凉、仲町阿拉蕾、宫永野乃花、千石由乃、汐见萤、伊泽枣、滨崎茉幌、须贺蕾叶、马桥心玖、矢仓蓬咲、梅里千樱梨、四宫宁月、日菜、奈奈、凛、爱）。**声优/演奏者本名基本全部照抄原文**（例外是 夢限大みゅーたいぷ 的四位 VTuber：角色与本人同名且官方已公布汉字写法）。最不确定的几处（`後藤ひとり` 大陆配音版官方作「后藤独」、`ヒナ` 的简体正式译名与页面标题不一致、`クズミミズク` 五人找不到任何中文来源）都留在 TSV 备注列里。`tests/glossary.test.ts` 的「a name with a Chinese rendering lists it first」把 `後藤ひとり`→`后藤一里`、`山田リョウ`→`山田凉` 钉死。
   - **数据里最容易出错的地方是「短写法误命中」**：两三个假名的成员读音会被普通词吃掉（`あい` 命中 `あいだ`、`りん` 命中 `りんご`、`アイ` 命中 `アイドル`、`なつ` 命中 `なつかしい`）。所以 `GLOSSARY` 构造时过一道 `usable()`：**含汉字的写法两个字起，纯假名或拉丁的三个字起**。代价是丢掉 `e+` 与 `Ai` 这种过短的写法（各自条目还有别的写法兜着）。`tests/glossary.test.ts` 的「two-kana readings do not fire inside ordinary words」与「no form is too short to mean anything」把这条钉死。
   - 实测注入效果（トゲナシトゲアリ 的一场 Live 公告，219 字符）：首行 `【受控词表：下面这些专名只能用同一组里列出的写法（优先第一个），不要自己音译、意译或另起名字】`，之后 `- 乐队：トゲナシトゲアリ / Togenashi Togeari / トゲトゲ / TGTG / 刺刺`、`- 成员：理名 / Rina；夕莉 / ゆうり / Yuri；美怜 / みれい / Mirei；凪都 / Natsu；朱李 / しゅり / Shuri`、`- 会场：ぴあアリーナMM / PIA ARENA MM / ぴあアリーナ`、`- 票务平台：イープラス / eplus`。**只列这段原文真出现过的**，没命中的一个字都不塞。
4. ✅ **硬校验**（2026-10-05 完成）：**所有能上网站的内容都必须有中文标题和摘要，写作步骤没给就换一个 `attemptTag` 再问一次；两次都没有就把条目标成 `failed`，不再静默躺在 `analyzed` 里。**
   - **范围由站主拍板（选择框 A）**：不是原稿写的「官方源」。`industry/sources.json` 里 `first_party: true` 的源是 **0 个**（26 个全 false），照字面拿 `first_party` 写这个校验就是死代码。范围定为「所有能上网站的条目」，也就是过了预筛（PASS/UNKNOWN）的每一条。
   - **改前的真实行为不是「重跑」而是「静默停住」**：`packages/backend/src/editorial/analyze.ts` 的 `normalizeAnalysis` 里 `const relevance = label === "BLOCK" ? "block" : run.writing && (!titleZh || !summaryZh) ? "unknown" : "pass";`，而落库是 `processing_state = out.relevance === "block" ? "blocked" : "analyzed"`。**`analyzed` 是终态**：`sweepUnprocessed()` 只捞 `processing_state = 'new'`，`requeueFailed` 只捞 `failed`（`database/migrations/0005_grouping_state.sql:3-4` 的 CHECK 是 `('new','analyzed','skipped','failed','blocked')`）。所以没有中文标题的条目会一直躺在库里、永远不进公开池（`isPoolEligible` 要求 `relevance === "pass"`）、也没有任何任务再看它一眼。
   - **「再跑一次」默认是空转**：`packages/backend/src/providers/receipts.ts:83` 的逻辑键是 `[service, purpose, model, identity, attemptTag ?? "0"].join(":")` —— 同输入同 prompt 会命中已完成的回执，不花钱也不重新问模型。真正的重跑必须换 `attemptTag`（`packages/backend/src/providers/llm.ts:192` 把它交给 `paidRequest`）。
   - **实现**：
     - `packages/backend/src/editorial/analyze.ts` 新增 `hasCopy()`（`titleZh` 去空白后非空 **且** `summaryZh` 非空）与 `ensureCopy(a, opts, wrote)`。`runAnalysis` 里原来那句 `const writing = (near ? await runUnderstand(a, opts) : null) ?? (await runSummarize(a, opts));` 拆成 `wrote` + `ensureCopy`。
     - `ensureCopy` 只在「写作步骤真的跑过」时才重问：`kind` 是 `verbatim`（短推本身就是中文）或 `none`（正文不足 20 字、没有材料可写）的直接放过 —— 那两种没有模型写过，重问也无从下手，它们仍然落在 `analyzed`。
     - 重问用 `tagged(opts.attemptTag, "copy-retry")` 作为新的付费身份，并通过 `runUnderstand`/`runSummarize` 新增的 `note` 参数把「上一次错在哪」追加到 user 消息：`identityGuard.outcome === "fallback"`（标题里出现了原文没提过的名字被 `enforceIdentity` 清空）时给「请只用原文里确实出现的名字重写标题和摘要」，否则给「标题必须是有信息量的中文，摘要要回答这条消息说了什么」。
     - 重问成功时**两次回执都保留**：`return { ...again, receiptIds: [...wrote.receiptIds, ...again.receiptIds], reused: wrote.reused && again.reused }` —— 第一次也是花过钱的，漏掉它的 `receiptId` 会让那条回执永远停在未完成状态。
     - 落库状态：`const gaveUp = out.relevance === "unknown" && (w?.kind === "understand" || w?.kind === "summarize")`，`gaveUp` 时 `processing_state = 'failed'`、`processing_error = NO_COPY_ERROR`（`export const NO_COPY_ERROR = "写作步骤没有给出中文标题或摘要，已重试一次"`）。选 `failed` 是因为它会出现在后台运行页的失败分组里，也会计入 `packages/backend/src/operations/alerts.ts` 的 `content.process` finding（条件是 `waiting >= 10 || failed >= 20`）；选 `analyzed` 则谁也看不见。
     - `packages/backend/src/jobs/content.ts` 的 `requeueFailed(group)` 顺手修好：原来 `for (const r of rows.slice(0, 500)) await queueProcessing(r.id);` **不带 attemptTag**，管理员点「重试」只会重放回执、一秒后又变回 `failed`。现在传 `retry-${Date.now().toString(36)}`，显式重试才真的是新请求（代价：它会重新付费问 prefilter/score/structure，这是管理员明确要求的）。
   - 测试：`tests/analyze.test.ts` 新增两条 —— 「a writer that gives no Chinese copy is asked again, as a new request, and the item goes out」（断言两次 summarize 调用、重问的 user 里带纠正话、`receiptIds.length === 6`、最终 `processing_state = 'analyzed'`）与「an item whose writer gives no Chinese copy twice ends failed, and the owner's retry asks again」（断言 `relevance = 'unknown'`、`processing_state = 'failed'` 且 `processing_error === NO_COPY_ERROR`、`requeueFailed(null)` 后 `processing_attempt_tag` 匹配 `^retry-[0-9a-z]+$`）。两条都靠桩模型返回一个原文没提过的乐队名（`Roselia`）触发 `enforceIdentity` 的 fallback，比返回空字符串更接近真实。
   - **踩坑**：`packages/backend/src/editorial/writing.ts:372-380` 的 `parseTranslateOutput` 有个兜底 —— 三个字段全空时会把原文按行拆成标题+摘要。所以桩模型回 `"title_zh: \nsummary_zh: "` 得到的标题是字符串 `"title_zh:"` 而不是空，用它当「没有 copy」的测试数据会得到假阴性。
   - **踩坑（类型）**：`hasCopy` 不能写成类型谓词 `w is NonNullable<AnalysisRun["writing"]>` —— 那样 `if (hasCopy(wrote) || !wrote || …)` 会把 `wrote` 收窄成 `never`（谓词的 false 分支已经排除了非空类型，再过 `!wrote` 就什么都不剩）。保持 `: boolean`，在重问结果上显式判空：`const again = …; if (!again || !hasCopy(again)) return wrote;`，再取 `receipts` / `reused` 两个局部变量拼返回值（`AnalysisRun["writing"]` 含 `null`，直接展开 `X | null` 会得到「所有属性可选」的对象，赋值回报错）。
5. ✅ **每周人工抽检 20 条**（2026-10-05 完成）：后台新增 `/admin/review`「中文抽检」页，左边日文原文、右边中文译文，同屏对照。
   - **抽样池就是「读者真的能打开的中文页」**：`packages/backend/src/admin/review.ts` 的 `reviewSample(seed?, limit = 20)` 只取 `publications.visibility = 'public' AND body_mode = 'full'` **且**有 `lang = 'zh'` 的 `translations` **且** `tr.origin = 'model'`。所以摘要条目、已下架条目、以及原文本来就是中文（`origin = 'source'`）的都不在池子里 —— 抽检的是模型译文，不是站内已有内容。`total` 一并返回、页面上写明「可以抽的 total 条」，免得 20 条被读成「站上就这么多」。
   - **抽样固定一整周（`currentWeek()` = `isoWeekLabel(beijingDate(now))`，如 `2026-W41`），按 `ORDER BY md5(p.article_id || 周标签)` 排序**：周一发现的问题，周五还能回到同一批；排序与任何会变的东西（时间、分数、更新时间）无关，刷新不会换人。想看另一批就传别的 `seed`（页面「换一批」按钮传 `<周>+<时间戳>`），非周标签时 `week` 返回 `null`。
   - **两侧同长截断**：`REVIEW_CHARS = 20_000`（`packages/contracts/src/admin.ts`），原文与译文各 `slice(0, REVIEW_CHARS)`，任一侧被截断就置 `cut = true`，页面上挂「已截断」徽章；`complete = false` 的挂「译文不全」徽章。
   - **页面上直接列出这段原文命中的专名**：`names = [...new Set(glossaryHits(原文).map((e) => e.forms[0]!))]`，给的是**倾向写法**（`forms[0]`），所以人工一眼就能看出模型有没有自己另起名字。用的是翻译提示词同一个 `glossaryHits`，页面和模型看的是同一份名单。
   - 契约在 `packages/contracts/src/admin.ts` 的 `// Chinese copy` 一节（`REVIEW_CHARS` / `AdminReviewItem` / `AdminReview`）；接口 `GET /api/admin/review?seed=`（`apps/api/src/routes/admin.ts`）；页面 `apps/web/app/routes/admin/review.tsx`，导航在 `apps/web/app/routes/admin/layout.tsx` 的「内容」组「中文抽检」。
   - 测试：`tests/admin-review.test.ts` 4 条 —— 「the spot check holds only what a reader can open in Chinese」（4 种不合格条目只留 1 条；`week` 是 `{start:"2026-10-05", end:"2026-10-11"}`；`names` 含 `后藤一里` 且不含 `後藤ひとり`）、「a seed that is not a week label still draws, with no week to show」、「the same seed draws the same items and a different seed draws another order」、「long bodies are cut at the same place on both sides, and say so」。
   - **踩坑一**：`publications.sort_at` 是 NOT NULL 且**没有默认值**，测试里直插 `publications` 必须自己带上 `sort_at`，否则报 `null value in column "sort_at" of relation "publications" violates not-null constraint`。**踩坑二**：`reviewSample` 返回 `BeforeJson<AdminReview>`（`Timestamp` 是 branded string），测试里标成 `AdminReview` 会报 `Type 'string' is not assignable to type 'Timestamp'`。
6. ✅ **翻译链路监控告警**（2026-10-05 完成）：`packages/backend/src/operations/alerts.ts` 新增 `translationFindings(now)`，在 `collectFindings` 里 `collecting() && modelsOn()` 时调用（`checkAlerts` 由 `apps/worker/src/schedules.ts` 每 10 分钟跑一次，`digest` 级的项留到 09:00 由 `sendDigest` 发）。三条 finding，判断依据是 `translation_attempts`（`database/migrations/0013_translation_attempts.sql`，`outcome IN ('translated','partial','skipped','failed')`）与 `translations.complete`：
   - `translate.stuck`（level `now`）：公开的全文条目（`p.visibility='public' AND p.body_mode='full' AND coalesce(a.language,'') <> 'zh'`）当前 revision 没有 `translations` 行，**且不是翻译器主动跳过的**（`coalesce(ta.outcome,'') <> 'skipped'` —— 「已经是中文 / 没有外语正文 / X 短推」不算缺陷，否则会永远误报），且 `p.discovered_at < now - 2 小时`；`n >= 3` 才报。`heals` 分两支：有 `attempts >= 3` 的写明「已经试满 3 次，不会再自动重试」（`translatePending` 的 `NOT EXISTS` 把 `attempts >= 3` 当终态），否则说「每 5 分钟跑一次」。
   - `translate.partial`（level `today`）：`translations` 里 `NOT complete AND origin='model'`，**并且 `length(coalesce(a.body_html,'')) < MAX_CHARS`** —— 只报「原文短到本该整篇翻完、却还是半截」的。**超过上限的长文只翻开头是设计如此**（`packages/backend/src/editorial/translate.ts:24` 的注释、`:188-195` 的 `budget` 循环），拿 `body_html` 长度比而不是 `body_text`，是因为 `budget` 扣的就是块 HTML 长度之和。这批是**终态**（同一处 `NOT EXISTS` 里 `outcome IN ('skipped','translated','partial')` 不会重试），所以 `heals` 直接写「不会」。为此把 `const MAX_CHARS = 60_000` 改成了 `export const MAX_CHARS`。
   - `translate.slow`（level `digest`）：`receipt_attempts` JOIN `receipts`，`purpose IN ('translate_body','translate_quoted') AND ra.status='received' AND latency_ms IS NOT NULL`，24 小时窗口内 `percentile_cont(0.9)::int`，样本 `n >= 5` 且 p90 > 3 分钟才报。**注意 `receipt_attempts.status` 的成功值是 `'received'` 不是 `'completed'`**（`database/migrations/0022_receipt_attempts_budgets.sql:12` 的 CHECK 只有 `pending/received/failed/unknown`），`receipts.status` 才有 `completed`。
   - 阈值常量放在 `alerts.ts` 顶部：`TRANSLATE_STUCK_MS = 2 * 3600_000`、`TRANSLATE_SLOW_MS = 3 * 60_000`（批次 3500 字符，正常答案远在一分钟内）。
   - 测试：`tests/alerts.test.ts` 的「translation problems reach the owner without crying wolf over long bodies」（该文件 5 条全过）。
7. ❌ **原稿这条是错的，已作废（2026-10-05 查证）：不用统一到 JST。** `packages/backend/src/publication/deadlines.ts:5-7` 的头注释早就写明并论证了这个分工：「`at` is Japan wall-clock, the date the announcement itself gives, so the window, the day buckets and the 48-hour flag are all computed in JST rather than in the Beijing calendar the rest of the site uses. A deadline that closes at 23:59 JST is a thing the reader must act on that day, and converting it to another calendar would move it to the day before.」实现自洽（`JST_OFFSET_MS` / `jstDate` / `jstInstant` / `upcomingDeadlines` 全在 JST 内闭环）。全站其余部分用北京时间也是刻意的：`apps/worker/src/schedules.ts:1,72` 的 cron 跑在 `Asia/Shanghai`、`packages/backend/src/reports/compose.ts:1` 的窗口用 `beijingDate`/`beijingMidnight`、`packages/backend/src/editorial/analyze.ts:74` 与 `writing.ts:286` 的日期锚点也是 `Asia/Shanghai`。**截止日期来自日本公告 → 用公告自己的日历；日报的「今天」是读者的日子 → 用读者的日历。两者各自都对，统一到 JST 反而会让中文读者的日报对不上自己的日子。**（W7 之后的形态：判断不变 —— 截止日期仍按公告自己的日历分桶；只是「公告那一地」不再死写 JST，而是来源的 `config.timezone`，`jstInstant` 已删除。）

### W3 · 全文搬运的合规底线（**必做，不用选**）· ✅ 已完成 2026-10-05

**⚠️ 原稿这里的现状查证是错的。** `grep -E 'takedown|blocklist|denylist|suppress|下架' packages/backend/src` 确实零命中，但**单条下架机制早就存在，不用新建**：`packages/backend/src/admin/content.ts:90` 的 `setVisibility(id, { visibility: "public" | "summary-only" | "withdrawn"; reason; version }, actor)` 写 `editorial_overrides`，`withdrawn` 让 `hasItemPage` 返回 false，网站 / RSS / 公开 API / MCP / sitemap 一起消失；后台入口在 `apps/web/app/routes/admin/content-item.tsx:85`「公开范围」→「下架（所有出口移除，链接 404）」。真正缺的只有下面 1–3。

1. ✅ **联系邮箱**：`industry/site.ts` 的 `contactEmail` 从 `null` 填成 `contact@girlsbands.com`（原来 `/.well-known/security.txt` 直接 404）；`footerNote` 同步从「本站是聚合摘要与索引」改成「本站聚合各来源原文并译成中文」。它还喂 llms.txt 的联系行与 RSS 的 author。
2. ✅ **「权利与删除」说明页**：新增 `industry/pages/rights.md` + `apps/web/app/routes/rights.tsx`，注册进 `apps/web/app/routes.ts`，页脚互链进 `terms` / `privacy` / `more` / `about`，进 `packages/backend/src/publication/sitemap.ts` 与 `llms.ts`，OG 图在 `apps/api/src/routes/og.ts` 的 PAGES 里加 `rights` 条目。同一次把 `industry/pages/terms.md` 与 `privacy.md` 两份上游模板整篇重写（模板里那句「站内只在来源允许时展示全文」现在跟实情相反，`privacy.md` 也补上了邮件订阅的实情）。
3. ✅ **整源下架（＝按来源/域名整批下架）**：一个源就是一个发布者，所以「屏蔽名单」的正确形态就是「整个源撤掉」，不需要另建名单表。`packages/backend/src/admin/sources.ts` 新增 `withdrawSource(id, { reason }, actor)`：把该源所有已经投影出去的条目写成 `editorial_overrides.visibility = 'withdrawn'`、逐条 `publishArticleTx` 重投影（出口读的是 `publications`，不是 override）、给相关 story 入 `QUEUES.digest`、`sources.enabled = false` 且 `health = 'paused'`、写 audit `source.withdraw`，事务外 `computeHotRanking()`；重复点第二次返回 0 且不推 version。路由 `POST /api/admin/sources/:id/withdraw`（`apps/api/src/routes/admin.ts:50`），后台按钮在 `apps/web/app/routes/admin/source.tsx` 的「整源下架」。测试：`tests/admin-corrections.test.ts` 的「withdrawing a whole source takes its published items off every exit and pauses the source」。
4. ✅ **原文链接显眼**：无需改。`apps/web/app/routes/item.tsx` 已有桌面右栏顶部的「打开原文」外链按钮和正文区的「原文」页签。

### W4 · 部署与性能

1. **源站**：香港 VPS + `docker-compose.yml`（现有服务：`app` / `db` postgres:17-alpine / `setup` / `api` / `worker` / `web` / `caddy`）。
2. **Caddy**：对外改高位端口（如 `:18080`），TLS 由 CDN 终结。
3. **DNSPod 分线路**：
   - 三条 CNAME（主机记录相同）：线路「中国境内」→ EdgeOne 分配的目标；「境外」→ Cloudflare for SaaS 的 CNAME target；「默认」→ 同境外兜底。
   - **EdgeOne 归属验证 TXT 必须放在「默认」线路**（CA/验证服务器多在境外）。
   - **分线路解析本身不需要备案**，唯一需备案的是 DNSPod 的 URL 转发记录（A/CNAME 记录无此限制）。
   - TTL 保持 120–600。
4. **EdgeOne**：必须用 **CNAME 接入（不能 NS 接入）**，否则和 DNSPod 分线路冲突；未备案只能选「全球可用区（不含中国大陆）」才拿得到 CNAME（形如 `域名.eo.dnse4.com`）。
5. **Cloudflare for SaaS**：建一个承接 zone（如 `cf-zone.<别的域名>`）交给 CF，把 `girlsbands.com` 加为 Custom Hostname；Free 版含 **100 个自定义主机名**，需先绑定支付方式。
6. **源站白名单**：`apt-get install -y ipset`，建 `EO_ORIGIN` ipset + iptables 规则（先放行 `127.0.0.0/8` 保 cloudflared，再放行集合，其余 REJECT）。用 `learn` 从连接表收集实际回源源 IP 作种子，`sync --dry-run` 验证后生效，挂每日 cron。**种子要记 EdgeOne 的出口 IP，不是日志里的客户端 IP。**
7. **真实 IP 信任链**：EdgeOne 客户端真实 IP 头默认关闭，需手动开启且**头名固定为 `EO-Client-IP`**；同时要在 EO 规则引擎**删掉**客户端可伪造的 `CF-Connecting-IP` / `X-Real-IP`，否则直连攻击者可伪造 IP 绕过限流。应用侧按 `CF-Connecting-IP` → `EO-Client-IP` → TCP 对端 顺序信任。
8. **三个域名**：
   - 页面域名（不缓存 HTML）
   - api 域名（`/api/*` 全不缓存；`apps/web/server.ts` 里 `isApiOwned` 的 `reverse_proxy` 目标要跟着改；跨子域名要配 CORS 和 cookie `Domain`）
   - 静态资源域名（hash 文件名 + `Cache-Control: immutable`）
9. **图片管线搬到独立域名**：`packages/backend/src/media/imgproxy.ts:41` 那个 `${config.siteUrl}${path}` 前缀换成图片专用域名。**不需要新建管线**——现有实现已经完整：
   - `packages/backend/src/media/renditions.ts:3-7` 固定档位 avatar 96 / card 336 / thumb 720 / full 1600 / og 1200
   - `packages/backend/src/media/renditions.ts:12-17` 响应式 srcset（头像 [48,96]、卡片 [336,720]、正文/头图 [720,1200,1600]）
   - `apps/api/src/routes/media.ts:16` `/api/img-proxy`：验签 → 命中缓存直接返回 → 未命中现场抓上游并用 sharp 转码
   - `apps/api/src/routes/media.ts:46` `s-maxage` 跟着签名有效期走（上限 7 天），带 ETag、avif/webp 自动协商、动图像素上限保护
   - `packages/backend/src/publication/publish.ts:360-361` 条目入选时就排队预热所有尺寸
10. **验证**：**不要在大陆本机查境外 DNS**（UDP/TCP 53 都被劫持，会返回按境内线路伪造的答案）。用境外服务器代查（`api.hackertarget.com/dnslookup/?q=`、`networkcalc.com/api/dns/lookup/`）；境内视角用 `nslookup <域名> 223.5.5.5`。
11. **被封预案**：分线路架构下境内/境外两条 path 独立。境内失效只改 DNSPod「中国境内」这一条（换 EO 备用 CNAME，或删掉让默认线路 CF 兜底，或直接指香港源站 IP）。
12. **生产开关**：现在 `.env` 里 `COLLECT_ENABLED=false`、`MODEL_CALLS_ENABLED=false`、`FEISHU_*_ENABLED=false`、`INDEXNOW_SUBMIT_ENABLED=false`，上线前要逐项确认。

### W5 · 成本与模型配置

- 预筛（`prefilter.md`）/ 评分（`selection-score.md`）/ 结构化（`structure.md`）→ 便宜的 flash。
- 写作（`content-understanding.md`）/ 翻译（`translate-body.md`）/ 归组复核 → 更强的模型。
- `budgets` 熔断保留作安全网（现在不再限制总量，但要防止一次故障烧穿）。

### W6 · 国内同人 ONLY 与 livehouse 演出 · ✅ 已完成 2026-10-05（含第二版阈值校准）

**最终名单（用户定案）：CPP 无差别同人站 + B站会员购 + 秀动 showstart。** 三个源都用仓库里已有的采集器 kind（`json_list` / `json_list` / `web_list`）。

> **⚠️ 计划里「零新采集器代码」是错的（已按实现改写）。** 这三个接口每个都只接受一个查询参数（CPP 靠 `tag=`、B站靠 `keyword=`、秀动靠 `keyword=`），活动日期又只存在于 JSON 字段或卡片文本里，所以先给采集器补了三件事（下面第 0 条），再加源。改的是 `packages/backend/src/sources/{config-keys,json-list,web-list,collect}.ts`，另有两处跟着改：`content/provenance.ts` 的 `publisherOwnsUrl`（认领判断要认 `urls` 里的所有地址）与 `admin/sources.ts:180` 的 `sourceIdentity`（后台显示用 `urls[0]`）。

> **⚠️ 前置阻塞（已解除）**：`industry/prompts/prefilter.md:10` 把「粉丝二创、同人作品与应援图」列为 BLOCK，`industry/prompts/selection-score.md:81` 给同人作品 `sig ≤ 3`，同人 ONLY **活动**公告会被当成「同人**作品**」拦下。已在这两处显式豁免「同人 ONLY 活动 / 同人展 / 同人 LIVE」，把「同人活动」和「同人作品」区分开；`structure.md` 另加一条：中国大陆排期类来源的「活动时间：2026-11-15」就是 `kind=event`，只写日期不写时刻（那些时刻是北京时间，而结构步骤的时间基准是 JST，只取日期不会错）。

0. **采集器扩展（`packages/backend/src/sources/`）**
   - `config.urls`（`web_list` 与 `json_list` 都支持）：一个源可以扇出多条 listing URL。`collect.ts` 的 `fetchListing` **顺序**遍历，**单条 URL 空结果只记 `{url, count: 0}` 继续**，只有全部为空才抛 `no items matched (N urls)`；其它错误（404 等）立即整源失败。每条 URL 的条数留在 `fetch_runs.detail.urls`。原来的单 URL `config.url` 写法原样保留（`urls` 为空就走单 URL 分支）。
   - `json_list.summaryTemplate`：把 JSON 字段拼成正文，`{path}` 取值、`{date:path}` 归一成 `YYYY-MM-DD`（按 `publishedAtUtcOffset`，默认 `+08:00`），**某个占位符取不到值就整段连同分隔符一起丢掉**（B站不少场次没有 `district_name`，不能留空壳）。`publishedAtUtcOffset` 同时给 `publishedAtPath` 与 `{date:}` 用。
   - `web_list.summarySelector` + `summaryIsBody`：正文直接从列表卡片上取（多个选择器用逗号分隔，**按文档顺序**拼接，不是按写法顺序）。
   - 三个源都配 `summaryIsBody: true`：bodyStatus 直接是 "ok"，既不触发付费 Jina 抽正文，又让活动日期留在 `excerpt`/`bodyText` 里 —— `editorial/analyze.ts` 的 `grounded(quote)` 要求引文同时出现在素材与 `bodyText ?? excerpt` 里，**日期不写进正文就进不了日历**。
   - **⚠️ 不要给这些源配 `publishedAtSelector` / `publishedAtPath`**：活动日期在未来，`content/materials.ts` 的 `decideTimeline` 会把超过 1 小时的「未来发布时间」丢掉（`FUTURE_TOLERANCE_MS`），日期只能由模型从正文里抽成 `kind=event`。

1. **CPP 无差别同人站**（主力；实测独有 5 条）
   - 列表：`https://www.allcpp.cn/allcpp/event/eventMainListV2.do?type=3&time=8&sort=1&pageNo={n}&pageSize=100`
   - **走 `type=3`（= ONLYLIVE 分类）+ `time=8`（未结束）拉全量，再用 `tag` 过滤 —— 不要用关键词猜。**
     实测「谐律星奏 · 武汉少女音乐番Only」标题里根本没有 BanG Dream，只有 `tag` 字段里有（`少女乐队|BanGDream|孤独摇滚|GirlsBandCry|轻音少女`）。
   - **落地：一个源扇出 8 条 URL**，除 tag 外参数完全相同；`itemsPath: "result.list"`、`titlePaths: ["name"]`、`externalIdPath: "id"`、`urlTemplate: "https://www.allcpp.cn/allcpp/event/event.do?event={id}"`（**必须用 `id`，不是 `eventId`**）、`summaryIsBody: true`、`_girlsbands.initialBackfillLimit: 30`：
     `summaryTemplate: "活动时间：{date:enterTime}｜城市：{cityName}｜区县：{areaName}｜会场：{enterAddress}｜标签：{tag}｜想去：{wannaGoCount} 人"`
   - **实测 tag 覆盖（2026-10-05）**：`BanGDream`=7、`BanGDream!`=1、`BangDream！`（全角！）=1、`邦多利`=1、`少女乐队`=2、`孤独摇滚`=5、`GirlsBandCry`=2、`GBC`=1。`tag=` 大小写不敏感、但**不折叠 `!` 与 `！`**，所以三条拼写各要一条 URL；一次只接受一个 tag。这 8 条合起来 20 条候选、去重后 **9 场**，正好覆盖在范围内的全部活动（含标题里没有 BanG Dream 的「谐律星奏 · 武汉少女音乐番Only」与「珠海音乐企划ONLY」）。全量 187 条（`type=3&time=8`）的 447 个 tag 片段里，与我们相关的只有那 8 个加上 `音乐企划`/`音乐番Only`/`音企`/`现场演出`/`Live演出`；其余 400+ 是明日方舟、原神、特摄等无关 IP。
   - **⚠️ 不要改用关键词猜**：`tag` 字段才是分类的权威来源。
   - 字段：`id`、`eventId`、`name`、`type`、`tag`、`enterTime`、`endTime`、`cityName`、`areaName`、`enterAddress`、`wannaGoCount`、`circleCount`、`doujinshiCount`、`ticketStatus`
   - 详情页：`https://www.allcpp.cn/allcpp/event/event.do?event={id}`
   - **⚠️ `id` ≠ `eventId`**：详情页必须用 `id`（用 `eventId` 会拿到 1224 字节的占位页，用 `id` 才是 27KB 真实页）
   - **⚠️ `enterTime` 是 epoch 毫秒，必须按 `+08:00` 解析。** 按 UTC 会整整差一天（实测：武汉舟邦Only 与 谐律星奏 两例，B站同场活动可交叉验证）
   - **⚠️ 必须 GET**，POST 返回 405 Tomcat
   - **⚠️ `pageSize` 上限 100**，`total=196` 时只返回 100 → 必须翻页
   - 副产品：`wannaGoCount` / `circleCount` / `doujinshiCount` 是**现成的热度信号**，可直接喂「热点榜」
2. **B站会员购**（票务补充；实测独有 0，但开票信息最全）
   - `json_list`：`https://show.bilibili.com/api/ticket/search/list?keyword={kw}&page=1&pagesize=20&platform=web`
   - 需 `User-Agent` + `Referer: https://show.bilibili.com/`
   - **⚠️ 硬约束：`pagesize` 上限 20。** `21/25/30/50/100` 全部返回 **HTTP 200**，body 却只有 65 字节的 `{"errno":0,"code":0,"errtag":0,"msg":"","message":"","data":null}` —— **静默失败，不报错**。
     → 采集器**必须断言响应里有 `data` 字段**，不能只看 HTTP 200。`pagesize=20` 连打 10 次稳定 10/10。
   - 详情：`https://show.bilibili.com/api/ticket/project/getV2?version=134&id={id}&platform=web`（含 `sale_start`/`sale_end`、票价、场地图、交通）
   - **别用 `api/ticket/project/listV2`**（只返回首页精选 6 条）
   - **落地：一个源扇出 6 条 URL**（keyword 依次 `BanG Dream`、`少女乐队`、`孤独摇滚`、`哭泣少女乐队`、`MyGO`、`Ave Mujica`），`headers: {"Referer": "https://show.bilibili.com/"}`、`itemsPath: "data.result"`、`titlePaths: ["project_name"]`、`externalIdPath: "id"`、`summaryIsBody: true`、`_girlsbands.initialBackfillLimit: 20`：
     `summaryTemplate: "活动时间：{date:start_time}｜城市：{city}｜区县：{district_name}｜场馆：{venue_name}｜票务状态：{sale_flag}｜开票：{date:sale_start_time}｜票价：{price_low} 分起｜想去：{wish} 人"`
   - **⚠️ `urlTemplate` 要用稳定的会员购详情页 `https://mall.bilibili.com/neul-next/ticket-renovation/detail.html?id={id}`，不能用 `{raw:url}`**：接口给的 `url` 带每次搜索的 `track_id`，同一场活动在两个关键词下会变成两条（实测「广州·孤独摇滚x哭泣少女乐队同人Only展」重复）。实测该详情页 HTTP 200 / 48987 字节。
   - **⚠️ 搜索会返回已结束的场次**，`time=8` 那种过滤在这里不存在 → 用 `ingestNoiseFilter: {"dropMarkers": ["票务状态：已结束"]}` 在入库前丢掉（`noiseFiltered` 只看 title + excerpt，带字段名的标记不会误伤标题）。
   - **关键词实测（2026-10-05）**：`BanG Dream`=5、`少女乐队`=1、`孤独摇滚`=1、`哭泣少女乐队`=1、`MyGO`=0、`Ave Mujica`=0 → 8 条候选、去重后 7 条。**别加 `邦邦`（13 条全是「邦臣大酒店」之类噪声）、`GIRLS BAND CRY`（21 条里只有 4 条相关，其余是原神/三丽鸥/特摄/Phigros）**：搜索是模糊全文匹配。
3. **秀动 showstart**（livehouse 演出；实测唯一独有来源）
   - `web_list`：`https://www.showstart.com/event/list?keyword={kw}`
   - **落地：一个源扇出 4 条 URL**（keyword 依次 `少女乐队`、`哭泣少女乐队`、`孤独摇滚`、`BanG Dream`），`itemSelector: "div.list-box a.show-item"`、`titleSelector: "div.title"`、`summarySelector: "div.time, div.addr, div.price"`、`summaryIsBody: true`、`_girlsbands.initialBackfillLimit: 10`；**故意不配 `publishedAtSelector`**（活动日期在未来，会被 `decideTimeline` 丢掉）。
     → excerpt 形如 `价格：¥68起｜时间：2026/10/11 15:30｜[广州]MAOLivehouse广州（永庆坊店CLUB厅）`，城市在 `div.addr` 的 `[城市]` 前缀里，日期是斜杠格式、由模型归一成 `YYYY-MM-DD`。
   - **关键词实测（2026-10-05）**：`少女乐队`=1、`哭泣少女乐队`=1（同一条）；`孤独摇滚`/`BanG Dream`/`GIRLS BAND CRY`/`MyGO`/`邦邦`/`邦多利`/`少女乐团`=0。**空结果的 URL 不算失败**（`fetchListing` 只记 `count: 0`），保留它们是为了将来出现新演出时自动收到。
   - 该站 API 全部返回 `{"msg":"方法受限","success":false,"state":"get_not_support"}` → 无 JSON 可用，只能解析 HTML
   - 实测样本：`所谓正解？【哭泣少女乐队Only Live】| 2026/10/11 15:30 | [广州] MAOLivehouse（永庆坊店 CLUB厅）| ¥68起`
   - **详情页拿不到年份**：`/event/311467` 的 SSR 文本只写「10月11日 15:30」，年份只在列表卡片的 `div.time` 里 → 所以正文必须从列表卡片取，不能改成抓详情。
4. **接进企划日历**：这三个源产出的都是**带明确日期的活动**，是 W1-3 企划日历和 `.ics` 导出最主要的素材。CPP 的 `enterTime`/`endTime`、B站的 `start_time`/`end_time`、秀动的演出时间统一落成 `kind=event` 的日期条目（`industry/prompts/structure.md` 已加对应规则）。**只抽日期、不抽时刻**：`publication/deadlines.ts:38` 的 `jstInstant(at)` 把带时刻的 `at` 当 JST，而这三个源的时刻是北京时间，只取日期才能原样往返。（**W7 已改**：时刻现在按来源的 `config.timezone` 解释，「只取日期」不再是为了绕开 bug，而是那三个来源的公告本身就常只给日期。）
5. **信源分级与阈值**：三个源都定为 **`T2_EVENT`（国内活动排期平台，门槛 54）**、`participation_mode: "editorial"`、`site_fulltext: true`（纯中文，正文直接展示，不走翻译）、`syndicate_fulltext: false`、`interval_minutes: 360`（`jobs/source-intervals.ts` 会按产出量自己调；editorial 源最多被调到 60 分钟）。
   **新档位 `T2_EVENT` 是这一轮校准出来的**：最初三个源按 `T2 = 72` 走，结果 15 条国内条目 0/14 入选，而且分数（36–58）和日语 T2 负样本（49、68）完全重叠 —— 调门槛救不回来。先改评分标准（见下），再把国内排期类单独一档。新增档位要同时改四处：`industry/selection.ts` 的 `thresholds`、`packages/backend/src/admin/sources.ts:101,168` 的 `z.enum`、DB 的 `sources_tier_check`（迁移 `0057_source_tier_event.sql`）、`apps/web/app/features/admin/labels.ts:7 TIER_LABEL`。

**验收（2026-10-05）**

| 检查项 | 结果 |
|---|---|
| `npm run typecheck` | 绿（含 `npm run typecheck -w @girlsbands/web`） |
| `node --test tests/listing-fanout.test.ts tests/sources.test.ts` | 16 通过 / 0 失败（扇出、全空失败、404 失败、`renderFields` 段落丢弃与 `{date:}` 归一、`summaryIsBody`） |
| 三条源入 dev 库（`node --env-file=.env scripts/seed.ts`） | `sources: 3 added, 26 already there` |
| CPP 线上扇出（8 条 URL） | 20 条候选 → **9 个唯一 URL**（正是实测在范围内的 9 场），20 条 excerpt 全含 `YYYY-MM-DD` 日期 |
| B站线上扇出（6 条 URL） | 8 条候选 → **7 个唯一 URL**（重复来自接口的 `track_id`，已用稳定 `urlTemplate` 修掉），8 条 excerpt 全含日期 |
| 秀动线上扇出（4 条 URL） | 2 条候选 → 1 个唯一 URL（`所谓正解？【哭泣少女乐队Only Live】`）；两条空结果按 `count: 0` 跳过、不算失败 |
| 「已结束」场次过滤 | `noiseFiltered` 对「票务状态：已结束」返回 true（丢弃）、对「预售中」返回 false（保留） |
| 端到端（真跑一轮，见下） | ✅ 采集 → 预筛 → 全部动态 → 条目页 → 企划日历 → `.ics` 全部走通 |

**端到端验收（2026-10-05，`COLLECT_ENABLED` 与 `MODEL_CALLS_ENABLED` 打开后由 worker 自动跑，非手工调用 `collectSource`）**

| 检查项 | 结果 |
|---|---|
| 采集（`sources.schedule` 自动） | CPP `found 20 / new 9`、B站 `found 8 / new 5`（3 条被「已结束」过滤）、秀动 `found 2 / new 1` —— 与线上探针的 20→9 / 8→7 / 2→1 一致 |
| 预筛不误杀 | 15/15 `prefilter.label = PASS`、`relevance = pass`，含「同人ONLY」「Only Live」这类标题 |
| 进「全部动态」 | 15/15 `publications.eligible = t`、`visibility = public`、`body_mode = full`；`GET /feed/all.xml` 里 15 条全在 |
| 条目页正文 | `GET /items/<id>` 200，正文就是拼出来的「价格：¥68起｜时间：2026/10/11 15:30｜[广州]MAOLivehouse广州（永庆坊店CLUB厅）」；`/items/<id>/original` 指回 `showstart.com/event/311467` |
| 日期进企划日历 | `analyses.output.fact.deadlines` 抽出 `kind=event` / `sale_start`（如 2026-10-17、2026-11-15）；`GET /calendar/bang-dream.ics` 53 个 VEVENT 含 ONLY7 / 谐律星奏 / 音乐番Only，`/calendar/girls-band-cry.ics` 含哭泣少女乐队Only Live |
| `.ics` 格式 | `GET /calendar.ics` 200、102 个 VEVENT、`file` 认作 vCalendar、CRLF、**0 行超过 75 octets**（折行正确） |
| 精选（首页座位） | 第一轮 ⚠️ 15/15 `selected = f`：两次评分和 31–62 分 < `T2 = 72` × 2。它们进「全部动态」与日历，**不进首页精选** —— 阈值是 42 篇日文样本校准的（W6-5 / §五-5）。**已在「第二版校准」里解决：改评分标准 + 新档位 `T2_EVENT = 54` 后 14/15 入选、0 误选**（见下） |
| dev 库清理 | 删掉 **11 条**历史 `x_*` 源（`kind = x_search`、`enabled = f`、Nitter 取代后残留、`sources.json` 里没有、seed 的 `ON CONFLICT DO NOTHING` 不会清）连同它们 12 条 `fetch_runs`；`sources` 剩 30 条 = `sources.json` 的 29 条 + 1 条 disabled 遗留 `rss-bang-dream`（0 篇文章，未清） |
| 收尾 | 安全阀打开后 29 个源全量重抓的 **35 条积压**（全部卡在 429 阶梯重试上）已消化完：`new 0` / `analyzed 219` / `blocked 35` / `skipped 185`。`.env` 两个安全阀已恢复 `false` 并 `touch apps/worker/src/main.ts` 重启（`main.ts:19` 只在 `COLLECT_ENABLED === "true"` 时 `registerSourceJobs`），`fetch_runs` 与 `cron.sources.schedule` 都停止增长 ✅ |

**第二版校准：国内排期类单独一档（2026-10-05）**

第一轮端到端跑完发现的问题：国内 15 条全部落选首页精选，而且不是「差一点」——它们的分数（36–58）和日语 T2 负样本（49、68）完全重叠，靠调门槛救不回来。处理分两步。

第一步改评分标准（`industry/prompts/selection-score.md` 三处）：读者画像加上「也会为了国内的同人 Only 展与 livehouse 演出买票、订行程」；「必须正常评价的价值」新增一类「中国大陆同人 Only 活动与 livehouse 演出」（材料常常只有一条排期记录，**不算正文残缺、不是多事件打包、不是聚合号转载**，按 `live_announcement` / `ticket_info` 正常评分）；「必须压住的噪声」里「聚合号转载」那条加括注（票务页与活动站的排期记录不算转载）。**先改标准、不动门槛** —— 门槛只能整体移动，解决不了「哪一类判错了」。

第二步加 `T2_EVENT = 54`（国内活动排期平台单独一档）。**没有把 `T2` 整体降到 54**：那会连所有日语媒体与个人源一起降，而且档位高低会乱（`T1_5 = 65` 会高于 `T2`）。

| 检查项 | 结果 |
|---|---|
| 样本集 | `.data/gold.jsonl` 57 条 = 42 条日语 + 15 条国内（14 该选 / 1 不该选：上海联动快闪店） |
| 改前（旧标准 + `T2 = 72`） | acc 0.632 / P 0.895 / R 0.472；国内 **0/14 入选**，均分 46 |
| 改标准后（门槛未动） | 国内均分 46 → 63，14 条该选的落在 50–74、快闪 53；日语 T1 仍 P 1.00 / R 0.86（**与第一版校准逐位一致**，说明没污染原有语料） |
| 定档后复跑（`.data/eval/selection-all-57-1791146595746.json`，SelectBench `sb-20261004-3f6342`） | **acc 0.912 / P 0.97 / R 0.889 / F1 0.928**；国内 **14/15 全对**（唯一漏的是 `cn-009` 北京 BanG Dream only 同人嘉年华，50 分）；仍存的 FP 是日语 off-domain 的 73 分（超巡！超条先輩 ED，改前就在） |
| 上线配置（dev 库 15 条重跑） | **14/15 `selected = t`**、门槛 54，唯一未选是上海快闪（42+38=80 < 108，标 reject 正确） |
| 首页精选可见性 | `GET /feed.xml`（精选）200 / 51545B / 50 条 item，**其中 14 条国内**（9 CPP + 4 B站 + 1 秀动） |
| 顺带修的读者可见缺陷 | B站 `price_low` 是**分**（`6800` = ¥68），模板原来直接印「票价：6800 分起」。给 `renderFields` 加了 `{money:path}`（分 → 元），迁移 `0058_bilibili_price_unit.sql` 改已有源的模板，dev 库 5 条已重写正文并重跑 |
| 回归 | `npm run typecheck` 绿；`node --test tests/sources.test.ts tests/analyze.test.ts` 25 通过 / 0 失败；`/calendar.ics` 105 个 VEVENT、CRLF、0 行超 75 octets |
| 校准的局限 | 国内 15 条是站主自标、只有 15 条；`T2` 的日语正样本只有 1 条、`T1_5` 一条都没有。改评分标准、加新信源、换模型之后都要重跑（做法见 `docs/selection.md`） |

---

### 下一阶段：从「新闻聚合」到「Event Intelligence」（2026-10-05 定，W7–W18）

> 2026-10-05 站主看过一遍现状后的判断：项目已经不是「还缺几个信源」的阶段 —— 作为少女乐队新闻聚合站它相当完整（三个企划入口、10 个分类、中文全文、聚簇、热点、日报周报月报、截止雷达、企划日历、`.ics`、乐队页、邮件订阅、RSS/API/MCP、国内 ONLY/livehouse 数据都已落地）。缺的是把「**文章**」升级成「**可行动的结构化情报**」。

**主次关系要反过来。** 现在是「新闻是主角，Live 是从新闻里抽出来的日期」；要变成「Live / Release / Member 才是主角，新闻只是它们的证据」。

```
Project ──► Band ──► Member
                 └─► LiveEvent ─┬─ TicketRound（票务状态机）
                                ├─ Stream（配信 / 回看期限）
                                ├─ Merch（会场物贩）
                                ├─ Announcement（公布与变更）
                                ├─ Venue（场馆）
                                └─ Setlist（演出之后）
                 └─ Release ─┬─ Edition（通常盤 / 初回限定盤 A・B）
                             ├─ RetailerBonus（店铺特典：Animate / Gamers / Amazon / Tower / HMV）
                             └─ SerialCode（封入抽选序列号 ──► 哪一场 LiveEvent）

Source ──► Article ──► evidence ──► 上面这些实体的状态变化
```

| 优先级 | 工作包 | 一句话 |
|---|---|---|
| **P0** | W7 · 时间模型带时区 | 时区写在信源配置里（`sources.config.timezone`），`deadlines[].at` 仍是 `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm`，`.ics` 用 `TZID`；这是 W8/W9/W10/W14/W16 的地基 |
| **P0** | W8 · LiveEvent 一等实体 | 一场 Live 一个稳定实体 + 生命周期阶段，几十条情报挂在它下面 |
| **P0** | W9 · 票务状态机 TicketRound | FC先行 / Official先行 / CD封入 / 当落 / 入金 / 一般贩售 / 追加席 / 当日券 / resale，各带状态与时间点 |
| **P0** | W10 · 行动中心 | 首页回答「**我现在该干什么**」：今天截止 / 还有 N 天 / 即将开售 / 今日 Live |
| **P1** | W11 · 发售·版本·特典 | Single → Edition → 店铺特典 → 序列号 → Live，把已成型的分类连成链 |
| **P1** | W12 · 无账号关注 | 浏览器本地关注 + 随机 token 绑邮箱，**不引入账号** |
| **P1** | W13 · 成员实体页 | `/member/<id>`，把 162 条成员词表从「只为翻译」升级成页面（角色 ↔ 声优 ↔ 乐队） |
| **P1** | W14 · 情报变更 Diff | 「相比上一版：+ 新增当日券 / OPEN 17:00→16:30」，延期与中止标 ⚠️ |
| **P2** | W15 · 远征参考页 | `/guide`：只做指路 —— 外链公开的《现代远征攻略》与 SeatView 座位视角，再给站内三个入口（截止雷达 / Live 与活动 / 日历订阅）。**不写正文**（原「场馆实体页」改成待办） |
| **P2** | W16 · Setlist 与事后档案 | Live 结束后 Event 页从 upcoming 切 archive：Setlist / 现场 repo / 官方照片 / Archive 截止 / BD |
| **P2** | W18 · 用户纠错与情报投稿 | 条目页「报告问题」+ `/submit` 投稿源，全部先落 `feedback` 表，人工确认后才入库 |
| **风险** | W17 · 全文政策分层 | 官方全文 / 第三方摘要+链接 / 许可全文 —— **推翻站主旧决定，动手前必须重新点头** |

**这一步明确不做**：信源覆盖率与覆盖率评分（站主 2026-10-05 明确排除。健康度已经有 `sources.health` 与 `packages/backend/src/operations/`，覆盖率那层先不做）。

**动手前先修一行**（不是新功能，是已经存在的缺陷，reader 可见）：
`packages/backend/src/editorial/analyze.ts:108` 的 `DEADLINE_KINDS` 只有 **7** 个（`lottery_start / lottery_end / sale_start / event / stream_end / result / other`），少了 `release_start` 与 `merch_start`；而 `industry/prompts/structure.md:35-37` 明确让模型输出**九**种，`packages/backend/src/publication/deadlines.ts:23` 的 `KINDS` 与 `packages/contracts/src/site.ts:225` 的 `DeadlineKind` 也是九种。中间那道 `z.enum(DEADLINE_KINDS).catch("other")`（`analyze.ts:132`）把两者**悄悄吞成 `other`**：dev 库 177 条 deadline 里 21 条是 `other`，其中「发售日」「対象Blu-ray/DVD発売日」「受注截止」「标签罐发售结束」本应是 `release_start` / `merch_start`，在日历与截止雷达上被显示成「其他」。修法是在 `DEADLINE_KINDS` 里补上这两个值（`industry/prompts/structure.md` 与 `deadlines.ts` 都不用动），已入库的 21 条要不要重跑由 W7 决定。

**命名冲突先记住**：`packages/backend/src/events/` **不是** Live 事件引擎，它是**新闻聚簇**引擎（`groupArticle` / `composeStoryDigest` / `computeHotRanking` / `linkRelatedStories`，cron 在 `packages/backend/src/jobs/events.ts`）。W8 的 LiveEvent 代码不要放进这个目录，表名也别叫 `events` —— 建议 `packages/backend/src/lives/` + 表 `live_events`。另一个现状：`stories.frame` 在 dev 库里全是 null、`story_aliases` 是空表，也就是说**今天没有任何「一件东西」的持久身份**，聚簇靠 `grouping_decisions` 与向量召回；LiveEvent 必须自带稳定主键（企划/乐队 + 日期 + 场馆 派生）以及「哪些 article 是它的证据」的映射表。

---

## 下一阶段工作包（W7–W18）

> 每包按「为什么 / 现状（代码事实，已核） / 设计 / 验收标准 / 待站主拍板 / 工作量」写。**待拍板项汇总在 §七**，动手前先看那一节 —— 其中 W17 是**推翻站主旧决定**，必须先点头。

### W7 · 时间模型带时区（P0，地基）· ✅ 已完成 2026-10-05

**为什么**：`packages/backend/src/publication/deadlines.ts:38-40` 的 `jstInstant(at)` 把任何裸时刻死按 `+09:00` 解释（唯一调用点 `:104` 的 `soon` 标志）。中国大陆的场次是北京时间：dev 库里 `web-showstart-events` 已经有一条 `{"at":"2026-10-11T15:30","kind":"event"}`，15:30 侥幸同一天，**北京时间 21:00 之后开演就会被推成次日**。W8 的 `live_events`、W9 的票务轮次、W10 的行动中心、W14 的变更 Diff、W16 的 Setlist 都建在「一个带时区的时刻」上，所以先修这里，否则每个包各修一遍。

**现状（已核）**
- `packages/backend/src/publication/deadlines.ts:18` `JST_OFFSET_MS = 9 * 3600 * 1000` 是模块级常量；`:38-40` 死写 `${at}:00+09:00`；`:89-90` 用正则 + `at.slice(0,10)` 取日桶；`:145-159` `deadlineMonths` 直接对墙钟字符串比较。
- `packages/backend/src/editorial/analyze.ts:108` 的 `DEADLINE_KINDS` 只有 **7** 种，而 `industry/prompts/structure.md:35-37`、`packages/backend/src/publication/deadlines.ts:23` 的 `KINDS`、`packages/contracts/src/site.ts:225` 都是 **9** 种；`:132` 的 `z.enum(DEADLINE_KINDS).catch("other")` 把 `release_start` / `merch_start` **静默吞成 `other`**（dev 库 21 条，日历上显示成「其他」）。
- `.ics` 现在按浮动当地时间输出：`packages/backend/src/publication/calendar.ts:119` 是 `DTSTART:${compact(v.day)}T${hh}${mm}00`，**没有 `TZID`**。文件头 `:106` 的注释说明了这是刻意的（"a time is written as floating local time — 15:30 on the announcement is 15:30"）。
- dev 库 deadline 里带时刻的占少数：198 条总量、77 条带时刻；三个国内源 40 条里只有秀动 1 条带时刻。

**设计**
1. **时区由来源决定，不让模型写**（这条与草稿 A 不同，理由见下）：新增 `timezoneOf(source)`，默认 `Asia/Tokyo`；`sources.config.timezone` 有值时用它。新增受控 config 键 `"timezone"`（`packages/backend/src/sources/config-keys.ts` 的 `COLLECTED` 白名单 + 值域只接受 `Asia/Tokyo` / `Asia/Shanghai`），迁移 `0059_source_timezone.sql` 给 `json-cpp-only-events` / `json-bilibili-show` / `web-showstart-events` 写入（照 `0055`/`0057`/`0058` 的 `jsonb_set` 写法；`scripts/seed.ts` 只插不更新，所以 JSON 与迁移都要改）。
   - **不改 `industry/prompts/structure.md`**：提示词版本是内容哈希，改它 = 全部回执失效、已入库条目重跑结构步，而 `packages/backend/src/events/group.ts:237-241` 会把 `grouping_status` 置 `pending`、条目**短暂下架**。为一个代码能确定性推导的值付这个代价不值得（草稿 A 建议让模型输出 timezone，本文档改成由来源推导）。
2. **解析收在一个函数**：`type DeadlineTime = { localDate: string; localTime: string | null; timezone: Timezone; precision: "date" | "datetime" }`；`deadlineInstant(d)` 把 `localDate` + `localTime` 按 `timezone` 转成绝对时刻（两个时区都没有夏令时，用固定偏移表即可，不引依赖）；`localDate` / `localTime` 由现有 `at` 切出，`at` **保留为只读派生字段**，v1 API / RSS / 邮件文案不用改。
3. **读取路径全收在 `deadlines.ts`**：`deadlineRange`（`:135`）、`deadlineMonths`（`:145`）、`upcomingDeadlines`（`:119`）、`soon` 改吃 `localDate` + `localTime`；删 `jstInstant`；`packages/contracts/src/site.ts:244-265` 的 `DeadlineView` 加 `localTime` / `timezone`（`at` 标 `@deprecated`）；`apps/web/app/features/feed/deadlines.ts:24-26` 的 `clock()` 与 `packages/backend/src/subscriptions/content.ts:124-138` 改读 `localTime`（否则邮件里会写「当地时间」但其实是 JST）。
4. **`.ics` 加 `TZID`**：`packages/backend/src/publication/calendar.ts:119` 改成 `DTSTART;TZID=Asia/Tokyo:...` / `Asia/Shanghai`，文件里补两个静态 `VTIMEZONE`（只有两个时区，手写安全）；全天事件（`DTSTART;VALUE=DATE` + 次日 `DTEND`）不动。
5. **顺手补齐 `DEADLINE_KINDS`**：`packages/backend/src/editorial/analyze.ts:108` 补 `release_start` / `merch_start`，与另外三处逐字一致；**历史 21 条不重跑**（新条目自然就对了；旧条目留在库里不影响任何出口排序，只是标签仍显示「其他」）。

**验收标准**

| 检查 | 通过标准 |
|---|---|
| `node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test --test-timeout=120000 tests/calendar.test.ts` | timed 事件 `DTSTART` 带 `TZID`、文件里有对应 `VTIMEZONE`，仍 CRLF、0 行 >75 octets |
| 新测试 `tests/deadlines-time.test.ts` | 北京时间 23:30 的 `at` 落回当天 23:30（+08:00），**不推到次日**；JST 23:59 仍当天；裸日期行为不变 |
| `DEADLINE_KINDS` 一致性 | 新增断言：`analyze.ts` 的集合 == `deadlines.ts:23` 的 `KINDS` == `packages/contracts/src/site.ts:225` 的 `DeadlineKind`（防止再次漂移） |
| dev 读数 | `/calendar.ics` 里秀动那条是 `TZID=Asia/Shanghai`；`/deadlines` 与邮件文案显示「15:30（北京时间）」 |
| 回执/花费 | 本轮**不改任何提示词**，无重跑、无模型调用 |

**站主已拍板（2026-10-05）**：`.ics` 用**当地时刻**（日本 18:30 / 中国 15:30）并写 `TZID`；一天一桶**按当地日历** —— 北京时间 23:30 的场次就落在当天（不因为先换算成东京时间而挪到次日）。
**工作量**：实际约半天（含测试与文档），无模型成本。

**实现与验证（2026-10-05 完成）**

与原设计的差异（设计见上，这里只记改了主意的地方）：
- **`DEADLINE_KINDS` 不是补两项就完**：运行时数组搬进 `packages/contracts/src/site.ts` 当唯一真源（`DeadlineKind` 类型、`editorial/analyze.ts` 的 zod enum、`publication/deadlines.ts` 的 `KINDS`、`DEADLINE_LABELS` 全由它派生）。补丁式地给 `analyze.ts` 加两项，下次照样漂移。
- **`DeadlineView.at` 没标 `@deprecated`**：v1 API、RSS、邮件与几个组件仍读它，标了会让人以为可以删。
- **时区不进提示词**：`industry/prompts/structure.md` 一个字没改（改它 = 全部回执失效 + 已入库条目重跑结构步、`grouping_status` 置 `pending` 短暂下架）。时区只从 `sources.config.timezone` 读，`publication/deadlines.ts` 的 SQL 因此多取一列 `s.config AS source_config`。
- **网页侧**：`apps/web/app/features/feed/deadlines.ts` 的 `clock()` 换成 `clockText(localTime, timezone)`（「15:30 北京时间」/「全天」）；`Countdown` 收 `timezone` 并用 `TIMEZONE_OFFSETS` 解析；邮件 `DeadlineEntry` 加 `zone`，两处「所有日期与时刻均为日本时间。」改成「均为公告当地时间。」。
- **`VTIMEZONE` 只给带时刻的事件写**：全天事件没有钟，不需要声明时区。
- 历史 21 条 `kind='other'` 不重跑（新条目自然正确）。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（含 `npm run typecheck -w @girlsbands/web`） |
| `tests/calendar.test.ts` + 新 `tests/deadlines-time.test.ts` | **12 通过 / 0 失败**；带时刻的是 `DTSTART;TZID=Asia/Tokyo:…` / `Asia/Shanghai:…`，文件里有对应 `VTIMEZONE`，CRLF，0 行 >75 octets |
| 迁移 | `npm run db:migrate` → `applied 0059_source_timezone.sql`；dev 库 3 条国内源 `config->>'timezone'` 都是 `Asia/Shanghai` |
| 全量 `npm test` | **629 通过 / 0 失败**（65s） |
| 回执/花费 | 未改任何提示词，无重跑、零模型调用 |

**订正：dev 库里国内条目现在全是全天事件。** W6 交付时秀动那条抽到 `{"at":"2026-10-11T15:30"}`，但 W6 自己改了 `selection-score.md`，回执失效后该条在 20:41 重跑了一遍（`analyses.id` 316 → 386，`prompt_version` 里 `selection-score@1a83ac657c` → `@0a01fe5d9c`，`structure@558fff60ef` 未变），这次模型按 `structure.md` 的「国内排期类来源只写日期」给出裸日期 `2026-10-11`。所以线上 `/calendar.ics` 里看不到 `TZID=Asia/Shanghai`（105 个 VEVENT 全是 `DTSTART;VALUE=DATE`）—— 带时刻的上海来源由 `tests/deadlines-time.test.ts` 覆盖。这条修复的必要性没减少：模型哪天又写出时刻，没有时区就会按 JST 解释。

`industry/prompts/structure.md` 里那句「这些来源的时刻是北京时间，本步骤的时间基准是 JST，只取日期不会错」的**理由**现在不成立了（时刻不会再被当 JST）。**故意不改**：改提示词会让全部回执失效、已入库条目短暂下架；留到下一次不得不改 `structure.md` 的包（W8）一起改。

---

### W8 · LiveEvent 一等实体（P0）· ✅ 已完成 2026-10-05

**为什么**：现在一场 Live 没有身份 —— `facts` 只挂 `story_id`（`database/migrations/0002_events_reports.sql:51-65`），而 story 身份会合并、会 308 跳转（`packages/backend/src/publication/stories.ts:18/:28` 的 `resolveStory`），`stories.frame` 在 dev 库全是 null、`story_aliases` 是空表。所以「这场 Live 现在走到哪一步」无处可算，几十条情报只能各自成篇。

**现状（已核）**
- `packages/backend/src/events/` 是**新闻聚簇**引擎（`groupArticle` / `composeStoryDigest` / `computeHotRanking`），不是 Live 引擎 → 新代码放 `packages/backend/src/lives/`，表叫 `live_events`。
- `facts` 只有 `(public_id, story_id, title, subject, action, object, conditions, occurred_at, created_at)`，`createFact`（`packages/backend/src/events/group.ts:111-119`）**只插不更新**，全仓唯一的 `UPDATE facts` 是 `packages/backend/src/events/merge.ts:17` 的 `SET story_id`。
- `industry/taxonomy.ts:84-91` 的 `ENTITY_TAGS` 里会场只有 **7** 个（`Zepp` / `TOKYO DOME CITY HALL` / `日本武道館` / `ぴあアリーナMM` / `Kアリーナ横浜` / `有明アリーナ` / `LINE CUBE SHIBUYA`）；135 条场馆词表 `industry/glossary-venues.ts` 只服务翻译，**不是标签来源**。
- `apps/web/app/routes.ts` 里没有 live 路由。

**设计**
1. **表**（迁移 `0060_live_events.sql`）：`live_events(id, public_id, title, subject_entity, venue, timezone, starts_on, ends_on, starts_time, status, story_id, first_seen_at, updated_at)`，`status ∈ scheduled | cancelled | postponed`；唯一键写成**表达式索引** `live_events_identity ON (subject_entity, COALESCE(venue, ''), starts_on, COALESCE(starts_time, ''))` —— `venue` 与 `starts_time` 都可为 null，普通唯一索引会把 null 当成彼此不同，同一场会被插两次；`facts` 加一列 `live_event_id`（可空，回填式）＋索引。
2. **阶段 A（零模型成本，先做）**：`packages/backend/src/lives/link.ts` 的 `linkFactLiveEvent(db, factId, articleId)` 推导并 upsert 实体，`packages/backend/src/events/live.ts` 的 `linkLiveEvent(factId, articleId)` 在 `sql.begin` 里调它并写 `facts.live_event_id`（`facts` 的属主是 `events/`），调用点是 `events/group.ts` 写事务**提交之后**（`:460` 的 `const result: GroupResult` 之后）—— 失败只记 `result.liveLinkError`，绝不因为挂不上演出而让归组失败。键的推法：
   - **主体** = 该 fact 的全部条目里第一篇能推出身份的 `analyses.subjects ∩ ENTITIES`（`subject_entity`，不在词表里就不建）；
   - **会场** = `glossaryHits(text, ["venue"])` **恰好命中一条**才写（`ENTITY_TAGS` 里那 7 个会场不够用；命中 0 条或 2 条以上留 null，键退化成 `(主体, 开演日, 时刻)`）；模型阶段 B 给的会场先过词表归一，再退回正文；
   - **开演日** = 该 fact **全部条目**（`fact_articles` 展开）里 `kind='event'` 且能 `splitDeadlineAt` 的 deadline，按 `publications.analysis_id` 那条分析读 —— 与日历同一个真源（`publication/deadlines.ts:73`）；**最新一条分析不一定带日期**，所以不能图省事取最新；
   - **类别门** = 该 fact 至少有一个 `publications.category ∈ LIVE_CATEGORIES`（`live` / `ticket`，定义在 `industry/taxonomy.ts`）。**这条门是实测逼出来的**：dev 库第一批 6 条候选里 3 条是生放送（`stream`）、展览与快闪店（`collab`），有日期不等于有演出。
   - 同一场的多条报告合并成一条键：`keysOf` 逐行推导，`mergeKeys` 取「最富」的一篇（有会场 > 有时刻 > 有结束日），`status` 取第一篇非 `scheduled` 的；标题只取第一次写下的，阶段 B 的模型演出名可以后来换掉它（`COALESCE(模型名, 原标题)`）。
   - 回填用 `scripts/backfill-live-events.ts`（`--limit N`、`--dry`），把已经在库里的日文一手情报直接挂上实体。
3. **阶段 B（花模型钱，独立排窗口）**：新提示词 `industry/prompts/live-ticket.md` + `packages/backend/src/editorial/analyze.ts` 新步骤 `runLiveTicket`，结果写 `analyses.output.live`（additive，不动 `output.fact`），键名 `{title, venue, startsTime, endsOn, status}` 与 `lives/link.ts` 读的一致。**新提示词文件不会让旧回执失效**，所以只有被显式重跑的条目才花这笔钱；门是 `readsLive(category, fact)` = 类别 ∈ `LIVE_CATEGORIES` **且** 结构步骤抽到了 `kind='event'` 的日期（没有日期推不出演出身份，这步的钱不值得花）。重跑用 `scripts/reanalyze-live-tickets.ts`（默认 tag `live-ticket-<日期>`）；**换 attemptTag 会让该条目所有步骤的回执一起失效**，每条约 6 次调用，重跑期间条目会短暂下架（`grouping_status = pending`），要单独安排窗口。
4. **读取**：`packages/backend/src/publication/lives.ts` 出 `loadLive(publicId)`、`livesForSubject(subject, now, limit)`、`liveRefForStory(storyId, now)`、`liveSitemapEntries(now, limit)`；报告投影抽到 `packages/backend/src/publication/report-views.ts`（`reportView` / `storyReports` / `liveReports`），为了打断 `lives.ts ⇄ stories.ts` 的循环依赖。生命周期阶段**不存表**，由 `(now, starts_on/ends_on, 票务轮次)` 现场派生 `announced → ticketing → on_sale → live_day → finished`，`cancelled` / `postponed` 优先（**没有 `sold_out`**：售罄是票务轮次的状态，属于 W9）；所有日期一律走 W7 的 `deadlineRange`，报道列表过 `storyReportCondition`（`listedCondition` + `hasItemPage`）。演出自己日历的「今天」用 `packages/contracts/src/time.ts` 新增的 `timezoneDate(timezone, instant)` 算（**别用 `Date.parse("1970-01-01T00:00:00+09:00")` 那种写法，偏移符号会反，东京的今天会早一天**）。
5. **界面**：`apps/web/app/routes/live.tsx`（`/live/:publicId`：标题 / 阶段徽标 / 主体 / 会场 / 日期时刻 / 倒计时 / 票务与日程 / 相关公告 / 订阅日历）+ 主体页的 Live 区块（`apps/web/app/routes/topic.tsx` 的 `LiveSection`，与 live 页共用 `apps/web/app/features/feed/lives.ts` 的 `LIVE_STAGES` / `openStage`）+ story 页的「这场演出」入口；`apps/api/src/routes/site.ts` 加 `/api/site/lives/:publicId`（复数；在 `/^\/api\//` 下，**不用改** `packages/contracts/src/http-policy.ts`，但**新页面路径不能匹配** `API_OWNED_PATTERNS`，否则 `apps/web/server.ts:139` 的 `isApiOwned` 会把它代理去 api）；`packages/backend/src/publication/sitemap.ts` 收录有公开报道的 Live 页。

**验收标准**

| 检查 | 通过标准 | 实测 |
|---|---|---|
| 阶段 A 回填 | 抽 20 个已入库的 Live 类条目：能建实体的比例，以及**误并/误分**各几例；库里有实体后 `/live/<id>` 200 | 见下 |
| 幂等 | 同一条 article 重复 `linkLiveEvent` 不产生第二个实体；同事务，`createFact` 失败不留孤儿 | ✅ `tests/live-events.test.ts`「同一场只有一行」 |
| 阶段 B | 新提示词不改旧回执（跑一次 `npm test` 确认 `prompt_version` 相关断言不变）；重跑只影响指定 `attemptTag` | ✅ `tests/analyze.test.ts`「analysing the same revision again reuses every paid answer」仍绿 |
| 公开出口 | Live 页只显示 `listedCondition` 的报道；`.ics` / 日历读数与 W7 后一致（不新增日期算法） | ✅ 下架后 `loadLive` / `liveRefForStory` 为 null 且不再列在主体页 |
| 测试 | `tests/live-events.test.ts`：键推导、阶段派生（含 cancelled / postponed）、页面 200 与 404 | ✅ 8 个；`tests/analyze.test.ts` 12 个、`tests/deadlines-time.test.ts` 8 个 |

**实现与验证（2026-10-05 完成）**

| 项 | 结果 |
|---|---|
| 迁移 | `0060_live_events.sql` 已应用（dev 库） |
| 阶段 A 回填 | `scripts/backfill-live-events.ts` → `candidates: 6, linked: 3, no identity: 3`；被拒的 3 条正是生放送 / 展览 / 快闪店，类别门挡住；**误并 0、误分 0** |
| 样本不足（照实记） | 计划要求「抽 20 个 Live 类条目」，dev 库拿不到：`publications` 438 行里只有 30 行有 fact，`category ∈ live/ticket` 的 37 条里 31 条还没进 facts，能挂实体的 fact 一共 3 条，3 条全建出来了 |
| 库里的三场 | `kuzumimizuku 2026-10-18`（会场留空：`代官山SPACE ODD` 不在场馆词表里，宁缺勿错的降级）、`girls-band-cry ぴあアリーナMM 2026-11-03`、`mygo 2026-11-14` |
| 出口 | 三个 public_id 的 `/api/site/lives/<id>` 全 200（阶段 ticketing、`reportCount` 2/2/3）；`/live/<id>` 200 / 未知 id 404；`/topics/girls-band-cry` 的 Live 区块链到演出页；`/story/<id>` 有「这场演出」胶囊；`/sitemap.xml` 含 3 条 `/live/<id>` |
| 检查 | `npm run typecheck` 全绿；`tests/live-events.test.ts` 8/8、`tests/analyze.test.ts` 12/12、`tests/deadlines-time.test.ts` 8/8；全量 `npm test` 见「六、验证记录」 |
| 阶段 B 重跑 | **已完成（2026-10-05）**：`scripts/reanalyze-live-tickets.ts --tag live-ticket-v1` → `queued: 28`（换 tag 后约 170 次调用）。跑完 `analyses WHERE output ? 'live'` = **24**（其中 13 条抽到轮次、共 14 个轮次窗口），`articles.processing_state='failed'` 全程 0 |
| 重跑为什么不建演出（重要） | `packages/backend/src/events/group.ts` 的 `decide()` 有多条提前返回，而 `linkLiveEvent` 只挂在「写事实」那条路径上：24 条里 **21 条是历史条目**（`isHistorical(a) = a.backfill && (!a.published_at \|\| a.discovered_at - a.published_at > 48h)`，`packages/backend/src/content/materials.ts:95-97`）→ `verdict: "historical"`、只 `markGrouped`、**永远不建 fact**（`.data/w8-probe.ts` 逐条验证过：这 21 条 `fact_articles` 行数为 0）；剩下 3 条本来就有事实，但归组走 `if (kept && !recheckSelection)` 提前返回（重分析后 `grouping_status` 已是 `complete`）也没到钩子。结论：**重跑过的条目不会再归组**，新抽到的轮次只能由回填脚本补 |
| 回填收尾 | `scripts/backfill-live-events.ts` 的候选条件放宽成 `(f.live_event_id IS NULL OR an.output ? 'live') AND an.output->'fact'->'deadlines' @> '[{"kind":"event"}]'`，再跑得到 `candidates: 5, linked: 2, no identity: 3`（被拒的仍是生放送 / 展览 / 快闪店），写入 2 条轮次 —— `tNasiklIqz44` general（kuzumimizuku，`2026-10-03T20:00`）、`tqJ5udF6TwO8` fc · チケットぴあ（girls-band-cry，`2026-10-03T20:00` → `2026-10-12T23:59`）+ 3 条 `ticket_round_events` |
| 已知缺口 | `publications.category='live'/'ticket'` 的条目大多还没进 facts，所以「一场 Live 一条时间线」目前只在少数条目上成立；三场里 mygo `2026-11-14` 是 0 轮次（它的事实 14 从没重分析过、没有 `output.live`）；`代官山SPACE ODD` 等会场补进词表会改 `GLOSSARY_VERSION` → 全站重译，**要单独一次决定** |
| 模型质量问题（照实记） | 事实 4 的引文里明明有 `受付期間:2026年10月3日(土)20:00〜10/10(土)23:59`，模型却把 `applyEnd` 写成 `null`（没把 `10/10` 归一成年份）。这是提示词/模型的问题，不是 `normalizeRounds` 的校验漏洞 —— 校验只做「引文里真的出现了吗」，不替模型补年份 |

**待站主拍板（2026-10-05 已拍板，两条都不需要改代码）**：① **粒度保持「一站一实体」** —— 昼/夜两场按开演时刻分成两个页面；对盘时每支乐队的公告各建一页（谁的通知挂谁的页）；巡演每一站各一页，票务与日期不混在一起。要改成「巡演一实体」或「对盘一实体」只需动唯一键与 `mergeKeys`。② **已完结的 Live 页长期保留、照常收录** —— 阶段照常派生 `finished`，页面 200、进 sitemap、企划页里排在未开演之后；W16 的「事后档案」就建在这些页上。（阶段 B 灰度重跑 2026-10-05 已跑完，见上表。）
**工作量**：2.5 天（阶段 A 约 1 天，阶段 B 与页面 1.5 天），阶段 A 零模型成本。

---

### W9 · 票务状态机 TicketRound（P0）

**为什么**：`apply_start` 与 `apply_end` 现在是两条互不相识的 `deadlines`（`kind` 分别为 `lottery_start` / `lottery_end`），`result` / `payment_deadline` / `platform` / 轮次类型（FC 先行 / Official 先行 / CD 封入 / 一般贩售 / 追加席 / 当日券 / resale）**无处可放**。用户打开 Live 页要看到的是「**当前：CD 封入先行受理中，10/12 23:59 JST 截止，还有 7 天**」，而不是「10 月 4 日官方公布了新的先行信息」。

**现状（已核）**
- `packages/backend/src/editorial/analyze.ts` 的 `DEADLINE_KINDS`（原来只有 7 种，与 `industry/prompts/structure.md` 的 9 种不同步）**已在 W7 补齐**：现在九种都从 `packages/contracts/src/site.ts` 的 `DEADLINE_KINDS` 派生，别再在别处抄一份。
- `packages/backend/src/publication/deadlines.ts:1-12` 已把口径（listed 集合、JST、48 小时）定死在头注释里，是唯一日期算法；**轮次日期必须接进这里，不能在日历里另算一套**。
- 票务分类在 `industry/taxonomy.ts` 里已经很细（FC/Official/CD 封入先行、抽选结果、一般贩售、追加席、当日券、转售），只是它们今天只是文章标签。

**设计（落地版，2026-10-05 完成）**
1. **两张表**（迁移 `0061_ticket_rounds.sql`）：`ticket_rounds(id, public_id, live_event_id → live_events ON DELETE CASCADE, kind, platform, timezone, apply_start_at, apply_end_at, result_on, payment_due_on, first_fact_id, first_article_id, quote, first_seen_at, updated_at)`，`kind ∈ fc | official | cd_serial | playguide | general | additional_seat | day_of | resale | streaming`。四个日期是 `text`，与 `analyses` 的 `at` 同形状（`YYYY-MM-DD` / `YYYY-MM-DDTHH:mm`），解析复用 `splitDeadlineAt` / `deadlineInstant`，**不另造一套**。唯一键是表达式索引 `(live_event_id, kind, COALESCE(substring(apply_start_at FROM 1 FOR 10), ''))` —— 取日期段，先只写到日、后来写明时刻的同一条受理归成同一条。外加 **append-only** `ticket_round_events(ticket_round_id → ticket_rounds ON DELETE CASCADE, kind ∈ opened | closed | result | payment_due, observed_at, fact_id, quote)` + 唯一索引 `(ticket_round_id, kind)`：某一种节点第一次出现时追加一行，重复同步撞索引什么也不写。
2. **`status` 是投影，不落库**：按四个日期与此刻算出来（`roundStatus`），`ticket_round_events` 是留给 W14 读的时间线。实际只有 6 种：`announced | open | awaiting_result | result_out | payment_open | closed`；计划里的 `paid` / `unpaid` / `sold_out` / `cancelled` 没有数据来源（站里没有读者账号，公告也不写售罄），不做。只写日期的截止日**整天算数**（到那一地的 23:59），开始类节点从当天零点起 —— 读者最需要「截止日」这个状态的就是那一天。
3. **接进唯一日期算法**：`packages/backend/src/publication/deadlines.ts` 的 `deadlineWindow` 与 `deadlineMonths` 各写成 `WITH … AS (公告分支 UNION ALL 轮次分支)`。轮次分支从 `ticket_rounds tr JOIN publications p ON p.article_id = tr.first_article_id` 出发，用 `CROSS JOIN LATERAL (VALUES ('applyStart', tr.apply_start_at), …)` 展开成四行；公告分支加 `LEFT JOIN facts f ON f.id = p.fact_id` 与「同一天已被轮次接管就不再列出」的 `NOT EXISTS`（**按日期逐天比**，不是「这条事实挂了有轮次的演出就把票务日期全砍掉」，否则会丢掉轮次没抽到的日期）。日期种类相应加 `sale_end` 与 `payment_deadline`（`packages/contracts/src/site.ts` 的 `DEADLINE_KINDS` 仍是唯一真源，web 的 `apps/web/app/features/feed/deadlines.ts` 跟着补齐）。`publication/calendar.ts` 一行没碰。
4. **写入**：`packages/backend/src/lives/tickets.ts` 的 `syncFactTicketRounds` 由 `packages/backend/src/events/live.ts` 的 `linkLiveEvent` 在挂上演出之后**同一事务**里调用。每次同步都读一遍该条目的最新分析 —— 同一场演出的后续报告可能第一次写出截止日、当落日、缴款期限。只补空、不覆盖（`COALESCE`），只有「只写到日 → 写明时刻」这一种算精度变好。
5. **读取**：`packages/backend/src/publication/tickets.ts` 出 `roundsOf` / `roundStatus` / `roundSlotKind` / `roundNote` / `ROUND_SLOTS`；`publication/lives.ts` 的 `loadLive` 带上 `rounds`，并把已被轮次接管的日期从 `dates` 里去掉（页面上同一件事只出现一次）。**没有** `currentRound` / `nextStage` / `daysLeft`：演出页把一轮的四个日期按槽位列全，选哪一轮是读者的动作。`itemId` 指向第一次说出这条轮次的那篇公告，那篇被下架时留 null（日期仍然算数，只是没有能点进去的原文）。
6. **演出页**：`apps/web/app/routes/live.tsx` 的「票务与日程」先列轮次（`TICKET_ROUND_LABELS[kind]` + `platform` **照原文** + 状态徽标 + 四个日期 + 链到 `itemId`），其余日期收在「公告里的其它日期」下面；状态的说法与颜色在 `apps/web/app/features/feed/tickets.ts`。
7. **不 backfill 老数据**：靠 W8 阶段 B 的灰度重跑生成（同一次重跑同时得到演出名与轮次，`live-ticket` 步骤一次调用答两件事）。

**验收标准**

| 检查 | 通过标准 | 实测 |
|---|---|---|
| 日期唯一算法 | 从 `ticket_rounds` 加一条轮次后，`/deadlines`、企划日历、`.ics` **三处同时**出现该日期（不是各算一遍） | 雷达 / `deadlineRange` / `deadlineMonths` 三处同时出现且带轮次行首（`FC 先行 · イープラス`）；`calendar.ts` 未改，`.ics` 走 `deadlineRange` |
| 状态投影 | 六个阶段都能从日期算出；跨时区的截止时刻按该轮自己的钟比 | `tests/ticket-rounds.test.ts`「状态按轮次自己那一地的钟算」：六个阶段 + 同一句 `12:00` 在东京/上海的不同结论 |
| 幂等 | 同一条 article 重跑两次不产生重复轮次（`live_event_id + kind + apply_start 日期段`） | 「同一条公告重跑两次只有一行」：重复挂 + 补截止日/当落日都只有一行，`ticket_round_events` 每多一种节点才多一行 |
| 公开出口 | 轮次日期能被 `deadlineRange` 取到；`.ics` 折行/CRLF 检查仍通过 | `deadlineRange` 只出现一次（公告自己写的同一天日期被接管）；`.ics` 未受影响（同一函数） |
| 测试 | `tests/ticket-rounds.test.ts` | 8 个测试全绿（键与幂等、状态六阶段、雷达去重、演出页、公开接口、槽位映射、信源时区） |

**实现与验证（2026-10-05 完成）**：`npm run typecheck` 全绿；`npm run db:migrate` → `applied 0061_ticket_rounds.sql`；`tests/ticket-rounds.test.ts` 8/8；全量测试见 §六。dev 库里用合成轮次实测过三处出口（造完即删，库里现在 0 行轮次）。**已知缺口**：dev 库 438 条 publications 里只有 30 条有 `fact_id`/`story_id`，所以「同一天由另一篇文章写出的票务日期」既不是 `tr.first_article_id` 也连不到同一场演出，接管不到 —— 那是数据现状（老条目没有事实身份），不是规则漏洞。
**待站主拍板**：已拍板三条 —— 轮次是票务日期的权威（`deadlines` 只是投影）、不记个人当落、平台名照原文（不做中文显示名映射，`industry/glossary.ts` 一个字不改，否则 `GLOSSARY_VERSION` 变会让全站重译）。**剩下一条已办**：W8 阶段 B 的灰度重跑 **2026-10-05 已跑完**（`--tag live-ticket-v1`，`queued: 28`，约 170 次调用；跑完没有新建演出、也没有轮次，新轮次由回填脚本补进 `ticket_rounds` 2 条 —— 原因见 §六 W8 的「重跑为什么不建演出」）。
**工作量**：3 天（实际约 1.5 天，含提示词扩写与页面；重跑本身花模型钱且条目会短暂下架）。

---

### W10 · 行动中心（P0）

**为什么**：首页现在只回答「今天发生了什么」。`apps/web/app/routes/home.tsx:84` 的注释早就写着 *"Trending comes last on purpose: what the reader can still act on outranks what is merely being talked about."* —— 但落地的是一个热点区块，不是「**我现在该干什么**」。截止雷达的算法已经存在，缺的只是产品界面。核心主张从「中文看全」升级成「**中文看全，而且不会错过**」。

**现状（已核）**
- `packages/backend/src/publication/deadlines.ts:1-12` 的头注释已把口径定死（listed 集合、JST 口径、48 小时），`:119` `upcomingDeadlines` 与 `:61` `deadlineWindow` 是唯一日期算法。
- `apps/api/src/routes/site.ts:167-171` 的 `/api/site/deadlines` **只读 `horizon`**，不传 subject / kind；`apps/web/app/routes/deadlines.tsx:19-22` 的 loader 同样不传。
- 邮件侧已有 48 小时提醒：`packages/backend/src/subscriptions/notify.ts:30` `sendDeadlineReminders`。
- 首页没有行动区块。

**设计**
1. **数据层**：`upcomingDeadlines` 加可选 `{ subject?, kinds?, horizonDays? }` 过滤，并**在服务端**分成四组返回：`今天截止` / `还有 N 天` / `即将开售` / `今日 Live`。分组只在服务端做一次，首页、`/deadlines` 页、邮件、RSS 共用同一份。
2. **界面**：新增 `apps/web/app/features/feed/ActionCenter.tsx`，插在 `home.tsx` 的 `HotTopics` **之上**；每行一张卡片（主体 / 轮次名 / 截止时刻（W7 之后带时区）/ 还有几天 / 链接到 Live 页或条目页）。`/deadlines` 页加主体与类别筛选（URL 参数，照 `packages/contracts/src/site.ts` 的 `TimelineFilters` 写法）。
3. **「即将开售」包含哪些 kind**：建议 `sale_start` + `release_start` + `merch_start`（后两个依赖 W7 第 5 条补齐 `DEADLINE_KINDS`）——见 §七 待拍板。
4. **缓存与一致性**：沿用 `/api/site/deadlines` 的 `public, max-age=60, s-maxage=60` 与 ETag 约定；四组数据都从同一个 `deadlineRange` 投影出，不新增日期算法。

**验收标准**

| 检查 | 通过标准 |
|---|---|
| 首页 | 出现「今天截止」区块；只含 listed 条目；空态是一句话（「今天没有截止的」）而不是空白 |
| API | `/api/site/deadlines?subject=…&kinds=…` 返回分组；**旧调用（只带 horizon）行为不变** |
| 一致性 | 同一时刻，行动中心、`/deadlines`、`.ics`、邮件提醒的日期集合相同（写一条测试直接比这四处） |
| 时区 | 国内场次显示「北京时间」、日本场次显示 JST（W7 之后才有） |
| 测试 | `tests/action-center.test.ts` |

**站主已拍板（2026-10-05）**：首页行动中心看 **14 天**（30 天全量留在 `/deadlines`）；「即将开售」包含 **`sale_start` + `release_start` + `merch_start`**。

**实现与验证（2026-10-05 完成）**
- 契约：`packages/contracts/src/site.ts` 在 `DeadlinesResponse` 之后新增 `ActionCenterResponse { computedAt; from; to; dueToday; onSale; liveToday; upcoming; total }`，四组都是 `DeadlineView[]`。
- 数据层：`packages/backend/src/publication/deadlines.ts` 新增 `actionCenter(now = new Date(), { horizonDays = 14, subject? })`，**复用同一个 `deadlineWindow`**（`from = jstDate(now)`、`to = addDays(from, horizonDays)`），逐行分桶且**每行恰好落一组**：当天（`item.day === timezoneDate(item.timezone, now)`，用演出/公告自己那一地的钟）且 `kind = event` → `liveToday`；当天且 ∈ `CLOSING_KINDS`（`lottery_end` / `sale_end` / `stream_end` / `payment_deadline`）→ `dueToday`；∈ `OPENING_KINDS`（`sale_start` / `release_start` / `merch_start`）→ `onSale`；其余 → `upcoming`。`upcomingDeadlines` 另加可选 `kinds`（`undefined` = 不过滤；空数组 = 匹配不到任何行，`total` 跟着重算）。**没有第二个日期算法**。
- API：新增 `GET /api/site/actions?horizon=&subject=`（`etagPrefix: "actions"`、`public, max-age=60, s-maxage=60`）；`/api/site/deadlines` 增加 `subject` 与 `kinds`（逗号分隔，认不出的写法直接丢掉），只带 `horizon` 的旧调用走原路径、行为不变。
- 界面：新增 `apps/web/app/features/feed/ActionCenter.tsx`（四组 今天有活动 / 今天截止 / 即将开售 / 接下来，空组不渲染），在 `apps/web/app/routes/home.tsx` 里取代截止雷达 —— 邮件区块搬到 `apps/web/app/features/feed/SubscribeBlock.tsx`、删掉 `DeadlineRadar.tsx`（两个日期区块叠在同一个 aside 里更糟）；`apps/web/app/lib/api.server.ts` 的 `apiDeadlineCache` 改成吃多份上游响应头并取最小新鲜度；`/deadlines` 加企划与种类筛选（URL 参数，过滤态 `noindex`），空态在过滤态改写。
- 验收：`npm run typecheck` 全绿；`tests/action-center.test.ts` **7/7**（分桶唯一性与总数、行动中心 ⊂ 雷达同窗口、时区「今天」按演出自己的钟、`subject` 按 `entityTags` 展开、`kinds` 不改窗口、API 形状、**四个出口同一批日期**）；全量 `npm test` **655/655**（W9 基线 648，+7）；`npm run build -w @girlsbands/web` + `node --test apps/web/tests/*.test.ts` **29/29**。
- **一致性那条验收怎么测的**：`tests/action-center.test.ts` 最后一条用一个 `subject`（`mygo`）把四个出口切到同一批行 —— `actionCenter` 四组、`upcomingDeadlines`、`deadlineRange`（月历与 `/calendar.ics` 都从它建事件）、`deadlineData`（48 小时提醒信，内部再读一次雷达后用 `matches(bands, subjects)` 留订阅者自己的乐队），断言四者的「`at`|`title`」集合逐字相等（邮件不保留 `itemId`，所以只能用它自己会打印的这两列比）。
- **已知边界（共用窗口，不是分组逻辑的 bug）**：窗口起点与雷达一样是 `jstDate(now)`，所以北京时间 23:30 的国内场次在日本日切后的那一小时会落在窗口外；`tests/action-center.test.ts` 里显式断言了这条。
- dev 实测（2026-10-05）：`/api/site/actions?horizon=14` → `from 2026-10-05 / to 2026-10-19 / total 23`，`dueToday 0`、`onSale 5`、`liveToday 3`、`upcoming 15`，与 `/api/site/deadlines?horizon=14` 的 `total 23` 同一批行；`?kinds=lottery_end` → 2 行（10-10 抽選受付截止、10-12 FC 先行 · チケットぴあ）。首页渲染出行动中心；`/deadlines?kinds=lottery_end` 的过滤态带 `noindex`，且页面里出现的那条 `sale_start` 来自 root loader 的全站雷达数据，不是漏过筛选的行（已用 `/_.data?_routes=root` 对照确认）。
**工作量**：2 天（实际约半天，无模型成本）。

---

### W11 · 发售·版本·特典数据库（P1）

**为什么**：用户要的是一张 Single 的完整形状 —— 通常盤 / 初回限定盤 A（Blu-ray + Live 抽选序列号）/ 初回限定盤 B / 店铺特典（Animate、Gamers、Amazon、Tower、HMV）/ 预约截止 / 首批特典 / 封入抽选券对应哪场 Live / 配信平台 / 官方商品页。分类与标签已经把「限定版、店铺特典、序列号、受注生产、场贩」都记下来了，**但它们彼此不相连**；`deadlines` 把发售日与受注截止当散点（而且这两个 kind 现在被吞成 `other`）。对少女乐队企划最值钱的 **CD → 抽选券 → Live** 这条链，今天在任何出口上都读不出来。

**现状（已核）**
- 分类与标签已齐：`industry/taxonomy.ts:61-71` 的 `CATEGORY_TAGS`（新作发售 / 初回限定盘 / 数字发行 / Blu-ray/DVD / 周边商品 / 店铺特典 / 联名商品）、`:74-81` 的 `TOPIC_TAGS`（序列号 / Single / Album / EP / Blu-ray / Live 专辑 / MV / 限定版 / 店铺特典 / 受注生产 / 场贩）、`:94-144` 的 `TAG_SYNONYMS` 已做归一。
- **没有任何表**存版本与特典（dev 库 49 张表里没有）；结构化扩展只有 `analyses.output` jsonb，而 `packages/backend/src/editorial/analyze.ts:117-139` 的 `FactSchema` 只有 `conditions[]` 与 `deadlines[]`。
- 数据量：dev 库 `publications` 438 行，命中发售类标签 **36 行**（`Blu-ray/DVD` 14、`限定版` 13、`受注生产` 12、`店铺特典` 12、`新作发售` 11、`Single` 5、`初回限定盘` 5、`场贩` 4、`数字发行` 3）。
- 唯一写入点：`packages/backend/src/publication/publish.ts:207-211` 与 `:314-351` 的 `publications` upsert。

**设计**
1. **四张表**（迁移 `0062_releases.sql`，编号按实际合并顺序取）：
   - `releases(public_id, subject_entity, title, kind ∈ single|album|ep|bluray|dvd|digital|other, release_on, announced_on, timezone, story_id, UNIQUE(subject_entity, title, release_on))`
   - `release_editions(release_id, name, kind ∈ regular|limited|first_press|other, includes_bluray, includes_serial, price_yen, sku, UNIQUE(release_id, name))`
   - `release_bonuses(release_id, edition_id, retailer, bonus, first_press, url)`
   - `release_serials(release_id, edition_id, kind ∈ lottery|preorder|streaming|other, live_event_id FK→W8, live_title（W8 未落地时兜底）, apply_start, apply_end, result_on, url)`
2. **哪些不做表**：「预约截止 / 受注截止 / 配信观看期限」继续留 `deadlines` —— `deadlineRange` 已经吃它，日历、`.ics`、邮件、雷达共用一份日期，另起一张表就是把「别在别处另算日期」重犯一遍；「哪家店」不做实体表（`ENTITY_TAGS` 的 5 个商店已是标签，存文本就够）；「配信平台」也不做表（`industry/glossary.ts` 的 `PLATFORMS` 只是写法白名单）。
3. **写入分两阶段**：阶段 A（**零模型成本**）新增 `packages/backend/src/publication/releases.ts` 的 `deriveReleases(tx, articleId, analysis)`，在 `publish.ts:314-351` 的 upsert **同一事务**里调用，只复用现有数据（`category ∈ {release, merch}`、`tags` 里的 `Single/Album/EP/Blu-ray/Live 专辑/限定版/店铺特典/受注生产/序列号`、`deadlines` 里 `release_start`/`merch_start` 的日期、`subjects ∩ ENTITIES`）—— 它只能造出 `releases` 行与发售日，造不出版本与特典；阶段 B（要模型，可灰度）新提示词 `industry/prompts/release.md` + `analyze.ts` 的 `runRelease(a, opts)`，结果整包写 `analyses.output.release`（additive，**不动 `fact`、不改 `structure.md`**），每个叶子字段都要过 `grounded`（`analyze.ts:173-204`）：引文必须同时出现在 `collapseWhitespace(buildMaterial(a))` 与 `bodyText ?? excerpt`，否则整条丢掉。
4. **读取**：`loadRelease(publicId)`、`releasesForSubject(subject, now, limit)`、`releasesForMember(memberId, now)`（W13 用）、`releaseOfStory(storyId)`；日期一律走 `deadlineRange` / `upcomingDeadlines`，报道过滤走 `listedCondition` + `hasItemPage`（下架必须能让页面 404）。
5. **出口**：`apps/web/app/routes/release.tsx` + `apps/api/src/routes/site.ts` 的 `/api/site/releases/:publicId` + `apps/api/src/routes/og.ts` 的 `/og/releases/:file` + `packages/backend/src/publication/sitemap.ts`（只收有 listed 证据的，`lastmod` 取 `updated_at`）+ `apps/web/app/routes/story.tsx:293-320` 日期面板加一行「这张碟」。API 与 OG 都落在 `packages/contracts/src/http-policy.ts:97` 的 `/^\/api\//` 与 `:106` 的 `/^\/(og|contact)\//` 里，**不用登记 `API_OWNED_PATTERNS`**。

**验收标准**

| 检查 | 通过标准 |
|---|---|
| 迁移幂等 | 迁移连跑两次 0 error；`\d releases` 有 `UNIQUE (subject_entity, title, release_on)` |
| 表与列都被用 | `tests/architecture.test.ts` 全绿（`:106-118` 要求每列都被生产代码按名字引用） |
| 发售日不再吞成 other | 重跑后 `deadlines` 的 `kind` 分布里出现 `release_start` / `merch_start` |
| 版本与特典真的连起来 | 至少一行 `releases` 带 >1 个 edition；序列号能指到 `live_event_id`（W8 落地后） |
| 实体不误并 | 同 `(主体, 标题, 发售日)` 命中同一行、次日不误并、`withdrawn` 让发售页 404 |
| 出口 | `npm run typecheck` 全绿；sitemap 有 `/release/`；`/og/releases/<id>.png` 200 |
| 测试 | `tests/releases.test.ts` 全绿 + 全量 `npm test` 0 失败 |

**站主已拍板（2026-10-05）**
- 店铺特典**只抽公告里写了的**：不开人工配置文件，公告只写「対象店舗」时页面上就显示这几个字。
- 粒度取「1 个 `releases` 行 + N 个 editions」（通常盤 / 初回限定盤 A / 初回限定盤 B 是同一张碟的三个版本）。
- 存量**重抽**命中「发售 / 周边」标签的条目（实际候选 68 条），换 `attemptTag` 跑一次。

**实现与验证（2026-10-05 完成）**
1. **迁移** `database/migrations/0062_releases.sql`：`releases`（`kind` 8 个值含 `merch`，`UNIQUE` 走 `releases_identity ON (subject_entity, title, COALESCE(release_on, ''))` —— 发售日未定的公告也不会互相误并）、`release_editions`、`release_bonuses`、`release_serials`。第一次跑完 `\d releases` 发现 `releases_kind_check` 少了 `merch`，改完 CHECK 后 `DROP TABLE … CASCADE` + `DELETE FROM schema_migrations` 在 `aniband` 与 `girlsbands_test` 两个库各重跑一次（`scripts/migrate.ts` 只按文件名记账、没有 hash，所以改已应用的迁移要手动回退）。
2. **阶段 A（零模型成本）** `packages/backend/src/releases/derive.ts`：`releaseKindOf`（分类 / 标签 / 标题三条线索，说不出「发布」就返回 null）、`readsRelease`、`releaseSubjectOf`（乐队优先于企划）、`deriveReleases(db, m)`，由 `packages/backend/src/publication/publish.ts:374` 在 publications upsert 的**同一事务**里调用。**标签免费且确定，只在标签只说得出 `other` 时才让模型细化 `kind`**。
3. **阶段 B** `industry/prompts/release.md`（七节：碟名 / 形态 / 发售日与公布日 / 版本 / 店铺特典 / 序列号 / 引文）+ `analyze.ts` 的 `runRelease`（`PROMPT_VERSIONS.release`、purpose `release_article`、maxTokens 1200、`attemptTag` = `<tag>:release`），结果整包写 `analyses.output.release`，additive 不动 `fact`；每个叶子字段都过 grounded 三件套 `stringInText` / `numberInText`（`3300` 与 `3,300` 都算）/ `linkInText`（必须是 http(s) 且出现在原文）。`packages/backend/src/editorial/models.ts:22` 的 structure capability 加 `release_article`，`packages/backend/src/jobs/content.ts:248` 的 `ARTICLE_STEPS` 同步加，失败的条目才会被送回分析。
4. **读取层** `packages/backend/src/publication/releases.ts`：`loadRelease`、`releasesForSubject`、`releaseOfStory`、`releaseSitemapEntries`，可见性一律走 `storyReportCondition`（第一条公告下架 / 未到发布时间 ⇒ 页面 404）。
5. **出口** `/api/site/releases/:publicId`（ETag 前缀 `release`、`public, max-age=60, s-maxage=60`）、`/og/releases/:file`、sitemap 的 `/release/`、`apps/web/app/routes/release.tsx`、主体页的「发售」栏（`topic.tsx` 的 `ReleaseSection`）、story 页的「这张碟」pill；契约加 `TopicPage.releases` 与 `StoryDetail.release`。
6. **踩到的坑**：`RELEASE_SELECT` 片段自带 `FROM …`，列表查询再往后追加 `edition_count` / `has_serial` 两个子查询就会拼出 `SELECT …, FROM …` ⇒ `syntax error at or near "("`；拆成 `RELEASE_COLUMNS` / `RELEASE_FROM` / `RELEASE_COUNTS` 三段才修好（`lives.ts` 的 `LIVE_SELECT` 没这个坑，是因为它的计数写在片段内部的 `CROSS JOIN LATERAL` 里）。教训：**带 FROM 的 SQL 片段不能再被追加列**。
7. **验收数字**：`tests/releases.test.ts` 7/7（走真实 `publishArticle` 路径，所以 `deriveReleases` 真的被调到；含「第二条公告只补空」「下架后三处出口一起消失」）；`tests/architecture.test.ts` 8/8；`npm run typecheck` 全绿；`npm run build -w @girlsbands/web` + `node --test apps/web/tests/*.test.ts` 29/29；全量 `npm test` **662/662 通过（67.6s）**（W10 基线 654）。

8. **存量重抽（2026-10-05）**：`scripts/reanalyze-releases.ts`（`--pace MS` 控制入队间隔，避开模型商 120 次/分钟的上限 —— 一次入队 68 条时有一半吃了 429 回退）跑完 68 条候选：**59 条**留下 `output.release`，`releases` **55 行**（bluray 19 / merch 16 / digital 14 / single 3 / other 3，其中 21 行有发售日、55 行有公布日）、`release_editions` **21 行**（10 张碟 ≥2 个版本）、`release_bonuses` **15 行**、`release_serials` **3 行**。**1 条**（`oujg5cpvykp4u5fz4av4u93vv`）模型连续两次给出无法使用的输出，交回 sweep 重试；dev 库里序列号还指不到 `live_events`（公告写的演出名与 W8 的实体名对不上），这条链路由 `tests/releases.test.ts` 用例 ④ 覆盖。

**工作量**：实际约 1 天（迁移与阶段 A 半天、阶段 B 与页面半天），不含模型重跑；存量重抽 68 条只花 `release` 这一步的钱（`processing_attempt_tag` 会沿用上次评估的标签，前面的步骤全部命中回执）。

---

### W12 · 无账号关注（P1）

**为什么**：站主已定「不做账号、注册、登录」（§四）。但「我关注这几支乐队，只提醒 Live 与票务」**不需要账号** —— 浏览器本地关注 + 一个随机 token 绑邮箱就够。后端几乎现成，缺的是那一跳。

**现状（已核）**
- `apps/web/app/lib/local-state.ts`（465 行）是唯一浏览器存储层：`KEYS`、`readJson/writeRaw/storedKeys`、`STARRED_LIMIT=500`、`READ_LIMIT=5000`、`getStarred/toggleStar/removeStar`、`exportBundle/importBundle`、`useStarred()`。但 `/starred` 是**条目级**收藏，**不能直接扩成主体关注**。
- `packages/backend/src/subscriptions/store.ts` 已有完整 token 体系：`byToken(value)`、`subscribe(input)`、`confirm(value)`、`updatePreferences(value, input)`、`unsubscribe(value)`；`content.ts:43-44` 的 `manageUrl(token)` → `/subscribe/manage?token=…`；偏好目前只有 `bands[]` + `wantsDeadlines` + `wantsDigest`。
- `apps/web/app/features/subscribe/ui.tsx` 的 `BandPicker` 已能做主体选择 —— `/subscribe` 只差「读 localStorage 预填」这一跳。
- **「只看我关注的」不需要新数据**：`ItemSummary.subjects` 由 `packages/backend/src/publication/items.ts:131` 的 `toItemSummary` 用 `entityIds(row.tags)` 产出，每张卡片都有；过滤接进 `apps/web/app/lib/seo.ts:48/59` 与 `packages/contracts/src/site.ts:114` 的 `TimelineFilters` URL 参数即可。
- 提醒类别可以复用现成的 `CategoryKey`（`industry/taxonomy.ts:15` 的 `live/ticket/release/merch/media/member`），`DeadlineView` 已经同时带 `kind` 与 `category`。

**设计（2026-10-05 与站主逐条敲定）**
1. **本地关注**：`local-state.ts` 的 `KEYS` 加 `girlsbands-follows`（主体 id 数组，上限 `FOLLOW_LIMIT = SUBJECT_LIMIT`，因为这份列表要塞进一个地址）；**只有 22 个乐队/企划页有「关注」按钮**（`subjectOfId(topic.slug)` 非空即渲染，9 个方向页没有）；关注企划 = 关注整个系列（与企划页的收录范围同一套 `entityTags` 展开）。
2. **只看关注由服务器筛**（**改了原计划**）：原计划写的是 `?follows=1` 纯 URL 参数 + 浏览器本地过滤，**不成立** —— 时间线（游标 `tl2`）与池（固定页）都是服务端分页，本地过滤会让每一页只剩零星几条，每页条数还忽多忽少。改成把关注 id 当 `?subjects=a,b` 传给 `/api/site/timeline` 与 `/api/site/pool`；白名单与解析收在 `packages/contracts/src/taxonomy.ts` 的 `parseSubjectIds`（`Object.hasOwn(ENTITIES, …)` —— 用 `in` 的话 `?subjects=constructor` 会被原型链放行），`apps/web/app/lib/seo.ts` 的 `filterParams` 把列表排序后拼串，所以「勾选顺序不同」共用同一个地址、同一份后端缓存。
3. **一键转邮件**：`/subscribe` 读本地关注预填 `BandPicker`（只预填一次，之后读者改的不会被本地回填覆盖），提交走现有 `subscribe` 流程，**单向**：不回写本地关注。**不新造 token**：读者端自生成 token 会让 `subscribers.token` 变成可猜面，而它同时是 `List-Unsubscribe` 凭据；短链做成 `/subscriptions/:token` 别名（`content.ts` 的 `manageUrl` 改印短链，早先发出去的长链接继续可用）。
4. **不做按类别过滤邮件**（**站主拍板删掉**）：原计划的 `0063_subscriber_kinds.sql` 与 `subscribers.kinds` 列**全部不做** ⇒ **W12 不需要任何迁移**，0063 这个号让给 W13。关注只在两处起作用：列表页的「只看关注」、邮件订阅页的预填；截止雷达与日历不接。
5. **隐私**：带 `subjects=` 的列表 URL 一律 `noindex`（照 `apps/web/app/routes/all.tsx:47` 的写法），`/all` 的忙页重试也把这个参数带上。

**验收标准**

| 检查 | 通过标准 |
|---|---|
| 本地关注 | 关注 / 取关在刷新后仍在；`exportBundle` 能带出关注列表，导入时读者自己的顺序在前 |
| 只看关注 | `?subjects=a,b` 的列表只剩这些主体的内容（并集）；企划 = 整个系列；勾选顺序不同是同一个地址；换一份关注列表后旧游标失效 |
| 一键转邮件 | 从 `/subscribe` 提交后，邮件里的偏好与本地关注一致；`wantsDeadlines` / `wantsDigest` 老行为不变 |
| 隐私 | `?subjects=…` 的页面 `<meta name="robots" content="noindex">` |
| 测试 | `tests/subject-filter.test.ts`（白名单、系列展开、时间线/池过滤、游标绑定、API 取参）；`tests/subscriptions.test.ts` 改断言短链；`apps/web/tests/local-state.test.ts` 加关注用例 |

**实现与验证（2026-10-05 完成）**
1. **契约**（`packages/contracts/src/taxonomy.ts`）：`FOLLOWABLE_ENTITY_IDS`（`Object.keys(ENTITIES)`）、`isFollowableEntity(value)`（`Object.hasOwn` —— 用 `in` 的话 `?subjects=constructor` 会被原型链放行）、`SUBJECT_LIMIT = 30`、`parseSubjectIds(value)`（按逗号切、trim、白名单、去重、封顶 30 个）；`packages/contracts/src/site.ts` 的 `TimelineFilters` 加必填 `subjects: string[]`（空数组 = 不过滤）。网页与 API 共用这一套解析，不在两处各写一份。
2. **读取层**：`publication/items.ts` 加 `subjectCondition(subjects)`（每个 id 过 `entityTags` 展开成 `entity:*` 标签，`p.tags && ARRAY` 取并集；空数组返回空片段）与 `subjectKey(subjects)`（排序去重，供缓存键与游标用）；接进 `timeline.ts`（`filterSql` 末尾 + `binding` 带 `s: subjectKey(q.subjects)` ⇒ 换一份关注列表后旧游标报 `cursor does not match this query`）、`pool.ts`（`listedCount`、`loadPool` 的过滤与 `poolTotal` 的缓存键）、`groups.ts`。`apps/api/src/routes/site.ts` 的 `parseFilters` 解析 `subjects`，热榜的 `unfiltered` 也要求 `!filters.subjects.length`（热榜是全站的，不跟着切）。
3. **网页**：`apps/web/app/lib/seo.ts` 的 `readFilters` / `filterParams`（列表排序后拼串 ⇒ 勾选顺序不同共用同一个地址、同一份后端缓存）；`features/feed/Filters.tsx` 的「只看关注」开关（桌面按钮 + 手机筛选面板 + 可清除 chip；一次都没关注过时给去 `/#bands` 的引导，首页乐队区块因此加了 `id="bands"`）；`home.tsx` / `all.tsx` 传参与 `noindex`（`all.tsx` 忙页的 `SEARCH_PARAMS` 也带 `subjects`）；新建 `features/feed/FollowButton.tsx`（`IconHeart`）挂在 `topic.tsx` 的头部，`subjectOfId(topic.slug)` 非空才渲染 ⇒ 正好是那 22 个乐队/企划页；`/starred` 顶部一排关注标签（可进主体页、可一键取关），导入报告带上关注计数；`/subscribe` 用 `useFollows()` **只预填一次**（读者清空后不会被本地回填）。
4. **短链**：`apps/web/app/lib/subscribe-link.ts` 的 `managePath(token, action)` 只认 16–64 位 base64url 形状的 token、只转发 `action=unsubscribe`（其它值一律丢掉，不原样透传）；`routes/subscriptions.tsx` 302 到 `/subscribe/manage?token=…`，形状不对就是 404；`packages/backend/src/subscriptions/content.ts` 的 `manageUrl` 改印短链，早先发出去的长链接继续可用。
5. **无迁移**：按站主拍板砍掉 `0063_subscriber_kinds.sql`（0063 让给 W13）。
6. **踩到的坑**：契约里加必填字段后，**网页测试里手写的 API 桩也要跟着改** —— `apps/web/tests/cache.test.ts:26` 的合成 `/api/site/timeline` 少了 `subjects`，`/` 直接 500（两条用例挂掉）；`apps/web/server.ts` 起的是 `build/server/index.js`，端到端实拍前必须先 `npm run build -w @girlsbands/web`。
7. **验收数字**：见 §六「W12（2026-10-05 完成）：无账号关注」。

**工作量**：实际约 1 天（契约与读取层半天、网页与短链半天，含测试与文档），无模型成本。

---

### W13 · 成员实体页（P1）

**为什么**：162 条成员现在只为「翻译正确性」服务（一个中文通用名、一个日文原名、一个罗马字别名），**没有 id、没有乐队归属、不分角色与配音/真人演奏者** —— 这是站里唯一一份已经人工整理过、却完全没被用起来的数据库。而 BanG Dream! 恰恰是「角色 / CV / 乐手 / 乐队」多对多的企划，读者问「这个角色的声优还配了谁」「这个人还在哪支乐队」今天是回答不了的。

**现状（已核）**
- `industry/glossary-members.ts:10` 的 `export const MEMBERS: readonly GlossaryEntry[]`，实测 **162** 条，每条形如 `{ kind: "member", forms: ["井芹仁菜", "いせりにな", "Nina Iseri"] }` —— 只有写法，没有归属。
- `industry/glossary.ts:102` 汇总 `GLOSSARY = [...entityEntries, ...WORKS, ...MEMBERS, ...VENUES, ...PLATFORMS]`，`:119` 的 `GLOSSARY_VERSION` 进了 `packages/backend/src/editorial/translate.ts` 的 `TRANSLATE_PROMPT_VERSION` ⇒ **改一个写法就让全部旧回执与已入库译文失效**。
- 全库 grep：**没有任何地方 import `MEMBERS`**，只有 `glossary.ts` 自己汇总。
- 现成的关联键只有 `publications.tags`；`ENTITY_TAGS`（`industry/taxonomy.ts:84-91`）里**没有成员标签**；`facts.subject` 里成员名是自由文本（例：`理名（トゲナシトゲアリ Vo）`）。
- `apps/web/app/features/feed/bands.ts` 的 `Subject` 只认 `ENTITIES`。

**设计**
1. **新真源 `industry/members.ts`**（实际落地）：`export const MEMBER_ENTITIES: readonly MemberEntity[]` + `memberById(id)`，每条 `{ id, band, forms, aliases, actor: { forms, role? }, role? }`；`band` 是 `ENTITIES` 的乐队 id，`aliases` 是并进这一页的别名（Ave Mujica 五个舞台代号、Hello, Happy World! 的米歇尔）⇒ 词表的 182 行 = 94 条角色行 + 88 条声优行，其中 6 条角色行是别名（不另开页）⇒ **88 个角色页**；声优不单独开页，只在角色页里出现。**不建关系表**（关系全是静态人工数据，跟代码一起发布）；由 `.data/build-glossary-tables.ts` 生成（`.data/` 不进仓库，生成物进仓库，与 `industry/glossary-members.ts` 同一套规矩）。
2. **不进 `ENTITIES`**：`ENTITIES` 与 `assets/band-logos/manifest.json` 有一一对应校验（`tests/email-hero.test.ts:151-155`）、`scripts/fetch-band-logos.ts` 会照着 `ENTITIES` 去抓字标（164 个不存在的字标会全红）、`industry/topics.json` 的主题 slug 与 `tests/topics.test.ts:253-271` 的校验也挂在 `ENTITIES` 上。**也不进 `glossary.ts` 的 `GlossaryEntry`**（那是 `{kind, forms}` 翻译白名单，塞 id 会污染语义）。
3. **数据库只建投影表**（实际编号 `0063_member_mentions.sql` —— W12 砍掉了自己的迁移，这个号让给了 W13）：`member_mentions(member_id, article_id REFERENCES articles ON DELETE CASCADE, PRIMARY KEY (member_id, article_id))` + `member_mentions_article_idx(article_id)` —— **不建成员表**，成员跟代码发布；这张表只是「哪篇文章提到了谁」的倒排索引，删了能重建（`scripts/backfill-member-mentions.ts`）。**砍掉了原设计的 `source CHECK (title|body|x_post)` 列**：没有一处读它，而 `tests/architecture.test.ts:108-117` 要求每一列都被生产代码引用。写入在 `packages/backend/src/publication/publish.ts` 的 pool_search 块之后、内容组推送之前，与 publications upsert **同一事务**（`packages/backend/src/publication/member-mentions.ts` 的 `deriveMemberMentions`：eligible 才留、整篇重写而不是累加）。匹配 `title` / `original_title` / `summary` 与 `body_mode='full'` 时的正文（与 `pool_search` 同一条规则），写法取本名 + 假名 + 罗马字 + 别名 + **声优名**（站主拍板：只提声优艺名也算这个角色的报道）。**一处偏离词表**：多词的拉丁写法（`Nina Iseri`）不能直接用 `contains` —— `fold` 会抹掉空白，`"Nina Iseri announces"` 折成 `ninaiseriannounces` 之后贴边界的规则反而不命中；这些写法改成按词序匹配的正则（词之间允许空白），单字与含汉字的写法仍走 `contains`（所以 `Rina` 不会命中 `Marina`）。**不走 `publications.tags`**：成员进 `ENTITY_TAGS` 会改 `packages/backend/src/editorial/vocabulary.ts:7` 的 `ALLOWED_TAGS`，进而换掉 `promptVersion("structure")`＝全库回执失效。
4. **读取** `packages/backend/src/publication/members.ts`：`listMembers(now?)`（按企划 → 乐队铺开，`/members` 用）、`loadMemberPage(id, page, now?)`（角色页；未知 id、页码不是正整数、页码越界都返回 null ⇒ 404）、`memberLinks(subject)`（乐队页/企划页侧栏；企划给整个系列，方向页与未知主体给空）、`bandsWithMembers(subject)`、`memberSitemapEntries(now?)`；索引缓存 `cached(..., { freshMs: 60_000, maxStaleMs: 10 * 60_000 })`（与主题页同一套）。「出演 / Live / 采访 / 发售」是同一批报道按 `publications.category` 切段，**不另建表**。索引门槛 `total >= 5`（**不复用** `packages/backend/src/publication/topics.ts` 的 `isIndexable`：`total >= 50 || (total >= 20 && recent > 0)` 是为新闻主题定的，对成员太严）；不够 5 篇的页面**仍然可达**，只是 `noindex` 且不进 sitemap。
5. **出口**（实际落地）：`apps/web/app/routes/members.tsx`（`/members` 总览）+ `apps/web/app/routes/member.tsx`（`/member/:id`，站主拍板要总览页）+ `/api/site/members`、`/api/site/members/:id` + `apps/api/src/routes/og.ts` 的 `/og/members/:file` + `packages/backend/src/publication/sitemap.ts`（`/members` 与 indexable 的 `/member/`）+ 乐队页与企划页侧栏的「角色」栏（`apps/web/app/features/topic/member.ts`，22 个实体页）。API/OG 都已在 `packages/contracts/src/http-policy.ts:97`/`:106` 覆盖的模式里，**不用登记 `API_OWNED_PATTERNS`**。`apps/web/app/features/feed/bands.ts` **不改**（成员不是抓取主体），页面的主体/方向渲染直接复用主题页组件。**v1 不接关注与邮件订阅**（站主拍板：成员不进 `subjects`、不进订阅勾选）；文章里的角色名也**不会**变成链接（动 `ALLOWED_TAGS` 会让全库回执与译文失效）。
6. **`GLOSSARY_VERSION` 的代价（本包最关键的一条）**：生成器从 `industry/glossary-members.ts` 生成 `industry/members.ts` 时，每条 `forms` 的**顺序与内容逐字节保持**（顺序变了 `GLOSSARY.length` 不变但 `fnv(...)` 变，版本照样变），所以「把成员名接上归属」这件事本身**不重译一个字**。但站主拍板要先补齐 Canna Lily / F-272 两支手游乐队（10 角色 + 10 声优）⇒ 词表**只增不减**，`GLOSSARY_VERSION` 变化是预期行为，随后所有翻译回执按新版本重跑（回执键含 `promptVersion`）。生成器是 `.data/build-glossary-tables.ts`（`.data/` 不进仓库），不是原计划的 `scripts/build-members.ts`。

**验收标准**

| 检查 | 通过标准 |
|---|---|
| 词表只增不减 | 既有 162 条写法的 `forms` 逐字节没动；新增的 20 条（Canna Lily / F-272）只增不减，`GLOSSARY_VERSION` 变化后翻译回执按新版本重跑（`tests/glossary.test.ts:96` 断言的是形状） |
| `ENTITIES` 没被动 | `tests/email-hero.test.ts` / `tests/topics.test.ts` / `fetch-band-logos` 全绿且抓取数仍是 22 |
| 归属关系真实 | `MEMBER_ENTITIES` 每条都能经 `band` 走回 `ENTITIES`，角色 ↔ 声优（`actor.forms`）一一对应；`tests/members.test.ts` 双向核对角色行与声优行 |
| 投影表被用 | `tests/architecture.test.ts` 全绿（每列都被生产代码引用）；同一文章重复 publish 不产生重复行 |
| 页面 | 一个成员页 200、404 规则（未 indexable 仍可达但不进 sitemap）、下架文章从列表消失 |
| 出口 | `npm run typecheck` 全绿；`/og/members/<id>.png` 200；sitemap 有 `/member/` |
| 测试 | 新增 `tests/members.test.ts` 全绿 + 全量 `npm test` 0 失败 |

**站主拍板（2026-10-05 grilling 逐条敲定）**
1. **只做角色页**：声优不单独开页，只在角色页里出现（不建 162 个页面）。
2. **提及口径**：文章只提声优艺名也算这个角色的报道（合并进角色页）。
3. **索引门槛 `total >= 5`**：不够 5 篇的页面仍然可达，只是 `noindex` 且不进 sitemap。
4. **别名并入本名页**：Ave Mujica 五个舞台代号 + 米歇尔 ⇒ 84 → 78 页；**先补齐 Canna Lily / F-272**（站主发现这两支手游乐队在 TSV 里一条成员行都没有）⇒ **88 页**。
5. **不列「这位声优还配了谁」**（一个角色一位声优，站主原话）。
6. **v1 不接关注与邮件订阅**：关注仍只按 22 个主体，成员不进 `subjects`、不进订阅勾选。
7. **要 `/members` 总览页**（按乐队分组的角色目录）。
8. 零重译：`forms` 逐字节照抄词表，另加一条测试防两份数据漂移。

**实现与验证（2026-10-05 完成）**
1. **真源** `industry/members.ts`（88 条，`MEMBER_ENTITIES` + `memberById`）：由 `.data/build-glossary-tables.ts` 从 `.data/glossary-members.tsv` 生成，`forms` 与 `industry/glossary-members.ts` 逐条相同（`tests/members.test.ts` 双向核对）；成员**不进** `ENTITIES`、**不进** `glossary.ts` 的条目。补齐的两支手游乐队按官方公布（Gamer / 4gamer / Real Sound / Skream!）写：Canna Lily 5 人、F-272 5 人，没有官方罗马字的按读音拼 slug。
2. **迁移与写入** `database/migrations/0063_member_mentions.sql`（只有 `(member_id, article_id)` 两列 + article 索引，砍掉原设计的 `source` 列）；`packages/backend/src/publication/member-mentions.ts` 的 `mentionedMembers` / `deriveMemberMentions` 在 `publish.ts` 的 pool_search 之后、同一事务里整篇重写；`scripts/backfill-member-mentions.ts` 用 publications 已定稿的列回填存量（可重复跑）。
3. **读取层** `packages/backend/src/publication/members.ts`：`listMembers` / `loadMemberPage` / `memberLinks` / `bandsWithMembers` / `memberSitemapEntries`，索引缓存 60s。
4. **出口** `/api/site/members`、`/api/site/members/:id`（ETag 前缀 `members` / `member`）、`/og/members/:file`（kicker「角色 · 乐队」、副标题「担当 · CV · 别名」）、sitemap 的 `/members` 与 indexable 的 `/member/<id>`。
5. **踩到的坑**：① `contains` 的空白归一让多词拉丁写法贴不上边界（`Nina Iseri announces` 折成 `ninaiseriannounces`）⇒ 多词拉丁写法改成按词序匹配的正则，单字与含汉字写法仍走 `contains`；② 声优名一开始漏在匹配表外（站主口径要求「只提声优也算」），补 `actor.forms`；③ 正文只在 `body_mode='full'` 时参与匹配（与 pool_search 同一条规则），测试文章的正文点了名不算；④ `originalTitle` 就是 `articles.title`，改「标题不再点名」必须同时改 `articles.title` 与 `analyses.title_zh`；⑤ sitemap 断言别写死协议（`SITE_URL` 在测试里不是 https）。
6. **验收数字**：`tests/members.test.ts` **6 通过 / 0 失败**；全量 `npm test` **686 通过 / 0 失败**（93.2s；W12 基线 680）；`npm run typecheck` 全绿；dev 库跑完 0063 + 回填：**149 行提及、84 篇报道、35 个角色**，其中够 5 篇的是 8 个（Canna Lily / F-272 的 10 位在现有语料里 0 篇提及，页面可达但暂不进 sitemap）。
7. **担当 85/88（2026-10-05 补齐一次）**：`role` 有没有照旧只认官方明文；16 支乐队的官网逐条查过一遍，来源写在 `.data/glossary-members.tsv` 备注列的 `位置来源` 里（`.data/` 不进仓库）。只剩ダイヤモンドダスト的奈奈 / 凛 / 爱 —— 官方角色页只列年龄、没有乐器图标（同页的トゲナシトゲアリ 五人就有），非官方来源（萌娘百科）不采用。补齐只改 `industry/members.ts`，不动词表与 `GLOSSARY_VERSION`；页面在没有 `role` 时照常显示，只是不写担当。

**工作量**：4 天（真源重构 1 + 投影表与写入 1 + 读取与页面 1.5 + 出口与测试 0.5）。

---

### W14 · 情报变更 Diff（P1）

**为什么**：官方会陆续改 OPEN 时间、追加注意事项、公布当日券。现在这些只体现为时间线上的新条目，读者看不出「**相比上一版变了什么**」。延期 / 中止 / 场馆变化 / 开演时间变化 / 票价变化 / 出演者变化必须显眼地标成 ⚠️。

**现状（已核）**
- `packages/backend/src/events/digest.ts:93` 是「无变化就返回」的门：`if (story.digest !== null && sameReports && last!.inputs_hash === inputsHash) return { updated: false };`；`:103` 是「`inputs_hash` 相同就复用上一版 digest、不调模型」的分支。
- `story_digests` **已有版本历史**（`(story_id, version, digest, latest, receipt_id, article_ids[], inputs_hash, created_at)`）。
- `packages/backend/src/events/corrections.ts:1-4` 的「更正」是**分组更正**（把文章移到别的 fact、合并 story），语义不同，不要复用。
- `facts` **只新建不更新**：`packages/backend/src/events/group.ts:111-119` 的 `createFact` 只 `INSERT`，全仓唯一的 `UPDATE facts` 是 `packages/backend/src/events/merge.ts:17` 的 `SET story_id`。⇒ **快照必须取 `analyses.output->'fact'`**（分析当时的说法），取 `facts.subject/action/object` 的话 diff 永远是空。

**设计**
1. 迁移 `0064_story_digest_facts.sql`：`story_digests` 加 `facts jsonb`、`facts_hash text`、`changes jsonb`、`change_kinds text[]`。
2. `packages/backend/src/events/change-diff.ts`：`factsSnapshot(storyId)` 取该 story 各 article **最新一条** `analyses.output->'fact'`（注意 dev 库里 CPP 的 article 有两条 `analyses`，必须走 `publications.analysis_id` 或取 max）→ 规范化 JSON → `facts_hash`。
3. **接入点**：把 `facts_hash` 加进 `digest.ts:93` 的门，但**不改 `inputs_hash` 的定义** —— 于是纯日期变化（OPEN 17:00→16:30）只插一行版本、**零模型调用**，也不会让全库 story 重写 digest。
4. `changes` 生成：结构化字段级 diff（时间 / 会场 / 出演者 / 票价 / 票务轮次）优先；只有「结构化 diff 非空且需要中文措辞」时才调一次模型（新提示词 `industry/prompts/story-changes.md`，新文件不使旧回执失效）。
5. 界面：`apps/web/app/routes/story.tsx` 顶部「⚠️ 变更」块，形如「+ 新增当日券销售 / OPEN 17:00 → 16:30 / − 取消原场贩开始时间」；`change_kinds` 含 `cancelled` / `postponed` / `venue` / `time` / `price` / `cast` 时用醒目样式。

**验收标准**

| 检查 | 通过标准 |
|---|---|
| 零成本路径 | 只改日期的 story：`story_digests` 多一版、`receipt_id` 不变、模型调用数为 0 |
| 快照来源 | 手工改 `facts.subject` 不影响 diff（证明取的是 `analyses.output`） |
| 内容 | 延期 / 中止 / 会场变更 / OPEN 变化各造一条 fixture，`change_kinds` 正确、页面显示 ⚠️ |
| 兼容 | `inputs_hash` 定义未变 → 现有 `tests/events*.test.ts` 全绿 |
| 测试 | `tests/change-diff.test.ts` |

**站主拍板（2026-10-05，开工前）**
1. **变更只出现在两处**：事件页 `/story/:id` 首屏 + 时间线卡片的小 ⚠️ 角标；Live 页、邮件日报、热点榜都不做。
2. **检测范围**：结构化字段（开演日与时刻、会场、状态、票价、出演者、票务轮次）**＋ 自由文本（注意事项 / 条件）也参与**，自由文本的变化用模型措辞（有新变更才花一次调用）。
3. **只有四类标醒目 ⚠️**：取消、延期、会场变更、开演时间变更；票价 / 出演者 / 轮次照列不标红。
4. **事件页只显示「上一版 → 当前」这一次变化**，旧版本留在 `story_digests` 不展示。
5. **时间线角标只在最近 7 天内有变更时显示**。
6. **被取消 / 中止的演出从首页截止卡、`/deadlines`、`.ics` 里去掉**；延期用新日期。

**我替站主定的小事（不同意就说）**：`StoryDetail.changes` 与时间线卡片 `change?: CardChange` 进 v1 契约，**不另做公开「更正日志」出口**，**不复用** `events/corrections.ts` 的分组更正语义；**不动 `facts` 那三列**（W14 不做上游修复，要改单独评估）；快照只取 `analyses.output->'fact'/'live'/'release'`；`inputs_hash` 定义一字不改（只改日期 ⇒ 多一版快照、`receipt_id` 不变、模型调用 0 次）；上一版没有快照（迁移前的存量行）视为「无变更」且不回填；模型措辞失败或模型关闭 ⇒ 模板降级，绝不让这一版写不下去。

**实现与验证（2026-10-05 完成）**
1. **迁移** `database/migrations/0064_story_digest_facts.sql`：`story_digests` 加 `facts jsonb`、`facts_hash text`、`changes jsonb`、`change_kinds text[]`，31 行注释讲清「为什么把快照存进版本行 / 为什么读 `analyses.output` 而不是 `facts` 三列 / 存量行 `facts_hash IS NULL` 怎么办 / 谁读它」。
2. **快照与 diff** `packages/backend/src/events/change-diff.ts`：`changeSnapshot(reports)` 每篇报道一条（`conditions[].text`、`deadlines[].kind/at`、`live.{status,venue,startsTime,endsOn,rounds}`、`release.{releaseOn,editions[].priceYen}`），`changeSnapshotHash` 是它的指纹；`diffChangeSnapshots(previous, next)` 每项取「最新一篇说出它的报道」当当前值（新报道没提就沿用上一篇说过的，不算变化），类别 `cancelled | postponed | venue | time | rounds | release | text`，只有前四类进 `change_kinds`。**抽取结果里没有 cast（出演者）字段** ⇒ 出演者变化只能走自由文本那条路（文档里说明，不假装能做结构化比较）。
3. **措辞**：新提示词 `industry/prompts/story-changes.md`（新文件、不动 `structure.md`、不使旧回执失效）+ `wordTextChanges()`，`purpose: "story_changes"`、模型复用 `digest` 能力；**只在「结构化字段一处没变、又有结构化锚点」时调用** ⇒ 只改日期的那一版 0 次调用；模型挂了或 `MODEL_CALLS_ENABLED=false` ⇒ 降级成 `新增注意：…` / `取消注意：…`。
4. **接入** `packages/backend/src/events/digest.ts`：门加 `facts_hash`（`inputs_hash` 定义一字未改 ⇒ 现有 `tests/events*.test.ts` 语义不变），事务里的竞态重查同时比 `digestInputsHash` 与 `changeSnapshotHash`，INSERT 带上四列。
5. **读取与页面**：`publication/story-text.ts`（`StoryChanges` 逐条校验 kind，认不出的丢掉）、`publication/stories.ts` 的 `StoryDetail.changes`、`publication/timeline.ts` 的 7 天角标（`CardChange { kinds, at, storyPublicId }`，fact 经 `facts.story_id` 找 story）、`apps/web/app/routes/story.tsx` 的「情报变更」块（醒目四类走 amber，每条带「来自哪篇报道」链 + 一行「上次更新 X 前」）、`FeedItem.tsx` 的角标（**要 `relative z-10`** 才盖得住整张卡片的 `after:absolute after:inset-0` 标题链接）。
6. **截止雷达与 `.ics`**：`publication/deadlines.ts` 的 `changeWindow(now)` CTE（`changed` / `retired` / `restated` / `newest`）+ `notRetired()` / `latestOnly()` 接进 `deadlineWindow` 与 `deadlineMonths` 的全部四个分支；`.ics` 走 `calendarIcs → deadlineRange`，雷达改完它自动跟着改。

**工作量**：2.5 天（含一次小范围模型调用）。

---

### W15 · 远征参考页（P2）

**为什么**：远征（跨城 / 跨国去看一场 Live）是这门兴趣里最贵、也最没处查的一件事 —— 票在哪个轮次卖、当落与入金怎么走、当天几点到、现场什么能做什么不能做、行程怎么排。站上现在只有「情报」，没有「怎么做」。原设计是「135 个场馆实体页 + 远征信息」，场馆那一半今天撑不起来（见「现状」）；中间一度打算由站上自己写五篇专题攻略（站主 2026-10-05 先点头，随后改口：「算了不写这个了吧，看看在哪里引用那个知识库就行了」），**最终拍板：不写正文，只做指路页**。理由：远征知识与通用赴日事项都变得慢，社区里已经有人写得更全，自己重写只会多一份过期更快的副本；站上的强项是场次与截止。场馆实体页与那五篇正文一起记进待办（§七）。

**现状（已核）**
- 场馆那一半撑不起来：`industry/glossary-venues.ts:21` 的 `VENUES` 135 条只有 `{ kind: "venue", forms }`（没有地址 / 容量 / 最近车站）；`industry/taxonomy.ts:84-91` 的场馆子集只有 **7** 个，dev 库 `publications` 命中它们只有 **3 行**，`live_events` 只有 **3 行**（其中 2 行 `venue` 为空）⇒ 场馆页今天只是个空壳；`packages/backend/src/publication/calendar.ts:37-41` 的 `calendarSubject(slug)` 要求场馆是主题 ⇒ 场馆日历也拿不到。
- 外链的两份资料都是公开可读、不要求登录的：飞书公开社区版《现代远征攻略》（`https://www.feishu.cn/community/article/wiki?id=7382098129484513283`，通用赴日事项写得比站上全）与 SeatView `https://seat.genchi.top/`（众包座位实拍，CC BY-NC 4.0）。站内不用重写它们。
- 入口的现状：首页没有页脚（`<footer>` 只在 `/about`），手机「我的」是 `/more`，桌面侧栏「更多」组在 `apps/web/app/components/shell/nav.ts`。

**设计**
1. **新真源 `industry/guides.ts`**：`GuideResource { id, title, summary, source, href }` + `GUIDE_RESOURCES`（两份：飞书知识库 / SeatView）+ `GUIDE_PATH = "/guide"`。**这是唯一的清单**：页面卡片与 sitemap 都读它 —— 链接挂了删一行，页面结构不用动。
2. **页面 `apps/web/app/routes/guide.tsx`**：一段说明（为什么不自己写）+「外部资料」两张卡片（新窗口 + `rel="noopener noreferrer"`，写清作者与许可）+「本站能帮上的」三个入口（截止雷达 / Live 与活动 / 日历订阅，`.ics` 用原生 `<a>`）。**没有正文、没有第二份文案**：这一页只说「去哪里看」，不转述别人的内容。
3. **不联动站内数据**（站主拍板）：不建表、不加 API、不查库（SSR 直出）⇒ **W15 无迁移**。
4. **收录**：sitemap 加 `/guide` 一行；OG 走 `apps/api/src/routes/og.ts` 的 `PAGES.guide`（就一张卡）；入口放 `/more` 工具组与桌面侧栏「更多」组，**不加底栏 tab**。

**验收标准**

| 检查 | 通过标准 |
|---|---|
| 清单 | 两份资料的 id / 标题 / 地址都不重复；`summary` 一句话说清用途；`href` 是 https 完整域名；`tests/guides.test.ts` 全绿 |
| 页面 | `/guide` 200；两处外链带 `target="_blank" rel="noopener noreferrer"`，站内三个入口不新开标签；没有正文（这一页不转述别人的内容） |
| 收录 | sitemap 有 `/guide` 且**没有** `/guide/<slug>` 残留；`/og/pages/guide.png` 200、旧篇目卡片（`guide-tickets.png` 之类）404 |
| 入口 | `/more` 与桌面侧栏「更多」都有「远征攻略」 |
| 出口 | `npm run typecheck` 六段全绿；全量 `npm test` 0 失败；`npm run build -w @girlsbands/web` 通过 |

**记账**：曾按「自己写五篇专题」实现并整套验收过（`/guide/<slug>` + 五篇 md + 每篇一张 OG 卡），站主改口后**整套删除**，只留指路页；五篇草稿没进仓库。
**场馆实体页（原设计）暂缓**：四条待拍板问题（索引门槛 / 地区聚合页 / 三条未核实规范化名 / 闭馆场馆）随它一起记在 §七。
**工作量**：0.5 天（页面 + 入口 + 导出）。

---

### W16 · Setlist 与事后档案（P2）

**为什么**：现在重心全在「发生前 / 发生中」。Live 结束之后还有 Setlist、现场 repo、官方照片、Archive 截止、BD、Live Album —— 收进来，站会自然长成少女乐队历史数据库，而且**不需要复活已经砍掉的编年史产品**。

**做了什么（2026-10-05 完成）**
1. 散场之后的一层只收三样：这场演出的**报道清单**（W8 已有）、**配信 / Archive 截止**（走已有 `stream_end` 截止口径，`DEADLINE_KINDS` 里本来就有）、**曲目单**（有才显示）。现场 repo 与官方照片**不抓图、不聚合**，只给一行外链出口。
2. 主场是 Live 页 `apps/web/app/routes/live.tsx` 的 `finished` 阶段（W8 的 `stageOf` 早已派生 `finished`）；Event 页 `apps/web/app/routes/story.tsx` 只在演出已结束时加一行指过去。`packages/backend/src/publication/chronicles.ts` 一行不碰。
3. 新迁移 `0065_setlist_entries.sql`：`setlist_entries(id, live_event_id FK ON DELETE CASCADE, source CHECK IN ('article','reader'), position, title, is_encore, is_cover, quote, article_id FK ON DELETE SET NULL, created_at)` + 唯一键 `(live_event_id, source, position)`；另加 `live_events.setlist_scanned_at`（页面据此区分「还没找过」与「找过，原文里没有」）。
4. 抽取：新提示词 `industry/prompts/setlist.md`（新文件 ⇒ 旧回执不失效）+ `packages/backend/src/editorial/setlist.ts`（`SETLIST_PROMPT_VERSION` / `extractSetlist` / `normalizeSetlist`）。`grounded` 闭包从 `analyze.ts` 的 `normalizeStructure` 里抽成共享的 `groundedFor(a)`：歌名必须在正文里逐字找到，核不到就丢。曲目单**不是** `analyzeArticle` 的一步 —— `PROMPT_VERSIONS` / `ANALYZE_PROMPT_VERSION` 没动。
5. 扫描：`packages/backend/src/lives/setlists.ts` 的 `sweepSetlists`，worker 每小时一次（`lives.setlist` 定时，`apps/worker/src/schedules.ts`）。只问已经结束的演出，一场读最新 3 篇报告，第一篇问出曲目就用它；问过就写 `setlist_scanned_at`，一篇都没有也写；模型调用被关掉时直接跳过（不报错）。**找过之后又有新报道进来的那一场会再看一眼** —— 散场当晚的报道常常还没写曲目单。
6. 众包：Live 页给一行 `/feedback?from=<演出页>`（走已有反馈通道与限流；`apps/web/app/routes/feedback.tsx` 认的查询参数是 `from`），后台在反馈卡片上点「采纳为曲目单」（`POST /api/admin/feedback/:id/setlist`）—— 一行一首，采纳的那份写成 `source='reader'`（先删后插，点两次不会写两份，动作进 `audit_log`）。歌名**不进** `industry/glossary`（进词表 ⇒ `GLOSSARY_VERSION` 变 ⇒ 全库翻译回执失效），曲名照原文、不中译。
7. 读路径：`loadLive` 多查一次 `setlist_entries`，`source='article'` 的行要能对上一份仍在架的公开报道才显示（`storyReportCondition`）—— 报道下架，它带来的曲目行跟着消失；`source='reader'` 的行不受影响。`LiveEventView` 加 `setlist` / `setlistScanned`。

**验收标准（实际）**

| 检查 | 结果 |
|---|---|
| 落地 | 抽取落库走 `setlist_entries`，歌名引用核不到正文就不落库（`groundedFor` 拦幻觉） |
| 阶段切换 | Live 结束后页面出现档案区块（报道清单 / 配信截止 / 曲目单）；Event 页一行入口 |
| 不复活编年史 | `publication/chronicles.ts` 未被引用为出口；cron 仍关闭 |
| 测试 | `tests/setlist.test.ts` **8 通过 / 0 失败**（含「引用不到就不落库」的反例） |
| 全量 | `npm run typecheck` 六段、`npm test` **704 通过 / 0 失败**、web **42 通过 / 0 失败**、`npm run build -w @girlsbands/web` 通过 |
| 端到端实拍 | 真 API + `apps/web/server.ts` + dev 库（已跑 `0065`）：有曲目单的演出页出现曲名 + 安可小标题 + 翻唱 / 读者补充标注 + 出处链接 + 众包入口；只有报道的演出页写「问过这场演出的报道了，原文里没有写曲目单」；未结束的演出没有这一块；事件页有「这场演出已经结束」；`/api/site/lives/<id>` 带出 `setlist` 与 `setlistScanned`；后台采纳路由未登录 401 |

**两个缺口（交给站主）**
- **今天库里 0 篇真曲目单**：9 场已结束的 Live 的正文里一篇都没有真曲目单（全库只有 4 篇提到「セットリスト」，都是「歌单已上架流媒体」的公告）。这一层今天是空的，靠读者补 + 以后的散场报道长出来。
- **香港 10-02 生成两条并行 `live_events`**（18 `girls-band-cry` / 19 `togenashi-togeari`，同日同场馆同名）：W8 的「一站一实体」按 `subject_entity` 分行，同一场演出于是有两个页面。要不要合并待站主拍板。

**站主已定（2026-10-05）**：曲目单**落库**（不从正文现算）；歌名**不进** `industry/glossary`；众包**复用 `/feedback`** + 后台点采纳（不建第二张投稿表）；粉丝现场 repo 与官方照片只给一行外链、不抓图不聚合。
**工作量**：1 天（先花一次模型钱把 9 篇已结束的 Live 归组，见 §六 的补数据记录）。

---

### W17 · 全文政策分层（风险项，**推翻站主旧决定**）

**为什么**：现行政策是「不管许可，全文站内、给所有人看」，W3 只做了工程补救（联系邮箱、`/rights`、单条与整源下架、原文链接）。补救**不消除**未经许可复制与翻译完整版权内容的暴露面。站一旦做大，「中文看全」本身会变成最大的风险面。这一包**推翻站主 2026-10 的旧决定**，动手前必须重新点头；下面的保守默认可以先落，不影响任何公开读数。

**建议的三层**

| 层 | 内容 | 展示 |
|---|---|---|
| 官方公告（一手） | 全文中文翻译 | 全文 |
| 第三方媒体 | 标题 + 中文摘要 + **少量必要引用** + 原文链接 | 摘要 |
| 明确许可 / CC | 全文 | 全文 |

**现状（已核）**
- 全文开关**唯一入口**是 `packages/backend/src/publication/rules.ts:48-50` 的 `bodyModeOf(source, bodyStatus, hasBody)`，只在 `packages/backend/src/publication/publish.ts:268` 调用一次落库 ⇒ 改这一个函数，下游 13 处读取点（items / detail / representative / stories / reports / translate / admin-review …）自动跟随。
- **翻译门控已经存在**：`packages/backend/src/editorial/translate.ts:169` 是 `if (row.visibility !== "public" || row.body_mode !== "full") return result({ status: "skipped", reason: "not a public full-text item" });`，`:251` 与 `:298` 的查询都带 `p.body_mode = 'full'` ⇒ **`translate.ts` 一行都不用改**。
- `publications.syndicate` 全为 false ⇒ **一篇全文都没进过 RSS，不需要清理**。
- 老数据回填必须走 `packages/backend/src/admin/sources.ts:151` 的 republish 出站链（迁移 `0056` 的教训：只 `UPDATE` 不 enqueue，老 `body_mode` 不会自己变）。
- 影响面（dev 库实测）：`full` 118 条（其中**非一手 112 条**）、`summary` 320 条 ⇒ 分层一旦生效，这 112 条会从 full 掉到 summary。

**设计**
1. **保守默认（可以先做）**：迁移 `0066_rights_tiers.sql` 只加 `sources.rights_tier`（`official | media | licensed`）与 `sources.rights_note`，**`site_fulltext` 与公开读数一字不改**；管理后台显示层级；`docs/rights.md` 与 `/rights` 页补一段说明。
2. **切换（等点头）**：`bodyModeOf` 改成读 `rights_tier`（`official` / `licensed` → 允许 full；`media` → 强制 summary），然后按 republish 出站链回填。
3. **引用方案**：默认 A —— 摘要里直接引用原文句子（零提示词改动）；方案 B 是改提示词让模型产出「必要引用」字段，代价是 prompt version 变更、已入库条目重跑（重跑必须换 `attemptTag`，否则命中回执不花钱也不重问，见 `packages/backend/src/providers/receipts.ts:83`）。

**验收标准**

| 检查 | 通过标准 |
|---|---|
| 保守默认 | 迁移后公开读数**逐字节不变**（`publications` 快照比对）；`npm test` 全绿 |
| 切换（点头后） | `media` 层条目 `body_mode='summary'`、正文不外泄；翻译任务自动跳过（`translate.ts:169` 现有门控）；RSS / v1 API 无全文 |
| 回填 | republish 出站链跑完后老条目也变了（不能只 `UPDATE`） |
| 页面 | `/rights` 与 `docs/rights.md` 的政策描述与实际行为一致 |

**待站主拍板**：是否切换（以及切到哪一层）；`T2_EVENT` 三个国内票务 / 展会源算哪层（归 media 会让 W6 验过的 15 条从 full 掉到 summary）；官方判据用 `owner_entity_id IS NOT NULL`（12 个 T1_5 官方 X 也算官方，含 5 个成员个人 X）还是 `tier = 'T1'`（`first_party` 只认 T1，见 `publish.ts:294`）。
> 这一包涉及法律判断，本文档只写工程事实与影响面，**不是法律意见**。
**工作量**：1 天（保守默认）+ 决策后的回填与验证。

---

### W18 · 用户纠错与情报投稿（P2）

**为什么**：站里已经有完整的匿名反馈通道（`/feedback` → `feedback` 表 → 飞书 → `/admin/feedback` 处理），但它现在是**自由文本**：读者想说的是「这条的日期错了」「这个场馆名不对」「这场 Live 我在别处也看到过」，而页面只给一个空白框。同时站主自己找新源靠手工（W6 那三个源就是手工试出来的），读者手里往往有现成的一手链接。这两件事都不需要账号，只是缺一个「结构化的入口 + 人工确认的出口」。

**现状（已核）**
- 公开入口已有：`apps/api/src/routes/feedback.ts` 的 `POST /api/site/feedback`（multipart，最多一张截图，`bodyLimit` 12MB）→ `packages/backend/src/operations/feedback.ts` 的 `submitFeedback`：正文 2–5000 字、可选邮箱、`pageUrl` 截 500 字、截图按**首字节**嗅探类型 + `sharp` 真解码 + 8MB 上限、存 `config.dataDir/feedback-screenshots`、`sourceFingerprint(ip, ua)`（HMAC，不可反查）→ `feedback_bans` 命中即 403 → `rateLimit(source)` → 落 `feedback(content, email, page_url, screenshot_key, source_hash, forward_error)` → `forwardFeedbackToFeishu`（`FEISHU_*` 默认关）。
- 后台处理已有：`packages/backend/src/admin/feedback.ts` 的 `listFeedback`（按状态/关键词、每页 50、含 `from_source` 与 `banned`）、`updateFeedback`（状态 `new/triaged/replied/resolved/spam` + 备注，`updated_at` 做 CAS）、`banSource`/`unbanSource`；页面 `apps/web/app/routes/admin/feedback.tsx`。
- 内容侧已有可复用的纠错动作：`packages/backend/src/admin/content.ts` 的 `setVisibility`（`:90`）、`setSeoIndexed`（`:115`）、`overrideFields`（`:141`，可改字段或清空，带 `version` CAS 与审计）、`rerun`（`:171`）；`packages/backend/src/events/corrections.ts` 是**分组更正**，与读者纠错不是一回事，不要复用。
- 投递侧已有：`apps/api/src/routes/ingest.ts` 的 `POST /api/ingest/items`（**只给外部脚本**，`INGEST_TOKEN` 常量时间比对 + 10 次/分钟），`packages/backend/src/ingest/items.ts` 的 `ingestItems` —— 公网读者**不能**走这条路。
- 缺口：`feedback` 表没有「针对哪一条内容/哪个字段」的列；没有 `/submit` 投稿页；后台没有按目标聚合的视图。

**设计**
1. **表只加列，不建表**（迁移 `0067_feedback_targets.sql`，编号按实际顺序；`feedback` 表本身在 `0003_monitor_leaderboard_notify.sql`/`0004_admin_ops.sql`，`0027_feedback_forward_error.sql` 加过 `forward_error`）：`ALTER TABLE feedback ADD COLUMN target_kind text, ADD COLUMN target_id text, ADD COLUMN target_field text, ADD COLUMN expected text;` 加 `CHECK (target_kind IS NULL OR target_kind IN ('article','story','topic','release','live','venue','source'))`、`CHECK (target_field IS NULL OR target_field IN ('title','date','venue','price','translation','category','duplicate','other'))`、索引 `(target_kind, target_id, created_at DESC)`；全部可空 ⇒ 老数据与自由文本反馈不受影响。
2. **读者侧入口**：条目页 / 故事页 / 主题页加「报告问题」小按钮，弹层里预填 `target_kind`/`target_id`（从 loader 已有数据取，**不新增公开接口**），读者选字段 + 写一句期望值；提交仍走**同一个** `POST /api/site/feedback`（表单多四个可选字段），于是限流、封禁、截图、飞书转发全部白拿。
3. **投稿入口 `/submit`**：同一张表、`target_kind = 'source'`、正文里放链接与说明。**硬约束：读者提交的 URL 绝不直接抓取发布**（投毒、SSRF、版权、以及 429 配额都会被一个陌生链接打满）。人工在 `/admin/feedback` 确认后二选一：①按 `AGENTS.md` 的手工流程加进 `industry/sources.json`（推荐，走既有 review）；②用 `scripts/` 里的一次性脚本调 `packages/backend/src/sources/collect.ts` 的 `collectSource` 试抓一次看质量（必须带 `attemptTag`，且 `COLLECT_ENABLED` 只在本机临时打开）。
4. **后台视图**：`/admin/feedback` 加一个「按目标聚合」标签页 —— 同一 `(target_kind, target_id)` 的纠错并排显示（含 `from_source` 计数，一眼看出是不是同一个人刷的），每行给「跳到该条目」按钮进 `/admin/content/:id`，用已有的 `overrideFields` / `setVisibility` 处理；处理完把状态改成 `resolved` 并写 `note`（**公开页不显示读者的邮箱**，隐私声明 §3 已覆盖）。
5. **公开更正出口不新建**：确属情报变更的（日期改了、开演时间改了）由 W14 的变更 Diff 出口自然呈现，读者纠错只是它的输入之一。**明确不做**：不做众包直接改库、不做投票/点赞、不做纠错排行榜、不给投稿人账号（回执只靠可选邮箱）。
6. **防滥用复用现成的**：`sourceFingerprint` + `feedback_bans` + `rateLimit`（`packages/backend/src/operations/abuse.ts`）一行不改；`/submit` 与 `/feedback` 共用同一配额，避免出现第二条免费通道。

**验收标准**

| 检查 | 通过标准 |
|---|---|
| 迁移安全 | `ALTER TABLE` 连跑两次不报错（`ADD COLUMN IF NOT EXISTS`）；老反馈行四个新列全 null |
| 入口复用 | 条目页「报告问题」提交后，`feedback` 行带正确的 `target_kind`/`target_id`/`target_field`，且仍出现在飞书转发路径里 |
| 限流一致 | 同一来源连发触发 429（与 `/feedback` 同一计数器），`feedback_bans` 命中后两个入口都 403 |
| 不自动抓取 | 全仓 grep 证明没有任何公开路由把 `target_id`/正文里的 URL 直接交给 `collectSource`/`extractFromUrl` |
| 后台可用 | 同一目标的两条纠错显示在一起；「跳到该条目」落到 `/admin/content/:id`；处理后状态与备注写回并进审计 |
| 出口 | `npm run typecheck` 全绿；`/submit` 与 `/feedback` 都在 `packages/contracts/src/http-policy.ts` 已覆盖的 `/^\/api\//` 下，**不用登记 `API_OWNED_PATTERNS`** |
| 测试 | 新增 `tests/feedback-targets.test.ts` 全绿 + 全量 `npm test` 0 失败 |

**待站主拍板**：「报告问题」要不要在页面上显示成「纠错」还是更弱的「告诉我们」；投稿链接要不要保留原始 URL（会留在数据库里，涉及投稿人隐私）；后台聚合视图要不要给同一目标的纠错排优先级（建议按 `from_source` 去重后计数）；要不要给已处理的纠错发一封邮件回执（需要 SMTP，当前只有飞书内部通知）。
**工作量**：2 天（迁移与入口 0.5 + 后台聚合视图 1 + 投稿页与流程 0.5）。

---

## 四、明确不做

- 账号、注册、登录（用户明确否掉）
- 审核队列 / 全量人工审核（保持自动发布）
- 编年史入口、普通主题页、话题页
- ICP 备案、Cloudflare China Network、大陆本地节点
- 优选 IP（**已死**：Cloudflare 2026-08 起 Error 1034；阿里云 ESA 2026-01 起 CNAME 校验拦截。任何还在教这个的教程都过时了）
- **信源覆盖率与覆盖率评分**（站主 2026-10-05 明确排除：源健康度已经有 `sources.health` + `packages/backend/src/operations/`，覆盖率那层先不做。见「下一阶段」）

### 国内源实测排除项（都试过了，别再试）

| 源 | 实测结果 |
|---|---|
| **次元黄页 yunmanzhan.com** | 可用，但 `date.php` **单页 15.5MB**、窗口只有 6 周（2026-09-27 ~ 2026-11-07），实测**独有贡献 0 条** → 放弃 |
| **小红书** | 需登录 + `x-s`/`x-t` 签名；RSSHub 只有按用户订阅、无搜索路由，且 `requirePuppeteer` + `XIAOHONGSHU_COOKIE`；MediaCrawler 有封号 issue（#865 账号永久封禁、#858 采集算法失效、#915 检测到 AI 操作）→ **用户定案不做** |
| 喵特 nyato.com | **全站 nginx 404，已死**（DNS 还解析得到，但服务器不返回内容） |
| 微博 | HTTP 432 全站风控 |
| 大麦 | 阿里 x5sec 滑块 punish 页 |
| 百度贴吧 / NGA | 403 |
| ComiDay / IDO 官网 | 502 |
| 乐童 / 正在现场 / 永乐 | 连接失败 |
| B站动态 API（主办方账号） | `x/polymer/web-dynamic/v1/feed/space` HTTP 412（需 WBI 签名 + SESSDATA）→ **不做**；主办方上架票务后必然同步到会员购，不必单独追动态 |
| BilibiliWorld 官网 | 纯 JS SPA |
| 萤火虫官网 | 可用但不分 ONLY，且停更 3 个月 |
| RSSHub | 998 个命名空间里**没有** `weibo`（已移除）/ `showstart` / `nyato` / `allcpp` / `tieba`；公共实例 rsshub.app 全路由 403 → 帮不上忙 |

> 注：`docs/research-new-sources-only-and-livehouse.md` 那份是**日本向**调研（第一版任务书写错了目标区域），只对"加日本 livehouse 源"有参考价值，**大陆侧以本文档 W6 为准**。

## 五、待核实

1. `docker-compose.yml` 用的 `postgres:17-alpine` 够不够。本机开发容器 `aniband-pg` 是 `pgvector/pgvector:pg18`，但**迁移和代码里都没有 `CREATE EXTENSION` / `vector(` 用法**，embedding 只用于召回（`packages/backend/src/providers/embeddings.ts`，无 key 时退回文本重合度比较）。看起来 17 够用，但没实测。
2. 8 个 `hot_signal` 源要不要改成 `editorial` 以拿到正文（见 W2-1）。
3. `syndicate_fulltext`（对外接口/RSS 带全文）要不要一起打开。当前建议：**站内全开，对外接口和 RSS 先关**（那是给机器和聚合器用的，风险面更大），需要时再打开。
4. ~~日报/周报/月报的"今天"改成 JST~~ **已作废**：W2-7 查证后认定「统一到 JST」本身是错的（见 W2 第 7 条），截止时间用公告自己的日本日历、日报的"今天"用读者的北京日历，两者都保留。本条不再需要回归测试；真正要解决的是**国内源带时刻的 `at` 被按 JST 解释**，见 W7。
5. ~~**中文源的入选阈值没校准过**~~ **已校准（2026-10-05，见 W6「第二版校准」）**：加了 `T2_EVENT = 54` 这一档，57 条样本上 acc 0.912 / P 0.97 / R 0.889。局限仍在：国内只有 15 条自标样本、`T2` 日语正样本 1 条、`T1_5` 0 条，采满一个月后要重标重跑。
6. ~~**CPP 的 `tag` 过滤词表要定死**~~ **已定案**：扫过 `type=3&time=8` 全部 187 条的 447 个 tag 片段，与我们相关的只有 `BanGDream`（含大小写与 `!`/`！` 三种写法）、`邦多利`、`少女乐队`、`孤独摇滚`、`GirlsBandCry`、`GBC`、`音乐企划`、`音乐番Only`、`音企`；落地用了 8 条 URL（前 8 个写法），实测覆盖在范围内的全部 9 场。其余 400+ 个 tag 是明日方舟/原神/特摄等无关 IP。**新增写法时要重新扫一遍**（`tag=` 大小写不敏感，但不折叠 `!` 与 `！`）。

---

## 六、验证记录

**W0（2026-10-04 完成）**

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（含 `npm run typecheck -w @girlsbands/web`） |
| `npm test` | **585 通过 / 0 失败**，73.1s |
| `npm run build -w @girlsbands/web` | 成功，548ms |
| `node --test apps/web/tests/*.test.ts` | **29 通过 / 0 失败** |
| `docker compose config --quiet` | 通过（`docker compose up` 未跑，等 W4 有服务器再验） |
| `git grep -i "aniband\|myhot\|KKKKhazix"` | 除本文档外零命中 |
| `git grep -i aihot` | 只剩 3 处故意保留（`NOTICE:2`、`NOTICE:5`、`README.md:148`） |
| 改动规模 | 312 个已跟踪文件，+1258 / -1294（品牌字这一批另加 5 个文件、1 个新字体子集） |
| `node --test tests/og-fonts.test.ts tests/email-hero.test.ts` | 17 通过（含新增的「品牌字体：站名一个字符不缺」一条） |

> ⚠️ **本机跑测试必须带 `PATH="/opt/homebrew/opt/libpq/bin:$PATH"`**，否则 `pg_dump` / `pg_restore` 找不到，`tests/backup.test.ts` 与 `tests/backup-files.test.ts` 会以 `spawn pg_dump ENOENT` 失败（与代码无关）。
> 测试库名必须以 `_test` 或 `_ci` 结尾：`DATABASE_URL=postgres://aniband:aniband@127.0.0.1:55432/girlsbands_test npm test`。
> **跑单个文件也要带 preload**（`--test-global-setup=tests/databases.ts --import ./tests/databases.ts`），否则那条命令会把数据写进模板库、污染之后的全量运行 —— 详见 W6「踩到的坑」最后一条。

**W0 踩到的坑（改站名会连带）**
- 邮件模板的站名检查曾因 HTML 转义失败：站名 `少女乐队's` 的 ASCII 撇号在 HTML 里是 `&#39;`，`tests/email-rules.ts:477` 原来直接拿原文 `html.includes(SAMPLE_SITE.name)` 比对。已在 `tests/email-rules.ts` 加 `visibleText()` 还原实体后再比（安全检查仍用原始 html）。
- 邮件头图品牌行原来取 `SITE.name.toUpperCase()`（`apps/api/src/og/hero.ts`），画出来是 `少女乐队'S`。**已定案**：原样画 `少女乐队's` + 站酷快乐体 30px，见上面第 8 条。这个坑还在：`heroEtag()` 的哈希输入里**没有** `BRAND_WORDS`，改品牌字必须同时升 `HERO_TEMPLATE_VERSION`，否则渲染结果逐字节不变。

**W2（第 3 项 · 受控词表，2026-10-05 完成）**

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿 |
| `node --test tests/glossary.test.ts` | **12 通过 / 0 失败**（新增 3 条：成员/会场进块、两字假名不误命中、没有过短的写法） |
| `node --test tests/translate.test.ts tests/analyze.test.ts tests/analyze-consistency.test.ts tests/analyze-news-identity.test.ts` | **16 通过 / 0 失败**（词表注入改的是提示词构造路径，这几条是回归） |
| 词表规模 | `GLOSSARY` 336 条 / 914 个写法（过滤前 337 条） |
| 数据来源 | 成员 162 条（84 角色 + 78 中之人）、会场 135 条（日本 109 + 中国大陆 26），逐条带来源，已提交进仓库 |

**W2（第 3 项 · 成员表按规则 C 重做，2026-10-05）**

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿 |
| `node --test tests/glossary.test.ts` | **13 通过 / 0 失败**（第 13 条「a name with a Chinese rendering lists it first」补上 `後藤ひとり`→`后藤一里`、`山田リョウ`→`山田凉`，并断言原文写法仍被接受） |
| 词表规模 | `GLOSSARY` 仍 336 条（成员表 162 行，条数不变，只有写法顺序与内容变） |

**W2（第 6 项 · 翻译链路告警，2026-10-05）**

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿 |
| `node --test tests/alerts.test.ts` | **5 通过 / 0 失败**（含新增的「translation problems reach the owner without crying wolf over long bodies」） |
| 该测试覆盖的行为 | 两条不报、三条报 `translate.stuck`（`now`）、`attempts >= 3` 走「不会自己恢复」分支、`outcome='skipped'` 不算缺失、短原文的半截译文报 `translate.partial`（`today`）、超 `MAX_CHARS` 的长文不报、5 条 10 分钟的样本报 `translate.slow`（`digest`）、删掉样本后不报 |

**W2（第 5 项 · 每周人工抽检 20 条，2026-10-05）**

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（含 `react-router typegen` 为新路由生成 `./+types/admin/review`） |
| `node --test tests/admin-review.test.ts` | **4 通过 / 0 失败** |
| 全量 `npm test` | **608 通过 / 0 失败**（604 + 新增 4 条） |
| `npm run build -w @girlsbands/web` + `node --test apps/web/tests/*.test.ts` | 构建成功；**29 通过 / 0 失败** |

**W2（第 4 项 · 硬校验，2026-10-05）**

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿 |
| `node --test tests/analyze.test.ts` | **11 通过 / 0 失败**（新增 2 条：「a writer that gives no Chinese copy is asked again, as a new request, and the item goes out」「an item whose writer gives no Chinese copy twice ends failed, and the owner's retry asks again」） |
| 全量 `npm test` | **604 通过 / 0 失败**（首次跑到 603/604，失败的是 `tests/media-performance.test.ts` 的「pending animations expire at caches…」，单独重跑 12 条全过、整轮复跑 604 全过 —— 并发下的时间敏感用例，与本次改动无关） |
| `apps/web` | 本次未动前端 |

**W2（第 1–2 项，2026-10-05）**

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿 |
| `node --test tests/translate.test.ts` | **4 通过 / 0 失败**（含新增的「an item the site did not pick is translated too」） |
| `npm run db:migrate` | `applied 0055_rename_source_config_key.sql`、`applied 0056_site_fulltext_editorial.sql` |
| dev 库 `sources` 分布 | `editorial` + `site_fulltext = true` 30 行；`hot_signal` + `false` 8 行 |

**W3（2026-10-05 完成）**

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿 |
| `node --test tests/admin-corrections.test.ts` | **7 通过 / 0 失败**（含新增的「withdrawing a whole source takes its published items off every exit and pauses the source」） |
| 统计脚本扫描 `apps/web/app`、`apps/web/server.ts`、`packages/backend/src` | 零命中（所以隐私说明里「本站不做访客统计」是实话） |

**W1（2026-10-05 完成）**

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（含 `npm run typecheck -w @girlsbands/web`） |
| 全量 `npm test` | **613 通过 / 0 失败**（608 + 4 条 `tests/calendar.test.ts` + 1 条 `?scope=all`，日志 `.data/w1-full-test3.log`） |
| `npm run build -w @girlsbands/web` | 退出 0 |
| `node --test apps/web/tests/*.test.ts` | **29 通过 / 0 失败** |
| `node --test tests/og-fonts.test.ts` | **8 通过**（新增 bocchi 字标后不必重建字库：`jpCharset()`/`displayCharset()` 已收全假名与全角区） |
| `node scripts/fetch-band-logos.ts` | 抓取 20/20、失败 0（新增 `assets/band-logos/bocchi-the-rock.png` 1200x192） |

**W1 踩到的坑**
- 字标数从 19 变 20，四个测试/文档里的数字要跟着改（`tests/email-hero.test.ts:52,144,190`、`tests/og-fonts.test.ts:25,75`、`assets/band-logos/README.md`、`docs/subscribe.md:71-72`、`industry/email/hero.ts:12`、`apps/api/src/og/hero.ts:10,98`）——漏一个就是红的。
- 主题页收窄后，`tests/topics-rules.test.ts:61` 原来断言 genre slug 有页、`tests/topics.test.ts:141-145` 原来断言条目只挂主体页，都要按新语义改（内容形态只是标签；条目页同时列乐队页与企划页是既定行为）。
- API 路由把 `now` 传成 `undefined` 时，精选视图走 `topics.ts:217` 的 60 秒 `indexCache`，发布也不会让它失效 ⇒ 测试里不能拿它和 `new Date()` 新读的索引比，只能拿两个视图互比。
- iCalendar 测试里 `lines.find(l => l.startsWith("DESCRIPTION:"))` 抓到的是按日期最靠前的整天事件（没有 note），要按条目链接挑；折行续行本来就以空格开头，不能断言「不允许以空格开头」。

**W6（2026-10-05 完成）**

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（含 `npm run typecheck -w @girlsbands/web`） |
| `node --test tests/listing-fanout.test.ts tests/sources.test.ts` | **16 通过 / 0 失败**（扇出 / 全空失败 / 404 失败 / `renderFields` 段落丢弃与 `{date:}` 归一 / `summaryIsBody`） |
| 全量 `npm test` | **618 通过 / 0 失败**（86s） |
| 端到端 | 见上面「端到端验收（2026-10-05）」表：15 条全部 `pass` → 全部动态 + 企划日历 + `.ics` |
| dev 库 | 三条新源 `editorial / interval 360 / enabled t`；删掉 11 条历史 `x_*` 后剩 30 条 |

**W6 收尾（2026-10-05，第二版校准 + 票价修正之后）**

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（含 `npm run typecheck -w @girlsbands/web`） |
| `node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test --test-timeout=120000 tests/sources.test.ts tests/analyze.test.ts` | **25 通过 / 0 失败**（`{money:}` 5 条新断言 + `tierThreshold("T2_EVENT")` / `EXCLUDE_MP`） |
| 全量 `npm test`（模板库洗干净之后） | **618 通过 / 0 失败**（86s） |
| 评测复跑 | `.data/eval/selection-all-57-1791146595746.json`、SelectBench `sb-20261004-3f6342`：acc 0.912 / P 0.97 / R 0.889 / F1 0.928；国内 14/15 |
| 精选出口 | `GET /feed.xml` 200 / 51545B / 50 条 item，其中 **14 条国内**（9 CPP + 4 B站 + 1 秀动），摘要里已是「票价 ¥68 起」 |
| 条目页 | `GET /items/k1uqn1nxtfioqrfwwygfr2lg9`（B站天津拉邦烤）200 / 36315B，命中「拉邦烤」「¥68」「乒乓」「2026-10-24」 |
| 企划日历 | `/calendar.ics` 105 个 VEVENT、CRLF、0 行超 75 octets；`/calendar/girls-band-cry.ics` 46 个含「哭泣少女乐队Only Live」，`/calendar/bang-dream.ics` 56 个不含（归属正确） |
| dev 库 | 三条新源 `tier = T2_EVENT`、`sources_tier_check` 含 `T2_EVENT`；15 条国内条目 **14 条 `selected = t`**（门槛 54）、全部 `analyzed / eligible / public / full` |
| 安全阀 | `.env` 的 `COLLECT_ENABLED` / `MODEL_CALLS_ENABLED` 已恢复 `false`（与 `.data/env.eval.backup` 逐行一致） |

**W6 踩到的坑**
- **模型配额是这次唯一的真障碍**：`registerContentJobs` 的 `localConcurrency: 6`（`packages/backend/src/jobs/content.ts:188`）撞上服务商「60s 内 120 次」的限额 —— 开阀门后 29 个源一次全量重抓（97 条新条目）把配额打满，我们那 15 条首轮 **15/15 都是 `llm HTTP 429: 请求过于频繁（60s 内超过 120 次）`**，靠 `RETRY_MINUTES = [5,10,20,40,60,120,240,360]`（`jobs/content.ts:18`）的阶梯重试到第 2 轮才过（`processing_attempts = 2`）。稳态（每天几条）碰不到，但「一次全量重抓」一定碰到 —— 这是 W5 成本与模型要看的第一个数字。
- **改 `.env` 不会让 `node --watch` 重启**：`apps/worker` 的进程是 `node --watch --env-file-if-exists=../../.env src/main.ts`，换安全阀必须 `touch apps/worker/src/main.ts`，否则你以为阀门开了、其实还是旧的（第一轮采集会一直不出现）。
- **`structure.md` 写了「只写日期不写时刻」，模型仍会写时刻**：秀动那条抽出的是 `{"at":"2026-10-11T15:30","kind":"event"}`。`publication/deadlines.ts:38` 的 `jstInstant` 按 JST 解释，15:30 这种下午场没事，但**北京时间 23:00 之后开演的场次会被推成次日**。要彻底消掉得让结构步骤按来源地区选时区，现在没做。（**W7 已修**：`jstInstant` 删除，`publication/deadlines.ts` 改成按来源的 `config.timezone` 解释；见 W7 章节。）
- **关阀门要等积压跑完**：worker 拿不到模型时条目会按 `RETRY_MINUTES` 阶梯重试，整条阶梯走完（约 14 小时）才落 `failed`；中途关掉会把剩下的积压条目一路耗到终态，之后只能从后台「重试」救回来。
- **单文件跑测试必须带 preload，否则会污染模板库**：`node --test tests/x.test.ts`（不带 `--import ./tests/databases.ts`）会直接写进 `DATABASE_URL` 指向的模板库 `girlsbands_test` —— 而模板库是所有测试文件克隆的来源（`tests/databases.ts:62-65`）。留下 2 条 `test-analyze-*` 源和 13 篇文章之后，之后的**全量**运行里 `tests/backend-read-load.test.ts`（断言 `sources` 恰好 2 条）、`tests/grouping-reliability.test.ts`、`tests/processing-recovery.test.ts` 会无端变红（实测 4 条失败、单跑也红），排查半天才发现与代码无关。正确写法：`node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test --test-timeout=120000 tests/x.test.ts`。模板库脏了就洗一遍：`DROP DATABASE girlsbands_test WITH (FORCE)` → `CREATE DATABASE girlsbands_test OWNER aniband` → `DATABASE_URL=postgres://…/girlsbands_test node scripts/migrate.ts`；**干净模板里 `sources`/`articles`/`receipts` 都必须是 0，只有迁移自己插的 9 条 `budgets`**。**少写 `--test-global-setup=tests/databases.ts` 时，每个测试文件克隆出来的 `girlsbands_test_f<pid>_test` 不会被清掉**（实测单跑 5 个文件留下 5 个库），得手工 drop。

**补录：GBC 侧漏掉的两支乐队（2026-10-05）**

GIRLS BAND CRY 的乐队名单一直只有 トゲナシトゲアリ、クズミミズク、ダイヤモンドダスト —— 游戏「ガールズバンドクライ First Riff」的原创乐队其实有三支，第 1 弾 **Canna Lily** 与第 2 弾 **F-272** 没登记（依据：[gamer.ne.jp 2026-10-03 第 3 弾 解禁](https://www.gamer.ne.jp/news/202610030026/) 里 11/3「赤色の響祭」的出演名单，以及 [DONUTS 的 Canna Lily 公告](https://www.donuts.ne.jp/news/2026/0322_gbc_cannalily/)、[Skream! 的 F-272 公告](https://en.skream.jp/news/2026/04/gbc-firstriff_f-272.php)）。`gbc-firstriff.com` 本来就是信源，所以这两支的新闻一直在采集，只是没有实体：不挂主体标签、没有主题页与订阅。按 `AGENTS.md` 的「加一支乐队要改四处」补齐：

| 检查 | 结果 |
|---|---|
| `industry/taxonomy.ts` | `ENTITIES` 加 `canna-lily`（accent `#e8629a`）、`f-272`（`#2fbf9b`）；`SERIES` 的 girls-band-cry 成员 4 → 6；`IDENTITY_LEXICON` 各加一条（`/canna\s?lily/i`、`/\bf[-\s]?272\b/i`） |
| `industry/topics.json` | 主体 20 → 22（4 企划 + 18 支乐队），带页面的主题 29 → 31 |
| `assets/band-logos/` | `node scripts/fetch-band-logos.ts` → **22/22 成功**；新字标 1077×419（canna-lily，inkLum 0.79）、970×390（f-272，0.89）；`git status` 里只有 `manifest.json` 与两张新 PNG 变化 |
| 词表 | 乐队名从 `ENTITIES` 自动生成（`industry/glossary.ts:49`），`GLOSSARY_VERSION` `glossary-336-q9eeo5` → `glossary-338-rs65fk`；旧翻译回执因此失效、会重译一次，符合预期 |
| 应援色当底 | 照 `apps/api/src/og/hero.ts` 的 `inkHist`/`unreadable` 逐像素重算：22 个字标里仍然只有 4 个（girls-band-cry、kessoku-band、bocchi-the-rock、afterglow）能直接压在应援色上，新两支分别丢 5.2% 与更多 → 照旧走 `plateFor` 的度量，不用加 `PLATE_OVERRIDE` |
| `npm run typecheck` | 全绿（含 `npm run typecheck -w @girlsbands/web`） |
| 相关测试 | `og-fonts` / `email-hero` / `glossary` / `topics` / `topics-rules` / `subscriptions` 全绿（含新字标的字形、manifest 与磁盘一一对应、`BAND_IDS.length === 18`） |
| 全量 `npm test` | **618 通过 / 0 失败**（122s） |
| web | `npm run build -w @girlsbands/web` 通过；`node --test apps/web/tests/*.test.ts` **29 通过 / 0 失败** |

**订正**
- 本文档 W2-1 原写「`scripts/seed.ts` 是 upsert，改完跑一次 seed 即可」→ 错，是 `ON CONFLICT (id) DO NOTHING`，必须加迁移。
- 本文档 W3 原写「`grep '下架'` 零命中，只能手改数据库」→ 错，单条下架机制一直在 `packages/backend/src/admin/content.ts:90` 的 `setVisibility`。


**W7（2026-10-05 完成）：时间模型带时区**

`packages/backend/src/publication/deadlines.ts` 删掉 `jstInstant`（死写 `+09:00`），改吃 `packages/backend/src/sources/timezone.ts` 的 `splitDeadlineAt` / `deadlineInstant` / `timezoneOf`：`at` 拆成 `day` + `localTime`，时区来自 `sources.config.timezone`（默认 `Asia/Tokyo`，三个国内源 `Asia/Shanghai`）。`DeadlineView` 加 `localTime` / `timezone`；`DEADLINE_KINDS` 搬进 `packages/contracts/src/site.ts` 当唯一真源（原先 `analyze.ts` 少两项，把 `release_start` / `merch_start` 静默吞成 `other`）；`.ics` 带时刻的事件写 `DTSTART;TZID=…` 并附静态 `VTIMEZONE`；网页与邮件显示「15:30 北京时间」。迁移 `0059_source_timezone.sql` 给三条国内源写 `timezone`。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（含 `npm run typecheck -w @girlsbands/web`） |
| `tests/calendar.test.ts` + `tests/deadlines-time.test.ts` | **12 通过 / 0 失败** |
| 全量 `npm test` | **629 通过 / 0 失败**（65s） |
| 迁移 | 已应用到 dev 库（3 条国内源 `config->>'timezone'` = `Asia/Shanghai`） |
| 模型花费 | 零（没改提示词） |

**这一轮的坑：机器负载会让全量测试假红。** 这台机器上另有一个虚拟机（`Virtualization.framework` 125% CPU）、DSH/ChatGPT 的渲染进程和一个 Codex 会话，`load average` 一度到 **181（10 核）**。全量 `npm test` 因此跑成 1057s（基线 122s），5 条报 `test timed out after 120000ms` 或 `spawnSync … ETIMEDOUT`（`tests/analyze-kill.test.ts`、`tests/backup-files.test.ts`、`tests/collection-tail.test.ts` ×2、`tests/collection.test.ts`、`tests/mcp-host.test.ts` ×2、`tests/rss-conditional.test.ts`、`tests/selection-eval-runtime.test.ts`）。同一批文件用 `--test-concurrency=1` 单独跑是 **55 通过 / 0 失败**，负载回落到 60 后全量 **629 通过 / 0 失败**。结论：那批红全是饿死，与改动无关；**报全量结果前先看 `uptime`**。

**W8（2026-10-05 完成）：LiveEvent 一等实体**

`database/migrations/0060_live_events.sql` 建 `live_events`（唯一键是表达式索引 `(subject_entity, COALESCE(venue,''), starts_on, COALESCE(starts_time,''))` —— 两个可空列用普通唯一索引会被当成彼此不同）+ `facts.live_event_id`。阶段 A：`packages/backend/src/lives/link.ts` 推导键并 upsert，`packages/backend/src/events/live.ts` 的 `linkLiveEvent` 在归组写事务**提交之后**被调用（失败只记 `liveLinkError`）；**类别门** `LIVE_CATEGORIES = {live, ticket}`（`industry/taxonomy.ts`）是实测逼出来的 —— 第一批 6 条候选里 3 条是生放送 / 展览 / 快闪店。会场用 `glossaryHits(text, ["venue"])` 恰好命中一条才写。阶段 B：新提示词 `industry/prompts/live-ticket.md`（新文件 ⇒ 旧回执不失效）+ `editorial/analyze.ts` 的 `runLiveTicket`，写 `analyses.output.live`，门是「类别 ∈ live/ticket 且结构步抽到 `kind='event'` 日期」，模型复用 `structure` 档位（不新开环境变量），`purpose` 是 `live_ticket_article`（已加进 `jobs/content.ts` 的 `ARTICLE_STEPS`）。读取在 `packages/backend/src/publication/lives.ts`（`loadLive` / `livesForSubject` / `liveRefForStory` / `liveSitemapEntries`），报告投影抽到 `publication/report-views.ts` 以打断循环依赖；阶段读时派生，`cancelled` / `postponed` 优先，没有 `sold_out`（那是 W9）。出口 `/api/site/lives/:publicId`（复数）+ `/live/:publicId` 页面 + 主体页 Live 区块 + story 页胶囊 + sitemap。`packages/contracts/src/time.ts` 新增 `timezoneDate(timezone, instant)`。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（含 `npm run typecheck -w @girlsbands/web`） |
| `tests/live-events.test.ts` | **8 通过 / 0 失败**（键推导、类别门、同一场只一行、日期取 `publications.analysis_id` 那条、标题取演出类报告、七种阶段、下架后 404、API 200/404） |
| `tests/analyze.test.ts` | **12 通过 / 0 失败**（新增「Live 与票务公告读演出本身，只读原文说了的」；重放回执那条仍绿） |
| `tests/deadlines-time.test.ts` | **8 通过 / 0 失败**（新增「一场演出属于它自己那口钟的那一天」） |
| 全量 `npm test` | **639 通过 / 0 失败**（112.6s，0 cancelled） |
| 迁移 | 已应用到 dev 库 |
| 阶段 A 回填 | `candidates: 6, linked: 3, no identity: 3`（被拒的 3 条是 `stream` / `collab`）；**误并 0、误分 0**；库里的三场：`kuzumimizuku 2026-10-18`、`girls-band-cry ぴあアリーナMM 2026-11-03`、`mygo 2026-11-14` |
| 出口实测 | 三个 `/api/site/lives/<id>` 全 200（阶段 `ticketing`，报道 2/2/3）；`/live/<id>` 200、未知 id 404；主体页 Live 区块与 story 胶囊都链到演出页；`/sitemap.xml` 含 3 条 `/live/<id>` |
| 模型花费 | 阶段 A 零；阶段 B 灰度重跑 **2026-10-05 已跑完**（`scripts/reanalyze-live-tickets.ts --tag live-ticket-v1`，`queued: 28`，约 170 次调用）：24 条抽到 `output.live`（13 条带轮次、共 14 个轮次窗口），**没有新建演出、也没有轮次** —— 重跑过的条目不会再归组（21 条是历史条目、不建事实；其余走提前返回），新轮次由回填脚本补进 `ticket_rounds`（2 条）。详见上面的「实现与验证」 |

**W8 收尾（2026-10-05 拍板，无需改代码）**：粒度保持**一站一实体**（昼/夜按开演时刻分开、对盘各乐队各一页、巡演一站一页；要改只需动唯一键与 `mergeKeys`）；**已完结的 Live 页长期保留、照常收录**（阶段照常派生 `finished`，页面 200、进 sitemap、企划页排在未开演之后）—— W16 的「事后档案」就建在这些页上。

**W8 踩到的坑**
- **「有日期的活动」不等于演出**：`stream`（生放送）、`collab`（展览、快闪店）都会被 structure 抽成 `kind='event'`。第一批 6 条候选里 3 条就是这么误建的，必须按 `publications.category` 设门。
- **日期要取 `publications.analysis_id` 那条分析，不是最新一条**：同一文章可能有多条 `analyses`（`input_revision` 不同），写日期的往往是 `analysis_id` 指的那条 —— 日历（`publication/deadlines.ts:73`）就是这么读的，演出页的日期必须和日历同源，否则「日历上有、演出页没有」。
- **时区偏移的符号会反**：`Date.parse("1970-01-01T00:00:00+09:00")` 得到的是 `-9h`，拿它当「东京的今天」会让日期早一天（测试里表现成阶段判成 `announced`）。统一改成 `packages/contracts/src/time.ts` 的 `timezoneDate`。
- **`analyses.output` 里没有 `category` / `tags` / `subjects`**：分类在 `publications.category`，主体在 `analyses.subjects` 列。
- **契约里新加的字段必须被 web 读掉**：`tests/architecture.test.ts:145-150` 要求 `packages/contracts/src/site.ts` 的每个字段都能在 `apps/web` 里找到引用，`firstSeenAt` / `updatedAt` 起初没人用而红 —— 在演出页页脚写了「本站 X 首次收录，Y 最近更新」。
- **词表缺口不要顺手补**：`代官山SPACE ODD` 不在 `industry/glossary-venues.ts` 里，所以那一场的会场留空。补进去会改 `GLOSSARY_VERSION` → `TRANSLATE_PROMPT_VERSION` → 全站旧译文回执失效重译，要单独一次决定。

**W9（2026-10-05 完成）：票务状态机 TicketRound**

`database/migrations/0061_ticket_rounds.sql` 建两张表。`ticket_rounds` 的唯一键同样是表达式索引 `(live_event_id, kind, COALESCE(substring(apply_start_at FROM 1 FOR 10), ''))` —— 取日期段当键，先只写日期的公告与后来写明时刻的公告归成同一条（精度只允许「日期 → 日期+时刻」单向提升，`CASE WHEN 旧 LIKE '____-__-__' AND EXCLUDED LIKE '____-__-__T%'`）。`ticket_round_events` 记 `opened` / `closed` / `result` / `payment_due` 四种节点，第一次见到才写（`ON CONFLICT (ticket_round_id, kind) DO NOTHING`），重复同步什么也不写。日期全部存 text（与 `analyses` 的 `at` 同形状 `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm`），读取时复用 `splitDeadlineAt` / `deadlineInstant`，不做第二套解析；**状态不落库**，读时按日期与此刻派生（与 `live_events` 的阶段同一条规矩）。写入在 `packages/backend/src/lives/tickets.ts`（`syncFactTicketRounds` 由 `packages/backend/src/events/live.ts` 的 `linkLiveEvent` 在同一事务里调用），读取在 `packages/backend/src/publication/tickets.ts`（`roundsOf` / `roundStatus` / `roundSlotKind` / `roundNote`）。提示词 `industry/prompts/live-ticket.md` 加了第六节 `rounds`（一轮 = 开始与截止都相同的一次受理；四个日期与 platform 都必须能在那一句 `quote` 里找到），结果写进 `analyses.output.live.rounds`。

票务日期在雷达、日历与 `.ics` 上是**轮次说了算**：`publication/deadlines.ts` 的 `deadlineWindow` 与 `deadlineMonths` 都改成「公告 / 轮次」两分支 `UNION ALL`（轮次分支用 `INSERT` 时一模一样的表达式唯一键展开四个槽位），公告分支只在该日期已被同一场演出的轮次接管时让位 —— `NOT EXISTS (… substring(d.value->>'at' FROM 1 FOR 10) IN (substring(tr.apply_start_at FROM 1 FOR 10), …))`，逐天精确比对，不是「这条事实挂了有轮次的演出就把票务日期全砍掉」。`DEADLINE_KINDS` 9 → **11**（新增 `sale_end` 贩售截止、`payment_deadline` 缴款截止），所以 `editorial/analyze.ts` 的 zod enum、`apps/web/app/features/feed/deadlines.ts` 的 className、契约的 `DEADLINE_LABELS` 与测试里的清单一起跟着改。演出页 `/live/:publicId` 的「票务与日程」先列轮次（名字 + 平台照原文 + 状态徽标 + 倒计时 + 四个日期槽位 + 链到那篇公告），公告里**没被轮次接管**的其它日期列在下面的「公告里的其它日期」。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（含 `npm run typecheck -w @girlsbands/web`） |
| `tests/ticket-rounds.test.ts` | **8 通过 / 0 失败**（键与幂等、精度提升、没日期不落库、状态六阶段 + 跨时区、轮次接管同一天的票务日期、演出页列轮次且 `dates` 不重复、下架后 `loadLive` 为 null 但 `roundsOf` 仍在、API 带 `rounds`、`Asia/Shanghai` 源） |
| 全量 `npm test` | **648 通过 / 0 失败**（108.4s，0 cancelled；W8 后基线 639） |
| web | `npm run build -w @girlsbands/web` 通过；`node --test apps/web/tests/*.test.ts` **29 通过 / 0 失败** |
| 迁移 | 已应用到 dev 库 |
| 模型花费 | 零（轮次与 W8 阶段 B 的演出名同属 `live-ticket` 步骤，**同一次重跑**；`scripts/reanalyze-live-tickets.ts --dry` → `candidates: 28`） |

**W9 踩到的坑**
- `CROSS JOIN LATERAL (VALUES tr.apply_start_at, tr.apply_end_at) AS e(slot_at)` 是**语法错误**（`syntax error at or near "tr"`）：`VALUES` 出现在 `FROM` 里时每一行都要单独加括号，写成 `(VALUES (tr.x), (tr.y))`。
- **不要「这条事实挂了有轮次的演出就把票务日期全砍掉」**：轮次是从公告里抽的，抽漏的那一天就凭空消失了。只在同一天已被轮次接管时让位。
- **只写日期的截止日必须整天算数**：`roundStatus` 里开始类槽位按当天零点、截止类按那一地的 `23:59` 比（`bound(at, timezone, edge)`），否则读者最需要「截止日」的那一天打开页面看到的是「已结束」。
- **没有日期的轮次不落库**：只有平台名、一个受理日期都没有的轮次既给不了可行动的日期，也算不出状态。
- **老的条目没有 `fact_id` / `story_id`**（dev 库 438 条里只有 30 条有），所以「同一天由另一篇文章写出的票务日期」既不是 `tr.first_article_id`、也连不到同一场演出，接管不到 —— 这是数据现状，不是规则漏洞。
- **契约里对象字面量的键也算「接口字段」**：`tests/architecture.test.ts` 的正则会把 `TICKET_ROUND_LABELS` 的 9 个键当成待读字段，而 api 侧用 `TICKET_ROUND_LABELS[r.kind]` 并不产生这些标识符。照 `DEADLINE_KINDS` 的老写法在 `apps/web/app/features/feed/tickets.ts` 镜像一份 `ROUND_KINDS`（名字来自契约、颜色归网站）才算读掉。
- **加了日期种类就要同步四处**：`tests/deadlines-time.test.ts` 写死 `DEADLINE_KINDS.length === 9`，加到 11 会红（那条测试的作用就是这个）。

**详情页配图（2026-10-05 完成，站主看完 W11 页面后提出）**

站主原话：「得带图吧，都没图片」。范围只到详情页（条目页 / 演出页 / story 页 / 碟页），列表页先不动；没图不占位、保持纯文字头。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（含 web） |
| `tests/covers.test.ts` | **3 通过 / 0 失败**（挑图规则、四个出口同一条公告的图、下架后一起收回、没图就是 null） |
| `tests/architecture.test.ts` | **8 通过 / 0 失败**（`CoverView` 的字段都被网站读到） |
| 全量 `npm test` | **665 通过 / 0 失败**（W11 后基线 662） |
| web | `npm run build -w @girlsbands/web` 通过；`node --test apps/web/tests/*.test.ts` **29 通过 / 0 失败** |
| dev 实测 | `/release/ryi7IYdn0UNs`、`/live/l5LGeAg8pXys`、`/story/a51df353-…`、`/items/c8tmftj6furcves5utu2w9txq` 的 SSR HTML 都带 `/api/img-proxy?...mode=image-1200` + hero 三档 `srcSet`；代理本身 `200 image/webp 1024×576` |
| 模型花费 | 零 |

**为什么原本没图**：`articles.media` 里本来就有图（439 条公告 285 条有图，公开的 438 条里 285 条有、153 条没有），但公开读取层只有 X 帖与正文里的 `<img>` 会渲染，四个详情页的头部都没有取过 `media`。**挑图规则**只有一处：`packages/backend/src/lib/image-url.ts` 的 `pickPicture` —— 只认 `kind: "image"`、跳过追踪像素与 Hatena 的 favicon（**67 条公告的第一张正是那个 64px 图标**）、跳过声明宽度 < 480 的缩略图、把属性里残留的 `&amp;` 还原成 `&`；排序与可见性在 `packages/backend/src/publication/covers.ts`（第一方 > 已选中 > 分数高，可见性沿用 `storyReportCondition`，所以公告下架图跟着消失）。条目页在正文已经排过图时不重复放封面（dev 里 91/438 条正文自带 `<img>`）。

**列表页配图（2026-10-05 完成，站主接着拍板）**

站主拍板两条：**做**（首页与「全部」的卡片、主题页的演出与发售列表）；版式取**左侧小缩略图** —— 桌面 120×84、手机 84×60，横版裁切（`object-cover`），文字一行不动；**没图的卡片与之前完全一样**（不占位）。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（含 web） |
| `tests/covers.test.ts` | **4 通过 / 0 失败**（新增「列表出口用 336 档，并按条目各归各的图」） |
| `tests/architecture.test.ts` | **8 通过 / 0 失败** |
| 全量 `npm test` | **666 通过 / 0 失败**（详情页配图后基线 665） |
| web | `npm run build -w @girlsbands/web` 通过；`node --test apps/web/tests/*.test.ts` **29 通过 / 0 失败** |
| dev 实测 | `/api/site/pool?page=1` 40 条里 16 条带 `mode=image-336` + card 两级 `srcSet`；`/`、`/all`、`/topics/mygo` 的 SSR HTML 里缩略图分别是 20 / 64 / 36 张；主题页行首是 `h-[32px] w-[44px]`、卡片是 `h-[60px] w-[84px] lg:h-[84px] lg:w-[120px]` |
| 模型花费 | 零 |

- 档位：`packages/backend/src/publication/covers.ts` 多了 `CoverSize = "detail" | "card"` —— `detail` = `image-1200` + hero（720/1200/1600），`card` = `image-336` + card（336/720）。列表用 `card`，页面用 `detail`，读的是同一张画、同一套可见性条件。
- 一次查一批：新增 `coversOfItems(itemIds, now, size = "card")` 返回 `Map<公告 id, CoverView>`，`livesForSubject` / `releasesForSubject` 先切出会显示的那几行再一次性取图（一场演出 / 一张碟各查一次会把主题页变成几十条查询）。**只有真挑到图的条目才进 Map**，没图的条目不会拿到邻居的图。
- `ITEM_COLUMNS`（`packages/backend/src/publication/items.ts`）加上了 `a.media`，于是 `toFeedItemSummary` 也带 `cover`；`apps/web/app/features/feed/FeedItem.tsx` 在非 X 帖且有图时把标题与摘要缩进一条缩略图旁边（**没图时这一层 `div` 不带任何 class**，版式与之前逐字节一致）；X 帖仍用自己的 `x.media`。
- `apps/web/app/components/ui/CoverImage.tsx` 的尺寸与圆角改由调用方给（组件只留底色），详情页四处照旧，列表两处用小图。
- 一个真 bug：`coverOfStory` / `coverOfItems` 一度写成 `coverOfMedia(firstPicture(...))`，而 `pickPicture` 只吃 media **数组**，传单个 `Picture` 会一律返回 null（story 页封面整片消失，测试第 2 例直接红）。改成 `coverView(firstPicture(...), size)`。
- ~~还没定：OG 分享卡要不要嵌封面~~ → 站主拍板**做**，见下一节。

**OG 分享卡嵌封面（2026-10-05 完成，站主拍板「做，走受控抓取」）**

站主拍板：OG 分享卡**嵌封面**，做法取**受控抓取** —— 复用 `packages/backend/src/media/images.ts` 的 `produceImage`，它本来就是抓信源图的那条路（`guardedFetch` + 20s 超时 + 15MB 上限 + 磁盘缓存）。于是 `apps/api/src/og/hero.ts` 的「OG 渲染期不出网」从**绝对规则**收紧成**默认**：静态页卡、邮件头图、主题页、X 帖卡片仍然完全不出网，只有「有公告图的条目 / 故事 / 发售 / 日报」这四类卡片会去取一次图，取不到就退回纯文字卡。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（含 web） |
| `tests/og-cards.test.ts` | **9 通过 / 0 失败**（新文件） |
| `tests/publication.test.ts` | **19 通过 / 0 失败** |
| `tests/architecture.test.ts` | 8 通过 / 0 失败 |
| 全量 `npm test` | **675 通过 / 0 失败**（列表页配图后基线 666） |
| web | `npm run build -w @girlsbands/web` 通过；`node --test apps/web/tests/*.test.ts` **29 通过 / 0 失败**（本轮没动 web） |
| dev 实测 | `/og/items/<id>.png` 200 image/png 81–89KB（0.9–2.5s，含取图）、`/og/posters/<id>.png` 200 154KB、`/og/stories/<uuid>.png` 200 46–88KB、`/og/releases/<id>.png` 200 44–48KB；真实 1200×675 公告图在卡片里画成 390×219、海报里 569×320（整张可见） |
| 模型花费 | 零 |

- 新增的三个东西：`proxySource(path)`（`packages/backend/src/media/imgproxy.ts`）把签名代理地址里的 `u` 还原成上游地址 —— OG 手上是读者看的那个代理地址，取字节必须回到原图（直接抓代理等于自己抓自己）；`apps/api/src/og/cover.ts` 的 `ogImage(cover, size)` = `proxySource` → `produceImage(source, "image-720")` → `data:` URL，**5 秒上限**（`Promise.race`，输掉的那个 promise 自己 `.catch` 掉，否则未处理拒绝）与 4MiB 上限，任何异常/超时/过大一律返回 `null`；`OgCard.image` / `CARD_IMAGE`（390×260）与 `Poster.image` / `POSTER_IMAGE`（904×320）。
- **有图的卡片**：标题与摘要缩在左栏（标题最多 30 字、20 字以上 44 号否则 52 号；摘要 34 字），右边 390×260 的图位（圆角 20、1px 描边）；原本的圆环评分改成页脚右侧的小药丸（有图时圆环的位置让给了图）。海报头图占 904×320，标题/摘要的截断长度与字号同步收紧。**没图的卡片逐字节与之前一样**（同一棵树的另一支）。
- **图按自己的比例整张显示，不裁切**（站主第一版看到的就是裁的）：`fitInside(源尺寸, 框)` = `scale = min(框宽/源宽, 框高/源高, 1)`，尺寸由**图片自己的像素**决定（`sharp(body).metadata()`），不信公告里声明的 `width`/`height`；框本身尺寸固定，图在里面居中，所以文字栏不会被图的宽高比推来推去。上限 1 意味着小图不放大（336 档的封面就按 336×189 画）。实测三个真实条目：1200×675 的公告图 → 卡片 **390×219**、海报 **569×320**（原来是 `object-cover` 裁成 390×260 与 904×320 的一块）。
- ETag：图片内容先 sha256 成 32 字节再进指纹，否则每次算 ETag 都要哈希几百 KB base64。`OG_TEMPLATE_VERSION` → `og-2026-10-05.5`、`POSTER_TEMPLATE_VERSION` → `poster-2026-10-05.5`（模板改一次就提一次，旧磁盘缓存键自然失效）。`packages/backend/src/publication/og.ts` 的 `loadItemShare` 也补上了 `JOIN articles a` 与 `a.media`（分享图的元数据一直是从 publications 出的，这次才带图）。
- 视觉核对：项目里**没有能看图的通道** —— `read_image` 报 `model "deepseek-flash" does not declare image input`，换声明了视觉的模型（`workflow` 里指定 `gpt-5.6-luna`）也回「image input isn’t available」。所以版式改用**像素断言**核对：`tests/og-cards.test.ts` 用 sharp 造红底绿边的图（纯色块看不出裁切，**带边才看得出**），渲染后逐像素找包围盒 —— ① 3:2 的红块落在 388×258（390×260 减去 1px 描边），右、下都在内边距内，左栏没被盖住；② 400×400 的方图整张显示成 260×260、四条边条条都在、红心完整地待在绿边里；③ 1600×400 的宽图铺满 390 宽、高约 98、四条边也在；④ 海报的 1808×640 头图仍是 904×320、正文最靠下的深色像素 1256 < 1368，640×1808 的竖图缩成 113×320 并在内容宽里居中、四条边都在。**最终版式还得站主亲眼看一下**渲染出的 PNG —— dev 里 `/og/items/<id>.png`、`/og/posters/<id>.png` 直接可开。
- `tests/publication.test.ts` 里那两条 `card` / `poster` 字面量补了 `image: null`：路由现在总会带上这个键，不补的话 ETag 对不上（304 那条断言会红）。

**文案与文档校正（2026-10-05，站主选「先收尾遗留项」）**

先逐条核了挂着的四个遗留项，**三条早已完成**：docs 改名到 `RinneBeat/girlsbands` 在 W0 就做完了（`README.md:97,144`、`CONTRIBUTING.md:7`、`SECURITY.md:3,11`、三个 `.github/ISSUE_TEMPLATE/*`、`docs/deploy.md:8` 全是新地址，`AniBand` 只剩本文档记录改名的表格）；`NOTICE:13-15` 已经写的是「republishes each item in full together with a Chinese translation」，不矛盾；国内阈值标定在 W6 第二版就完成了（`industry/selection.ts:42` 的 `T2_EVENT = 54`，dev 库实测 15 条里 **14 条 `selected = t`**，样本集 acc 0.912 / P 0.97 / R 0.889）。真正没办的只有 `contactEmail`，站主选「先留着，以后再说」—— `docs/deploy.md:105` 已记「上线前必须确认这个邮箱真的能收信」。

核的过程中翻出**五处「站点早已全文 + 中译，文案还写着只给摘要」**，一并改掉：

| 位置 | 改前 | 改后 |
|---|---|---|
| `docs/architecture.md:33` | `site_fulltext`「默认只显示摘要」 | editorial 源全开（`database/migrations/0056_site_fulltext_editorial.sql`）、hot_signal 保持关闭、`syndicate_fulltext` 全站关闭 |
| `docs/customize.md:84` | 「**默认关**：只展示摘要和原文链接」 | 本站 editorial 全开；后台新建信源的表单默认关，打开前先确认来源允许整篇转载 |
| `docs/sources.md:221` | 两者「**默认都关**，只显示摘要和原文链接」 | `site_fulltext` 对 editorial 全开、`syndicate_fulltext` 全关、新建源两者默认都关 |
| `industry/site.ts:71`（读者页脚真的会渲染） | 「本站是聚合摘要和阅读索引」 | 「本站把各来源的原文整篇收进站内并译成中文」 |
| `packages/backend/src/publication/llms.ts:89`（喂 `llms.txt`） | 「内容为第三方原文的聚合摘要与编辑策展」 | 「站内把各来源的原文整篇收进来并译成中文（`site_fulltext` 对 editorial 源全开）」 |

`tests/email-rules.ts:24` 的 `SAMPLE_SITE.footerNote` 还是旧措辞 —— 那是邮件版式的测试夹具（只为给模板一段页脚文字），不是站点声明，故意不动。

验收：`npm run typecheck` 全绿；全量 `npm test` **675 通过 / 0 失败**；`node --test apps/web/tests/*.test.ts` **29 通过 / 0 失败**；`npm run build -w @girlsbands/web` 通过。零模型花费。

**W12（2026-10-05 完成）：无账号关注**

关注列表只存在浏览器（`girlsbands-follows`，不落库、无迁移），列表页的「只看关注」由**服务器**按 `?subjects=a,b` 过滤（`TimelineFilters.subjects`），`/subscribe` 拿本地关注预填一次，带该参数的页面一律 `noindex`；邮件里的管理链接改印 `/subscriptions/:token` 短链。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（含 `npm run typecheck -w @girlsbands/web`） |
| `tests/subject-filter.test.ts` | **5 通过 / 0 失败**（新文件：白名单与原型链、企划展开成整个系列、时间线/池过滤、游标只属于一份关注列表、API 取参） |
| `tests/subscriptions.test.ts` | 短链断言通过（`unsubscribeUrl` / `preferencesUrl` 的 pathname 是 `/subscriptions/<token>`，只有退订链接带 `action`） |
| 全量 `npm test` | **680 通过 / 0 失败**（复跑两次都 0 失败；上一节基线 675，新增 5 条） |
| web | `npm run build -w @girlsbands/web` 通过；`node --test apps/web/tests/*.test.ts` **37 通过 / 0 失败**（基线 29：新增 `local-state.test.ts` 关注的 5 条、`subscribe-link.test.ts` 3 条） |
| 端到端实拍 | 起 `apps/web/server.ts` + 合成 API：`/subscriptions/<32 位 token>` → 302 `/subscribe/manage?token=…`；带 `?action=unsubscribe` 时该参数跟着走，`?action=delete` 丢掉；`/subscriptions/short`、`/subscriptions/0x8f%2F..%2Fetc` → 404。`/?subjects=mygo`、`/?subjects=mygo,roselia`、`/all?subjects=mygo` → 200 且 `<meta name="robots" content="noindex">`；`/`、`/all`、`/?subjects=not-a-band`（白名单外的 id 被丢掉）无该 meta。`?subjects=roselia,mygo` 与 `?subjects=mygo,roselia` 的 `<link rel="canonical">` 是同一个（`?subjects=mygo%2Croselia`） |
| 迁移 | 无（按站主拍板取消 `0063_subscriber_kinds.sql`） |
| 模型花费 | 零 |

**W12 踩到的坑**
- **契约里加必填字段 ⇒ 网页测试里手写的 API 桩必须同步改**：`apps/web/tests/cache.test.ts:26` 的合成 `/api/site/timeline` 少了 `subjects`，而 `home.tsx` 读 `filters.subjects.length` ⇒ `/` 直接 500，两条用例挂掉（其中一条报 `TypeError: Cannot read properties of null (reading '1')`，因为 500 响应没有 `max-age`）。全仓只有这一处 timeline 桩。
- **`/all` 的 `PoolResponse.freshness` 是时间戳字符串**（页面用 `beijingTime` 渲染），端到端桩里写 `"fresh"` 会让整页 `RangeError: Invalid time value`。
- **`Object.hasOwn` 而不是 `in`**：白名单用 `in` 的话 `?subjects=constructor`、`toString` 之类的原型链属性会被当成实体放行。
- **短链只转发白名单里的 action**：`?action=delete` 这类值若原样透传到 manage 页，就等于给外部链接开了个「未知动作」入口，一律丢掉。
- 带 `subjects=` 的页面仍然是 `public` 缓存（共享缓存按完整 URL 分键，不同关注列表各存一份、不会串；地址里只有公开的乐队 id），隐私只靠 `noindex` 挡住搜索引擎。

**W13（2026-10-05 完成）：成员实体页**

88 个角色页 `/member/<id>` + 总览 `/members`：真源 `industry/members.ts`（`forms` 与翻译词表逐条一致，双向漂移测试），发布时把「哪篇提到了谁」写进投影表 `member_mentions`（迁移 `0063_member_mentions.sql`，不建成员表）；出口是 `/api/site/members`、`/api/site/members/:id`、`/og/members/<id>.png`、sitemap（只收够 5 篇的）与 22 个实体页侧栏的「角色」栏。**v1 不接关注与邮件订阅**（站主拍板）。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（contracts / backend / api / worker / tests / web 六段） |
| `tests/members.test.ts` | **6 通过 / 0 失败**（新文件：词表与名单漂移、提及边界、发布写投影、读取层、总览/侧栏/sitemap、出口与 OG） |
| 全量 `npm test` | **686 通过 / 0 失败**（93.2s；W12 基线 680，新增 6 条） |
| web | `npm run build -w @girlsbands/web` 通过；`node --test apps/web/tests/*.test.ts` **42 通过 / 0 失败**（基线 37，新增 `member.test.ts` 5 条） |
| 端到端实拍（真 API + dev 库） | `/members` 200，页面里正好 **88** 个 `/member/` 链接；`/member/nina-iseri` 200 且无 robots meta；`/member/momono-asai`（0 篇报道）200 + `noindex, follow`；`/member/nina-iseri?page=99` 与未知 id → **404**；`/topics/togenashi-togeari` 200（侧栏「角色」栏在位）；`/api/site/members` 200（3 个企划 / 19 支乐队 / 88 人，其中 **8** 个 indexable）、`/api/site/members/nina-iseri` 200（17 篇 + 分类计数 + 4 位同队）、`/og/members/nina-iseri.png` **200 image/png**；`/sitemap.xml` 里 `/members` + 8 个够 5 篇的角色页 |
| 存量回填 | `scripts/backfill-member-mentions.ts` 在 dev 库写出 **149 行提及 / 84 篇报道 / 35 个角色**（其中够 5 篇的 8 个） |
| 模型花费 | 零（词表只增不减，翻译回执按新 `GLOSSARY_VERSION` 重跑是另一件事） |

**W13 踩到的坑 / 遗留**
- **`fold` 的空白归一让多词拉丁写法贴不上边界**：`"Nina Iseri announces"` 折成 `ninaiseriannounces`，`contains` 的贴边界规则反而不命中 ⇒ 多词拉丁写法改成按词序匹配的正则（词之间允许空白），单字与含汉字的写法仍走 `contains`（`Rina` 不会命中 `Marina`）。
- **声优名一开始漏在匹配表外**：站主口径是「只提声优艺名也算这个角色的报道」，匹配写法要并上 `actor.forms`（一位声优配两个角色时两边都认，这是对的）。
- **正文只在 `body_mode='full'` 时参与匹配**（与 `pool_search` 同一条规则）：测试里用普通信源造的文章，正文点了名也不算 —— 断言要按标题写。
- **`originalTitle` 就是 `articles.title`**：「标题不再点名」的用例必须同时改 `articles.title` 与 `analyses.title_zh`，只改一个旧行不会消失。
- **sitemap 断言别写死协议**：`SITE_URL` 在测试里不是 https，用 `xml.includes("/member/<id></loc>")` 这种子串断言。
- **别名合并方向不能靠「同一人」判定**：Hello, Happy World! 的米歇尔备注写的是「奥沢美咲的演出用熊玩偶身份」，而本名页写「与米歇尔为同一人」，两行方向相反 ⇒ 生成器只认「舞台代号」前缀 + 显式的别名表。
- **担当 85/88（2026-10-05 补齐）**：`role` 只有官方写明的才有，16 支乐队的官网逐条查过，来源写在 `.data/glossary-members.tsv` 的备注列（`.data/` 不进仓库）。只剩ダイヤモンドダスト的奈奈 / 凛 / 爱 —— 官方角色页没标乐器，非官方来源不采用 ⇒ 这 3 页不显示这一行。以后重跑 `.data/build-glossary-tables.ts` 即可（生成物进仓库）。
- Canna Lily / F-272 的 10 位角色在现有语料里 **0 篇提及**（页面可达、不进 sitemap），等有报道提到自然长出内容。

**W14（2026-10-05 完成）：情报变更 Diff**

事件页首屏出「上一版 → 当前」的变更清单、时间线卡片挂 7 天内的小 ⚠️ 角标；被取消的演出从首页截止卡 / `/deadlines` / `.ics` 里消失，改期 / 延期的只按最新一次公告的日期算。快照与变更清单存在 `story_digests` 的版本行上（迁移 `0064_story_digest_facts.sql`），**`inputs_hash` 的定义一字未改** ⇒ 只改日期的那种更新零模型调用，也不会让全库事件重写综述。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（contracts / backend / api / worker / tests / web 六段） |
| `tests/change-diff.test.ts` | **6 通过 / 0 失败**（新文件；连跑三次都 0 失败 —— 第一次连跑才暴露下面第 1 个坑） |
| 全量 `npm test` | **692 通过 / 0 失败**（W13 基线 686，新增 6 条） |
| web | `npm run build -w @girlsbands/web` 通过；`node --test apps/web/tests/*.test.ts` **42 通过 / 0 失败**（契约只加了可选字段，无新增用例） |
| 零成本路径 | 只改开演日与时刻的那一版：`provider.hits()` 不变（**0 次模型调用**）、`story_digests` 多一版、`change_kinds = ["time"]` |
| 快照来源 | 手工改 `facts.subject` 不影响 diff（快照取的是 `analyses.output`） |
| 取消 / 改期 | 取消后同一故事的 `deadlineRange` 从 1 条掉到 0 条（`change_kinds = ["cancelled"]`）；改期后只留最新一篇公告的日期（`["time"]`） |
| 角标 | 7 天内出现（`change.kinds = ["time"]` + `storyPublicId` + `at`），把版本行 `created_at` 挪到 30 天前 ⇒ 角标消失 |
| 存量兼容 | `facts` / `facts_hash` 为 NULL 的旧版本行 ⇒ `changes = []`、`StoryDetail.changes = null`（不误报「全变了」） |
| 端到端实拍（真 API + 另建 `_test` 库 + `apps/web/server.ts`） | 先跑 `0064`、再造两个真事件（走真正的 `composeStoryDigest`，模型指向本地 stub）：`/story/<改期>` 200，首屏有「情报有变更」+「演出当天 2026-10-25 → 2026-10-29」+「来自哪篇报道」；`/story/<取消>` 200，同一个块用醒目配色并写「演出已取消」；`/api/site/timeline?channel=all&tag=…` 两张卡各自带 `change`（`time` / `cancelled`），网页时间线渲染出角标；`/api/site/deadlines?horizon=60` 只剩改期后的 `2026-10-29` 一条（旧日期与取消故事的行都不在了），`/deadlines` 页面与 `/calendar.ics` 的数字与它一致（`20261029` 有、旧日期与取消日期 0） |
| 模型花费 | 只改结构化字段零调用；只有「结构化一处没变、此前又有锚点」的纯文本变化才花一次措辞调用 |

**W14 踩到的坑**
- **事务里重查的快照必须与门外那次同序**：`digestReports` 本身没写 `ORDER BY`，门外那次是调用方排过 `at` 的，而事务里重查出来的 `currentReports` 没排 ⇒ `changeSnapshotHash` 的数组顺序不同 ⇒ 竞态判定永远不成立、`updated` 恒为 `false`。因为 `article_id` 是随机 UUID，排序结果时对时错，单跑一次看不出、连跑三次才稳定重现。修法：事务里也 `.sort((a, b) => a.at.getTime() - b.at.getTime())`。
- **回执按输入去重**：`paidRequest` 按 `[service, purpose, model, sha256(identity)]` 复用已完成的 receipt，identity 含 user 的 sha256 ⇒ 两件不同的事如果写成逐字相同的注意事项（连 `事件：<标题>` 都一样），第二次不发 HTTP。测试里断言「这次多了一次措辞调用」必须让两件事的输入真的不同。
- **注意事项的形状是 `{ text, quote }`**：`digestFactEvidence` 与 `changeSnapshot` 都只读 `.text`，夹具里写成 `{ added: … }` 会让快照的 `conditions` 恒为空 ⇒ `diff.text` 恒为 null ⇒ 表现成「措辞没变」（诊断时看到措辞调用数是 0）。
- **模板降级一次会列两条**：措辞模型失败时 `wordTextChanges` 把 `added` 与 `removed` 各降级成一条（`新增注意：…` / `取消注意：…`）。
- **抽取结果里没有 cast（出演者）**：`output.live` 与 `output.fact` 都没有出演者字段 ⇒ 站主要的「出演者变化」只能走自由文本那条路，别指望结构化比较。
- **角标要 `relative z-10`**：卡片标题链接带 `after:absolute after:inset-0` 覆盖整张卡片，角标不加 `relative z-10` 会被压住点不到。
- **`composeStoryDigest` 会把 `stories.title` 改成综述模型给的标题**：端到端夹具里两个事件因此都变成「标题」——按标题找库里的行会找错，要按 `public_id` 找（测试里也一样，别拿标题当断言锚点）。
- **迁移只跑在另建的 `_test` 库不算跑过**：W14 的 `0064_story_digest_facts.sql` 只应用到了端到端临时库 `aniband_w14_test`，**dev 库一直停在 `0063`**（`schema_migrations` 60 行）—— 于是本地 dev 站凡是要查库的页面全 503：`packages/backend/src/publication/deadlines.ts:50-58` 的 `deadlineWindow` 读 `sd.change_kinds`，没有这一列就整条查询失败，`/deadlines` 与 `/live/<id>` 一起倒。2026-10-05 做 W8 收尾时才踩到并补上：`node --env-file-if-exists=.env scripts/migrate.ts` → `applied 0064_story_digest_facts.sql`、`1 migration(s) applied`，补完两个页面立刻 200。**两个注意**：`scripts/migrate.ts` 必须带 `--env-file-if-exists=.env`（裸跑 `node scripts/migrate.ts` 会因没有 `DATABASE_URL` 直接崩）；以后每个带迁移的波次收尾，dev 库也要跑一次迁移，别只在临时库里验。

**W15（2026-10-05 完成）：远征参考页**

`/guide` 只做指路：外链公开的飞书社区版《现代远征攻略》与 SeatView 座位视角实拍（清单是 `industry/guides.ts` 的 `GuideResource { id, title, summary, source, href }` / `GUIDE_RESOURCES`，卡片上写清作者与许可），再给三个站内入口（截止雷达 / Live 与活动 / 日历订阅）。**本站不写攻略正文**（站主拍板：「算了不写这个了吧，看看在哪里引用那个知识库就行了」）—— 远征知识与通用赴日事项都变得慢、社区里已经有人写得更全，自己重写只会多一份过期更快的副本；站上的强项是场次与截止。**不建表、不加 API、不联动站内数据**；**原「场馆实体页」设计整体暂缓**（四条待拍板问题随它留在 §七）。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（contracts / backend / api / worker / tests / web 六段） |
| `tests/guides.test.ts` | **4 通过 / 0 失败**（重写：清单约束 / 外链不指向本站 / sitemap 只有 `/guide` / OG 页面对得上且旧篇目卡片已下线） |
| 全量 `npm test` | **696 通过 / 0 失败**（66.2s） |
| web | `npm run build -w @girlsbands/web` 通过；`node --test apps/web/tests/*.test.ts` **42 通过 / 0 失败**（跟正文一起删掉了那份 web 测试，回到基线） |
| 端到端实拍（真 API + 另建 `aniband_w15b_test` + `apps/web/server.ts`，web 端口 55373） | `/guide` **200**：飞书与 SeatView 各 1 处、2 个 `rel="noopener noreferrer"`、无 `noindex`、三个站内入口都在；`/guide/tickets` **404**（旧地址不再存在）；`/more` 有 `/guide`；`/sitemap.xml` 里 guide 只剩 **1** 行（`/guide`）；`/og/pages/guide.png` **200 `image/png`**，`guide-tickets.png` / `guide-nope.png` **404** |
| 迁移 | 无（W15 不建表） |
| 模型花费 | 零 |

**W15 踩到的坑（多是自己写五篇那一版留下的，撤掉后仍值得记）**
- **web 的 app 代码用无扩展名相对导入 ⇒ node 测试导不进去**：`apps/web/app/lib/site-copy.ts` 写的是 `import { parseCopyFile, renderMarkdown } from "./markdown";`，Node ESM 解析不了（只有 Vite 能），`node --test` 直接报 `ERR_MODULE_NOT_FOUND: .../apps/web/app/lib/markdown`。web 侧测试要 import 就走 `../app/lib/markdown.ts`（`apps/web/tests/markdown.test.ts` 的先例）；backend / industry 一律写显式 `.ts`，所以那边的测试可以直连。
- **`?raw` 只有 Vite 认**：被删掉的 `apps/web/app/features/guide/content.ts` 在 node 测试里 import 不了 ⇒ 正文类断言要放在读磁盘的测试里。
- **正文里不要写元数据表**：`parseCopyFile` 的 meta 正则抓**全文**两列表，正文里的普通表格也会被吸进 `doc.meta`；更新日期只放 `industry/guides.ts`（单一真源）。
- **改口要清零**：五篇 md + 写作管线 + `guide/:slug` 路由 + `CopyPage` 的 `back` prop + 每篇一张 OG 卡都整套删了（`CopyPage.tsx` 用 `git checkout` 回到 W14 的样子），一个入口都不能留 —— 留下的每个 `/guide/<slug>` 地址都会 404，`tests/guides.test.ts` 里专门有一条断言盯着它。

**W16（2026-10-05 完成）：Setlist 与事后档案**

散场之后的一层落在 Live 页的 `finished` 阶段：报道清单（W8 已有）、配信 / Archive 截止（走已有 `stream_end` 口径）、曲目单（有才显示）。曲目单是这一包唯一新增的东西：`0065_setlist_entries.sql` 建 `setlist_entries`（`source` 分 `article` / `reader`）并给 `live_events` 加 `setlist_scanned_at`；抽取在 `packages/backend/src/editorial/setlist.ts`（新提示词 `industry/prompts/setlist.md`，歌名必须能核回正文的 `groundedFor`），扫描与众包采纳在 `packages/backend/src/lives/setlists.ts`（worker 每小时 `lives.setlist`）。现场 repo 与官方照片只给一行外链、不抓图不聚合；歌名不进词表。**先补数据再做**：此前 9 篇事件日期已过去的 Live 类文章当初被 `isHistorical` 判成历史资料、没有页面，先把 `articles.backfill` 关掉重跑归组，才生出 8 个 story / 9 场已结束的 Live。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 全绿（contracts / backend / api / worker / tests / web 六段） |
| `tests/setlist.test.ts` | **8 通过 / 0 失败**（正例落库并按序读出 / 歌名核不到正文不落库 / 正文没有也说得出「找过」/ 未结束的演出不问 / 第二天补发的报道会再看一眼 / 报道下架后它带来的行消失 / 读者那份写成 `source='reader'` 且重复采纳幂等 / 一行一首的解析） |
| 全量 `npm test` | **704 通过 / 0 失败**（85.6s） |
| web | `npm run build -w @girlsbands/web` 通过；`node --test apps/web/tests/*.test.ts` **42 通过 / 0 失败** |
| 端到端实拍（真 API + dev 库已跑 `0065`，web 端口 61877） | 有曲目单的演出页：三首曲名 + 安可小标题 + `翻唱` / `读者补充` 标注 + `/items/<公告>` 出处链接 + `/feedback?from=` 众包入口各就位；只有报道的演出页写「问过这场演出的报道了，原文里没有写曲目单」；未结束的演出页没有这一块；事件页有「这场演出已经结束」并指向演出页；`/api/site/lives/<id>` 带出 3 条 `article` + 1 条 `reader` 与 `setlistScanned: true`；后台采纳路由未登录 **401** |
| 数据缺口 | dev 库 9 场已结束的 Live **0 篇真曲目单**（全库只有 4 篇提到「セットリスト」，都是「歌单已上架流媒体」的公告）⇒ 这一层今天空着，靠读者补与以后的散场报道长出来 |
| 迁移 | `0065_setlist_entries.sql`（dev 库已跑） |

**W16 踩到的坑**
- **结构步的模型在测试里是 DashScope 的**：`tests/setup.ts:27` 把 `STRUCTURE_MODEL` 预设成 `qwen3.8-flash`，只把 `DEEPSEEK_BASE_URL` 指向本地 stub 会抛 `Error: Model qwen3.8-flash is not configured (DASHSCOPE_BASE_URL, DASHSCOPE_API_KEY)`（`packages/backend/src/providers/llm.ts:165`）。测试里 `DASHSCOPE_BASE_URL` / `ZHIPU_BASE_URL` / `DEEPSEEK_BASE_URL` 三家都要指过去。
- **postgres.js 返回的是 `Result` 数组**：`assert.deepEqual(rows, [])` 会失败（`+ Result(0) [] - []`，原型不同），空结果要用 `assert.equal(rows.length, 0)`。
- **「下架」的杠杆是 `publications.visibility = 'withdrawn'`**：`storyReportCondition` 里没有 `p.eligible`（`packages/backend/src/publication/scope.ts:22-24`），改 `eligible = false` 不会让行消失；`listedCondition`（`:17-19`）才含 `eligible`。
- **一次扫描不够**：第一版候选条件是 `setlist_scanned_at IS NULL`，一场演出只问一次；散场当晚的报道常常还没写曲目单，第二天补发的就永远进不来。改成「没问过，或者问过之后又有新报道（`articles.discovered_at > live_events.setlist_scanned_at`）」。
- **抽取不是文章处理链上的一步**：回执的 `subject` 虽然写成 `article:<id>@<revision>`，但 `packages/backend/src/jobs/content.ts` 的 `ARTICLE_STEPS` **不要**加 `setlist_article`，否则一次模型失败会被当成文章失败去重排。
- **`grounded` 闭包原在 `normalizeStructure` 内部**（不在计划写的 `analyze.ts:174-204`）：抽成 `groundedFor(a)` 时 `normalizeStructure` 里用到的 `originals` 要跟着补回，否则 `packages/backend/src/editorial/analyze.ts(271,17): error TS2304: Cannot find name 'originals'`。

---

## 七、待站主拍板汇总（动手前先看这里）

W7–W18 一共 12 个包，其中 11 个包各有一到几处**必须由站主拍板**的地方（工程上都能做，但方向不同结果不同）。汇总如下。

### 必须先点头（不定就动不了）

| 包 | 要拍板的事 | 我的建议 |
|---|---|---|
| **W17** | 全文政策分层**推翻旧决定**：官方全文 / 第三方摘要+链接 / 许可全文，是否切换、切到哪一层 | 先按现状不动，等这一包正式开工时单独讨论 |
| **W17** | `T2_EVENT` 三个国内票务 / 展会源算哪层 | 归「官方全文」会误判，归 media 会让 W6 验过的 15 条从 `full` 掉到 `summary` —— 建议单列一层 |
| **W17** | 官方判据用 `owner_entity_id IS NOT NULL`（12 个 T1_5 官方 X 也算官方，含 5 个成员个人 X）还是 `tier = 'T1'`（`first_party` 只认 T1，见 `packages/backend/src/publication/publish.ts:294`） | 前者更准，后者更保守 |
| ~~**W12**~~ ✅ | ~~关注 → 邮件的 token 方案：**不做**读者端自生成 token（它同时是 `List-Unsubscribe` 凭据，自生成会把 `subscribers.token` 变成可猜面），改成 `/subscriptions/:token` 短链别名；「只看关注」本地过滤还是服务器筛；按类别过滤邮件（`0063_subscriber_kinds.sql` + `subscribers.kinds`）做不做~~ | **已拍板 2026-10-05**：短链别名照做；**服务器筛**（`?subjects=a,b`，本地过滤在服务端分页下每页只剩零星几条）；**不做按类别过滤** ⇒ W12 无迁移、0063 让给 W13。其余产品决定（关注只在列表页与订阅页起作用、企划 = 整个系列、开关默认关、关注列表放 `/starred` 顶部、没关注时也给引导）见 §六 W12 |
| ~~**W7**~~ ✅ | ~~`.ics` 用当地时刻（日本 18:30 / 中国 15:30）还是统一北京时间；北京时间 21:00 之后的场次在「今天截止」里算哪天~~ | **已拍板 2026-10-05**：用当地时刻 + `TZID`、按当地日历（已完成） |
| ~~**W8**~~ ✅ | ~~Live 粒度（昼/夜两场、对盘多出演者、巡演一站一实体还是巡演一实体）；已完结 Live 页要不要长期保留~~ | **已拍板 2026-10-05**：① **保持「一站一实体」** —— 昼/夜按开演时刻分成两页、对盘各乐队各一页（谁的通知挂谁的页）、巡演一站一页；要改成「巡演一实体 / 对盘一实体」只需动唯一键与 `mergeKeys`。② **已完结的 Live 页长期保留、照常收录**（页面 200、进 sitemap、企划页排在未开演之后），W16 的「事后档案」就建在这些页上。两条都不需要改代码。阶段 B 灰度重跑 2026-10-05 已跑完（`candidates: 28`、`tag live-ticket-v1`、约 170 次调用）：24 条抽到 `output.live`，但**没有新建演出、也没有轮次** —— 重跑过的条目不会再归组（21 条是历史条目、不建事实；其余走提前返回），新轮次改由回填脚本补进 `ticket_rounds`（2 条）。详见 §六 W8 |
| ~~**W9**~~ ✅ | ~~`deadlines` 与 `ticket_rounds` 哪个权威；`status` 要不要含**个人**当落；`platform` 要不要中文化~~ | **已拍板 2026-10-05**：轮次权威、`deadlines` 只是投影；不含个人当落（站不持有账号）；平台名**照原文**、不做中文显示名映射（`industry/glossary.ts` 一个字不改 —— 改任何 `forms` 都会让 `GLOSSARY_VERSION` 变、全站重译）。已落地：见上面「实现与验证（2026-10-05 完成）」 |
| ~~**W10**~~ ✅ | ~~首页 horizon 取 14 还是 30 天；「即将开售」是否包含周边开订（`merch_start`）与 CD/BD 发售日（`release_start`）~~ | **已拍板 2026-10-05**：首页 **14 天**（30 天全量留在 `/deadlines`）；「即将开售」= `sale_start` + `release_start` + `merch_start`。已落地：见 §六「W10 · 行动中心」的「实现与验证（2026-10-05 完成）」 |
| ~~**W11**~~ ✅ | ~~店铺特典真源（公告通常只写「対象店舗」）：开人工 `industry/releases/{slug}.json` 还是接受「模型只抽公告里写了的」；粒度是 1 个 `releases` + 3 个 editions 还是 3 行；存量 `other` 要不要花钱重抽~~ | **已拍板 2026-10-05**：只抽公告写了的（不开人工配置，公告只写「対象店舗」就显示这几个字）；粒度取 **1 个 `releases` + N 个 editions**；存量**重抽**。已落地：见 §六「W11 · 发售·版本·特典数据库」的「实现与验证（2026-10-05 完成）」（68 条候选 → 55 张碟 / 21 个版本 / 15 个店铺特典 / 3 个序列号；`processing_attempt_tag` 沿用上次评估的标签 ⇒ 只花 `release` 这一步的钱） |
| ~~**W13**~~ ✅ | ~~索引门槛（建议 `total >= 5`，比主题页宽松）；成员页要不要显示「中之人」真名与所属乐队（真人隐私）；成员要不要进 `/starred` 与订阅 `bands[]`~~ | **已拍板 2026-10-05**：门槛 `total >= 5`；只显示角色 ↔ 声优关系（页面写声优艺名，不查真名）；**不进 `/starred`、不进订阅 `bands[]`**（v1）。另外两条产品决定：**只做角色页、不建声优页**（声优只在角色页里出现，一位声优配多个角色就出现在多页）；**先补齐 Canna Lily / F-272 的 10 个角色再动工** ⇒ 88 页。其余（提及口径含声优艺名、别名并入本名页、不要「这位声优还配了谁」、要 `/members` 总览页）见 §六 W13 |
| ~~**W15**~~ ✅ | ~~索引门槛（建议有 `officialUrl` 或有 `live_events` 记录才进 sitemap）；要不要做「东京 11 月」地区聚合页；三条未核实规范化名；闭馆场馆要不要收录~~ | **已拍板 2026-10-05**：W15 **不做场馆实体页**，改成**远征参考页**（`/guide` 只做外链指路，**不写正文**，无迁移、无 API、不联动站内数据）。原场馆设计整体暂缓 —— 那四条问题留给以后单开的「场馆实体页」包（今天 dev 库只有 3 行 `live_events`、场馆标签只命中 3 行报道，做出来是空壳）。已落地：见 §六「W15（2026-10-05 完成）：远征参考页」 |
| **W18** | 投稿链接要不要保留原始 URL（留在库里，涉及投稿人隐私）；后台聚合视图要不要按 `from_source` 去重计数排优先级；要不要给已处理的纠错发邮件回执（需 SMTP，当前只有飞书内部通知） | 保留但只给管理员看；去重计数；先不发邮件 |

### 可以边做边定

- ~~**OG 分享卡要不要嵌封面**~~ ✅ 已拍板（2026-10-05）：**做，走受控抓取**，已落地 —— 见 §六「OG 分享卡嵌封面」。静态页卡 / 邮件头图 / 主题页 / X 帖卡片仍不出网，只有有公告图的条目、故事、发售、日报四类卡片会取一次图（5 秒上限、4MiB 上限，取不到退回纯文字）。热榜第一名的卡片本来就有图。

- ~~**W14**~~ ✅ 已定（2026-10-05）：变更清单进 v1 API（`StoryDetail.changes` + 时间线卡片 `change?: CardChange`），**不另做公开的「更正日志」出口**，**不复用** `events/corrections.ts` 的分组更正语义；**不动 `facts` 三列**（「`facts.subject/action/object` 永不更新」这个上游问题不在 W14 修，要改单独评估 —— 改了会影响现有聚簇与 digest 输入）。已落地：见 §六「W14（2026-10-05 完成）：情报变更 Diff」。
- ~~**W16**~~ ✅ 已定（2026-10-05）：曲目单**落库**（`setlist_entries`，不从正文现算，歌名核不到正文就不落）；歌名**不进** `industry/glossary`（进词表 ⇒ `GLOSSARY_VERSION` 变 ⇒ 已入库条目重译一遍），曲名照原文、不中译；众包**复用 `/feedback`** + 后台点采纳（不建第二张投稿表）；粉丝现场 repo 与官方照片只给一行外链、不抓图不聚合。已落地：见 §六「W16（2026-10-05 完成）：Setlist 与事后档案」。

- **联系邮箱**：`industry/site.ts:29` 现在填的是 `contact@girlsbands.com`。站主 2026-10-05 选「先留着，以后再说」；它同时喂 `/.well-known/security.txt`、`llms.txt` 的联系行与 RSS 的 author，**上线前必须确认这个邮箱真的能收信**（同 `docs/deploy.md:105`），否则改成一个能收的地址或置 `null`（`security.txt` 会回到 404）。

### 我已经替你定的小事（不同意就说）

- **提示词一律新增文件、不改 `industry/prompts/structure.md`**：提示词版本是内容哈希，改它 = 全部回执失效 + 已入库条目重跑结构步 + `grouping_status` 置 `pending`（`packages/backend/src/events/group.ts:237-241`）导致条目**短暂下架**。所以 W8 的 `live-ticket.md`、W11 的 `release.md`、W16 的 `setlist.md` 都是新文件。
- **公开出口只从 `packages/backend/src/publication/` 读**（`tests/architecture.test.ts:57-64` 会拦）；**日期一律走 `deadlineRange`/`deadlineMonths`**，任何包都不许在别处另算日期；`/api/site/*` 与 `/og/*` 已被 `packages/contracts/src/http-policy.ts:97`/`:106` 覆盖，**不用登记 `API_OWNED_PATTERNS`**。
- **成员与场馆都不进 `ENTITIES`**：会连带 `assets/band-logos/manifest.json` 一一对应校验、`scripts/fetch-band-logos.ts` 抓 164 个不存在的字标、主题 slug 校验全红。
- **迁移编号**（按包号顺延，谁先落地谁拿号）：W7 `0059_source_timezone.sql`、W8 `0060_live_events.sql`、W9 `0061_ticket_rounds.sql`、W11 `0062_releases.sql`、**W12 无迁移**（原定的 `0063_subscriber_kinds.sql` 已取消）、**W13 `0063_member_mentions.sql`**（已落地）、**W14 `0064_story_digest_facts.sql`**（已落地）、**W16 `0065_setlist_entries.sql`**（已落地）、W17 `0066_rights_tiers.sql`、W18 `0067_feedback_targets.sql`（W10 与 W15 不建表、无迁移）。
- **任何重跑都换 `attemptTag`**（`packages/backend/src/editorial/analyze.ts` 的回执按 prompt version + 输入哈希复用，不换 tag 会把条目翻回旧状态）。
- **不做**：账号/注册/登录、审核队列、众包直接改库、信源覆盖率与覆盖率评分（§四）。
