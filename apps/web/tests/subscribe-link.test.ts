// 邮件底部的短链 /subscriptions/<token> 只负责把人送到订阅管理页。这里盯住三件事：
// 地址里带的必须是原来那个 token、只有退订会被转发、不像 token 的路径拿不到目标（路由给 404）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { managePath } from "../app/lib/subscribe-link.ts";

// store.ts 的 token()：randomBytes(24).toString("base64url")。
const token = "F0zS6vJm2Qk1xWp8bTn4LdRyEaHcUg9A";

test("a real token is sent to the manage page, unchanged", () => {
  assert.equal(managePath(token, null), `/subscribe/manage?token=${token}`);
  // 老的长链接就是这个形状，短链只是换了个入口。
  assert.equal(new URL(managePath(token, null)!, "https://example.test").searchParams.get("token"), token);
});

test("only unsubscribe travels with it", () => {
  const unsubscribe = managePath(token, "unsubscribe");
  assert.equal(unsubscribe, `/subscribe/manage?token=${token}&action=unsubscribe`);
  // 别的动作（自己拼的、抄来的）一律丢掉，不让它原样转发出去。
  for (const action of ["delete", "unsubscribe-all", "UNSUBSCRIBE", "", " "]) {
    assert.equal(managePath(token, action), `/subscribe/manage?token=${token}`, action);
  }
});

test("anything that is not a token has no target at all", () => {
  for (const bad of [undefined, null, "", "short", "a".repeat(65), "../subscribe/manage?token=x", "token with spaces", "0x8f/../etc", "日本語のトークン"]) {
    assert.equal(managePath(bad, null), null, String(bad));
    assert.equal(managePath(bad, "unsubscribe"), null, String(bad));
  }
});
