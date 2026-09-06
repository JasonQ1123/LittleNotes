#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
# The API image runs as the official node user (UID/GID 1000).
if [[ $EUID -eq 0 ]]; then
  install -d -m 0750 -o 1000 -g 1000 -- "$PROJECT_DIR/uploads/avatars"
else
  sudo -n install -d -m 0750 -o 1000 -g 1000 -- "$PROJECT_DIR/uploads/avatars"
fi
