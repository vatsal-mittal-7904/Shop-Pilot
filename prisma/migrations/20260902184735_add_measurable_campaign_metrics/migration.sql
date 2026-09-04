-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "actualConversionRate" DOUBLE PRECISION,
ADD COLUMN     "actualRevenueOutcome" INTEGER,
ADD COLUMN     "baselineAov" INTEGER,
ADD COLUMN     "baselineConversionRate" DOUBLE PRECISION,
ADD COLUMN     "confidenceLevel" TEXT,
ADD COLUMN     "discountCost" INTEGER,
ADD COLUMN     "evidenceSources" JSONB,
ADD COLUMN     "expectedMarginImpact" INTEGER,
ADD COLUMN     "predictedUpliftRange" JSONB,
ADD COLUMN     "segmentDefinition" TEXT;
