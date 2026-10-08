// 邮件样稿：用线上真实数据把几套风格各渲染一遍，发到指定邮箱，并把 HTML 存一份。
//   bun scripts/email-preview.ts --to you@example.com [--styles flyer,brief,cover] [--out /tmp/email-preview]
// 收件人按「全部乐队」算；截止提醒用预览模式（没有 48 小时内的事也出一封）。不写 email_sends，不影响正式发送。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { EMAIL_STYLES } from "@girlsbands/industry/email/registry";
import { deadlineData, digestData } from "../packages/backend/src/subscriptions/content.ts";
import { send } from "../packages/backend/src/subscriptions/send.ts";
import { sql } from "../packages/backend/src/db.ts";

const { values } = parseArgs({ options: { to: { type: "string" }, styles: { type: "string", default: "flyer,brief,cover" }, out: { type: "string", default: "/tmp/email-preview" }, "no-send": { type: "boolean", default: false } } });
const ids = values.styles!.split(",").map((s) => s.trim()).filter(Boolean);
const recipient = { id: 0, email: values.to ?? "preview@example.com", token: "preview", bands: [] as string[] };
const now = new Date();
const digest = await digestData(recipient, now);
const deadline = await deadlineData(recipient, now, { preview: true });
await mkdir(values.out!, { recursive: true });

const LETTERS = "ABCDEFG";
for (const [i, id] of ids.entries()) {
  const style = EMAIL_STYLES[id];
  if (!style) throw new Error(`没有这套风格：${id}`);
  for (const data of [digest, deadline]) {
    if (!data) continue;
    const mail = style.render(data);
    const label = `样稿 ${LETTERS[i]}·${style.name}`;
    await writeFile(path.join(values.out!, `${id}-${data.kind}.html`), mail.html);
    if (values["no-send"] || !values.to) continue;
    const r = await send({ to: values.to, subject: `【${label}】${mail.subject}`, html: mail.html, text: mail.text });
    console.log(label, data.kind, r.status, r.response.slice(0, 80));
  }
}
console.log(`digest ${digest?.items.length ?? 0} 条，deadline ${deadline?.days.reduce((n, d) => n + d.items.length, 0) ?? 0} 件；HTML 在 ${values.out}`);
await sql.end();
