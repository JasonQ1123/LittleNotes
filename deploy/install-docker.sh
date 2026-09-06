#!/usr/bin/env bash
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo '请使用 sudo bash deploy/install-docker.sh'; exit 1; fi
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  systemctl enable --now docker
  echo 'Docker 和 Compose 已就绪。'
  exit 0
fi
source /etc/os-release
if [[ "$ID" != ubuntu || ! "$VERSION_ID" =~ ^(22\.04|24\.04)$ ]]; then
  echo '此脚本适用于 Ubuntu 22.04 / 24.04；请先核对服务器系统。'; exit 1
fi
apt-get update
apt-get install -y ca-certificates curl git openssl
install -m 0755 -d /etc/apt/keyrings
curl --fail --show-error --silent --location --retry 3 \
  https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $VERSION_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker compose version
