CREATE TABLE "PasswordChangeLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PasswordChangeLimit_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "PasswordChangeLimit_expiresAt_idx" ON "PasswordChangeLimit"("expiresAt");
