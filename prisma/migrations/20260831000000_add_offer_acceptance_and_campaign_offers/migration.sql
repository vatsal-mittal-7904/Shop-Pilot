-- An accepted offer is the deterministic authorization boundary for checkout.
-- Campaign-created offers retain a durable link to the campaign that issued them
-- so dispatch and later conversion can be reconstructed.
ALTER TABLE "Offer"
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD COLUMN "acceptedByUserId" TEXT,
  ADD COLUMN "campaignId" TEXT;

CREATE INDEX "Offer_campaignId_idx" ON "Offer"("campaignId");

ALTER TABLE "Offer"
  ADD CONSTRAINT "Offer_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
