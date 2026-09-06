#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
if ! grep -Eq '^ICP_NUMBER=.*[0-9]' "$DEPLOY_DIR/.env" || \
   ! grep -Eq '^ACME_EMAIL=[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' "$DEPLOY_DIR/.env"; then
  echo '请在 deploy/.env 填写已获批的 ICP_NUMBER 和有效的 ACME_EMAIL。'; exit 1
fi
echo '此步骤用于备案通过后：请确保域名 A 记录已指向服务器，安全组已放行 TCP 80/443。'
COMPOSE_ARGS=(--env-file "$DEPLOY_DIR/.env" -f "$DEPLOY_DIR/compose.yaml" -f "$DEPLOY_DIR/compose.public.yaml")
dc config --quiet
dc up -d --no-deps --wait api web
touch "$DEPLOY_DIR/.public-enabled"
echo '已启用 HTTPS 配置，Caddy 将自动申请并续期证书。请检查域名访问与证书签发日志。'
