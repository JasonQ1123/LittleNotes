import { it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

it('旧版本增量迁移回填成员并保留原数据，关闭状态可随SQLite备份完整恢复', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'little-notes-space-upgrade-'));
  const pg = process.env.TEST_DATABASE_URL;
  if (pg && !/^ln_test_[a-z0-9_]+$/.test(new URL(pg).searchParams.get('schema') || ''))
    throw new Error('Migration checks require an isolated test schema');
  const schemaName = 'ln_test_migration_' + randomUUID().replaceAll('-', '');
  const url = pg ? new URL(pg) : undefined;
  url?.searchParams.set('schema', schemaName);
  const database = join(folder, 'legacy.db');
  const datasourceUrl = url?.href || 'file:' + database.replaceAll('\\', '/');
  const admin = pg ? new PrismaClient({ datasourceUrl: pg }) : null;
  const client = new PrismaClient({ datasourceUrl });
  const source = resolve(__dirname, '../prisma', pg ? 'postgresql' : '');
  const migrations = join(folder, 'migrations');
  const latest = '20260907000000_space_lifecycle';
  mkdirSync(migrations);
  copyFileSync(join(source, 'schema.prisma'), join(folder, 'schema.prisma'));
  for (const entry of readdirSync(join(source, 'migrations'))) {
    if (entry !== latest)
      cpSync(join(source, 'migrations', entry), join(migrations, entry), { recursive: true });
  }
  const migrate = () =>
    execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        join(folder, 'schema.prisma'),
      ],
      { env: { ...process.env, DATABASE_URL: datasourceUrl }, stdio: 'pipe' },
    );
  try {
    if (admin) await admin.$executeRawUnsafe('CREATE SCHEMA "' + schemaName + '"');
    await client.$connect();
    migrate();
    await client.$executeRawUnsafe(
      'INSERT INTO "Space" ("id", "name", "createdAt") VALUES (\'legacy-space\', \'旧空间\', CURRENT_TIMESTAMP)',
    );
    for (const id of ['legacy-a', 'legacy-b']) {
      await client.user.create({
        data: {
          id,
          username: id,
          nickname: '旧昵称' + id,
          passwordHash: 'unchanged-test-hash',
          spaceId: 'legacy-space',
        },
      });
    }
    await client.record.create({
      data: {
        id: 'legacy-note',
        spaceId: 'legacy-space',
        authorId: 'legacy-a',
        title: '需要保留的旧纸条',
        perspectives: { create: { userId: 'legacy-a', draftJson: '{"facts":"未公开内容"}' } },
      },
    });
    const before = await client.record.findUnique({
      where: { id: 'legacy-note' },
      include: { perspectives: true },
    });
    cpSync(join(source, 'migrations', latest), join(migrations, latest), { recursive: true });
    migrate();
    assert.deepEqual(
      await client.record.findUnique({
        where: { id: 'legacy-note' },
        include: { perspectives: true },
      }),
      before,
    );
    const space = await client.space.findUniqueOrThrow({
      where: { id: 'legacy-space' },
      include: { memberships: { orderBy: { userId: 'asc' } }, members: true },
    });
    assert.equal(space.status, 'active');
    assert.equal(space.lifecycleVersion, 1);
    assert.equal(space.members.length, 2);
    assert.deepEqual(
      space.memberships.map((m) => m.userId),
      ['legacy-a', 'legacy-b'],
    );
    assert.ok(space.members.every((m) => m.passwordHash === 'unchanged-test-hash'));
    assert.ok(space.memberships.every((m) => m.nicknameSnapshot === '旧昵称' + m.userId));
    // A repeated deploy must not duplicate membership or reset any lifecycle state.
    await client.space.update({
      where: { id: space.id },
      data: {
        status: 'closed',
        lifecycleVersion: 2,
        closedAt: new Date(),
        closedById: 'legacy-a',
        purgeAt: new Date(Date.now() + 30 * 86400_000),
      },
    });
    await client.user.updateMany({ where: { spaceId: space.id }, data: { spaceId: null } });
    migrate();
    const closed = await client.space.findUniqueOrThrow({
      where: { id: space.id },
      include: { memberships: { orderBy: { userId: 'asc' } }, records: true },
    });
    assert.equal(closed.status, 'closed');
    assert.equal(closed.memberships.length, 2);
    if (!pg) {
      await client.$disconnect();
      const restoredPath = join(folder, 'restored.db');
      copyFileSync(database, restoredPath);
      const restored = new PrismaClient({
        datasourceUrl: 'file:' + restoredPath.replaceAll('\\', '/'),
      });
      try {
        assert.deepEqual(
          await restored.space.findUniqueOrThrow({
            where: { id: space.id },
            include: { memberships: { orderBy: { userId: 'asc' } }, records: true },
          }),
          closed,
        );
      } finally {
        await restored.$disconnect();
      }
    }
  } finally {
    await client.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe('DROP SCHEMA IF EXISTS "' + schemaName + '" CASCADE');
      await admin.$disconnect();
    }
  }
});
