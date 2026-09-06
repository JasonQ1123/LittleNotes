-- Additive migration: preserve all existing users, password hashes, sessions and business data.
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "EmailChallenge" (
 "id" TEXT NOT NULL PRIMARY KEY, "email" TEXT NOT NULL, "purpose" TEXT NOT NULL,
 "userId" TEXT, "authVersion" INTEGER, "digest" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0,
 "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "EmailJob" (
 "id" TEXT NOT NULL PRIMARY KEY, "status" TEXT NOT NULL DEFAULT 'pending',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "startedAt" TIMESTAMP(3), "finishedAt" TIMESTAMP(3),
 CONSTRAINT "EmailJob_id_fkey" FOREIGN KEY ("id") REFERENCES "EmailChallenge" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "EmailLimit" ("key" TEXT NOT NULL PRIMARY KEY, "count" INTEGER NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "EmailChallenge_email_purpose_idx" ON "EmailChallenge"("email", "purpose");
CREATE INDEX "EmailChallenge_userId_idx" ON "EmailChallenge"("userId");
CREATE INDEX "EmailChallenge_expiresAt_idx" ON "EmailChallenge"("expiresAt");
CREATE INDEX "EmailJob_status_createdAt_idx" ON "EmailJob"("status", "createdAt");
CREATE INDEX "EmailLimit_expiresAt_idx" ON "EmailLimit"("expiresAt");
