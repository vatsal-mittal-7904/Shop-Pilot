# Live Proof: Delayed Webhook & Recovery Demo

This guide explains how to demonstrate **Phase 3: One Meaningful Failure** to the judges. It proves that the system gracefully handles Razorpay webhook failures (dropped or delayed network packets) without leaving the customer in limbo or falsely confirming an unpaid order.

## The Setup (The Failure)
1. **Disable Webhooks**: Temporarily change your Razorpay webhook URL to a broken endpoint in the Razorpay Dashboard (e.g., `https://shoppilot-demo.com/api/webhooks/broken`).
2. **Checkout**: Go through the Shop-Pilot conversational AI to generate an offer and click checkout.
3. **Pay**: Complete the test payment in the Razorpay UI.
4. **Observe the Pending State**: Show the judges that the UI still says "Pending/Processing". 
   - *Narration:* "The payment succeeded on Razorpay's end, but the webhook dropped. Notice how our system refuses to blindly trust the client browser and falsely mark this order as paid. It remains pending."

## The Recovery (The Proof)
1. **Run the Reconciliation Daemon**: In your terminal, run the system repair tool that polls Razorpay for missed state transitions.
   ```bash
   npm run system:repair
   ```
2. **Observe the Output**: The terminal will output:
   ```text
   [RECOVERY] Found 1 orphaned pending order.
   [RAZORPAY] Fetching payment status for order_123...
   [RAZORPAY] Status: 'captured'.
   [RECOVERY] Reconciling order_123 to PAID.
   ```
3. **Verify the UI and Audit Trail**: Refresh the UI. The order is now PAID.
   - *Narration:* "Our reconciliation worker securely queried Razorpay's API and safely applied the captured payment exactly once. Idempotency guarantees it is impossible to double-count this order even if the delayed webhook arrives 10 minutes later."
4. **Show the Audit Ledger**: Prove that the recovery path was recorded.
   - You will see: `SYSTEM_RECONCILIATION_SYNC` -> `PAYMENT_CAPTURED`.
