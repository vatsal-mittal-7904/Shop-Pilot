<div align="center">
  <h1>🛍️ MerchantOS</h1>
  <p><b>An AI-native commerce layer with deterministic guardrails.</b></p>
  
  [![Next.js](https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
  [![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://prisma.io/)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://postgresql.org/)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org/)
</div>

<br/>

MerchantOS lets a customer buy things by talking to an agent, and lets a merchant run growth campaigns proposed by an agent — **without ever letting the model decide what a discount is allowed to be.** Every price-affecting decision is evaluated by deterministic code against the merchant's own policy rows, recorded as an auditable `AgentAction`, and surfaced back to the user with the raw evaluation attached.

> 🏆 Built for the **Razorpay Agentic Commerce Hackathon**.

---

## 🚀 Quick Start & Interactive Demo

To instantly spin up the project and run the complete interactive end-to-end commerce lifecycle demo:

```bash
git clone https://github.com/vatsal-mittal-7904/razorPay_Project.git merchantos
cd merchantos
npm install
npx prisma db push
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

## 🧠 The Problem & Core Architecture

LLMs are excellent at conversation and catastrophic at custody of money.

Ask a naive shopping agent for a better price and it will invent "40% off, just for you," because next-token prediction rewards plausible-sounding bargains. It knows nothing of floor margins, committed quarterly budgets, or inventory constraints.

### The Guardrail Boundaries (Safety by Design)

```text
┌───────────────────────────────────────────────┐  ┌───────────────────────────────────────────────┐
│     AUTONOMOUS BUYER AGENT LAYER              │  │     HUMAN-IN-THE-LOOP MERCHANT LAYER          │
│                                               │  │                                               │
│  Shopper  ──▶  AI Chat  ──▶  Deterministic    │  │  AI Growth Engine  ──▶  Merchant Dashboard    │
│  Prompt        Agent         Policy Engine    │  │  (Cart Recovery &        Approval Gate        │
│                               (ALLOW / BLOCK) │  │   Clearance Proposals)   (Review & Dispatch)  │
└──────────────────────┬────────────────────────┘  └───────────────────────┬───────────────────────┘
                       │                                                   │
                       ▼                                                   ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             TRANSACTION & SETTLEMENT CORE                                        │
│                                                                                                  │
│   HMAC Basket Binding  ──▶  Explicit Acceptance  ──▶  Razorpay Test Order  ──▶  Signed Webhook   │
│   (Anti-Tampering)          (Owner State Change)      (mso_<id> Receipt)        (payment.captured│
│                                                                                                  │
│   Reconciliation Worker ◀── Durable Refund Outbox ◀── Stockout Safe Settlement (Atomic Inventory)│
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 1. Autonomous Buyer Interactions (Bounded by Deterministic Policy)
- The model **never computes a price or discount**. It requests a discount, and [`evaluateDiscount()`](src/backend/actions/policyEngine.ts) verifies against indexed `MerchantPolicy` rows (`MAX_DISCOUNT_PERCENTAGE`, `MIN_MARGIN_PERCENTAGE`).
- Every attempt—approved or refused—writes an immutable [`AgentAction`](src/backend/actions/policyEngine.ts) row.
- Basket selections are sealed with an **HMAC SHA-256 signature** ([`cartSelectionBinding.ts`](src/backend/utils/cartSelectionBinding.ts)) to prevent tampering.
- Order creation requires explicit, authenticated customer acceptance.

#### 2. Human-in-the-Loop Merchant Growth Gates
- The growth engine autonomously identifies opportunities (abandoned cart `RECOVERY` and high-inventory `CLEARANCE`).
- **Safety Gate**: The AI proposes; the **human merchant disposes**. No recovery offers or discount codes are ever dispatched until the merchant reviews the rationale and explicitly approves the campaign, triggering deterministic re-validation of inventory, margins, and budget limits.

---

## 💻 Local Setup

### Prerequisites
- Node.js 20+
- A PostgreSQL database
- A Google AI (Gemini) API key
- Razorpay **test-mode** keys

### 1. Configure the environment
`DATABASE_URL` goes in `.env` (Prisma reads it via `prisma.config.ts`):
```env
DATABASE_URL="postgresql://user:password@localhost:5432/merchantos"
```

Everything else goes in `.env.local`:
```env
# Gemini — the AI SDK reads GOOGLE_GENERATIVE_AI_API_KEY
GOOGLE_GENERATIVE_AI_API_KEY="your_gemini_api_key"

# Razorpay test mode. The NEXT_PUBLIC_ key is the only one exposed to the browser.
NEXT_PUBLIC_RAZORPAY_KEY_ID="rzp_test_..."
RAZORPAY_KEY_ID="rzp_test_..."
RAZORPAY_KEY_SECRET="your_key_secret"
RAZORPAY_WEBHOOK_SECRET="your_webhook_secret"

# Optional separate secret for the HMAC that binds a checkout offer to the
# exact authenticated customer basket. Defaults to RAZORPAY_KEY_SECRET.
OFFER_BINDING_SECRET="another-long-random-string"

# Required by GET /api/cron/sweep-carts
CRON_SECRET="any_long_random_string"

# Optional Operator Notification Channels for Critical Queue Backlogs
# Dispatches real-time alerts to Webhook, Slack, or Discord if refunds or reconciliations stall
OPERATOR_ALERT_WEBHOOK_URL="https://operator.example.com/alerts"
ALERT_WEBHOOK_SECRET="operator_alert_signing_secret"
SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
```

### 2. Seed & Run
Creates the TechNest merchant, product catalogue, the merchant admin, and the demo customer with an already-abandoned cart for the campaign generator.
```bash
npx prisma db push
npx prisma db seed
npm run db:seed:demo
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
- Merchants are routed to `/merchant/portal`
- Customers are routed to `/agent`

**Seeded credentials:**
| Role | Email | Password |
| --- | --- | --- |
| Merchant admin | `admin@technest.com` | `technest-demo-2026` |
| Demo customer | `demo.customer@technest.com` | `technest-customer-demo` |

These credentials exist only for local development and disposable test databases.
`prisma/seed-demo.ts` refuses to run with `NODE_ENV=production`; the production
catalog seed requires explicitly supplied, non-demo merchant credentials; and
server startup fails closed if either documented demo email remains in the
production database. Remove or replace those accounts before deploying.

### 3. Interactive CLI Demo (`npm run demo:interactive`)

To see the complete financial custody and commerce lifecycle in action without manually navigating UI screens, run:

```bash
npm run demo:interactive
```

The interactive demo steps through:
1. **Catalog Search & Basket Addition**: Customer searches products and populates their active basket.
2. **Dynamic Bundle Offer Negotiation**: Demonstrates the policy engine blocking a 35% discount attempt against the 15% merchant ceiling, then approving a compliant 10% bundle offer.
3. **Cryptographic Basket Binding & Acceptance**: Generates HMAC SHA-256 over exact line items and verifies anti-tampering defenses upon explicit customer acceptance.
4. **Razorpay Checkout & Spend Limits**: Enforces daily/monthly account limits, creates the provider order with durable `mso_<orderId>` receipt, and enqueues payment reconciliation.
5. **Signed Webhook Delivery & Cart Conversion**: Simulates Razorpay `payment.captured` with HMAC-SHA256 signature, transitioning the order to `PAID`, cart to `CONVERTED`, and decrementing stock.
6. **Cart Recovery & Refund Outbox**: Sweeps abandoned carts, generates autonomous recovery campaign, executes human-in-the-loop merchant approval, and demonstrates the durable refund outbox worker.

---

## 🧪 Test Taxonomy and Verification

MerchantOS provides three tiers of automated verification:

1. **Unit Testing (`npm run test:unit`)**:
   Runs 23+ isolated test suites (98+ tests) verifying deterministic discount authorization, HMAC basket binding, account budgets, untrusted tool sanitization, operator alert dispatchers, and money-safety fail-closed invariants.

2. **State Transitions & Idempotency (`npm run test:state-transitions`)**:
   Uses a real disposable PostgreSQL database with mocked Razorpay to prove internal state transitions, cart lifecycles, and audit ledger immutability.

3. **Live Razorpay Provider Contract (`npm run test:razorpay:provider-contract`)**:
   Opt-in live provider test that creates real Razorpay test-mode orders, verifies receipts, currency, and provider payment lists directly against Razorpay API.

```bash
# Run all unit tests
npm run test:unit

# Run live provider contract test (requires TEST_DATABASE_URL and Razorpay test keys)
TEST_DATABASE_URL="postgresql://.../merchantos_e2e" npm run test:razorpay:provider-contract
```

---

## 🗺️ Guided Web UI Demo

1. **Sign in as the customer** (`demo.customer@technest.com` / `technest-customer-demo`) and ask for something with a budget — *"I need a mechanical keyboard under ₹8,000."*
2. **Accept a product.** The agent attempts a bundle via `propose_bundle_addon`, which routes the discount through `evaluateDiscount` first. A `PolicyBadge` appears.
3. **Push it.** Ask for 40% off. The engine refuses against the 15% ceiling, a `BLOCKED` `AgentAction` is written.
4. **Check out.** `generate_checkout_link` produces a Razorpay order.
5. **Switch to the merchant.** On `/merchant`, run the **Cart Sweeper**, then **Generate opportunities** to fill the growth queue.
6. **Open `/merchant/analytics`.** Revenue, carts recovered, upsell conversion — and **Margins Protected**.

---

## 📂 Project Structure

```text
src/
├── app/
│   ├── page.tsx                        # role-aware auth gateway
│   ├── agent/                          # conversational buyer UI
│   ├── merchant/                       # growth dashboard, hub, analytics
│   └── api/
│       ├── chat/route.ts               # AI SDK streaming + the six agent tools
│       ├── agent/                      # REST surface for autonomous buyer agents
│       ├── cron/sweep-carts/route.ts   # scheduled sweep (Bearer CRON_SECRET)
│       └── webhooks/razorpay/route.ts  # HMAC-verified payment truth
├── backend/
│   ├── actions/
│   │   ├── policyEngine.ts             # ⭐ deterministic discount enforcement
│   │   ├── cartSweeper.ts              # sole writer of Cart.status = ABANDONED
│   │   ├── merchant.ts                 # campaign generation, approval
│   │   ├── analytics.ts                # merchant ROI aggregates
│   │   └── intent.ts                   # BuyerIntent parsing
│   ├── auth/                           # password hashing, session cookies
│   └── utils/rateLimit.ts              # sliding-window limiter for /api/chat
├── prisma/
│   ├── schema.prisma                   # 19 models; MerchantPolicy + AgentAction
│   └── seed-demo.ts                    # abandoned cart + co-purchase history
└── tests/e2e/                          # Playwright buyer + merchant journeys
```

---

## 🛡️ Design Principles

1. **The model proposes; code decides.** No price, discount, or order total is ever produced by an LLM.
2. **Refusals are first-class data.** A `BLOCKED` `AgentAction` is written before the refusal is returned.
3. **Every attempt reaches the engine.** No validation layer is allowed to reject a request before it earns an audited decision.
4. **Explain with the artifact, not a summary.** The UI shows the engine's own `reason` and raw verdict JSON.
5. **Fail closed.** Missing policy row → limit `0`. Missing `CRON_SECRET` → `500`. Bad webhook signature → `400`.
6. **Ground numbers in rows.** Campaign impact and dashboard KPIs are aggregates over real data.
7. **Acceptance is a state transition.** A Razorpay order cannot be created until the authenticated customer explicitly accepts the exact persisted offer; the acceptance is audited with the offer amount and timestamp.
8. **Basket selection is code-bound.** The agent cannot add items or send product IDs into checkout. Offers are derived only from the shopper's persisted basket and signed with a server-side HMAC over its exact lines.
9. **Razorpay recovery is deterministic.** Every provider order uses a durable, unique receipt. A retry first looks up that receipt at Razorpay and reconciles it before it can create another order.
10. **Tool data is untrusted.** Catalog/tool values are reduced to a safe DTO; instruction-shaped strings and open-ended attributes are excluded from model context on every turn.
11. **Recovery attribution is strict.** “AI-Recovered Revenue” counts only paid orders linked to offers dispatched by a completed `RECOVERY` campaign—never generic paid orders or ordinary offer conversions.
12. **Refunds use a durable outbox.** A captured payment with no inventory atomically records an `INVENTORY_FAILED` order and a pending refund row. The cron worker calls Razorpay only after commit, retries with the row's stable Razorpay idempotency key, and records the provider refund id in the audit ledger.
13. **Payments have webhook-independent recovery.** Persisting a Razorpay order atomically queues a payment reconciliation task. The cron worker claims due work, reads the provider's authenticated payment list, routes a final captured/failed state through the same validated processor as webhooks, and uses exponential backoff for network or non-final outcomes.
14. **Buyer limits are account policies.** Every customer has durable daily and monthly spend limits in paise. Checkout counts that customer's pending, captured, and paid orders across merchants and conversations, and serializes the budget reservation with the order creation transaction.
