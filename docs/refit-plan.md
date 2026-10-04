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

> ⚠️ 关键细节：`apps/web/app/routes/topic.tsx:86` 写的是 `const band = tracksAsSubject(topic.group) ? subjectOfId(topic.slug) : null;`，`:131` 是 `tracksAsSubject(topic.group) ? <ChronicleBand …/> : <ChronicleRail …/>`。也就是说 **`/topic/:slug` 这个路由身兼两职：普通主题渲染时间轴，主体渲染乐队页**。所以"隐藏主题页"只能隐藏 `/topics` 列表和普通主题分支，`ENTITIES` 里那 19 个主体（3 企划 + 16 支乐队）的页面必须留着。

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

- **三种页面，一条规则**：`packages/backend/src/publication/topics.ts` 的 `hasPage(t) = t.group !== "genre"`、`findPageTopic(slug)`。20 个主体（4 企划 + 16 支乐队）+ 9 个方向 = 29 个页面；19 个内容形态只剩标签，没有 URL、不进站点地图。
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
7. ❌ **原稿这条是错的，已作废（2026-10-05 查证）：不用统一到 JST。** `packages/backend/src/publication/deadlines.ts:5-7` 的头注释早就写明并论证了这个分工：「`at` is Japan wall-clock, the date the announcement itself gives, so the window, the day buckets and the 48-hour flag are all computed in JST rather than in the Beijing calendar the rest of the site uses. A deadline that closes at 23:59 JST is a thing the reader must act on that day, and converting it to another calendar would move it to the day before.」实现自洽（`JST_OFFSET_MS` / `jstDate` / `jstInstant` / `upcomingDeadlines` 全在 JST 内闭环）。全站其余部分用北京时间也是刻意的：`apps/worker/src/schedules.ts:1,72` 的 cron 跑在 `Asia/Shanghai`、`packages/backend/src/reports/compose.ts:1` 的窗口用 `beijingDate`/`beijingMidnight`、`packages/backend/src/editorial/analyze.ts:74` 与 `writing.ts:286` 的日期锚点也是 `Asia/Shanghai`。**截止日期来自日本公告 → 用公告自己的日历；日报的「今天」是读者的日子 → 用读者的日历。两者各自都对，统一到 JST 反而会让中文读者的日报对不上自己的日子。**

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
4. **接进企划日历**：这三个源产出的都是**带明确日期的活动**，是 W1-3 企划日历和 `.ics` 导出最主要的素材。CPP 的 `enterTime`/`endTime`、B站的 `start_time`/`end_time`、秀动的演出时间统一落成 `kind=event` 的日期条目（`industry/prompts/structure.md` 已加对应规则）。**只抽日期、不抽时刻**：`publication/deadlines.ts:38` 的 `jstInstant(at)` 把带时刻的 `at` 当 JST，而这三个源的时刻是北京时间，只取日期才能原样往返。
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

## 四、明确不做

- 账号、注册、登录（用户明确否掉）
- 审核队列 / 全量人工审核（保持自动发布）
- 编年史入口、普通主题页、话题页
- ICP 备案、Cloudflare China Network、大陆本地节点
- 优选 IP（**已死**：Cloudflare 2026-08 起 Error 1034；阿里云 ESA 2026-01 起 CNAME 校验拦截。任何还在教这个的教程都过时了）

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
4. 日报/周报/月报的"今天"改成 JST 之后，历史期号（`packages/contracts/src/site.ts:508` 的期号日历）会不会错位，需要回归测试。
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
- **`structure.md` 写了「只写日期不写时刻」，模型仍会写时刻**：秀动那条抽出的是 `{"at":"2026-10-11T15:30","kind":"event"}`。`publication/deadlines.ts:38` 的 `jstInstant` 按 JST 解释，15:30 这种下午场没事，但**北京时间 23:00 之后开演的场次会被推成次日**。要彻底消掉得让结构步骤按来源地区选时区，现在没做。
- **关阀门要等积压跑完**：worker 拿不到模型时条目会按 `RETRY_MINUTES` 阶梯重试，整条阶梯走完（约 14 小时）才落 `failed`；中途关掉会把剩下的积压条目一路耗到终态，之后只能从后台「重试」救回来。
- **单文件跑测试必须带 preload，否则会污染模板库**：`node --test tests/x.test.ts`（不带 `--import ./tests/databases.ts`）会直接写进 `DATABASE_URL` 指向的模板库 `girlsbands_test` —— 而模板库是所有测试文件克隆的来源（`tests/databases.ts:62-65`）。留下 2 条 `test-analyze-*` 源和 13 篇文章之后，之后的**全量**运行里 `tests/backend-read-load.test.ts`（断言 `sources` 恰好 2 条）、`tests/grouping-reliability.test.ts`、`tests/processing-recovery.test.ts` 会无端变红（实测 4 条失败、单跑也红），排查半天才发现与代码无关。正确写法：`node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test --test-timeout=120000 tests/x.test.ts`。模板库脏了就洗一遍：`DROP DATABASE girlsbands_test WITH (FORCE)` → `CREATE DATABASE girlsbands_test OWNER aniband` → `DATABASE_URL=postgres://…/girlsbands_test node scripts/migrate.ts`；**干净模板里 `sources`/`articles`/`receipts` 都必须是 0，只有迁移自己插的 9 条 `budgets`**。

**订正**
- 本文档 W2-1 原写「`scripts/seed.ts` 是 upsert，改完跑一次 seed 即可」→ 错，是 `ON CONFLICT (id) DO NOTHING`，必须加迁移。
- 本文档 W3 原写「`grep '下架'` 零命中，只能手改数据库」→ 错，单条下架机制一直在 `packages/backend/src/admin/content.ts:90` 的 `setVisibility`。

