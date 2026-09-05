import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class Database extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private tail: Promise<unknown> = Promise.resolve();

  constructor() {
    super({ datasourceUrl: process.env.DATABASE_URL || 'file:./dev.db' });
  }

  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }

  // SQLite has one writer. Serialize local transactions; constraints still protect invariants.
  atomic<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const result = this.tail.then(() => this.$transaction(fn, { maxWait: 10000, timeout: 10000 }));
    this.tail = result.catch(() => undefined);
    return result;
  }
}
