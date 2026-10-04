// 邮件订阅的公开接口。
//
// 一条规则贯穿全部端点：**未经验证的请求不能暴露、也不能修改别人的订阅**。
//   - POST /subscribe 永远回答同一句话，不区分「已订阅」和「刚发出确认信」；
//   - 改偏好和退订都必须带邮件里那条带令牌的链接；
//   - 浏览器里退订是两步（页面上再点一次），邮件客户端走 RFC 8058 的一键 POST。
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SubscribeRequest, SubscribeResponse, SubscriptionState, SubscriptionUpdateRequest } from "@girlsbands/contracts/site";
import { emailStyle } from "@girlsbands/industry/email/registry";
import { config } from "@girlsbands/backend/config";
import { Rejected, rateLimit, sourceFingerprint } from "@girlsbands/backend/operations/abuse";
import { byToken, confirm, subscribe, unsubscribe, updatePreferences } from "@girlsbands/backend/subscriptions/store";
import { confirmData } from "@girlsbands/backend/subscriptions/content";
import { deliverEmail, mailer } from "@girlsbands/backend/subscriptions/send";
import { sendProblem } from "../http/respond.ts";

const NO_STORE = "no-store";

function clientSource(req: FastifyRequest): string {
  return sourceFingerprint(String(req.headers["x-real-ip"] ?? req.ip ?? ""), String(req.headers["user-agent"] ?? ""));
}

function asObject(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function readBands(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function redirect(reply: FastifyReply, path: string, query = "") {
  return reply.header("Cache-Control", NO_STORE).redirect(`${path}${query}`, 302);
}

export function registerSubscribe(app: FastifyInstance) {
  // 订阅会发信：比反馈更严（3 次/分钟/来源），免得有人拿它刷别人的邮箱。
  app.post("/api/site/subscribe", async (req, reply) => {
    try {
      rateLimit(clientSource(req), 3, "提交太频繁，请稍后再试。");
      const body = asObject(req.body) as Partial<SubscribeRequest>;
      const state = mailer();
      if (!state.ready) {
        req.log.warn({ reason: (state as { reason: string }).reason }, "subscribe unavailable");
        return sendProblem(req, reply, { status: 503, code: "temporarily_unavailable", detail: "邮件订阅暂未开放。", retryAfter: 3600 });
      }
      const outcome = await subscribe({
        email: String(body.email ?? ""),
        bands: readBands(body.bands),
        wantsDeadlines: readBool(body.wantsDeadlines, true),
        wantsDigest: readBool(body.wantsDigest, true),
        source: "web",
        sourceHash: clientSource(req),
      });
      if (!outcome) return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: "邮箱格式不正确。" });

      // 已确认的老订阅者不动他的设置、也不再发信；回给他同一句「去邮箱点确认」。
      if (outcome.needsConfirm) {
        const sub = outcome.subscriber;
        const mail = emailStyle(config.emailStyle).render(
          await confirmData({
            email: sub.email,
            token: sub.token,
            confirmToken: sub.confirmToken,
            bands: sub.bands,
            wantsDeadlines: sub.wantsDeadlines,
            wantsDigest: sub.wantsDigest,
          }),
        );
        await deliverEmail(sub.id, "confirm", `confirm:${sub.confirmToken}`, { to: sub.email, ...mail });
      }
      const answer: SubscribeResponse = { ok: true };
      return reply.header("Cache-Control", NO_STORE).code(202).send(answer);
    } catch (error) {
      if (error instanceof Rejected) return sendProblem(req, reply, { status: error.status, code: error.code, detail: error.message, retryAfter: error.retryAfter });
      req.log.error({ err: error }, "subscribe failed");
      return sendProblem(req, reply, { status: 503, code: "temporarily_unavailable", detail: "暂时无法订阅，请稍后再试。", retryAfter: 30 });
    }
  });

  // 确认信里的链接。成功与否都用 302 落到页面上，让人看到一句中文说明，而不是一个 JSON 错误。
  app.get("/api/site/subscribe/confirm", async (req, reply) => {
    try {
      rateLimit(`confirm:${clientSource(req)}`, 20);
      const token = String((req.query as Record<string, string>).token ?? "");
      const result = await confirm(token);
      return redirect(reply, "/subscribe/confirmed", `?state=${result.ok ? "ok" : result.reason}`);
    } catch (error) {
      if (error instanceof Rejected) return redirect(reply, "/subscribe/confirmed", "?state=error");
      req.log.error({ err: error }, "confirm failed");
      return redirect(reply, "/subscribe/confirmed", "?state=error");
    }
  });

  // 管理页读自己的状态：只有拿着邮件里那条令牌才能读到。
  app.get("/api/site/subscribe/state", async (req, reply) => {
    try {
      rateLimit(`state:${clientSource(req)}`, 20);
      const token = String((req.query as Record<string, string>).token ?? "");
      const sub = await byToken(token);
      if (!sub) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "链接无效或已失效。" });
      const state: SubscriptionState = {
        email: sub.email,
        bands: sub.bands,
        wantsDeadlines: sub.wantsDeadlines,
        wantsDigest: sub.wantsDigest,
        confirmed: sub.status === "confirmed",
      };
      return reply.header("Cache-Control", NO_STORE).send(state);
    } catch (error) {
      if (error instanceof Rejected) return sendProblem(req, reply, { status: error.status, code: error.code, detail: error.message, retryAfter: error.retryAfter });
      req.log.error({ err: error }, "subscription state failed");
      return sendProblem(req, reply, { status: 503, code: "temporarily_unavailable", detail: "暂时无法读取订阅，请稍后再试。", retryAfter: 30 });
    }
  });

  // 保存偏好，或者退订（unsubscribe=true）。两者都需要令牌。
  app.post("/api/site/subscribe/preferences", async (req, reply) => {
    try {
      rateLimit(`prefs:${clientSource(req)}`, 10);
      const body = asObject(req.body) as Partial<SubscriptionUpdateRequest>;
      const token = String(body.token ?? "");
      if (body.unsubscribe === true) {
        const ok = await unsubscribe(token);
        if (!ok) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "链接无效或已失效。" });
        return reply.header("Cache-Control", NO_STORE).send({ ok: true, status: "unsubscribed" });
      }
      const updated = await updatePreferences(token, {
        bands: readBands(body.bands),
        wantsDeadlines: readBool(body.wantsDeadlines, true),
        wantsDigest: readBool(body.wantsDigest, true),
      });
      if (!updated) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "链接无效或已失效。" });
      return reply.header("Cache-Control", NO_STORE).send({ ok: true, status: "saved" });
    } catch (error) {
      if (error instanceof Rejected) return sendProblem(req, reply, { status: error.status, code: error.code, detail: error.message, retryAfter: error.retryAfter });
      req.log.error({ err: error }, "preferences failed");
      return sendProblem(req, reply, { status: 503, code: "temporarily_unavailable", detail: "暂时无法保存，请稍后再试。", retryAfter: 30 });
    }
  });

  // RFC 8058 一键退订：邮件客户端的按钮 POST 到这里。GET 不生效，免得链接扫描器帮人退订。
  app.post("/api/site/subscribe/one-click", async (req, reply) => {
    try {
      rateLimit(`oneclick:${clientSource(req)}`, 20);
      const token = String((req.query as Record<string, string>).token ?? "");
      await unsubscribe(token);
      // 无论令牌有没有效都回 200：一键退订不该让邮件客户端弹出错误。
      return reply.header("Cache-Control", NO_STORE).type("text/plain; charset=utf-8").send("已退订。");
    } catch (error) {
      if (error instanceof Rejected) return reply.header("Cache-Control", NO_STORE).code(200).type("text/plain; charset=utf-8").send("已退订。");
      req.log.error({ err: error }, "one-click unsubscribe failed");
      return reply.header("Cache-Control", NO_STORE).code(200).type("text/plain; charset=utf-8").send("已退订。");
    }
  });
}
