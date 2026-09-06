#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo '用法：sudo bash deploy/verify-backup.sh /opt/littlenotes/backups/具体文件.dump'; exit 1
fi
verify_db="littlenotes_verify_$(date -u +%Y%m%d%H%M%S)_$$"
dc exec -T db createdb -U littlenotes "$verify_db"
cleanup() { dc exec -T db dropdb -U littlenotes --if-exists "$verify_db"; }
trap cleanup EXIT
dc exec -T db pg_restore -U littlenotes -d "$verify_db" \
  --exit-on-error --single-transaction --no-owner < "$1"
dc exec -T db psql -U littlenotes -d "$verify_db" -v ON_ERROR_STOP=1 \
  -c 'SELECT (SELECT count(*) FROM "User") AS users, (SELECT count(*) FROM "Record") AS records, (SELECT count(*) FROM "Agreement") AS agreements, (SELECT count(*) FROM "Review") AS reviews;'
backup="$(realpath -- "$1")"
avatars="$backup.avatars.tar.gz"
if [[ -f "$avatars" || -f "$backup.sha256" ]]; then
  test -f "$avatars" && test -f "$backup.sha256"
  (cd -- "$(dirname -- "$backup")" && sha256sum -c -- "$(basename -- "$backup.sha256")")
  tar -tzf "$avatars" > /dev/null
fi
has_avatars="$(dc exec -T db psql -U littlenotes -d "$verify_db" -At -v ON_ERROR_STOP=1 -c "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name='avatarKey');")"
if [[ "$has_avatars" == t ]]; then
  references="$(dc exec -T db psql -U littlenotes -d "$verify_db" -At -v ON_ERROR_STOP=1 -c 'SELECT "avatarKey" FROM "User" WHERE "avatarKey" IS NOT NULL;')"
  while IFS= read -r key; do
    [[ -n "$key" ]] || continue
    [[ "$key" =~ ^[a-f0-9]{32}\.webp$ ]] || { echo '备份中的头像引用无效'; exit 1; }
    test -f "$avatars" && test -f "$backup.sha256"
    bytes="$(tar -xOzf "$avatars" -- "$key" | wc -c)"
    [[ "$bytes" -gt 0 ]] || { echo '备份缺少被引用的头像'; exit 1; }
  done <<< "$references"
fi
echo '数据库已恢复至临时库，头像引用及配套归档检查通过；原业务数据库保持原样。'
