# 🚀 Vercel Deployment Guide for MerchantOS

This guide walk you through deploying **MerchantOS** to **Vercel** with a managed PostgreSQL database (e.g. Neon, Supabase, or Railway Postgres).

---

## 🏗️ Architecture on Vercel

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                             VERCEL EDGE NETWORK                            │
│                                                                            │
│  Shopper UI (/agent)      Merchant Portal (/merchant)      MCP (/api/mcp)  │
│  Chat Stream (/api/chat)  Webhooks (/api/webhooks/*)       Health Check    │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                    SERVERLESS EXECUTION & AUTOMATION                       │
│                                                                            │
│  • Vercel Cron (/api/cron/sweep-carts) every 5m (Pro) or daily (Hobby)     │
│  • Self-Healing Opportunistic Reconciliation on merchant & shopper actions │
│  • Prisma 7 with pooled PostgreSQL connection management                   │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                  MANAGED POSTGRESQL (Neon / Supabase / Railway)            │
│                                                                            │
│  • Catalog, Orders, HMAC Basket Signatures, Audit Log Ledger, Queues       │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 📋 Prerequisites

1. A **[Vercel Account](https://vercel.com)**.
2. A **PostgreSQL Database** (We recommend **[Neon.tech](https://neon.tech)** for serverless Next.js, or **[Supabase](https://supabase.com)**).
3. Your **Google AI (Gemini) API Key** and/or **Groq API Key**.
4. Your **Razorpay Test Credentials** (`rzp_test_...` from [Razorpay Dashboard](https://dashboard.razorpay.com)).

---

## 🛠️ Step 1: Provision a Cloud PostgreSQL Database

### Using Neon (Recommended):
1. Sign up at [neon.tech](https://neon.tech) and create a new project (e.g., `merchantos-prod`).
2. Copy the connection string provided in your Neon dashboard:
   ```text
   postgresql://user:password@ep-cool-cloud.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   *(Note: Neon automatically provides a pooled connection mode, which works great with Vercel serverless functions).*

---

## 📦 Step 2: Push & Import Project on Vercel

### Option A: Import via Vercel Web Dashboard (Recommended)
1. Push your latest code to your GitHub repository:
   ```bash
   git add .
   git commit -m "feat: prepare project for Vercel deployment"
   git push origin main
   ```
2. Navigate to [vercel.com/new](https://vercel.com/new).
3. Select your repository: `vatsal-mittal-7904/razorPay_Project` (or your fork).
4. Framework Preset: **Next.js** (detected automatically).
5. Leave Build Command and Output Directory as default (the repository includes `"postinstall": "prisma generate"`, so Prisma client builds automatically).

### Option B: Deploy via Vercel CLI
```bash
npx vercel
```
Follow the interactive prompts to link and deploy the project.

---

## 🔑 Step 3: Configure Environment Variables in Vercel

In the Vercel project settings (**Settings $\to$ Environment Variables**), add the following variables for **Production** and **Preview** environments:

| Variable Name | Required | Description / Example |
| :--- | :--- | :--- |
| `DATABASE_URL` | **Yes** | Cloud PostgreSQL connection string (from Neon or Supabase) |
| `APP_ENV` | **Yes** | Set to `demo` (for hackathon demo test mode) or `production` |
| `NEXT_PUBLIC_APP_URL` | **Yes** | Your Vercel domain: `https://<your-project>.vercel.app` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | **Yes** | Gemini API Key for shopping & campaign agents |
| `GROQ_API_KEY` | Optional | Groq API Key (provides automatic failover if Gemini rate limits) |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | **Yes** | `rzp_test_...` (Exposed to browser checkout modal) |
| `RAZORPAY_KEY_ID` | **Yes** | `rzp_test_...` |
| `RAZORPAY_KEY_SECRET` | **Yes** | Razorpay key secret |
| `RAZORPAY_WEBHOOK_SECRET` | **Yes** | Webhook secret for HMAC verification (e.g. `whsec_live_demo_2026`) |
| `OFFER_BINDING_SECRET` | **Yes** | Cryptographic secret (minimum 16 chars) for HMAC basket binding |
| `AUDIT_HMAC_SECRET` | **Yes** | Cryptographic secret (minimum 16 chars) for audit chain hashes |
| `CRON_SECRET` | **Yes** | Secret used by Vercel Cron to authenticate scheduled runs |

> 💡 **Tip**: You can generate strong 32-character secrets with:
> ```bash
> node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
> ```

---

## 🗄️ Step 4: Run Migrations & Seed the Cloud Database

Once your cloud PostgreSQL instance is created, run the migrations and seed data from your local terminal pointing to the cloud `DATABASE_URL`:

```bash
# 1. Deploy all 15 chronological Prisma migrations
DATABASE_URL="<your-cloud-database-url>" npx prisma migrate deploy

# 2. Seed initial catalog, merchants, and deterministic policies
DATABASE_URL="<your-cloud-database-url>" npm run db:seed:demo
```

This creates the default demo accounts:
- **Merchant Admin**: `admin@technest.com` / `technest-demo-2026`
- **Customer Account**: `demo.customer@technest.com` / `technest-customer-demo`

---

## ⚡ Step 5: Configure Razorpay Webhook

To ensure live payment captures and stockout refunds reconcile in real time:

1. Log into your [Razorpay Dashboard](https://dashboard.razorpay.com) (make sure you are in **Test Mode**).
2. Go to **Settings** $\to$ **Webhooks** $\to$ **Add New Webhook**.
3. **Webhook URL**:
   ```text
   https://<your-project>.vercel.app/api/webhooks/razorpay
   ```
4. **Secret**: Enter the exact secret string you put in `RAZORPAY_WEBHOOK_SECRET`.
5. **Active Events**: Select:
   - `order.paid`
   - `payment.captured`
   - `payment.failed`
6. Click **Save**.

---

## ⏰ Step 6: Vercel Cron Schedule Verification

MerchantOS includes `vercel.json` preconfigured for scheduled maintenance:
```json
{
  "crons": [
    {
      "path": "/api/cron/sweep-carts",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

- **On Vercel Pro**: Runs every 5 minutes automatically with `Authorization: Bearer <CRON_SECRET>`.
- **On Vercel Hobby (Free)**: Hobby plans support daily cron jobs. If you are deploying on a Free Hobby plan, change the schedule in `vercel.json` to `"0 0 * * *"` (once daily).
- **Self-Healing Fallback**: Even without crons, MerchantOS executes opportunistic reconciliation whenever customers checkout or merchants load `/merchant/portal`.

---

## ✅ Step 7: Post-Deployment Verification

After deployment finishes, verify that all systems are operational:

### 1. Check Application Health Probe
```bash
curl -i https://<your-project>.vercel.app/api/health
```
Expected output:
```json
{
  "status": "healthy",
  "database": {
    "status": "connected",
    "latencyMs": 42
  },
  "environment": "demo"
}
```

### 2. Check Model Context Protocol (MCP) Server
```bash
curl -X POST https://<your-project>.vercel.app/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```
Expected output: Returns JSON-RPC 2.0 list of tools (`merchantos_catalog_search`, `merchantos_create_basket`, etc.).

### 3. Verify Frontend & Interactive Workflows
- Open `https://<your-project>.vercel.app`:
  - **Portal**: Test login as Merchant (`admin@technest.com` / `technest-demo-2026`).
  - **Buyer Chat**: Test shopping conversational flow at `/agent`.
  - **Razorpay Modal**: Place a test checkout using Razorpay Test UPI / Netbanking.
