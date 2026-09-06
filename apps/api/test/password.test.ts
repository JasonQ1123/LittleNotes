import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import type { Response } from 'express';
import { createApp } from '../src/main';
import { Database } from '../src/database';
import { AuthService, userSelect } from '../src/auth';
import { emailProof } from './email-helper';

describe('修改密码与会话撤销', { concurrency: false }, () => {
  let app: INestApplication;
  let db: Database;
  let sequence = 0;
  const oldPassword = 'old-password-2026';
  const newPassword = 'new-password-2026';
  const payload = (password = newPassword) => ({
    currentPassword: oldPassword,
    newPassword: password,
    confirmPassword: password,
  });
  const endpoint = '/api/auth/password/change';
  async function account() {
    const agent = request.agent(app.getHttpServer());
    const username = `password_${++sequence}`;
    const result = await agent
      .post('/api/auth/register')
      .send({
        username,
        ...(await emailProof(app)),
        nickname: '密码测试',
        password: oldPassword,
      })
      .expect(201);
    assert.equal(result.body.passwordHash, undefined);
    const cookie = result.headers['set-cookie'][0].split(';')[0];
    return { agent, username, id: result.body.id as string, cookie, token: cookie.split('=')[1] };
  }
  before(async () => {
    const folder = await mkdtemp(join(tmpdir(), 'little-notes-password-'));
    const postgresUrl = process.env.TEST_DATABASE_URL;
    if (
      postgresUrl &&
      !/^ln_test_[a-z0-9_]+$/.test(new URL(postgresUrl).searchParams.get('schema') || '')
    )
      throw new Error('Tests require an isolated PostgreSQL schema');
    process.env.DATABASE_URL =
      postgresUrl || `file:${join(folder, 'test.db').replaceAll('\\', '/')}`;
    process.env.WEB_ORIGIN = 'http://localhost:5173';
    const init = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    await init.$connect();
    await init.$disconnect();
    execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        ...(postgresUrl ? ['--schema', 'prisma/postgresql/schema.prisma'] : []),
      ],
      { cwd: resolve(__dirname, '..'), env: process.env, stdio: 'pipe' },
    );
    app = await createApp(true);
    db = app.get(Database);
  });
  beforeEach(async () => {
    await db.passwordChangeLimit.deleteMany();
  });
  after(async () => {
    await app?.close();
  });

  it('新注册要求 8–32 位英文字母和数字组合，允许附加符号', async () => {
    const username = `policy_${++sequence}`;
    const proof = await emailProof(app);
    for (const password of [
      null,
      '',
      'Abcd123',
      'a1'.repeat(16) + 'a',
      'abcdefgh',
      '12345678',
      '中文字符1234',
      '!!!!!!!!',
    ]) {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ username, nickname: '规则测试', password, ...proof })
        .expect(400);
      assert.equal(await db.user.count({ where: { username } }), 0);
    }
    for (const password of ['abcdefg1', 'ABCDEFG1', `Ab1${'x'.repeat(29)}`, ' Abcd1! ']) {
      const registered = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          username: `policy_${++sequence}`,
          nickname: '规则测试',
          password,
          ...(await emailProof(app)),
        })
        .expect(201);
      const row = await db.user.findUniqueOrThrow({ where: { id: registered.body.id } });
      assert.equal(await argon2.verify(row.passwordHash, password), true);
      assert.equal(registered.body.passwordHash, undefined);
    }
  });

  it('存量纯数字、纯字母、符号或 128 位密码仍可登录和验证，仅新密码应用新规则', async () => {
    for (const password of ['12345678', 'letters-only', '!!!!!!!!', 'X'.repeat(128)]) {
      // Seed an existing account in the isolated test database; never rewrite real user data.
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const user = await db.user.create({
        data: {
          username: `legacy_${++sequence}`,
          nickname: '旧账号',
          passwordHash,
          email: `legacy_${sequence}@example.com`,
          emailVerifiedAt: new Date(),
        },
      });
      const agent = request.agent(app.getHttpServer());
      await agent.post('/api/auth/login').send({ username: user.username, password }).expect(200);
      await agent
        .post(endpoint)
        .send({ ...payload('weak-password'), currentPassword: password })
        .expect(400);
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash,
        passwordHash,
      );
      await agent.get('/api/auth/me').expect(200);
      await agent
        .post(endpoint)
        .send({ ...payload('Newpass1'), currentPassword: password })
        .expect(200);
      await agent.post('/api/auth/login').send({ username: user.username, password }).expect(401);
      await agent
        .post('/api/auth/login')
        .send({ username: user.username, password: 'Newpass1' })
        .expect(200);
    }
  });

  it('拒绝未登录、跨源、非法参数和错误当前密码，失败保留密码与会话', async () => {
    const user = await account();
    const original = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    await request(app.getHttpServer()).post(endpoint).send(payload()).expect(401);
    await user.agent
      .post(endpoint)
      .set('Origin', 'https://untrusted.example')
      .send(payload())
      .expect(403);
    for (const body of [
      {},
      { ...payload(), currentPassword: null },
      { ...payload(), newPassword: 'short' },
      payload('Abcd123'),
      payload('a1'.repeat(16) + 'a'),
      payload('abcdefgh'),
      payload('12345678'),
      { ...payload(), confirmPassword: 'does-not-match-1' },
      { ...payload(), confirmPassword: '12345678' },
      { ...payload(), confirmPassword: 'a1'.repeat(16) + 'a' },
      payload(oldPassword),
      { ...payload(), userId: 'another-user' },
    ])
      await user.agent.post(endpoint).send(body).expect(400);
    const wrong = await user.agent
      .post(endpoint)
      .send({ ...payload(), currentPassword: 'wrong-password' })
      .expect(400);
    assert.equal(wrong.body.message, '当前密码不正确');
    assert.equal(wrong.headers['set-cookie'], undefined);
    await user.agent.get('/api/auth/me').expect(200);
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash,
      original.passwordHash,
    );
  });

  it('成功后撤销本人所有会话，保留其他账号会话，并在重启后只接受新密码', async () => {
    const user = await account();
    const other = await account();
    const second = request.agent(app.getHttpServer());
    await second
      .post('/api/auth/login')
      .send({ username: user.username, password: oldPassword })
      .expect(200);
    // Boundary length and surrounding spaces must survive without trimming.
    const password = ` ${'A'.repeat(28)}1  `;
    const response = await user.agent.post(endpoint).send(payload(password)).expect(200);
    assert.deepEqual(response.body, { ok: true });
    assert.match(response.headers['set-cookie'][0], /paper_session=;/);
    assert.match(response.headers['set-cookie'][0], /HttpOnly/);
    assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.match(row.passwordHash, /^\$argon2id\$/);
    assert.equal(await argon2.verify(row.passwordHash, password), true);
    await user.agent.get('/api/auth/me').expect(401);
    await second.get('/api/auth/me').expect(401);
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Cookie', user.cookie)
      .send(payload())
      .expect(401);
    await other.agent.get('/api/auth/me').expect(200);
    await app.close();
    app = await createApp(true);
    db = app.get(Database);
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', user.cookie).expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: user.username, password: oldPassword })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: user.username, password: password.trim() })
      .expect(401);
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: user.username, password })
      .expect(200);
    assert.equal(login.body.passwordHash, undefined);
    assert.equal(login.body.avatarKey, undefined);
  });

  it('账号限流跨会话、API 实例及重启保持有效，到期后可重试', async () => {
    const user = await account();
    const secondApp = await createApp(true);
    try {
      for (let i = 0; i < 5; i++) {
        const server = i % 2 ? secondApp.getHttpServer() : app.getHttpServer();
        await request(server)
          .post(endpoint)
          .set('Cookie', user.cookie)
          .send({ ...payload(), currentPassword: 'wrong-password' })
          .expect(400);
      }
      await request(secondApp.getHttpServer())
        .post(endpoint)
        .set('Cookie', user.cookie)
        .set('X-Forwarded-For', '198.51.100.20')
        .send(payload())
        .expect(429);
    } finally {
      await secondApp.close();
    }
    await app.close();
    app = await createApp(true);
    db = app.get(Database);
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Cookie', user.cookie)
      .send(payload())
      .expect(429);
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', user.cookie).expect(200);
    const other = await account();
    await other.agent.post(endpoint).send(payload()).expect(200);
    await db.passwordChangeLimit.update({
      where: { key: `user:${user.id}` },
      data: { expiresAt: new Date(0) },
    });
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Cookie', user.cookie)
      .send(payload())
      .expect(200);
  });

  it('来源限流覆盖不同账号且不持久保存原始 IP', async () => {
    const user = await account();
    await user.agent
      .post(endpoint)
      .send({ ...payload(), currentPassword: 'wrong-password' })
      .expect(400);
    const entry = await db.passwordChangeLimit.findFirstOrThrow({
      where: { key: { startsWith: 'ip:' } },
    });
    assert.match(entry.key, /^ip:[a-f0-9]{64}$/);
    await db.passwordChangeLimit.update({ where: { key: entry.key }, data: { count: 40 } });
    const other = await account();
    await other.agent
      .post(endpoint)
      .set('X-Forwarded-For', '198.51.100.21')
      .send(payload())
      .expect(429);
    await other.agent.get('/api/auth/me').expect(200);
  });

  it('撤销会话写入失败时回滚密码更新，保留原密码与原会话', async (context) => {
    const user = await account();
    const original = (await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash;
    const atomic = db.atomic.bind(db);
    const mocked = context.mock.method(
      Database.prototype,
      'atomic',
      (fn: Parameters<Database['atomic']>[0]) =>
        atomic((tx) =>
          fn({
            ...tx,
            session: {
              ...tx.session,
              deleteMany: async () => {
                throw new Error('Simulated session deletion failure');
              },
            },
          } as typeof tx),
        ),
    );
    const logger = context.mock.method(console, 'error', () => undefined);
    try {
      await user.agent.post(endpoint).send(payload()).expect(500);
    } finally {
      mocked.mock.restore();
      logger.mock.restore();
    }
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash,
      original,
    );
    await user.agent.get('/api/auth/me').expect(200);
    await user.agent.post(endpoint).send(payload()).expect(200);
  });

  it('改密前已经验证旧密码的在途登录不能在改密后创建会话', async () => {
    const user = await account();
    const service = app.get(AuthService);
    const verified = await service.login({ username: user.username, password: oldPassword });
    await user.agent.post(endpoint).send(payload()).expect(200);
    const response = {
      cookie() {
        assert.fail('A stale login must not set a cookie');
      },
    } as unknown as Response;
    await assert.rejects(service.setSession(verified, response), { status: 401 });
    assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
  });

  it('同时修改密码只成功一次，其他请求不能覆盖成功的新密码', async () => {
    const user = await account();
    // PostgreSQL also exercises separate API transaction queues against the same account.
    const secondApp = process.env.TEST_DATABASE_URL ? await createApp(true) : null;
    try {
      const passwords = [newPassword, 'another-new-password-1'];
      const results = await Promise.all(
        passwords.map((password, index) =>
          request(index && secondApp ? secondApp.getHttpServer() : app.getHttpServer())
            .post(endpoint)
            .set('Cookie', user.cookie)
            .send(payload(password)),
        ),
      );
      assert.equal(results.filter((result) => result.status === 200).length, 1);
      assert.ok(results.every((result) => [200, 400, 401].includes(result.status)));
      assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
      const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      for (const [index, password] of passwords.entries())
        assert.equal(
          await argon2.verify(row.passwordHash, password),
          results[index].status === 200,
        );
    } finally {
      await secondApp?.close();
    }
  });

  it('进入业务逻辑前已被撤销或已过期的会话不能修改密码', async () => {
    const user = await account();
    const actor = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: userSelect });
    const original = (await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash;
    await db.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(0) } });
    await assert.rejects(
      app.get(AuthService).changePassword(actor, payload(), user.token, 'local-test'),
      { status: 401 },
    );
    await db.session.deleteMany({ where: { userId: user.id } });
    await assert.rejects(
      app.get(AuthService).changePassword(actor, payload(), user.token, 'local-test'),
      { status: 401 },
    );
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash,
      original,
    );
  });
});
