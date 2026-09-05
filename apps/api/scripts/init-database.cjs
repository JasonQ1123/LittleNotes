require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL || 'file:./dev.db' });
db.$connect()
  .then(() => db.$disconnect())
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
