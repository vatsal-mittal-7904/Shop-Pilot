-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "clearedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Conversation_customerId_merchantId_clearedAt_idx" ON "Conversation"("customerId", "merchantId", "clearedAt");
