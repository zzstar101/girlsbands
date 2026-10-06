import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  appDirectory: "app",
  buildDirectory: "build",
  // Assets may be served from an absolute CDN base (ASSET_BASE_URL in vite.config.ts), which must not
  // move the routes: pages stay at the root of SITE_URL.
  basename: "/",
  // The whole route manifest ships with the page: no /__manifest?paths=… requests, whose answers are
  // cacheable for a year while a CDN's page cache would not key them on paths or version.
  routeDiscovery: { mode: "initial" },
} satisfies Config;
