CREATE TYPE "PaymentReconciliationStatus" AS ENUM ('PENDING', 'PROCESSING', 'RESOLVED');

CREATE TABLE "PaymentReconciliation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "PaymentReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingToken" TEXT,
    "processingStartedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentReconciliation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentReconciliation_orderId_key" ON "PaymentReconciliation"("orderId");
CREATE INDEX "PaymentReconciliation_status_nextAttemptAt_idx" ON "PaymentReconciliation"("status", "nextAttemptAt");

ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
