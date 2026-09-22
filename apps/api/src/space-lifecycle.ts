import {
  Body,
  Controller,
  Get,
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { Actor, AuthService, CurrentUser, hashToken } from './auth';
import { Database } from './database';
import { ClosedSpacesQueryDto, SpaceLifecycleDto, SpacePasswordDto } from './dto';
import { invalidateRestoreRequests, spaceConflict, spaceMissing } from './space-access';

const DAY = 86400_000;
const closedInclude = Prisma.validator<Prisma.SpaceInclude>()({
  memberships: { include: { user: { select: { spaceId: true, authVersion: true } } } },
  restoreRequests: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
});
type LifecycleSpace = Prisma.SpaceGetPayload<{ include: typeof closedInclude }>;

// Both callers must validate the target inside the same transaction. Lock the closed
// version before deleting children so a concurrent restore cannot reopen it midway.
async function purgeClosedSpace(
  tx: Prisma.TransactionClient,
  space: { id: string; lifecycleVersion: number },
) {
  const locked = await tx.space.updateMany({
    where: { id: space.id, status: 'closed', lifecycleVersion: space.lifecycleVersion },
    data: { lifecycleVersion: space.lifecycleVersion },
  });
  if (!locked.count) throw spaceConflict();
  // Record children cascade; outer space relations restrict deletion.
  await tx.record.deleteMany({ where: { spaceId: space.id } });
  await tx.invitation.deleteMany({ where: { spaceId: space.id } });
  await tx.spaceRestoreRequest.deleteMany({ where: { spaceId: space.id } });
  await tx.spaceMembership.deleteMany({ where: { spaceId: space.id } });
  await tx.space.delete({ where: { id: space.id } });
}

@Injectable()
export class SpaceLifecycleService {
  constructor(
    private db: Database,
    private auth: AuthService,
  ) {}

  private async require(tx: Prisma.TransactionClient, user: Actor, id: string) {
    const space = await tx.space.findFirst({
      where: { id, memberships: { some: { userId: user.id } } },
      include: closedInclude,
    });
    if (!space) throw spaceMissing();
    return space;
  }
  private assertClosed(space: LifecycleSpace, version?: number) {
    if (space.status !== 'closed' || (version !== undefined && space.lifecycleVersion !== version))
      throw spaceConflict();
    if (!space.purgeAt || space.purgeAt.getTime() <= Date.now())
      throw spaceConflict('SPACE_EXPIRED', '空间已超过30天保留期，无法恢复');
  }
  private assertAvailable(space: LifecycleSpace) {
    if (!space.memberships.length || space.memberships.some((m) => m.user.spaceId))
      throw spaceConflict('RESTORE_UNAVAILABLE', '暂不满足恢复条件，请确认双方均没有当前空间');
  }
  private effectiveStatus(space: LifecycleSpace) {
    const request = space.restoreRequests[0];
    if (request?.lifecycleVersion !== space.lifecycleVersion) return undefined;
    if (!request || request.status !== 'pending') return request?.status;
    if (request.expiresAt.getTime() <= Date.now()) return 'expired';
    const requester = space.memberships.find((m) => m.userId === request.requestedById);
    if (
      space.status !== 'closed' ||
      request.lifecycleVersion !== space.lifecycleVersion ||
      requester?.user.authVersion !== request.requesterAuthVersion ||
      space.memberships.some((m) => m.user.spaceId)
    )
      return 'invalidated';
    return 'pending';
  }
  private summary(space: LifecycleSpace) {
    const request =
      space.restoreRequests[0]?.lifecycleVersion === space.lifecycleVersion
        ? space.restoreRequests[0]
        : undefined;
    return {
      id: space.id,
      name: space.name,
      lifecycleVersion: space.lifecycleVersion,
      closedAt: space.closedAt,
      purgeAt: space.purgeAt,
      members: space.memberships.map((m) => ({
        id: m.userId,
        nickname: m.nicknameSnapshot,
        avatarUrl: null,
      })),
      canRestore: space.memberships.every((m) => !m.user.spaceId),
      restoreRequest: request
        ? {
            id: request.id,
            requestedById: request.requestedById,
            status: this.effectiveStatus(space),
            createdAt: request.createdAt,
            expiresAt: request.expiresAt,
          }
        : null,
    };
  }
  async closed(user: Actor, page = 1) {
    const where: Prisma.SpaceWhereInput = {
      status: 'closed',
      purgeAt: { gt: new Date() },
      memberships: { some: { userId: user.id } },
    };
    const [spaces, total] = await Promise.all([
      this.db.space.findMany({
        where,
        include: closedInclude,
        orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      this.db.space.count({ where }),
    ]);
    return { items: spaces.map((space) => this.summary(space)), total, page, pageSize: 20 };
  }
  async purge(user: Actor, id: string, dto: SpaceLifecycleDto, token: string, ip: string) {
    await this.require(this.db, user, id);
    const credential = await this.auth.verifyCurrent(user, dto.currentPassword, ip);
    return this.db.atomic(async (tx) => {
      await this.auth.checkSession(tx, credential, token);
      const space = await this.require(tx, user, id);
      // Deletion is independent of restoration eligibility and the retention deadline.
      if (space.status !== 'closed' || space.lifecycleVersion !== dto.lifecycleVersion)
        throw spaceConflict();
      await purgeClosedSpace(tx, space);
      return { ok: true };
    });
  }
  async close(user: Actor, id: string, dto: SpaceLifecycleDto, token: string, ip: string) {
    // Check membership before prompting credential work; unrelated IDs always return 404.
    await this.require(this.db, user, id);
    const credential = await this.auth.verifyCurrent(user, dto.currentPassword, ip);
    return this.db.atomic(async (tx) => {
      await this.auth.checkSession(tx, credential, token);
      const space = await this.require(tx, user, id);
      // A retry can only acknowledge exactly the closure it originally targeted.
      if (space.status === 'closed' && space.lifecycleVersion === dto.lifecycleVersion + 1)
        return this.summary(space);
      if (space.status !== 'active' || space.lifecycleVersion !== dto.lifecycleVersion)
        throw spaceConflict();
      const members = await tx.user.findMany({ where: { spaceId: id } });
      if (!members.some((m) => m.id === user.id)) throw spaceConflict();
      const now = new Date();
      for (const member of members) {
        await tx.spaceMembership.upsert({
          where: { spaceId_userId: { spaceId: id, userId: member.id } },
          create: { spaceId: id, userId: member.id, nicknameSnapshot: member.nickname },
          update: { nicknameSnapshot: member.nickname },
        });
      }
      await tx.space.update({
        where: { id },
        data: {
          status: 'closed',
          lifecycleVersion: { increment: 1 },
          closedAt: now,
          closedById: user.id,
          purgeAt: new Date(now.getTime() + 30 * DAY),
        },
      });
      await tx.user.updateMany({ where: { spaceId: id }, data: { spaceId: null } });
      await tx.invitation.updateMany({
        where: { spaceId: id, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.spaceRestoreRequest.updateMany({
        where: { spaceId: id, status: 'pending' },
        data: { status: 'invalidated', resolvedAt: now },
      });
      return this.summary(await this.require(tx, user, id));
    });
  }
  private async reopen(tx: Prisma.TransactionClient, space: LifecycleSpace) {
    this.assertClosed(space);
    this.assertAvailable(space);
    const userIds = space.memberships.map((m) => m.userId);
    await invalidateRestoreRequests(tx, userIds);
    const updated = await tx.user.updateMany({
      where: { id: { in: userIds }, spaceId: null },
      data: { spaceId: space.id },
    });
    if (updated.count !== userIds.length) throw spaceConflict('RESTORE_UNAVAILABLE');
    await tx.space.update({
      where: { id: space.id },
      data: {
        status: 'active',
        lifecycleVersion: { increment: 1 },
        closedAt: null,
        closedById: null,
        purgeAt: null,
      },
    });
    return { ok: true, spaceId: space.id };
  }
  async restore(
    user: Actor,
    id: string,
    dto: SpaceLifecycleDto,
    token: string,
    ip: string,
    paired: boolean,
  ) {
    await this.require(this.db, user, id);
    const credential = await this.auth.verifyCurrent(user, dto.currentPassword, ip);
    return this.db.atomic(async (tx) => {
      await this.auth.checkSession(tx, credential, token);
      const space = await this.require(tx, user, id);
      this.assertClosed(space, dto.lifecycleVersion);
      this.assertAvailable(space);
      if (space.memberships.length !== (paired ? 2 : 1))
        throw spaceConflict('RESTORE_CONFIRMATION_REQUIRED', '请使用该空间对应的恢复方式');
      if (!paired) return this.reopen(tx, space);
      const old = space.restoreRequests[0];
      const status = this.effectiveStatus(space);
      if (old?.status === 'pending') {
        if (status === 'pending') {
          if (old.requestedById === user.id) return this.summary(space);
          throw spaceConflict('RESTORE_PENDING', '已有恢复申请，请明确选择同意或拒绝');
        }
        await tx.spaceRestoreRequest.update({
          where: { id: old.id },
          data: { status, resolvedAt: new Date() },
        });
      }
      await tx.spaceRestoreRequest.create({
        data: {
          spaceId: id,
          requestedById: user.id,
          requesterAuthVersion: credential.authVersion,
          lifecycleVersion: space.lifecycleVersion,
          expiresAt: new Date(Math.min(Date.now() + 2 * DAY, space.purgeAt!.getTime())),
        },
      });
      return this.summary(await this.require(tx, user, id));
    });
  }
  async respond(
    user: Actor,
    id: string,
    requestId: string,
    action: 'accept' | 'reject' | 'cancel',
    token: string,
    ip: string,
    password?: string,
  ) {
    const initial = await this.require(this.db, user, id);
    const requested = await this.db.spaceRestoreRequest.findFirst({
      where: { id: requestId, spaceId: id },
    });
    if (!requested || (action === 'cancel') !== (requested.requestedById === user.id))
      throw spaceMissing();
    if (initial.memberships.length !== 2) throw spaceMissing();
    const credential =
      action === 'accept' ? await this.auth.verifyCurrent(user, password!, ip) : null;
    return this.db.atomic(async (tx) => {
      if (credential) await this.auth.checkSession(tx, credential, token);
      else {
        const session = await tx.session.findUnique({ where: { tokenHash: hashToken(token) } });
        if (!session || session.userId !== user.id || session.expiresAt.getTime() <= Date.now())
          throw new UnauthorizedException('登录已过期，请重新登录');
      }
      const space = await this.require(tx, user, id);
      this.assertClosed(space);
      const request = space.restoreRequests[0];
      if (request?.id !== requestId || this.effectiveStatus(space) !== 'pending')
        throw spaceConflict('RESTORE_REQUEST_EXPIRED', '恢复申请已失效，请刷新后重新申请');
      if (action === 'accept') {
        await this.reopen(tx, space);
        await tx.spaceRestoreRequest.update({
          where: { id: requestId },
          data: { status: 'accepted', resolvedAt: new Date() },
        });
        return { ok: true, spaceId: id };
      }
      await tx.spaceRestoreRequest.update({
        where: { id: requestId },
        data: { status: action === 'cancel' ? 'cancelled' : 'rejected', resolvedAt: new Date() },
      });
      return { ok: true };
    });
  }
}

@Injectable()
export class SpaceCleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<number>;
  constructor(private db: Database) {}
  async onApplicationBootstrap() {
    await this.sweep().catch(() => console.warn('空间到期清理失败，将自动重试'));
    this.timer = setInterval(() => {
      void this.sweep().catch(() => console.warn('空间到期清理失败，将自动重试'));
    }, 60_000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running?.catch(() => undefined);
  }
  sweep(): Promise<number> {
    if (this.running) return this.running;
    const work = this.clean();
    this.running = work;
    void work
      .finally(() => {
        this.running = undefined;
      })
      .catch(() => undefined);
    return work;
  }
  private async clean() {
    const start = Date.now();
    let count = 0;
    let cursor: string | undefined;
    for (;;) {
      const spaces = await this.db.space.findMany({
        where: {
          status: 'closed',
          purgeAt: { lte: new Date() },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: 50,
        select: { id: true },
      });
      if (!spaces.length) break;
      for (const candidate of spaces) {
        count += await this.db.atomic(async (tx) => {
          const space = await tx.space.findFirst({
            where: { id: candidate.id, status: 'closed', purgeAt: { lte: new Date() } },
          });
          if (!space) return 0;
          await purgeClosedSpace(tx, space);
          return 1;
        });
      }
      cursor = spaces[spaces.length - 1].id;
    }
    if (count) console.info('空间到期清理完成', { count, durationMs: Date.now() - start });
    return count;
  }
}

const tokenOf = (req: Request): string => req.cookies?.paper_session || '';
@ApiTags('Spaces')
@ApiCookieAuth()
@Controller('spaces')
export class SpaceLifecycleController {
  constructor(private service: SpaceLifecycleService) {}
  @Get('closed') closed(@CurrentUser() user: Actor, @Query() query: ClosedSpacesQueryDto) {
    return this.service.closed(user, query.page);
  }
  @Post(':id/purge') purge(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: SpaceLifecycleDto,
    @Req() req: Request,
  ) {
    return this.service.purge(user, id, dto, tokenOf(req), req.ip || '');
  }
  @Post(':id/close') close(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: SpaceLifecycleDto,
    @Req() req: Request,
  ) {
    return this.service.close(user, id, dto, tokenOf(req), req.ip || '');
  }
  @Post(':id/restore') restore(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: SpaceLifecycleDto,
    @Req() req: Request,
  ) {
    return this.service.restore(user, id, dto, tokenOf(req), req.ip || '', false);
  }
  @Post(':id/restore-requests') request(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: SpaceLifecycleDto,
    @Req() req: Request,
  ) {
    return this.service.restore(user, id, dto, tokenOf(req), req.ip || '', true);
  }
  @Post(':id/restore-requests/:requestId/accept') accept(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() dto: SpacePasswordDto,
    @Req() req: Request,
  ) {
    return this.service.respond(
      user,
      id,
      requestId,
      'accept',
      tokenOf(req),
      req.ip || '',
      dto.currentPassword,
    );
  }
  @Post(':id/restore-requests/:requestId/reject') reject(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Req() req: Request,
  ) {
    return this.service.respond(user, id, requestId, 'reject', tokenOf(req), req.ip || '');
  }
  @Post(':id/restore-requests/:requestId/cancel') cancel(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Req() req: Request,
  ) {
    return this.service.respond(user, id, requestId, 'cancel', tokenOf(req), req.ip || '');
  }
}
