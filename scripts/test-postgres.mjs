// Use a separate dependency tree so PostgreSQL generation never replaces the local SQLite client.
import { cpSync, copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

if (!process.env.TEST_DATABASE_URL)
  throw new Error('请设置指向测试 PostgreSQL 的 TEST_DATABASE_URL');
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('请通过 pnpm test:postgres 运行');
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = join(root, '.cache');
mkdirSync(cache, { recursive: true });
const sandbox = mkdtempSync(join(cache, 'postgres-test-'));
const suffix = randomUUID().replaceAll('-', '');
const schemas = [`ln_test_api_${suffix}`, `ln_test_browser_${suffix}`];
const testUrl = (schema) => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('需要 PostgreSQL 测试地址');
  url.searchParams.set('schema', schema);
  url.searchParams.set('connection_limit', '5');
  return url.href;
};
const env = {
  ...process.env,
  NODE_ENV: 'test',
  TEST_DATABASE_URL: testUrl(schemas[0]),
  DATABASE_URL: testUrl(schemas[0]),
};
for (const name of [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'playwright.config.ts',
  '.gitignore',
])
  copyFileSync(join(root, name), join(sandbox, name));
for (const name of ['apps', 'scripts', 'tests'])
  cpSync(join(root, name), join(sandbox, name), {
    recursive: true,
    filter: (path) =>
      !['node_modules', 'dist', '.env'].includes(basename(path)) && !/\.db(?:$|-)/.test(path),
  });
const run = (args, extra = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [pnpm, ...args], {
      cwd: sandbox,
      env: { ...env, ...extra },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`检查失败：${args.join(' ')} (${code})`)),
    );
  });
try {
  await run(['install', '--offline', '--frozen-lockfile']);
  await run(['--filter', '@paper/api', 'db:postgres:generate']);
  await run(['test']);
  await run(['build']);
  if (process.argv.includes('--e2e')) {
    await run(['exec', 'playwright', 'test'], {
      TEST_DATABASE_URL: testUrl(schemas[1]),
      DATABASE_URL: testUrl(schemas[1]),
    });
  }
  console.log('PostgreSQL 检查完成；日常 SQLite 数据和 Client 未变更。');
} finally {
  const require = createRequire(join(sandbox, 'apps/api/package.json'));
  try {
    const { PrismaClient } = require('@prisma/client');
    const client = new PrismaClient({ datasourceUrl: testUrl(schemas[0]) });
    try {
      for (const schema of schemas) {
        if (!/^ln_test_[a-z0-9_]+$/.test(schema)) throw new Error('测试 schema 名称非法');
        await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    } finally {
      await client.$disconnect();
    }
  } catch (error) {
    console.error('独立测试 schema 清理未完成，请检查测试数据库。', error.code || error.name);
  }
  console.log(`构建和浏览器测试产物位于：${resolve(sandbox)}`);
}
