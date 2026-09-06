import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import { Database } from './database';
import { Actor, CurrentUser, hashToken, userSelect, withAvatar } from './auth';
import { AcceptInvitationDto, CreateSpaceDto } from './dto';

@Injectable()
export class SpacesService {
  constructor(private db: Database) {}
  async current(user: Actor) {
    if (!user.spaceId) return null;
    const space = await this.db.space.findUnique({
      where: { id: user.spaceId },
      include: {
        members: { select: userSelect },
        invitations: {
          where: {
            creatorId: user.id,
            revokedAt: null,
            acceptedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { id: true, expiresAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    return space ? { ...space, members: space.members.map(withAvatar) } : null;
  }
  create(user: Actor, dto: CreateSpaceDto) {
    return this.db.atomic(async (tx) => {
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (current.spaceId) throw new ConflictException('你已经拥有一个共同空间');
      const space = await tx.space.create({ data: { name: dto.name } });
      await tx.user.update({ where: { id: user.id }, data: { spaceId: space.id } });
      return space;
    });
  }
  invite(user: Actor) {
    return this.db.atomic(async (tx) => {
      if (!user.spaceId) throw new ConflictException('请先创建共同空间');
      if ((await tx.user.count({ where: { spaceId: user.spaceId } })) >= 2)
        throw new ConflictException('共同空间已经有两个人了');
      await tx.invitation.updateMany({
        where: { spaceId: user.spaceId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const token = randomBytes(32).toString('hex');
      const invitation = await tx.invitation.create({
        data: {
          tokenHash: hashToken(token),
          creatorId: user.id,
          spaceId: user.spaceId,
          expiresAt: new Date(Date.now() + 48 * 3600_000),
        },
      });
      return { id: invitation.id, token, expiresAt: invitation.expiresAt };
    });
  }
  accept(user: Actor, dto: AcceptInvitationDto) {
    return this.db.atomic(async (tx) => {
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (current.spaceId) throw new ConflictException('你已加入共同空间，不能重复配对');
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash: hashToken(dto.token) },
      });
      if (
        !invitation ||
        invitation.acceptedAt ||
        invitation.revokedAt ||
        invitation.expiresAt.getTime() <= Date.now()
      )
        throw new NotFoundException('邀请已失效，请让对方重新发送');
      if ((await tx.user.count({ where: { spaceId: invitation.spaceId } })) >= 2)
        throw new ConflictException('这个空间已经有两个人了');
      await tx.user.update({ where: { id: user.id }, data: { spaceId: invitation.spaceId } });
      await tx.invitation.updateMany({
        where: { spaceId: invitation.spaceId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date(), revokedAt: null },
      });
      return { spaceId: invitation.spaceId };
    });
  }
  async revoke(user: Actor, id: string) {
    const result = await this.db.invitation.updateMany({
      where: { id, creatorId: user.id, spaceId: user.spaceId || '', acceptedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('邀请不存在');
    return { ok: true };
  }
}

@ApiTags('Spaces')
@ApiCookieAuth()
@Controller('spaces')
export class SpacesController {
  constructor(private service: SpacesService) {}
  @Get('current') current(@CurrentUser() user: Actor) {
    return this.service.current(user);
  }
  @Post() create(@CurrentUser() user: Actor, @Body() dto: CreateSpaceDto) {
    return this.service.create(user, dto);
  }
  @Post('invitations') invite(@CurrentUser() user: Actor) {
    return this.service.invite(user);
  }
  @Post('invitations/accept') accept(@CurrentUser() user: Actor, @Body() dto: AcceptInvitationDto) {
    return this.service.accept(user, dto);
  }
  @Delete('invitations/:id') revoke(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.revoke(user, id);
  }
}
