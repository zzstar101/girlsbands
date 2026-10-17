import type { FastifyInstance } from "fastify";
import { FeedbackRejected, submitFeedback, feedbackChallengeConfig, verifyFeedbackChallenge, type FeedbackInput } from "@girlsbands/backend/operations/feedback";
import { sendProblem } from "../http/respond.ts";
import { rateLimit, sourceFingerprint } from "@girlsbands/backend/operations/abuse";

type FeedbackBody = Pick<FeedbackInput, "content" | "email" | "pageUrl" | "screenshot" | "targetKind" | "targetId" | "targetField" | "expected"> & { challengeToken: string | null };

/** The feedback form as the site posts it: multipart, with at most one screenshot file. */
async function readForm(raw: unknown, contentType: string): Promise<FeedbackBody> {
  const form = await new Response(raw as Buffer<ArrayBuffer>, { headers: { "content-type": contentType } }).formData().catch(() => {
    throw new FeedbackRejected(400, "invalid_request", "截图上传格式不正确，请重新提交。");
  });
  const text = (key: string) => {
    const value = form.get(key);
    if (value !== null && typeof value !== "string") throw new FeedbackRejected(400, "invalid_request", "反馈文字格式不正确。");
    return value;
  };
  const file = form.get("screenshot");
  if (file !== null && !(file instanceof File)) throw new FeedbackRejected(400, "invalid_request", "截图上传格式不正确。");
  return {
    content: text("content") ?? "", email: text("email"), pageUrl: text("pageUrl"), challengeToken: text("cf-turnstile-response"),
    // W18: the "报告问题" dialog and /submit add what the report is about; the plain form sends none.
    targetKind: text("targetKind"), targetId: text("targetId"), targetField: text("targetField"), expected: text("expected"),
    screenshot: file ? { mime: file.type, data: Buffer.from(await file.arrayBuffer()) } : null,
  };
}

export function registerFeedback(app: FastifyInstance) {
  app.get('/api/site/feedback/config', async (_req, reply) => reply.header('Cache-Control', 'no-store').send(feedbackChallengeConfig()));
  // Bounded by the same request limit as JSON; native multipart parsing avoids base64 on the wire.
  app.addContentTypeParser("multipart/form-data", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  app.post("/api/site/feedback", { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    try {
      const ip = req.ip;
      const userAgent = String(req.headers['user-agent'] ?? '');
      // Trust Fastify's configured proxy chain, not a caller-supplied x-real-ip header.
      rateLimit(`feedback-verify:${sourceFingerprint(ip, '')}`);
      const { challengeToken, ...body } = await readForm(req.body, String(req.headers["content-type"] ?? ""));
      await verifyFeedbackChallenge(challengeToken, ip);
      const result = await submitFeedback({ ...body, ip, userAgent });
      return reply.header("Cache-Control", "no-store").code(201).send(result);
    } catch (error) {
      if (error instanceof FeedbackRejected) return sendProblem(req, reply, { status: error.status, code: error.code, detail: error.message, retryAfter: error.retryAfter });
      req.log.error({ err: error }, "feedback failed");
      return sendProblem(req, reply, { status: 503, code: "temporarily_unavailable", detail: "暂时无法提交，请稍后再试。", retryAfter: 30 });
    }
  });
}
