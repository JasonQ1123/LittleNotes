CREATE TABLE "PasswordChangeLimit" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

CREATE INDEX "PasswordChangeLimit_expiresAt_idx" ON "PasswordChangeLimit"("expiresAt");
