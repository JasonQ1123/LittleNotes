import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/main';
import { Database } from '../src/database';
import { hashToken } from '../src/auth';

type Agent = ReturnType<typeof request.agent>;
describe('小纸条：跨账号、跨空间与完整复盘流程', { concurrency: false }, () => {
  let app: INestApplication;
  let db: Database;
  let a: Agent;
  let b: Agent;
  let c: Agent;
  let d: Agent;
  let outsider: Agent;
  let users: any[];
  let noteId: string;
  let agreementId: string;
  let cycleId: string;
  let otherNoteId: string;
  const perspective = {
    facts: '周末安排变了',
    feelings: '私密感受-不可泄漏',
    causes: '担心没被考虑',
    needs: '提前沟通',
    adjustments: '说清楚需求',
  };
  const proposal = (baseVersion: number, dueAt?: string) => ({
    baseVersion,
    understanding: '我们都需要提前了解计划的变化',
    actions: [{ text: '计划变化后及时告知，并一起确认替代方案', assigneeId: 'both' }],
    criteria: '双方提前知道新的时间安排',
    ...(dueAt ? { dueAt } : {}),
  });
  before(async () => {
    const folder = mkdtempSync(join(tmpdir(), 'little-notes-api-'));
    process.env.DATABASE_URL = `file:${join(folder, 'test.db').replaceAll('\\', '/')}`;
    process.env.AI_ENABLED = 'false';
    process.env.WEB_ORIGIN = 'http://localhost:5173';
    const init = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    await init.$connect();
    await init.$disconnect();
    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      { cwd: resolve(__dirname, '..'), env: process.env, stdio: 'pipe' },
    );
    app = await createApp(true);
    db = app.get(Database);
    [a, b, c, d, outsider] = Array.from({ length: 5 }, () => request.agent(app.getHttpServer()));
    users = [];
    for (const [index, agent] of [a, b, c, d, outsider].entries()) {
      const response = await agent
        .post('/api/auth/register')
        .send({
          username: `person_${index}`,
          nickname: ['小林', '小安', '阿晴', '阿远', '访客'][index],
          password: 'paper-test-2026',
        })
        .expect(201);
      assert.match(response.headers['set-cookie'][0], /HttpOnly/);
      assert.match(response.headers['set-cookie'][0], /SameSite=Lax/);
      assert.equal(response.body.passwordHash, undefined);
      users.push(response.body);
    }
  });
  after(async () => {
    await app?.close();
  });

  it('登录校验、会话鉴权和跨源请求保护', async () => {
    await request(app.getHttpServer()).get('/api/records').expect(401);
    await a
      .post('/api/auth/login')
      .send({ username: 'person_0', password: 'incorrect-password' })
      .expect(401);
    await a
      .post('/api/auth/register')
      .send({ username: 'bad', nickname: '空', password: 'short' })
      .expect(400);
    await a
      .post('/api/auth/register')
      .send({ username: 'PERSON_0', nickname: '重复', password: 'paper-test-2026' })
      .expect(409);
    await a
      .post('/api/spaces')
      .set('Origin', 'https://untrusted.example')
      .send({ name: '不应该创建' })
      .expect(403);
  });
  it('邀请可以过期、撤销和单次使用，并发接受不会重复配对', async () => {
    await a.post('/api/spaces').send({ name: '小林与小安的小天地' }).expect(201);
    await a.post('/api/spaces').send({ name: '重复空间' }).expect(409);
    const expired = (await a.post('/api/spaces/invitations').expect(201)).body;
    await db.invitation.update({ where: { id: expired.id }, data: { expiresAt: new Date(0) } });
    await b.post('/api/spaces/invitations/accept').send({ token: expired.token }).expect(404);
    const revoked = (await a.post('/api/spaces/invitations').expect(201)).body;
    await a.delete(`/api/spaces/invitations/${revoked.id}`).expect(200);
    await b.post('/api/spaces/invitations/accept').send({ token: revoked.token }).expect(404);
    const invite = (await a.post('/api/spaces/invitations').expect(201)).body;
    const row = await db.invitation.findUniqueOrThrow({ where: { id: invite.id } });
    assert.equal(row.tokenHash, hashToken(invite.token));
    assert.notEqual(row.tokenHash, invite.token);
    const results = await Promise.all([
      b.post('/api/spaces/invitations/accept').send({ token: invite.token }),
      b.post('/api/spaces/invitations/accept').send({ token: invite.token }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    await outsider.post('/api/spaces/invitations/accept').send({ token: invite.token }).expect(404);
    const space = (await a.get('/api/spaces/current').expect(200)).body;
    assert.equal(space.members.length, 2);
    assert.equal(JSON.stringify(space).includes('tokenHash'), false);
    await a.post('/api/spaces/invitations').expect(409);
    await c.post('/api/spaces').send({ name: '另一个独立空间' }).expect(201);
    const invite2 = (await c.post('/api/spaces/invitations').expect(201)).body;
    await d.post('/api/spaces/invitations/accept').send({ token: invite2.token }).expect(201);
    otherNoteId = (await c.post('/api/records').send({ title: '另一个空间的秘密' }).expect(201))
      .body.id;
    await c.post(`/api/records/${otherNoteId}/publish`).expect(201);
  });
  it('只填写标题即可创建；伴侣不能读取草稿，也看不到私密内容的统计', async () => {
    await a.post('/api/records').send({ title: '空值校验', category: null }).expect(400);
    const note = (
      await a.post('/api/records').send({ title: '关于临时改变的周末计划' }).expect(201)
    ).body;
    noteId = note.id;
    assert.equal(note.status, 'draft');
    assert.equal(note.category, '其他');
    await b.get(`/api/records/${noteId}`).expect(404);
    assert.equal((await b.get('/api/records').expect(200)).body.total, 0);
    assert.equal((await b.get('/api/dashboard').expect(200)).body.recent.length, 0);
    assert.equal((await b.get('/api/dashboard/statistics').expect(200)).body.total, 0);
    await a
      .post(`/api/records/${noteId}/perspective`)
      .send({ ...perspective, revision: 0, publish: false })
      .expect(201);
    await a.post(`/api/records/${noteId}/publish`).expect(201);
    const shared = (await b.get(`/api/records/${noteId}`).expect(200)).body;
    assert.equal(shared.perspectives.length, 0);
    assert.equal(JSON.stringify(shared).includes(perspective.feelings), false);
    await b.delete(`/api/records/${noteId}`).expect(403);
  });
  it('视角按发布快照读取，后续私密编辑不会泄漏；双方不能修改对方概况或冒充作者', async () => {
    await a
      .post(`/api/records/${noteId}/perspective`)
      .send({ ...perspective, feelings: '已分享的感受', revision: 1, publish: true })
      .expect(201);
    await a
      .post(`/api/records/${noteId}/perspective`)
      .send({ ...perspective, feelings: '新的未发布内容', revision: 2, publish: false })
      .expect(201);
    const partnerView = (await b.get(`/api/records/${noteId}`).expect(200)).body;
    assert.equal(partnerView.perspectives[0].content.feelings, '已分享的感受');
    assert.equal(partnerView.perspectives[0].revision, undefined);
    assert.equal(JSON.stringify(partnerView).includes('新的未发布内容'), false);
    await b
      .post(`/api/records/${noteId}/perspective`)
      .send({ ...perspective, revision: 0, publish: true, userId: users[0].id })
      .expect(400);
    await b
      .patch(`/api/records/${noteId}`)
      .send({ title: '不允许修改', revision: partnerView.revision })
      .expect(403);
    await a.patch(`/api/records/${noteId}`).send({ title: '旧页面修改', revision: 1 }).expect(409);
    await a
      .patch(`/api/records/${noteId}`)
      .send({ title: null, revision: partnerView.revision })
      .expect(400);
    await a
      .patch(`/api/records/${noteId}`)
      .send({
        category: '承诺计划',
        description: '临时取消了周末出行，没有提前沟通',
        tags: ['周末', '临时变动'],
        revision: partnerView.revision,
      })
      .expect(200);
    assert.equal(
      (await b.get('/api/records?q=周末&category=承诺计划&tag=周末').expect(200)).body.total,
      1,
    );
  });
  it('一次确认不生效、重复确认不重复计数；被替换的方案无法继续确认', async () => {
    const v1 = (await a.post(`/api/records/${noteId}/agreements`).send(proposal(0)).expect(201))
      .body.agreements[0];
    await a.post(`/api/agreements/${v1.id}/confirm`).expect(201);
    const repeat = (await a.post(`/api/agreements/${v1.id}/confirm`).expect(201)).body
      .agreements[0];
    assert.equal(repeat.status, 'pending');
    assert.equal(repeat.confirmations.length, 1);
    assert.equal(repeat.cycles.length, 0);
    await a
      .post(`/api/records/${noteId}/agreements`)
      .send({ ...proposal(1), actions: [{ text: '非法负责人', assigneeId: users[2].id }] })
      .expect(400);
    const v2 = (await b.post(`/api/records/${noteId}/agreements`).send(proposal(1)).expect(201))
      .body.agreements[0];
    agreementId = v2.id;
    await a.post(`/api/records/${noteId}/agreements`).send(proposal(1)).expect(409);
    await b.post(`/api/agreements/${v1.id}/confirm`).expect(409);
    const results = await Promise.all(
      [a, a, b, b].map((agent) => agent.post(`/api/agreements/${v2.id}/confirm`)),
    );
    assert.ok(results.every((r) => r.status === 201));
    const note = (await a.get(`/api/records/${noteId}`).expect(200)).body;
    const active = note.agreements.filter((x: any) => x.status === 'active');
    assert.equal(active.length, 1);
    assert.equal(active[0].confirmations.length, 2);
    assert.equal(active[0].cycles.length, 1);
    assert.equal(note.status, 'followup');
    assert.ok(
      Math.abs(
        new Date(active[0].cycles[0].dueAt).getTime() -
          new Date(active[0].activatedAt).getTime() -
          7 * 86400_000,
      ) < 3000,
    );
  });
  it('新版本需要双方重新确认，在此之前旧约定继续生效', async () => {
    const previousId = agreementId;
    const note = (await a.post(`/api/records/${noteId}/agreements`).send(proposal(2)).expect(201))
      .body;
    agreementId = note.agreements[0].id;
    assert.equal(note.agreements.find((x: any) => x.id === previousId).status, 'active');
    await a.post(`/api/agreements/${agreementId}/confirm`).expect(201);
    const waiting = (await a.get(`/api/records/${noteId}`).expect(200)).body;
    assert.equal(waiting.agreements.find((x: any) => x.id === previousId).status, 'active');
    assert.equal(
      (await a.get('/api/dashboard').expect(200)).body.todos.some((x: any) => x.kind === 'confirm'),
      false,
    );
    assert.equal(
      (await b.get('/api/dashboard').expect(200)).body.todos.some((x: any) => x.kind === 'confirm'),
      true,
    );
    const confirmed = (await b.post(`/api/agreements/${agreementId}/confirm`).expect(201)).body;
    assert.equal(confirmed.agreements.find((x: any) => x.id === previousId).status, 'superseded');
    cycleId = confirmed.agreements[0].cycles[0].id;
  });
  it('独立回访保留分歧，只清除本人的待办；新一轮保留旧回访', async () => {
    await a
      .post(`/api/agreements/${agreementId}/schedule`)
      .send({ dueAt: new Date(Date.now() - 60_000).toISOString() })
      .expect(201);
    for (const agent of [a, b])
      assert.equal((await agent.get('/api/dashboard').expect(200)).body.counts.dueReviews, 1);
    const review = {
      rating: '明显改善',
      achieved: '已做到',
      example: '这次计划变动前有沟通',
      remaining: '',
      adjustments: '',
    };
    await a.post(`/api/reviews/${cycleId}`).send(review).expect(201);
    assert.equal((await a.get('/api/dashboard').expect(200)).body.counts.dueReviews, 0);
    assert.equal((await b.get('/api/dashboard').expect(200)).body.counts.dueReviews, 1);
    const note = (
      await b
        .post(`/api/reviews/${cycleId}`)
        .send({ ...review, rating: '没有改善', example: '仍然觉得通知得太晚' })
        .expect(201)
    ).body;
    assert.deepEqual(
      note.agreements[0].cycles[0].reviews.map((r: any) => r.rating).sort(),
      ['明显改善', '没有改善'].sort(),
    );
    const next = (
      await a
        .post(`/api/agreements/${agreementId}/schedule`)
        .send({ dueAt: new Date(Date.now() - 10_000).toISOString() })
        .expect(201)
    ).body;
    assert.equal(next.agreements[0].cycles.length, 2);
    assert.equal(next.agreements[0].cycles[1].reviews.length, 2);
    await a.post(`/api/reviews/${cycleId}`).send(review).expect(409);
    cycleId = next.agreements[0].cycles[0].id;
    const one = (await a.post(`/api/records/${noteId}/reconcile`).send({ value: true }).expect(201))
      .body;
    assert.equal(one.reconciled, false);
    const both = (
      await b.post(`/api/records/${noteId}/reconcile`).send({ value: true }).expect(201)
    ).body;
    assert.equal(both.reconciled, true);
    assert.equal((await a.get('/api/dashboard').expect(200)).body.counts.dueReviews, 1);
  });
  it('跨空间访问记录、约定、回访、关联和 AI 均被拒绝', async () => {
    await c.get(`/api/records/${noteId}`).expect(404);
    await c.patch(`/api/records/${noteId}`).send({ title: '越权修改', revision: 3 }).expect(404);
    await c.post(`/api/records/${noteId}/publish`).expect(404);
    await c.delete(`/api/records/${noteId}`).expect(404);
    await c
      .post(`/api/records/${noteId}/perspective`)
      .send({ ...perspective, publish: true, revision: 0 })
      .expect(404);
    await c.post(`/api/records/${noteId}/agreements`).send(proposal(3)).expect(404);
    await c.post(`/api/agreements/${agreementId}/confirm`).expect(404);
    await c
      .post(`/api/agreements/${agreementId}/schedule`)
      .send({ dueAt: new Date().toISOString() })
      .expect(404);
    await c
      .post(`/api/reviews/${cycleId}`)
      .send({ rating: '明显改善', achieved: '已做到', example: '', remaining: '', adjustments: '' })
      .expect(404);
    await c.post(`/api/records/${noteId}/reconcile`).send({ value: true }).expect(404);
    await c.post(`/api/records/${noteId}/archive`).expect(404);
    await a.post(`/api/records/${noteId}/links`).send({ relatedId: otherNoteId }).expect(404);
    await c.post(`/api/ai/records/${noteId}/summarize`).expect(404);
    assert.equal((await c.get('/api/dashboard/statistics').expect(200)).body.total, 1);
  });
  it('AI 默认关闭且不调用外部服务；历史关联形成真实的重复主题', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error('不应该产生 AI 网络请求');
    };
    try {
      for (const action of ['summarize', 'related']) {
        const response = await a.post(`/api/ai/records/${noteId}/${action}`).expect(403);
        assert.equal(response.body.code, 'AI_DISABLED');
      }
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
    await a.post(`/api/records/${noteId}/links`).send({ relatedId: noteId }).expect(400);
    const next = (
      await a
        .post('/api/records')
        .send({ title: '类似的事情再次发生', category: '承诺计划' })
        .expect(201)
    ).body;
    await a.post(`/api/records/${next.id}/publish`).expect(201);
    assert.equal((await a.get('/api/dashboard/statistics').expect(200)).body.recurring.length, 0);
    await a.post(`/api/records/${next.id}/links`).send({ relatedId: noteId }).expect(201);
    await b.post(`/api/records/${noteId}/links`).send({ relatedId: next.id }).expect(201);
    assert.equal((await b.get(`/api/records/${noteId}`).expect(200)).body.related.length, 1);
    const stats = (await b.get('/api/dashboard/statistics').expect(200)).body;
    assert.equal(stats.recurring.length, 1);
    assert.equal(stats.recurring[0].count, 2);
    assert.equal(stats.ratings[0].total, 1);
    assert.equal(stats.ratings[1].total, 1);
  });
  it('归档必须双方确认，归档后内容只读，个人待办停止', async () => {
    const first = (await a.post(`/api/records/${noteId}/archive`).expect(201)).body;
    assert.equal(first.status, 'followup');
    assert.equal(
      (await b.get('/api/dashboard').expect(200)).body.todos.some(
        (t: any) => t.kind === 'archive' && t.recordId === noteId,
      ),
      true,
    );
    const second = (await b.post(`/api/records/${noteId}/archive`).expect(201)).body;
    assert.equal(second.status, 'archived');
    await a.post(`/api/records/${noteId}/agreements`).send(proposal(3)).expect(409);
    await a
      .post(`/api/reviews/${cycleId}`)
      .send({ rating: '明显改善', achieved: '已做到', example: '', remaining: '', adjustments: '' })
      .expect(409);
    await a.delete(`/api/records/${noteId}`).expect(403);
    assert.equal(
      (await a.get('/api/dashboard').expect(200)).body.todos.some(
        (t: any) => t.recordId === noteId,
      ),
      false,
    );
  });
  it('两位不同用户同时接受邀请，只有一人能够加入', async () => {
    await outsider.post('/api/spaces').send({ name: '并发配对验证' }).expect(201);
    const guests = [request.agent(app.getHttpServer()), request.agent(app.getHttpServer())];
    for (const [index, guest] of guests.entries())
      await guest
        .post('/api/auth/register')
        .send({
          username: `race_guest_${index}`,
          nickname: `候选${index}`,
          password: 'paper-test-2026',
        })
        .expect(201);
    const invitation = (await outsider.post('/api/spaces/invitations').expect(201)).body;
    const results = await Promise.all(
      guests.map((guest) =>
        guest.post('/api/spaces/invitations/accept').send({ token: invitation.token }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.ok(results.every((r) => [201, 404, 409].includes(r.status)));
    assert.equal((await outsider.get('/api/spaces/current').expect(200)).body.members.length, 2);
  });
  it('统计覆盖时间范围的每个月，未来日期不计入当前趋势', async () => {
    for (const daysOffset of [-29, 90]) {
      const record = (
        await c
          .post('/api/records')
          .send({
            title: `日期验证 ${daysOffset}`,
            occurredAt: new Date(Date.now() + daysOffset * 86400_000).toISOString(),
          })
          .expect(201)
      ).body;
      await c.post(`/api/records/${record.id}/publish`).expect(201);
    }
    const stats = (await c.get('/api/dashboard/statistics?days=30').expect(200)).body;
    assert.equal(stats.total, 2);
    assert.equal(
      stats.trend.reduce((sum: number, item: any) => sum + item.count, 0),
      stats.total,
    );
  });
  it('删除仅限本人草稿，退出和重登、服务重启后数据与会话仍然存在', async () => {
    const draft = (await a.post('/api/records').send({ title: '准备删除的私密草稿' }).expect(201))
      .body;
    await b.delete(`/api/records/${draft.id}`).expect(404);
    await a.delete(`/api/records/${draft.id}`).expect(200);
    await a.get(`/api/records/${draft.id}`).expect(404);
    await a.post('/api/auth/logout').expect(200);
    await a.get('/api/auth/me').expect(401);
    const login = await a
      .post('/api/auth/login')
      .send({ username: 'person_0', password: 'paper-test-2026' })
      .expect(200);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    await app.close();
    app = await createApp(true);
    db = app.get(Database);
    const persisted = (
      await request(app.getHttpServer())
        .get(`/api/records/${noteId}`)
        .set('Cookie', cookie)
        .expect(200)
    ).body;
    assert.equal(persisted.status, 'archived');
    assert.equal(persisted.agreements.length, 3);
    assert.equal(persisted.related.length, 1);
    assert.equal(persisted.agreements[0].cycles[1].reviews.length, 2);
  });
});
