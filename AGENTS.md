# 给 Agent 的说明

这是一个行业热点网站的框架：采集信源、用模型筛选和写作、归组事件、出日报周报月报，并通过网站、RSS、公开 API、Agent Markdown 和 MCP 对外提供。**本仓库是少女乐队情报站「少女乐队's」（英文 girlsbands）**，`industry/` 里装的是这个行业的分类、主题、信源与提示词。先读 README，再按任务读 `docs/` 里对应的文档。

## 行业配置都在 `industry/`

站名文案（`site.ts`）、分类标签（`taxonomy.ts`）、主题（`topics.json`）、主题页大事记的规则（`chronicle.ts`）、信源（`sources.json`）、提示词（`prompts/`）、门槛（`selection.ts`）、品牌（`brand/`）、条款页（`pages/`）都在这里，通常不需要改 `apps/` 和 `packages/`。要把它改成另一个行业，按 `docs/customize.md` 的顺序做。框架里那两个只对 AI 行业有意义的可选模块（模型榜、Codex 重置监控）在本仓库已经整块删掉，连开关文件 `industry/features.ts` 一起。

这些事要问使用者本人，不要替他决定：站名；要盯哪些信源；什么消息重要、什么是噪声；分类怎么分；条款和隐私说明的内容（`industry/pages/` 是模板，上线前需要他本人确认）。

改评分标准时保留原有结构（内容类型、五个维度加权、噪声压制、安全边界），替换的是“什么算重要”“什么算噪声”的例子。门槛要用使用者标注的样本重新校准（`docs/selection.md`），不要凭感觉改数字。

## 运行与检查

- Node.js 24 直接运行 TypeScript，后端没有构建步骤。npm workspaces：`apps/*`、`packages/*`、`industry`。
- 本机运行和 Docker 见 `docs/deploy.md`。
- 改完至少跑：
  ```bash
  npm run typecheck
  DATABASE_URL=postgres://127.0.0.1:5432/<名字>_test npm test   # 名字必须以 _test 或 _ci 结尾；没有会自动建好并迁移，账号要能建库
  npm run build -w @girlsbands/web && node --test apps/web/tests/*.test.ts
  node scripts/smoke.ts --base http://localhost:3000             # 站点跑起来以后
  ```
- `tests/` 里部分测试用的是示例行业的分类、标签和公司，改了 `industry/taxonomy.ts` 后把这些例子换成新行业的对应项。

## 要守住的规则

- 前端（`apps/web`）只通过 HTTP 读 `apps/api`，数据库、模型调用和密钥只在后端。
- 所有公开出口都从 `packages/backend/src/publication/` 这一个读取层读，新增公开出口也一样。
- 主题页只给「主体」和「方向」：`packages/backend/src/publication/topics.ts` 的 `hasPage(t) = t.group !== "genre"`、`findPageTopic(slug)` —— 22 个主体（4 个企划 + 18 支乐队，来自 `ENTITIES`）和 9 个情报方向各一页；19 个内容形态只是标签，没有 URL、不进 sitemap。**企划页收整个系列**：`industry/taxonomy.ts` 的 `SERIES` 决定谁跟着谁；`seriesOf(id)` 是页面语义（只有系列 id 自己展开，乐队页不能被同系列其它乐队串进来），`seriesKeyOf(id)` 是成员反查（`parentOf` 用它）。`publication/rules.ts` 的 `entityTags` 把主题的归类标签展开成「自己 + 同系列其它主体」，标题匹配（`titlePattern`）与日历的 `subject` 都跟着走。页面有两种视图：默认精选是编辑挑的座位，`?scope=all` 是这个主题收录的全部（就是 `poolTotal` 数的那批），别把两者混起来。
- 日历与 `.ics` 和截止雷达读同一份日期：`publication/deadlines.ts` 的 `deadlineRange`/`deadlineMonths` 都吃 `subject` 与 `from`/`to`，别在别处另算一遍日期。`publication/calendar.ts` 造月历与 iCalendar（RFC 5545：转义、75 octets 折行、整天事件给次日 `DTEND`、有时刻的事件写 `DTSTART;TZID=<来源时区>` 并把用到的 `VTIMEZONE` 定义一并写进文件）；出口是 `/calendar.ics` 与 `/calendar/<slug>.ics`（`apps/api/src/routes/calendar.ts`），**路由不能写 `/calendar/:subject.ics`**（find-my-way 不支持带后缀的参数段），并且必须在 `packages/contracts/src/http-policy.ts` 的 `API_OWNED_PATTERNS` 里登记，否则 web 会把它当静态文件。**日期种类只有一个真源**：`packages/contracts/src/site.ts` 的 `DEADLINE_KINDS` —— `DeadlineKind` 类型、抽取用的 zod enum（`editorial/analyze.ts`）、雷达的过滤集合、`DEADLINE_LABELS` 都由它派生，别再在别处抄一份数组。
- 日期时刻属于公告那一地的钟：`config.timezone`（`Asia/Tokyo` 默认、`Asia/Shanghai`，值域是 `packages/contracts/src/site.ts` 的 `TIMEZONES`，读取在 `packages/backend/src/sources/timezone.ts`）。**不换算、不推算**：网页写「15:30 北京时间」、`.ics` 用 `TZID`、一天一桶也按公告自己的日历（北京时间 23:30 的场次落在当天，不挪到前一天）。时区写在信源配置里而不是从正文猜——猜错会把一个截止日悄悄挪走一小时或一天。新增国内信源必须写 `"timezone": "Asia/Shanghai"`（`scripts/seed.ts` 只插不更新，已有实例靠迁移 `0059_source_timezone.sql`）。
- 加一支乐队或一个企划要一起改四处：`industry/taxonomy.ts` 的 `ENTITIES`（`kind` 必填）与 `SERIES`（属于哪个系列才写）、`industry/topics.json` 的主题条目、`assets/band-logos/` 的字标（跑 `node scripts/fetch-band-logos.ts` 抓官方 logo；manifest 必须与 `ENTITIES` 一一对应，`tests/email-hero.test.ts` 会红）、以及需要时词表里的写法。首页与导航只列 `FRANCHISES`（一级企划）——`our-notes` 那种游戏不算，粉丝不靠它认路。
- 读者打开页面不触发模型调用；模型只在 worker 的任务里调用。
- 付费请求都经过回执（`providers/receipts.ts`）和预算熔断，不要绕开。
- 安全阀只有设成 `true` 才打开。开发时保持关闭：`COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`FEISHU_*_ENABLED`、`INDEXNOW_SUBMIT_ENABLED`。测试里推送一直关着，采集和模型调用只连本地假服务，不访问任何外部服务。
- 全文政策是站主拍的板：日文官方源太多，这个站就是为了「中文一次看全」，所以 editorial 源的 `site_fulltext` 默认全开，每一条公开的全文都翻成中文（`editorial/translate.ts` 不再按 `selected` 设门）。hot_signal 源没有公开页面，保持关闭。`syndicate_fulltext`（RSS 与公开 API 的 content 字段、把整篇再分发出去）保持全关，要开是另一个决定。中文质量靠两道人工 + 一道自动：受控词表（下一条）、后台 `/admin/review`「中文抽检」（每周抽 20 条，左右对照原文与译文，`packages/backend/src/admin/review.ts`）、以及 `operations/alerts.ts` 的 `translationFindings`。
- 国内排期类信源（同人 Only 展会与 livehouse 演出：`industry/sources.json` 的 `json-cpp-only-events`、`json-bilibili-show`、`web-showstart-events`）面对的接口都是「一条 listing URL 只接受一个查询参数」，靠 `config.urls` 扇出多条地址：**单条地址空结果不算失败**（只记 `{"url", "count": 0}`），全部为空才报 `no items matched (N urls)`，其它错误立刻整源失败。正文由列表卡片或接口字段拼成（`web_list` 的 `summarySelector` / `json_list` 的 `summaryTemplate` + `summaryIsBody: true`）。**不要给它们配 `publishedAtSelector` / `publishedAtPath`**：活动日期在未来，`content/materials.ts` 的 `decideTimeline` 会把超过 1 小时的未来「发布时间」丢掉；日期必须留在 `excerpt`/`bodyText` 里，由 `industry/prompts/structure.md` 抽成 `kind=event`（日期必须写进正文；时刻可写可不写，写了就按该来源的 `config.timezone` 显示，不会再被当成日本时间），否则进不了企划日历。`editorial/analyze.ts` 的 `grounded(quote)` 要求引文同时出现在素材与 `bodyText ?? excerpt` 里，日期没写进正文就引不到。
- 「同人 Only **活动**」不是「同人**作品**」：`industry/prompts/prefilter.md` 的 BLOCK 行与 `selection-score.md` 里对同人 Only 活动 / 展会 / 同人 Live 的豁免不能删，删了国内那三个源采回来会被当粉丝二创拦掉。
- 没有中文标题和摘要的内容上不了站，所以写作步骤没给出可用的中文 copy 时不能就这么算了：`packages/backend/src/editorial/analyze.ts` 的 `ensureCopy` 会换一个 `attemptTag`（`copy-retry`）**再问一次**，并把「上一次错在哪」写进 user 消息。**同一份输入重跑只会命中回执、不花钱也不重新问模型**，所以任何「重跑」都必须换 `attemptTag`（`requeueFailed` 也因此给每个条目发一个新 tag）。两次都没 copy 的条目标成 `processing_state = 'failed'`（`NO_COPY_ERROR`），不要留在 `analyzed` —— 那是终态，没有任何任务会再看它一眼。
- 权利方要求删除时必须当场能做到，所以下架都不用改数据库：单条走后台「公开范围」→「下架」（`packages/backend/src/admin/content.ts:90` 的 `setVisibility`，写 `editorial_overrides`，`withdrawn` 让所有公开出口 404）；整个来源走后台信源页的「整源下架」（`packages/backend/src/admin/sources.ts` 的 `withdrawSource`，把该源已发布的条目整批写成 `withdrawn`、重投影、并暂停采集）。联系入口是 `industry/site.ts` 的 `contactEmail`，读者能看到的说明在 `industry/pages/rights.md`（路由 `/rights`）。**新增任何公开出口时都要让它经过 `hasItemPage`**，否则下架会漏。
- 中文侧的专名都在 `industry/glossary.ts`（企划与乐队从 `ENTITIES` 生成，成员名、会场名分别在 `industry/glossary-members.ts`、`industry/glossary-venues.ts`）。它只做一件事：把这段原文里**真的出现过**的专名列给模型，让它在同一组写法里挑一个——**没有 `A → B` 的对照**，模型自己音译或另起名字是错的。**一组写法里第一个是本站倾向使用的写法**：站主 2026-10 拍了板，中文圈有通用名就用通用名，不管官不官方（`後藤ひとり` → `后藤一里`、`高松燈` → `高松灯`），没有通用名的照抄原文。加条目时把倾向的写法放第一个；一条写法要够特别才收：含汉字的两个字起，纯假名或拉丁的三个字起（`あい` 会命中 `あいだ`、`りん` 会命中 `りんご`、`アイ` 会命中 `アイドル`）。`GLOSSARY_VERSION` 进了 `TRANSLATE_PROMPT_VERSION`，所以改词表会让旧回执与旧译文失效 —— 这是故意的，别把它摘出去。
- 公开内容匿名，管理员和访客看到的一样；后台只允许管理员。
- 停用或替换一个功能、机制时，同一个改动删掉它的代码、测试、文档和存下的状态（库表与列、定时任务、settings、环境变量和 `.env.example` 里的项）；会删掉使用者已有数据的，在 `docs/deploy.md` 的更新说明里写明。加锁、重试、兼容旧格式、开关和兜底，先要有证据：真实部署里发生过，或平台的语义决定它会发生。
- 数据库迁移按编号加在 `database/migrations/` 末尾，已经发布的迁移不改；删表、删列也用新迁移。
- 不要提交 `.env`、密钥和 `.data/`。
- 站名和 Logo 是少女乐队's 自己的（英文 `girlsbands`）。面向读者的任何地方都不要出现别的品牌名或 Logo。

## 写代码

匹配周围代码的写法、命名和注释密度。选能清楚解决问题的简单方案，只定义正在使用的抽象。验证改动涉及的重要行为，不为简单的样式改动写测试。
