ALTER TABLE "Space" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "Space" ADD COLUMN "lifecycleVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Space" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "Space" ADD COLUMN "closedById" TEXT;
ALTER TABLE "Space" ADD COLUMN "purgeAt" TIMESTAMP(3);
CREATE INDEX "Space_status_purgeAt_idx" ON "Space"("status", "purgeAt");

CREATE TABLE "SpaceMembership" (
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "nicknameSnapshot" TEXT NOT NULL,
  PRIMARY KEY ("spaceId", "userId"),
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SpaceMembership_userId_idx" ON "SpaceMembership"("userId");
INSERT INTO "SpaceMembership" ("spaceId", "userId", "nicknameSnapshot")
SELECT "spaceId", "id", "nickname" FROM "User" WHERE "spaceId" IS NOT NULL;

CREATE TABLE "SpaceRestoreRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "spaceId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "requesterAuthVersion" INTEGER NOT NULL,
  "lifecycleVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SpaceRestoreRequest_spaceId_status_idx" ON "SpaceRestoreRequest"("spaceId", "status");
-- Prisma cannot express a partial unique index; retain in both migration histories.
CREATE UNIQUE INDEX "SpaceRestoreRequest_one_pending" ON "SpaceRestoreRequest"("spaceId") WHERE "status" = 'pending';
