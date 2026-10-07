#!/usr/bin/env bash
# GitHub Actions 部署入口（.github/workflows/check.yml 的 deploy 任务）。服务器上不直接给 CI 一个 shell：
# CI 那把 SSH 公钥在 ~/.ssh/authorized_keys 里写成
#   command="/opt/girlsbands/deploy/ci-deploy.sh",restrict ssh-ed25519 AAAA… girlsbands-ci
# 这样它只能跑本脚本。CI 把要部署的提交 SHA 当作命令传进来，标准输入第一行是 GHCR 的拉取令牌
# （任务自带的 GITHUB_TOKEN，任务结束即失效）。
# 步骤：用 GitHub 部署密钥 fast-forward 到该提交 → .env 的 APP_IMAGE 指到该提交的镜像 → deploy/update.sh。
set -euo pipefail
cd "$(dirname "$0")/.."

read -r sha extra <<<"${SSH_ORIGINAL_COMMAND:-}" || true
if [[ ! "${sha:-}" =~ ^[0-9a-f]{40}$ || -n "${extra:-}" ]]; then
  echo "usage: ssh <host> <40-char commit sha>  (GHCR token on stdin)" >&2
  exit 2
fi
IFS= read -r token || true
if [ -z "${token:-}" ]; then echo "no registry token on stdin" >&2; exit 2; fi

git fetch --quiet origin main
if ! git merge-base --is-ancestor "$sha" origin/main; then
  echo "$sha is not on origin/main" >&2
  exit 2
fi
git merge --ff-only --quiet "$sha"
if [ "$(git rev-parse HEAD)" != "$sha" ]; then
  echo "checkout is at $(git rev-parse --short HEAD), not ${sha:0:7}; a newer deploy already ran?" >&2
  exit 3
fi

image="ghcr.io/zzstar101/girlsbands:$sha"
if grep -q '^APP_IMAGE=' .env; then
  sed -i "s#^APP_IMAGE=.*#APP_IMAGE=$image#" .env
else
  printf '\nAPP_IMAGE=%s\n' "$image" >> .env
fi

trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
printf '%s' "$token" | docker login ghcr.io -u "${GITHUB_ACTOR:-github-actions}" --password-stdin >/dev/null
SKIP_GIT_PULL=1 bash deploy/update.sh
