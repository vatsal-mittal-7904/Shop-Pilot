-- Adds Merchant.aiRecoveredRevenue, which was present in schema.prisma but had no
-- corresponding migration (it had only ever been applied via `prisma db push`).
-- Additive and defaulted, so existing rows are unaffected.
ALTER TABLE "Merchant" ADD COLUMN "aiRecoveredRevenue" INTEGER NOT NULL DEFAULT 0;
