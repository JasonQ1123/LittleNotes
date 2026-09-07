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
has_lifecycle="$(dc exec -T db psql -U littlenotes -d "$verify_db" -At -v ON_ERROR_STOP=1 -c "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='SpaceMembership');")"
if [[ "$has_lifecycle" == t ]]; then
  inconsistent="$(dc exec -T db psql -U littlenotes -d "$verify_db" -At -v ON_ERROR_STOP=1 -c '
    SELECT count(*) FROM "Space" s WHERE
      (SELECT count(*) FROM "SpaceMembership" m WHERE m."spaceId"=s.id) NOT BETWEEN 1 AND 2
      OR (s.status = '\''active'\'' AND (
        (SELECT count(*) FROM "User" u WHERE u."spaceId"=s.id) <>
        (SELECT count(*) FROM "SpaceMembership" m WHERE m."spaceId"=s.id)
        OR EXISTS (SELECT 1 FROM "SpaceMembership" m JOIN "User" u ON u.id=m."userId"
          WHERE m."spaceId"=s.id AND u."spaceId" IS DISTINCT FROM s.id)))
      OR (s.status = '\''closed'\'' AND (s."closedAt" IS NULL OR s."purgeAt" IS NULL
        OR EXISTS (SELECT 1 FROM "User" u WHERE u."spaceId"=s.id)))
      OR EXISTS (SELECT 1 FROM "Record" r WHERE r."spaceId"=s.id
        AND NOT EXISTS (SELECT 1 FROM "SpaceMembership" m WHERE m."spaceId"=s.id AND m."userId"=r."authorId"));
  ')"
  [[ "$inconsistent" == 0 ]] || { echo '备份中的空间状态或成员关系不一致，请先核查。'; exit 1; }
fi
echo '数据库已恢复至临时库，空间成员关系、头像引用及配套归档检查通过；原业务数据库保持原样。'
