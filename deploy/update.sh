#!/usr/bin/env bash
# 服务器上的一次更新（docs/deploy.md「更新」一节的步骤），在仓库根目录执行：
#   bash deploy/update.sh            # HTTPS 配置（带 caddy）
#   PROFILE= bash deploy/update.sh   # 不带 caddy
# 顺序：拉代码 → 构建或拉镜像 → 停 API/worker/web → 迁移与种子 → 启动 → 清理。
# 迁移失败就停在那里，不启动新版。
# .env 里有 APP_IMAGE（GitHub Actions 部署时由 deploy/ci-deploy.sh 写入）就拉这个镜像，不在本机构建。
set -euo pipefail
cd "$(dirname "$0")/.."
PROFILE_ARGS=()
if [ "${PROFILE-https}" != "" ]; then PROFILE_ARGS=(--profile "${PROFILE-https}"); fi

if [ -z "${SKIP_GIT_PULL:-}" ]; then git pull --ff-only; fi
if grep -qE '^APP_IMAGE=.+' .env; then
  docker compose pull setup
  UP_ARGS=(--no-build)
else
  docker compose "${PROFILE_ARGS[@]}" build
  UP_ARGS=()
fi
docker compose stop api worker web
docker compose run --rm setup
docker compose "${PROFILE_ARGS[@]}" up -d "${UP_ARGS[@]}"
if [ ${#UP_ARGS[@]} -gt 0 ]; then
  # 每次部署留下一个按提交打标签的旧镜像；没在用、超过三天的删掉（要回滚时会重新拉）。
  docker image prune -af --filter until=72h >/dev/null
else
  # 每次构建都会留下缓存层，几次部署就是几个 G；留 1.5G 给下次构建复用，多的删掉。
  docker builder prune -f --reserved-space 1.5gb >/dev/null
fi
docker image prune -f >/dev/null
docker compose ps --format '{{.Name}}  {{.Status}}'
