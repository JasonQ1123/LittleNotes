import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/main';
import { Database } from '../src/database';

describe('个人资料和头像', { concurrency: false }, () => {
  let app: INestApplication;
  let a: ReturnType<typeof request.agent>;
  let b: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  let db: Database;
  let id: string;
  let png: Buffer;
  let initialKey: string;
  let directory: string;
  before(async () => {
    const folder = await mkdtemp(join(tmpdir(), 'little-notes-profile-'));
    directory = join(folder, 'avatars');
    const postgresUrl = process.env.TEST_DATABASE_URL;
    if (
      postgresUrl &&
      !/^ln_test_[a-z0-9_]+$/.test(new URL(postgresUrl).searchParams.get('schema') || '')
    )
      throw new Error('Tests require an isolated PostgreSQL schema');
    process.env.DATABASE_URL =
      postgresUrl || `file:${join(folder, 'test.db').replaceAll('\\', '/')}`;
    process.env.AVATAR_STORAGE_DIR = directory;
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
    [a, b, outsider] = Array.from({ length: 3 }, () => request.agent(app.getHttpServer()));
    for (const [i, agent] of [a, b, outsider].entries()) {
      const response = await agent
        .post('/api/auth/register')
        .send({ username: `profile_${i}`, nickname: `原昵称${i}`, password: 'profile-test-2026' })
        .expect(201);
      assert.equal(response.body.avatarUrl, null);
      assert.equal(response.body.avatarKey, undefined);
      if (!i) id = response.body.id;
    }
    await a.post('/api/spaces').send({ name: '资料测试空间' }).expect(201);
    const invite = (await a.post('/api/spaces/invitations').expect(201)).body;
    await b.post('/api/spaces/invitations/accept').send({ token: invite.token }).expect(201);
    png = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#789267' } })
      .png()
      .toBuffer();
  });
  after(async () => {
    await app?.close();
  });

  it('修改昵称只影响本人资料，保留作者归属并更新成员显示', async () => {
    const note = (await a.post('/api/records').send({ title: '原有记录' }).expect(201)).body;
    const updated = (await a.patch('/api/users/me').send({ nickname: '  新的小名  ' }).expect(200))
      .body;
    assert.equal(updated.nickname, '新的小名');
    assert.equal(updated.username, 'profile_0');
    assert.equal(updated.avatarKey, undefined);
    const record = (await a.get(`/api/records/${note.id}`).expect(200)).body;
    assert.equal(record.authorId, id);
    assert.equal(record.space.members.find((m: any) => m.id === id).nickname, '新的小名');
    assert.equal(
      (await b.get('/api/spaces/current')).body.members.find((m: any) => m.id === id).nickname,
      '新的小名',
    );
    assert.equal((await a.get('/api/auth/me')).body.nickname, '新的小名');
    await a.patch('/api/users/me').send({ nickname: '   ' }).expect(400);
    await a
      .patch('/api/users/me')
      .send({ nickname: '名'.repeat(31) })
      .expect(400);
    await a.patch('/api/users/me').send({ nickname: '不应保存', username: 'other' }).expect(400);
    await outsider.patch(`/api/users/${id}`).send({ nickname: '不应保存' }).expect(404);
    await request(app.getHttpServer())
      .patch('/api/users/me')
      .send({ nickname: '不应保存' })
      .expect(401);
  });

  it('上传真实图片并重新编码，仅允许本人和同空间成员读取', async () => {
    const uploaded = (
      await a.put('/api/users/me/avatar').attach('file', png, 'photo.png').expect(200)
    ).body;
    assert.match(uploaded.avatarUrl, new RegExp(`/api/users/${id}/avatar\\?v=`));
    assert.equal(uploaded.avatarKey, undefined);
    initialKey = (await db.user.findUniqueOrThrow({ where: { id } })).avatarKey!;
    const image = await a
      .get(uploaded.avatarUrl)
      .expect(200)
      .expect('Content-Type', /image\/webp/);
    assert.match(image.headers['cache-control'], /no-store/);
    const metadata = await sharp(image.body).metadata();
    assert.equal(metadata.width, 256);
    assert.equal(metadata.height, 256);
    assert.equal(metadata.exif, undefined);
    await b.get(uploaded.avatarUrl).expect(200);
    await outsider.get(uploaded.avatarUrl).expect(404);
    await request(app.getHttpServer()).get(uploaded.avatarUrl).expect(401);
    await request(app.getHttpServer())
      .put('/api/users/me/avatar')
      .attach('file', png, 'photo.png')
      .expect(401);
    assert.equal(
      (await b.get('/api/spaces/current')).body.members.find((m: any) => m.id === id).avatarUrl,
      uploaded.avatarUrl,
    );
  });

  it('拒绝坏图、伪装格式、超限、多文件和过大像素，失败保留旧头像', async () => {
    await a
      .put('/api/users/me/avatar')
      .attach(
        'file',
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"></svg>'),
        'fake.png',
      )
      .expect(400);
    await a
      .put('/api/users/me/avatar')
      .attach('file', Buffer.from('not an image'), 'bad.png')
      .expect(400);
    await a
      .put('/api/users/me/avatar')
      .attach('file', Buffer.alloc(192 * 1024 + 1), 'big.webp')
      .expect(413);
    await a
      .put('/api/users/me/avatar')
      .attach('file', png, 'one.png')
      .attach('file', png, 'two.png')
      .expect(400);
    await a.put('/api/users/me/avatar').expect(400);
    const large = await sharp({
      create: { width: 2048, height: 2048, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await a.put('/api/users/me/avatar').attach('file', large, 'pixels.png').expect(400);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id } })).avatarKey, initialKey);
    assert.deepEqual(await readdir(directory), [initialKey]);
  });

  it('数据库写入失败时删除本次上传文件并保留旧头像', async (context) => {
    const atomic = context.mock.method(Database.prototype, 'atomic', async () => {
      throw new Error('Simulated database failure');
    });
    const logger = context.mock.method(console, 'error', () => undefined);
    try {
      await a.put('/api/users/me/avatar').attach('file', png, 'failed.png').expect(500);
    } finally {
      atomic.mock.restore();
      logger.mock.restore();
    }
    assert.deepEqual(await readdir(directory), [initialKey]);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id } })).avatarKey, initialKey);
  });

  it('并发修改昵称与头像保留两项结果，替换头像保留备份所需旧文件', async () => {
    const changes = await Promise.all([
      a.patch('/api/users/me').send({ nickname: '一起更新' }),
      a.put('/api/users/me/avatar').attach('file', png, 'new.png'),
      a.put('/api/users/me/avatar').attach('file', png, 'another.png'),
    ]);
    assert.deepEqual(
      changes.map((r) => r.status),
      [200, 200, 200],
    );
    const me = (await a.get('/api/auth/me').expect(200)).body;
    assert.equal(me.nickname, '一起更新');
    assert.ok(changes.slice(1).some((r) => r.body.avatarUrl === me.avatarUrl));
    await a.get(me.avatarUrl).expect(200);
    assert.equal((await readdir(directory)).length, 3);
    assert.ok((await readFile(join(directory, initialKey))).length);
    await app.close();
    app = await createApp(true);
    a = request.agent(app.getHttpServer());
    const loggedIn = (
      await a
        .post('/api/auth/login')
        .send({ username: 'profile_0', password: 'profile-test-2026' })
        .expect(200)
    ).body;
    assert.equal(loggedIn.nickname, '一起更新');
    assert.equal(loggedIn.avatarUrl, me.avatarUrl);
    await a.get(me.avatarUrl).expect(200);
  });

  it('恢复默认头像可重复调用，文件不再能通过原地址读取', async () => {
    const me = (await a.get('/api/auth/me')).body;
    assert.equal((await a.delete('/api/users/me/avatar').expect(200)).body.avatarUrl, null);
    await a.get(me.avatarUrl).expect(404);
    assert.equal((await a.delete('/api/users/me/avatar').expect(200)).body.avatarUrl, null);
  });
});
