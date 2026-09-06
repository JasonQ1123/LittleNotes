// Exercise deployment selection and the SMTP gate without touching Docker or a live service.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve('.');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
mkdirSync(join(root, '.cache'), { recursive: true });
const sandbox = mkdtempSync(join(root, '.cache', 'deploy-preflight-'));
const shellPath = (path) => path.replaceAll('\\', '/');
for (const name of readdirSync(join(root, 'deploy')).filter((name) => name.endsWith('.sh'))) {
  const result = spawnSync(bash, ['-n', shellPath(join(root, 'deploy', name))], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, `${name}: ${result.stderr}`);
}

function fixture(name, files = {}) {
  const folder = join(sandbox, name);
  mkdirSync(join(folder, 'deploy'), { recursive: true });
  for (const script of ['common.sh', 'deploy.sh', 'configure.sh'])
    writeFileSync(
      join(folder, 'deploy', script),
      readFileSync(join(root, 'deploy', script), 'utf8').replaceAll('\r\n', '\n'),
    );
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(folder, 'deploy', name), content);
  return folder;
}
function run(folder, command) {
  return spawnSync(
    bash,
    [
      '-c',
      'docker() { echo UNEXPECTED_DOCKER_CALL >&2; return 91; }; export -f docker; ' + command,
    ],
    { cwd: folder, encoding: 'utf8', windowsHide: true },
  );
}
function selection(name, files, expected) {
  const result = run(
    fixture(name, files),
    'source deploy/common.sh; printf "%s\\n" "${COMPOSE_ARGS[@]}"',
  );
  assert.equal(result.status, 0, result.stderr);
  const overrides = result.stdout
    .split('\n')
    .filter((line) => /compose\.(ip|public)\.yaml$/.test(line));
  assert.deepEqual(
    overrides.map((line) => line.split('/').at(-1)),
    expected,
  );
}
selection('internal', {}, []);
selection('ip', { '.ip-enabled': '', 'compose.ip.yaml': '', 'Caddyfile.ip': '' }, [
  'compose.ip.yaml',
]);
selection('domain', { '.public-enabled': '', '.ip-enabled': '' }, ['compose.public.yaml']);
for (const missing of ['compose.ip.yaml', 'Caddyfile.ip']) {
  const files = { '.ip-enabled': '', 'compose.ip.yaml': '', 'Caddyfile.ip': '' };
  delete files[missing];
  const result = run(fixture('missing-' + missing, files), 'source deploy/common.sh');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /IP.*配置缺失/);
  assert.doesNotMatch(result.stderr, /UNEXPECTED_DOCKER_CALL/);
}
console.log(
  'PASS: internal, HTTPS IP and domain selection; incomplete IP configuration stops safely',
);

for (const flag of ['', 'EMAIL_SMTP_VERIFIED=0\n', 'EMAIL_SMTP_VERIFIED=10\n']) {
  const folder = fixture('gate-' + Buffer.from(flag).toString('hex'), { '.env': flag });
  const result = run(folder, 'bash deploy/deploy.sh');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /保留当前服务/);
  assert.doesNotMatch(result.stderr, /UNEXPECTED_DOCKER_CALL|command not found/);
  assert.equal(readFileSync(join(folder, 'deploy', '.env'), 'utf8'), flag);
}
console.log(
  'PASS: unverified SMTP stops before Docker, backup or service changes; existing config preserved',
);

const approved = run(
  fixture('approved', { '.env': 'EMAIL_SMTP_VERIFIED=1\n' }),
  'bash deploy/deploy.sh',
);
// Stop at upload preparation in this fixture, before any real operation can happen.
assert.doesNotMatch(approved.stderr, /尚未确认/);
assert.match(approved.stderr, /prepare-uploads.sh/);
console.log(
  'PASS: exact SMTP verification flag permits the next deployment step; all Bash syntax valid',
);
