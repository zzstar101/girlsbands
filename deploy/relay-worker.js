// girlsbands-relay：只给服务器中转 hatena 书签的 RSS（hatena 屏蔽了服务器所在香港机房的 IP）。
// 只转发 b.hatena.ne.jp 的 GET 请求，并且必须带上与服务器 .env 里 RELAY_SECRET 一致的 X-Relay-Key。
// 用法：GET https://<worker>/?url=<encoded https://b.hatena.ne.jp/...>
const ALLOWED_HOSTS = new Set(["b.hatena.ne.jp"]);

export default {
  async fetch(request, env) {
    if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
    if (!env.RELAY_SECRET || request.headers.get("x-relay-key") !== env.RELAY_SECRET) return new Response("forbidden", { status: 403 });
    let target;
    try {
      target = new URL(new URL(request.url).searchParams.get("url") ?? "");
    } catch {
      return new Response("bad url", { status: 400 });
    }
    if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) return new Response("host not allowed", { status: 403 });
    const upstream = await fetch(target.toString(), {
      headers: {
        "user-agent": request.headers.get("user-agent") ?? "Mozilla/5.0 (compatible; girlsbands-relay)",
        accept: request.headers.get("accept") ?? "application/rss+xml, application/xml, text/xml, */*",
        ...(request.headers.get("if-none-match") ? { "if-none-match": request.headers.get("if-none-match") } : {}),
        ...(request.headers.get("if-modified-since") ? { "if-modified-since": request.headers.get("if-modified-since") } : {}),
      },
      redirect: "follow",
    });
    const headers = new Headers();
    for (const h of ["content-type", "etag", "last-modified", "cache-control"]) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
