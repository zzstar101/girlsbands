#!/usr/bin/env bash
# 服务器上的一次更新（docs/deploy.md「更新」一节的步骤），在仓库根目录执行：
#   bash deploy/update.sh            # HTTPS 配置（带 caddy）
#   PROFILE= bash deploy/update.sh   # 不带 caddy
# 顺序：拉代码 → 构建 → 停 API/worker/web → 迁移与种子 → 启动 → 清理构建缓存（留 1.5G）。
# 迁移失败就停在那里，不启动新版。
set -euo pipefail
cd "$(dirname "$0")/.."
PROFILE_ARGS=()
if [ "${PROFILE-https}" != "" ]; then PROFILE_ARGS=(--profile "${PROFILE-https}"); fi

git pull --ff-only
docker compose "${PROFILE_ARGS[@]}" build
docker compose stop api worker web
docker compose run --rm setup
docker compose "${PROFILE_ARGS[@]}" up -d
# 每次构建都会留下缓存层，几次部署就是几个 G；留 1.5G 给下次构建复用，多的删掉。
docker builder prune -f --reserved-space 1.5gb >/dev/null
docker image prune -f >/dev/null
docker compose ps --format '{{.Name}}  {{.Status}}'
