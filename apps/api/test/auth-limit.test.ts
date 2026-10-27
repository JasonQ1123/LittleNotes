import 'reflect-metadata';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { AuthService } from '../src/auth';
import type { Database } from '../src/database';
import type { EmailService } from '../src/email';

describe('登录和注册的来源限流配置', { concurrency: false }, () => {
  const original = process.env.AUTH_LIMIT_PER_15M;
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_LIMIT_PER_15M;
    else process.env.AUTH_LIMIT_PER_15M = original;
  });
  const limiter = () =>
    new AuthService(undefined as unknown as Database, undefined as unknown as EmailService);
  const isLimited = (error: unknown) => error instanceof HttpException && error.getStatus() === 429;

  it('未配置或空配置仍允许40次，第41次返回429，其他来源独立计数', () => {
    for (const value of [undefined, '']) {
      if (value === undefined) delete process.env.AUTH_LIMIT_PER_15M;
      else process.env.AUTH_LIMIT_PER_15M = value;
      const auth = limiter();
      for (let count = 0; count < 40; count++) auth.limit('192.0.2.1');
      assert.throws(() => auth.limit('192.0.2.1'), isLimited);
      assert.doesNotThrow(() => auth.limit('192.0.2.2'));
    }
  });

  it('独立测试进程可以提高上限，达到配置值后仍返回429', () => {
    process.env.AUTH_LIMIT_PER_15M = '80';
    const auth = limiter();
    for (let count = 0; count < 80; count++) auth.limit('192.0.2.1');
    assert.throws(() => auth.limit('192.0.2.1'), isLimited);
  });

  it('拒绝零、负数、小数和非安全整数，避免配置错误关闭限流', () => {
    for (const value of ['0', '-1', '1.5', 'invalid', 'Infinity', '9007199254740992']) {
      process.env.AUTH_LIMIT_PER_15M = value;
      assert.throws(limiter, /AUTH_LIMIT_PER_15M 必须是正整数/);
    }
  });
});
