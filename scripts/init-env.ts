// Creates .env from .env.example with fresh random secrets and an admin password, and prints the password
// once. Refuses to overwrite an existing .env.   node scripts/init-env.ts [--llm-key <key>]
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

if (existsSync(".env")) {
  console.error(".env 已经存在，没有覆盖。要重新生成，先把它改名或删掉。");
  process.exit(1);
}
const password = randomBytes(12).toString("base64url");
const keyAt = process.argv.indexOf("--llm-key");
const llmKey = keyAt > 0 ? (process.argv[keyAt + 1] ?? "") : "";

// Everything that reaches outside the deployment: collecting, paying a model, pushing to Feishu,
// submitting to IndexNow, sending mail. A fresh .env always gets all of them off, whatever the template
// says, so the first `docker compose up` comes up quiet and the operator can look at the site and the
// admin before anything is collected or paid for. Turn them on one at a time, then restart api and worker.
const VALVES = [
  "COLLECT_ENABLED",
  "MODEL_CALLS_ENABLED",
  "FEISHU_CONTENT_PUSH_ENABLED",
  "FEISHU_INTERNAL_ENABLED",
  "INDEXNOW_SUBMIT_ENABLED",
  "EMAIL_ENABLED",
];

let text = readFileSync(".env.example", "utf8")
  .replace(/^ADMIN_PASSWORD=$/m, `ADMIN_PASSWORD=${password}`)
  .replace(/^SESSION_SECRET=$/m, `SESSION_SECRET=${randomBytes(32).toString("hex")}`)
  .replace(/^IMG_PROXY_SIGN_SECRET=$/m, `IMG_PROXY_SIGN_SECRET=${randomBytes(32).toString("hex")}`)
  .replace(/^POSTGRES_PASSWORD=$/m, `POSTGRES_PASSWORD=${randomBytes(18).toString("hex")}`)
  .replace(/^LLM_API_KEY=$/m, `LLM_API_KEY=${llmKey}`);
for (const name of VALVES) text = text.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=false`);
text = `${text.replace(/\n*$/, "\n")}
# 上面 ${VALVES.length} 个开关现在都是 false：站点能打开、后台能登录，但不抓信源、不调模型、不发飞书、
# 不交 IndexNow、不发邮件。确认 SITE_URL 填的是读者实际访问的地址、备案号填好了、后台也看过一遍，
# 再按需要逐个改成 true，然后 docker compose up -d api worker。
`;
writeFileSync(".env", text, { mode: 0o600 });
console.log("已生成 .env。");
console.log(`管理员密码：${password}（也写在 .env 的 ADMIN_PASSWORD 里）`);
if (!llmKey) console.log("还差一步：在 .env 里填上 LLM_API_KEY（以及 LLM_BASE_URL、LLM_MODEL，默认是 DeepSeek）。");
