-- Durable buyer-account spending limits, in paise. Defaults backfill existing
-- accounts and prevent session-scoped buyer intents from being the only cap.
ALTER TABLE "Customer"
  ADD COLUMN "dailySpendLimit" INTEGER NOT NULL DEFAULT 5000000,
  ADD COLUMN "monthlySpendLimit" INTEGER NOT NULL DEFAULT 20000000;
