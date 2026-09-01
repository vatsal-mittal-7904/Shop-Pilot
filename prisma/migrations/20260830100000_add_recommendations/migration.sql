-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('CROSS_SELL', 'UPSELL');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'UNAVAILABLE');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "complementaryProducts" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "upgradeProducts" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "type" "RecommendationType" NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PROPOSED',
    "originalProductId" TEXT,
    "recommendedProductId" TEXT NOT NULL,
    "offerId" TEXT,
    "agentActionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recommendation_customerId_conversationId_idx" ON "Recommendation"("customerId", "conversationId");

-- CreateIndex
CREATE INDEX "Recommendation_merchantId_type_status_idx" ON "Recommendation"("merchantId", "type", "status");

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_agentActionId_fkey" FOREIGN KEY ("agentActionId") REFERENCES "AgentAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
