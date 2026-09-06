import {
  BadRequestException,
  HttpException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import nodemailer, { Transporter } from 'nodemailer';
import { Database } from './database';

export type EmailPurpose = 'register' | 'bind' | 'replace' | 'reset';
export const invalidCode = () => new BadRequestException('验证码无效或已过期，请重新申请');
export type MockMessage = {
  challengeId: string;
  email: string;
  purpose: string;
  code: string;
  expiresAt: string;
};
const purposes = { register: '注册账号', bind: '绑定邮箱', replace: '更换邮箱', reset: '找回密码' };
const numberOption = (name: string, fallback: number) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} 必须是正整数`);
  return value;
};

@Injectable()
export class EmailService implements OnModuleInit, OnModuleDestroy {
  readonly mode =
    process.env.EMAIL_DELIVERY || (process.env.NODE_ENV === 'production' ? 'smtp' : 'mock');
  readonly cooldown = numberOption('EMAIL_COOLDOWN_SECONDS', 60);
  private readonly secret = process.env.EMAIL_HMAC_SECRET || randomBytes(32).toString('hex');
  private readonly limits = {
    emailHour: numberOption('EMAIL_LIMIT_EMAIL_HOUR', 5),
    emailDay: numberOption('EMAIL_LIMIT_EMAIL_DAY', 10),
    ipHour: numberOption('EMAIL_LIMIT_IP_HOUR', 20),
    globalDay: numberOption('EMAIL_LIMIT_GLOBAL_DAY', 200),
  };
  private transporter?: Transporter;
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private lastCleanup = 0;
  // Only the explicitly non-production mock inbox retains plaintext, in memory, for local QA.
  private inbox: MockMessage[] = [];
  constructor(private db: Database) {
    if (!['mock', 'smtp'].includes(this.mode))
      throw new Error('EMAIL_DELIVERY 必须是 smtp 或 mock');
    if (process.env.NODE_ENV === 'production' && this.mode !== 'smtp')
      throw new Error('生产环境禁止模拟邮件发送');
    if (this.mode === 'smtp') {
      if (!/^[a-f0-9]{64,}$/i.test(process.env.EMAIL_HMAC_SECRET || ''))
        throw new Error('SMTP 模式需要独立的 EMAIL_HMAC_SECRET（至少 32 随机字节的十六进制值）');
      if (
        !/^[A-Za-z0-9_.-]+@163\.com$/i.test(process.env.SMTP_USER || '') ||
        !process.env.SMTP_AUTH_CODE
      )
        throw new Error('请配置专用 163 邮箱 SMTP_USER 和 SMTP_AUTH_CODE 授权码');
      this.transporter = nodemailer.createTransport({
        host: 'smtp.163.com',
        port: 465,
        secure: true,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_AUTH_CODE },
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        logger: false,
        debug: false,
      });
    }
  }
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.drain().catch(() => {
        // Never log SMTP responses, recipients, message bodies, or credentials.
        console.warn('邮件任务暂时无法处理，请检查数据库连接');
      });
    }, 1000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
    this.transporter?.close();
    this.inbox = [];
  }
  mockInbox() {
    if (this.mode !== 'mock' || process.env.NODE_ENV === 'production') return [];
    this.inbox = this.inbox.filter((m) => new Date(m.expiresAt).getTime() > Date.now());
    return [...this.inbox].reverse();
  }
  private mac(value: string) {
    return createHmac('sha256', this.secret).update(value).digest('hex');
  }
  private digest(id: string, email: string, purpose: string, code: string) {
    return this.mac(JSON.stringify(['code', id, email, purpose, code]));
  }
  private async rateLimit(tx: Prisma.TransactionClient, email: string, ip: string) {
    const now = new Date();
    const emailKey = this.mac(`email:${email}`);
    const items = [
      { key: `cooldown:${emailKey}`, maximum: 1, seconds: this.cooldown },
      { key: `email-hour:${emailKey}`, maximum: this.limits.emailHour, seconds: 3600 },
      { key: `email-day:${emailKey}`, maximum: this.limits.emailDay, seconds: 86400 },
      { key: `ip:${this.mac(ip)}`, maximum: this.limits.ipHour, seconds: 3600 },
      { key: 'global-day', maximum: this.limits.globalDay, seconds: 86400 },
    ];
    await tx.emailLimit.deleteMany({ where: { expiresAt: { lte: now } } });
    for (const item of items) {
      const limit = await tx.emailLimit.findUnique({ where: { key: item.key } });
      if (limit && limit.count >= item.maximum)
        throw new HttpException(
          {
            message: '申请较频繁，请稍后重试',
            retryAfter: Math.ceil((limit.expiresAt.getTime() - now.getTime()) / 1000),
          },
          429,
        );
    }
    for (const item of items)
      await tx.emailLimit.upsert({
        where: { key: item.key },
        create: {
          key: item.key,
          count: 1,
          expiresAt: new Date(now.getTime() + item.seconds * 1000),
        },
        update: { count: { increment: 1 } },
      });
  }
  // Caller can include credential/session checks in the same transaction as the queued request.
  async request(
    tx: Prisma.TransactionClient,
    email: string,
    purpose: EmailPurpose,
    ip: string,
    identity?: { id: string; authVersion: number },
  ) {
    await this.rateLimit(tx, email, ip);
    const now = new Date();
    const owner = await tx.user.findUnique({ where: { email } });
    if (purpose === 'reset') identity = owner?.emailVerifiedAt ? owner : undefined;
    const id = randomBytes(32).toString('hex');
    // Separate purposes, but only the latest request within a purpose can be accepted.
    await tx.emailChallenge.updateMany({
      where: { email, purpose, consumedAt: null },
      data: { consumedAt: now, digest: null },
    });
    await tx.emailChallenge.create({
      data: {
        id,
        email,
        purpose,
        userId: identity?.id,
        authVersion: identity?.authVersion,
        expiresAt: new Date(now.getTime() + 10 * 60_000),
        job: { create: {} },
      },
    });
    return {
      challengeId: id,
      retryAfter: this.cooldown,
      message:
        purpose === 'reset'
          ? '如该邮箱已绑定账号，将收到验证码'
          : '申请已受理，请查收邮箱验证码；若未收到，请检查邮箱地址或稍后重试',
    };
  }
  async verify(
    tx: Prisma.TransactionClient,
    input: { email: string; challengeId: string; code: string },
    purpose: EmailPurpose,
    identity?: { id: string; authVersion: number },
  ) {
    const c = await tx.emailChallenge.findUnique({ where: { id: input.challengeId } });
    if (
      !c ||
      c.email !== input.email ||
      c.purpose !== purpose ||
      c.consumedAt ||
      c.expiresAt.getTime() <= Date.now() ||
      !c.digest ||
      c.attempts >= 5 ||
      (identity && (c.userId !== identity.id || c.authVersion !== identity.authVersion))
    )
      return false;
    const digest = this.digest(c.id, c.email, c.purpose, input.code);
    if (!timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(c.digest, 'hex'))) {
      await tx.emailChallenge.update({
        where: { id: c.id },
        data: {
          attempts: { increment: 1 },
          ...(c.attempts >= 4 ? { consumedAt: new Date(), digest: null } : {}),
        },
      });
      return false; // Throw outside the transaction so the failed attempt remains durable.
    }
    await tx.emailChallenge.update({
      where: { id: c.id },
      data: { consumedAt: new Date(), digest: null },
    });
    return true;
  }
  async invalidate(tx: Prisma.TransactionClient, userId: string, emails: (string | null)[] = []) {
    await tx.emailChallenge.updateMany({
      where: {
        consumedAt: null,
        OR: [{ userId }, { email: { in: emails.filter((e): e is string => !!e) } }],
      },
      data: { consumedAt: new Date(), digest: null },
    });
  }
  drain() {
    if (this.running) return this.running;
    this.running = this.processJobs().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async processJobs() {
    if (Date.now() - this.lastCleanup > 60_000) {
      await this.db.atomic(async (tx) => {
        // An interrupted SMTP attempt may already have delivered. Never retry it.
        const abandoned = await tx.emailJob.findMany({
          where: { status: 'sending', startedAt: { lt: new Date(Date.now() - 120_000) } },
          select: { id: true },
        });
        const ids = abandoned.map((j) => j.id);
        await tx.emailJob.updateMany({
          where: { id: { in: ids }, status: 'sending' },
          data: { status: 'uncertain', finishedAt: new Date() },
        });
        await tx.emailChallenge.updateMany({
          where: { id: { in: ids } },
          data: { digest: null, consumedAt: new Date() },
        });
        await tx.emailChallenge.deleteMany({
          where: { expiresAt: { lt: new Date(Date.now() - 86400_000) } },
        });
        await tx.emailLimit.deleteMany({ where: { expiresAt: { lte: new Date() } } });
      });
      this.lastCleanup = Date.now();
    }
    for (let i = 0; i < 20; i++) {
      const work = await this.db.atomic(async (tx) => {
        const job = await tx.emailJob.findFirst({
          where: { status: 'pending' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { challenge: true },
        });
        if (!job) return null;
        const c = job.challenge;
        const owner = await tx.user.findUnique({ where: { email: c.email } });
        const user = c.userId ? await tx.user.findUnique({ where: { id: c.userId } }) : null;
        const eligible =
          !c.consumedAt &&
          c.expiresAt.getTime() > Date.now() &&
          (c.purpose === 'register'
            ? !owner
            : !!user &&
              user.authVersion === c.authVersion &&
              (c.purpose === 'reset' ? owner?.id === user.id && !!user.emailVerifiedAt : !owner));
        await tx.emailJob.update({
          where: { id: job.id },
          data: {
            status: eligible ? 'sending' : 'skipped',
            startedAt: new Date(),
            ...(!eligible ? { finishedAt: new Date() } : {}),
          },
        });
        if (!eligible) return { skip: true as const };
        // Generate at claim time: no recoverable code is persisted in the queue.
        const code = String(randomInt(1_000_000)).padStart(6, '0');
        await tx.emailChallenge.update({
          where: { id: c.id },
          data: { digest: this.digest(c.id, c.email, c.purpose, code) },
        });
        return {
          skip: false as const,
          message: {
            challengeId: c.id,
            email: c.email,
            purpose: c.purpose,
            code,
            expiresAt: c.expiresAt.toISOString(),
          },
        };
      });
      if (!work) break;
      if (work.skip) continue;
      try {
        await this.deliver(work.message);
        await this.db.atomic((tx) =>
          tx.emailJob.update({
            where: { id: work.message.challengeId },
            data: { status: 'sent', finishedAt: new Date() },
          }),
        );
      } catch {
        // A timeout is indistinguishable from a lost SMTP acknowledgement. No automatic retry.
        await this.db.atomic(async (tx) => {
          await tx.emailJob.update({
            where: { id: work.message.challengeId },
            data: { status: 'uncertain', finishedAt: new Date() },
          });
          await tx.emailChallenge.update({
            where: { id: work.message.challengeId },
            data: { digest: null, consumedAt: new Date() },
          });
        });
      }
    }
  }
  async deliver(message: MockMessage) {
    if (this.mode === 'mock') {
      this.inbox.push(message);
      this.inbox = this.inbox
        .filter((m) => new Date(m.expiresAt).getTime() > Date.now())
        .slice(-200);
      return;
    }
    const label = purposes[message.purpose as EmailPurpose];
    await this.transporter!.sendMail({
      from: { name: '小纸条', address: process.env.SMTP_USER! },
      to: message.email,
      subject: `小纸条 · ${label}验证码`,
      text: `你正在${label}。\n\n验证码：${message.code}\n\n验证码仅可使用一次，10 分钟内有效（以本次申请时间为准）。请勿向他人透露。\n如非本人操作，请忽略此邮件。`,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
}
