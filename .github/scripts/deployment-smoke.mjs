// CI-only check against the loopback production containers. The job removes its own database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

if (process.env.CI !== 'true') throw new Error('仅在 CI 的临时部署中创建演练数据');
const base = 'http://127.0.0.1:8080';
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const actor = () => {
  let cookie = '';
  return async (path, body, options = {}) => {
    const multipart = body instanceof FormData;
    const response = await fetch(`${base}/api${path}`, {
      method: options.method || (body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(!multipart ? { 'Content-Type': 'application/json' } : {}),
        Origin: 'https://web.littlenotes.cn',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
    });
    assert.ok(response.ok, `${path}: ${response.status}`);
    const next = response.headers.get('set-cookie');
    if (next) {
      assert.match(next, /; Secure/);
      assert.match(next, /; HttpOnly/);
      cookie = next.split(';')[0];
    }
    return options.image ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
};
const a = actor();
const b = actor();
// Production containers forbid mock email. Seed already verified CI-only accounts directly;
// API and browser suites separately exercise registration with the mock inbox.
const seeded = [
  {
    username: `deploy_a_${suffix}`,
    nickname: '演练甲',
    password: `Aa1${randomUUID().replaceAll('-', '').slice(0, 29)}`,
  },
  {
    username: `deploy_b_${suffix}`,
    nickname: '演练乙',
    password: `Aa1${randomUUID().replaceAll('-', '').slice(0, 29)}`,
  },
];
execFileSync(
  'docker',
  [
    'compose',
    '--env-file',
    'deploy/.env',
    '-f',
    'deploy/compose.yaml',
    'exec',
    '-T',
    'api',
    'node',
    '-e',
    `
  const { PrismaClient } = require('@prisma/client');
  const argon2 = require('argon2');
  let input = ''; process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', async () => {
    const db = new PrismaClient();
    try {
      for (const item of JSON.parse(input)) await db.user.create({ data: {
        username: item.username, nickname: item.nickname,
        passwordHash: await argon2.hash(item.password),
        email: item.username + '@example.com', emailVerifiedAt: new Date(),
      } });
    } finally { await db.$disconnect(); }
  });
`,
  ],
  { input: JSON.stringify(seeded), stdio: ['pipe', 'pipe', 'pipe'] },
);
await a('/auth/login', { username: seeded[0].username, password: seeded[0].password });
await b('/auth/login', { username: seeded[1].username, password: seeded[1].password });
await a('/spaces', { name: '部署恢复演练空间' });
const invitation = await a('/spaces/invitations', {});
await b('/spaces/invitations/accept', { token: invitation.token });
await a('/users/me', { nickname: '演练新昵称' }, { method: 'PATCH' });
const image = new FormData();
image.append(
  'file',
  new Blob(
    [
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWOomJQOAAL3AXLrPNAzAAAAAElFTkSuQmCC',
        'base64',
      ),
    ],
    { type: 'image/png' },
  ),
  'avatar.png',
);
const profile = await a('/users/me/avatar', image, { method: 'PUT' });
const avatarPath = profile.avatarUrl.replace(/^\/api/, '');
const originalAvatar = await a(avatarPath, undefined, { image: true });
assert.equal(originalAvatar.toString('ascii', 8, 12), 'WEBP');
assert.deepEqual(await b(avatarPath, undefined, { image: true }), originalAvatar);
// Only CI's temporary project is recreated; this verifies the bind mount survives.
execFileSync(
  'docker',
  [
    'compose',
    '--env-file',
    'deploy/.env',
    '-f',
    'deploy/compose.yaml',
    'up',
    '-d',
    '--no-deps',
    '--force-recreate',
    '--wait',
    'api',
  ],
  { stdio: 'inherit' },
);
assert.equal((await a('/auth/me')).nickname, '演练新昵称');
assert.deepEqual(await a(avatarPath, undefined, { image: true }), originalAvatar);
const record = await a('/records', { title: '恢复演练：下次提前说一声' });
await a(`/records/${record.id}/publish`, {});
const proposal = await a(`/records/${record.id}/agreements`, {
  baseVersion: 0,
  understanding: '双方希望提前知道安排的变化',
  actions: [{ text: '发生变化时及时沟通', assigneeId: 'both' }],
  criteria: '双方都收到消息',
});
const agreement = proposal.agreements[0];
await Promise.all([
  a(`/agreements/${agreement.id}/confirm`, {}),
  b(`/agreements/${agreement.id}/confirm`, {}),
]);
const detail = await a(`/records/${record.id}`);
assert.equal(detail.status, 'followup');
const cycle = detail.agreements[0].cycles[0];
await a(`/reviews/${cycle.id}`, {
  rating: '明显改善',
  achieved: '已做到',
  example: '提前收到消息',
  remaining: '',
  adjustments: '',
});
await b(`/reviews/${cycle.id}`, {
  rating: '部分改善',
  achieved: '部分做到',
  example: '比之前及时',
  remaining: '希望再早一些',
  adjustments: '',
});
const reviewed = await a(`/records/${record.id}`);
assert.equal(reviewed.agreements[0].cycles[0].reviews.length, 2);
assert.equal((await fetch(`${base}/api/docs`)).status, 404);
const page = await fetch(`${base}/records/${record.id}`);
assert.equal(page.status, 200);
assert.match(await page.text(), /<html/);
console.log(
  '生产容器的注册、邀请、共同确认、独立回访和前端路由通过；即将备份 2 个用户、1 张纸条和 2 份回访。',
);
