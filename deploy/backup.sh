#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
umask 077
BACKUP_DIR="$PROJECT_DIR/backups"
mkdir -p -- "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
backup="$BACKUP_DIR/littlenotes-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
partial="$backup.partial"
trap 'rm -f -- "$partial"' EXIT
dc exec -T db pg_dump -U littlenotes -d littlenotes --format=custom --no-owner > "$partial"
test -s "$partial"
dc exec -T db pg_restore --list < "$partial" > /dev/null
mv -- "$partial" "$backup"
# Only prune files created by this script, inside this project's backups directory.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'littlenotes-*.dump' -mtime +14 -delete
echo "备份已保存：$backup（服务器本地保留约 14 天）"
