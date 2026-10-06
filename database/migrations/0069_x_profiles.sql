-- X（原 Twitter）账号名与头像的缓存表。Nitter 的 RSS 对一条转推只给作者 handle（`dc:creator`）：
-- 展示名和头像只在订阅自己的 channel title / image 里，那是 feed 主人的，不是转推原文作者的。转发的
-- 推文、被引用的推文因此在入库时缺 authorName / avatarUrl，详情页的 X 卡片会只剩一个 @handle。
--
-- 补齐办法只有一处：fxtwitter 的公开接口（GET https://api.fxtwitter.com/<handle>）。它是按 handle 查的，
-- 读路径（publication/items.ts）禁止发网络请求，所以这里做缓存表，由采集流程顺手填（feed 主人的资料
-- 每次 fetch 免费顺带：channel title 就是「名字 / @handle」，image 就是头像），其余 handle 由
-- 采集后的 enrichment 步骤与 scripts/backfill-x-posts.ts 补，同一 handle 30 天内只查一次
-- （fetched_at 保护，防止一次 backfill 把 fxtwitter 打疼）。
--
-- 列：
--   handle      X 账号的 screen_name，不带 @，主键。一律小写入库、按小写 JOIN：X 的大小写只是展示用，
--               而镜像 feed、fxtwitter、引用链接各写各的，读取层用 lower(x_post->>'handle') 匹配才不会漏。
--   author_name 展示名；查不到（账号不存在/被锁）时留 null，读取层退回 @handle
--   avatar_url  头像原图（pbs.twimg.com），经站内图片代理签名后给页面
--   fetched_at  最后一次成功查询的时间；读取层不看它，写入侧用它做 30 天节流
CREATE TABLE IF NOT EXISTS x_profiles (
  handle text PRIMARY KEY,
  author_name text,
  avatar_url text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
