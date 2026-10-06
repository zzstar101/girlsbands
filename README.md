<h1 align="center">少女乐队's</h1>

<p align="center">
  <b>BanG Dream! · GIRLS BAND CRY · ぼっち・ざ・ろっく，中文一次看完。</b><br>
  官方源全是日文，这里把 Live、抽选、发售、周边、成员动态收成一条时间线，还有国内的邦O、刺O 同人活动。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-176b75?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Node.js-24-176b75?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 24">
  <img src="https://img.shields.io/badge/PostgreSQL-17-176b75?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL 17">
  <img src="https://img.shields.io/badge/Docker-Compose-176b75?style=flat-square&logo=docker&logoColor=white" alt="Docker Compose">
</p>

<p align="center">
  <a href="#跑起来">跑起来</a> ·
  <a href="#它是怎么工作的">它是怎么工作的</a> ·
  <a href="#配置与改造">配置与改造</a> ·
  <a href="#文档">文档</a>
</p>

<br>

## 这是什么

一个公开的情报站，只盯三个企划：**BanG Dream!**、**GIRLS BAND CRY**、**ぼっち・ざ・ろっく**。

它每天从信源里收资料，用模型筛掉噪声、写成中文，把不同来源说的同一件事聚成一个事件，每天早上出一份日报。不用注册，打开就看。

日文信息太碎：官网、官方 X、唱片公司、票务页各发各的，一场 Live 从公布到开演能拆成十几次公告。这个站存在的理由是**中文看全**——把散在几十个源里的东西收成一处，用中文讲清楚。

> 站还没上线。下面写的是改造完成后的样子，进度见 [`docs/refit-plan.md`](docs/refit-plan.md)。

## 它是怎么工作的

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/how-dark.png">
  <img src="docs/assets/how-light.png" alt="六步：采集、预筛、两次评分、写作、聚簇、热点与成刊" width="100%">
</picture>

一条资料从信源进来，先判重，再预筛；可能重要的独立打两次分，写好中文标题和摘要，和别的报道聚成事件，算进热度。分数过了门槛、又不是精选里已有新闻的重复，才进精选；日报按规则编出当天要闻，周报、月报再从日报里汇编。每一步的提示词都在 [`industry/prompts/`](industry/prompts/)，改标准不用改代码。详见 [精选与校准](docs/selection.md)。

### 中文看全

入选的外文内容整篇翻成中文再展示。乐队名、成员名、会场、票务平台、碟名照抄原文，日期价格照原文，不增删信息。术语走一份受控词表，翻错的地方重跑，不靠“看起来还行”。

### 截止雷达

公告原文里写了日期的节点（先行抽选开始、一般发售、追加席）会被单独读出来，按日本时间分桶，快到期的挑出来。**原文没写日期的不会出现**——不替官方推算。

### 聚簇与热点

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/cluster-dark.png">
  <img src="docs/assets/cluster-light.png" alt="五个来源的报道聚成一个事件，事件进入当前热点榜" width="100%">
</picture>

同一件事，官网发一篇、媒体转十篇、X 上吵一天，读者只需要看到一次。先把它们聚成一个**事件**：先用标题摘要的向量（没配向量服务时比文字重合度）在最近两周里找候选，再让模型判断是同一件事、后续进展，还是两件事；拿不准的合并，换一家模型再确认一遍。

**热度**按事件算，不按文章算：48 小时内，每个独立来源只算一次，24 小时减半。重复抓取不会多算，一家媒体发十篇也只算一次，所以排在前面的，是真正有很多人在说的事。

### 速度

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/perf-dark.png">
  <img src="docs/assets/perf-light.png" alt="线上实测：页面中位数 10 毫秒，95% 在 50 毫秒内；接口中位数 6 毫秒，95% 在 12 毫秒内；文章页 95% 在 14 毫秒内" width="100%">
</picture>

## 你会得到什么

| | |
|---|---|
| **信源** | RSS、网页列表、JSON 接口、X 账号、微信公众号，以及自己脚本推送进来的内容。日本官方源为主，国内的同人活动平台单独一套；信源分级（官方一手 / 媒体个人），抓取频率按产出自动调整 |
| **精选** | 预筛，同一份评分标准独立打两次分，再按信源分级的门槛决定入选；同一条新闻只占一条，换个说法的重复不进。提示词和门槛全部公开，全部可以改；用自己标注的样本在 SelectBench 里校准 |
| **写作** | 中文标题、答案先行的摘要、推荐理由，外文全文翻译；分类、标签和新闻事实单独抽取；防止模型把原文没提到的乐队写进标题 |
| **聚簇** | 不同来源报道的同一件事聚成一个事件，后续进展挂在同一个事件下，事件页有综述；进展和报道时间线可一起切换“最新在前”或“最早在前”；人工改过的归属不会被覆盖 |
| **热点** | 按事件算热度：独立来源越多越靠前，X 上的讨论也算进来；和 6 小时前比，涨得快的标上升，新出现的标“新” |
| **日报、周报、月报** | 每天 08:00 出日报，按规则编出当天要闻：一件事一条，报过的事只在有新进展时跟进，不调模型。每周一出周报、每月 1 日出月报，从日报里汇编，模型只写总述和栏目导读 |
| **乐队页** | 三个企划和每支乐队一个页面，带近 12 个月的横向编年史；标题摘要搜索和全文相关搜索 |
| **截止日历** | 每个企划一个月历视图，把所有带日期的内容摊在日历上，另给一份 `.ics` 订阅地址，可以导进手机日历 |
| **邮件订阅** | 按乐队订阅：抽选与先行受理截止前 48 小时提醒，每天一封精选摘要；双重确认、一键退订，四套邮件外观（号外 / 简报 / 历书 / 活版）任选，默认关闭 |
| **给 Agent 用** | RSS（精选、全部、全文、日报、周报、月报）、公开 API、MCP、Agent Markdown、`llms.txt`，同一份内容给人看也给 Agent 用 |
| **后台** | 信源管理与试抓、内容诊断、精选评测、每一步单独换模型、付费服务的预算熔断、运行记录与告警 |

## 看一眼

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/shots-dark.png">
  <img src="docs/assets/shots-light.png" alt="首页的当前热点与精选，关于页的信源河" width="100%">
</picture>

## 跑起来

需要 [Docker](https://docs.docker.com/get-docker/)，和一个 OpenAI 兼容的模型 API Key（DeepSeek、千问、智谱都可以）。

```bash
git clone https://github.com/RinneBeat/girlsbands.git
cd girlsbands
node scripts/init-env.ts --llm-key <你的模型 API Key>
docker compose up -d --build
```

打开 <http://localhost:3000>。后台在 `/admin`，管理员密码在 `.env` 的 `ADMIN_PASSWORD` 里。一两分钟后开始有内容，第一次导入的资料大约半小时处理完。

机器上没有 Node、服务器在中国大陆、要配域名和 HTTPS，见 [部署](docs/deploy.md)。

## 接进你的工具

打开 `/agent`，可以复制 Agent Markdown、MCP、RSS 或 API 的接入方式（默认打开 Agent Markdown，MCP 在 `/agent?tab=mcp`）。只支持网页读取的 Agent 从 `/api/v1/agent` 开始，那里列出精选、搜索、热点、事件、日报、周报和月报的 Markdown 地址。结构化数据用 `/api/v1/`，周报与月报在 `/api/v1/weeklies`、`/api/v1/monthlies`，追加 `/latest` 或一期的 ISO 周、月份即可读取；接口契约在 `/openapi-v1.json`。

## 配置与改造

站名、分类、信源、评分标准这些全在 [`industry/`](industry/) 这一个文件夹里，通常不需要改 `apps/` 和 `packages/`：

| 文件 | 管什么 |
|---|---|
| `site.ts` | 站名、行业词、首页文案、关于页 |
| `taxonomy.ts`、`topics.json` | 分类、标签、企划与乐队 |
| `chronicle.ts` | 乐队页“大事记”的规则 |
| `sources.json` | 首次启动时导入的信源 |
| `prompts/` | 精选标准和写作要求。**行业 KnowHow 就写在这里** |
| `selection.ts` | 入选门槛 |
| `brand/`、`pages/` | 图标、使用规则和隐私说明 |

最值得花时间的是评分标准（`prompts/selection-score.md`）和门槛：拿一两百条自己标注过的资料，用 `scripts/eval-selection.ts` 跑一遍，看它选得准不准，再回去改。怎么做写在 [精选与校准](docs/selection.md) 里。

## 文档

| 文档 | 内容 |
|---|---|
| [改造计划](docs/refit-plan.md) | 这个站要改成什么样，分几批做，每批的验收标准 |
| [配置与改造](docs/customize.md) | 站名、分类、主题与大事记、信源、提示词、门槛、品牌，一步一步来 |
| [信源](docs/sources.md) | 六种信源怎么配，分级和全文，外部推送接口 |
| [精选与校准](docs/selection.md) | 一条资料怎么变成精选、怎么编进日报周报月报，怎么用自己的样本校准 |
| [事件归组与关系评测](docs/grouping.md) | 事件关系怎么判断，怎么用自己的 pairwise gold set 评测 |
| [邮件订阅](docs/subscribe.md) | 截止提醒与精选摘要怎么发、SMTP 怎么配、四套邮件外观、退订与合规 |
| [部署](docs/deploy.md) | Docker、域名和 HTTPS、中国大陆、更新、备份、花多少钱 |
| [上线检查单](docs/launch-checklist.md) | 上线前逐项核对的单子：已经验过的、站主要拍板的、当天开开关的顺序 |
| [架构](docs/architecture.md) | 三个进程、几条不变的规则、目录、对外出口 |

技术栈：Node.js 24 · TypeScript · React Router（服务端渲染）· Fastify · PostgreSQL · pg-boss · Tailwind CSS · Docker Compose。

## 提 Issue

发现 Bug 或有明确的功能建议，[提交 Issue](https://github.com/RinneBeat/girlsbands/issues/new/choose)。准备改代码前，先看 [贡献说明](CONTRIBUTING.md)；安全漏洞请走 [私密报告入口](SECURITY.md)。

## 许可

代码使用 [MIT 许可证](LICENSE)。本站基于 AIHOT 框架改造，上游版权与商标归属见 [NOTICE](NOTICE)。字体、模型厂商和评测来源的标志各有自己的许可和商标归属，同样见 [NOTICE](NOTICE)。
