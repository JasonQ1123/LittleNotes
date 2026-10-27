import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const apiRoot = fileURLToPath(new URL('../apps/api/', import.meta.url));
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const cache = fileURLToPath(new URL('../.cache/', import.meta.url));
mkdirSync(cache, { recursive: true });
const postgresUrl = process.env.TEST_DATABASE_URL;
if (
  postgresUrl &&
  !/^ln_test_[a-z0-9_]+$/.test(new URL(postgresUrl).searchParams.get('schema') || '')
)
  throw new Error('浏览器测试必须使用独立的 ln_test_ schema');
process.env.DATABASE_URL =
  postgresUrl || `file:${resolve(cache, `e2e-${randomUUID()}.db`).replaceAll('\\', '/')}`;
process.env.WEB_ORIGIN = 'http://127.0.0.1:5174';
process.env.AUTH_LIMIT_PER_15M = '10000';
process.env.AI_ENABLED = 'false';
process.env.EMAIL_DELIVERY = 'mock';
process.env.EMAIL_HMAC_SECRET = 'a1'.repeat(32);
process.env.EMAIL_COOLDOWN_SECONDS = '1';
process.env.EMAIL_LIMIT_EMAIL_HOUR = '100';
process.env.EMAIL_LIMIT_EMAIL_DAY = '100';
process.env.EMAIL_LIMIT_IP_HOUR = '10000';
process.env.EMAIL_LIMIT_GLOBAL_DAY = '10000';
process.env.AVATAR_STORAGE_DIR = resolve(cache, `e2e-avatars-${randomUUID()}`);
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
await db.$connect();
await db.$disconnect();
execFileSync(
  process.execPath,
  [
    require.resolve('prisma/build/index.js'),
    'migrate',
    'deploy',
    ...(postgresUrl ? ['--schema', 'prisma/postgresql/schema.prisma'] : []),
  ],
  {
    cwd: apiRoot,
    env: process.env,
    stdio: 'pipe',
  },
);
const { createApp } = require(resolve(apiRoot, 'dist/main.js'));
const app = await createApp(true);
// Seed an old unbound account in the isolated E2E database for the migration UX regression.
const { Database } = require(resolve(apiRoot, 'dist/database.js'));
const argon2 = require('argon2');
for (const device of ['desktop', 'mobile'])
  await app.get(Database).user.create({
    data: {
      username: `email_legacy_${device}`,
      nickname: '保留的旧昵称',
      passwordHash: await argon2.hash('X'.repeat(128)),
    },
  });
await app.listen(18081, '127.0.0.1');
console.log('小纸条浏览器测试 API 已准备好（使用独立测试数据库）');
