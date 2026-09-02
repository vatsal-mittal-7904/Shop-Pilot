<div align="center">
  <h1>🛍️ MerchantOS</h1>
  <p><b>An AI-native commerce platform with deterministic financial guardrails.</b></p>
  
  [![Next.js](https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
  [![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://prisma.io/)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://postgresql.org/)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org/)
</div>

<br/>

MerchantOS enables customers to shop through conversational AI and allows merchants to run model-derived growth campaigns — **without ever letting the LLM compute or alter prices, discounts, or fund movements.** Every price-affecting decision is evaluated deterministically against indexed merchant policies, recorded in an append-only cryptographic audit ledger, and verified against Razorpay test-mode provider contracts.

> 🏆 Built for the **Razorpay Agentic Commerce Hackathon**.

---

## 🚀 Quick Start & Interactive Demo

To clone, set up, and execute the interactive end-to-end commerce lifecycle:

```bash
git clone https://github.com/vatsal-mittal-7904/razorPay_Project.git merchantos
cd merchantos
npm install
npx prisma migrate deploy
npx prisma db seed
npm run db:seed:demo

# Run the complete end-to-end interactive CLI journey:
npm run demo:interactive
```

To run the Next.js web application:
```bash
npm run dev
```

*Note: Configure `.env` and `.env.local` first. See [Local Setup](#-local-setup) below for details.*

---

## 🧠 Core Architecture & Security Guardrails

LLMs are strong at multi-turn conversational reasoning and unpredictable at financial custody. Ask an unguarded AI agent for a price concession, and it will invent unauthorized discounts because next-token prediction prioritizes perceived accommodation over unit economics and margin constraints.

```text
┌───────────────────────────────────────────────┐  ┌───────────────────────────────────────────────┐
│     AUTONOMOUS BUYER AGENT LAYER              │  │     HUMAN-IN-THE-LOOP MERCHANT LAYER          │
│                                               │  │                                               │
│  Shopper  ──▶  AI Chat  ──▶  Deterministic    │  │  AI Growth Agent ──▶  Merchant Dashboard      │
│  Prompt        Agent         Policy Engine    │  │  (Data-Grounded       Approval Gate           │
│                               (ALLOW / BLOCK) │  │   Proposals)          (Review & Dispatch)     │
└──────────────────────┬────────────────────────┘  └───────────────────────┬───────────────────────┘
                       │                                                   │
                       ▼                                                   ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             TRANSACTION & SETTLEMENT CORE                                        │
│                                                                                                  │
│   HMAC Basket Binding  ──▶  Explicit Acceptance  ──▶  Razorpay Test Order  ──▶  Signed Webhook   │
│   (Anti-Tampering)          (Owner State Change)      (mso_<id> Receipt)        (HMAC-SHA256)    │
│                                                                                                  │
│   Reconciliation Daemon ◀── Durable Refund Outbox ◀── Stockout Safe Settlement (Atomic Inventory)│
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1. Deterministic Policy Enforcement
- **The Model Never Computes Numbers**: The LLM may request a promotion, but [`evaluateDiscount()`](src/backend/actions/policyEngine.ts) verifies the request against indexed `MerchantPolicy` rows (`MAX_DISCOUNT_PERCENTAGE`, `MIN_MARGIN_PERCENTAGE`).
- **First-Class Refusals**: Every request—whether approved or blocked—writes an immutable [`AgentAction`](src/backend/actions/policyEngine.ts) row.
- **HMAC Basket Binding**: Active selections are sealed with HMAC SHA-256 ([`cartSelectionBinding.ts`](src/backend/utils/cartSelectionBinding.ts)) to prevent client/parameter tampering between offer creation and checkout.
- **Explicit Buyer Consent**: Order creation requires an authenticated customer acceptance state transition (`acceptedAt`, `acceptedByUserId`).

### 2. Model-Derived Growth Campaign Strategy & Dynamic Recommendations
- **AI Growth Strategy Agent ([`campaignStrategyAgent.ts`](src/backend/ai/campaignStrategyAgent.ts))**: Analyzes quantitative merchant telemetry (abandoned basket velocity, capital exposure in dormant stock, repeat customer cohorts) to formulate data-grounded growth campaign proposals.
- **Dynamic Category Affinity Discovery ([`recommendationIntelligence.ts`](src/backend/ai/recommendationIntelligence.ts))**: Discovers synergistic accessories and premium tier upgrades dynamically across live catalog data, factoring in margin health and stock depth instead of relying on static string arrays.
- **Human-in-the-Loop Approval Gate**: The AI proposes; the human merchant approves.

### 3. In-Memory Anti-DDoS Rate Limiting ([`rateLimit.ts`](src/backend/utils/rateLimit.ts))
- Protects conversational endpoints from abuse and DoS using an in-memory token bucket.
- **Why not PostgreSQL?** A previous design utilized a DB-backed distributed token bucket, but it was found to cause connection pool exhaustion during a high-concurrency DDoS attack.

### 4. Semantic Prompt Shield ([`promptShield.ts`](src/backend/security/promptShield.ts))
- Eradicates "security theater" by replacing brittle regex pattern matching with a fast, dedicated LLM evaluation pass (LLM-as-a-Judge) that categorizes prompt injection and financial exploits semantically before they reach the main agent.

### 5. Application-Level WORM Audit Ledger ([`auditChainVerifier.ts`](src/backend/security/auditChainVerifier.ts))
- Every financial and agent action is recorded into an append-only hash chain where each row stores `SHA-256(canonicalContent + previousHash)`.
- Verification CLI (`npm run audit:verify`) recomputes bit-exact canonical hashes across all database rows to detect single-byte tampering, deleted rows, or broken links. Exported snapshots are signed with HMAC-SHA256 to prevent post-breach ledger recalculation.

---

## 💻 Local Setup

### Prerequisites
- Node.js 20+
- PostgreSQL database
- Google AI (Gemini) API key
- Razorpay test-mode credentials (`rzp_test_...`)

### 1. Configure Environment Variables
Place `DATABASE_URL` in `.env`:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/merchantos"
```

Configure application secrets in `.env.local`:
```env
# Gemini AI
GOOGLE_GENERATIVE_AI_API_KEY="your_gemini_api_key"

# Razorpay Test Mode
NEXT_PUBLIC_RAZORPAY_KEY_ID="rzp_test_..."
RAZORPAY_KEY_ID="rzp_test_..."
RAZORPAY_KEY_SECRET="your_key_secret"
RAZORPAY_WEBHOOK_SECRET="your_webhook_secret"

# Basket Binding Secret (defaults to RAZORPAY_KEY_SECRET if omitted)
OFFER_BINDING_SECRET="random_secure_secret"

# Cron Authentication
CRON_SECRET="random_cron_secret"

# Optional Operator Alerts (Webhooks / Slack / Discord)
OPERATOR_ALERT_WEBHOOK_URL="https://operator.example.com/alerts"
ALERT_WEBHOOK_SECRET="alert_signing_secret"
SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
```

### 2. Seed Database & Run
```bash
npx prisma migrate deploy
npx prisma db seed
npm run db:seed:demo
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
- **Merchant Portal**: `/merchant/portal` (Login: `admin@technest.com` / `technest-demo-2026`)
- **Customer Chat Agent**: `/agent` (Login: `demo.customer@technest.com` / `technest-customer-demo`)

---

## 🛠️ Production Background Daemon & Verification Tools

MerchantOS includes dedicated production runners and CLI verification utilities:

```bash
# 1. Run Background Scheduler Daemon (Payment reconciliation, refund outbox, cart sweep, order expiry):
npm run daemon

# 2. Single-pass maintenance run (for serverless cron triggers):
npm run daemon:once

# 3. Verify real Razorpay Test Mode payment + provider-delivered webhook evidence:
# Complete Checkout first with a Test Mode card against a reachable configured
# webhook endpoint, then pass the resulting internal order ID.
RAZORPAY_PROOF_ORDER_ID="<internal-order-uuid>" npm run razorpay:proof

# 4. Cryptographic Audit Ledger Export & Canonical Chain Verification:
npm run audit:export
npm run audit:verify
```

---

## 🧪 Comprehensive Test Suite

MerchantOS features a multi-tiered test matrix covering 100% of financial, authorization, and lifecycle invariants:

1. **Hermetic Unit Test Suite (`npm run test:unit`)**:
   - **137 unit tests** across **34 test files** covering deterministic discount authorization, HMAC basket binding, distributed token bucket rate limiting, money-safety matrices, recommendation intelligence, campaign proposal agents, and conversation sliding windows.

2. **Database Integration & State Transitions (`npm run test:integration` / `npm run test:state-transitions`)**:
   - **17 integration tests** across **6 test files** executing against a live PostgreSQL database with automatic pre-flight connection validation, migration bootstrapping, and multi-instance concurrency testing.

3. **End-to-End Playwright Suite (`npm run test:e2e`)**:
   - 4 full-journey specs covering customer authentication, basket negotiation, offer acceptance, merchant growth queues, and live Razorpay provider contract execution.

```bash
# Run unit tests
npm run test:unit

# Run integration tests
npm run test:integration

# List Playwright E2E tests
npx playwright test --list
```

---

## 📂 Project Structure

```text
src/
├── app/
│   ├── page.tsx                           # Role-aware authentication gateway
│   ├── agent/                             # Conversational buyer shopping UI
│   ├── merchant/                          # Growth queue, product catalog, analytics
│   └── api/
│       ├── chat/route.ts                  # AI SDK streaming & dynamic recommendation tools
│       ├── agent/                         # REST API for autonomous shopping agents
│       ├── cron/sweep-carts/route.ts      # Scheduled cart abandonment sweep
│       └── webhooks/razorpay/route.ts     # HMAC-verified webhook processing
├── backend/
│   ├── actions/
│   │   ├── policyEngine.ts                # Deterministic discount & margin enforcement
│   │   ├── paymentReconciliation.ts       # Durable queue for Razorpay payment verification
│   │   ├── refundProcessor.ts             # Durable outbox for provider refunds
│   │   ├── orderExpiry.ts                 # Fail-safe stale unpaid order expiry
│   │   ├── cartSweeper.ts                 # Cart abandonment sweeper
│   │   └── queueMonitor.ts                # Queue backlog & health monitoring
│   ├── ai/
│   │   ├── campaignStrategyAgent.ts       # Model-derived growth campaign generator
│   │   ├── recommendationIntelligence.ts  # Dynamic category synergy & upgrade discovery
│   │   └── conversationStorage.ts         # Normalized message storage & sliding window
│   ├── security/
│   │   ├── auditChainVerifier.ts          # Cryptographic SHA-256 audit chain verification
│   │   └── demoSafety.ts                  # Production safety checks
│   ├── utils/
│   │   ├── rateLimit.ts                   # Distributed atomic token bucket limiter
│   │   ├── cartSelectionBinding.ts        # HMAC basket anti-tampering
│   │   └── untrustedToolData.ts           # DTO sanitization for untrusted catalog data
│   └── db/prisma.ts                       # Prisma client with PostgreSQL adapter
prisma/
├── schema.prisma                          # 21 Prisma models (policies, audit logs, queues)
└── migrations/                            # 15 chronological PostgreSQL migrations
scripts/
├── scheduler-daemon.ts                    # Production background maintenance daemon
├── prove-razorpay-lifecycle.ts            # Verifies real Test Mode payment + webhook evidence
├── audit-export.ts                        # Cryptographic audit export & verification CLI
└── demo-interactive.ts                    # End-to-end interactive terminal demo
```

---

## 🛡️ Core Financial Safety Invariants

1. **Code Decides; The Model Proposes**: No price, discount, or order total is ever calculated by an LLM.
2. **Refusals Are Immutable Rows**: Blocked discount attempts write `BLOCKED` `AgentAction` records with exact margin telemetry.
3. **Fail-Closed Principle**: Missing policy row $\to$ 0% discount. Bad webhook signature $\to$ 400 Bad Request. Provider read failure $\to$ retain `PAYMENT_PENDING`.
4. **Append-Only Cryptographic Audit**: Every mutation is chained via SHA-256 content hashes to `GENESIS`.
5. **Durable Refund Outbox**: Stockout cancellations write a durable pending refund row; retries use deterministic idempotency keys.
6. **Reconciliation Independence**: Orders verify payment status asynchronously via server-to-server Razorpay API queries regardless of webhook receipt.
7. **Durable Customer Spend Limits**: Enforces daily and monthly caps across all merchants before reserving intent budgets.
