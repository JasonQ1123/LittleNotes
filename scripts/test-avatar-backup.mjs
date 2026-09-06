// Exercise the real backup shell scripts with a small database-command fixture.
// Actual PostgreSQL dump/restore is additionally exercised by the containers CI job.
import assert from 'node:assert/strict';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve('.cache');
mkdirSync(root, { recursive: true });
const sandbox = mkdtempSync(join(root, 'avatar-backup-'));
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const shellPath = (path) =>
  process.platform === 'win32'
    ? path.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase())
    : path;
const deploy = join(sandbox, 'deploy');
const images = join(sandbox, 'uploads', 'avatars');
const backups = join(sandbox, 'backups');
for (const path of [deploy, images, backups]) mkdirSync(path, { recursive: true });
for (const name of ['backup.sh', 'verify-backup.sh']) {
  copyFileSync(join('deploy', name), join(deploy, name));
  const syntax = spawnSync(bash, ['-n', join(deploy, name)], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(syntax.status, 0, syntax.stderr);
}
const common = [
  'set -euo pipefail',
  'DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"',
  'PROJECT_DIR="$(dirname -- "$DEPLOY_DIR")"',
  ...(process.platform === 'win32'
    ? ['flock() { return 0; } # Git Bash lacks flock; Linux CI uses the real lock.']
    : []),
  'dc() {',
  '  case "$*" in',
  '    *pg_dump*)',
  '      [[ ! -f "$PROJECT_DIR/fail-dump" ]] || return 1',
  '      cat "$PROJECT_DIR/references"',
  '      if [[ -f "$PROJECT_DIR/next-references" ]]; then cp "$PROJECT_DIR/next-references" "$PROJECT_DIR/references"; fi ;;',
  '    *pg_restore*--list*) cat > /dev/null ;;',
  '    *pg_restore*) cat > "$PROJECT_DIR/restored-references" ;;',
  '    *information_schema*) if [[ -f "$PROJECT_DIR/legacy" ]]; then echo f; else echo t; fi ;;',
  '    *psql*avatarKey*)',
  '      if [[ "$*" == *littlenotes_verify_* ]]; then cat "$PROJECT_DIR/restored-references"; else cat "$PROJECT_DIR/references"; fi ;;',
  '    *) return 0 ;;',
  '  esac',
  '}',
  '',
].join('\n');
writeFileSync(join(deploy, 'common.sh'), common);
const run = (script, args = [], ok = true) => {
  const result = spawnSync(bash, [shellPath(join(deploy, script)), ...args.map(shellPath)], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (ok) assert.equal(result.status, 0, result.stdout + result.stderr);
  else assert.notEqual(result.status, 0, 'Expected failure');
  return result;
};
const old = 'a'.repeat(32) + '.webp';
const orphan = 'b'.repeat(32) + '.webp';
const current = 'c'.repeat(32) + '.webp';
for (const key of [old, orphan, current])
  writeFileSync(join(images, key), 'immutable image fixture');
const twoDaysAgo = new Date(Date.now() - 2 * 86400_000);
for (const key of [old, orphan]) utimesSync(join(images, key), twoDaysAgo, twoDaysAgo);
writeFileSync(join(sandbox, 'references'), old + '\n');
writeFileSync(join(sandbox, 'next-references'), current + '\n');
run('backup.sh');
const backup = join(
  backups,
  readdirSync(backups).find((name) => name.endsWith('.dump')),
);
assert.equal(existsSync(join(images, old)), false);
assert.equal(existsSync(join(images, orphan)), false);
assert.equal(existsSync(join(images, current)), true);
run('verify-backup.sh', [backup]);
assert.equal(readFileSync(join(sandbox, 'restored-references'), 'utf8'), old + '\n');
console.log('PASS: snapshot references survive concurrent replacement and orphan cleanup');

writeFileSync(join(sandbox, 'fail-dump'), '');
const sets = readdirSync(backups).filter((name) => name.endsWith('.dump'));
run('backup.sh', [], false);
assert.deepEqual(
  readdirSync(backups).filter((name) => name.endsWith('.dump')),
  sets,
);
assert.ok(!readdirSync(backups).some((name) => name.endsWith('.partial')));
console.log('PASS: failed database dump does not publish a backup or leave partial files');

writeFileSync(backup + '.avatars.tar.gz', 'corrupt archive');
run('verify-backup.sh', [backup], false);
console.log('PASS: corrupted image archive fails verification');

const missing = join(backups, 'missing-images.dump');
writeFileSync(missing, current + '\n');
run('verify-backup.sh', [missing], false);
console.log('PASS: database references without companion images fail verification');

writeFileSync(join(sandbox, 'legacy'), '');
const legacy = join(backups, 'legacy.dump');
writeFileSync(legacy, 'legacy database');
run('verify-backup.sh', [legacy]);
console.log('PASS: pre-avatar database-only backups remain verifiable');
