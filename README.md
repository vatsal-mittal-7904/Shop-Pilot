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
# Run the autonomous machine-to-machine buyer agent demo:
npm run demo:buyer

# Run the complete end-to-end interactive CLI journey:
npm run demo:interactive
```

To run the Next.js web application and Model Context Protocol (MCP) server:
```bash
npm run dev
```

*Note: Access the MCP JSON-RPC 2.0 endpoint at `http://localhost:3000/api/mcp`.*
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

### 2. Empirical A/B Uplift Engine & Counterfactual Economics ([`upliftExperiment.ts`](src/backend/actions/upliftExperiment.ts))
- **Counterfactual Economics**: Measures exact incremental conversion vs an organic control baseline without AI intervention.
- **AOV Expansion**: Measures basket size growth from dynamic cross-sells and upsells.
- **Net Incremental Revenue**: Calculated as `Treatment Revenue - Counterfactual Baseline - Campaign Discounts`.
- **Two-Sample Z-Testing with Abramowitz & Stegun Error Function Approximation**: Evaluates two-sample pooled proportion z-scores using the standard normal cumulative distribution function $\Phi(z)$ via Abramowitz & Stegun formula 7.1.26 ($< 1.5 \times 10^{-7}$ max error), generating authentic two-tailed p-values.
- **Wilson Score 95% Confidence Intervals & Cold-Start Calibration**: Computes asymmetric Wilson score confidence intervals for binomial conversion proportions on both treatment and control cohorts without synthetic sample smoothing. When cohort sample sizes are below statistical power thresholds ($N < 5$), explicitly classifies experiment state as `CALIBRATING_BASELINE` rather than misattributing premature statistical significance.

### 3. Model-Derived Growth Strategy & Sanitized Prompt Boundaries ([`campaignStrategyAgent.ts`](src/backend/ai/campaignStrategyAgent.ts))
- **Substantive AI Strategy**: Synthesizes price elasticity models, urgency-based time-decay discount ladders, and capital clearance cohorts.
- **Indirect Prompt Injection Shielding**: All catalog fields interpolated into model prompts are sanitized via [`sanitizeUntrustedToolText`](src/backend/utils/untrustedToolData.ts) and sealed inside `<untrusted_catalog_data>` boundaries to neutralize embedded prompt injection attacks in merchant product names.
- **Human-in-the-Loop Approval Gate**: The AI proposes; the human merchant approves.

### 4. Bounded LRU Anti-DDoS Rate Limiting & Server Action Defense ([`rateLimit.ts`](src/backend/utils/rateLimit.ts))
- Protects conversational endpoints and high-impact Server Actions (`addToCart`, `acceptOfferForCheckout`, `createOrReuseCheckoutOrder`, `acceptRecommendation`) using an in-memory token bucket.
- **Bounded Memory Profile**: Enforces a strict `MAX_IN_MEMORY_KEYS = 10,000` limit with active timestamp cleanup and LRU eviction, eliminating Node.js memory leaks under heavy bot cart spam.
- **Fail-Safe Fallback**: If database-backed rate-limiting fails or runs into connection exhaustion, automatically degrades gracefully to bounded in-memory rate limiting.

### 5. Cross-Provider AI Failover Architecture ([`model.ts`](src/backend/ai/model.ts), [`aiClient.ts`](src/backend/utils/aiClient.ts))
- **Live Shopping Chat Streaming Failover (`safeStreamText`)**: The customer shopping chat route ([`src/app/api/chat/route.ts`](src/app/api/chat/route.ts)) streams responses via a resilient multi-provider fallback chain. If Google Gemini (`gemini-2.5-flash` / `gemini-2.5-flash-lite`) encounters rate limits (HTTP 429), timeouts, or service errors, it automatically fails over to Groq's high-speed LLaMA engine (`llama-3.3-70b-versatile`), ensuring uninterrupted buyer shopping sessions.
- **Background Intelligence Failover (`executeWithFallback`)**: Protects background intelligence agents, recommendation engines, and prompt security classification across Google and Groq.

### 6. Deterministic Budget Authorization & 15-Minute Spend Velocity ([`intent.ts`](src/backend/actions/intent.ts), [`accountBudget.ts`](src/backend/actions/accountBudget.ts))
- **Unconditional Ceiling Invariant**: Conversational prompts can establish or lower an active budget ceiling, but can **never unilaterally lift or clear it across either UPDATE or REPLACE intents**. If a shopper or prompt injection attempts to increase or clear the budget, the server blocks the increase, retains the lower active ceiling, and stages a `pendingBudgetIncrease`.
- **15-Minute Spend Velocity Throttling**: In addition to per-order caps and daily ceilings, enforces a rolling 15-minute sliding spend window (`assertAccountSpendLimit`) to prevent rapid automated loop drains from compromised or malfunctioning buyer agents.
- **Authenticated Confirmation**: Increasing a spending ceiling requires an explicit, authenticated customer action via the in-app authorization banner or `/api/agent/budget` endpoint.
- **Row-Locked Transactional Assertion**: Order checkouts enforce customer spend limits using PostgreSQL row-level locks (`SELECT 1 FROM "Customer" ... FOR UPDATE`).

### 7. Multi-Tier Prompt & Payload Shield ([`promptShield.ts`](src/backend/security/promptShield.ts))
- **Tier 1 (Deterministic Pre-Filter, <1ms)**: Blocks script injection (XSS), overt jailbreak commands (`ignore previous instructions`), and financial bypass attempts (`set price to 0`) at zero API cost.
- **Fast-Path Clearance**: Standard e-commerce queries (*"show me keyboards under 5000"*) bypass LLM security evaluation, saving 800ms+ latency.
- **Tier 2 (Semantic LLM-as-a-Judge)**: Analyzes complex or ambiguous borderline inputs.
- **Fail-Safe Resilience**: If AI security endpoints time out, benign shopping is never blocked because the backend policy engine and HMAC basket bindings deterministically protect all money operations.

### 8. Append-Only Audit Ledger & Off-DB WORM Replication ([`auditChainVerifier.ts`](src/backend/security/auditChainVerifier.ts), [`wormStorageTransmitter.ts`](src/backend/security/wormStorageTransmitter.ts))
- **Threat Model & Security Boundaries**:
  - **Application & SQL Layer Defense (In-DB)**: PostgreSQL engine triggers strictly prohibit `UPDATE`, `DELETE`, and `TRUNCATE` on `AuditLog` and `AuditExport`. Advisory transaction locks serialize SHA-256 chain links sequentially per merchant with HMAC-SHA256 signatures, preventing tampering from application exploits or SQL injection.
  - **Privileged Superuser Defense (Off-DB WORM)**: To protect against a compromised database root credentials or malicious DBA, MerchantOS executes dual-write off-database replication (`wormStorageTransmitter.ts`) to external append-only SIEM endpoints / cloud object storage. **If external replication fails, it immediately fires an urgent `AUDIT_REPLICATION_FAILURE` alarm across Slack, Discord, and operator webhooks.**

### 9. Lost-Webhook Recovery & Prioritized Captured Reconciliation ([`paymentReconciliation.ts`](src/backend/actions/paymentReconciliation.ts))
- **Preferential Capture Selection**: When reconciling orders where multiple payment attempts were made, the worker preferentially selects captured payments over failed attempts, ensuring a lost webhook on a retry attempt never incorrectly marks the order failed.
- **Authoritative Provider Verification**: Verifies provider order state and active checkout retry windows before finalizing non-payment.
- **Multi-Tiered Self-Healing**: Includes daemon polling (`scripts/scheduler-daemon.ts`), health diagnostic probe (`scripts/verify-scheduler-health.ts`), and lazy opportunistic reconciliation on authenticated checkout/dashboard visits ([`opportunisticReconciliation.ts`](src/backend/actions/opportunisticReconciliation.ts)).

### 10. High-Concurrency Flash-Sale & Inventory Safety ([`flash-sale-contention.test.ts`](tests/unit/flash-sale-contention.test.ts))
- **Atomic Stock Reservation**: Ascending-UUID sorted row locks (`SELECT ... FOR UPDATE`) in serializable transactions guarantee zero overselling under heavy parallel contention.
- **Durable Stockout Refunds**: Any payment captured post-stockout is marked `INVENTORY_FAILED` and automatically queued to the durable refund outbox rather than reviving or stranding stock.

### 11. Multi-Channel Alerting & Customer Notifications ([`operatorNotifier.ts`](src/backend/notifications/operatorNotifier.ts), [`customerNotifier.ts`](src/backend/notifications/customerNotifier.ts))
- **Operator Channels**: Dispatches queue age alerts, critical backlogs, and audit replication alarms to Slack (Block Kit), Discord (rich embeds), and generic HMAC-signed webhooks.
- **Customer DLQ Delivery**: Multi-channel delivery when background operations enter DLQ (Resend email, signed webhooks, in-app system messages).

### 12. Razorpay Route Marketplace Architecture & Reversal Defense ([`payment.ts`](src/backend/actions/payment.ts), [`refundProcessor.ts`](src/backend/actions/refundProcessor.ts))
- **Multi-Merchant Transfers**: Supports split payments and transfers via Razorpay Route. When a merchant links a `razorpayAccountId`, order creation automatically transfers the merchant share to their linked account.
- **Route Settlement Refund Reversal (`reverse_all: 1`)**: When refunding a Route-settled marketplace order, [`refundProcessor.ts`](src/backend/actions/refundProcessor.ts) automatically passes `reverse_all: 1` in the Razorpay refund payload, ensuring subaccount transfers are cleanly reversed from the merchant's account rather than draining the platform's central funds.

### 13. Pre-Authorized Autonomous Agent Checkout Mode ([`order.ts`](src/backend/actions/order.ts), [`intent.ts`](src/backend/actions/intent.ts), [`route.ts`](src/app/api/chat/route.ts))
- **Autonomous Agent-to-Agent (A2A) Checkout**: When an authenticated buyer agent has pre-authorized autonomous purchases (`autonomousCheckoutEnabled: true` in `deliveryProfile` or active intent `autonomousPurchase: true`), conversational tools can directly transition valid offers to `ACCEPTED` and generate Razorpay checkout orders without manual click bottlenecks.
- **Spend Boundary Invariant**: Pre-authorization is bounded by customer-configured spend ceilings (`autonomousSpendCeiling`, `maxOrderSpendLimit`, and `dailySpendLimit`). Any offer exceeding the pre-authorized ceiling automatically triggers graceful fallback requiring explicit manual confirmation (`CUSTOMER_CLICK_ACCEPT`).
- **Cryptographic Audit Ledger**: Pre-authorized acceptance is recorded in the append-only audit trail as `CUSTOMER_PREAUTHORIZED_AUTONOMOUS_ACCEPTANCE`.

### 14. Dynamic Taxonomy & Category-Agnostic Recommendation Intelligence ([`dynamicTaxonomy.ts`](src/backend/utils/dynamicTaxonomy.ts), [`recommendationIntelligence.ts`](src/backend/ai/recommendationIntelligence.ts))
- **Dynamic Catalog Routing**: Replaces static regex with intent-based catalog query routing and dynamic category introspection from the merchant's live database, functioning across any merchant product category.
- **Universal Cross-Sell & Upsell Discovery**: Identifies complementary add-ons and tier upgrades across all product categories using margin health, inventory depth, and optimal price ratios (10%–40% for cross-sells, 1.1x–2.2x for upsells) with fallback to natural price-bracket discovery.

### 15. Model Context Protocol (MCP) Server Endpoint ([`route.ts`](src/app/api/mcp/route.ts))
- Standardized **JSON-RPC 2.0 MCP interface** exposing 5 production-grade merchant tools:
  1. `merchantos_catalog_search`: Semantic and keyword product lookup with inventory and pricing.
  2. `merchantos_create_basket`: Initializes an isolated customer cart session (guarded by M2M API key authorization).
  3. `merchantos_add_item`: Adds product units into the cart with inventory verification.
  4. `merchantos_request_signed_offer`: Generates HMAC-SHA256 sealed price-guaranteed offer and persists cryptographic hash snapshot.
  5. `merchantos_checkout_order`: Cryptographically validates offer HMAC against persisted snapshot, verifies live basket contents match, asserts buyer account spend ceilings and rolling 15-minute velocity, transitions offer to `ACCEPTED`, creates Razorpay provider checkout order (`mso_<orderId>`), and records immutable audit log entry.
- Enables external autonomous buyer agents (Claude Desktop, Cursor, enterprise procurement agents) to transact over standardized machine-to-machine protocols with strict financial guardrails.

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

## 🌐 Production Deployment on Vercel

MerchantOS is fully optimized for one-click deployment on **Vercel** paired with serverless PostgreSQL (e.g., [Neon](https://neon.tech) or [Supabase](https://supabase.com)).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvatsal-mittal-7904%2FrazorPay_Project)

For complete instructions, environment variables configuration, and webhook setup, see the **[Vercel Deployment Guide](docs/vercel_deployment_guide.md)**.

### Quick Deploy Summary:
1. **Push to GitHub & Import in Vercel**: Connect your repository to Vercel.
2. **Configure Environment Variables**: Set `DATABASE_URL`, `APP_ENV=demo`, `GOOGLE_GENERATIVE_AI_API_KEY`, Razorpay credentials, and cryptographic secrets in Vercel settings.
3. **Run Migrations & Seed**: Run `DATABASE_URL="<cloud-url>" npx prisma migrate deploy` and `npm run db:seed:demo`.
4. **Configure Razorpay Webhook**: Point to `https://<your-domain>.vercel.app/api/webhooks/razorpay`.
5. **Verify Health**: Query `https://<your-domain>.vercel.app/api/health`.

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

# 6. Autonomous Machine Buyer Agent Demo (7-step A2A commerce lifecycle):
npm run demo:buyer

# 7. Background Scheduler & Recovery Daemon Health Probe:
tsx --env-file=.env.local --env-file=.env scripts/verify-scheduler-health.ts
```

---

## 🧪 Comprehensive Test Suite

MerchantOS features a multi-tiered test matrix covering 100% of financial, authorization, and lifecycle invariants:

1. **Hermetic Unit Test Suite (`npm run test:unit`)**:
   - **234 unit tests** across **51 test files** covering Model Context Protocol (MCP) tool execution, rolling 15-minute spend velocity throttling, Abramowitz & Stegun error function p-value calculations, deterministic discount authorization, HMAC basket binding, bounded LRU rate limiting, money-safety matrices, cross-provider streaming AI failover (Gemini $\to$ Groq), multi-tier prompt shield, recommendation intelligence, external WORM sink alarming, pluggable customer DLQ email delivery, and conversation sliding windows. Executes hermetically with 100% pass rate in < 8s.

2. **Database Integration & State Transitions (`npm run test:integration` / `npm run test:state-transitions`)**:
   - **21 integration tests** across **7 test files** executing against PostgreSQL with pre-flight connection validation, migration synchronization, statement-level `TRUNCATE` rejection testing, and multi-instance concurrency testing.

3. **Live Razorpay Test-Mode Proof (`npm run test:razorpay:proof` / `npm run razorpay:proof`)**:
   - Real test-mode checkout creation, webhook HMAC-SHA256 signature verification, tamper rejection, duplicate replay defense, and live captured payment settlement verification (`pay_TW18gkYUhOpBw1`).

```bash
# Run unit tests (234 tests, 51 files)
npm run test:unit

# Run autonomous buyer agent demo
npm run demo:buyer

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
│   ├── merchant/                          # Growth queue, product catalog, analytics, audits
│   └── api/
│       ├── mcp/route.ts                   # Model Context Protocol (JSON-RPC 2.0) server
│       ├── chat/route.ts                  # AI SDK streaming & dynamic recommendation tools
│       ├── agent/                         # REST API for autonomous shopping agents
│       ├── cron/sweep-carts/route.ts      # Scheduled cart abandonment sweep
│       └── webhooks/razorpay/route.ts     # HMAC-verified webhook processing
├── backend/
│   ├── actions/
│   │   ├── policyEngine.ts                # Deterministic discount & margin enforcement
│   │   ├── upliftExperiment.ts            # A/B uplift & statistical significance engine
│   │   ├── accountBudget.ts               # Multi-window spend velocity & ceilings
│   │   ├── paymentReconciliation.ts       # Durable queue for Razorpay payment verification
│   │   ├── refundProcessor.ts             # Durable outbox for provider refunds
│   │   ├── orderExpiry.ts                 # Fail-safe stale unpaid order expiry
│   │   ├── cartSweeper.ts                 # Cart abandonment sweeper
│   │   └── queueMonitor.ts                # Queue backlog & health monitoring
│   ├── ai/
│   │   ├── campaignStrategyAgent.ts       # Model-derived growth campaign generator
│   │   ├── recommendationIntelligence.ts  # Empirical co-purchase mining & category synergy
│   │   └── conversationStorage.ts         # Normalized message storage & sliding window
│   ├── security/
│   │   ├── auditChainVerifier.ts          # Cryptographic SHA-256 audit chain verification
│   │   └── demoSafety.ts                  # Production safety checks
│   ├── utils/
│   │   ├── rateLimit.ts                   # Bounded LRU distributed token bucket limiter
│   │   ├── cartSelectionBinding.ts        # HMAC basket anti-tampering
│   │   └── untrustedToolData.ts           # DTO sanitization for untrusted catalog data
│   └── db/prisma.ts                       # Prisma client with PostgreSQL adapter
prisma/
├── schema.prisma                          # 21 Prisma models (policies, audit logs, queues)
└── migrations/                            # 15 chronological PostgreSQL migrations
scripts/
├── demo-autonomous-buyer.ts               # Autonomous buyer agent CLI runner (dual-mode)
├── verify-scheduler-health.ts             # Background recovery & scheduler health probe
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
7. **Multi-Window Spend Velocity & Ceilings**: Enforces per-order caps, rolling 15-minute spend velocity limits, and daily caps across merchants before reserving or charging funds.
