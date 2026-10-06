# 部署

正式对外之前先过一遍 [上线检查单](launch-checklist.md)：哪些已经验过、哪些只有站主本人能定、上线当天按什么顺序开开关。

## 用 Docker（推荐）

需要一台装了 Docker（带 Compose）的机器。云服务器建议至少 2 核、4 GB 内存，构建镜像时要用到。

```bash
git clone https://github.com/RinneBeat/girlsbands.git myband
cd myband
node scripts/init-env.ts --llm-key <你的模型 API Key>
```

`init-env.ts` 会生成 `.env`，填好随机密钥和管理员密码，并把密码打印一次；它还会把所有对外开关（抓取、模型调用、飞书推送、IndexNow、邮件）写成 `false`，所以第一次启动的站是安静的。机器上没有 Node 的话，把 `.env.example` 复制成 `.env`，自己填 `ADMIN_PASSWORD`（至少 12 位）、`SESSION_SECRET`、`IMG_PROXY_SIGN_SECRET`、`POSTGRES_PASSWORD`（各用 `openssl rand -hex 32` 生成）和 `LLM_API_KEY`。自己填的值别写成 `dev-` 开头或 `test`、`changeme` 这类占位词：生产环境会拒绝启动（见 `packages/backend/src/config.ts` 的 `assertProductionSecrets`）。

启动前检查 `.env` 的 `SITE_URL`：本机试用保留 `http://localhost:3000`；部署到服务器时改成读者实际访问的地址。例如通过服务器 IP 访问时（把示例 IP 换成自己的）：

```dotenv
SITE_URL=http://192.0.2.10:3000
```

RSS、分享链接、站点地图和 Agent Markdown 中的绝对链接都使用这个值，不会随浏览器访问的地址自动改变。使用域名和 HTTPS 时按下方「配域名和 HTTPS」设置。

配置完成后启动：

```bash
docker compose up -d --build
```

启动后打开 `http://服务器地址:3000`，后台在 `/admin`，用管理员密码登录。这时站点是空的，而且是故意的：`COLLECT_ENABLED` 和 `MODEL_CALLS_ENABLED` 默认都是 `false`，不会抓信源也不会调模型。先确认页面打得开、后台进得去、`SITE_URL` 填的是读者实际访问的地址，再把这两行改成 `true`，然后 `docker compose restart api worker` 开始收录：一两分钟后开始出现内容，第一批一百多条资料大约半小时处理完（每条都要预筛、评分、结构化、写标题摘要，再归组），对应大约 930 次模型调用。只想先看看界面就别开。

`docker compose` 会起五个容器：`db`（PostgreSQL 17）、`setup`（每次启动先跑数据库迁移和种子数据，然后退出）、`api`、`worker`（抓取、模型处理、定时任务）、`web`（网页）。用 `--profile https` 时再加一个 `caddy`，一共六个。

### 在中国大陆的服务器上

- 构建时 npm 走国内镜像：`docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com`，然后 `docker compose up -d`。
- 拉取 Docker 镜像慢，先给 Docker 配置镜像加速。
- 海外信源抓不到时，在 `.env` 里设置 `EGRESS_PROXY_URL`：抓信源和图片时走这个代理，调用模型接口不走。
- 对外提供网站服务需要先完成 ICP 备案，备案号填在 `industry/site.ts` 的 `icp`。

### 配域名和 HTTPS

先把域名解析到服务器，然后在 `.env` 里设置：

```bash
SITE_URL=https://example.com
SITE_DOMAIN=example.com
PORT=127.0.0.1:3000        # 3000 端口只给本机的 Caddy 用，不直接对外
TRUST_PROXY=true           # 访客地址从 Caddy 转来的请求头里读
```

再用带 HTTPS 的方式启动，Caddy 会自动申请和续期证书：

```bash
docker compose --profile https up -d --build
```

Caddy 默认占用宿主机的 80 和 443，证书走 80 端口上的 HTTP 挑战。这台机器前面还有 CDN 或别的 Web 服务器时，把 Caddy 挤到高位端口：

```bash
CADDY_HTTP_PORT=18080
CADDY_HTTPS_PORT=18443
```

但这时要由前面那层终结 TLS，并且把 `/.well-known/acme-challenge/` 透传给 Caddy 的 80 端口，否则 Caddy 会一直申请失败。由 CDN 完全终结 TLS、Caddy 只当期源时换成下面的 `deploy/Caddyfile.edgeone`：它自签证书，不做 ACME，也就不需要透传挑战路径。

已经有 Nginx 的话，不用 Caddy，把站点反向代理到 `http://127.0.0.1:3000`，带上 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`，并在 `.env` 里设 `TRUST_PROXY=true`。`SITE_URL` 一定要写成读者实际访问的地址：生成的链接、RSS、分享图和 MCP 都用它。

MCP 默认接受 `SITE_URL` 的主机以及 `localhost`、`127.0.0.1`、`[::1]`。额外主机用 `MCP_ALLOWED_HOSTS` 配置，以逗号分隔，例如 `extra.example:8443,[2001:db8::1]`。主机名不区分大小写，IPv6 必须加方括号；可带 0–65535 的十进制端口，匹配时忽略端口。包含路径、用户信息或非法端口的配置不会生效。`127.1` 等别名需要明确列入；此配置只影响 Host 校验，不扩大浏览器 Origin 许可。

### 前面接 EdgeOne（CDN 终结 TLS）

腾讯云 EdgeOne 终结对外的 TLS，回源到这台机器 443 上的 Caddy（EdgeOne 不校验源站证书）。页面和静态资源分两个域名，都解析到同一台机器、同一个 `web` 容器：

- `SITE_DOMAIN` 是读者访问的页面域名，`SITE_URL` 也写它。
- `STATIC_DOMAIN` 是静态资源域名，`ASSET_BASE_URL` 写它。构建时 Vite 的 `base` 只把带哈希的客户端资源（客户端入口、CSS、字体、modulepreload 链接、SSR 清单）指到这个域名，页面路由仍在 `SITE_DOMAIN` 上；`/favicon.ico`、`/robots.txt` 这些由站点域名自己出。

`.env`：

```bash
SITE_URL=https://girlsbands.com
SITE_DOMAIN=girlsbands.com
STATIC_DOMAIN=static.girlsbands.com
ASSET_BASE_URL=https://static.girlsbands.com   # 构建参数，改了要重新 build
ORIGIN_AUTH_SECRET=<一段随机字符串>
CADDYFILE=Caddyfile.edgeone
TRUST_PROXY=true
PORT=127.0.0.1:3000
```

`ASSET_BASE_URL` 只在构建时读（Dockerfile 的 `ASSET_BASE_URL` 构建参数，compose 从 `.env` 传给 `setup` 的 `build.args`），不设置或留空时资源照旧从站点自己的域名出。改完启动：

```bash
docker compose --profile https up -d --build
```

`deploy/Caddyfile.edgeone` 与默认那份的区别：`tls internal` 自签证书，不做 ACME；每个请求都必须带 EdgeOne 回源时加的 `X-Origin-Auth`，和 `ORIGIN_AUTH_SECRET` 不一致的一律 403，转发前把这个头删掉，应用看不到；`X-Forwarded-For` 换成 EdgeOne 放在 `EO-Connecting-IP` 里的真实访客地址，配合 `TRUST_PROXY=true`，限流和后台看到的就是访客本人而不是 EdgeOne 节点。静态域名只放行 `/assets/*` 和 `/fonts/*`，其余 404，所以它取不到 `/api` 和 `/admin`。

EdgeOne 侧要配：

- 源站：这台机器的 443，协议 HTTPS。
- 回源 Host 头：加速域名本身。
- 回源请求头加 `X-Origin-Auth: <ORIGIN_AUTH_SECRET>`。
- 缓存：跟随源站的 `Cache-Control`（`/assets/*` 是一年不可变，页面是几分钟）；`/admin` 和 `/api/admin` 永远不要缓存。

### 更新

先按下节备份数据库。构建完成后停止旧服务，再运行迁移和新版服务：

```bash
git pull
docker compose build
docker compose stop api worker web
docker compose run --rm setup && docker compose up -d
```

迁移成功后再启动服务；迁移失败时先查看错误，不要继续启动。使用 HTTPS 配置的站点继续保留 `--profile https`。旧的 API 和 worker 要在迁移前停下：迁移可能删表删列，旧代码还在跑会出错；正常关闭 worker 会等进行中的付费调用收尾（最长三分多钟）。非 Docker 部署也按“备份、构建、停止 API/worker/web、迁移（`scripts/migrate.ts`）、种子数据（`scripts/seed.ts`）、启动”的顺序更新。

#### 升级到公开接口 3.0.0

- **安全阀默认关**：`COLLECT_ENABLED`、`MODEL_CALLS_ENABLED` 只有写成 `true` 才打开，没写就是关。`scripts/init-env.ts` 生成的 `.env` 里这两行一直是 `false`（它会把抓取、模型、飞书推送、IndexNow、邮件共六个开关一起写成 `false`），要开得自己改；自己写的 `.env` 也要有这几行，否则升级后不再采集、不再调用模型。
- **周报月报接口换了形状**：`/api/v1/weeklies`、`/api/v1/monthlies` 的列表和每一期都带 `periodStart`、`periodEnd`，正文改成 `sections[]`（每栏 `label`、`summary`、`items`），不再有 `title`、`themes`，列表的 `limit` 最多 60。读这两个接口的程序要跟着改；MCP 和 `/openapi-v1.json` 的版本号随之升到 3.0.0。
- **精选的机器出口每条新闻一条**：API 的 `mode=selected`、同步接口和精选 RSS 里，同一条新闻只留代表报道，其他报道以 `remove` 出现在同步的变更里（`mode=all` 里还在）。升级前已经入选的旧报道不会被重新整理，等这条新闻再有报道发布时才归并。
- **精选要等去重确认**：分数够了的资料，要等归组确认它不是精选里已有新闻的重复、带来了新信息，才进精选；确认之前只在“全部动态”。归组用的模型回答不合格式时会停在那里，后台“运行”页能看到。
- **一手只看分级**：`T1` 就是一手，`first_party` 不再单独设置；以前单独标成一手的 `T1_5`、`T2` 信源不再算一手，要算就改成 `T1`。
- **行业包多了几项**：`taxonomy.ts` 新增 `RELEASE`、`PLAIN_TERMS`，评论类的类别标 `commentary: true`，`ENTITIES` 可以写 `otherNames`，`CATEGORY_BY_ITEM_TYPE` 不再使用；新增 `chronicle.ts`（主题页大事记的规则，默认按 AI 行业写），`topics.json` 也多了几个可选字段。已经换成别的行业的站，合并时对照 [把它改成你的行业](customize.md) 补上。
- **主题只读 `industry/topics.json`**：迁移会删掉数据库里的 `topics` 表。只改过数据库、没改文件的主题，升级前先写进文件。公司主题只看 `entityId`，`related` 不再使用。
- **日报不再调用模型**：日报按规则编排，周报月报从日报汇编，模型只写总述和栏目导读；已经出过的各期不重写。
- **提示词有改动**：`industry/prompts/` 里的 `structure.md`、`group-*.md`、`story-digest.md`、`report-period.md` 换成了新的写法，`report-daily-lead.md` 删掉了，新加了 `report-period-sections.md`。改过这些提示词的，对照着把自己的改动搬过去。
- **删掉的脚本**：`scripts/delete-sources.ts`、`scripts/regroup-events.ts`、`scripts/enqueue-analysis.ts`。不要的信源在后台暂停；单篇的重新评估、重新归组在后台内容页。
- **`/agent` 默认打开 Agent Markdown**，MCP 的接入说明在 `/agent?tab=mcp`。
- **飞书内容群只推 `T1`、`T1_5` 信源的精选。**

#### 删掉模型榜与 Codex 重置监控（迁移 `0053`）

这两个模块只对 AI 行业有意义，本站已经把它们整块删掉：代码、测试、文档和存下的状态一起消失。迁移 `0053` 删掉它们的表，**数据不可恢复**（只能从整库备份里恢复），升级前先按下一节备份：

- 模型榜：`lb_models`、`lb_aliases`、`lb_snapshots`、`lb_scores`、`lb_runs`、`lb_rankings`、`lb_prices`、`lb_calibrations`。
- 重置监控：`monitor_posts`、`monitor_events`、`monitor_event_posts`、`monitor_state`。
- 只有模型榜价格导入用到的 `fx_rates`，以及 `settings` 里的 `leaderboard.fetch`（模型榜抓取状态）和 `models.monitor`（重置识别用的模型覆盖）。

定时任务 `leaderboard.round`、`monitor.tick`、`monitor.lookback` 不再登记，worker 启动时会注销同名的 `cron.*` 任务。`.env` 里的 `MONITOR_MODEL`、`ARTIFICIAL_ANALYSIS_API_KEY` 不再被读取，可以删掉；`SOCIALDATA_API_KEY` 保留，普通 X 信源还在用它。页面 `/leaderboard*`、`/codex-reset`、后台“Codex 重置”页和公开接口 `/api/v1/codex-resets*` 一并消失，引用过它们的程序要改。

#### 全文搬运与删除请求（迁移 `0056`）

这个站把 editorial 信源的每一条公开内容整篇搬进站内、再翻成中文（`site_fulltext` 全开），所以必须随时能回应删除请求。

- **迁移 `0056_site_fulltext_editorial.sql` 只改 `sources` 行，不会重算已经发布出去的内容**：它把 `participation_mode = 'editorial'` 的源设成 `site_fulltext = true`，但 `publications.body_mode` 还是升级前的值（`summary`）。要让老内容真的变成全文，得让这些源重新投影一次 —— 在后台信源页改一下任一发布字段（`participation_mode`、`site_fulltext`、`syndicate_fulltext`、`tier`、`name`、`first_party`、`owner_entity_id`）就会自动排 `publication.republish-source`。改 `industry/sources.json` 本身不会触发，`scripts/seed.ts` 是 `ON CONFLICT (id) DO NOTHING`，也不会。
- **删除请求走后台，不用改数据库**：单条在内容页「公开范围」里选「下架」（所有出口移除，链接 404）；整个来源在信源页点「整源下架」，它会把该源已经发布出去的条目整批写成 `withdrawn`、逐条重新投影、并暂停这个源，之后不再采集。两种操作都写进审计日志（`content.visibility` / `source.withdraw`）。
- **联系入口**：`industry/site.ts` 的 `contactEmail`，现在填的是 `contact@girlsbands.com`（本站已经确认这个邮箱能收信）。它还喂 `/.well-known/security.txt`、llms.txt 和 RSS 的 author，换邮箱时这里和 `industry/pages/` 下的说明要一起改。读者看到的说明在 `/rights`（`industry/pages/rights.md`）。

#### 补上 GIRLS BAND CRY 的两支乐队（2026-10-05）

`ENTITIES` 原来只有企划 + トゲナシトゲアリ、クズミミズク、ダイヤモンドダスト，漏了游戏「ガールズバンドクライ First Riff」的第 1 弾 **Canna Lily** 与第 2 弾 **F-272**（第 3 弾就是クズミミズク）。补上后主体从 20 个变成 22 个（4 企划 + 18 支乐队），新增 `/topics/canna-lily`、`/topics/f-272` 两个页面，企划页 `/topics/girls-band-cry` 把六支主体都收进来。

- **升级后词表会把已入库的条目重译一遍**：乐队名从 `ENTITIES` 生成，`GLOSSARY_VERSION` 从 `glossary-336-q9eeo5` 变成 `glossary-338-rs65fk`，而它进了 `TRANSLATE_PROMPT_VERSION` —— 旧译文回执全部失效。这是预期行为（词表变了就不能复用旧回执），只是会多花一轮模型钱，做好这个准备；不要为了省这笔去手改回执。
- **没有迁移**：`taxonomy.ts`、`topics.json`、`assets/band-logos/` 都是文件，`git pull` 后重建、重启即可；两个字标已经在仓库里（`canna-lily.png`、`f-272.png`），不需要联网抓。
- **新主题不会立刻进 sitemap**：`publication/sitemap.ts` 只列 `indexable` 的主题，而 `publication/topics.ts` 的规则是「≥ 50 条，或 ≥ 20 条且近 30 天有更新」。页面本身一直可达，等条目够了会自动进 sitemap。

### 管理员会话与配置变更

会话绑定迁移排在 `0041`。此前已试用会话绑定迁移的数据库可直接升级，已有列和绑定会被保留，无需手动修改迁移记录。

会话绑定登录方式、登录时的管理员凭据或飞书身份。升级到会话绑定版本后，未绑定的旧会话需要重新登录。修改管理员密码、飞书管理员名单或会话密钥后，应重启所有 API 进程，使它们加载相同的新配置；只编辑配置文件不代表正在运行的进程已生效，混用旧代码或旧配置的进程不能提供统一撤权。

有效配置改变后，密码会话不再接受旧密码的授权，飞书会话按登录时实际取得的 union ID 或邮箱检查当前名单（两者任一仍获授权即可）。停用飞书登录应用或更换应用 ID 会使飞书会话失效；只轮换同一应用的 secret 不会使仍获授权的飞书会话退出。轮换或移除 SESSION_SECRET 会使两种会话都失效。

鉴权时确认失效的会话会被删除，恢复旧配置也不会让它复活。系统不记录全局凭据变更历史：某次配置变化若从未被进程加载，或在恢复前从未被会话检查观察到，不能据此追溯撤销会话。

### 图片缓存放对象存储

图片代理的缓存默认写在数据目录的 `imgcache/` 里，服务器磁盘会随图片一直涨。要让缓存改存 S3 兼容的对象存储（生产用的是 Cloudflare R2），在 `.env` 里配这几项：

- `IMAGE_STORE_ACCESS_KEY_ID`、`IMAGE_STORE_SECRET_ACCESS_KEY`：对象存储的密钥。
- `IMAGE_STORE_BUCKET`：桶名（本站生产用 `girlsbands-images`）。
- `IMAGE_STORE_ENDPOINT`：R2 形如 `https://<账号 ID>.r2.cloudflarestorage.com`；请求按 `${endpoint}/${bucket}/${key}` 这条路走，桶要允许这种路径式访问。
- `IMAGE_STORE_REGION`：默认 `auto`，R2 写 `auto` 就行。

四项齐了缓存才走对象存储，缺任何一项都继续用本地 `imgcache/` —— 这是配置选择，不是降级：对象存储出错会当成上游失败报出来，不会悄悄写回本地；键不存在（404）才算缓存未命中。对象都放在桶里的 `imgcache/` 前缀下，键的哈希和本地文件名一致，类型写在对象的 `Content-Type` 上。换回本地时桶里的对象不受影响，只是不再被读；反过来，桶里的对象要靠对象存储自己的生命周期规则清理，`operations/retention.ts` 只管服务器上的本地缓存目录。

### 备份

在 `.env` 里配置 `DB_BACKUP_STORE_*`（任何 S3 兼容的对象存储），每天 04:10 自动备份到那里。一次完整备份包含同一时间戳的数据库 `.dump` 和文件 `girlsbands-files-*.tar.gz`：文件包保留 `uploads/` 以及仍存本地的 `feedback-screenshots/`，不包含图片缓存或本地备份目录。已经转发到飞书的图片只保留数据库中的外部引用，文件包不保存飞书上的图片。

恢复时同时取回这一对文件：使用与数据库版本兼容的 `pg_restore` 将 `.dump` 恢复到空数据库，再把文件包解压到数据目录根目录（Docker 中为 `/data`，非 Docker 使用 `GIRLSBANDS_DATA_DIR`，默认 `.data`），保留包内的子目录结构，并确保运行进程可读取这些文件。只恢复数据库不能找回仍由 `local:` 引用的反馈截图；旧备份中没有包含的文件也无法凭数据库引用恢复。

下面的手动导出只包含数据库，不包含上述附件目录：

```bash
docker compose exec -T db pg_dump -U girlsbands girlsbands | gzip > myband-$(date +%F).sql.gz
```

数据都在三个 Docker 卷里：`db`（数据库）、`data`（上传的图片、图片缓存、本地备份）、`caddy`（证书）。`docker compose down` 不会删除它们；`docker compose down -v` 会。

### 看日志

```bash
docker compose logs -f --tail 100 api worker web
```

后台的“运行”页能看到每个定时任务最近的结果，“信源”页能看到每个信源的抓取状况。

### 邮件订阅（SMTP）

订阅默认关着：`.env` 里 `EMAIL_ENABLED=false`，`/api/site/subscribe` 会明确回答“邮件订阅暂未开放”，两个定时任务直接返回，连 SMTP 都不连。

打开它需要一组 SMTP 凭据（`integrations` 组，写在 `.env` 或 `GIRLSBANDS_CREDENTIALS_DIR/integrations.env`）：

```bash
EMAIL_ENABLED=true
SMTP_HOST=smtp.example.com
SMTP_PORT=587            # 465 会自动走 TLS
SMTP_USER=apikey         # 本机或内网中继可以留空，留空就不认证
SMTP_PASS=...
EMAIL_FROM="少女乐队's <radar@example.com>"   # 必填，发信人
EMAIL_REPLY_TO=reply@example.com                 # 选填
EMAIL_STYLE=cover        # 目前只有 cover，见 docs/subscribe.md
```

`EMAIL_DRY_RUN=true` 会把整封信交给 nodemailer 的 json 传输渲染出来但不投递，用来核对内容；发送记录照常写进 `email_sends`，所以别拿它当“预览”反复跑定时任务。

两个定时任务：`email.deadline`（每天 09:00 和 21:00，只发 48 小时内到期的节点）和 `email.digest`（每天 20:00，只发过去 24 小时的精选）。没有要紧事的那一轮会记成“0 封”，这是正常结果，不是故障。

发信域名要自己配好 SPF / DKIM / DMARC，否则确认信多半进垃圾箱。每封提醒和摘要都带 RFC 8058 的一键退订头（`List-Unsubscribe` + `List-Unsubscribe-Post`）。

## 花多少钱

- **模型**：每条新资料先预筛一次；过了预筛的再评两次分、做一次结构化、写一次标题摘要，然后归组（有相近的报道时才调用），另外还有事件综述、周报月报的总述和精选的全文翻译。日报按规则编排，不调用模型。我们用示范信源在本地试跑，第一次导入的 152 条资料一共用了大约 930 次模型调用。之后每天用多少，取决于你的信源每天更新多少条。后台“模型与评测”页能看到每一步的调用次数和输入输出 token 数。
- **付费采集**（X、公众号、Jina）：按请求计费，默认不启用，填了 key 才会用。
- 所有付费服务都有每分钟、每小时、每天的调用上限（后台“设置 → 付费请求上限”），超过就暂停，不会一夜之间刷爆账单。填 0 表示立即停用这个服务。

## 不用 Docker

需要 Node.js 24.11 以上和 PostgreSQL 16 或 17。

```bash
npm ci
node scripts/init-env.ts --llm-key <你的模型 API Key>
createdb girlsbands
```

在 `.env` 里加上：

```bash
DATABASE_URL=postgres://你的用户名@127.0.0.1:5432/girlsbands
API_BASE_URL=http://127.0.0.1:3001
```

然后：

```bash
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/seed.ts
npm run build -w @girlsbands/web

node --env-file=.env apps/api/src/main.ts          # 接口，3001 端口
node --env-file=.env apps/worker/src/main.ts       # 后台任务
cd apps/web && NODE_ENV=production node --env-file=../../.env server.ts   # 网页，3000 端口
```

三个进程要一直运行，生产环境用 systemd 或 pm2 守护。停止 worker 时至少给它 210 秒（systemd 的 `TimeoutStopSec`、pm2 的 `kill_timeout`），让进行中的付费调用收尾；被提前杀掉的调用结果不明，要等至少半小时自动放行后才会重试。

开发时用带热更新的方式：`npm run dev:api`、`npm run dev:worker`、`npm run dev:web`。开发时想免登录进后台，在 `.env` 里设 `DEV_AUTH_ROLE=admin`（生产环境会拒绝启动）。
