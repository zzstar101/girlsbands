-- 反馈改成转发到站主邮箱（FEEDBACK_EMAIL），飞书没配也能收到；后台可以直接回信给留了邮箱的读者。
-- 每封回信记一行：谁回的、写了什么、发没发出去。
CREATE TABLE IF NOT EXISTS feedback_replies (
  id          bigserial PRIMARY KEY,
  feedback_id bigint NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  body        text NOT NULL,
  actor       text NOT NULL,
  status      text NOT NULL CHECK (status IN ('sent', 'failed')),
  response    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_replies_feedback_idx ON feedback_replies (feedback_id, created_at);

-- 发到站主邮箱的时间；和 forwarded_at（「已经送到某个地方」）分开，飞书和邮件两条路互不挡。
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
