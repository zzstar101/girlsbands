// The fetch guard: internal addresses stay unreachable in every spelling, and a name that resolves
// to one is refused at connect time too (DNS rebinding after the URL check).
import assert from "node:assert/strict";
import http from "node:http";
import { glob, readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { Agent, fetch as undiciFetch } from "undici/index.js";
import { guardedFetch } from "@girlsbands/backend/lib/http-fetch";
import { assertPublicUrl, guardedLookup, isBlockedAddress } from "@girlsbands/backend/lib/url";

const server = http.createServer((_req, res) => res.end("internal"));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const { port } = server.address() as { port: number };
const agent = new Agent({ connect: { lookup: guardedLookup as never } });
after(async () => {
  server.close();
  await agent.close();
});

test("internal and reserved addresses are blocked in every spelling", () => {
  const blocked = [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "255.255.255.255",
    "::1", "::", "fd00::1", "fe80::1", "ff02::1", "2001:db8::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a00:1", "::ffff:a9fe:a9fe", "::7f00:1", // IPv4-mapped and -compatible
    "64:ff9b::7f00:1", "64:ff9b:1::1", "2002:7f00:1::1", "2001:0:4136:e378::1", // NAT64, 6to4, Teredo
    "not-an-ip",
  ];
  const allowed = ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"];
  assert.deepEqual(blocked.filter((a) => !isBlockedAddress(a)), [], "not blocked");
  assert.deepEqual(allowed.filter((a) => isBlockedAddress(a)), [], "wrongly blocked");
});

test("URL literals that embed a loopback address are refused before any request", async () => {
  for (const url of ["http://[::ffff:127.0.0.1]/", "http://[::127.0.0.1]/", "http://[64:ff9b::127.0.0.1]/", "http://localhost/"]) {
    await assert.rejects(assertPublicUrl(url), Error, url);
  }
  await assert.rejects(guardedFetch(`http://[::ffff:127.0.0.1]:${port}/`));
});

test("a name resolving to an internal address is refused at connect time", async () => {
  await assert.rejects(undiciFetch(`http://localhost:${port}/`, { dispatcher: agent }));
});

// Under Bun the bare "undici" is Bun's stand-in, whose Agent never calls connect.lookup: the test above
// would pass with no check at all in production. The file path loads the real package.
test("outbound code loads the real undici, whose Agent honours the guarded lookup", async () => {
  const root = new URL("../", import.meta.url);
  const bare: string[] = [];
  for (const dir of ["apps/api/src", "apps/worker/src", "packages/backend/src", "scripts"]) {
    for await (const file of glob("**/*.ts", { cwd: new URL(dir, root) })) {
      const text = await readFile(new URL(`${dir}/${file}`, root), "utf8");
      if (/from "undici"|import\("undici"\)/.test(text)) bare.push(`${dir}/${file}`);
    }
  }
  assert.deepEqual(bare, []);
});
