# 🚨 Pre-Demo Judge-Proof Checklist

Before you present to the Razorpay Buildathon judges, you must physically check every single box below. **Do not skip any step.**

## Environment & Secrets
- [ ] `APP_ENV` is set to `demo` (or `test`).
- [ ] Razorpay test-mode credentials are valid and active in `.env`.
- [ ] Public webhook URL is reachable from the internet (e.g. ngrok is running if local).
- [ ] Webhook secret in `.env` strictly matches the Razorpay dashboard configuration.
- [ ] No real production secrets exist in `.env.local`.

## Data & Seed
- [ ] Seeded merchant credentials (`admin@technest.com`) work.
- [ ] Seeded customer credentials (`demo.customer@technest.com`) work.
- [ ] Product catalog contains useful comparison cases (e.g., a cheap keyboard vs an expensive ergonomic one).
- [ ] At least one abandoned cart exists in the database to prove the campaign recovery feature.

## Runtime
- [ ] Next.js app is running without error pages or console warnings.
- [ ] Background daemon/cron is running in a separate terminal (`npm run daemon`).
- [ ] No localhost developer scripts or raw stack traces appear on screen during failure testing.

## Backup Plans
- [ ] A screenshot/export of the Razorpay dashboard event is saved on your desktop as backup.
- [ ] A pre-recorded 60-second fallback video of the checkout flow exists on your desktop in case of total venue WiFi failure.
