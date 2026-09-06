#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ -e .env ]]; then
  echo '配置已存在，保留现有数据库密码。'
  exit 0
fi
umask 077
password="$(openssl rand -hex 32)"
set -o noclobber
cat > .env <<EOF
POSTGRES_PASSWORD=$password
WEB_ORIGIN=https://littlenotes.cn
DOMAIN=littlenotes.cn
ACME_EMAIL=
ICP_NUMBER=
EOF
echo '已生成 deploy/.env；密码仅保存在服务器，本次部署使用新的空数据库。'
