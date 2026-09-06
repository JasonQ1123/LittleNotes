import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class Database extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly postgres = /^postgres(ql)?:/.test(process.env.DATABASE_URL || '');

  constructor() {
    super({ datasourceUrl: process.env.DATABASE_URL || 'file:./dev.db' });
  }

  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }

  // SQLite has one writer. PostgreSQL retries serializable transactions across all API instances.
  atomic<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (this.postgres) return this.serializable(fn);
    const result = this.tail.then(() => this.$transaction(fn, { maxWait: 10000, timeout: 10000 }));
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async serializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10000,
          timeout: 10000,
        });
      } catch (error) {
        // A competing insert can surface as P2002 instead of a serialization failure.
        // Re-read the business state in a fresh transaction before deciding the result.
        if (
          attempt >= 4 ||
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          !['P2034', 'P2002'].includes(error.code)
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
  }
}
