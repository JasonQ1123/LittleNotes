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
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { randomBytes, createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { Request, Response } from 'express';
import { Database } from './database';
import { LoginDto, RegisterDto } from './dto';

export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export const PUBLIC = 'public';
export const Public = () => SetMetadata(PUBLIC, true);
export type Actor = { id: string; username: string; nickname: string; spaceId: string | null };
export const userSelect = { id: true, username: true, nickname: true, spaceId: true } as const;
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
        select: userSelect,
      });
    });
  }
  async login(dto: LoginDto): Promise<Actor> {
    const user = await this.db.user.findUnique({ where: { username: dto.username.toLowerCase() } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password)))
      throw new UnauthorizedException('用户名或密码不正确');
    return { id: user.id, username: user.username, nickname: user.nickname, spaceId: user.spaceId };
  }
  async setSession(user: Actor, res: Response, oldToken?: string) {
    const token = randomBytes(32).toString('hex');
    const maxAge = 7 * 24 * 60 * 60_000;
    await this.db.atomic(async (tx) => {
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
    });
    res.cookie(cookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge,
      path: '/',
    });
    return user;
  }
  async logout(req: Request, res: Response) {
    const token = req.cookies?.[cookieName];
    if (typeof token === 'string')
      await this.db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    res.clearCookie(cookieName, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
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
    return user;
  }
}
