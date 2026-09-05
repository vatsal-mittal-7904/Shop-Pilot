# Razorpay Buildathon: Master Execution Plan

This document synthesizes the complete, 4-goal strategic plan to elevate Shop-Pilot from a hackathon prototype to a production-grade, winner-caliber platform.

---

## 1. Improve AI Judgment
**Goal:** Make AI materially improve shopping and merchant growth decisions—not merely narrate deterministic logic.

### Phase 1 — Define AI’s legitimate scope
**Keep AI limited to:** Extracting shopper intent, explaining trade-offs, ranking safe recommendations, generating campaign hypotheses, and explaining offer proposals.
**Keep deterministic systems responsible for:** Price, discounts, totals, eligibility, budgets, margins, inventory, cart actions, payment, and settlement.
**Deliverable:** A one-page "AI authority boundary" document and inline code comments beside every model/tool call.

### Phase 2 — Build a recommendation evaluation loop
Create an evaluation dataset containing 30–50 scenarios to prove AI out-performs deterministic fallback without policy failures.
*Examples:* Budget keyboard shopper (₹5k cap) -> Do not surface over-budget items. Existing mouse in cart -> Suggest compatible mousepad. Low-margin add-on -> Do not propose.
**Score on:** Catalog grounding, relevance, policy compliance, explanation quality, and non-manipulation.

### Phase 3 — Make campaign AI measurable
Stop presenting generic copy as intelligence. For every campaign proposal, persist: Segment definition, baseline conversion/AOV, predicted uplift, discount cost, expected margin impact, and actual post-execution outcomes.
**Success Criterion:** Dashboard states exact incremental gross profit (e.g., "Recovery produced 8.4% conversion vs 4.1% baseline, yielding ₹X").

### Phase 4 — Improve model robustness
- Replace the LLM-only prompt-injection classifier with layered controls (schema limits, deterministic checks, server boundaries).
- Treat all metadata, catalogs, and outputs as untrusted.
- Require strict Zod schemas for all outputs.
- Record model provider, version, latency, and fallback reasons in audit events.
- **Acceptance Criteria:** 40+ versioned eval cases in CI; zero AI paths mutate money; prompt-injection blocks attacks cleanly.

---

## 2. Improve Engineering Quality
**Goal:** Make the repository feel deployable and reviewable, not just feature-rich.

### Phase 1 — Restore a clean quality gate
- Fix all lint errors, unused imports, and variables.
- Replace raw `<img>` tags with Next.js `<Image>`.
- Move/remove root-level junk scripts (done).
- **Success Criterion:** `npm run lint`, `build`, and `test:unit` all exit successfully.

### Phase 2 — Make integration tests reproducible
- Add a Docker Compose test database or documented ephemeral Postgres command.
- Add `npm run test:integration:local` to spin up DB, migrate, test, and teardown.
- Write tests for: Competing checkouts on one limit, duplicate webhooks, Razorpay timeouts + reconciliation, capture after cancel, inventory races, and audit edit rejections.

### Phase 3 — Harden configuration and secrets
- Remove fallback/dummy secrets from production paths.
- Add environment validation via schema and a safe `.env.example`.
- Introduce `APP_ENV=demo|test|production`. Demo mode must visibly label itself and block live Razorpay keys.

### Phase 4 — Correct audit-security claims
Rename the ledger feature to **"append-only, tamper-evident Postgres audit ledger"** and remove external WORM/tamper-proof language since it lacks S3 Object Lock anchoring.

### Phase 5 — CI and release confidence
- Add GitHub Actions CI: `install → lint → typecheck → unit tests → integration tests → build`.
- Add dependency vulnerability scans, Prisma schema validation, migration drift checks, and a release checklist.

---

## 3. Improve Demo Credibility
**Goal:** Make judges see proof, not architecture slides or security vocabulary.

### Phase 1 — Narrow the narrative
Use one crisp claim: *"Shop-Pilot converts conversational product discovery into a safe Razorpay checkout, where AI can recommend but cannot move money."*

### Phase 2 — Prepare a six-minute evidence-led demo
- **0:00–0:40:** State merchant problem & measurable target.
- **0:40–1:40:** Customer asks nuanced question; AI handles ambiguity.
- **1:40–2:15:** AI recommends in-stock item + add-on (catalog grounded).
- **2:15–2:50:** Attempt "ignore budget/make it free" (policy blocked).
- **2:50–3:40:** Customer explicitly accepts server-created offer (consent gate).
- **3:40–4:30:** Complete Razorpay test-mode checkout.
- **4:30–5:10:** Show signed webhook changes order to paid (server authority).
- **5:10–5:40:** Replay webhook / delayed-webhook reconciliation (recovery).
- **5:40–6:00:** Show audit chain.

### Phase 3 — Demo one meaningful failure
Intentionally delay/block a webhook after payment. Run the reconciliation worker to query Razorpay and cleanly recover the order to prove self-healing capabilities.

### Phase 4 — Use a judge-proof checklist
Verify keys, webhook URLs, seeded data, cron daemons, and have a pre-recorded 60s fallback video ready. No exposed secrets on screen.

### Phase 5 — Show metrics, not adjectives
Replace "secure" and "AI-powered" with visible proof: *"₹X account limit blocked Y checkout"*, *"Duplicate webhook caused exactly 1 inventory decrement"*.

---

## 4. Seller-Agent Chat & Commerce-Flow Quality
**Goal:** Make the agent genuinely useful as a seller, while keeping every commercial calculation and state transition deterministic.

### Phase 1 — Define the seller-agent contract
**Agent responsibilities:** Understanding constraints, searching/explaining catalog, comparing products, suggesting bundles, explaining rejected discounts.
**Agent MUST NOT:** Set prices/quantities, add items to cart without UI click, accept offers, or claim checkout completion.

### Phase 2 — Make catalog behavior trustworthy and interactive
- Render rich product cards (INR price, stock, core attributes, comparison details, "Add to cart" button).
- Explicitly label budget status (within, over, no match).
- Never invent specs, discounts, or stock.

### Phase 3 — Make cart interactions explicit and reliable
- Customer clicks -> authenticated cart action -> server derives merchant -> checks inventory -> updates cart -> UI confirms.
- Add tests for double-click races, concurrent adds, inventory drops, and cross-merchant carts.

### Phase 4 — Make bundles and upsells useful, not spammy
- Max 1 bundle per stage. Never repeat dismissed items.
- Explain item price, bundle discount, total delta, and budget compliance.
- Explicit Accept/Decline. Decline continues checkout without friction.

### Phase 5 — Make discount conversations precise
- Customer asks for 20% -> Agent checks policy -> Server computes -> Agent shows exact valid offer or explains why it's unavailable.
- Discount % is never accepted from the model as truth.

### Phase 6 — Add a server-calculated pricing ledger to the UI
- Display a strict breakdown: Item Name (catalog), Unit Price (catalog), Quantity (cart), Subtotal/Discount/Total/Currency/Expiry (server calculation).
- Add an expandable *"Why this price?"* section citing policy checks and margin passes.

### Phase 7 — Test the complete conversational commerce matrix
Add 12 specific E2E journeys covering catalog search, budget refusal, bundle acceptance/rejection, discount negotiations, expired offers, inventory changes mid-checkout, prompt injections, and duplicate webhooks.

### Phase 8 — Add this to the live demo
Integrate the seller-agent flows (nuanced search, explicit add, bundle proposal, discount negotiation, and UI pricing ledger) directly into the first half of the 6-minute judge demo.
