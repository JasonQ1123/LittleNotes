import {
  Body,
  CanActivate,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Post,
  Req,
  Res,
  SetMetadata,
  UnauthorizedException,
  ConflictException,
  HttpException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { randomBytes, createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { Request, Response } from 'express';
import { Database } from './database';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto';

export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export const PUBLIC = 'public';
export const Public = () => SetMetadata(PUBLIC, true);
export type Actor = {
  id: string;
  username: string;
  nickname: string;
  spaceId: string | null;
  avatarKey: string | null;
};
// Kept inside the authentication service; never serialize this credential to a response.
type VerifiedUser = Actor & { passwordHash: string };
export const memberSelect = { id: true, nickname: true, avatarKey: true } as const;
export const userSelect = { ...memberSelect, username: true, spaceId: true } as const;
export function withAvatar<T extends { id: string; avatarKey: string | null }>(user: T) {
  const { avatarKey, ...profile } = user;
  return {
    ...profile,
    avatarUrl: avatarKey ? `/api/users/${user.id}/avatar?v=${encodeURIComponent(avatarKey)}` : null,
  };
}
export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): Actor => context.switchToHttp().getRequest().user,
);
const cookieName = 'paper_session';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private db: Database,
    private reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride(PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const token = req.cookies?.[cookieName];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
      throw new UnauthorizedException('请先登录小纸条');
    const session = await this.db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: userSelect } },
    });
    if (!session || session.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedException('登录已过期，请重新登录');
    req.user = session.user;
    return true;
  }
}

@Injectable()
export class AuthService {
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(private db: Database) {}
  limit(ip: string) {
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.until < now) this.attempts.delete(key);
    const entry = this.attempts.get(ip) || { count: 0, until: now + 15 * 60_000 };
    if (++entry.count > 40) throw new HttpException('尝试次数较多，请 15 分钟后再试', 429);
    this.attempts.set(ip, entry);
  }
  async register(dto: RegisterDto) {
    const username = dto.username.toLowerCase();
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    return this.db.atomic(async (tx) => {
      if (await tx.user.findUnique({ where: { username } }))
        throw new ConflictException('这个用户名已经有人使用了');
      return tx.user.create({
        data: { username, nickname: dto.nickname, passwordHash },
        select: { ...userSelect, passwordHash: true },
      });
    });
  }
  async login(dto: LoginDto): Promise<VerifiedUser> {
    const user = await this.db.user.findUnique({
      where: { username: dto.username.toLowerCase() },
      select: { ...userSelect, passwordHash: true },
    });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password)))
      throw new UnauthorizedException('用户名或密码不正确');
    return user;
  }
  async setSession(user: VerifiedUser, res: Response, oldToken?: string) {
    const token = randomBytes(32).toString('hex');
    const maxAge = 7 * 24 * 60 * 60_000;
    const currentUser = await this.db.atomic(async (tx) => {
      // A conditional write serializes session issuance with password changes, including
      // on different PostgreSQL API instances. A previously verified hash cannot be reused.
      const matched = await tx.user.updateMany({
        where: { id: user.id, passwordHash: user.passwordHash },
        data: { passwordHash: user.passwordHash },
      });
      if (!matched.count) throw new UnauthorizedException('密码已变更，请使用新密码重新登录');
      await tx.session.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            ...(oldToken ? [{ tokenHash: hashToken(oldToken) }] : []),
          ],
        },
      });
      await tx.session.create({
        data: {
          tokenHash: hashToken(token),
          userId: user.id,
          expiresAt: new Date(Date.now() + maxAge),
        },
      });
      return tx.user.findUniqueOrThrow({ where: { id: user.id }, select: userSelect });
    });
    res.cookie(cookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge,
      path: '/',
    });
    return withAvatar(currentUser);
  }
  private async limitPasswordChange(userId: string, ip: string) {
    const allowed = await this.db.atomic(async (tx) => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60_000);
      const limits = [
        { key: `user:${userId}`, maximum: 5 },
        { key: `ip:${hashToken(ip)}`, maximum: 40 },
      ];
      await tx.passwordChangeLimit.deleteMany({ where: { expiresAt: { lte: now } } });
      for (const { key, maximum } of limits) {
        const entry = await tx.passwordChangeLimit.findUnique({ where: { key } });
        if (entry && entry.count >= maximum) return false;
      }
      for (const { key } of limits)
        await tx.passwordChangeLimit.upsert({
          where: { key },
          create: { key, count: 1, expiresAt },
          update: { count: { increment: 1 } },
        });
      return true;
    });
    if (!allowed) throw new HttpException('修改密码尝试次数较多，请 15 分钟后再试', 429);
  }
  async changePassword(user: Actor, dto: ChangePasswordDto, token: string, ip: string) {
    if (dto.newPassword !== dto.confirmPassword)
      throw new BadRequestException('两次输入的新密码不一致');
    if (dto.currentPassword === dto.newPassword)
      throw new BadRequestException('新密码不能与当前密码相同');
    await this.limitPasswordChange(user.id, ip);
    const credential = await this.db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!(await argon2.verify(credential.passwordHash, dto.currentPassword)))
      throw new BadRequestException('当前密码不正确');
    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await this.db.atomic(async (tx) => {
      // The guard may have run before another request revoked this session.
      const session = await tx.session.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!session || session.userId !== user.id || session.expiresAt.getTime() <= Date.now())
        throw new UnauthorizedException('登录已过期，请重新登录');
      const changed = await tx.user.updateMany({
        where: { id: user.id, passwordHash: credential.passwordHash },
        data: { passwordHash },
      });
      if (!changed.count) throw new UnauthorizedException('密码已变更，请使用新密码重新登录');
      await tx.session.deleteMany({ where: { userId: user.id } });
    });
    return { ok: true };
  }
  clearSessionCookie(res: Response) {
    res.clearCookie(cookieName, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }
  async logout(req: Request, res: Response) {
    const token = req.cookies?.[cookieName];
    if (typeof token === 'string')
      await this.db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    this.clearSessionCookie(res);
    return { ok: true };
  }
}

@ApiTags('Auth')
@ApiCookieAuth()
@Controller('auth')
export class AuthController {
  constructor(private service: AuthService) {}
  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.service.limit(req.ip || 'local');
    return this.service.setSession(
      await this.service.register(dto),
      res,
      req.cookies?.[cookieName],
    );
  }
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.service.limit(req.ip || 'local');
    return this.service.setSession(await this.service.login(dto), res, req.cookies?.[cookieName]);
  }
  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.service.logout(req, res);
  }
  @Get('me') me(@CurrentUser() user: Actor) {
    return withAvatar(user);
  }
  @Post('password/change')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: Actor,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.changePassword(
      user,
      dto,
      req.cookies[cookieName],
      req.ip || 'local',
    );
    this.service.clearSessionCookie(res);
    return result;
  }
}
