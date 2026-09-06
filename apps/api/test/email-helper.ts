import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { EmailService } from '../src/email';

// Isolated test databases only; production has neither mock delivery nor a mock inbox.
process.env.EMAIL_DELIVERY = 'mock';
process.env.EMAIL_HMAC_SECRET = 'a1'.repeat(32);
process.env.EMAIL_LIMIT_IP_HOUR = '10000';
process.env.EMAIL_LIMIT_GLOBAL_DAY = '10000';

export async function emailProof(app: INestApplication, email = `${randomUUID()}@example.com`) {
  const result = await request(app.getHttpServer())
    .post('/api/auth/register/code')
    .send({ email })
    .expect(200);
  const service = app.get(EmailService);
  await service.drain();
  const message = service.mockInbox().find((m) => m.challengeId === result.body.challengeId);
  if (!message) throw new Error('Mock verification email missing');
  return { email, challengeId: message.challengeId, code: message.code };
}
