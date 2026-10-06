-- 默认模型的每分钟预算从 300 降到 100：nerv-base 等网关 60 秒内超过 120 次就回 429，
-- 300 等于没限。worker 发送前按这个数平滑排队（providers/receipts.ts waitForSendSlot），
-- 这里的值同时是熔断上限。只改仍是旧默认值的行，后台调过的不动。
UPDATE budgets SET per_minute = 100, updated_at = now() WHERE service = 'llm' AND per_minute = 300;
