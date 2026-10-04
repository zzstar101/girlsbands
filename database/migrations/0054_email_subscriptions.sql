-- 邮件订阅：每个邮箱一行，他们关注的乐队，以及发出去的每一封信。
-- 刻意和 notify_targets / deliveries 分开：那两张表面向固定的聊天群，一行一个目的地；
-- 订阅是「一行一个收件人」，去重的粒度、退订的粒度、风控的粒度都不一样，混在一起会互相绊住。
-- 这里没有任何东西是对外公开的：接口不提供订阅者列表，只有后台能看到。

CREATE TABLE subscribers (
  id                 bigserial PRIMARY KEY,
  -- 保留用户输入的原样拼写，只用于显示（邮件里喊他一声）。
  email              text NOT NULL,
  -- 身份是小写地址，唯一键建在它上面：A@x.com 和 a@x.com 是同一个人。
  email_key          text NOT NULL UNIQUE,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'confirmed', 'unsubscribed', 'bounced')),
  -- 长期令牌：管理偏好和退订都用它。只有用户主动要求重发才会轮换。
  token              text NOT NULL UNIQUE,
  -- 短期令牌：证明这个邮箱是他的。每发一封确认信就换一个，过期作废。
  confirm_token      text NOT NULL UNIQUE,
  confirm_expires_at timestamptz,
  wants_deadlines    boolean NOT NULL DEFAULT true,
  wants_digest       boolean NOT NULL DEFAULT true,
  confirmed_at       timestamptz,
  unsubscribed_at    timestamptz,
  -- 从哪张页面订阅的，出问题时好定位。
  source             text,
  -- 客户端地址 + 浏览器家族的 HMAC（和反馈同一套做法）：能限流，但存不下明文地址。
  source_hash        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscribers_status_idx ON subscribers (status, created_at);

-- 没勾任何乐队 = 全部：新读者还没想好要盯谁时，不该收到一封空邮件。
CREATE TABLE subscriber_bands (
  subscriber_id bigint NOT NULL REFERENCES subscribers (id) ON DELETE CASCADE,
  entity_id     text NOT NULL,
  PRIMARY KEY (subscriber_id, entity_id)
);

-- 每封信一行。既是运维能看的发送记录，也是「重跑一次不会重复发」的依据：
-- (subscriber_id, dedupe_key) 唯一，同一封信第二次只会撞上已存在的行。
CREATE TABLE email_sends (
  id            bigserial PRIMARY KEY,
  subscriber_id bigint REFERENCES subscribers (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('confirm', 'deadline', 'digest')),
  dedupe_key    text NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts      integer NOT NULL DEFAULT 0,
  subject       text,
  -- SMTP 的返回值或错误摘要，出问题时不用翻日志。
  response      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscriber_id, dedupe_key)
);

CREATE INDEX email_sends_status_idx ON email_sends (status, created_at);
