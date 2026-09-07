import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/main';
import { Database } from '../src/database';
import { Actor, hashToken } from '../src/auth';
import { RecordsService } from '../src/records';
import { SpaceCleanupService, SpaceLifecycleService } from '../src/space-lifecycle';

const password = 'space-test-2026';
const DAY = 86400_000;
describe('空间关闭、限时恢复和到期清理', { concurrency: false }, () => {
  let app: INestApplication;
  let db: Database;
  let passwordHash: string;
  let sequence = 0;
  async function account() {
    const user = await db.user.create({
      data: {
        username: 'lifecycle_' + Date.now() + '_' + ++sequence,
        nickname: '成员' + sequence,
        passwordHash,
        email: 'lifecycle-' + Date.now() + '-' + sequence + '@example.com',
        emailVerifiedAt: new Date(),
      },
    });
    const token = randomBytes(32).toString('hex');
    await db.session.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * DAY),
      },
    });
    const cookie = 'paper_session=' + token;
    const agent = request.agent(app.getHttpServer()).set('Cookie', cookie);
    return { user, agent, cookie, token };
  }
  type Account = Awaited<ReturnType<typeof account>>;
  async function fixture(paired = true) {
    const a = await account();
    const b = paired ? await account() : a;
    const space = (await a.agent.post('/api/spaces').send({ name: '原来的空间' }).expect(201)).body;
    let invitation: { id: string; token: string } | undefined;
    if (paired) {
      invitation = (await a.agent.post('/api/spaces/invitations').expect(201)).body;
      await b.agent
        .post('/api/spaces/invitations/accept')
        .send({ token: invitation!.token })
        .expect(201);
    }
    return { a, b, space, invitation };
  }
  const close = (owner: Account, space: { id: string; lifecycleVersion: number }) =>
    owner.agent
      .post('/api/spaces/' + space.id + '/close')
      .send({ currentPassword: password, lifecycleVersion: space.lifecycleVersion });
  const restore = (
    owner: Account,
    space: { id: string; lifecycleVersion: number },
    paired = true,
  ) =>
    owner.agent
      .post('/api/spaces/' + space.id + (paired ? '/restore-requests' : '/restore'))
      .send({ currentPassword: password, lifecycleVersion: space.lifecycleVersion });
  const respond = (owner: Account, spaceId: string, requestId: string, action = 'accept') =>
    owner.agent
      .post('/api/spaces/' + spaceId + '/restore-requests/' + requestId + '/' + action)
      .send(action === 'accept' ? { currentPassword: password } : {});
  async function contents(a: Account, b: Account, spaceId: string) {
    const record = await db.record.create({
      data: {
        spaceId,
        authorId: a.user.id,
        title: '共享事件',
        status: 'followup',
        perspectives: {
          create: [
            {
              userId: a.user.id,
              draftJson: '{"facts":"未公开的修改"}',
              publishedJson: '{"facts":"已发布的事实"}',
            },
            { userId: b.user.id, draftJson: '{"facts":"对方的私密视角"}' },
          ],
        },
        reconciliations: { create: { userId: a.user.id, value: true } },
        archiveVotes: { create: { userId: a.user.id } },
        agreements: {
          create: {
            version: 1,
            status: 'active',
            understanding: '一起安排时间',
            actionsJson: '[]',
            criteria: '说到做到',
            proposedById: a.user.id,
            activatedAt: new Date(),
            confirmations: { create: [{ userId: a.user.id }, { userId: b.user.id }] },
            cycles: {
              create: {
                number: 1,
                dueAt: new Date(Date.now() - DAY),
                reviews: {
                  create: {
                    userId: a.user.id,
                    rating: '部分改善',
                    achieved: '已行动',
                  },
                },
              },
            },
          },
        },
      },
      include: { agreements: { include: { cycles: true } } },
    });
    const draft = await db.record.create({
      data: { spaceId, authorId: a.user.id, title: '本人私密草稿' },
    });
    const linked = await db.record.create({
      data: { spaceId, authorId: b.user.id, title: '关联事件', status: 'review' },
    });
    await db.recordLink.create({ data: { recordId: record.id, relatedId: linked.id } });
    return {
      record,
      draft,
      linked,
      agreement: record.agreements[0],
      cycle: record.agreements[0].cycles[0],
    };
  }
  before(async () => {
    const folder = mkdtempSync(join(tmpdir(), 'little-notes-lifecycle-'));
    const pg = process.env.TEST_DATABASE_URL;
    if (pg && !/^ln_test_[a-z0-9_]+$/.test(new URL(pg).searchParams.get('schema') || ''))
      throw new Error('Tests require an isolated PostgreSQL schema');
    process.env.DATABASE_URL = pg || 'file:' + join(folder, 'test.db').replaceAll('\\', '/');
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
        ...(pg ? ['--schema', 'prisma/postgresql/schema.prisma'] : []),
      ],
      { cwd: resolve(__dirname, '..'), env: process.env, stdio: 'pipe' },
    );
    app = await createApp(true);
    db = app.get(Database);
    passwordHash = await argon2.hash(password);
  });
  beforeEach(async () => {
    await db.passwordChangeLimit.deleteMany();
  });
  after(async () => {
    await app?.close();
  });

  it('关闭校验密码、权限、版本、来源和会话，失败不解绑', async () => {
    const { a, space } = await fixture();
    const outsider = await account();
    const path = '/api/spaces/' + space.id + '/close';
    await request(app.getHttpServer()).post(path).send({}).expect(401);
    await close(outsider, space).expect(404);
    await a.agent
      .post(path)
      .send({ currentPassword: 'wrong-password', lifecycleVersion: 1 })
      .expect(400);
    await a.agent.post(path).send({ currentPassword: password, lifecycleVersion: 0 }).expect(400);
    await close(a, { ...space, lifecycleVersion: 99 }).expect(409);
    await close(a, space).set('Origin', 'https://other.example').expect(403);
    const actor = await db.user.findUniqueOrThrow({ where: { id: a.user.id } });
    await db.session.delete({ where: { tokenHash: hashToken(a.token) } });
    await assert.rejects(
      app.get(SpaceLifecycleService).close(
        actor,
        space.id,
        {
          currentPassword: password,
          lifecycleVersion: 1,
        },
        a.token,
        'test',
      ),
      { status: 401 },
    );
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: a.user.id } })).spaceId, space.id);
  });

  it('关闭隐藏所有内容与待办，原成员、外部用户和新伴侣都不能访问旧记录', async () => {
    const { a, b, space } = await fixture();
    const content = await contents(a, b, space.id);
    const oldNickname = b.user.nickname;
    const closed = (await close(a, space).expect(201)).body;
    assert.equal(Date.parse(closed.purgeAt) - Date.parse(closed.closedAt), 30 * DAY);
    assert.equal(closed.lifecycleVersion, 2);
    const outsider = await account();
    for (const owner of [a, b, outsider]) {
      assert.equal((await owner.agent.get('/api/spaces/current').expect(200)).body.id, undefined);
      for (const note of [content.record, content.draft, content.linked])
        await owner.agent.get('/api/records/' + note.id).expect(404);
      assert.equal((await owner.agent.get('/api/records?q=共享').expect(200)).body.total, 0);
      assert.deepEqual((await owner.agent.get('/api/agreements').expect(200)).body, []);
      assert.deepEqual((await owner.agent.get('/api/dashboard').expect(200)).body.todos, []);
      assert.equal(
        (await owner.agent.get('/api/dashboard/statistics?days=30').expect(200)).body.total,
        0,
      );
      await owner.agent.post('/api/ai/records/' + content.record.id + '/summarize').expect(404);
    }
    const base = '/api/records/' + content.record.id;
    await a.agent.post(base + '/publish').expect(404);
    await a.agent.post(base + '/archive').expect(404);
    await a.agent
      .post(base + '/reconcile')
      .send({ value: true })
      .expect(404);
    await a.agent
      .post(base + '/links')
      .send({ relatedId: content.linked.id })
      .expect(404);
    await a.agent.post('/api/agreements/' + content.agreement.id + '/confirm').expect(404);
    await a.agent
      .post('/api/agreements/' + content.agreement.id + '/schedule')
      .send({ dueAt: new Date(Date.now() + DAY).toISOString() })
      .expect(404);
    await a.agent
      .post('/api/reviews/' + content.cycle.id)
      .send({
        rating: '部分改善',
        achieved: '部分做到',
        example: '',
        remaining: '',
        adjustments: '',
      })
      .expect(404);
    await a.agent.delete('/api/records/' + content.draft.id).expect(404);
    await a.agent
      .post('/api/records')
      .send({ title: '禁止创建', category: '其他', description: '' })
      .expect(409);
    await db.user.update({
      where: { id: b.user.id },
      data: { nickname: '新的昵称', avatarKey: 'a'.repeat(32) + '.webp' },
    });
    await a.agent.get('/api/users/' + b.user.id + '/avatar').expect(404);
    const card = (await a.agent.get('/api/spaces/closed').expect(200)).body.items[0];
    assert.equal(card.members.find((m: any) => m.id === b.user.id).nickname, oldNickname);
    assert.ok(card.members.every((m: any) => m.avatarUrl === null));
    assert.ok(!JSON.stringify(card).includes('新的昵称'));
    assert.ok(!('records' in card) && !('email' in card.members[0]));
    await a.agent.post('/api/spaces').send({ name: '新的空间' }).expect(201);
    const invite = (await a.agent.post('/api/spaces/invitations').expect(201)).body;
    await outsider.agent
      .post('/api/spaces/invitations/accept')
      .send({ token: invite.token })
      .expect(201);
    await outsider.agent.get(base).expect(404);
    assert.equal((await outsider.agent.get('/api/spaces/closed').expect(200)).body.total, 0);
  });

  it('双方确认后恢复原记录、私密权限和回访日期，旧邀请保持失效', async () => {
    const { a, b, space, invitation } = await fixture();
    const { record, draft, cycle } = await contents(a, b, space.id);
    const closed = (await close(b, space).expect(201)).body;
    const pending = (await restore(a, closed).expect(201)).body.restoreRequest;
    assert.ok(Date.parse(pending.expiresAt) <= Date.now() + 2 * DAY);
    await respond(a, space.id, pending.id).expect(404);
    await restore(b, closed).expect(409);
    await b.agent.get('/api/records/' + record.id).expect(404);
    await respond(b, space.id, pending.id).expect(201);
    const current = (await a.agent.get('/api/spaces/current').expect(200)).body;
    assert.equal(current.id, space.id);
    assert.equal(current.lifecycleVersion, 3);
    assert.equal(current.members.length, 2);
    await b.agent.get('/api/records/' + draft.id).expect(404);
    await a.agent.get('/api/records/' + draft.id).expect(200);
    const visible = (await b.agent.get('/api/records/' + record.id).expect(200)).body;
    assert.equal(
      visible.perspectives.find((p: any) => p.userId === a.user.id).content.facts,
      '已发布的事实',
    );
    assert.equal(visible.agreements[0].cycles[0].dueAt, cycle.dueAt.toISOString());
    assert.ok(
      (await b.agent.get('/api/dashboard').expect(200)).body.todos.some(
        (t: any) => t.kind === 'review',
      ),
    );
    const outsider = await account();
    await outsider.agent
      .post('/api/spaces/invitations/accept')
      .send({ token: invitation!.token })
      .expect(404);
    await respond(b, space.id, pending.id).expect(409);
    await close(a, space).expect(409);
    const closedAgain = (await close(a, current).expect(201)).body;
    assert.equal(closedAgain.restoreRequest, null);
  });

  it('单人关闭可恢复，重复关闭不延长截止时间，也不解除新空间', async () => {
    const { a, space } = await fixture(false);
    const invitation = (await a.agent.post('/api/spaces/invitations').expect(201)).body;
    const closed = (await close(a, space).expect(201)).body;
    const replay = (await close(a, space).expect(201)).body;
    assert.equal(replay.purgeAt, closed.purgeAt);
    const next = (await a.agent.post('/api/spaces').send({ name: '新单人空间' }).expect(201)).body;
    await close(a, space).expect(201);
    assert.equal((await a.agent.get('/api/spaces/current').expect(200)).body.id, next.id);
    await restore(a, closed, false).expect(409);
    await close(a, next).expect(201);
    await db.passwordChangeLimit.deleteMany();
    await restore(a, closed, false).expect(201);
    const current = (await a.agent.get('/api/spaces/current').expect(200)).body;
    assert.equal(current.members.length, 1);
    const secondClosure = (await close(a, current).expect(201)).body;
    assert.equal(secondClosure.lifecycleVersion, 4);
    await restore(a, closed, false).expect(409);
    assert.equal(
      (await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).revokedAt !== null,
      true,
    );
  });

  for (const action of ['reject', 'cancel'] as const) {
    it(action + '：只有对应角色能操作，处理后允许重新申请', async () => {
      const { a, b, space } = await fixture();
      const closed = (await close(a, space).expect(201)).body;
      const pending = (await restore(a, closed).expect(201)).body.restoreRequest;
      await respond(action === 'cancel' ? b : a, space.id, pending.id, action).expect(404);
      await respond(action === 'cancel' ? a : b, space.id, pending.id, action).expect(201);
      await respond(b, space.id, pending.id).expect(409);
      const next = (await restore(b, closed).expect(201)).body.restoreRequest;
      assert.notEqual(next.id, pending.id);
    });
  }

  it('48小时申请过期可重申，申请期限不能超过30天截止', async () => {
    const { a, b, space } = await fixture();
    const closed = (await close(a, space).expect(201)).body;
    const pending = (await restore(a, closed).expect(201)).body.restoreRequest;
    await db.spaceRestoreRequest.update({
      where: { id: pending.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await respond(b, space.id, pending.id).expect(409);
    const expiry = new Date(Date.now() + 60_000);
    await db.space.update({ where: { id: space.id }, data: { purgeAt: expiry } });
    const next = (await restore(a, closed).expect(201)).body.restoreRequest;
    assert.notEqual(next.id, pending.id);
    assert.equal(next.expiresAt, expiry.toISOString());
    assert.equal(
      (await db.spaceRestoreRequest.findUniqueOrThrow({ where: { id: pending.id } })).status,
      'expired',
    );
  });

  it('加入其他空间立即使旧申请失效，即使后来再次空闲也不能沿用', async () => {
    const { a, b, space } = await fixture();
    const closed = (await close(a, space).expect(201)).body;
    const pending = (await restore(a, closed).expect(201)).body.restoreRequest;
    const other = await fixture(false);
    const invite = (await other.a.agent.post('/api/spaces/invitations').expect(201)).body;
    await b.agent.post('/api/spaces/invitations/accept').send({ token: invite.token }).expect(201);
    assert.equal(
      (await db.spaceRestoreRequest.findUniqueOrThrow({ where: { id: pending.id } })).status,
      'invalidated',
    );
    await respond(b, space.id, pending.id).expect(409);
    await restore(a, closed).expect(409);
    await close(other.a, other.space).expect(201);
    await respond(b, space.id, pending.id).expect(409);
    assert.equal((await restore(b, closed).expect(201)).body.restoreRequest.status, 'pending');
  });

  it('发起人认证版本变化会使旧申请失效，双方不能用单人接口恢复', async () => {
    const { a, b, space } = await fixture();
    const closed = (await close(a, space).expect(201)).body;
    await restore(a, closed, false).expect(409);
    const pending = (await restore(a, closed).expect(201)).body.restoreRequest;
    await db.user.update({ where: { id: a.user.id }, data: { authVersion: { increment: 1 } } });
    assert.equal(
      (await b.agent.get('/api/spaces/closed').expect(200)).body.items[0].restoreRequest.status,
      'invalidated',
    );
    await respond(b, space.id, pending.id).expect(409);
  });

  it('保留期到点立即禁止恢复和列表显示，不依赖清理任务', async (context) => {
    const { a, space } = await fixture(false);
    const closed = (await close(a, space).expect(201)).body;
    const cutoff = Date.parse(closed.purgeAt);
    context.mock.timers.enable({ apis: ['Date'], now: cutoff });
    try {
      // Keep the test credential active so this asserts the retention boundary rather than session expiry.
      await db.session.update({
        where: { tokenHash: hashToken(a.token) },
        data: { expiresAt: new Date(cutoff + DAY) },
      });
      await restore(a, closed, false).expect(409);
      assert.equal((await a.agent.get('/api/spaces/closed').expect(200)).body.total, 0);
      assert.ok(await db.space.findUnique({ where: { id: space.id } }));
    } finally {
      context.mock.timers.reset();
    }
  });

  it('请求在关闭前通过鉴权，但关闭后才创建纸条时仍被阻止', async (context) => {
    const { a, space } = await fixture(false);
    const service = app.get(RecordsService);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = service.create.bind(service);
    const hook = context.mock.method(
      service,
      'create',
      async (...args: Parameters<typeof original>) => {
        entered();
        await gate;
        return original(...args);
      },
    );
    const writing = a.agent
      .post('/api/records')
      .send({ title: '在途纸条', category: '其他', description: '' })
      .then((r) => r);
    await started;
    await close(a, space).expect(201);
    release();
    assert.equal((await writing).status, 409);
    hook.mock.restore();
    assert.equal(await db.record.count({ where: { spaceId: space.id } }), 0);
  });

  it('关闭与接受邀请竞争不会留下错误绑定，两方同时关闭是幂等的', async () => {
    const { a, space } = await fixture(false);
    const b = await account();
    const invite = (await a.agent.post('/api/spaces/invitations').expect(201)).body;
    const results = await Promise.all([
      close(a, space),
      b.agent.post('/api/spaces/invitations/accept').send({ token: invite.token }),
    ]);
    assert.equal(results[0].status, 201);
    assert.ok([201, 404].includes(results[1].status));
    assert.equal(await db.user.count({ where: { spaceId: space.id } }), 0);
    const pair = await fixture();
    const simultaneous = await Promise.all([close(pair.a, pair.space), close(pair.b, pair.space)]);
    assert.ok(simultaneous.every((r) => r.status === 201));
    assert.equal(simultaneous[0].body.purgeAt, simultaneous[1].body.purgeAt);
  });

  it('恢复与创建新空间竞争时只能绑定一个空间', async () => {
    const { a, b, space } = await fixture();
    const closed = (await close(a, space).expect(201)).body;
    const pending = (await restore(a, closed).expect(201)).body.restoreRequest;
    const responses = await Promise.all([
      respond(b, space.id, pending.id),
      b.agent.post('/api/spaces').send({ name: '竞争的新空间' }),
    ]);
    assert.equal(responses.filter((r) => r.status === 201).length, 1);
    assert.ok(responses.every((r) => [201, 409].includes(r.status)));
    const current = await db.user.findUniqueOrThrow({ where: { id: b.user.id } });
    assert.ok(current.spaceId);
    const restored = await db.space.findUniqueOrThrow({ where: { id: space.id } });
    assert.equal(current.spaceId === space.id, restored.status === 'active');
  });

  it('旧页面携带的空间版本不能在关闭并恢复后继续写入', async () => {
    const { a, space } = await fixture(false);
    const closed = (await close(a, space).expect(201)).body;
    await restore(a, closed, false).expect(201);
    const response = await a.agent
      .post('/api/records')
      .set('X-Space-Id', space.id)
      .set('X-Space-Version', '1')
      .send({ title: '旧页面', category: '其他', description: '' })
      .expect(409);
    assert.equal(response.body.code, 'SPACE_CHANGED');
    const stale = { ...a.user, spaceId: space.id, spaceVersion: 1 } satisfies Actor;
    await assert.rejects(
      app.get(RecordsService).create(stale, {
        title: '旧鉴权快照',
        category: '其他',
        description: '',
      }),
      { status: 409 },
    );
  });

  it('到期清理删除完整子数据且保留账号和其他空间，失败后回滚重试', async (context) => {
    const { a, b, space } = await fixture();
    const content = await contents(a, b, space.id);
    const closed = (await close(a, space).expect(201)).body;
    await restore(a, closed).expect(201);
    const other = (await a.agent.post('/api/spaces').send({ name: '保留的新空间' }).expect(201))
      .body;
    await db.space.update({ where: { id: space.id }, data: { purgeAt: new Date(Date.now() - 1) } });
    const original = db.atomic.bind(db);
    const hook = context.mock.method(
      Database.prototype,
      'atomic',
      (fn: Parameters<typeof db.atomic>[0]) =>
        original((tx) =>
          fn({
            ...tx,
            invitation: {
              ...tx.invitation,
              deleteMany: async () => {
                throw new Error('cleanup failure');
              },
            },
          } as typeof tx),
        ),
    );
    await assert.rejects(app.get(SpaceCleanupService).sweep(), /cleanup failure/);
    hook.mock.restore();
    assert.ok(await db.record.findUnique({ where: { id: content.record.id } }));
    const clean = app.get(SpaceCleanupService);
    const counts = await Promise.all([clean.sweep(), clean.sweep()]);
    assert.equal(counts[0], counts[1]);
    assert.equal(await clean.sweep(), 0);
    assert.equal(await db.space.findUnique({ where: { id: space.id } }), null);
    assert.equal(await db.record.count({ where: { spaceId: space.id } }), 0);
    assert.equal(await db.agreement.findUnique({ where: { id: content.agreement.id } }), null);
    assert.equal(await db.reviewCycle.findUnique({ where: { id: content.cycle.id } }), null);
    assert.equal(await db.perspective.count({ where: { recordId: content.record.id } }), 0);
    assert.equal(await db.recordLink.count({ where: { recordId: content.record.id } }), 0);
    assert.equal(await db.spaceMembership.count({ where: { spaceId: space.id } }), 0);
    assert.equal(await db.spaceRestoreRequest.count({ where: { spaceId: space.id } }), 0);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: a.user.id } })).spaceId, other.id);
    assert.ok(await db.user.findUnique({ where: { id: b.user.id } }));
  });

  it('密码验证限流跨请求持久保留，超限不会关闭空间', async () => {
    const { a, space } = await fixture(false);
    for (let i = 0; i < 5; i++)
      await a.agent
        .post('/api/spaces/' + space.id + '/close')
        .send({ lifecycleVersion: 1, currentPassword: 'incorrect-pass' })
        .expect(400);
    await close(a, space).expect(429);
    assert.equal((await db.space.findUniqueOrThrow({ where: { id: space.id } })).status, 'active');
  });

  it('恢复确认与到期清理竞争不能复活已到期空间', async () => {
    const { a, b, space } = await fixture();
    const closed = (await close(a, space).expect(201)).body;
    const pending = (await restore(a, closed).expect(201)).body.restoreRequest;
    await db.space.update({ where: { id: space.id }, data: { purgeAt: new Date(0) } });
    const [response] = await Promise.all([
      respond(b, space.id, pending.id),
      app.get(SpaceCleanupService).sweep(),
    ]);
    assert.ok([404, 409].includes(response.status));
    assert.equal(await db.space.findUnique({ where: { id: space.id } }), null);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: a.user.id } })).spaceId, null);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: b.user.id } })).spaceId, null);
  });

  it('关闭后的过期卡片不占分页，也不泄漏其他账号的关闭空间', async () => {
    const a = await account();
    for (let index = 0; index < 22; index++) {
      await db.space.create({
        data: {
          name: '分页空间' + index,
          status: 'closed',
          lifecycleVersion: 2,
          closedAt: new Date(Date.now() - index * 1000),
          purgeAt: new Date(Date.now() + (index === 21 ? -1 : 1) * DAY),
          memberships: { create: { userId: a.user.id, nicknameSnapshot: a.user.nickname } },
        },
      });
    }
    const first = (await a.agent.get('/api/spaces/closed').expect(200)).body;
    const second = (await a.agent.get('/api/spaces/closed?page=2').expect(200)).body;
    assert.equal(first.total, 21);
    assert.equal(first.items.length, 20);
    assert.equal(second.items.length, 1);
    assert.equal(first.items[0].name, '分页空间0');
    assert.equal(second.items[0].name, '分页空间20');
    await a.agent.get('/api/spaces/closed?page=0').expect(400);
    assert.equal(
      (await (await account()).agent.get('/api/spaces/closed').expect(200)).body.total,
      0,
    );
  });

  it('重启会补清理到期空间，未到期空间与恢复申请继续保留', async () => {
    const expired = await fixture(false);
    const retained = await fixture();
    await close(expired.a, expired.space).expect(201);
    const closed = (await close(retained.a, retained.space).expect(201)).body;
    const pending = (await restore(retained.a, closed).expect(201)).body.restoreRequest;
    await db.space.update({ where: { id: expired.space.id }, data: { purgeAt: new Date(0) } });
    await app.close();
    app = await createApp(true);
    db = app.get(Database);
    assert.equal(await db.space.findUnique({ where: { id: expired.space.id } }), null);
    assert.equal(
      (await db.spaceRestoreRequest.findUniqueOrThrow({ where: { id: pending.id } })).status,
      'pending',
    );
    await request(app.getHttpServer())
      .get('/api/spaces/closed')
      .set('Cookie', retained.b.cookie)
      .expect(200);
  });

  it(
    'PostgreSQL多实例确认仅恢复一次，清理竞争保持原子性',
    { skip: !process.env.TEST_DATABASE_URL },
    async () => {
      const { a, b, space } = await fixture();
      const closed = (await close(a, space).expect(201)).body;
      const pending = (await restore(a, closed).expect(201)).body.restoreRequest;
      const second = await createApp(true);
      try {
        const path = '/api/spaces/' + space.id + '/restore-requests/' + pending.id + '/accept';
        const outcomes = await Promise.all([
          b.agent.post(path).send({ currentPassword: password }),
          request(second.getHttpServer())
            .post(path)
            .set('Cookie', b.cookie)
            .send({ currentPassword: password }),
        ]);
        assert.equal(outcomes.filter((r) => r.status === 201).length, 1);
        assert.ok(outcomes.every((r) => [201, 409].includes(r.status)));
        assert.equal(
          (await db.space.findUniqueOrThrow({ where: { id: space.id } })).lifecycleVersion,
          3,
        );
        const cleanup = await fixture(false);
        await close(cleanup.a, cleanup.space).expect(201);
        await db.space.update({ where: { id: cleanup.space.id }, data: { purgeAt: new Date(0) } });
        const counts = await Promise.all([
          app.get(SpaceCleanupService).sweep(),
          second.get(SpaceCleanupService).sweep(),
        ]);
        assert.equal(counts[0] + counts[1], 1);
      } finally {
        await second.close();
      }
    },
  );
});
