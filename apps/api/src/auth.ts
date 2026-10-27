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
  ForbiddenException,
  NotFoundException,
  Put,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { randomBytes, createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { Request, Response } from 'express';
import { Database } from './database';
import {
  BindEmailCodeDto,
  BindEmailDto,
  ChangePasswordDto,
  EmailCodeDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto';
import { EmailService, invalidCode } from './email';
import { Prisma } from '@prisma/client';
import { spaceConflict } from './space-access';

export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export const PUBLIC = 'public';
export const Public = () => SetMetadata(PUBLIC, true);
const EMAIL_OPTIONAL = 'emailOptional';
const EmailOptional = () => SetMetadata(EMAIL_OPTIONAL, true);
export type Actor = {
  id: string;
  username: string;
  nickname: string;
  spaceId: string | null;
  avatarKey: string | null;
  spaceVersion?: number;
};
// Kept inside the authentication service; never serialize this credential to a response.
type OwnUser = Actor & { email: string | null; emailVerifiedAt: Date | null; authVersion: number };
type VerifiedUser = OwnUser & { passwordHash: string };
export const memberSelect = { id: true, nickname: true, avatarKey: true } as const;
export const userSelect = { ...memberSelect, username: true, spaceId: true } as const;
export const authSelect = {
  ...userSelect,
  space: { select: { lifecycleVersion: true } },
  email: true,
  emailVerifiedAt: true,
  authVersion: true,
} as const;
export function ownProfile(user: OwnUser) {
  const { email, emailVerifiedAt, authVersion: _version, ...profile } = user;
  // Never spread credentials into a response, including registration/login return values.
  return {
    ...withAvatar({
      id: profile.id,
      username: profile.username,
      nickname: profile.nickname,
      spaceId: profile.spaceId,
      avatarKey: profile.avatarKey,
    }),
    requiresEmailBinding: !email || !emailVerifiedAt,
    maskedEmail: email ? `${email.split('@')[0].slice(0, 1)}***@${email.split('@')[1]}` : null,
  };
}
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
      include: { user: { select: authSelect } },
    });
    if (!session || session.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedException('登录已过期，请重新登录');
    req.user = { ...session.user, spaceVersion: session.user.space?.lifecycleVersion };
    // Browser mutations carry their displayed space generation; never use it to grant access.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-space-id']) {
      if (
        req.headers['x-space-id'] !== session.user.spaceId ||
        req.headers['x-space-version'] !== String(session.user.space?.lifecycleVersion)
      )
        throw spaceConflict();
    }
    if (
      (!session.user.email || !session.user.emailVerifiedAt) &&
      !this.reflector.getAllAndOverride(EMAIL_OPTIONAL, [ctx.getHandler(), ctx.getClass()])
    )
      throw new ForbiddenException({
        code: 'EMAIL_BINDING_REQUIRED',
        message: '请先验证邮箱，再继续使用小纸条',
      });
    return true;
  }
}

@Injectable()
export class AuthService {
  private attempts = new Map<string, { count: number; until: number }>();
  private readonly attemptLimit = Number(process.env.AUTH_LIMIT_PER_15M || 40);
  constructor(
    private db: Database,
    private email: EmailService,
  ) {
    if (!Number.isSafeInteger(this.attemptLimit) || this.attemptLimit < 1)
      throw new Error('AUTH_LIMIT_PER_15M 必须是正整数');
  }
  limit(ip: string) {
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.until < now) this.attempts.delete(key);
    const entry = this.attempts.get(ip) || { count: 0, until: now + 15 * 60_000 };
    if (++entry.count > this.attemptLimit)
      throw new HttpException('尝试次数较多，请 15 分钟后再试', 429);
    this.attempts.set(ip, entry);
  }
  async register(dto: RegisterDto) {
    const username = dto.username.toLowerCase();
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const result = await this.db.atomic(async (tx) => {
      if (await tx.user.findUnique({ where: { username } }))
        throw new ConflictException('这个用户名已经有人使用了');
      if (!(await this.email.verify(tx, dto, 'register'))) return null;
      if (await tx.user.findUnique({ where: { email: dto.email } }))
        throw new ConflictException('该邮箱无法用于注册，请使用其他邮箱或找回密码');
      return tx.user.create({
        data: {
          username,
          nickname: dto.nickname,
          passwordHash,
          email: dto.email,
          emailVerifiedAt: new Date(),
        },
        select: { ...authSelect, passwordHash: true },
      });
    });
    if (!result) throw invalidCode();
    return result;
  }
  async login(dto: LoginDto): Promise<VerifiedUser> {
    const user = await this.db.user.findUnique({
      where: { username: dto.username.toLowerCase() },
      select: { ...authSelect, passwordHash: true },
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
        where: { id: user.id, passwordHash: user.passwordHash, authVersion: user.authVersion },
        data: { authVersion: user.authVersion },
      });
      if (!matched.count) throw new UnauthorizedException('账号安全信息已变更，请重新登录');
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
      return tx.user.findUniqueOrThrow({ where: { id: user.id }, select: authSelect });
    });
    this.setCookie(res, token, maxAge);
    return ownProfile(currentUser);
  }
  private setCookie(res: Response, token: string, maxAge = 7 * 24 * 60 * 60_000) {
    res.cookie(cookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge,
      path: '/',
    });
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
    if (!allowed) throw new HttpException('账号安全验证次数较多，请 15 分钟后再试', 429);
  }
  async changePassword(user: Actor, dto: ChangePasswordDto, token: string, ip: string) {
    if (dto.newPassword !== dto.confirmPassword)
      throw new BadRequestException('两次输入的新密码不一致');
    if (dto.currentPassword === dto.newPassword)
      throw new BadRequestException('新密码不能与当前密码相同');
    await this.limitPasswordChange(user.id, ip);
    const credential = await this.db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, authVersion: true, email: true },
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
        where: {
          id: user.id,
          passwordHash: credential.passwordHash,
          authVersion: credential.authVersion,
        },
        data: { passwordHash, authVersion: { increment: 1 } },
      });
      if (!changed.count) throw new UnauthorizedException('密码已变更，请使用新密码重新登录');
      await tx.session.deleteMany({ where: { userId: user.id } });
      await this.email.invalidate(tx, user.id, [credential.email]);
    });
    return { ok: true };
  }
  requestRegisterCode(dto: EmailCodeDto, ip: string) {
    return this.db.atomic((tx) => this.email.request(tx, dto.email, 'register', ip));
  }
  requestResetCode(dto: EmailCodeDto, ip: string) {
    return this.db.atomic((tx) => this.email.request(tx, dto.email, 'reset', ip));
  }
  async verifyCurrent(user: Actor, password: string, ip: string) {
    await this.limitPasswordChange(user.id, ip);
    const credential = await this.db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { ...authSelect, passwordHash: true },
    });
    if (!(await argon2.verify(credential.passwordHash, password)))
      throw new BadRequestException('当前密码不正确');
    return credential;
  }
  async checkSession(tx: Prisma.TransactionClient, credential: VerifiedUser, token: string) {
    const session = await tx.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!session || session.userId !== credential.id || session.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedException('登录已过期，请重新登录');
    const matched = await tx.user.updateMany({
      where: {
        id: credential.id,
        authVersion: credential.authVersion,
        passwordHash: credential.passwordHash,
      },
      data: { authVersion: credential.authVersion },
    });
    if (!matched.count) throw new UnauthorizedException('账号安全信息已变更，请重新登录');
  }
  async requestEmailCode(user: Actor, dto: BindEmailCodeDto, token: string, ip: string) {
    const credential = await this.verifyCurrent(user, dto.currentPassword, ip);
    if (credential.email === dto.email)
      throw new BadRequestException('请输入与当前绑定不同的新邮箱');
    return this.db.atomic(async (tx) => {
      await this.checkSession(tx, credential, token);
      return this.email.request(
        tx,
        dto.email,
        credential.emailVerifiedAt ? 'replace' : 'bind',
        ip,
        credential,
      );
    });
  }
  async bindEmail(user: Actor, dto: BindEmailDto, token: string, ip: string, res: Response) {
    const credential = await this.verifyCurrent(user, dto.currentPassword, ip);
    const replacing = !!credential.emailVerifiedAt;
    const nextToken = randomBytes(32).toString('hex');
    const result = await this.db.atomic(async (tx) => {
      await this.checkSession(tx, credential, token);
      if (!(await this.email.verify(tx, dto, replacing ? 'replace' : 'bind', credential)))
        return null;
      if (await tx.user.findUnique({ where: { email: dto.email } }))
        throw new ConflictException('该邮箱无法绑定，请使用其他邮箱');
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { email: dto.email, emailVerifiedAt: new Date(), authVersion: { increment: 1 } },
        select: authSelect,
      });
      await this.email.invalidate(tx, user.id, [credential.email, dto.email]);
      await tx.session.deleteMany({ where: { userId: user.id } });
      if (!replacing)
        await tx.session.create({
          data: {
            tokenHash: hashToken(nextToken),
            userId: user.id,
            expiresAt: new Date(Date.now() + 7 * 86400_000),
          },
        });
      return updated;
    });
    if (!result) throw invalidCode();
    if (replacing) this.clearSessionCookie(res);
    else this.setCookie(res, nextToken);
    return { ok: true, requiresLogin: replacing };
  }
  async resetPassword(dto: ResetPasswordDto) {
    if (dto.newPassword !== dto.confirmPassword)
      throw new BadRequestException('两次输入的新密码不一致');
    // Check/consume the code before expensive hashing; a later error rolls everything back.
    const result = await this.db.atomic(async (tx) => {
      const user = await tx.user.findUnique({ where: { email: dto.email } });
      if (!user?.emailVerifiedAt || !(await this.email.verify(tx, dto, 'reset', user)))
        return false;
      const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, authVersion: { increment: 1 } },
      });
      await this.email.invalidate(tx, user.id, [user.email]);
      await tx.session.deleteMany({ where: { userId: user.id } });
      return true;
    });
    if (!result) throw invalidCode();
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
  @EmailOptional()
  @Get('me')
  me(@CurrentUser() user: OwnUser) {
    return ownProfile(user);
  }
  @Public()
  @Post('register/code')
  @HttpCode(200)
  registerCode(@Body() dto: EmailCodeDto, @Req() req: Request) {
    return this.service.requestRegisterCode(dto, req.ip || 'local');
  }
  @Public()
  @Post('password/reset/code')
  @HttpCode(200)
  resetCode(@Body() dto: EmailCodeDto, @Req() req: Request) {
    return this.service.requestResetCode(dto, req.ip || 'local');
  }
  @Public()
  @Post('password/reset')
  @HttpCode(200)
  async reset(@Body() dto: ResetPasswordDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.service.resetPassword(dto);
    this.service.clearSessionCookie(res);
    return result;
  }
  @EmailOptional()
  @Post('email/code')
  @HttpCode(200)
  emailCode(@CurrentUser() user: Actor, @Body() dto: BindEmailCodeDto, @Req() req: Request) {
    return this.service.requestEmailCode(user, dto, req.cookies[cookieName], req.ip || 'local');
  }
  @EmailOptional()
  @Put('email')
  bind(
    @CurrentUser() user: Actor,
    @Body() dto: BindEmailDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.service.bindEmail(user, dto, req.cookies[cookieName], req.ip || 'local', res);
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

@Controller('dev/mail')
export class MockMailController {
  constructor(private email: EmailService) {}
  @Public()
  @Get()
  inbox(@Req() req: Request) {
    if (
      this.email.mode !== 'mock' ||
      process.env.NODE_ENV === 'production' ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')
    )
      throw new NotFoundException();
    return this.email.mockInbox();
  }
}
