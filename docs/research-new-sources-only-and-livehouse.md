# 新增信源调研：同人 ONLY 活动 + 小型 livehouse 排期

调研方式：curl / web_fetch 实际抓取 + 仓库源码核对。**凡是标「未验证」的都没有抓到，不要当可用源用。**

环境说明：本次会话走本地 HTTP 代理（`http_proxy=http://127.0.0.1:7897`）。少数域名在本机 DNS 解析失败（curl exit 35 `SSL_ERROR_SYSCALL`），属**本环境未验证**，不代表站点不可用，已单独标注。

---

## 一、结论先行

### 1. 三部作品的同人 ONLY 活动有稳定情报源吗？

**有，但只有一个：同人イベントNAVI（shimeken.com），且它只覆盖实体即売会。**

- 运营方是株式会社シメケン（同人印刷所），全国同人イベント检索站，**按作品有独立 URL**，实测三个企划都有条目，条目直接链到主办方官网。
- 空气 only 平台 pictSQUARE：搜索功能正常（对照「忍たま」→79KB 有结果、「オリジナル」→191KB 有结果），但三个企划**当前全部 0 件**（页面返回「該当のイベントは見つかりませんでした」）。所以 pictSQUARE 是「偶尔有」，不是稳定源。
- 主办方官网（puniket.com / lovefes.info）是官方，但都是 Shift_JIS 老式表格页，只在办新活动时更新（puniket 的 GBC 页停在 2025/11）。
- **X 账号：只有 3 个稳定活跃的账号，且都是主办方/运营方级别，不是单个活动级别。没有找到任何单个 ONLY 活动的独立账号。**

| handle | 名称 | nitter RSS 实测活跃度 | 性质 |
|---|---|---|---|
| `@GLFes` | ラブフェス事務局⚜️ | 20 条，2026-09-21 〜 2026-10-03 | 官方（运营 GBC ONLY「全部ぶちこめ。」+ BanG Dream ONLY「CIRCLE Space Meeting」+ D4DJ ONLY「groovy 4 link」） |
| `@puniket` | ぷにケット | 20 条，2026-09-16 〜 2026-10-01 | 官方（运营 ぼざろ ONLY「結束ロック！」） |
| `@shimeken` | 株式会社シメケン | 21 条，2026-07-20 〜 2026-09-29 | 半官方（同人イベントNAVI 运营方） |

反例（说明「猜 handle」不可靠，必须实测）：
- `@kessoku_rock` → 是同名个人「dust」，2026-06-09 后停更
- `@bocchi_only` → 「名無しのぼっち」，停更于 2017-01
- `@bocchi_zakku` / `@bocchizabook` / `@bocchi_zabook` / `@bz_book` / `@only_event_info` / `@doujin_event_info` / `@event_only_navi` → 无 feed（不存在）

**结论：不需要一个个追 X 账号。** 主源用 shimeken 的作品页，X 侧只补 `@GLFes` / `@puniket` / `@shimeken` 三个即可。

### 2. web_list 形态够不够？

- **实体 ONLY + livehouse 排期：够。** Shift_JIS 不是问题——`packages/backend/src/lib/http-fetch.ts:138-155` 的 `decodeBody` 会先读 Content-Type 的 `charset=`，没有再从前 2048 字节读 `<meta charset=>`，然后用 `TextDecoder` 解码。
- **必须新写/扩展采集器的只有一处：pictSQUARE。** 活动 URL 只存在于 `<div class="card" data-action="/7rzj31jie4nvri12t3u3517jntguq9tt">` 的 `data-action` 属性里，**没有 `<a href>`**；而 `packages/backend/src/sources/web-list.ts:180` 是 `const url = absolute(linkEl.attr("href"), base)`，只读 `href`。
  - 替代方案（优先级从高到低）：① 给 web_list 加一个 `linkAttribute`（如 `"data-action"`）+ `linkUrlTemplate`（拼 `https://pictsquare.net/events{value}`）——改动很小，但仍是改采集器；② 先不做 pictSQUARE，因为三个企划当前命中 0 件；③ 只在 shimeken 的作品页里间接获得空气 only 信息。
- **TwiPla 检索抓不了**：真实搜索是 `<form action="/search" method="post">` + CSRF token，`GET /events/search?keyword=` 只返回默认最新事件列表（与关键词无关）。单个活动页 `https://twipla.jp/events/708035` 可以 GET，但不构成检索源。
- **零改动技巧（推荐采用）**：`publishedAtRegex` 能从条目内嵌的 ld+json 里捞出年份。shimeken 的日期文本只有「11/8 (日)」没有年份，但同一条目里有 `"startDate":"2026/11/08"`，而 `parseLooseDate`（`packages/backend/src/sources/web-list.ts:27-46`）认 `2026/11/08` 格式。注意 `jsonLdPublished`（同文件 49 行起）**只认 `datePublished`，不认 `startDate`**，所以必须走 `publishedAtRegex` 而不是自动 JSON-LD 提取。

### 3. 必须先解决的跨部门问题（否则新源白采）

`industry/prompts/prefilter.md:10` 目前把「粉丝二创、同人作品与应援图」列为 BLOCK；`industry/prompts/selection-score.md:81` 给同人作品 `sig ≤ 3`。
**加了这些源以后，同人 ONLY 活动的公告很可能被这两条规则按「同人」拦掉。** 需要在这两处显式豁免「同人即売会 / ONLY 活动 / プチオンリー 的举办、日期、场地、票务、参加方法」这类**活动情报**（它讲的是活动，不是作品），否则新增的源会白采。这正是本次任务的原始目的（现有预筛把同人列为 BLOCK，这次要把同人 ONLY 活动放进来）。

---

## 二、推荐清单 A：同人 ONLY 活动情报

### A1. `web-shimeken-only-gbc` — 同人イベントNAVI「ガールズバンドクライ」

| 项 | 值 |
|---|---|
| URL | `https://shimeken.com/events/schedule/%E3%82%AC%E3%83%BC%E3%83%AB%E3%82%BA%E3%83%90%E3%83%B3%E3%83%89%E3%82%AF%E3%83%A9%E3%82%A4` |
| 源形态 | `web_list` |
| CSS 选择器 | `itemSelector: "div.event"` / `linkSelector: "div.name a"` / `titleSelector: "div.name a"` / `publishedAtSelector: "div.date"` / `publishedAtRegex: "\"startDate\":\"(\\d{4}/\\d{2}/\\d{2})\""` / `publishedAtUtcOffset: "+09:00"` |
| 条目结构（实测 HTML） | `<div class="event nov"><div class="date">11<i>/</i>8 (日)</div><div class="prefecture"><a href="/events/schedule/東京都">東京都</a></div><div class="description" itemprop="description"><a href="…">ぼっち・ざ・ろっく！</a></div><div class="name"><a href="https://www.puniket.com/bocchi/" rel="nofollow">結束ロック！１７</a></div><script type="application/ld+json">{"@type":"PublicationEvent","name":"結束ロック！１７","sameAs":"https://www.puniket.com/bocchi/","startDate":"2026/11/08","endDate":"2026/11/08",…}</script></div>` → 标题在 `div.name a`，链接在同一个 `a` 的 href，日期**文本**只有「11/8 (日)」无年份，年份在 ld+json |
| 更新频率 | 极低。每企划一年 1〜3 条；实测当前 GBC 全 1 件。建议 `interval_minutes: 1440` |
| 性质 | 聚合站（株式会社シメケン运营，同人印刷所，有编辑） |
| 覆盖企划 | GIRLS BAND CRY |
| 可信度 | **中**（有编辑的长期运营聚合站，条目直接外链主办方官网） |
| 实测 | ✅ HTTP 200，UTF-8，有结构化条目。页面 title：`【ガールズバンドクライ】同人誌即売会スケジュール｜1～1／全1件`。当前条目：11/22 大阪府「全部ぶちこめ。#10」→ `https://www.lovefes.info/gbcry.htm`。无反爬、无 JS 依赖 |

### A2. `web-shimeken-only-bocchi` — 同人イベントNAVI「ぼっち・ざ・ろっく」

| 项 | 值 |
|---|---|
| URL | `https://shimeken.com/events/schedule/%E3%81%BC%E3%81%A3%E3%81%A1%E3%83%BB%E3%81%96%E3%83%BB%E3%82%8D%E3%81%A3%E3%81%8F` |
| 源形态 | `web_list`（选择器同 A1） |
| 更新频率 | 极低，实测当前全 2 件。建议 `interval_minutes: 1440` |
| 性质 | 聚合站 |
| 覆盖企划 | ぼっち・ざ・ろっく |
| 可信度 | **中** |
| 实测 | ✅ HTTP 200。当前条目：11/8 東京都「結束ロック！１７」→ `https://www.puniket.com/bocchi/`；11/22 大阪府「ぼっち・ざ・ぶっく！#13」 |

**⚠️ 拼写变体陷阱（实测）**：同人イベントNAVI 把带感叹号和不带感叹号当作**两个不同作品**：
- `https://shimeken.com/events/schedule/ぼっち・ざ・ろっく` → 全 2 件
- `https://shimeken.com/events/history/2026/ぼっち・ざ・ろっく` → 全 12 件（2026 年历史）
- `https://shimeken.com/events/history/2026/ぼっち・ざ・ろっく！` → 全 7 件（另一个页面）
所以 **A2 需要同时配 2 条源**（`…ろっく` 与 `…ろっく！`），否则会漏一半。

### A3. `web-shimeken-only-bandori` — 同人イベントNAVI「バンドリ」

| 项 | 值 |
|---|---|
| URL | `https://shimeken.com/events/schedule/%E3%83%90%E3%83%B3%E3%83%89%E3%83%AA` |
| 源形态 | `web_list`（选择器同 A1） |
| 更新频率 | 极低，实测当前全 1 件。建议 `interval_minutes: 1440` |
| 性质 | 聚合站 |
| 覆盖企划 | BanG Dream! |
| 可信度 | **中** |
| 实测 | ✅ HTTP 200。当前条目：11/22 大阪府「BanG Dream! CIRCLE Space Meeting 16th」 |

### A4. `web-puniket-bocchi` — ぷにケット「結束ロック！」（ぼざろ ONLY 主办方官网）

| 项 | 值 |
|---|---|
| URL | `https://www.puniket.com/bocchi/` |
| 源形态 | `web_list`，但**结构不适合**：老式 `<table>` 拼版，没有干净的重复列表项 → **需要实测**（未提取到可用选择器，不编） |
| 更新频率 | 每次办活动前更新一次（约一年 1 次） |
| 性质 | **官方**（主办方自建站） |
| 覆盖企划 | ぼっち・ざ・ろっく |
| 可信度 | **高** |
| 实测 | ✅ HTTP 200，5177 bytes，**Shift_JIS**（meta charset=Shift_JIS），仓库能正确解码。内容：「ぼっち・ざ・ろっく！オンリーイベント 結束ロック！17」2026/11/8(日) 11:30-15:30 大田区産業プラザPiO；票务 `https://livepocket.jp/e/sdb1_`；サークル締切 2026/10/14；子页 `event_2026_1108.html`、`circle_2026_1108.html`、`ol_2026_1108.html`。twitter share 的 `data-via="puniket"` |

**替代方案**：A1/A2 的 shimeken 条目已经外链到这个站，可以只把它当「详情页/票务页」，不单独配列表源。

### A5. `web-puniket-gbc` — ぷにケット「栞を立ててあげる！」（GBC ONLY）

| 项 | 值 |
|---|---|
| URL | `https://www.puniket.com/gbc/` |
| 源形态 | `web_list`，**同样需要实测**（与 A4 同模板） |
| 更新频率 | **已停更**：最后活动是 2025/11/9（约一年未更新） |
| 性质 | 官方（主办方自建站） |
| 覆盖企划 | GIRLS BAND CRY |
| 可信度 | **高**（但当前无新内容） |
| 实测 | ✅ HTTP 200，4690 bytes，Shift_JIS。内容：「ガールズバンドクライ オンリーイベント 栞を立ててあげる！6」2025/11/9 |

**建议**：低优先级。留作「该主办方是否复活 GBC ONLY」的信号。

### A6. `web-lovefes-gbc` — Girls Love Festival「全部ぶちこめ。」（GBC ONLY 主办方官网）

| 项 | 值 |
|---|---|
| URL | `https://www.lovefes.info/gbcry.htm` |
| 源形态 | `web_list`，页面是长文＋更新履歴，**没有干净的重复列表项 → 需要实测**（不编选择器） |
| 更新频率 | 每次办活动前更新（约一年 1〜2 次）。页内有带日期的更新履歴（如「26/08/28」） |
| 性质 | **官方**（主办方自建站，公式 X `@GLFes`） |
| 覆盖企划 | GIRLS BAND CRY |
| 可信度 | **高** |
| 实测 | ✅ HTTP 200，25413 bytes，**Shift_JIS**。内容：全部ぶちこめ。#10 2026/11/22(日) 大阪 本町 産業創造館4F；#9 2026/9/23 東京都立産業貿易センター浜松町館；#3 2025/1/13 |

### A7. `web-lovefes-bandori` — Girls Love Festival「CIRCLE Space Meeting」（BanG Dream! ONLY）

| 项 | 值 |
|---|---|
| URL | `https://www.lovefes.info/com.htm` |
| 源形态 | `web_list`，**需要实测**（与 A6 同模板） |
| 更新频率 | 约一年 1〜2 次 |
| 性质 | **官方** |
| 覆盖企划 | BanG Dream!（同页还有 D4DJ ONLY「groovy 4 link」→ 会带入非名单内容，建议在 tag 或预筛里处理） |
| 可信度 | **高** |
| 实测 | ✅ HTTP 200，11399 bytes，Shift_JIS |

### A8. `web-akaboo-bocchi-only` — 赤ブーブー通信社「ぼっち・ざ・ろっく！」ジャンル页

| 项 | 值 |
|---|---|
| URL | `https://akaboo.jp/event/item/sa345.html` |
| 源形态 | `web_list` **不可用** —— 活动列表是 **JS 渲染**，HTML 里只有「ぼっち・ざ・ろっく！ 検索結果」标题和空容器 → **需要新采集器（浏览器渲染）或放弃** |
| 更新频率 | 随 COMIC CITY 举办（一年数次） |
| 性质 | **官方**（赤ブーブー通信社＝COMIC CITY 主办方） |
| 覆盖企划 | ぼっち・ざ・ろっく（在「青ブーブー通信社（男性向）」分类下） |
| 可信度 | **高**（作为官方信息），但**抓不到** |
| 实测 | ✅ HTTP 200，162106 bytes，Shift_JIS。**但**：① 该页列的是 **Akaboo 自家办的 プチオンリー**，只有 ぼっち 一个企划（页面里 `ガールズバンド` 0 次、`Dream` 0 次、`MyGO` 0 次、`Roselia` 0 次）；② 条目区是 JS 填充 |

**重要负面结论**：Akaboo 的 ONLY 作品下拉列表（在 `https://www.akaboo.jp/event/item/sma_list.html` 里）**只包含「ぼっち・ざ・ろっく！」，没有 BanG Dream!、没有 GIRLS BAND CRY**。也就是说 Akaboo 体系对本次两个企划没有覆盖。

### A9. pictSQUARE（空气 only）— 需要新采集器

| 项 | 值 |
|---|---|
| URL（检索） | `https://pictsquare.net/users/index?keyword=%E3%82%AC%E3%83%BC%E3%83%AB%E3%82%BA%E3%83%90%E3%83%B3%E3%83%89%E3%82%AF%E3%83%A9%E3%82%A4`（表单实测为 `<form method="get" action="/users/index">` + `<input name="keyword">`，**不需要 CSRF**） |
| 源形态 | **需要新采集器**：条目 URL 只在 `data-action` 属性里 |
| 条目结构（实测） | `<div class="col-sm-12 col-md-4 col-lg-4"><div class="card href" data-action="/7rzj31jie4nvri12t3u3517jntguq9tt"><img class="card-img-top lazyload" data-src="…"><div class="card-body"><div class="card-text clearfix"><div class="float-left"><small><span style="font-weight:bold;">2027年09月18日 22:00〜09月19日 21:50 </span></small></div></div><div class="float-right"><div class="bg-success text-white"><small>&nbsp;受付中&nbsp;</small></div></div><h5 class="card-title">みんなニコニコ２</h5><p class="card-text"><span href="/users/index?tag=ニコニコRPG" class="badge badge-pill badge-secondary">ニコニコRPG</span>…` |
| 日期 | 在 `div.card-text small span` 文本里，**带年份**（`2027年09月18日`），`parseLooseDate` 能解析 |
| 链接 | 只在 `data-action`，**没有 `<a href>`** → web_list 抓不到 |
| 更新频率 | 平台每天有新活动，但**三个企划当前 0 件** |
| 性质 | 半官方（空气 only 平台运营方） |
| 覆盖企划 | 不特定（需按关键词） |
| 可信度 | **中**（平台方数据，但事件由主办方自行登记） |
| 实测 | ✅ HTTP 200，UTF-8，服务端渲染。**关键词命中数（实测）**：ガールズバンドクライ 0、ぼっち・ざ・ろっく 0、バンドリ 0、BanG Dream 0、トゲナシトゲアリ 0、結束バンド 0、ガールズバンド 0。对照：忍たま → 79349 bytes 有结果、オリジナル → 191455 bytes 有结果、ぼっち → 39463 bytes（1 条无关的ニコニコRPG）。页面提示「シークレットイベントは、このページに掲載されていません」 |

**建议**：**先不配**。等有了命中再考虑加 `linkAttribute` 支持。硬要配就是给 `packages/backend/src/sources/web-list.ts:180` 加一个 `linkAttribute` 配置项。

---

## 三、推荐清单 B：小型 livehouse / 対バン 排期

### B1. `web-eventernote-gbc` / `-bocchi` / `-bandori` — イベンターノート（**本次最大发现**）

| 项 | 值 |
|---|---|
| URL | `https://www.eventernote.com/events/search?keyword=%E3%82%AC%E3%83%BC%E3%83%AB%E3%82%BA%E3%83%90%E3%83%B3%E3%83%89%E3%82%AF%E3%83%A9%E3%82%A4&limit=30` |
| 源形态 | `web_list`（**服务端渲染，实测可用**） |
| CSS 选择器（**实测确认**） | `itemSelector: "div.gb_event_list > ul > li"` / `linkSelector: "div.event h4 a"` / `titleSelector: "div.event h4 a"` / `publishedAtSelector: "div.date p.day0"` / `publishedAtUtcOffset: "+09:00"` |
| 条目结构（实测 HTML） | `<div class="gb_event_list clearfix"><ul><li class="clearfix "><div class="date"><p class="day0">2026-11-03 (<span class="wday0">火</span>)</p><p><img …></p></div><div class="event"><h4><a href="/events/477180">ガールズバンドクライ Special LIVE “赤色の響祭”</a></h4><div class="place">会場: <a href="/places/11340">ぴあアリーナMM</a></div><div class="place"><span class="s">開場 17:00 開演 18:00 終演 21:00</p></div><div class="actor"><ul><li>出演者:</li><li><a href="/actors/…">トゲナシトゲアリ</a></li>…` |
| 日期 | `div.date p.day0` 文本为 `2026-11-03 (火)`，**带年份** → `parseLooseDate` 直接可用（`/^\d{4}-\d{2}-\d{2}$/` 分支） |
| 更新频率 | 聚合站，每天都有新条目。建议 `interval_minutes: 360`〜`720` |
| 性质 | 聚合站（声優/アイドル/アーティスト的イベント・ライブ情報） |
| 覆盖企划 | 跨企划（按关键词分源） |
| 可信度 | **中**（有编辑的长期运营聚合站；条目有出演者/会場/開演時間，信息密度高） |
| 实测 | ✅ HTTP 200，utf-8，**服务端渲染**（jQuery 1.7.1 + bootstrap，无 JS 依赖）。**关键词命中数（实测）**：ガールズバンドクライ **90 件**、ぼっち・ざ・ろっく **347 件**、バンドリ **452 件**、トゲナシトゲアリ **93 件**、結束バンド **80 件**、MyGO **194 件**。首条实测：`2026-11-03 (火) ガールズバンドクライ Special LIVE “赤色の響祭” 会場: ぴあアリーナMM 開場 17:00 開演 18:00 終演 21:00 出演者: トゲナシトゲアリ ダイヤモンドダスト 理名 夕莉 朱李 近藤玲奈 松岡美里 漆山ゆうき 宮白桃子 …`。有分页（`&page=N`，每页 30 条）与排序参数 |

**注意**：命中数偏高是因为它同时匹配出演者名（如「結束バンド」会匹配到声优个人活动）。这是**好事**（能捞到対バン/小场），但需要靠预筛去噪。

### B2. `web-shibuya-schedule` — 渋谷 WWW / WWW X / O-nest / O-west 等（一页覆盖多馆）

| 项 | 值 |
|---|---|
| URL | `https://www-shibuya.jp/schedule/` |
| 源形态 | `web_list` |
| CSS 选择器（**实测确认**） | `itemSelector: "article.column"` / `linkSelector: "a.pageLink"` / `titleSelector: "h3.title"` / `publishedAtSelector: "div.date p.day"` / `publishedAtUtcOffset: "+09:00"` |
| 条目结构（实测 HTML） | `<article class="column Thu " data-place="www" event-id="event_019823"><div class="inner"><a href="https://www-shibuya.jp/schedule/019823.php" class="pageLink"><div class="date"><p class="day">01</p><p class="week">Thu</p></div><div class="info"><h3 class="title"><span>Chalca</span></h3><p class="exp"><span>BLOODLINE TOUR</span></p><p class="openstart"><span>OPEN / START</span> <span>18:20 / 19:00</span></p></div><div class="placeLabel"><a href="#"><span>WWW</span></a></div></a></div></article>` |
| 日期 | `div.date p.day` 文本**只有日号**「01」，没有年月 → `publishedAt` 会为空，时间线回落 `discovered_at`（与现有 3 个场馆源同一已知限制） |
| 更新频率 | 实测一页 52 条 → 约每天 1〜2 条新条目。建议 `interval_minutes: 720` |
| 性质 | **官方**（场馆运营方官网） |
| 覆盖企划 | 不特定（対バン/企画ライブ为主，偶有アニソン系） |
| 可信度 | **高** |
| 实测 | ✅ HTTP 200，UTF-8，84973 bytes，52 个 `article.column` 条目。无反爬、无 JS 依赖 |

### B3. `web-clubque-schedule` — 下北沢 CLUB Que

| 项 | 值 |
|---|---|
| URL | `https://clubque.net/schedule/` |
| 源形态 | `web_list` |
| CSS 选择器（**实测确认**） | `itemSelector: "div.schedule-list__list article"` / `linkSelector: "a"` / `titleSelector: "div.text"` / `publishedAtSelector: "div.date p b"` / `publishedAtUtcOffset: "+09:00"` |
| 条目结构（实测 HTML） | `<div class="schedule-list__list"><article id="entry20261002"><a href="https://clubque.net/schedule/16807/"><div class="date fri"><p><b>02</b><span>Fri</span></p></div><div class="text"><p>“PAINT IT RED 2026 ”</p><h2 class="l">MODERN DOLLZ｜おくさきなおみ(Live Painting)｜THE BARIUM PILLZ</h2></div></a></article>` |
| 日期 | `div.date p b` 只有日号；月份在页面 `<h1>2026/10</h1>`（不在条目内）→ `publishedAt` 为空。前后月链接形如 `/schedule/date/2026/11` |
| 更新频率 | 月列表约 20〜30 条 → 每天约 1 条。建议 `interval_minutes: 720` |
| 性质 | **官方**（场馆官网） |
| 覆盖企划 | 不特定 |
| 可信度 | **高** |
| 实测 | ✅ HTTP 200，UTF-8，50923 bytes。**注意域名**：旧域名 `www.clubque.com/schedule/` 是 JS 混淆跳转（反爬），正确域名是 `clubque.net` |

### B4. `web-reg-r2-schedule` — 下北沢レッグ（**日期带年份，publishedAt 可用**）

| 项 | 值 |
|---|---|
| URL | `https://www.reg-r2.com/schedule/`（月份参数 `?ym=2026-11`） |
| 源形态 | `web_list` |
| CSS 选择器（**实测确认**） | `itemSelector: "tr.pickup"` / `linkSelector: "p.pick_title"`（或 `p.reserve a`）/ `titleSelector: "p.pick_title"` / `publishedAtSelector: "p.pick_date"` / `publishedAtUtcOffset: "+09:00"` |
| 条目结构（实测 HTML） | `<table class="pickupPage"><tr class="pickup"><td class="pick_ditails"><p class="pick_date">2026年10月01日<span class="date_weekday">(木)</span></p><p class="pick_title">VOICE OF DEMAND vol.2</p><p class="pick_title_subtitle"></p><p class="pick_performer">[出演]…</p><p class="pick_price">前売り￥2,500-…</p><p class="pick_time">OPEN 17:30/ START 18:00</p><p class="reserve"><a href="https://giggs.eggs.mu/vpBZl8s">…</a></p>` |
| 日期 | **`p.pick_date` 带年份「2026年10月01日」→ publishedAt 可直接解析**（本批场馆源里最好的一条） |
| 更新频率 | 月度列表，约 30〜60 条/月 → 每天 1〜2 条。建议 `interval_minutes: 720` |
| 性质 | **官方**（场馆官网） |
| 覆盖企划 | 不特定 |
| 可信度 | **高** |
| 实测 | ✅ HTTP 200，UTF-8，148363 bytes |

### B5. `web-marz-schedule` — 新宿 MARZ

| 项 | 值 |
|---|---|
| URL | `https://www.marz.jp/events?date=2026%2F10`（**注意 `/schedule/` 是 404**，月份参数是 `?date=YYYY%2FMM`） |
| 源形态 | `web_list` |
| CSS 选择器（**实测确认**） | `itemSelector: "div.blog-entry.event-wrap"` / `linkSelector: "h2 a"` / `titleSelector: "h2 a"` / `publishedAtSelector: "div.date"` / `publishedAtUtcOffset: "+09:00"` |
| 条目结构（实测 HTML） | `<div class="blog-entry event-wrap row" event-date="2026-10-01"><div class="col-sm-4 col-xs-12"><div class="blog-img"><a href="/events/43661"><div class="image-bg" style='background-image: url("…")'></div></a></div></div><div class="col-sm-8 col-xs-12 event-info"><div class="desc"><div class="flex-child-group"><div class="date"><span class="month">10 /</span><span class="day">01</span><span class="week ">木</span></div></div>…<h2><a href="/events/43661">ベンジャス！定期公演『宣誓』その２</a></h2>…<p class="act"><span>ベンジャス！</span></p><p class="time">OPEN 19:40 / START 20:00</p>` |
| 日期 | `div.date` 文本只有「10 /01木」；**完整 ISO 日期在容器的 `event-date="2026-10-01"` 属性里，web_list 读不到** → publishedAt 为空（除非用 `publishedAtRegex: 'event-date="(\\d{4}-\\d{2}-\\d{2})"'`，可行） |
| 更新频率 | 月度列表，约 30〜50 条/月。建议 `interval_minutes: 720` |
| 性质 | **官方**（场馆官网） |
| 覆盖企划 | 不特定 |
| 可信度 | **高** |
| 实测 | ✅ HTTP 200，utf-8，380142 bytes（页面较大） |

### B6. `web-loft-shelter-schedule` — 下北沢 SHELTER

| 项 | 值 |
|---|---|
| URL | `https://www.loft-prj.co.jp/schedule/shelter` |
| 源形态 | `web_list`，与现有源 `web-loft-shinjuku-schedule`（`https://www.loft-prj.co.jp/schedule/loft`）**同一平台同一模板** |
| CSS 选择器 | 现有源用的是 `itemSelector: "#schedule_list .list > .column"` / `linkSelector: "a"` / `titleSelector: ".c_title"` / `publishedAtSelector: "time"` —— **/shelter 页需按同一模板复核（需要实测）**，不要直接照抄 |
| 更新频率 | 每天约 1〜2 条。建议 `interval_minutes: 720` |
| 性质 | **官方**（场馆运营方） |
| 覆盖企划 | 不特定 |
| 可信度 | **高** |
| 实测 | ✅ HTTP 200，UTF-8，106914 bytes，124 个链接。选择器**未逐项复核** |

### B7. `web-lamama-schedule` — 渋谷 La.mama

| 项 | 值 |
|---|---|
| URL | `https://www.lamama.net/schedule/`（月份参数 `?month=2026-11`） |
| 源形态 | `web_list` |
| CSS 选择器（**实测确认**） | `itemSelector: "a.pickup_btn.schedule"` / `linkSelector: "a.pickup_btn.schedule"`（item 自身即 a）/ `titleSelector: "div.detail_cont"` / `publishedAtSelector: "div.date_cont"` / `publishedAtUtcOffset: "+09:00"` |
| 条目结构（实测 HTML） | `<a href="https://www.lamama.net/article/s-20261005-n/" class="pickup_btn schedule" data-schedule="2026-10-05"><div class="text_cont"><div class="date_cont"><span class="month">10/</span><span class="day">05</span><span class="date mon">MON</span></div><div class="detail_cont">…` |
| 日期 | `div.date_cont` 文本只有「10/05MON」；**完整 ISO 在 `data-schedule="2026-10-05"` 属性里，读不到** → publishedAt 为空（可用 `publishedAtRegex: 'data-schedule="(\\d{4}-\\d{2}-\\d{2})"'` 绕过） |
| 更新频率 | 月度，每天约 1 条。建议 `interval_minutes: 720` |
| 性质 | **官方**（场馆官网） |
| 覆盖企划 | 不特定 |
| 可信度 | **高** |
| 实测 | ✅ HTTP 200，utf-8，69237 bytes |

### B8. `json-eplus-gbc` / `-bocchi` / `-bandori` — イープラス 公演検索（**复用现有 json_list 形态，零改动**）

| 项 | 值 |
|---|---|
| URL | `https://eplus.jp/sf/search?keyword=%E3%82%AC%E3%83%BC%E3%83%AB%E3%82%BA%E3%83%90%E3%83%B3%E3%83%89%E3%82%AF%E3%83%A9%E3%82%A4` |
| 源形态 | `json_list`，**完全复用现有源 `json-eplus-togetoge-search` 的配置**（`mode: "html_json_key"` / `jsonKey: "record_list"` / `titlePaths: ["kanren_kogyo_sub.kogyo_name_1"]` / `summaryPaths: ["koenbi_hyoji_mongon","kanren_venue.venue_name"]` / `urlTemplate: "https://eplus.jp{raw:koen_detail_url_pc}"`），只改 keyword |
| 数据结构（实测） | 页面内嵌 `<script id="json" class="json" type="application/json">{"data":{"so_kensu":N,"record_list":[…]},"error":null}</script>` |
| 更新频率 | 每天有变动。建议 `interval_minutes: 360` |
| 性质 | **官方**（票务平台） |
| 覆盖企划 | 按关键词 |
| 可信度 | **高** |
| 实测 | ✅ HTTP 200，UTF-8。**`so_kensu` 实测**：トゲナシトゲアリ 2（広島グリーンアリーナ 12/5-12/6）、ガールズバンドクライ 2（同上）、結束バンド 1（`SHELTER 35th Anniversary Finale ”ZeppがSHELTERになります” DAY1` @ Zepp Diver City）、バンドリ 30（Roselia / BanG Dream! 13th☆LIVE @ 東京ガーデンシアター）、**ぼっち・ざ・ろっく 0**。注意关键词匹配偏松（「バンドリ」会捞到无关公演如高中正義）→ 需预筛去噪 |

---

## 四、排除项（看起来像情报源，实际不可用）

| 站点 / URL | 实测结果 | 排除理由 |
|---|---|---|
| `https://www.melonbooks.co.jp/event/` | **HTTP 403 Forbidden**（1756 bytes） | 反爬。メロンブックス EVENT 页不可抓 |
| とらのあな WEBオンリー `https://event.toranoana.jp/web-only/` | 302 → `https://news.toranoana.jp/334722`，页面标题「【とらのあなWEBオンリー】サービス終了のお知らせ」 | **服务已终止**：サービス終了日 2026年5月29日（金）。不是情报源了 |
| `https://www.onlyplaza.akaboo.jp/link/public/` | **curl exit 60：SSL certificate has expired** | **不可达**。Akaboo プチオンリー開催リスト因此完全不可用 |
| `https://www.akaboo.jp/ONLYPLAZA/onlylist.html` | HTTP 200，8299 bytes，但内容**停在 2025 年**（最后 2025/05/18） | 停更 |
| `https://www.akaboo.jp/event/item/sma_list.html` | HTTP 200，Shift_JIS，84342 bytes | 是 **COMIC CITY 系列全一覧**（约 30 场，纯日期+会场），且**三个企划全部不在里面**（`バンドリ` 0 次、`ガールズバンド` 0 次、`Dream` 0 次、`MyGO` 0 次）。无可用条目结构 |
| `https://akaboo.jp/event/item/sa345.html` | HTTP 200，162106 bytes，Shift_JIS | 官方但**列表是 JS 渲染**，HTML 里只有空容器 → web_list 抓不到 |
| `https://twipla.jp/events/search?keyword=…` | HTTP 200，但返回默认最新事件列表，与关键词无关 | 真实搜索是 `<form action="/search" method="post">` + CSRF（`data[Event][keyword]`、`data[_Token][key]`）→ **GET 抓不了，需要新采集器**。单事件页可 GET 但不构成检索源 |
| `https://www.livefans.jp/` 与 `/venues/963` | 首页 **HTTP 403**（520 bytes）；venue 页 HTTP 200 但 HTML 里没有 `/events/\d+` 链接，类名只有 appBanner/midBox QABox/relTab | 首页反爬；venue 页列表疑似 JS 加载 → **需要实测/不可用** |
| `https://livepocket.jp/` 与 `/search?keyword=…` | 首页 **HTTP 202 + 空 body**；搜索页 HTTP 202 返回 **AWS WAF challenge**（`window.awsWafCookie…`） | **AWS WAF 反爬**，不可用。（puniket 的票务链接指向 livepocket.jp，但只作为外链出现，不影响采集） |
| `https://l-tike.com/`（ローソンチケット） | curl 失败：`HTTP/2 stream 1 was not closed cleanly`、`LibreSSL SSL_read: bad decrypt`；`--http1.1` 仍 exit 0/0 bytes | **本环境不可达/未验证**。需另测 |
| `https://t.pia.jp/pia/search_all.do?kw=…`（チケットぴあ） | HTTP 200，UTF-8，74712 bytes，**能抓**，但**四个关键词全部 0 件**：ガールズバンドクライ / バンドリ / ぼっち・ざ・ろっく / 結束バンド / トゲナシトゲアリ 均返回「に一致するチケットは見つかりませんでした」 | 技术上可用，**内容上无价值**。不要收录 |
| `http://www.cyclone1997.com/schedule/`（渋谷 CYCLONE） | **HTTP 403 Forbidden**（iso-8859-1，239 bytes） | 反爬 |
| `https://www.livewalker.com/` 与 `/feed` | 站点是 **Vue 3 SPA**（`vue.global.prod.js`，链接用 `'/web/list/' + selectedTypeId + '/1'` 拼），`/schedule/` = 404；`/feed` HTTP 200 `application/rss+xml` 20 条，但条目是**会場（场馆）页面的新着**（例：「有明セントラルタワー ホール＆カンファレンス（ビジネス・会議室）」） | SPA 抓不到；RSS 内容**不是演出排期** → 不适合 |
| `https://www.clubque.com/schedule/` | HTTP 200 但是 JS 混淆跳转（"Redirecting... Loading . . ."） | 反爬。**正确域名是 `clubque.net`** |
| `https://nonchilipepper.hatenablog.com/entry/2023/08/29/203658` | 2023 年的「ぼざろ同人オンリーイベントまとめ」粉丝博客 | **粉丝自发 + 3 年未更新** → 不作为源 |
| `https://posfie.com/@…` | X 账号聚合（搜索时反复出现） | 第三方转述聚合，不是活动一手信息 → 不作为源 |
| `https://www.antiknock.net/`（新宿 ANTIKNOCK） | HTTP 200，UTF-8，77290 bytes，但无 schedule/table 类结构，疑似图片/JS 排期 | **需要实测**（未确认可用，先不收录） |
| `https://starlounge.jp/schedule-2/`（渋谷 Star lounge） | HTTP 200，UTF-8，41581 bytes，结构是博客式 `div.post-title-wrapper` / `div.post-title`（10 篇） | **需要实测**（未确认条目是否即演出） |
| `https://toos.co.jp/basementbar/`（下北沢 BASEMENTBAR） | HTTP 200，但只是 WordPress 首页轮播，无排期列表 | **需要找子页**（未完成） |
| `https://www.livefans.jp/venues/963`（高円寺 CLUB MISSION'S） | 见上 | JS 加载 |
| `www.kouenji-high.com`、`club-missions.com`、`chop-ikebukuro.com`、`shimokitazawa-reg.com`、`shimokitazawa-garden.com`、`shinjuku-samurai.com`、`adm-ikebukuro.com`、`shimokitazawa-basementbar.com` | curl exit 35 `SSL_ERROR_SYSCALL`（DNS 解析失败） | **本环境未验证**。这些多半是我猜的域名，正确域名需再查 |

---

## 五、三个必答问题

### Q1. 这三部作品的同人 ONLY 活动到底有没有稳定的情报源？

**有，但只有一个稳定的：同人イベントNAVI（shimeken.com）。** 它按作品有独立 URL，实测三个企划都有条目，条目外链到主办方官网，Shift_JIS/UTF-8 都能抓，无反爬。

**空气 only 侧没有稳定源**：pictSQUARE 搜索功能正常（对照关键词有结果），但三个企划**当前全部 0 件**。平台的空气 only 是「主办方自己登记才有」，冷门企划常年为 0。

**主办方官网是官方但更新稀疏**：`puniket.com/bocchi`（2026/11/8 结束ロック！17）、`puniket.com/gbc`（停在 2025/11/9）、`lovefes.info/gbcry.htm`（2026/11/22 全部ぶちこめ。#10）、`lovefes.info/com.htm`（BanG Dream! CIRCLE Space Meeting）。这些适合当「详情/票务」补充，不适合当列表源。

**X 账号：不需要一个个追，只有 3 个值得追，且都不是单个活动账号**（nitter RSS 实测活跃度）：

| handle | 名称 | 活跃度证据（nitter RSS） | 覆盖 |
|---|---|---|---|
| `@GLFes` | ラブフェス事務局⚜️ | 20 条，2026-09-21 〜 2026-10-03（约 2 周 20 条，**活跃**） | GBC ONLY「全部ぶちこめ。」、BanG Dream! ONLY「CIRCLE Space Meeting」、D4DJ ONLY |
| `@puniket` | ぷにケット | 20 条，2026-09-16 〜 2026-10-01（**活跃**） | ぼざろ ONLY「結束ロック！」 |
| `@shimeken` | 株式会社シメケン | 21 条，2026-07-20 〜 2026-09-29（**活跃**） | 同人イベントNAVI 运营方 |

**没有找到任何单个 ONLY 活动的独立账号。** 猜测的 handle 全部证伪：`@kessoku_rock` 是同名个人（2026-06-09 后停更）、`@bocchi_only` 停更于 2017-01、`@bocchi_zakku`/`@bocchizabook`/`@bocchi_zabook`/`@bz_book`/`@only_event_info`/`@doujin_event_info`/`@event_only_navi` 均不存在（无 feed）。

### Q2. `web_list` 形态能不能覆盖这两类？

**绝大部分能，只有一处必须动采集器。**

- ✅ **实体同人 ONLY**（shimeken 作品页）：`web_list` 完全够。选择器实测确认。
- ✅ **livehouse 排期**（www-shibuya / clubque / reg-r2 / marz / lamama / loft-shelter）：`web_list` 够。**Shift_JIS 不是障碍** —— `packages/backend/src/lib/http-fetch.ts:138-155` 会从 Content-Type 或前 2048 字节的 `<meta charset>` 取编码，再用 `TextDecoder` 解码。
- ✅ **票务检索**：e+ 已有 `json_list`（`html_json_key`）形态，加关键词即可，零改动。
- ❌ **pictSQUARE 空气 only 必须新写/扩展采集器**：条目 URL 只在 `<div class="card" data-action="/7rzj…">` 属性里，没有 `<a href>`；而 `packages/backend/src/sources/web-list.ts:180` 只读 `linkEl.attr("href")`。最小改动是给 web_list 加 `linkAttribute`（+ 可选 `linkUrlTemplate`）。**但当前三个企划命中 0 件，建议先不配。**
- ❌ **TwiPla 检索必须 POST + CSRF**，GET 抓不了；不建议为此写采集器。
- ✅ **一个零改动的补丁技巧**：日期没年份时用 `publishedAtRegex` 从条目内嵌的 ld+json / 属性里捞年份。shimeken 条目里有 `"startDate":"2026/11/08"`，配 `publishedAtRegex: "\"startDate\":\"(\\d{4}/\\d{2}/\\d{2})\""` 即可；`parseLooseDate`（`web-list.ts:27-46`）认这个格式。注意 `jsonLdPublished`（`web-list.ts:49` 起）**只认 `datePublished` 不认 `startDate`**，所以必须走 `publishedAtRegex`。同理 marz 的 `event-date="2026-10-01"`、lamama 的 `data-schedule="2026-10-05"` 也能这样救回来。

### Q3. 哪些站点看起来像情报源但实际不可用？

（详见「四、排除项」表，按不可用原因归类）

- **反爬 / WAF**：メロンブックス `melonbooks.co.jp/event/`（403）、LivePocket `livepocket.jp`（AWS WAF challenge，202+空 body）、LiveFans `livefans.jp`（403）、渋谷 CYCLONE `cyclone1997.com/schedule/`（403）、旧域名 `clubque.com`（JS 混淆跳转）
- **服务终止 / 停更**：とらのあな WEBオンリー（**2026/5/29 服务终止**）、`onlyplaza.akaboo.jp`（**SSL 证书过期，不可达**）、`akaboo.jp/ONLYPLAZA/onlylist.html`（停在 2025/05）、`puniket.com/gbc`（停在 2025/11）、2023 年的 hatena 粉丝博客
- **技术形态不匹配**：TwiPla 检索（POST+CSRF）、livewalker（Vue SPA，且其 RSS 是场馆新着不是演出）、pictSQUARE（链接在 `data-action` 属性）、Akaboo ジャンル页 `sa345.html`（JS 渲染）
- **能抓但无内容**：チケットぴあ `search_all.do`（五个关键词全部 0 件）、`akaboo.jp/event/item/sma_list.html`（三个企划都不在）
- **本环境未验证（不等于不可用）**：`l-tike.com`（TLS 失败）、`www.kouenji-high.com` 等 8 个猜测域名（DNS 解析失败）

**关于 affiliate / SEO 内容农场**：本次调研**没有**抓到典型的「XX 实测/深度测评」型 affiliate 农场。中文侧的同人活动情报站（如「同人展情报」类）未纳入本次实测范围。需要警惕的是 `posfie.com`（X 账号聚合）和粉丝博客这类**第三方转述**——它们不是一手活动信息，一律不作为源。

---

## 六、建议的落地顺序

1. **先改预筛**（`industry/prompts/prefilter.md:10` + `industry/prompts/selection-score.md:81`）：豁免「同人即売会 / ONLY 活动 / プチオンリー 的举办、日期、场地、票务、参加方法」。否则新源全被 BLOCK。
2. **加 4 条 shimeken 源**（A1、A2 的两个拼写变体、A3）——成本最低、直接命中本次目标。
3. **加 3〜4 条 eventernote 源**（B1，按 GBC / ぼざろ / バンドリ / トゲナシトゲアリ）——覆盖最广，含大量小型対バン。
4. **加 e+ 关键词源**（B8，纯改 URL）——零成本。
5. **加 livehouse 源**（B2 www-shibuya 优先，其次 B3 clubque、B4 reg-r2、B5 marz、B7 lamama）。
6. **暂不做**：pictSQUARE（0 命中 + 需要改采集器）、TwiPla、LivePocket、LiveFans、Akaboo ジャンル页。
7. **补测**：loft /shelter 选择器、starlounge、antiknock、basementbar 子页、l-tike。
