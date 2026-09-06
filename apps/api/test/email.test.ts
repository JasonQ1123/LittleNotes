import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import type { Response } from 'express';
import { createApp } from '../src/main';
import { AuthService, hashToken } from '../src/auth';
import { Database } from '../src/database';
import { EmailService } from '../src/email';
import { emailProof } from './email-helper';

describe('邮箱验证、找回密码与认证版本', { concurrency: false }, () => {
  let app: INestApplication;
  let db: Database;
  let mail: EmailService;
  let sequence = 0;
  const password = 'original-password-1';
  const nextPassword = 'reset-password-2';
  const newEmail = () => `${randomUUID()}@example.com`;
  const reset = (
    proof: { email: string; challengeId: string; code: string },
    pass = nextPassword,
  ) => ({ ...proof, newPassword: pass, confirmPassword: pass });
  const cool = () => db.emailLimit.deleteMany({ where: { key: { startsWith: 'cooldown:' } } });
  async function account(legacy = false, pass = password) {
    const username = `email_${++sequence}`;
    const agent = request.agent(app.getHttpServer());
    const email = newEmail();
    let response;
    if (legacy) {
      await db.user.create({
        data: { username, nickname: '旧的小纸条', passwordHash: await argon2.hash(pass) },
      });
      response = await agent.post('/api/auth/login').send({ username, password: pass }).expect(200);
    } else {
      response = await agent
        .post('/api/auth/register')
        .send({ username, nickname: '邮箱测试', password: pass, ...(await emailProof(app, email)) })
        .expect(201);
    }
    return {
      agent,
      username,
      email,
      id: response.body.id as string,
      cookie: response.headers['set-cookie'][0].split(';')[0],
      body: response.body,
    };
  }
  async function proof(
    email: string,
    purpose = 'reset',
    agent = request(app.getHttpServer()),
    currentPassword = password,
  ) {
    const endpoint = purpose === 'reset' ? '/api/auth/password/reset/code' : '/api/auth/email/code';
    const result = await agent
      .post(endpoint)
      .send({ email, ...(purpose === 'reset' ? {} : { currentPassword }) })
      .expect(200);
    await mail.drain();
    const message = mail.mockInbox().find((m) => m.challengeId === result.body.challengeId);
    assert.ok(message, 'expected a mock email');
    return { email, challengeId: message.challengeId, code: message.code };
  }
  before(async () => {
    const folder = await mkdtemp(join(tmpdir(), 'little-notes-email-'));
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
    mail = app.get(EmailService);
    // Deterministic worker execution in tests. Production always starts its interval.
    await mail.onModuleDestroy();
  });
  beforeEach(async () => {
    await db.emailLimit.deleteMany();
    await db.passwordChangeLimit.deleteMany();
  });
  after(async () => {
    await app?.close();
  });

  it('只有通过验证才注册；邮箱规范化、用途摘要和资料输出保持隔离', async () => {
    const email = newEmail();
    const input = await emailProof(app, `  ${email.toUpperCase()}  `);
    const c = await db.emailChallenge.findUniqueOrThrow({ where: { id: input.challengeId } });
    assert.equal(c.email, email);
    assert.match(c.digest!, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(c).includes(`"${input.code}"`), false);
    const body = { username: `email_${++sequence}`, nickname: '注册邮箱', password, ...input };
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: body.username, nickname: body.nickname, password })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ ...body, password: 'onlyletters' })
      .expect(400);
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(body)
      .expect(201);
    assert.equal(response.body.requiresEmailBinding, false);
    assert.ok(response.body.maskedEmail.endsWith('@example.com'));
    for (const key of ['passwordHash', 'authVersion', 'email', 'emailVerifiedAt', 'avatarKey'])
      assert.equal(response.body[key], undefined);
    const row = await db.user.findUniqueOrThrow({ where: { id: response.body.id } });
    assert.equal(row.email, email);
    assert.ok(row.emailVerifiedAt);
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ ...body, username: `email_${++sequence}` })
      .expect(400);
  });

  it('所有未绑定业务接口都拒绝访问，首次绑定保留旧密码与空间并轮换会话', async () => {
    for (const legacyPassword of ['12345678', 'X'.repeat(128)]) {
      const a = await account(true, legacyPassword);
      assert.equal(a.body.requiresEmailBinding, true);
      const old = await db.user.findUniqueOrThrow({ where: { id: a.id } });
      const space = await db.space.create({ data: { name: '已有空间' } });
      await db.user.update({ where: { id: a.id }, data: { spaceId: space.id } });
      const note = await db.record.create({
        data: { spaceId: space.id, authorId: a.id, title: '保留的旧纸条' },
      });
      for (const endpoint of [
        '/api/spaces/current',
        '/api/records',
        '/api/dashboard',
        '/api/dashboard/statistics',
        `/api/users/${a.id}/avatar`,
      ]) {
        const response = await a.agent.get(endpoint).expect(403);
        assert.equal(response.body.code, 'EMAIL_BINDING_REQUIRED');
      }
      for (const [method, endpoint, body] of [
        ['post', '/api/spaces', { name: '不能创建' }],
        ['patch', '/api/users/me', { nickname: '不能修改' }],
        [
          'post',
          '/api/auth/password/change',
          {
            currentPassword: legacyPassword,
            newPassword: nextPassword,
            confirmPassword: nextPassword,
          },
        ],
      ] as const)
        await a.agent[method](endpoint).send(body).expect(403);
      const second = request.agent(app.getHttpServer());
      await second
        .post('/api/auth/login')
        .send({ username: a.username, password: legacyPassword })
        .expect(200);
      const verified = await app
        .get(AuthService)
        .login({ username: a.username, password: legacyPassword });
      const input = await proof(a.email, 'bind', a.agent, legacyPassword);
      const response = await a.agent
        .put('/api/auth/email')
        .send({ ...input, currentPassword: legacyPassword })
        .expect(200);
      assert.equal(response.body.requiresLogin, false);
      assert.notEqual(response.headers['set-cookie'][0].split(';')[0], a.cookie);
      await second.get('/api/auth/me').expect(401);
      await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', a.cookie).expect(401);
      assert.equal(
        (await a.agent.get('/api/auth/me').expect(200)).body.requiresEmailBinding,
        false,
      );
      assert.equal((await a.agent.get('/api/spaces/current').expect(200)).body.id, space.id);
      const record = (await a.agent.get(`/api/records/${note.id}`).expect(200)).body;
      assert.equal(record.title, note.title);
      assert.equal(JSON.stringify(record).includes(a.email), false);
      const updated = await db.user.findUniqueOrThrow({ where: { id: a.id } });
      assert.equal(updated.passwordHash, old.passwordHash);
      assert.equal(updated.authVersion, 1);
      assert.equal(await db.session.count({ where: { userId: a.id } }), 1);
      await assert.rejects(
        app.get(AuthService).setSession(verified, {
          cookie() {
            assert.fail();
          },
        } as unknown as Response),
        { status: 401 },
      );
    }
  });

  it('换绑前旧邮箱有效，换绑后旧邮箱失去找回能力且全部会话和在途登录失效', async () => {
    const a = await account();
    const other = await account();
    await cool();
    const oldReset = await proof(a.email);
    const verified = await app.get(AuthService).login({ username: a.username, password });
    const next = newEmail();
    const input = await proof(next, 'replace', a.agent);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: a.id } })).email, a.email);
    assert.equal(
      (await db.emailChallenge.findUniqueOrThrow({ where: { id: oldReset.challengeId } }))
        .consumedAt,
      null,
    );
    const response = await a.agent
      .put('/api/auth/email')
      .send({ ...input, currentPassword: password })
      .expect(200);
    assert.equal(response.body.requiresLogin, true);
    await a.agent.get('/api/auth/me').expect(401);
    await other.agent.get('/api/auth/me').expect(200);
    assert.equal(await db.session.count({ where: { userId: a.id } }), 0);
    await request(app.getHttpServer())
      .post('/api/auth/password/reset')
      .send(reset(oldReset))
      .expect(400);
    await assert.rejects(
      app.get(AuthService).setSession(verified, {
        cookie() {
          assert.fail();
        },
      } as unknown as Response),
      { status: 401 },
    );
    await cool();
    const responseOld = await request(app.getHttpServer())
      .post('/api/auth/password/reset/code')
      .send({ email: a.email })
      .expect(200);
    await mail.drain();
    assert.equal(
      mail.mockInbox().some((m) => m.challengeId === responseOld.body.challengeId),
      false,
    );
    await cool();
    const nextReset = await proof(next);
    await request(app.getHttpServer())
      .post('/api/auth/password/reset')
      .send(reset(nextReset))
      .expect(200);
  });

  it('存在和不存在的邮箱返回相同申请格式，不在申请请求内发送邮件', async () => {
    const a = await account();
    await cool();
    const responses: { challengeId: string; message: string; retryAfter: number }[] = [];
    for (const email of [a.email, newEmail()])
      responses.push(
        (
          await request(app.getHttpServer())
            .post('/api/auth/password/reset/code')
            .send({ email })
            .expect(200)
        ).body,
      );
    for (const r of responses) {
      assert.deepEqual(Object.keys(r).sort(), ['challengeId', 'message', 'retryAfter']);
      assert.equal(r.message, '如该邮箱已绑定账号，将收到验证码');
      assert.match(r.challengeId, /^[a-f0-9]{64}$/);
      assert.equal(
        mail.mockInbox().some((m) => m.challengeId === r.challengeId),
        false,
      );
    }
    await mail.drain();
    assert.equal(
      mail.mockInbox().some((m) => m.challengeId === responses[0].challengeId),
      true,
    );
    assert.equal(
      mail.mockInbox().some((m) => m.challengeId === responses[1].challengeId),
      false,
    );
  });

  it('连续输错五次永久撤销当前验证码，错误次数跨服务实例保留', async () => {
    const a = await account();
    await cool();
    const input = await proof(a.email);
    const wrong = input.code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 4; i++)
      await request(app.getHttpServer())
        .post('/api/auth/password/reset')
        .send(reset({ ...input, code: wrong }))
        .expect(400);
    const restarted = new EmailService(db);
    const identity = await db.user.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(
      await db.atomic((tx) => restarted.verify(tx, { ...input, code: wrong }, 'reset', identity)),
      false,
    );
    await restarted.onModuleDestroy();
    const challenge = await db.emailChallenge.findUniqueOrThrow({
      where: { id: input.challengeId },
    });
    assert.equal(challenge.attempts, 5);
    assert.ok(challenge.consumedAt);
    assert.equal(challenge.digest, null);
    await request(app.getHttpServer())
      .post('/api/auth/password/reset')
      .send(reset(input))
      .expect(400);
    await a.agent.get('/api/auth/me').expect(200);
  });

  it('过期、用途混用、邮箱混用和旧验证码均不能重置，最新验证码只可使用一次', async () => {
    const a = await account();
    await cool();
    const input = await proof(a.email);
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: `email_${++sequence}`, nickname: '混用', password, ...input })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/auth/password/reset')
      .send(reset({ ...input, email: newEmail() }))
      .expect(400);
    await cool();
    const latest = await proof(a.email);
    await request(app.getHttpServer())
      .post('/api/auth/password/reset')
      .send(reset(input))
      .expect(400);
    await db.emailChallenge.update({
      where: { id: latest.challengeId },
      data: { expiresAt: new Date(0) },
    });
    await request(app.getHttpServer())
      .post('/api/auth/password/reset')
      .send(reset(latest))
      .expect(400);
    await cool();
    const valid = await proof(a.email);
    for (const pass of ['onlyletters', '12345678', 'a1'.repeat(17)])
      await request(app.getHttpServer())
        .post('/api/auth/password/reset')
        .send(reset(valid, pass))
        .expect(400);
    await request(app.getHttpServer())
      .post('/api/auth/password/reset')
      .send({ ...reset(valid), confirmPassword: 'different-1' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/auth/password/reset')
      .send(reset(valid))
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/password/reset')
      .send(reset(valid))
      .expect(400);
    await a.agent.get('/api/auth/me').expect(401);
    await a.agent.post('/api/auth/login').send({ username: a.username, password }).expect(401);
    await a.agent
      .post('/api/auth/login')
      .send({ username: a.username, password: nextPassword })
      .expect(200);
  });

  it('绑定和换绑必须验证当前密码、当前会话、验证码所属用户和认证版本', async () => {
    const a = await account(true);
    const b = await account(true);
    const body = { email: a.email, currentPassword: 'wrong-password' };
    await a.agent.post('/api/auth/email/code').send(body).expect(400);
    assert.equal(await db.emailChallenge.count({ where: { email: a.email } }), 0);
    const input = await proof(a.email, 'bind', a.agent);
    await b.agent
      .put('/api/auth/email')
      .send({ ...input, currentPassword: password })
      .expect(400);
    const service = app.get(AuthService);
    const original = await db.user.findUniqueOrThrow({ where: { id: a.id } });
    await db.session.deleteMany({ where: { userId: a.id } });
    await assert.rejects(
      service.bindEmail(
        original,
        { ...input, currentPassword: password },
        a.cookie.split('=')[1],
        'local',
        {} as Response,
      ),
      { status: 401 },
    );
    assert.equal(
      (await db.emailChallenge.findUniqueOrThrow({ where: { id: input.challengeId } })).consumedAt,
      null,
    );
  });

  it('邮箱唯一性在注册和绑定竞争中保持，失败不消费验证码', async () => {
    const a = await account(true);
    const email = newEmail();
    const bindInput = await proof(email, 'bind', a.agent);
    await cool();
    const registerInput = await emailProof(app, email);
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: `email_${++sequence}`, nickname: '先完成注册', password, ...registerInput })
      .expect(201);
    await a.agent
      .put('/api/auth/email')
      .send({ ...bindInput, currentPassword: password })
      .expect(409);
    assert.equal(
      (await db.emailChallenge.findUniqueOrThrow({ where: { id: bindInput.challengeId } }))
        .consumedAt,
      null,
    );
    assert.equal(await db.user.count({ where: { email } }), 1);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: a.id } })).email, null);
  });

  it('同邮箱冷却、小时/日、IP 和全站限额持久化并可过期', async () => {
    const email = newEmail();
    const send = (value = email) =>
      request(app.getHttpServer()).post('/api/auth/password/reset/code').send({ email: value });
    await send().expect(200);
    const cooldown = await send().expect(429);
    assert.ok(cooldown.body.retryAfter > 0);
    await cool();
    for (let i = 1; i < 5; i++) {
      await send().expect(200);
      await cool();
    }
    await send().expect(429);
    await db.emailLimit.deleteMany({ where: { key: { startsWith: 'email-hour:' } } });
    for (let i = 5; i < 10; i++) {
      await send().expect(200);
      await cool();
    }
    await db.emailLimit.deleteMany({ where: { key: { startsWith: 'email-hour:' } } });
    await send().expect(429);
    await db.emailLimit.updateMany({ data: { expiresAt: new Date(0) } });
    await send().expect(200);
    await db.emailLimit.updateMany({
      where: { key: { startsWith: 'ip:' } },
      data: { count: 10000 },
    });
    await send(newEmail()).expect(429);
    await db.emailLimit.updateMany({ where: { key: { startsWith: 'ip:' } }, data: { count: 0 } });
    await db.emailLimit.update({ where: { key: 'global-day' }, data: { count: 10000 } });
    await send(newEmail()).expect(429);
    const restarted = new EmailService(db);
    await assert.rejects(
      db.atomic((tx) => restarted.request(tx, newEmail(), 'reset', 'another-ip')),
      { status: 429 },
    );
    await restarted.onModuleDestroy();
  });

  it('SMTP 发送失败不重试、挑战失效、冷却后可申请新的验证码', async (context) => {
    const a = await account();
    await cool();
    const fail = context.mock.method(mail, 'deliver', async () => {
      throw new Error('simulated SMTP timeout');
    });
    const response = await request(app.getHttpServer())
      .post('/api/auth/password/reset/code')
      .send({ email: a.email })
      .expect(200);
    await mail.drain();
    await mail.drain();
    assert.equal(fail.mock.callCount(), 1);
    fail.mock.restore();
    const job = await db.emailJob.findUniqueOrThrow({
      where: { id: response.body.challengeId },
      include: { challenge: true },
    });
    assert.equal(job.status, 'uncertain');
    assert.equal(job.challenge.digest, null);
    assert.ok(job.challenge.consumedAt);
    await cool();
    const input = await proof(a.email);
    await request(app.getHttpServer())
      .post('/api/auth/password/reset')
      .send(reset(input))
      .expect(200);
  });

  it('服务重启后处理未开始任务，已中断的 SMTP 任务不再次发送', async () => {
    const a = await account();
    await cool();
    const pending = await request(app.getHttpServer())
      .post('/api/auth/password/reset/code')
      .send({ email: a.email })
      .expect(200);
    const restarted = new EmailService(db);
    await restarted.drain();
    const message = restarted.mockInbox().find((m) => m.challengeId === pending.body.challengeId);
    assert.ok(message);
    await cool();
    const uncertain = await request(app.getHttpServer())
      .post('/api/auth/password/reset/code')
      .send({ email: a.email })
      .expect(200);
    await db.emailJob.update({
      where: { id: uncertain.body.challengeId },
      data: { status: 'sending', startedAt: new Date(Date.now() - 180_000) },
    });
    const again = new EmailService(db);
    await again.drain();
    assert.equal(again.mockInbox().length, 0);
    assert.equal(
      (await db.emailJob.findUniqueOrThrow({ where: { id: uncertain.body.challengeId } })).status,
      'uncertain',
    );
    await restarted.onModuleDestroy();
    await again.onModuleDestroy();
  });

  it('重置撤销会话失败时，验证码、密码及认证版本一起回滚', async (context) => {
    const a = await account();
    await cool();
    const input = await proof(a.email);
    const original = await db.user.findUniqueOrThrow({ where: { id: a.id } });
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
                throw new Error('simulated revoke failure');
              },
            },
          } as typeof tx),
        ),
    );
    const logger = context.mock.method(console, 'error', () => {});
    try {
      await request(app.getHttpServer())
        .post('/api/auth/password/reset')
        .send(reset(input))
        .expect(500);
    } finally {
      mocked.mock.restore();
      logger.mock.restore();
    }
    assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: a.id } }), original);
    assert.equal(
      (await db.emailChallenge.findUniqueOrThrow({ where: { id: input.challengeId } })).consumedAt,
      null,
    );
    await a.agent.get('/api/auth/me').expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/password/reset')
      .send(reset(input))
      .expect(200);
  });

  it('首次绑定轮换会话失败也回滚邮箱、认证版本与验证码', async (context) => {
    const a = await account(true);
    const input = await proof(a.email, 'bind', a.agent);
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
              create: async () => {
                throw new Error('simulated create failure');
              },
            },
          } as unknown as typeof tx),
        ),
    );
    const logger = context.mock.method(console, 'error', () => {});
    try {
      await a.agent
        .put('/api/auth/email')
        .send({ ...input, currentPassword: password })
        .expect(500);
    } finally {
      mocked.mock.restore();
      logger.mock.restore();
    }
    const row = await db.user.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(row.email, null);
    assert.equal(row.authVersion, 0);
    assert.equal(
      (await db.emailChallenge.findUniqueOrThrow({ where: { id: input.challengeId } })).consumedAt,
      null,
    );
    await a.agent.get('/api/auth/me').expect(200);
    await a.agent
      .put('/api/auth/email')
      .send({ ...input, currentPassword: password })
      .expect(200);
  });

  it('并发重置只有一次成功；其他账号保留会话，旧凭据在途登录不可复活', async () => {
    const a = await account();
    const b = await account();
    await cool();
    const input = await proof(a.email);
    const verified = await app.get(AuthService).login({ username: a.username, password });
    const secondApp = process.env.TEST_DATABASE_URL ? await createApp(true) : null;
    try {
      const results = await Promise.all(
        [app, secondApp || app].map((instance, i) =>
          request(instance.getHttpServer())
            .post('/api/auth/password/reset')
            .send(reset(input, i ? 'another-password-3' : nextPassword)),
        ),
      );
      assert.equal(results.filter((r) => r.status === 200).length, 1);
      assert.ok(results.every((r) => [200, 400].includes(r.status)));
      assert.equal(await db.session.count({ where: { userId: a.id } }), 0);
      await b.agent.get('/api/auth/me').expect(200);
      await assert.rejects(
        app.get(AuthService).setSession(verified, {
          cookie() {
            assert.fail();
          },
        } as unknown as Response),
        { status: 401 },
      );
      const row = await db.user.findUniqueOrThrow({ where: { id: a.id } });
      assert.equal(row.authVersion, 1);
      assert.ok(
        await argon2.verify(
          row.passwordHash,
          results[0].status === 200 ? nextPassword : 'another-password-3',
        ),
      );
    } finally {
      await secondApp?.close();
    }
  });

  it('现有修改密码撤销全部未使用邮箱挑战，验证码错误不会影响其他账号', async () => {
    const a = await account();
    await cool();
    const input = await proof(a.email);
    const change = await proof(newEmail(), 'replace', a.agent);
    await a.agent
      .post('/api/auth/password/change')
      .send({ currentPassword: password, newPassword: nextPassword, confirmPassword: nextPassword })
      .expect(200);
    for (const id of [input.challengeId, change.challengeId])
      assert.ok((await db.emailChallenge.findUniqueOrThrow({ where: { id } })).consumedAt);
    await request(app.getHttpServer())
      .post('/api/auth/password/reset')
      .send(reset(input, 'third-password-4'))
      .expect(400);
    assert.equal(
      await db.session.findUnique({ where: { tokenHash: hashToken(a.cookie.split('=')[1]) } }),
      null,
    );
  });

  it('并发申请共用冷却，多实例后台只能领取并发送同一任务一次', async () => {
    const peer = process.env.TEST_DATABASE_URL ? await createApp(true) : null;
    const peerMail = peer ? peer.get(EmailService) : new EmailService(db);
    await peerMail.onModuleDestroy();
    const email = newEmail();
    try {
      const results = await Promise.all(
        [app, peer || app].map((instance) =>
          request(instance.getHttpServer()).post('/api/auth/register/code').send({ email }),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 429]);
      const challengeId = results.find((r) => r.status === 200)!.body.challengeId;
      await Promise.all([mail.drain(), peerMail.drain()]);
      assert.equal(
        [...mail.mockInbox(), ...peerMail.mockInbox()].filter((m) => m.challengeId === challengeId)
          .length,
        1,
      );
      assert.equal(
        (await db.emailJob.findUniqueOrThrow({ where: { id: challengeId } })).status,
        'sent',
      );
    } finally {
      await peerMail.onModuleDestroy();
      await peer?.close();
    }
  });

  it('生产环境拒绝 mock 模式，真实发送配置必须提供独立密钥和 SMTP 授权码', () => {
    const previous = {
      node: process.env.NODE_ENV,
      mode: process.env.EMAIL_DELIVERY,
      key: process.env.EMAIL_HMAC_SECRET,
    };
    try {
      process.env.NODE_ENV = 'production';
      process.env.EMAIL_DELIVERY = 'mock';
      assert.throws(() => new EmailService(db), /禁止模拟/);
      process.env.EMAIL_DELIVERY = 'smtp';
      process.env.EMAIL_HMAC_SECRET = '';
      assert.throws(() => new EmailService(db), /EMAIL_HMAC_SECRET/);
    } finally {
      if (previous.node === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.node;
      process.env.EMAIL_DELIVERY = previous.mode;
      process.env.EMAIL_HMAC_SECRET = previous.key;
    }
  });
});
