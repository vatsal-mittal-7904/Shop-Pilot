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

## 🚀 Quick Start

To instantly spin up the project on your local machine, run the following commands:

```bash
git clone https://github.com/vatsal-mittal-7904/razorPay_Project.git merchantos
cd merchantos
npm install
npx prisma db push
npx prisma db seed
npm run db:seed:demo
npm run dev
```

*Note: You must set up your `.env` and `.env.local` files first. See the [Local Setup](#-local-setup) section below for details.*

---

## 🧠 The Problem

LLMs are excellent at conversation and catastrophic at custody of money.

Ask a naive shopping agent for a better price and it will give you one. It will invent "40% off, just for you," because a plausible-sounding discount is exactly what the next-token objective rewards. Nothing in the model knows that this merchant's floor margin is 8%, that the campaign budget for the quarter is already committed, or that the SKU in the cart is a loss-leader. The failure is silent and it is expensive.

The usual mitigations don't hold:

- **Prompting harder** ("never offer more than 15%") is a request, not a constraint.
- **Schema-capping the tool** (`discount: z.number().max(15)`) looks like enforcement but fails open in the worst way. The tool call is rejected *before* your code runs, so nothing is logged, nothing is explainable, and the model is free to apologise and try a different number.
- **Post-hoc review** is too late. By then the promise has been made in the chat.

The constraint has to live in code that the model cannot reach, it has to run *before* anything touches the cart, and every attempt — allowed or refused — has to leave a row behind.

---

## 🏗️ The Solution: Architecture

### 1. Deterministic Policy Engine
The model never computes a discount. It *requests* one, and a plain async function decides.

[`evaluateDiscount()`](src/backend/actions/policyEngine.ts) is the whole enforcement surface — no LLM, no heuristics, one indexed read:

```ts
const policy = await prisma.merchantPolicy.findUnique({
  where: { merchantId_key: { merchantId, key: 'MAX_DISCOUNT_PERCENTAGE' } },
})
const limit = policy?.value ?? 0        // absent policy => deny everything
const passed = requested <= limit
```

**`AgentAction` is the interception record.** Both discount-bearing tools in [`api/chat/route.ts`](src/app/api/chat/route.ts) — `propose_bundle_addon` and `generate_checkout_offer` — write an intercept record before continuing.

### 2. Autonomous Growth Queue
The merchant side is agentic in the same bounded way: the system proposes, a human disposes, and the proposals are grounded in rows rather than vibes.

**The campaign generator** ([`generateCampaigns()`](src/backend/actions/merchant.ts)) emits deterministic abandoned-cart `RECOVERY` and high-inventory `CLEARANCE` opportunities. Merchant approval revalidates policy, margin, inventory, recipient eligibility, and a reserved discount budget, then issues customer-specific expiring offers. Cross-sell and upsell remain buyer-initiated flows; they are not represented as “executed campaigns” without a recipient-delivery path.

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

### Test taxonomy and Razorpay test-mode proof

`npm run test:state-transitions` uses a real disposable PostgreSQL database,
but intentionally mocks Razorpay. It proves internal state transitions such as
inventory commitment, idempotency, and webhook handling; it is not provider
integration evidence. `npm run test:integration` remains a compatibility alias
for that suite.

`npm run test:razorpay:provider-contract` is the provider evidence. It is
deliberately opt-in and uses no Razorpay mock: with a separate database plus
`rzp_test_*` keys, it creates an order through the authenticated customer
checkout path, then fetches that order and its empty payment list directly from
Razorpay. It verifies provider id, amount, INR currency, durable
`mso_<internal-order-id>` receipt, `created` status, and provider-side notes.

```bash
TEST_DATABASE_URL="postgresql://.../merchantos_e2e" npm run test:razorpay:provider-contract
```

`TEST_DATABASE_URL` must be different from `DATABASE_URL`; the harness resets
and seeds it. This test proves real provider order creation and the payment-list
read, not a simulated Razorpay response. For capture/webhook proof, expose
`/api/webhooks/razorpay` through a public HTTPS tunnel, configure
`RAZORPAY_WEBHOOK_SECRET` in Razorpay test mode, complete the checkout using a
Razorpay test payment method, and confirm the merchant audit ledger contains
`PAYMENT_CAPTURED` with the matching Razorpay payment id.

---

## 🗺️ Guided Demo

1. **Sign in as the customer** and ask for something with a budget — *"I need a mechanical keyboard under ₹8,000."*
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
