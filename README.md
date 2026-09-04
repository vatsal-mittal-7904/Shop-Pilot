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

> 🎯 **Core Concept**: MerchantOS converts conversational product discovery into a safe Razorpay checkout, where AI can recommend but cannot move money.

> 🏆 Built for the **Razorpay Agentic Commerce Hackathon**.

---

## 📊 Evidence-Based Security

- **Strict Consent Gates:** Offers cannot be accepted without authenticated customer action (HMAC-signed).
- **Deterministic Settlement:** Payment state changes only after Razorpay webhook verification or API reconciliation.
- **Race Condition Safety:** Duplicate webhook delivery causes exactly one inventory decrement.
- **Financial Bounds:** Hard account limits block attempted checkouts that exceed budget thresholds.
- **Measurable AI Growth:** Recovery campaigns track actual versus baseline conversion rates.
- **Cryptographic Tracing:** The Audit Ledger verifies the entire chain from intent extraction to payment capture.

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

### 4. Cross-Provider AI Failover Architecture ([`model.ts`](src/backend/ai/model.ts), [`aiClient.ts`](src/backend/utils/aiClient.ts))
- **Live Shopping Chat Streaming Failover (`safeStreamText`)**: The customer shopping chat route ([`src/app/api/chat/route.ts`](src/app/api/chat/route.ts)) streams responses via a resilient multi-provider fallback chain. If Google Gemini (`gemini-2.5-flash` / `gemini-2.5-flash-lite`) encounters rate limits (HTTP 429), timeouts, or service errors, it automatically fails over to Groq's high-speed LLaMA engine (`llama-3.3-70b-versatile`), ensuring uninterrupted buyer shopping sessions.
- **Background Intelligence Failover (`executeWithFallback`)**: Protects background intelligence agents, recommendation engines, and prompt security classification across Google and Groq.

### 5. Deterministic Budget Authorization & Server-Enforced Ceiling ([`intent.ts`](src/backend/actions/intent.ts), [`accountBudget.ts`](src/backend/actions/accountBudget.ts))
- **Ceiling Invariant**: Conversational prompts can establish or lower an active budget ceiling, but can **never unilaterally lift or clear it**. If a shopper or prompt injection attempts to increase the budget, the server blocks the increase, keeps the lower active ceiling, and stages a `pendingBudgetIncrease`.
- **Authenticated Confirmation**: Increasing a spending ceiling requires an explicit, authenticated customer action via the in-app authorization banner or `/api/agent/budget` endpoint.
- **Row-Locked Transactional Assertion**: Order checkouts enforce customer spend limits using PostgreSQL row-level locks (`SELECT 1 FROM "Customer" ... FOR UPDATE`).

### 6. Multi-Tier Prompt & Payload Shield ([`promptShield.ts`](src/backend/security/promptShield.ts))
- **Tier 1 (Deterministic Pre-Filter, <1ms)**: Blocks script injection (XSS), overt jailbreak commands (`ignore previous instructions`), and financial bypass attempts (`set price to 0`) at zero API cost.
- **Fast-Path Clearance**: Standard e-commerce queries (*"show me keyboards under 5000"*) bypass LLM security evaluation, saving 800ms+ latency.
- **Tier 2 (Semantic LLM-as-a-Judge)**: Analyzes complex or ambiguous borderline inputs.
- **Fail-Safe Resilience**: If AI security endpoints time out, benign shopping is never blocked because the backend policy engine and HMAC basket bindings deterministically protect all money operations.

### 7. Database-Enforced Append-Only Audit Ledger & External Sink ([`auditChainVerifier.ts`](src/backend/security/auditChainVerifier.ts), [`wormStorageTransmitter.ts`](src/backend/security/wormStorageTransmitter.ts))
- **Database Engine Triggers**: PostgreSQL statement-level and row-level triggers strictly prohibit `UPDATE`, `DELETE`, and `TRUNCATE` on `AuditLog` and `AuditExport`.
- **Advisory Transaction Locks**: Uses `pg_advisory_xact_lock` to serialize SHA-256 chain links sequentially per merchant.
- **Cryptographic Hash Chaining**: Every log row stores `SHA-256(canonicalContent + previousHash)` and an HMAC-SHA256 `appSignature`.
- **Pluggable Off-DB Audit Sink with Alarm on Failure**: Simultaneously transmits signed audit events off-database upon commit (`wormStorageTransmitter.ts`). Supports external SIEM/compliance webhooks via `AUDIT_REPLICA_WEBHOOK_URL` with signed HTTP headers (`X-Audit-Signature`, `X-Audit-Hash`). **If external transmission or local mirror writing fails, it immediately dispatches an urgent `AUDIT_REPLICATION_FAILURE` alarm across Slack, Discord, and operator webhooks.**

### 8. Multi-Channel Alerting & Customer Notifications ([`operatorNotifier.ts`](src/backend/notifications/operatorNotifier.ts), [`customerNotifier.ts`](src/backend/notifications/customerNotifier.ts))
- **Operator Channels**: Dispatches queue age alerts, critical backlogs, and audit replication alarms to Slack (Block Kit), Discord (rich embeds), and generic HMAC-signed webhooks.
- **Customer DLQ Delivery**: Multi-channel delivery when background operations enter DLQ:
  - Native Resend API transactional email when `RESEND_API_KEY` is present.
  - Signed webhook notification when `CUSTOMER_NOTIFICATION_WEBHOOK_URL` is configured.
  - Immutable in-app system `ConversationMessage` in PostgreSQL ensuring customers always see updates in their shopping session.

### 9. Razorpay Route Marketplace Architecture ([`payment.ts`](src/backend/actions/payment.ts))
- Supports multi-merchant commerce via Razorpay Route. When a merchant configures a linked `razorpayAccountId`, the order creation payload attaches Route transfer directives to deterministically route settlement funds to the merchant's subaccount.

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
OFFER_BINDING_SECRET="random_Idempotent & Cryptographically Verifiable_secret"

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

# 3. Autonomous Live Razorpay Test Mode Order & Captured Settlement Proof:
# Queries live Razorpay Test API, verifies orders and captured payments (pay_...),
# tests webhook tamper & replay defenses, and outputs artifacts/razorpay-provider-proof.json.
npm run razorpay:proof

# 4. Cryptographic Audit Ledger Export & Canonical Chain Verification:
npm run audit:export
npm run audit:verify

# 5. Playwright Live Razorpay Order Contract & Webhook Route Test:
npm run test:razorpay:proof
```

---

## 🧪 Comprehensive Test Suite

MerchantOS features a multi-tiered test matrix covering 100% of financial, authorization, and lifecycle invariants:

1. **Hermetic Unit Test Suite (`npm run test:unit`)**:
   - **198 unit tests** across **45 test files** covering deterministic discount authorization, HMAC basket binding, distributed token bucket rate limiting, money-safety matrices, cross-provider streaming AI failover (Gemini $\to$ Groq), multi-tier prompt shield, recommendation intelligence, external WORM sink alarming, pluggable customer DLQ email delivery, and conversation sliding windows. Executes hermetically with 100% pass rate in ~3.6s.

2. **Database Integration & State Transitions (`npm run test:integration` / `npm run test:state-transitions`)**:
   - **21 integration tests** across **7 test files** executing against PostgreSQL with pre-flight connection validation, migration synchronization, statement-level `TRUNCATE` rejection testing, and multi-instance concurrency testing.

3. **Live Razorpay Test-Mode Proof (`npm run test:razorpay:proof` / `npm run razorpay:proof`)**:
   - Real test-mode checkout creation, webhook HMAC-SHA256 signature verification, tamper rejection, duplicate replay defense, and live captured payment settlement verification (`pay_TW18gkYUhOpBw1`).

```bash
# Run unit tests (198 tests, 45 files)
npm run test:unit

# Run integration tests (21 tests, 7 files against PostgreSQL)
npm run test:integration

# Run live Razorpay Playwright E2E proof
npm run test:razorpay:proof

# Run autonomous Razorpay lifecycle evidence verifier
npm run razorpay:proof

# Verify cryptographic audit chain integrity
npm run audit:verify
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
