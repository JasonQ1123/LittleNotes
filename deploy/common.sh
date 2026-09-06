#!/usr/bin/env bash
set -euo pipefail
DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname -- "$DEPLOY_DIR")"
COMPOSE_ARGS=(--env-file "$DEPLOY_DIR/.env" -f "$DEPLOY_DIR/compose.yaml")
if [[ -f "$DEPLOY_DIR/.public-enabled" ]]; then
  COMPOSE_ARGS+=(-f "$DEPLOY_DIR/compose.public.yaml")
fi
dc() { docker compose "${COMPOSE_ARGS[@]}" "$@"; }
