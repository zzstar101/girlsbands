# 邮件订阅

一个粉丝真正会错过的，不是“今天又发了什么”，而是**抽选什么时候截止、什么时候开卖**。所以这个站点只有两种订阅邮件，都围绕“别错过”：

| 邮件 | 什么时候发 | 里面是什么 |
|---|---|---|
| **截止提醒** | 每天 09:00 与 21:00（`email.deadline`） | 未来 14 天里你追的乐队的 Live、抽选、发售、配信节点；**只有出现 48 小时内到期的节点才真的发信** |
| **精选摘要** | 每天 20:00（`email.digest`） | 过去 24 小时内入选精选的条目，按你订阅的乐队筛过，最多 12 条 |

没有要紧事的那一天就不发。“这一轮发了 0 封”是正常结果，不是故障——空邮件比不发更伤订阅。

## 三重安全阀

和采集、模型调用一样，发信默认是关的：

1. `EMAIL_ENABLED=false`（默认）：`/api/site/subscribe` 回答“邮件订阅暂未开放”，两个定时任务直接返回原因，**连 SMTP 都不连**，也不写发送记录。这样阀门之后打开时，去重键没有被烧掉，第一封信照样发得出去。
2. `EMAIL_DRY_RUN=true`：走 nodemailer 的 json 传输，把整封信（含 MIME 结构）渲染出来但不投递。用来核对内容，也用来在没有 SMTP 的环境里跑测试。
3. `email_sends` 上的 `(subscriber_id, dedupe_key)` 唯一键：同一个收件人同一封信只会发一次。定时任务重跑、worker 中途重启都不会重复打扰读者；去重键是 `deadline:<北京日期>` 与 `digest:<北京日期>`，所以一天一封是上限。

`markStaleEmailSends()` 会把认领超过 15 分钟还没落结果的记录判为失败，让下一轮补上——读者最多多收一封，而不是永远收不到。

## 一次订阅的完整流程

```
读者填地址 → POST /api/site/subscribe → 库里一行 status=pending → 发确认信
                                                    ↓ 点确认链接
                        GET /api/site/subscribe/confirm → 302 /subscribe/confirmed?state=ok
                                                    ↓ status=confirmed
                                        定时任务开始给他发提醒和摘要
```

几条不能破的规矩，都由 `packages/backend/src/subscriptions/store.ts` 保证：

- **公开接口不泄露任何人的订阅状态。** `POST /api/site/subscribe` 对新地址和已确认的老地址回答完全一样的一句“去邮箱点确认”。否则任何人都能拿它探测某个邮箱是否在本站订阅过。
- **未经验证的请求不能改别人的设置。** 一个已确认的地址再被 POST 一次，设置原样不动、也不再发信；想改乐队只能点邮件里那条带令牌的链接。
- **乐队和企划是两种主体，不能混着叫。** `industry/taxonomy.ts` 的 `ENTITIES` 每条都带必填的 `kind`：18 条 `band`（具体的团）+ 4 条 `project`（BanG Dream! 整个系列、GIRLS BAND CRY 这部作品、Our Notes 这款新作手游——**Our Notes 是企划不是乐队**、ぼっち・ざ・ろっく 这部作品）。订阅页按 `BAND_IDS` / `PROJECT_IDS` 分成两组列出，措辞也分开（`bandCountLine` 写「2 支乐队 + 1 个企划」）；邮件头图取主体时**先乐队、后企划**，所以同时订了 BanG Dream! 和 MyGO!!!!! 的人拿到的是 MyGO!!!!! 的字标，而不是整个企划的。分类写在配置里、`kind` 必填（漏写会被类型检查拦住），不靠调用点各自猜。
- **确认是必须的，而且只能用一次。** 确认成功后 `confirm_token` 立刻轮换并清空有效期，同一封邮件里的链接点第二次无效。有效期 48 小时；过期的链接落到“链接已过期”那一页，而不是被当成无效。
- **退订在浏览器里是两步，在邮件客户端里是一键。** 页面上先看到说明再点“确认退订”，避免链接扫描器帮人退订；邮件客户端走 RFC 8058 的 `POST /api/site/subscribe/one-click`，无论令牌有效与否都回 200，不让邮件客户端弹错误框。`GET` 到那个地址不生效。
- **未确认 / 已退订 / 退信的人重新订阅，等于重新发一封确认信**，令牌轮换，旧链接立即作废。

## 数据

迁移 `0054_email_subscriptions.sql`：

| 表 | 一行是什么 |
|---|---|
| `subscribers` | 一个邮箱一行。`email_key` 是小写去空白的地址（唯一），`token` 是管理/退订令牌，`confirm_token` 是确认令牌，`status` ∈ `pending` / `confirmed` / `unsubscribed` / `bounced` |
| `subscriber_bands` | 订阅者按主体（乐队**或**企划）过滤的名单。**一行不写就是全部**，不是“什么都不订” |
| `email_sends` | 每封信一行：`kind` ∈ `confirm` / `deadline` / `digest`，`status` ∈ `pending` / `sending` / `sent` / `failed` / `skipped`，加 `attempts`、`subject`、`response` |

不重用 `notify_targets` / `deliveries`：那两张表是**按目的地**（一个飞书群一行）建的，而订阅是**按收件人**一行；去重、退订、风控的粒度都不一样，硬塞进去要给每个订阅者伪造一行 `notify_targets`。

## 邮件外观：图负责炸裂，文字只负责说清楚

邮件模板住在 `industry/email/`，和站点品牌同属行业配置层。前面做过 16 套纯文字排版（印刷排版、掲示板、票根、传单、セトリ、ジャケット……），全部被否，三次反馈指向同一件事：**纯文字再怎么排也炸裂不起来，而且越排越像网页**。所以现在的分工是：

| 文件 | id | 长什么样 |
|---|---|---|
| `styles/cover.ts` | `cover` | 「封面」：顶上通栏头图（600×225 显示，API 现画：**这支乐队的官方 logo** + 应援色底 + 一枚 220px 的鬼影日号），下面一张**栅格化大标题牌**（552×109，Dela Gothic One 108px 日文大标题 + 36px 中文小注），然后是正文——**正文只用 14/16/18/22 四级字号**，把「什么时候、什么事、去哪看」说清楚：deadline 每天一块（左边一张 64×80 的日期牌，右边当天的事件，同一天第 2 条起压一条细线）、digest 每条一块（乐队行 → 22px 标题 → 摘要 → `时刻 · 分类 · 来源` → 「读这条情报」）、confirm 一个墨色大按钮（底部 6px 品牌金硬边）。没有卡片、没有圆角、没有背景块 |

用 `EMAIL_STYLE` 选，默认 `cover`（`.env` 里写错 id 会退回默认，不会让定时任务停摆）。它满足 `industry/email/types.ts` 里同一个 `EmailStyle` 契约，只渲染这三种数据（`ConfirmData` / `DeadlineData` / `DigestData`）。加第二套外观仍然只是加一个文件 + 一行注册。

### 头图是这一版的核心装置

- **图由 API 现画**：`apps/api/src/og/hero.ts` 用 satori + sharp 画 1200×450（邮件里按 600×225 显示，2 倍图在高分屏才清），路由是 `/og/email/<token>.png`。版式照抄用户自己那版样张（`.data/event-mail-v1/build.ts`）：**官方 logo 压在应援色底上，右边一枚巨号鬼影日号**。坐标是硬的（画布 1200×450）：品牌行取 `SITE.name` 大写（现在画出来是 `少女乐队'S`）22px / 字距 3 / 基线 66；右上 `EVENT SUBSCRIPTION` 20px / 字距 2；鬼影日号 220px / 字距 -12 / 基线 292 / 不透明度 0.13；乐队名 24px / 基线 365；`LIVE / TICKET / RELEASE` 17px / 字距 3 / 基线 405 / 不透明度 0.7；右下 `10 / 04 · JST` 24px / 基线 398；细线 y332 / 不透明度 0.18；logo 框 650×215、水平 left=64、垂直中心 y203。**没有底部的信息条**（上一版那条已删），也没有「紧急」色带。
- **装饰按乐队换**（同样照抄用户原稿）：默认 16 条斜线（`opacity .07`）；Ave Mujica / Roselia 是上下括号 + 两个同心圆；トゲナシトゲアリ / RAISE A SUILEN / Afterglow 是两块斜切色块（`opacity .5`）；Pastel\*Palettes 是三个粉 / 薄荷色块。默认那套用 `graphic` 色，其余用乐队应援色；`graphic = 底子够暗 ? 应援色 : 字色`。
- **satori 不能改 SVG 子节点的属性**，所以底子那一层是先拼一段 SVG 字符串（满版 `<rect>` + 装饰）→ `sharp` 栅格化 → 再 `composite` 上缩放后的 logo → 整张转成 PNG data URI 交给 satori。文字那一层才走 satori 自己画。
- **基线换算**：satori 定位的是行盒上沿，不是基线。Noto Sans JP 的 hhea 是 1160/288，行盒 1em 时基线落在 93.6%（`BASELINE_RATIO = 0.936`），所以每个文字节点都写 `lineHeight: 1`、位置用 `topOf(基线, 字号)` 反算。实测与用户 SVG 的误差 ≤2px。
- **地址是无状态的**：token 就是那份 spec 的 base64url（`industry/email/hero.ts` 的 `encodeHero` / `decodeHero`），所以**一封已经发出去的旧信永远指向它当年那张图**，服务端不用存任何东西。spec 只有 6 个字段（`accent` / `ink` / `surface` / `star` / `date` / `logo`，token 键 `a/i/s/t/d/g`）；token 是用户可控的 URL 片段，因此解析器限长 1200、只认 6 位十六进制颜色、`date` 只放行 `YYYY-MM-DD`（其余一律空）、所有文字剥控制字符并截 60 字，坏 token 一律 404——绝不画一张半成品。
- **确认信没有日期**：`date` 是空串时**鬼影日号与右下日期两行都不画**（不是画个 00/00），头图 `alt` 也就只剩乐队名。这是「没有的数据一个都不编」在画布上的体现。
- **主角是这支乐队的官方 logo，存在仓库里**：22 个主体的字标由 `scripts/fetch-band-logos.ts` 抓**一次**入库（`assets/band-logos/<id>.png` + `manifest.json`，来源与版权说明见 `assets/band-logos/README.md`），渲染时**只读磁盘、不出网**。spec 里带的是乐队 id（`HeroSpec.logo`，只放行 `[a-z0-9-]`、≤40 字），渲染端拿它查 manifest——**查不到、文件缺了、清单被写脏了，一律退回满版应援色海报，绝不 500**。
- **底是什么颜色是量出来的，不是选出来的**：应援色**不能**直接当底（22 个里只有 4 个的墨迹能直接压在应援色上）。`plateFor()` 先查 `PLATE_OVERRIDE`（4 条：MyGO `#102b3b`、トゲナシトゲアリ `#111113`、Ave Mujica `#f0e3e8`、Pastel\*Palettes `#fff8fc`——用户自己那版里硬覆盖过的四支），没有覆盖就在**四个候选**里挑「读不清的墨迹最少」的那块：
  - 候选 = `mix(accent, 白, 0.88)`（推到亮端的同色淡底）、`mix(accent, 黑, 0.82)`（同色深底）、`#ffffff`、`#111113`；
  - 「读不清」= 加载 logo 时读一次像素、按 `alpha > 200` 的墨迹做 **64 桶**亮度直方图（用户原稿用的是 `alpha >= 180`；Our Notes 那张图有一大圈 alpha 180–200 的半透明光晕，算成墨迹会让近白 logo 反而选中白板，所以生产用 `> 200`），桶均值与底的对比度 < 3:1 的像素占比（大块图形按 WCAG 的 3:1 而不是正文的 4.5:1）；
  - **桶数不能太粗**：直方图按桶内均值判对比度，16 桶时一个横跨阈值的桶会把桶里其实看得清的高光墨迹也算成看不清——实测 Pastel\*Palettes 因此被多推暗两档；改成 64 桶后与逐像素精确值基本一致；
  - 加载不到 logo（没有直方图）就用应援色本身；`mix(accent, 白 / 黑)` 兑出来的底**色相与饱和度都留着**，所以板子上还看得出是哪支队的色；
  - 实测（`node .data/hero-plates.ts`，**19/19、EXIT=0**）：4 支走硬覆盖，其余 15 支落在「同色淡底 5 + 纯白 3 + 同色深底 4 + 近黑 3」；每一支的实际选择都落在逐像素精确最优的 2 个百分点以内（唯一例外是硬覆盖里的 Pastel\*Palettes 浅粉白板——用户自己定的，按 3:1 算它压不住那枚中间调 logo，但那是他明确写下的选择）。最差的两支（一家Dumb Rock! 41.4%、クズミミズク 31.9%）本来就是深浅两色的 logo（描边 + 填充），任何单色底都只保得住多数那一半；
  - 应援色本身在 `industry/taxonomy.ts` 的 `ENTITIES` 里，**15 条已换成官方样式表里的队色**（MyGO `#3388bb`、Ave Mujica `#881144`、Roselia `#7082cc`、Pastel\*Palettes `#0ad99b`、GIRLS BAND CRY `#f40000`…）；**改色前先核官方 CSS**，别凭感觉调。
- **每封的主角是「这一封的乐队」**：`heroOf()` 定这件事——确认信取订阅名单里**第一支乐队**（名单里只有企划就取企划），截止提醒取 48 小时内最要紧那支，精选摘要取本期出现最多的那支（并列取名字靠前的，保证同一批内容永远同一张图）；一支主体都没有就退品牌金 + 站名。**主角没有 logo 就用纯色海报，绝不拿别家乐队的 logo 充数。**
- **它仍然按来源限速**：`/og/email/:file` 60 次/分钟（`packages/backend/src/operations/abuse.ts` 的 `rateLimit`，超了 429 + `Retry-After`）。抓图改成查表之后这条路由不再出网、SSRF 面整个消失，但 satori 渲染是这台机器最贵的公开动作，所以限速留着。
- **logo 是各权利人的商标/字号**，只用于本站头图与站内展示，来源站点逐条写在 `assets/band-logos/README.md`。
- **字色靠算**：压在色面上的字（`inkOn()`）与装饰用的 `graphic` 都按对比度选，不写死亮度阈值。
- **图片默认被屏蔽**，所以这一格在任何情况下都不许闪白、不许空：`<td bgcolor="${hero.bg}">` 垫底、`<img>` 带 `alt`（= `主角｜10 / 04 · JST`）、`width` / `height` 属性写死（600×225）；连 `hero` 都没有时整格换成同色实色块 + 主角名。这三条由 `tests/email-rules.ts` 的 `[头图]` 组逐条核对。

头图的尺寸不在这两个文件里发明，统一从 `industry/email/hero.ts` 取（`HERO_W` / `HERO_H` / `HERO_CSS_W` / `HERO_CSS_H` / `HERO_PAD`）。改了画面记得同步 `apps/api/src/og/hero.ts` 的 `HERO_TEMPLATE_VERSION`——它是 ETag 与磁盘缓存的一部分，不改的话旧图会一直被命中。

### 大标题牌与日期牌：正文不能加载字体，那就画成图

用户批注写得很直接：**邮件正文不能加载外部字体**。Dela Gothic One 只存在于预览页和 API 那台机器上，同一个字体在 Gmail、Outlook、iOS 邮件里会变成三种样子。所以「炸裂」的活整个交给图，正文只留系统字体：

- **大标题牌**（`apps/api/src/og/title.ts`，路由 `/og/email/title/<kind>.png`，`kind` ∈ `deadline` / `digest` / `confirm`）：画布 1104×218、邮件里显示 552×109。第一行 Dela Gothic One 108px（`締切レーダー` / `今日のニュース` / `あと一歩。`），第二行 Noto Sans SC 700 36px（`截止提醒` / `每日精选` / `确认订阅`）。
- **日期牌**（`/og/email/date/<MM-DD>.png`）：画布 128×160、显示 64×80。第一行 Noto Sans JP 28px `10月`，第二行 Dela 68px 日号。截止提醒里每天一张。
- 两张牌的地址与尺寸由 `industry/email/title.ts` 统一给出（`titleHandle(kind, siteUrl)` / `dateHandle(date, siteUrl)`，后者对脏日期返回 `null`——邮件不能因为脏数据整封崩），`alt` 是中文全称（`截止提醒` / `10/04`），**图片被屏蔽也读得懂**。
- 缓存与限速和头图同一套：渲染的 `name` 里带模板版本与全部参数（参数变 ETag 就变）、`If-None-Match` → 304、坏参数（`title/nope.png`、`date/13-99.png`…）404、60 次/分钟限速（超了 429 + `Retry-After`）。实测：`title/deadline.png` 7327B、`date/10-04.png` 2222B，字节与本地渲染逐字节相同。
- **字库要跟着扩**：`scripts/og/build-og-jp-font.ts` 的 `displayCharset()` 收了三个日文标题、`jpCharset()` 收了 `月`（日期牌走 Noto Sans JP），重建后 dela `61168 B / 645 字形`、noto-sans-jp `715 字形`。`tests/og-fonts.test.ts` 逐条核对覆盖，并**断言日文标题每个字都由 Dela 自己画**——satori 遇到字库里没有的字不报错、只画豆腐块，回退也看不出来，所以只能这样抓。
- **用户那版样张与本版的关系**：`.data/hero-vs-user.ts` 逐像素比过同一支乐队的头图（`.data/event-mail-v1/mugendai-mewtype.png`）：87.5% 的像素完全相同、平均差 2.32、差值 >30 的只占 1.44%，且全在文字笔画上；位置误差 ≤2px、配色逐点相同。差别的原因是**用户自己的生成器把文字画在 SVG 里、走 librsvg 默认字体**，而生产走 satori + Noto Sans JP——而他声明的方案本来就是「日文正文 Noto Sans JP」。

### 排版标尺是共享的，不是各写各的

`industry/email/layout.ts` 是唯一的尺寸来源：`SPACE`（间距）、`PAD_X` / `INDENT` / `PAD_Y`（留白与缩进）、`TYPE`（字号，正文 16px、最小 14px）、`LEADING`、`WEIGHT`、`RADIUS`、`MAX_WIDTH`，以及两个颜色助手：`soften(color, 0.85)` 把乐队应援色兑成同族**淡色**（2.5D 乐队的应援色本来就是官方定义的浓淡成对，淡色正是官方拿来当区块底色的那一半；我们数据里只有浓色，所以在这里兑）、`readableOn(c, bg, fallback, min)` 在「想用队色当字色」时兜底（够对比度才用 `c`，不够就退 `fallback`，`min` 默认 4.5、大块粗体可传 3）——这两个助手这一版正文没有用到，留给下一套外观、`inkOn(bg)` 选压在色面上的字色——它把深、浅两个候选的**真实对比度**都算出来取高的那个，而不是拿一个亮度阈值猜（旧实现写的是「亮度 > 0.42 就用深字」，在亮粉这类中间色上会选错：`#ff3377` 上白字 3.50:1、深字 4.89:1，阈值法返回白字）。`tests/email-hero.test.ts` 会拿全部应援色 + 一段 RGB 网格逐色验证这条不变量。主题令牌里 `inkBody`（`#555760`）是**正文段落**那一档灰：比 `ink` 轻、比 `inkSoft` 重，摘要段用它，14px 的来源行才用 `inkSoft`。**风格文件里不许出现手写的 px 数字**——曾经就是因为每套外观各自拧数字，同一个左边界出现 24/25/26px 三种、字号出现 11–15px 七个值，肉眼一眼就看得出边距不齐。

`tests/email-rules.ts` 里是可复用的量尺 `checkStyle(style)`，它用三封固定邮件（长日文标题、空乐队、null 备注、含 48 小时内的节点）和一组恶意输入渲染，逐条核对：

- 间距 ∈ `SPACE`、字号 ∈ `TYPE` 且不小于 14px、圆角 ∈ `RADIUS`、边框宽度 ∈ `BORDER`、行高 ∈ `LEADING`、宽度不超过 600px；
- **层次**：这条 2026-10 改过。旧规则是「最大字号必须 ≥ 最小字号的 3 倍」（出处 `.data/research/jp-music.md` §3.2），但用户自己那版设计把主次**整个交给了栅格化的大标题牌**，正文只剩 14/16/18/22 四级，3 倍永远达不到。现在量三件事：最大字号 ≥ `TYPE.subhead`（18px，至少得有一级小标题）、最大 ≥ 最小 × 1.25、正文字号至少 3 个不同档。「主次由那张 108px 的标题牌承担」这件事改由 `[头图]` 组的标题牌断言保证。字体族最多 2 套；撑高用的空元素不参与；
- 每个带文字元素的**累计左边界**必须落在 `24 + n×16`（24/40/56/72）上，最多缩进三级；并列栏位（同一行里还有别的 `td`）不算缩进层级，改成从那一格自己的内容盒起算——三格色带的第二格天然落在 200px，那不是「缩进歪了」；
- 声明了列宽的 `<td>`，宽度必须是 8 的倍数（600 不能被 16 整除，三格等宽 200px 必须成立）；
- 硬约束：不出现 `<style>` / `<script>` / `<link>` / `@media` / flex / grid / `position:fixed|absolute|sticky` / 内联事件 / 外部字体 / `font:` 简写 / `javascript:`；必须有 600px 封顶；HTML 与纯文本都要含站名；纯文本不含标签且够长；不出现零宽字符；主题非空、不超 90 字、与预览行不同；
- **头图**：给 `hero` 就必须画出来——`<img>` 的 `src` 等于 `hero.src`、`alt` 里含主角、`width` / `height` 属性写死，并且那一格铺了 `hero.bg`（否则图片被屏蔽时会闪白）；头图必须是 HTML 里的**第一张**图。另外每个 `kind` 必须引用**自己那张**标题牌（`titleHandle(data.kind).src`，三封三张不许混），deadline 还必须引用每一天的日期牌（`dateHandle(day.date).src`）——牌画错或漏画，这一条就会挂；
- 转义：把 `<script>alert(1)</script>&"'` 塞进每一个读者可见字段和每一个 URL（**头图句柄也算外部数据**，它的 `src` / `alt` / `bg` / `caption` 一起过），必须全部被转义、不得放行 `javascript:`。

`tests/email-templates.test.ts` 把 `EMAIL_STYLES` 里**每一套**都过一遍量尺，所以新外观不可能再带进边距漂移。

### 加一套新外观

1. 在 `industry/email/styles/` 下新建 `xxx.ts`，只从 `../types.ts` 和 `../layout.ts` 取契约与尺寸，`export default { id: "xxx", name: "…", description: "…", render(data) { … } } satisfies EmailStyle`；
2. 在 `industry/email/registry.ts` 的 `EMAIL_STYLES` 里加一行；
3. 单独量它，改到 0 处问题：
   ```bash
   node --input-type=module -e 'import { checkStyle } from "/绝对路径/tests/email-rules.ts"; const m = await import("/绝对路径/industry/email/styles/xxx.ts"); const p = checkStyle(m.default); console.log(p.length ? p.slice(0,30).join("\n") : "OK", "\n共", p.length);'
   ```
4. 看真实数据的效果：`node --env-file=.env .data/email-preview.ts xxx` 会写 `.data/email-preview/xxx--{confirm,deadline,digest}.html`（并把头图用真渲染器画成本地 `hero-{confirm,deadline,digest}.png`，所以预览页不需要 API 在线），再 `node .data/email-gallery.ts` 生成对照页。

模板的硬约束（邮件客户端比浏览器难伺候得多）：只用行内样式、`<table role="presentation">` 布局、正文宽度 600px 封顶、不引用外部字体、不出现 `<style>` / `<link>` / `<script>` / flex / grid；所有读者可见的文字都要过 `escapeHtml`；链接只放行 `http` / `https` / `mailto`。模板都自带纯文本版本——只去标签不算纯文本，要重新排版才能读。

「48 小时内」这类**只有靠颜色才能看出**的状态是不允许的：模板都用“字形 + 加粗 + 字面文字”一起标注，灰度打印也认得出。

五个只有真机才能量出来的坑（量尺只读**声明值**，前四个它都会放行）。真机体检脚本是 `.data/email-audit.ts`：用无头 Edge 逐封量 `getBoundingClientRect`，检查页留白是否落在 24+n×16、栏内偏移、**声明列宽与渲染列宽是否一致**、有没有横向溢出。

- **`<td>` 的 `width` 是内容盒宽度**（CSS 2.1），不是边框盒。曾经一套三格色带写 `width="200"`，加上左右各 24 内边距后期望 248，三格就是 744——超过 600 后浏览器自行缩列，真机量出来是 **195.8 / 202.1 / 202.1**，肉眼可见地不等宽。改成 `width="152"`（152 + 48 = 200，三格正好 600）才严格等宽。
- **多栏报头要 `box-sizing:border-box`。** 曾经一套 240 / 360 的两栏报头各带 24 / 40 内边距，内容盒算法下合起来 664 > 600，浏览器缩成 257 / 343（三封信还不一样）。两格都加 `box-sizing:border-box` 后实测稳定 240 × 247 / 360 × 247、两格等高。代价：Outlook 桌面版（Word 引擎）可能忽略它，那里会退回按比例缩列；要连 Outlook 都精确就得把声明值改成 `216` / `320`（216 + 24 与 320 + 40 都是内容盒算法下的正确写法）。
- **一张表里只要有一行是多栏，其它单 `td` 的行就只占第一列；反过来，单 `td` 行的内容也会把多栏表的第 1 列顶宽。** 前者实测：一个模板的页脚横条只有 240px 宽而不是 600，给整宽行加 `colspan="2"`（13 处）后才回到 600。后者实测：`cover` 早先的截止提醒里 `width="8"` 的竖条格（左边距 24，期望 32；2026-10 改成看板后已没有这一格）渲染成 **122.6px**——同一张表里既有整宽行（含 600px 的头图）又有三格行，浏览器把整宽行的内容算进了第 1 列。**最稳的结构是「主表永远单栏 + 每个多格行各自嵌一层 `table-layout:fixed` 子表」**，这样任何一行的内容都影响不到别的行的列宽（`cover` 现在就是这个结构）。
- **声明值会被内容顶宽。** 曾经一套票根的序号列写 `width="56"`，里面是 44px 粗体的 `01`，最小内容宽 62.7px，列就被顶到 62.7，右列整体右移。改成 `width="64"` 才稳定。（同一个坑更早还踩过一次：历书模板的日期栏声明 48，36px 的数字顶到 51.3，改用 28px 后实测 39.9。）
- **不要用真字符拼横线。** 早先一套模板用一行 72 个 `=` / `-` 加 `white-space:nowrap` 当纸带线，等宽栈一旦回落到 CJK 字体，字宽不可控，实测 798.9px，直接把 600px 的表格整个顶破。现在横线一律是「有高度的空 div」（`height:3px;background:…`）。

所以字号、列宽、横线都要在 headless 浏览器里量一次 `getBoundingClientRect` 才算验证过。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/site/subscribe` | `{email, bands[], wantsDeadlines, wantsDigest}` → `202 {ok:true}`；来源限速 3 次/分钟；邮箱格式不对是 400，没开订阅是 503 |
| `GET` | `/api/site/subscribe/confirm?token=` | 302 到 `/subscribe/confirmed?state=ok\|expired\|invalid\|error` |
| `GET` | `/api/site/subscribe/state?token=` | 管理页读自己的状态；令牌不对是 404 |
| `POST` | `/api/site/subscribe/preferences` | `{token, bands[], wantsDeadlines, wantsDigest, unsubscribe?}` |
| `POST` | `/api/site/subscribe/one-click?token=` | RFC 8058 一键退订，恒回 200 纯文本 |

页面：`/subscribe`（订阅）、`/subscribe/confirmed`（确认结果）、`/subscribe/manage`（改偏好 / 退订）。三个页面都不进 sitemap，后两个是 `noindex`。

公开接口的请求日志不记 query string（`apps/api/src/app.ts` 里 `disableRequestLogging: true`），所以令牌不会落进访问日志。

## 运维要看什么

- 后台“运行”页：`email.deadline`、`email.digest` 每一轮的结果（发了多少、失败多少、多少人是“这次没内容”）。
- `SELECT status, count(*) FROM subscribers GROUP BY status;` 看订阅规模。
- `SELECT kind, status, count(*) FROM email_sends GROUP BY 1, 2;` 看投递健康度。`failed` 的 `response` 里是 SMTP 的报错摘要（截断 500 字符，不存完整地址）。
- 退信目前只记录不自动处理：`bounced` 是留给后续接投递商回调的座位，暂时没有代码会写进去。
