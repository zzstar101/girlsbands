// 邮件底部的管理入口是短链 /subscriptions/<token>，它只做一件事：把读者送到订阅管理页
// （早先发出去的长链接 /subscribe/manage?token=… 仍然可用）。转发规则单独放在这里，
// 好让 node --test 能直接跑（路由文件是 .tsx，测试进程不认识）。
/** store.ts 里 token() 是 32 个 base64url 字符；这里放宽一点，只拦明显不是 token 的路径。 */
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * 短链的目标地址，token 形状不对时 null（调用方给 404，而不是带着垃圾去问 api）。
 * 只有退订这一种动作会出现在信里；别的值一律忽略，不让它原样转发出去。
 */
export function managePath(token: string | undefined | null, action: string | null): string | null {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  const query = new URLSearchParams({ token });
  if (action === "unsubscribe") query.set("action", "unsubscribe");
  return `/subscribe/manage?${query}`;
}
