# One image for every role: setup (migrations and seed), api, worker and web, all run by Bun.
# Build arg NPM_REGISTRY switches the npm registry (e.g. https://registry.npmmirror.com in mainland China).
# Build arg ASSET_BASE_URL is the absolute URL of the CDN host serving the hashed client assets; empty
# (the default) keeps them on this origin, exactly as before.
FROM oven/bun:1.4.2-slim AS base
WORKDIR /app
# pg_dump for the optional database backups (Debian's client matches the PostgreSQL 17 server in compose).
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
 && rm -rf /var/lib/apt/lists/*

FROM base AS manifests
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/backend/package.json packages/backend/
COPY packages/contracts/package.json packages/contracts/
COPY industry/package.json industry/

# The runtime dependencies install on their own, alongside the web build below.
FROM manifests AS deps
ARG NPM_REGISTRY=
RUN bun install --frozen-lockfile --production ${NPM_REGISTRY:+--registry=$NPM_REGISTRY}

FROM manifests AS build
ARG NPM_REGISTRY=
ARG ASSET_BASE_URL=
RUN bun install --frozen-lockfile ${NPM_REGISTRY:+--registry=$NPM_REGISTRY}
COPY . .
RUN cd apps/web && ASSET_BASE_URL="$ASSET_BASE_URL" bun run build

FROM base
ENV NODE_ENV=production
COPY --chown=bun:bun . .
COPY --from=deps --chown=bun:bun /app/node_modules node_modules
COPY --from=build --chown=bun:bun /app/apps/web/build apps/web/build
RUN mkdir -p /data && chown bun:bun /data
USER bun
EXPOSE 3000
CMD ["bun", "apps/web/server.ts"]
