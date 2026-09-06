#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
bash "$DEPLOY_DIR/configure.sh"
if ! grep -Eq '^EMAIL_SMTP_VERIFIED=1[[:space:]]*$' "$DEPLOY_DIR/.env"; then
  echo '尚未确认 163 SMTP 向 QQ、163 投递成功。请先按部署文档验证并设置 EMAIL_SMTP_VERIFIED=1；保留当前服务。' >&2
  exit 1
fi
bash "$DEPLOY_DIR/prepare-uploads.sh"
dc config --quiet
if [[ -n "$(dc ps --status running -q db)" ]]; then
  bash "$DEPLOY_DIR/backup.sh"
fi
# The 2 GB server builds during a maintenance window to leave enough memory.
dc stop web api
# Separate commands also serialize Compose versions that delegate multi-target builds to Bake.
dc build api
dc build web
dc up -d --wait db
dc run --rm --no-deps migrate
dc up -d --no-deps --wait api web
dc ps
if [[ ! -f "$DEPLOY_DIR/.public-enabled" && ! -f "$DEPLOY_DIR/.ip-enabled" ]]; then
  curl --fail --show-error --silent --retry 5 --retry-connrefused http://127.0.0.1:8080/api/health
  echo
  echo '服务器内部验证完成；网站尚未对公网开放。'
else
  echo '服务已启动，请通过当前 HTTPS 入口验证邮箱绑定、密码找回和回访。'
fi
