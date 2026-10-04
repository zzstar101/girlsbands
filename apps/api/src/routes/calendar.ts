// The .ics exports. Same arrangement as the feeds: served here, put on the main domain by the reverse
// proxy. A reader subscribes once and their own calendar then carries every date the site knows.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { calendarIcs, calendarSubject } from "@girlsbands/backend/publication/calendar";
import { applyPublicHeaders, sendTextWithEtag } from "../http/respond.ts";

// Six hours, the interval the file itself advertises.
const CACHE = "public, max-age=600, s-maxage=600";

function icsError(req: FastifyRequest, reply: FastifyReply, error: unknown) {
  req.log.error({ err: error }, "calendar error");
  return reply.code(503).header("Retry-After", "60").header("Cache-Control", "no-store").type("text/plain; charset=utf-8").send("Calendar temporarily unavailable");
}

export function registerCalendar(app: FastifyInstance) {
  for (const url of ["/calendar.ics", "/calendar/:file"]) {
    app.options(url, async (_req, reply) => reply.code(204).header("Allow", "GET, HEAD, OPTIONS").send());
  }

  const send = (subject?: string) => async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const ics = await calendarIcs(new Date(), subject);
      applyPublicHeaders(reply, { cors: false });
      return await sendTextWithEtag(req, reply, ics, { etagPrefix: "ics", cacheControl: CACHE, contentType: "text/calendar; charset=utf-8" });
    } catch (error) {
      return icsError(req, reply, error);
    }
  };

  app.get("/calendar.ics", send());

  // One file per subject (`/calendar/<entity>.ics`): a project's dates carry its bands' dates too.
  app.get("/calendar/:file", async (req, reply) => {
    const file = (req.params as { file: string }).file;
    const subject = file.endsWith(".ics") ? calendarSubject(file.slice(0, -".ics".length)) : null;
    if (!subject) return reply.code(404).type("text/plain; charset=utf-8").send("Not found");
    return send(subject.id)(req, reply);
  });
}
