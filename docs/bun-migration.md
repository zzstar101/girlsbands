# 迁到 Bun：做了什么，2c4g 压测前后对比

基线是 `450f974`（Node 24 + npm），迁移后是 `bun-native` 分支（Bun 1.4.2）。所有数字都可以用 `bench/` 里的脚本复跑，原始结果在 `bench/results/`，汇总表由 `bun bench/summary.ts` 生成。

## 改了什么

- **运行时和包管理**：`package-lock.json` 换成 `bun.lock`，`packageManager: bun@1.4.2`。api、worker、web 和所有脚本都用 `bun` 直接跑 TypeScript。镜像基底从 `node:24-trixie-slim` 换成 `oven/bun:1.4.2-slim`，CI 用官方安装脚本按 `packageManager` 里的版本装 Bun（工作流只允许 GitHub 自家 action）。
- **网页服务**：`apps/web/server.ts` 从 `node:http` 加 `@react-router/node` 改成 `Bun.serve`。静态文件走 `Bun.file`，API 代理走流式 `fetch`，缓存头改写、`TRUST_PROXY` 和优雅停机的语义不变。`entry.server.tsx` 改用 `renderToReadableStream`，爬虫请求照旧等 `allReady`。
- **图片**：静态 PNG/WebP 缩放改用 `Bun.Image`，OG 封面读尺寸改用 `Bun.Image.metadata`。JPEG（Bun 编出来大 1.5–2 倍）、SVG、头像裁切、ICO、动图仍然走 sharp，因为 Bun.Image 没有 cover 裁切、合成、SVG 输入和原始像素。
- **测试**：`node --test` 换成 `bun tests/run.ts`。它先建模板库，再起 6 个并行的 `bun test <file> --preload tests/preload.ts` 进程，每个进程克隆自己的数据库。
- **两处 Bun 行为差异**：
  - 裸的 `import "undici"` 在 Bun 下会解析到内置替身，它的 `Agent` 忽略 `connect.lookup`，SSRF 防护会悄悄失效。外呼代码因此改成 `import ... from "undici/index.js"`，`tests/url.test.ts` 加了一条测试，禁止再写裸的 `from "undici"`。
  - Bun 会自动读取当前目录下的 `.env`。部署文档和测试都考虑到了这一点。
- **API 框架**：Fastify 原样跑在 Bun 上，暂不重写，原因见文末。

验证：`bun run typecheck` 通过，`bun run test` 127 个文件 769 个用例全部通过（Node 基线 151 秒，Bun 约 85 秒），网页测试 47 个通过，公开读接口的响应体与 Node 版逐字节一致（时间戳字段除外）。

## 压测环境

- 宿主是 macOS（10 核 / 24 GB），Docker 跑在 colima 虚拟机里（aarch64，4 核，5.8 GB）。
- **2c4g**：db（postgres:17-alpine）、api、worker、web 四个容器都绑在 CPU 0,1 上，内存上限合计 4 GB（db 1g、api 1280m、worker 768m、web 1g），见 `bench/compose.yml`。压测工具 oha 1.16 跑在 CPU 2,3 的容器里，不和被测服务抢核。
- 数据是开发库的拷贝（`pg_dump`，analyses 500 行），每轮都重建整套栈并重新灌数据。
- 安全阀门（采集、模型调用等）全部关闭，worker 照常运行。
- Node 镜像用基线源码构建（node v24.21.0），Bun 镜像用本分支构建（bun 1.4.2），两者的 compose 配置相同，只有启动命令不同。

`bench/run.ts` 依次跑这几项：启动时间（api、web 各重启 10 次，计到能响应为止的毫秒数）、空闲 30 秒后的内存、各接口吞吐（64 并发、20 秒，先预热 5 秒）、TTFB（顺序请求 200 次）、最大并发爬坡（网页 URL 混合，并发 8→2048，每档 20 秒，第一档不达标就停）、爬坡后的峰值内存。

**Node 和 Bun 各完整跑了 3 轮，下面的数字取中位数。** 同一配置在不同轮之间波动很大（同一接口的吞吐能差 30% 以上），单轮结果不可靠。

## 结果

### 启动和常驻内存

| 指标 | Node | Bun | 变化 |
|---|---|---|---|
| api 启动到能响应（ms） | 1694 | 1300 | −23% |
| web 启动到能响应（ms） | 1010 | 850 | −16% |
| 运行时空进程 `-e 0`（ms） | 20.4 | 2.5 | −88% |
| 只加载 API 模块图、不监听（ms） | 705 | 514 | −27% |
| api 空闲 RSS（MiB） | 210 | 149 | −29% |
| web 空闲 RSS（MiB） | 124 | 79 | −36% |
| worker 空闲 RSS（MiB） | 173 | 123 | −29% |
| 容器内存合计（api+web+worker，docker stats，MiB） | 332 | 209 | −37% |
| api 峰值 RSS（爬坡后，MiB） | 347 | 368 | +6% |
| web 峰值 RSS（爬坡后，MiB） | 264 | 191 | −27% |

空闲时三个应用进程合计省下约 160 MiB。在 2c4g 机器上，这块余量可以分给 PostgreSQL 的缓存。api 的峰值内存 Bun 略高，因为 JSC 的堆在高负载后回收得慢一些。

### 吞吐（64 并发，20 秒，中位数）

| 接口 | Node RPS | Bun RPS | 变化 | Node p99（ms） | Bun p99（ms） |
|---|---|---|---|---|---|
| `GET /api/v1/items` | 2872 | 4992 | +74% | 59 | 33 |
| `GET /api/v1/selected/snapshot` | 710 | 1394 | +96% | 310 | 97 |
| `GET /api/site/home` | 247 | 294 | +19% | 613 | 540 |
| `GET /feed.xml` | 939 | 1578 | +68% | 187 | 98 |
| `GET /calendar.ics` | 102 | 179 | +76% | 2857 | 1077 |
| SSR `/` | 44.6 | 58.6 | +31% | 2678 | 2032 |
| SSR `/topics/bang-dream` | 45.4 | 70.7 | +56% | 2782 | 1450 |
| SSR `/items/:id` | 92.9 | 163.1 | +76% | 1936 | 825 |
| 经 web 代理的 `/api/v1/items` | 1879 | 2537 | +35% | 150 | 55 |
| `GET /api/v1/hot-topics`（空结果，只测框架开销） | 40311 | 42655 | +6% | 3.5 | 4.5 |

上表除 hot-topics 外，各接口 Bun/Node 吞吐比的几何平均是 **1.57×**。hot-topics 在两边都在 4 万 RPS 以上，说明 Fastify 本身不是瓶颈。真正的成本在 SQL 结果的组装、序列化和 React 渲染上，Bun 在这几处都更快。

20 秒内完成的请求数等于 RPS×20，每轮的原始请求数和状态码分布见 `bench/results/*.json` 里的 `endpoints.*.requests` 和 `codes`。所有接口在两边的错误率都是 0。

### SSR TTFB（顺序请求，单连接，中位数）

| 页面 | Node p50 / p99（ms） | Bun p50 / p99（ms） |
|---|---|---|
| `/` | 25.1 / 159 | 17.9 / 54 |
| `/topics/bang-dream` | 21.2 / 66 | 18.1 / 64 |
| `/items/:id` | 10.8 / 24 | 8.6 / 15 |

### 最大可承载并发（p99 < 1 秒且错误率 < 1%）

| | Node | Bun |
|---|---|---|
| 3 轮各自的结果 | 16 / 32 / 16 | 32 / 32 / 8 |
| 中位数 | **16** | **32** |
| 达标档位的吞吐（RPS） | 77–103 | 97–133 |

逐轮的爬坡明细：

- Node：c8 96 RPS p99 296 → c16 83 / 819 → c32 87 / 1577 不达标；另两轮分别在 c32（p99 1597）和 c64（p99 1372）不达标。
- Bun：c8 117 / 239 → c16 129 / 291 → c32 133 / 545 → c64 127 / 1456 不达标；第三轮同样在 c64 不达标（p99 1624）。
- Bun 第二轮在 c16 出现一次 p99 1386 ms 的抖动，吞吐也掉到 80，同轮 c8 正常。这是单档、单轮的离群值。由于爬坡遇到第一个不达标档就停，这一轮记为 8。

结论：同一台 2c4g 机器，Bun 能扛住的并发大约是 Node 的两倍，饱和时吞吐高 30–50%。两边的上限都卡在 SSR 渲染吃满两个核上。

### 依赖安装（2c4g 容器，Node 和 Bun 交替执行）

| | `npm ci` | `bun install --frozen-lockfile` |
|---|---|---|
| 冷安装（无缓存，3 次中位数） | 10.0 秒 | 13.1 秒（12.2–17.1） |
| 热安装（有缓存、删掉 node_modules，5 次中位数） | 3.0 秒 | **0.75 秒** |
| node_modules 大小 | 261 MiB | 320 MiB |
| 包缓存大小 | 67 MiB（压缩包） | 321 MiB（解压后） |

- 冷安装主要受网络限制（经宿主代理访问 registry），Bun 并发请求多，走同一个代理时反而更慢、更不稳定，差距在噪声范围内。
- 热安装（本地开发、CI 有缓存的情况）Bun 快 4 倍。

### Docker 构建（2c4g buildx builder，`--no-cache`）

| | Node | Bun |
|---|---|---|
| 构建时间 | 259 秒 | 217 秒（−16%） |
| 镜像大小 | 161.5 MB | 151.8 MB（−6%） |

两边都主要花在装依赖上（Node 的 `npm ci` 215 秒，Bun 生产依赖和构建依赖并行安装，约 172 秒），且受网络影响。每边只测了一次，看趋势即可。

### Bun.Image：图片代理缩放（`resizeImage()`，绑 2 核，2 轮交替）

| 场景 | Node 单次（ms） | Bun 单次（ms） | Node 4 并发（ops/s） | Bun 4 并发（ops/s） |
|---|---|---|---|---|
| 带透明的 PNG 1200×800 → 720 | 160 | 112（−30%） | 10.7 | 19.1（+78%） |
| PNG 2400×1600 → 1200 | 310 | 244（−22%） | 6.3 | 8.5（+35%） |
| WebP 2000² → 336 | 300 | 240（−20%） | 6.5 | 8.5（+31%） |
| WebP 2000² → 1200 | 494 | 451（−9%） | 3.8 | 4.2（+10%） |
| JPEG 4000×3000 → 720（两边都用 sharp，对照组） | ≈138 | ≈139 | ≈13.7 | ≈13.7 |

- JPEG 对照组两边持平，说明 PNG/WebP 上的提升来自 Bun.Image，而不是运行时。
- 同质量（q82）下 Bun 输出的 WebP 小 2–10%。
- 峰值内存 576 MiB 降到约 340 MiB。

### OG 卡片渲染（satori → sharp PNG，不走缓存）

| | Node | Bun |
|---|---|---|
| 首次渲染 | ~460 ms | ~275 ms |
| 稳态单次 | 145–150 ms | 142–145 ms |
| 4 并发 | 13.4 ops/s | 12–13 ops/s |
| 峰值内存 | 484–536 MiB | 333–346 MiB |

OG 渲染的主要耗时在 satori 和 sharp，所以稳态速度两边一样。Bun 的冷启动更快，内存也更少。

### Bun.SQL：A/B 结果，不合并

原型在 `bun-sql-ab` 分支（`092fd51`）。设置 `DB_DRIVER=bun` 后，API 改用 `Bun.SQL`；worker 和 pg-boss 不变。它是一层兼容垫片：

- 嵌套片段的参数会重新编号；
- JS 数组转成 PostgreSQL 数组字面量，因为 Bun 1.4.0 的 `sql.array(arr, 25)` 会生成 `$1::JSON[]`；
- `sql.json` 直接透传对象。

Bun.SQL 不暴露结果列的类型，int8/numeric 一律返回字符串，自定义类型解析也会被忽略。为了让数字和原来一致，垫片要先用 postgres.js 的 `describe()` 查一次每条语句的列类型并缓存，所以它其实是个混合方案。21 个公开读接口的响应体与 postgres.js 版逐字节一致。

API 跑在 Bun 上，两种驱动各 4 轮，交替执行，取中位数：

| 接口 | postgres.js RPS | Bun.SQL RPS | 变化 |
|---|---|---|---|
| `/api/v1/items` | 5968 | 6328 | +6% |
| `/api/v1/selected/snapshot` | 1423 | 1414 | −1% |
| `/api/site/home` | 256 | 260 | +2% |
| `/feed.xml` | 1825 | 1638 | −10% |
| `/calendar.ics` | 225 | 184 | −18% |
| `/api/site/timeline`（每次 8 条查询） | 459 | 414 | −10% |
| `/api/site/topics/bang-dream` | 388 | 387 | 0% |
| `/api/site/items/:id` | 2030 | 2230 | +10% |
| SSR `/` / 话题 / 条目 | 63.6 / 70.3 / 159 | 69.7 / 71.4 / 173 | +10% / +2% / +9% |
| 经 web 代理的 items | 2503 | 2823 | +13% |

几何平均 **+0.5%**，远没到事先约定的 10% 门槛。前两轮看起来有 +12%，补到 4 轮后就回到了噪声范围内。再算上上面那些不兼容点（116 处 `sql.json`、36 处数组参数、错误码字段不同、worker 的批量写法不支持），**不合并，继续用 postgres.js**。

### 为什么不重写 Fastify

空结果接口（hot-topics）在 Fastify-on-Bun 上能跑 4.3 万 RPS，而真实业务接口在 180 到 5000 RPS 之间，整套站点的上限卡在 SSR 的 60–170 RPS。框架开销不到真实请求成本的几个百分点，换成 `Bun.serve` 加手写路由，在 2c4g 上看不出收益。反过来要重写 146 个路由、自定义解析器、multipart 和 MCP 的接入，风险不划算。以后如果 API 单独成为瓶颈，再重新评估。

## 注意事项

- 宿主是 macOS 上的 colima 虚拟机，不是真正的 2 核云主机。绝对数值仅供参考，同条件下的相对比较更可靠。
- 每轮之间波动明显（例如 Bun 的 items 接口在不同轮里有 3471、4992、6234 RPS）。这里报的是 3 轮（Bun.SQL 是 4 轮）的中位数；做决策时，看幅度大且方向一致的差异。
- 冷安装和 Docker 构建受网络影响大，只能看趋势。
- 依赖装完后，Bun 的 node_modules 比 npm 大约 60 MiB（布局不同、不去重）。最终镜像仍小了约 10 MB，主要是基础镜像差异。

## 复跑

```sh
# 两个镜像：基线源码和本分支各构建一次
docker build -t gb-bench:node <基线源码目录>
docker build -t gb-bench:bun .
# 整套 HTTP 压测（每次约 20 分钟），结果写到 bench/results/<label>.json
bun bench/run.ts --label node --image gb-bench:node --runtime node --dump <pg_dump.sql.gz>
bun bench/run.ts --label bun  --image gb-bench:bun  --runtime bun  --dump <pg_dump.sql.gz>
# 微基准：OG、图片代理、启动；安装耗时
bun bench/micro.ts
bun bench/install.ts
# 汇总成上面的表
bun bench/summary.ts
```
