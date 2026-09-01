-- Recovery revenue is derived from paid orders linked to completed recovery
-- campaigns. This unused cached column was never written and could diverge.
ALTER TABLE "Merchant" DROP COLUMN "aiRecoveredRevenue";
