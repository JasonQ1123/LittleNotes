#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
bash "$DEPLOY_DIR/configure.sh"
dc config --quiet
if [[ -n "$(dc ps --status running -q db)" ]]; then
  bash "$DEPLOY_DIR/backup.sh"
fi
# The 2 GB server builds during a maintenance window to leave enough memory.
dc stop web api
dc --parallel 1 build api web
dc up -d --wait db
dc run --rm --no-deps migrate
dc up -d --no-deps --wait api web
dc ps
if [[ ! -f "$DEPLOY_DIR/.public-enabled" ]]; then
  curl --fail --show-error --silent --retry 5 --retry-connrefused http://127.0.0.1:8080/api/health
  echo
  echo '服务器内部验证完成；网站尚未对公网开放。'
else
  echo '服务已启动，请通过正式 HTTPS 域名验证登录和回访。'
fi
