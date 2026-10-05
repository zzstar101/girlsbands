// 短链 /subscriptions/<token>：邮件底部的管理入口。转发到 /subscribe/manage?token=…（早先发出去的
// 长链接仍然可用），页面本身不渲染任何东西。token 形状不对就当没有这个地址。
import { redirect } from "react-router";
import { managePath } from "../lib/subscribe-link";
import type { Route } from "./+types/subscriptions";

export function loader({ params, request }: Route.LoaderArgs) {
  const target = managePath(params.token, new URL(request.url).searchParams.get("action"));
  if (!target) throw new Response("Not Found", { status: 404 });
  return redirect(target);
}
