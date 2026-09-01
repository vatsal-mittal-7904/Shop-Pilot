-- A deterministic, provider-visible receipt makes Razorpay order creation
-- recoverable after an uncertain network/database boundary.
ALTER TABLE "Order" ADD COLUMN "razorpayReceipt" TEXT;
CREATE UNIQUE INDEX "Order_razorpayReceipt_key" ON "Order"("razorpayReceipt");

-- Buyer offers are signed from the exact server-side cart snapshot. This is
-- intentionally nullable for campaign-issued offers, which have no cart.
ALTER TABLE "Offer" ADD COLUMN "cartSnapshotHash" TEXT;
