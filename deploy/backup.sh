#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
umask 077
BACKUP_DIR="$PROJECT_DIR/backups"
AVATAR_DIR="$PROJECT_DIR/uploads/avatars"
mkdir -p -- "$BACKUP_DIR" "$AVATAR_DIR"
chmod 700 "$BACKUP_DIR"
exec 9> "$BACKUP_DIR/.backup.lock"
flock -n 9 || { echo '另一个备份正在运行，请稍后再试。'; exit 1; }
backup="$BACKUP_DIR/littlenotes-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
avatars="$backup.avatars.tar.gz"
manifest="$backup.sha256"
references="$backup.references.partial"
complete=0
cleanup() {
  rm -f -- "$backup.partial" "$avatars.partial" "$manifest.partial" "$references"
  if [[ $complete -eq 0 ]]; then rm -f -- "$backup" "$avatars" "$manifest"; fi
}
trap cleanup EXIT

# Immutable files remain on disk until this database + avatar backup is complete.
dc exec -T db pg_dump -U littlenotes -d littlenotes --format=custom --no-owner > "$backup.partial"
test -s "$backup.partial"
dc exec -T db pg_restore --list < "$backup.partial" > /dev/null
find "$AVATAR_DIR" -maxdepth 1 -type f -name '*.webp' -printf '%f\0' |
  tar -czf "$avatars.partial" -C "$AVATAR_DIR" --null --verbatim-files-from -T -
tar -tzf "$avatars.partial" > /dev/null
mv -- "$avatars.partial" "$avatars"
mv -- "$backup.partial" "$backup"
(
  cd -- "$BACKUP_DIR"
  sha256sum -- "$(basename -- "$backup")" "$(basename -- "$avatars")"
) > "$manifest.partial"
mv -- "$manifest.partial" "$manifest"
complete=1

# Prune old sets together; old database-only backups are also supported.
while IFS= read -r -d '' old; do
  rm -f -- "$old" "$old.avatars.tar.gz" "$old.sha256"
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'littlenotes-*.dump' -mtime +14 -print0)

# Query live references only after archiving. A 24-hour grace period excludes
# uploads whose database transaction is still in flight; keys are never reused.
has_avatars="$(dc exec -T db psql -U littlenotes -d littlenotes -At -v ON_ERROR_STOP=1 -c "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name='avatarKey');")"
if [[ "$has_avatars" == t ]]; then
  dc exec -T db psql -U littlenotes -d littlenotes -At -v ON_ERROR_STOP=1 \
    -c 'SELECT "avatarKey" FROM "User" WHERE "avatarKey" IS NOT NULL;' > "$references"
  while IFS= read -r -d '' candidate; do
    name="$(basename -- "$candidate")"
    if [[ "$name" =~ ^[a-f0-9]{32}\.webp$ ]] && ! grep -Fqx -- "$name" "$references"; then
      rm -f -- "$candidate"
    fi
  done < <(find "$AVATAR_DIR" -maxdepth 1 -type f -name '*.webp' -mmin +1440 -print0)
fi
echo "备份已保存：$backup、配套头像归档及 SHA256 清单（服务器本地保留约 14 天）"
