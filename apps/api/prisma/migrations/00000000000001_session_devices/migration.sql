-- CreateTable
CREATE TABLE "SessionDevice" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "verificationMethod" "VerificationMethod",
    "verifiedAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMeters" DOUBLE PRECISION,
    "distanceMeters" INTEGER,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionDevice_sessionId_idx" ON "SessionDevice"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionDevice_sessionId_deviceKey_key" ON "SessionDevice"("sessionId", "deviceKey");

-- AddForeignKey
ALTER TABLE "SessionDevice" ADD CONSTRAINT "SessionDevice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

