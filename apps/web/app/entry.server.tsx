import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

export const streamTimeout = 5_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  if (request.method === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");
  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(streamTimeout + 1000)]),
      onError(error: unknown) {
        responseStatusCode = 500;
        // Shell failures reject and are logged by React Router; only log later streaming errors here.
        if (shellRendered) console.error(error);
      },
    },
  );
  shellRendered = true;
  // Crawlers and SPA generation need the complete document, not just the first shell.
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) await body.allReady;

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, { headers: responseHeaders, status: responseStatusCode });
}
