# MerchantOS AI 🚀

An AI-Native Merchant Infrastructure prototype built for the **Razorpay AI Builder / Agentic Commerce Hackathon**.

This project proves the core thesis: *Turn a traditional Razorpay merchant into an AI-native merchant that human customers (and autonomous AI buyers) can understand, negotiate with, purchase from, and pay safely — while the merchant's own AI agent optimizes every transaction for revenue within strict deterministic boundaries.*

## 🌟 Key Features

1. **Conversational Buyer Interface (The Agent):** A fully interactive, real-time two-way chat where a customer can negotiate with the Merchant AI to secure discounts, bundles, and product recommendations based on their specific budget and requirements.
2. **Interactive UI Tool Rendering (Sliding Cards):** The AI Agent proactively searches the database and renders beautiful, horizontally-scrollable product cards directly inside the chat interface, followed by dynamic Razorpay checkout buttons once a deal is struck.
3. **Deterministic Policy Engine:** AI is great for conversation, but risky for commerce. We built a strict backend policy engine (e.g., `MAX_DISCOUNT_PERCENTAGE = 15%`) that deterministically evaluates and blocks any unsafe pricing proposals made by the AI.
4. **Intelligent Upselling & Bundling:** The AI Agent is strictly prompted to attempt cross-selling (e.g., offering a wireless mouse to complement a mechanical keyboard) before generating the final payment link.
5. **Role-Based Gateway:** A centralized Landing Page that securely routes `admin@technest.com` to the Merchant Hub, while seamlessly onboarding new customer emails into the database and routing them to the Agent UI.
6. **Merchant Hub & Growth Dashboard:** A comprehensive dashboard for the human merchant to review system audit trails, revenue, and "AI Growth Opportunities" (e.g., Abandoned Cart Recovery, Bundle Cross-Sells) generated dynamically from real database metrics.
7. **Manual Product Adder:** A dedicated, robust interface for the merchant to manually manage catalog items, inventory, and images, fully integrated with the PostgreSQL database.
8. **End-to-End Razorpay Integration:** The conversational flow successfully creates an internal order, generates a Razorpay Order, and processes a webhook to safely mark the transaction as `PAID` via the Immutable Audit Log.

## 🛠 Tech Stack
* **Frontend/Backend:** Next.js (App Router), React, Tailwind CSS
* **Database:** PostgreSQL (via Prisma ORM)
* **AI:** Google Gemini (`gemini-3.6-flash`), Vercel AI SDK (`ai@3.4.15`, `@ai-sdk/google`)
* **Payments:** Razorpay Test Mode

## 📂 Project Structure
* `src/app/page.tsx` - The universal Landing Page & Role-Based Gateway.
* `src/app/agent/page.tsx` - The Live Conversational AI Customer Interface (with Sliding Cards).
* `src/app/merchant/portal/page.tsx` - The Merchant Hub.
* `src/app/merchant/page.tsx` - The Merchant AI Growth Dashboard & Audit Log.
* `src/app/merchant/products/page.tsx` - The Manual Product Adder & Catalog Manager.
* `src/backend/actions/commerce.ts` - The deterministic backend commerce services (Inventory, Policies, Orders).
* `src/backend/actions/merchant.ts` - Server actions for generating AI opportunities and adding products.
* `src/backend/actions/auth.ts` - Database-driven customer authentication.
* `src/app/api/chat/route.ts` - The Vercel AI SDK streaming backend and Agent Tool Definitions (`search_catalog`, `propose_products`, `generate_checkout_link`).
* `src/app/api/webhooks/razorpay/route.ts` - The Razorpay webhook handler.

## 🚀 Running Locally

1. **Environment Variables:** Update your `.env.local` file with the following:
   ```env
   DATABASE_URL="postgres://postgres:postgres@localhost:51214/template1?sslmode=disable"
   GOOGLE_GENERATIVE_AI_API_KEY="your_gemini_api_key"
   NEXT_PUBLIC_RAZORPAY_KEY_ID="rzp_test_..."
   RAZORPAY_KEY_ID="rzp_test_..."
   RAZORPAY_KEY_SECRET="your_secret"
   RAZORPAY_WEBHOOK_SECRET="my_secure_webhook_secret_123"
   ```
2. **Start the Next.js App:**
   ```bash
   npm run dev
   ```
3. **Setup Webhook (Optional for testing payments):**
   Use ngrok to expose port 3000 and configure it in your Razorpay Dashboard for `order.paid` and `payment.captured` events.
   ```bash
   ngrok http 3000
   ```

## 🎮 Demo Flow
1. **The Gateway:** Visit `http://localhost:3000/`. Enter an email like `john@example.com` to log in as a Customer.
2. **The Negotiation:** You will be taken to the Agent UI. Tell the agent your budget (e.g., "I need a mechanical keyboard under 8000 rupees").
3. **The Proposal:** Watch the AI invoke the `search_catalog` tool, find a match, and render a sliding product card directly in the chat using the `propose_products` tool.
4. **The Upsell:** Agree to the product. The AI will attempt to bundle it with a related item (like a mouse) for a discount.
5. **The Checkout:** Once agreed, the AI triggers the `generate_checkout_link` tool. The backend Policy Engine verifies the discount is <= 15%. If safe, it renders the Razorpay checkout button.
6. **The Merchant View:** Go back to `http://localhost:3000/` and log in as `admin@technest.com`. Explore the Growth Dashboard to see the Audit Log, or go to the Product Catalog to add new inventory.
