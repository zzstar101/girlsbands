// Verifies the feedback challenge end to end in a real Chromium, without Cloudflare or the real API:
// a local fake script, a local fake config/feedback API, and the production web build.
//
//   bun scripts/verify-feedback-ui.ts [--no-build] [--port 61879]
//
// Playwright is resolved from the project or a global install (`npm root -g`); set PLAYWRIGHT_MODULE
// to an absolute playwright/index.mjs when it lives elsewhere. Screenshots go to .data/feedback-ui-review/.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, ".data/feedback-ui-review");
const args = process.argv.slice(2);
const noBuild = args.includes("--no-build");
const portArg = args.indexOf("--port");
const WEB_PORT = Number(portArg >= 0 ? args[portArg + 1] : process.env.FEEDBACK_UI_PORT ?? "61879");
if (!Number.isInteger(WEB_PORT) || WEB_PORT < 1024 || WEB_PORT > 65535) throw new Error(`invalid --port: ${args[portArg + 1] ?? ""}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let checks = 0;
function ok(condition: unknown, message: string): asserts condition {
  checks += 1;
  if (!condition) throw new Error(message);
}
async function check(name: string, fn: () => Promise<void> | void) {
  const started = Date.now();
  try {
    await fn();
    console.log(`✓ ${name} (${Date.now() - started}ms)`);
  } catch (error) {
    console.log(`✗ ${name} (${Date.now() - started}ms)`);
    throw error;
  }
}
function field(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
}

async function importPlaywright(): Promise<any> {
  const candidates: string[] = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  candidates.push("playwright");
  try {
    const root = Bun.spawnSync(["npm", "root", "-g"], { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim();
    if (root) candidates.push(path.join(root, "playwright", "index.mjs"), path.join(root, "playwright", "index.js"));
  } catch {
    // A global npm root is only one possible location; the explicit candidates above may still work.
  }
  for (const candidate of candidates) {
    const specifier = path.isAbsolute(candidate) ? pathToFileURL(candidate).href : candidate;
    try { return await import(specifier); } catch { /* try the next location */ }
  }
  throw new Error("Playwright not found. Install it (`npm i -g playwright` and `playwright install chromium`) or set PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs");
}

const playwright = await importPlaywright();
if (!noBuild) {
  const build = Bun.spawnSync(["bun", "run", "--filter", "@girlsbands/web", "build"], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (build.exitCode !== 0) throw new Error("web build failed");
}

await mkdir(OUT, { recursive: true });

// ---------------------------------------------------------------------------------------------------
// Local fakes. The browser never resolves challenges.cloudflare.com, and siteverify never happens.
// ---------------------------------------------------------------------------------------------------
const ITEM = {
  id: "test-item", title: "本地验证用条目", originalTitle: null, summary: "这是本地假 API 返回的条目。", reason: null,
  source: { name: "本地假 API" }, links: { original: "https://example.invalid/item" },
  publishedAt: "2026-10-01T00:00:00Z", discoveredAt: "2026-10-01T00:00:00Z", timelineAt: "2026-10-01T00:00:00Z",
  category: null, tags: [], subjects: [], organizer: null, score: null, selected: false, channel: "news", story: null,
  x: null, readingMode: "full", author: null, cover: null,
  body: { zh: "<p>本地验证用正文。</p>", original: null, zhKind: "original", complete: true },
  outline: [], relatedStories: [], topics: [], indexable: true, markdownAvailable: false, group: null,
  hasTranslation: false, bodyLanguage: "zh",
};
const fakeChallenge = `(() => {
  const state = window.__challenge = { renders: [], removed: [], options: {}, tokens: 0 };
  window.turnstile = {
    render(container, options) {
      const id = 'w' + (state.renders.length + 1);
      state.renders.push({ id, sitekey: options.sitekey, action: options.action, responseField: options['response-field'] });
      state.options[id] = options;
      const el = document.createElement('button');
      el.type = 'button'; el.dataset.widget = id; el.textContent = '完成人机验证';
      el.onclick = () => { state.tokens += 1; options.callback('fake-token-' + state.tokens); };
      container.appendChild(el);
      return id;
    },
    remove(id) {
      state.removed.push(id);
      const el = document.querySelector('[data-widget="' + id + '"]');
      if (el) el.remove();
    },
  };
  state.lastId = () => state.renders.length ? state.renders[state.renders.length - 1].id : null;
  state.fire = (id, name, arg) => { const options = state.options[id]; if (!options) throw new Error('unknown widget ' + id); options[name](arg); };
})();`;

interface Post {
  token: string | null; content: string; email: string; pageUrl: string;
  targetKind: string | null; targetId: string | null; targetField: string | null; expected: string | null;
  screenshot: string | null;
}
const posts: Post[] = [];
let configRequests = 0;
let configMode: "ok" | "missing" | "error" = "ok";
let configDelayMs = 0;
let reply: { status: number; body: unknown } = { status: 201, body: { id: 42 } };
let scriptMode: "ok" | "fail" = "ok";
let scriptDelayMs = 0;
let scriptLoads = 0;

const api = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/site/feedback/config") {
      configRequests += 1;
      if (configDelayMs) await sleep(configDelayMs);
      if (configMode === "error") return new Response("configuration unavailable", { status: 500 });
      return Response.json({ siteKey: configMode === "missing" ? null : "local-site-key" }, { headers: { "cache-control": "no-store" } });
    }
    if (url.pathname === "/api/site/feedback" && request.method === "POST") {
      const form = await request.formData().catch(() => null);
      if (!form) return Response.json({ detail: "本地假 API 无法解析表单。" }, { status: 400 });
      const file = form.get("screenshot");
      posts.push({
        token: field(form, "cf-turnstile-response"), content: field(form, "content") ?? "",
        email: field(form, "email") ?? "", pageUrl: field(form, "pageUrl") ?? "",
        targetKind: field(form, "targetKind"), targetId: field(form, "targetId"),
        targetField: field(form, "targetField"), expected: field(form, "expected"),
        screenshot: file instanceof File ? file.name : null,
      });
      return Response.json(reply.body, { status: reply.status });
    }
    if (url.pathname === "/api/site/items/test-item") return Response.json(ITEM);
    if (url.pathname === "/api/site/pv") return new Response(null, { status: 204 });
    return new Response("not found", { status: 404 });
  },
});
const apiBase = `http://127.0.0.1:${api.port}`;
const BASE = `http://127.0.0.1:${WEB_PORT}`;

const web = Bun.spawn(["bun", "apps/web/server.ts"], {
  cwd: ROOT,
  env: { ...process.env, WEB_PORT: String(WEB_PORT), API_BASE_URL: apiBase },
  stdout: "inherit",
  stderr: "inherit",
});
async function stopWeb() {
  if (web.exitCode !== null) return;
  web.kill("SIGTERM");
  for (let i = 0; i < 30 && web.exitCode === null; i++) await sleep(100);
  if (web.exitCode === null) web.kill("SIGKILL");
}
let browser: any;
try {
  for (let i = 0; i < 100; i++) {
    if (web.exitCode !== null) throw new Error(`web server exited on port ${WEB_PORT}; is the port already in use?`);
    if (await fetch(`${BASE}/feedback`).then((r) => r.ok).catch(() => false)) break;
    await sleep(100);
    if (i === 99) throw new Error(`web server did not start on ${BASE}`);
  }

  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (error) {
    console.error(`✗ Chromium could not start on this machine. Playwright found, browser missing or blocked:\n${String(error)}`);
    process.exitCode = 2;
    throw error;
  }

  // One context per scenario keeps loader/window state honest. The API is shared and reset per test.
  async function scenario(name: string) {
    const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
    const page = await context.newPage();
    const requests = { challenge: [] as string[], config: 0, errors: [] as string[] };
    page.on("request", (request: any) => {
      const url = new URL(request.url());
      if (url.hostname === "challenges.cloudflare.com") requests.challenge.push(request.url());
      if (url.pathname === "/api/site/feedback/config") requests.config += 1;
    });
    page.on("pageerror", (error: Error) => requests.errors.push(error.message));
    await context.route("https://challenges.cloudflare.com/**", async (route: any) => {
      const url = new URL(route.request().url());
      if (url.pathname !== "/turnstile/v0/api.js") {
        requests.errors.push(`unexpected external challenge request: ${route.request().url()}`);
        await route.abort("blockedbyclient");
        return;
      }
      scriptLoads += 1;
      if (scriptDelayMs) await sleep(scriptDelayMs);
      if (scriptMode === "fail") await route.abort("failed");
      else await route.fulfill({ status: 200, contentType: "text/javascript", body: fakeChallenge });
    });
    return {
      context, page, requests,
      async goto(pathname: string) {
        await page.goto(BASE + pathname, { waitUntil: "load" });
        await page.waitForLoadState("domcontentloaded");
      },
      async widget() { await page.getByRole("button", { name: "完成人机验证" }).waitFor({ timeout: 5000 }); },
      async close() { await context.close(); },
    };
  }
  const issueState = () => `${posts.length} post(s), ${configRequests} config request(s)`;
  async function noUnexpectedErrors(page: any, errors: string[]) {
    await page.waitForTimeout(50);
    ok(errors.length === 0, `unexpected page error: ${errors.join(" | ")}`);
  }
  async function shot(page: any, name: string, locator?: any) {
    await (locator ?? page).screenshot({ path: path.join(OUT, name) });
  }

  // 1. /feedback: no token, verification, submission, reset.
  await check("/feedback: token gates submission, cf-turnstile-response, success resets the widget", async () => {
    configMode = "ok"; configDelayMs = 0; scriptMode = "ok"; scriptDelayMs = 0; reply = { status: 201, body: { id: 42 } };
    const s = await scenario("feedback-happy");
    const beforePosts = posts.length;
    try {
      await s.goto("/feedback");
      await s.widget();
      const state = await s.page.evaluate(() => window.__challenge);
      ok(state.renders.length === 1, `expected one widget, got ${state.renders.length}`);
      ok(state.renders[0].action === "feedback", `action is ${state.renders[0].action}`);
      ok(state.renders[0]["responseField"] === false, "response-field must be false");
      ok(state.renders[0].sitekey === "local-site-key", `sitekey is ${state.renders[0].sitekey}`);
      ok(await s.page.getByRole("button", { name: "发送反馈" }).isDisabled(), "submit must be disabled before verification");

      await s.page.fill("#fb-content", "本地浏览器验证：日期显示不对");
      await s.page.fill("#fb-email", "reader@example.invalid");
      await s.page.locator("form").first().evaluate((form: HTMLFormElement) => form.requestSubmit());
      await s.page.getByText("请先完成人机验证").waitFor({ timeout: 2000 });
      ok(posts.length === beforePosts, `a tokenless submission reached the API (${issueState()})`);

      await s.page.getByRole("button", { name: "完成人机验证" }).click();
      await s.page.waitForTimeout(50);
      ok(!(await s.page.getByRole("button", { name: "发送反馈" }).isDisabled()), "submit must enable after verification");
      await s.page.getByText("请先完成人机验证").waitFor({ state: "hidden", timeout: 2000 });
      await shot(s.page, "feedback-verified.png");

      await s.page.getByRole("button", { name: "发送反馈" }).click();
      await s.page.getByText("收到了，谢谢你").waitFor({ timeout: 5000 });
      await s.page.getByText("反馈编号").waitFor();
      ok(posts.length === 1, `expected one POST, got ${posts.length}`);
      ok(posts[0].token === "fake-token-1", `cf-turnstile-response was ${posts[0].token}`);
      ok(posts[0].content === "本地浏览器验证：日期显示不对", "content changed on the wire");
      ok(posts[0].email === "reader@example.invalid", "email changed on the wire");
      ok(posts[0].pageUrl === "", `pageUrl was ${posts[0].pageUrl}`);
      const after = await s.page.evaluate(() => window.__challenge);
      ok(after.removed.includes("w1"), `widget was not removed after success: ${after.removed}`);
      ok(!(await s.page.locator("[data-widget]").count()), "widget DOM survived the success screen");
      await noUnexpectedErrors(s.page, s.requests.errors);
    } finally { await s.close(); }
  });

  // 2. Failure keeps the text, clears the token, and mounts a fresh widget.
  await check("/feedback: failure preserves text, clears the token and re-renders the widget", async () => {
    configMode = "ok"; configDelayMs = 0; scriptMode = "ok"; scriptDelayMs = 0;
    reply = { status: 400, body: { detail: "本地假服务拒绝了这次提交。" } };
    const s = await scenario("feedback-failure");
    const beforePosts = posts.length;
    try {
      await s.goto("/feedback");
      await s.widget();
      await s.page.getByRole("button", { name: "完成人机验证" }).click();
      await s.page.fill("#fb-content", "失败时这段文字必须保留");
      await s.page.fill("#fb-email", "keep@example.invalid");
      await s.page.getByRole("button", { name: "发送反馈" }).click();
      await s.page.getByText("本地假服务拒绝了这次提交。").waitFor({ timeout: 3000 });
      ok(await s.page.inputValue("#fb-content") === "失败时这段文字必须保留", "textarea changed after a failed submit");
      ok(await s.page.inputValue("#fb-email") === "keep@example.invalid", "email changed after a failed submit");
      ok(await s.page.getByRole("button", { name: "发送反馈" }).isDisabled(), "token was not cleared after a failed submit");
      const state = await s.page.evaluate(() => window.__challenge);
      ok(state.renders.length === 2, `expected a fresh widget after failure, got ${state.renders.length} renders`);
      ok(state.removed.includes("w1") && !state.removed.includes("w2"), `old widget lifecycle was ${JSON.stringify(state.removed)}`);
      await shot(s.page, "feedback-error.png");

      reply = { status: 201, body: { id: 43 } };
      await s.page.getByRole("button", { name: "完成人机验证" }).click();
      await s.page.getByRole("button", { name: "发送反馈" }).click();
      await s.page.getByText("收到了，谢谢你").waitFor({ timeout: 5000 });
      ok(posts.length === beforePosts + 2 && posts[beforePosts + 1].token === "fake-token-2", `second token was ${posts[beforePosts + 1]?.token}`);
      await noUnexpectedErrors(s.page, s.requests.errors);
    } finally { await s.close(); }
  });

  // 3. expired / error / timeout callbacks.
  await check("/feedback: expired, error and timeout callbacks clear the token", async () => {
    configMode = "ok"; configDelayMs = 0; scriptMode = "ok"; scriptDelayMs = 0;
    const s = await scenario("feedback-callbacks");
    try {
      await s.goto("/feedback");
      await s.widget();
      await s.page.fill("#fb-content", "验证码状态测试");
      await s.page.getByRole("button", { name: "完成人机验证" }).click();
      await s.page.waitForTimeout(30);
      ok(!(await s.page.getByRole("button", { name: "发送反馈" }).isDisabled()), "verification did not enable submit");

      await s.page.evaluate(() => window.__challenge.fire("w1", "expired-callback"));
      await s.page.waitForTimeout(30);
      ok(await s.page.getByRole("button", { name: "发送反馈" }).isDisabled(), "expired-callback did not clear the token");

      await s.page.getByRole("button", { name: "完成人机验证" }).click();
      await s.page.evaluate(() => window.__challenge.fire("w1", "error-callback"));
      await s.page.getByText("人机验证未完成").waitFor({ timeout: 2000 });
      ok(await s.page.getByRole("button", { name: "发送反馈" }).isDisabled(), "error-callback did not clear the token");

      await s.page.getByRole("button", { name: "完成人机验证" }).click();
      await s.page.evaluate(() => window.__challenge.fire("w1", "timeout-callback"));
      await s.page.waitForTimeout(30);
      ok(await s.page.getByRole("button", { name: "发送反馈" }).isDisabled(), "timeout-callback did not clear the token");
      await noUnexpectedErrors(s.page, s.requests.errors);
    } finally { await s.close(); }
  });

  // 4. Script load failure, then the page's retry button.
  await check("/feedback: a failed challenge script leaves the form and a retry loads it", async () => {
    configMode = "ok"; configDelayMs = 0; scriptMode = "fail"; scriptDelayMs = 0;
    const s = await scenario("feedback-script-failure");
    try {
      await s.goto("/feedback");
      await s.page.getByText("人机验证暂时不可用").waitFor({ timeout: 5000 });
      ok(await s.page.inputValue("#fb-content") !== undefined, "form disappeared after a script failure");
      const contact = await s.page.getByRole("link", { name: "联系邮箱" }).getAttribute("href");
      ok(contact?.startsWith("mailto:") === true, `contact email link was ${contact}`);
      await s.page.fill("#fb-content", "脚本失败时保留这段文字");
      await shot(s.page, "feedback-script-failure.png");

      scriptMode = "ok";
      const before = scriptLoads;
      await s.page.getByRole("button", { name: "重新验证" }).click();
      await s.widget();
      ok(scriptLoads > before, "retry did not request the challenge script again");
      ok(await s.page.inputValue("#fb-content") === "脚本失败时保留这段文字", "retry cleared the text");
      await noUnexpectedErrors(s.page, s.requests.errors);
    } finally { await s.close(); }
  });

  // 5. /submit shares the same gate and posts targetKind=source.
  await check("/submit: token gate, cf-turnstile-response and source target", async () => {
    configMode = "ok"; configDelayMs = 0; scriptMode = "ok"; scriptDelayMs = 0;
    reply = { status: 500, body: { detail: "本地假服务拒绝了这次投稿。" } };
    const s = await scenario("submit");
    const beforePosts = posts.length;
    try {
      await s.goto("/submit");
      await s.widget();
      ok(await s.page.getByRole("button", { name: "提交投稿" }).isDisabled(), "submit must be disabled before verification");
      await s.page.fill("#sb-content", "https://example.invalid/band-account");
      await s.page.locator("form").first().evaluate((form: HTMLFormElement) => form.requestSubmit());
      await s.page.getByText("请先完成人机验证").waitFor({ timeout: 2000 });
      ok(posts.length === beforePosts, `a tokenless submission reached the API (${issueState()})`);

      await s.page.getByRole("button", { name: "完成人机验证" }).click();
      await s.page.getByRole("button", { name: "提交投稿" }).click();
      await s.page.getByText("本地假服务拒绝了这次投稿。").waitFor({ timeout: 3000 });
      ok(await s.page.inputValue("#sb-content") === "https://example.invalid/band-account", "submit text changed after failure");
      ok(await s.page.getByRole("button", { name: "提交投稿" }).isDisabled(), "submit token was not cleared after failure");
      ok(await s.page.evaluate(() => window.__challenge.renders.length) === 2, "submit did not mount a fresh widget after failure");

      reply = { status: 201, body: { id: 44 } };
      await s.page.getByRole("button", { name: "完成人机验证" }).click();
      await s.page.getByRole("button", { name: "提交投稿" }).click();
      await s.page.getByText("收到了，谢谢你").waitFor({ timeout: 5000 });
      await s.page.getByText("投稿编号").waitFor();
      ok(posts.length === beforePosts + 2, `expected two POSTs, got ${posts.length}`);
      ok(posts[beforePosts + 1].token === "fake-token-2", `cf-turnstile-response was ${posts[beforePosts + 1].token}`);
      ok(posts[beforePosts + 1].targetKind === "source", `targetKind was ${posts[beforePosts + 1].targetKind}`);
      await shot(s.page, "submit-success.png");
      await noUnexpectedErrors(s.page, s.requests.errors);
    } finally { await s.close(); }
  });

  // 6. The sheet: closed until asked, then the challenge, submission and immediate cleanup.
  await check("ReportProblem: ordinary item page loads no challenge until the sheet opens; success carries the target", async () => {
    configMode = "ok"; configDelayMs = 0; scriptMode = "ok"; scriptDelayMs = 0; reply = { status: 201, body: { id: 45 } };
    const beforeConfig = configRequests;
    const beforeScripts = scriptLoads;
    const s = await scenario("report-problem");
    const beforePosts = posts.length;
    try {
      await s.goto("/items/test-item");
      await s.page.getByRole("button", { name: "发现错误？报告问题" }).waitFor({ timeout: 5000 });
      ok(scriptLoads === beforeScripts, "an item page loaded the challenge script before the sheet opened");
      ok(configRequests === beforeConfig, "an item page requested the challenge config before the sheet opened");

      await s.page.getByRole("button", { name: "发现错误？报告问题" }).click();
      await s.widget();
      const dialog = s.page.getByRole("dialog", { name: "报告问题" });
      await dialog.waitFor();
      await s.page.selectOption("#rp-part", "date");
      await s.page.fill("#rp-content", "日期写错了，应该是 2026-11-03");
      await s.page.fill("#rp-expected", "2026-11-03");
      await s.page.getByRole("dialog", { name: "报告问题" }).locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit());
      await s.page.getByText("请先完成人机验证").waitFor({ timeout: 2000 });
      ok(posts.length === beforePosts, `a tokenless report reached the API (${issueState()})`);

      reply = { status: 500, body: { detail: "本地假服务拒绝了这次纠错。" } };
      await s.page.getByRole("button", { name: "完成人机验证" }).click();
      ok(!(await s.page.getByRole("button", { name: "提交纠错" }).isDisabled()), "report submit did not enable after verification");
      await s.page.getByText("请先完成人机验证").waitFor({ state: "hidden", timeout: 2000 });
      await shot(s.page, "report-sheet.png", dialog);
      await s.page.getByRole("button", { name: "提交纠错" }).click();
      await s.page.getByText("本地假服务拒绝了这次纠错。").waitFor({ timeout: 3000 });
      await shot(s.page, "report-error.png", dialog);
      ok(await s.page.inputValue("#rp-content") === "日期写错了，应该是 2026-11-03", "report text changed after failure");
      ok(await s.page.inputValue("#rp-expected") === "2026-11-03", "report expected changed after failure");
      ok(await s.page.getByRole("button", { name: "提交纠错" }).isDisabled(), "report token was not cleared after failure");
      ok(await s.page.evaluate(() => window.__challenge.renders.length) === 2, "report did not mount a fresh widget after failure");

      reply = { status: 201, body: { id: 45 } };
      await s.page.getByRole("button", { name: "完成人机验证" }).click();
      ok(!(await s.page.getByRole("button", { name: "提交纠错" }).isDisabled()), "report submit did not enable after re-verification");
      await s.page.getByRole("button", { name: "提交纠错" }).click();
      await s.page.getByText("收到了，谢谢你").waitFor({ timeout: 5000 });
      ok(posts.length === beforePosts + 2, `expected two POSTs, got ${posts.length}`);
      ok(posts[beforePosts + 1].token === "fake-token-2", `cf-turnstile-response was ${posts[beforePosts + 1].token}`);
      ok(posts[beforePosts + 1].targetKind === "article" && posts[beforePosts + 1].targetId === "test-item", `target was ${posts[beforePosts + 1].targetKind}/${posts[beforePosts + 1].targetId}`);
      ok(posts[beforePosts + 1].targetField === "date" && posts[beforePosts + 1].expected === "2026-11-03", `field/expected was ${posts[beforePosts + 1].targetField}/${posts[beforePosts + 1].expected}`);
      ok(posts[beforePosts + 1].pageUrl.endsWith("/items/test-item"), `pageUrl was ${posts[beforePosts + 1].pageUrl}`);
      await s.page.getByRole("dialog", { name: "报告问题" }).getByRole("button", { name: "关闭" }).first().click();
      await s.page.waitForTimeout(60);
      const state = await s.page.evaluate(() => window.__challenge);
      ok(state.removed.includes("w2"), `sheet close left the widget: ${state.removed}`);
      await noUnexpectedErrors(s.page, s.requests.errors);
    } finally { await s.close(); }
  });

  // 7. The race found in browser review: close, a late callback, and reopen before the exit animation ends.
  await check("ReportProblem: close disposes the widget before the exit animation and a late callback cannot verify", async () => {
    configMode = "ok"; configDelayMs = 0; scriptMode = "ok"; scriptDelayMs = 0;
    const s = await scenario("report-close-race");
    try {
      await s.goto("/items/test-item");
      await s.page.getByRole("button", { name: "发现错误？报告问题" }).click();
      await s.widget();
      await s.page.getByRole("button", { name: "完成人机验证" }).click();
      await s.page.selectOption("#rp-part", "date");
      await s.page.fill("#rp-content", "关闭后重开必须重新验证");
      ok(!(await s.page.getByRole("button", { name: "提交纠错" }).isDisabled()), "first verification did not enable submit");

      // Close, let React commit the closed state (the widget must be gone at once), fire a late callback,
      // then reopen while the 220ms exit animation is still running.
      await s.page.evaluate(() => {
        const close = document.querySelector('[role="dialog"][aria-labelledby] button[aria-label="关闭"]') as HTMLButtonElement | null;
        if (!close) throw new Error('report sheet close button not found');
        close.click();
      });
      await s.page.waitForTimeout(50);
      const afterClose = await s.page.evaluate(() => {
        window.__challenge.fire("w1", "callback", "late-token");
        return { removed: [...window.__challenge.removed], dom: document.querySelectorAll("[data-widget]").length };
      });
      ok(afterClose.removed.includes("w1"), `closing did not remove the widget: ${JSON.stringify(afterClose)}`);
      ok(afterClose.dom === 0, `closing left widget DOM behind: ${afterClose.dom}`);
      await s.page.evaluate(() => {
        const open = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("报告问题")) as HTMLButtonElement | undefined;
        if (!open) throw new Error("report trigger not found");
        open.click();
      });
      await s.page.waitForTimeout(150);
      await s.page.getByRole("dialog", { name: "报告问题" }).waitFor({ timeout: 2000 });
      ok(await s.page.getByRole("button", { name: "提交纠错" }).isDisabled(), "the late callback verified the reopened sheet");
      const reopened = await s.page.evaluate(() => {
        const state = window.__challenge;
        return { ids: state.renders.map((render: { id: string }) => render.id), dom: [...document.querySelectorAll("[data-widget]")].map((el) => (el as HTMLElement).dataset.widget) };
      });
      ok(reopened.ids.length === 2 && reopened.ids[0] === "w1" && reopened.ids[1] === "w2", `reopen renders were ${JSON.stringify(reopened.ids)}`);
      ok(reopened.dom.length === 1 && reopened.dom[0] === "w2", `reopen widgets were ${JSON.stringify(reopened.dom)}`);
      await s.page.getByRole("button", { name: "完成人机验证" }).click();
      ok(!(await s.page.getByRole("button", { name: "提交纠错" }).isDisabled()), "fresh widget did not verify after reopen");
      await shot(s.page, "report-reopened.png", s.page.getByRole("dialog", { name: "报告问题" }));
      await noUnexpectedErrors(s.page, s.requests.errors);
    } finally { await s.close(); }
  });

  // 8. Closing while the config or script is still in flight must not mount into the closed sheet.
  await check("ReportProblem: close while config/script loads never mounts a late widget", async () => {
    configMode = "ok"; configDelayMs = 0; scriptMode = "ok"; scriptDelayMs = 0;
    // Config in flight.
    configDelayMs = 500;
    let s = await scenario("report-config-race");
    try {
      await s.goto("/items/test-item");
      await s.page.getByRole("button", { name: "发现错误？报告问题" }).click();
      await s.page.waitForTimeout(60);
      await s.page.evaluate(() => {
        const close = document.querySelector('[role="dialog"][aria-labelledby] button[aria-label="关闭"]') as HTMLButtonElement | null;
        if (!close) throw new Error('report sheet close button not found');
        close.click();
      });
      await s.page.waitForTimeout(700);
      const closed = await s.page.evaluate(() => ({ widget: document.querySelectorAll("[data-widget]").length, hasFake: !!window.__challenge }));
      ok(closed.widget === 0, `a widget mounted after the sheet closed during config: ${JSON.stringify(closed)}`);
      await s.page.getByRole("button", { name: "发现错误？报告问题" }).click();
      await s.widget();
      ok(await s.page.evaluate(() => window.__challenge.renders.length) === 1, "reopen during/after config delay rendered a duplicate widget");
    } finally { await s.close(); configDelayMs = 0; }

    // Script in flight.
    scriptDelayMs = 500;
    s = await scenario("report-script-race");
    try {
      await s.goto("/items/test-item");
      await s.page.getByRole("button", { name: "发现错误？报告问题" }).click();
      await s.page.waitForTimeout(120);
      await s.page.evaluate(() => {
        const close = document.querySelector('[role="dialog"][aria-labelledby] button[aria-label="关闭"]') as HTMLButtonElement | null;
        if (!close) throw new Error('report sheet close button not found');
        close.click();
      });
      await s.page.waitForTimeout(800);
      const closed = await s.page.evaluate(() => ({ widget: document.querySelectorAll("[data-widget]").length, hasFake: !!window.__challenge }));
      ok(closed.widget === 0, `a widget mounted after the sheet closed during script load: ${JSON.stringify(closed)}`);
      scriptDelayMs = 0;
      await s.page.getByRole("button", { name: "发现错误？报告问题" }).click();
      await s.widget();
      ok(await s.page.evaluate(() => window.__challenge.renders.length) === 1, "reopen after a late script load rendered a duplicate widget");
    } finally { await s.close(); scriptDelayMs = 0; }
  });

  // 9. A fresh ordinary page must not touch the challenge at all.
  await check("ordinary pages load no challenge script or config", async () => {
    configMode = "ok"; configDelayMs = 0; scriptMode = "ok"; scriptDelayMs = 0;
    const beforeConfig = configRequests;
    const beforeScripts = scriptLoads;
    const s = await scenario("ordinary-pages");
    try {
      for (const pathname of ["/", "/more"]) {
        await s.goto(pathname);
        await s.page.waitForTimeout(150);
        ok(scriptLoads === beforeScripts, `${pathname} loaded the challenge script`);
        ok(configRequests === beforeConfig, `${pathname} requested the challenge config`);
      }
      await noUnexpectedErrors(s.page, s.requests.errors);
    } finally { await s.close(); }
  });

  console.log(`\nall ${checks} feedback UI checks passed`);
  console.log(`screenshots: ${OUT}`);
} catch (error) {
  console.error(`\nfeedback UI verification failed: ${String(error)}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopWeb();
  api.stop(true);
}
