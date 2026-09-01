CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'REFUNDED');

CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "providerRefundId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingToken" TEXT,
    "processingStartedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Refund_orderId_key" ON "Refund"("orderId");
CREATE UNIQUE INDEX "Refund_razorpayPaymentId_key" ON "Refund"("razorpayPaymentId");
CREATE UNIQUE INDEX "Refund_providerRefundId_key" ON "Refund"("providerRefundId");
CREATE INDEX "Refund_status_nextAttemptAt_idx" ON "Refund"("status", "nextAttemptAt");

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
