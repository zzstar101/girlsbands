# 上线检查单

[部署](deploy.md) 讲怎么装，这份单子讲「什么算装好了」。第一节是已经在本地验过的（命令都写着，可以自己重跑一遍），第二节是只有站主本人能定的事，第三节是真正上线那天按顺序要做的事。

最后更新：2026-10-06（对应提交 `c64eee3` 之后）。

## 一、已经在本地验过

在一台 2026-10-06 的工作副本上从零跑过一遍，结果如下。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `npm run typecheck` | 0 错 |
| 全量测试 | `PATH=/opt/homebrew/opt/libpq/bin:$PATH DATABASE_URL=postgres://…/aniband_test npm test` | 718 tests / 718 pass / 0 fail（113 秒） |
| 前端构建 | `npm run build -w @girlsbands/web` | 成功 |
| 前端测试 | `node --test apps/web/tests/*.test.ts` | 42 / 42 |
| 空库迁移 | 空库上 `node scripts/migrate.ts` | 64 个迁移全部 applied |
| 空库种子 | 同一个空库上 `node scripts/seed.ts` | 110 个信源 |
| 冷构建镜像 | `docker compose build` | 成功（只有一次构建，见下） |
| 从零卷起站 | `docker compose up -d --build` | 1 分 39 秒起完：`db` healthy → `setup` 退出码 0 → `api` healthy → `web` / `worker` |
| 冒烟 | `node scripts/smoke.ts --base http://localhost:3000` | 34 项全过 |

> `pg_dump` 不在 PATH 时，`tests/backup.test.ts` 和 `tests/backup-files.test.ts` 会有 4 条因 `spawn pg_dump ENOENT` 失败。这是本机环境问题，不是代码问题；`brew install libpq` 后把 `/opt/homebrew/opt/libpq/bin` 加进 PATH 即可。生产镜像里装了 `postgresql-client`，没有这个问题。

这个版本里修掉的、会让上线直接失败的问题：

- **全新机器上 `docker compose up -d --build` 必然失败**。`setup`、`api`、`worker`、`web` 四个服务过去都从同一个构建上下文构建同一个 `image: girlsbands-app`，Compose 并发导出同一个 tag，报 `image "…girlsbands-app:latest": already exists`。现在只有 `setup` 声明 `build`（`docker-compose.yml`），并加了注释说明原因。
- **全新库上 `setup` 会崩，导致 `api`/`worker` 永远起不来**。`industry/sources.json` 里 `json-cpp-only-events` 用了 `_girlsbands.fanPlatform`，而 `packages/backend/src/sources/config-keys.ts` 的白名单没有这个键，`scripts/seed.ts` 抛 `UnsupportedConfig`。已补白名单，并在 `tests/architecture.test.ts` 加了一条测试，逐个核对 `industry/sources.json` 里每个信源的 config 键都被它的 kind 实现——以后再漂移会在测试里红。
- **`web` 会在 `api` 开始监听之前就绪**，第一次打开页面可能 502。`api` 现在有 healthcheck（打 `/api/health`，它会 `SELECT 1`），`web` 等它 healthy。
- **本机开发密钥会被生产接受**。`packages/backend/src/config.ts` 的占位密钥正则认不出 `dev-` 前缀，把本机 `.env` 复制到服务器会用公开可猜的会话密钥启动。已把 `dev-*` 加进拒绝列表。

## 二、站主本人要先定的事

1. **已经发出的日报、周报里，被下架的条目保留一条划掉的引文**：标题还在，摘要和原文链接不再发出（`packages/backend/src/publication/reports.ts` 的 `citationFrom`，网页端 `apps/web/app/features/report/ReportPaper.tsx` 也是照这个画的）。条目自己的页面、API、RSS、MCP、日历、搜索索引都会当场移除，只有「过去某一期提到过它」这一处例外。后台的公开范围弹窗已经把这句话写清楚了。
   - 要连标题也去掉，得让 `citationFrom` 在没有剩余可用候选时把 `title` 也置空。**这是对外可见的产品决定，没有替站主改。**
2. **HTTPS 由谁终结**：`docker compose --profile https` 是 Caddy 自己占 80/443 并向 Let's Encrypt 申请证书；前面有 CDN 时用 `CADDY_HTTP_PORT` / `CADDY_HTTPS_PORT` 收进高位端口，并且必须由前面那层把所有流量（含 `/.well-known/acme-challenge/`）转发回来，否则 Caddy 一直申请失败。`docs/refit-plan.md` §三 W4 设想的「CDN 终结 TLS + Caddy 只监听 18080」还没落到 `deploy/Caddyfile` 里，两个拓扑选一个。
3. **备案号**：填了大陆主机就要填 `industry/site.ts` 的 `icp`（现在是 `null`），改的是代码，要重新构建。
4. 其余待定项（8 个 `hot_signal` 信源要不要改成 `editorial` 拿正文、`syndicate_fulltext` 是否保持全关、中文阈值 `T2_EVENT = 54` 采满一个月后重标重跑）见 [改造计划](refit-plan.md) §五。

## 三、上线当天按这个顺序做

### 1. 起站，先不开开关

```bash
git clone https://github.com/zzstar101/girlsbands.git myband && cd myband
bun scripts/init-env.ts --llm-key <模型 API Key>     # 机器上没有 Bun 时见 deploy.md 第 15 行
```

`init-env.ts` 会把管理员密码、会话密钥、图片代理密钥、数据库密码都随机生成好（打印一次，自己存起来），并且把**所有对外开关写成 `false`**——包括抓取、模型调用、飞书推送、IndexNow、邮件。这一步之后站点是安静的，不会自己去抓信源，也不会花钱。

然后改 `.env` 里的 `SITE_URL`（`docs/deploy.md` 第 15–21 行）：忘了改会把 `localhost` 写进 canonical、sitemap 和 RSS。

```bash
docker compose up -d --build
```

### 2. 确认站点是好的

```bash
docker compose ps -a                                  # db/api 都应是 healthy，setup 应是 Exited (0)
curl -sS http://127.0.0.1:3000/api/health             # {"ok":true,"db":"ok",...}
bun scripts/smoke.ts --base http://127.0.0.1:3000    # 应打印 all checks passed
```

打开首页和 `/admin`，用 `init-env.ts` 打印的密码登录。这时首页是空的，**这是对的**——开关还没开。

### 3. 打开收录

先只开抓取，确认能拿到东西、再开始花钱（可选，但推荐）。改完 `.env` 要用 `up -d` 重建容器——`docker compose restart` 不会重新读 `.env`，开关改了也不生效：

```bash
COLLECT_ENABLED=true      # .env
docker compose up -d api worker
```

等一轮抓取，看后台「信源」页有没有新资料进来。确认没问题后再开模型：

```bash
MODEL_CALLS_ENABLED=true
docker compose up -d api worker
```

第一批一百多条资料约半小时、约 930 次模型调用（`docs/deploy.md` 的「花多少钱」）。所有付费服务都有每分钟/小时/天上限，后台「设置 → 付费请求上限」能改，填 0 就是立刻停用。

### 4. 域名与 HTTPS

按 `docs/deploy.md` 的「配域名和 HTTPS」做：`SITE_URL` 换成正式地址、`SITE_DOMAIN`、`TRUST_PROXY=true`，然后 `docker compose --profile https up -d --build`。确认 `https://<域名>/robots.txt`、`/sitemap.xml`、`/llms.txt` 里的地址都是正式域名（不是 localhost、也不是 IP）。

### 5. 让搜索引擎找到

```bash
INDEXNOW_SUBMIT_ENABLED=true   # .env，另需 INDEXNOW_KEY
docker compose up -d worker
```

再到百度搜索资源平台、Google Search Console 提交 sitemap。

### 6. 邮件与推送（要就开）

- 邮件订阅：`EMAIL_ENABLED=true` + 一组 SMTP 凭据（`docs/deploy.md` 的「邮件订阅」）。**先 `EMAIL_DRY_RUN=true` 跑一遍核对内容**，再改回 `false`——干跑也会写 `email_sends`，别拿它当预览反复点。发信域名要配好 SPF/DKIM/DMARC。
- 飞书：`FEISHU_CONTENT_PUSH_ENABLED` / `FEISHU_INTERNAL_ENABLED` + 相应的 webhook / 应用密钥。

### 7. 备份

在 `.env` 里配 `DB_BACKUP_STORE_*`（任何 S3 兼容对象存储），每天 04:10 会把数据库 `.dump` 和附件包备份过去。**没有配就等于没有备份**——起站当天就配好，并且真的下载一次、按 `docs/deploy.md` 的「备份」章节试恢复一次。

### 8. 头 24 小时看什么

```bash
docker compose logs -f --tail 100 api worker web
```

后台「运行」页看每个定时任务最近一次的结果，「信源」页看每个信源的抓取状况，「模型与评测」页看每一步的调用次数和 token，「预警」看有没有需要处理的告警（译名、抓取失败等）。邮件和飞书推送都通了以后，第一次日报/周报生成时人工读一遍中文质量。

## 四、开关一览

全部默认 `false`，`scripts/init-env.ts` 也会写成 `false`。

| 开关 | 打开后会做什么 | 建议 |
| --- | --- | --- |
| `COLLECT_ENABLED` | worker 开始定时抓信源（含付费采集） | 站点确认能打开之后 |
| `MODEL_CALLS_ENABLED` | 开始调用模型：预筛、评分、结构化、翻译、日报周报 | 确认抓取正常之后 |
| `INDEXNOW_SUBMIT_ENABLED` | 新内容推给 IndexNow（另需 `INDEXNOW_KEY`） | 域名和 sitemap 都对了之后 |
| `EMAIL_ENABLED` | 到期提醒和每日摘要发信（另需 SMTP） | 先用 `EMAIL_DRY_RUN=true` 核对 |
| `FEISHU_CONTENT_PUSH_ENABLED` | 内容推到飞书群 | 需要时 |
| `FEISHU_INTERNAL_ENABLED` | 内部告警推到飞书 | 需要时 |

**必须保持 `false` 的**：`ALLOW_PRIVATE_NETWORK_FETCH`（会让服务去抓内网地址）、任何 `DEV_AUTH_*`（开发登录后门）。这两类在生产会被启动检查直接拒绝，写错就起不来。

`TRUST_PROXY=true` 只在真的有一层反向代理时才设——设错了限流和封禁会按错的 IP 记。

## 五、已知的边界

- **下架不是瞬时全站生效**，撤下会收敛：页面缓存最多 5 分钟（`apps/web/server.ts`），报告索引 60 秒 / 最多 10 分钟，sitemap 5 分钟 / 最多 1 小时，MCP 30 秒。已经投递出去的邮件和已经被抓走的副本收不回来。
- **sitemap 里的报告 URL 只在该期还有至少一条可读引用时才提交**。引用条目被下架、或者条目在数据库里已经没有 `publications` 行（比导入窗口更早）时，这一期就不再进 sitemap，页面本身仍然可读。
- `publication/scope.ts` 是可见性判断的唯一出处，但仍有 8 处直接手写 `visibility` 条件（`sitemap.ts`、`reports.ts`、`publish.ts`、`notify/selected-content.ts`、`site/stats.ts`、`events/hot.ts`、`operations/reports.ts`）。目前都正确，是将来漂移的风险点；`tests/architecture.test.ts` 现在还拦不住这种写法。
- `/members` 目录页里每个角色的「最新」和计数仍走 10 分钟缓存（角色页自身已经是即时的）。后台的单条下架在目录页上最多滞后 10 分钟。
- 精选大事记（`publication/chronicles.ts`）只外链、不校验被链条目的可见性；条目被下架后链接会 404。数据是随站点发布的静态精选，影响很小。
- 上线前请再完整跑一遍第一节的命令——尤其是 `docker compose up -d --build` 和 `scripts/smoke.ts`，这两条是唯一能同时覆盖镜像、迁移、种子、启动顺序和对外出口的检查。
