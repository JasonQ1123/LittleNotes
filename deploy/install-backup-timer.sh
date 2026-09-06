#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
if [[ $EUID -ne 0 ]]; then echo '请使用 sudo 执行'; exit 1; fi
if [[ "$PROJECT_DIR" != /opt/littlenotes ]]; then
  echo '定时备份安装器要求项目位于 /opt/littlenotes。'; exit 1
fi
cat > /etc/systemd/system/littlenotes-backup.service <<'EOF'
[Unit]
Description=LittleNotes PostgreSQL backup
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/littlenotes
ExecStart=/bin/bash /opt/littlenotes/deploy/backup.sh
UMask=0077
EOF
cat > /etc/systemd/system/littlenotes-backup.timer <<'EOF'
[Unit]
Description=Daily LittleNotes backup at 03:30 Asia/Shanghai

[Timer]
OnCalendar=*-*-* 03:30:00 Asia/Shanghai
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now littlenotes-backup.timer
systemctl list-timers littlenotes-backup.timer
