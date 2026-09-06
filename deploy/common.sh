#!/usr/bin/env bash
set -euo pipefail
DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname -- "$DEPLOY_DIR")"
COMPOSE_ARGS=(--env-file "$DEPLOY_DIR/.env" -f "$DEPLOY_DIR/compose.yaml")
if [[ -f "$DEPLOY_DIR/.public-enabled" ]]; then
  COMPOSE_ARGS+=(-f "$DEPLOY_DIR/compose.public.yaml")
elif [[ -f "$DEPLOY_DIR/.ip-enabled" ]]; then
  # Preserve the HTTPS IP entry installed by the earlier Workbench patch.
  if [[ ! -f "$DEPLOY_DIR/compose.ip.yaml" || ! -f "$DEPLOY_DIR/Caddyfile.ip" ]]; then
    echo '检测到公网 IP 启用标记，但原有 IP 代理配置缺失。请恢复配置后再部署。' >&2
    exit 1
  fi
  COMPOSE_ARGS+=(-f "$DEPLOY_DIR/compose.ip.yaml")
fi
dc() { docker compose "${COMPOSE_ARGS[@]}" "$@"; }
