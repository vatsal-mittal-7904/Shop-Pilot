
'use client'
import Image from 'next/image';

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useRef, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ThemeToggle } from '@/frontend/components/ThemeToggle'
import { addProductToCart, clearCart } from '@/backend/actions/cart'
import { ProductCards } from './_components/ProductCards'
import { BundleOfferCard } from './_components/BundleOfferCard'
import { UpsellOfferCard } from './_components/UpsellOfferCard'
import { CheckoutButton } from './_components/CheckoutButton'
import { OfferCheckoutControl } from './_components/OfferCheckoutControl'
import PolicyBadge from './_components/PolicyBadge'
import { useAgentSession, type CustomerAutonomousSettings } from './_components/AgentSessionProvider'
import { AutonomousAgentSettingsModal } from './_components/AutonomousAgentSettingsModal'
// Type-only import: erased at compile time, so this does NOT create a server
// reference to the 'use server' module and nothing from it ships to the browser.
import type { AgentActionSummary } from '@/backend/actions/explainability'

// `category` and `tags` were added so this type also satisfies ProductCardData,
// letting search_catalog results feed ProductCards without a second cast. Both
// tools that return products (search_catalog, propose_products) now include them.
type ProductCard = { id: string; name: string; category: string; price: number; inventory: number; imageUrl?: string | null; warrantyYears: number; deliveryDays: number; tags?: string[]; attributes: Record<string, unknown> }
type CheckoutOffer = { items: Array<{ id: string; unitPrice: number; product: ProductCard }>; subtotal: number; discount: number; total: number; expiresAt?: string | Date }
type CartItem = { id: string; quantity: number; product: ProductCard }
type BuyerIntentUsed = { category: string[]; maximumAmount: number | null; pendingBudgetIncrease?: string | null }
type BundleAddon = { id: string; name: string; price: number; imageUrl?: string | null; category?: string }
type UpsellUpgrade = { id: string; name: string; price: number; imageUrl?: string | null; category?: string }
// What evaluateDiscount() (policyEngine.ts) returns, and what the chat route hands
// back on every policy-gated path -- refused (route.ts:316, :366) and approved
// (route.ts:334, :371) alike. PolicyBadge re-parses it with zod at the boundary
// rather than trusting this declaration.
type PolicyResult = { checked: string[]; passed: boolean; limit: number; requested: number; reason: string; allowed?: number }
// One flat optional-field bag covering every tool's result shape; `skipped`
// through `bundleTotal` are the propose_bundle_addon fields, and `orderId`
// through `currency` are generate_checkout_link's.
type ToolOutput = { items?: CartItem[]; products?: ProductCard[]; intentUsed?: BuyerIntentUsed; offer?: CheckoutOffer; offerId?: string; error?: string; status?: string; message?: string; actionRequired?: string; skipped?: boolean; reason?: string; recommendationId?: string; cartId?: string; addonProductId?: string; addon?: BundleAddon; pairedWith?: string; discountPercent?: number; bundleSubtotal?: number; bundleDiscount?: number; bundleTotal?: number; upgradeProductId?: string; upgrade?: UpsellUpgrade; replaces?: string; upsellSubtotal?: number; upsellDiscount?: number; upsellTotal?: number; orderId?: string; razorpayOrderId?: string; amount?: number; currency?: string; policyResult?: PolicyResult }
type ToolInvocationView = {
  type: `tool-${string}`
  toolCallId: string
  state: string
  input?: { query?: string; category?: string; maximumAmount?: number }
  output?: ToolOutput | ProductCard[]
  errorText?: string
}

function getToolName(part: ToolInvocationView) {
  return part.type.slice('tool-'.length)
}

/**
 * The model often uses Markdown-style bold for product names and discounts.
 * Render that one inline format deliberately instead of injecting arbitrary
 * model output as HTML.
 */
function renderInlineBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((segment, index) => {
    if (segment.startsWith('**') && segment.endsWith('**')) {
      return <strong key={index}>{segment.slice(2, -2)}</strong>
    }
    return segment
  })
}
// The AgentAction.type each policy-gated tool persists its decision under,
// mirroring the chat route exactly (propose_bundle_addon route.ts:305,
// generate_checkout_offer route.ts:354). Any other tool name yields no badge
// rather than a guessed label.
const POLICY_ACTION_TYPE: Record<string, string> = {
  propose_bundle_addon: 'BUNDLE_ADDON_OFFER',
  propose_upsell: 'UPSELL_OFFER',
  generate_checkout_offer: 'DISCOUNT_OFFER',
}

/**
 * Builds the AgentActionSummary PolicyBadge renders from the policyResult the
 * chat route already returns with each tool result.
 *
 * Deliberately NOT sourced from getRecentAgentActions() (explainability.ts), even
 * though that fetcher is now properly conversation-scoped -- AgentAction gained a
 * conversationId column and both chat-route writers populate it, so the old
 * cross-customer leak is closed. Two reasons the badge still comes from the tool
 * result instead:
 *
 *   1. The client has no conversationId to pass it. The chat route creates the id
 *      server-side and returns a UI message stream, so
 *      the id never crosses the boundary; AgentSessionProvider carries only
 *      { customerId, merchantId }. The fetcher is simply uncallable from here.
 *   2. Conversation scope still isn't message scope. Several DISCOUNT_OFFERs can
 *      exist in one conversation and nothing distinguishes which assistant turn
 *      produced which row, so a fetched list could not be placed beneath the
 *      response it belongs to.
 *
 * The tool result has neither problem: it arrives attached to the exact message
 * that produced it.
 *
 * `status` uses the same expression the server used when writing the row
 * (route.ts:309, :358), so the badge reflects the persisted AgentAction rather
 * than a second, independently re-derived client-side verdict.
 */
function toPolicyBadgeAction(toolCallId: string, toolName: string, policyResult: PolicyResult | undefined): AgentActionSummary | null {
  const type = POLICY_ACTION_TYPE[toolName]
  if (!type || !policyResult) return null
  return { id: toolCallId, type, status: policyResult.passed ? 'APPROVED' : 'BLOCKED', policyResult }
}

// How long the input/button stay disabled after a 429, in ms. Purely a
// client-side cooldown for UX -- it doesn't need to match the server's
// actual rate-limit window, just be long enough that a quick retry
// doesn't immediately re-trip the limiter.
const RATE_LIMIT_COOLDOWN_MS = 5000
const RATE_LIMIT_MESSAGE = "Woah there! You're chatting a bit too fast. Please wait a few seconds before sending another message."

export default function AgentSimulation() {
  const { customerId, merchantId, campaignOffers, autonomousSettings: initialAutonomousSettings } = useAgentSession()
  const [autonomousSettings, setAutonomousSettings] = useState<CustomerAutonomousSettings>(initialAutonomousSettings)
  const [isAutonomousModalOpen, setIsAutonomousModalOpen] = useState(false)
  const [rateLimited, setRateLimited] = useState(false)
  const rateLimitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastUserMessageRef = useRef<string>('')

  const triggerRateLimitCooldown = () => {
    setRateLimited(true)
    // A second 429 while already cooling down restarts the countdown
    // instead of letting an earlier timer clear the flag early.
    if (rateLimitTimeoutRef.current) clearTimeout(rateLimitTimeoutRef.current)
    rateLimitTimeoutRef.current = setTimeout(() => setRateLimited(false), RATE_LIMIT_COOLDOWN_MS)
  }

  useEffect(() => {
    return () => {
      if (rateLimitTimeoutRef.current) clearTimeout(rateLimitTimeoutRef.current)
    }
  }, [])

  const [input, setInput] = useState('')
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value)

  const { messages, setMessages, status, sendMessage, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat', body: { merchantId } }),
    onError: (error) => {
      if (!rateLimited && /rate limit/i.test(error.message)) {
        triggerRateLimitCooldown()
        setInput(lastUserMessageRef.current)
      }
    },
  })

  const isLoading = status === 'submitted' || status === 'streaming'
  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!input?.trim()) return
    sendMessage({ text: input })
    setInput('')
  }

  // Enter-to-submit bypasses the disabled attribute on the send button, so
  // the cooldown has to be enforced in the submit handler itself too.
  const onFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (rateLimited) {
      event.preventDefault()
      return
    }
    lastUserMessageRef.current = input
    handleSubmit(event)
  }

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Initial greeting
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: 'greeting',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Hello! I am the TechNest AI Agent. How can I help you today? Please let me know what kind of product you are looking for, your requirements, and your budget.' }],
        }
      ])
    }
  }, [messages.length, setMessages])

  return (
    <div className="flex flex-col h-screen font-sans selection:bg-indigo-100 transition-colors relative overflow-hidden">
      
      {/* ================= LIGHT MODE BACKDROP (Soft Diagonal Folds) ================= */}
      <div 
        className="absolute inset-0 block dark:hidden overflow-hidden bg-white -z-10 pointer-events-none"
        style={{
          backgroundImage: `
            radial-gradient(circle at top right, rgba(255,255,255,0.6) 0%, transparent 60%),
            repeating-linear-gradient(
              112deg,
              #ffffff 0px,
              #f0f5fb 60px,
              #dbe6f5 160px,
              #bed1ed 275px,
              #ffffff 280px
            )
          `
        }}
      ></div>

      {/* ================= DARK MODE BACKDROP (Agent Studio Blue Slashes) ================= */}
      <div 
        className="absolute inset-0 hidden dark:block overflow-hidden bg-black -z-10 pointer-events-none"
        style={{
          backgroundImage: `
            radial-gradient(circle at 50% 50%, transparent 10%, #000 95%),
            repeating-linear-gradient(
              112deg,
              #000 0px,
              #01081a 80px,
              #072075 190px,
              #1342cc 275px,
              #000 280px
            )
          `
        }}
      ></div>

      <header className="bg-white/80 dark:bg-[#0B1221]/80 backdrop-blur-md border-b border-slate-200 dark:border-gray-800 px-6 py-4 flex justify-between items-center shadow-sm z-10 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 dark:bg-blue-600 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">TechNest AI Sales Agent</h1>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Online · policy-protected checkout
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/agent/a2a"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-xs font-semibold transition shadow-sm"
            title="Switch to A2A Autonomous Agent mode"
          >
            <span>⚡</span>
            <span className="hidden sm:inline">Switch to A2A Autonomous</span>
            <span className="sm:hidden">A2A</span>
          </Link>
          <Link
            href="/select-mode"
            className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-blue-400 transition-colors bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-slate-700 px-3 py-1.5 rounded-lg"
            title="Return to Mode Selection screen"
          >
            Modes
          </Link>
          <button
            onClick={() => setIsAutonomousModalOpen(true)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition shadow-sm ${
              autonomousSettings.enabled
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
                : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
            title="Configure Autonomous Buyer Agent Spend Limits"
          >
            <span className="text-sm">⚡</span>
            <span>{autonomousSettings.enabled ? 'Autonomous: ON' : 'Autonomous: OFF'}</span>
            {autonomousSettings.enabled && autonomousSettings.autonomousSpendCeilingPaise != null && (
              <span className="opacity-75 font-normal">
                (≤ ₹{(autonomousSettings.autonomousSpendCeilingPaise / 100).toLocaleString('en-IN')})
              </span>
            )}
          </button>
          <ThemeToggle />
          <Link href="/" className="text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-blue-400 transition-colors bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-slate-700 px-4 py-2 rounded-lg">Exit Store</Link>
        </div>
      </header>

      <AutonomousAgentSettingsModal
        isOpen={isAutonomousModalOpen}
        onClose={() => setIsAutonomousModalOpen(false)}
        initialSettings={autonomousSettings}
        onUpdated={(updated) => setAutonomousSettings(updated)}
      />

      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-6 pb-20">
          {error && (
            <div className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-200">
              <span className="font-semibold">Chat Error:</span> {error.message}
            </div>
          )}

          <div className="bg-indigo-50 border border-indigo-100 text-indigo-800 text-sm p-4 rounded-xl mb-8 flex gap-3">
            <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <strong>Pro Tip:</strong> Tell the agent your <strong>budget</strong>, <strong>category</strong> (e.g. keyboard), and <strong>specific requirements</strong> (e.g. wireless, mechanical). It will search the catalog and prepare a policy-checked offer for your approval.
            </div>
          </div>

          {campaignOffers.length > 0 && (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Merchant recovery offer</p>
              <div className="mt-3 space-y-3">
                {campaignOffers.map((offer) => (
                  <div key={offer.id} className="rounded-xl border border-emerald-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-bold text-slate-900">{offer.campaignTitle}</h2>
                        <p className="mt-1 text-xs text-slate-600">Expires {new Date(offer.expiresAt).toLocaleString('en-IN')}</p>
                      </div>
                      <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
                        Save {(offer.discount / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                      </span>
                    </div>
                    <ul className="mt-3 space-y-1 text-xs text-slate-600">
                      {offer.items.map((item) => (
                        <li key={item.id} className="flex justify-between gap-3">
                          <span>{item.name} × {item.quantity}</span>
                          <span>{(item.unitPrice * item.quantity / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                      <span className="text-sm font-bold text-slate-900">{(offer.total / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                      <OfferCheckoutControl
                        offerId={offer.id}
                        label="Accept offer & pay"
                        merchantName="TechNest"
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {messages.map((m, mIdx) => {
            const text = m.parts.filter((part) => part.type === 'text').map((part) => part.text).join('')
            const toolParts = m.parts
              .filter((part) => part.type.startsWith('tool-'))
              .map((part) => part as unknown as ToolInvocationView)
            const hasVisibleTool = toolParts.some((toolInvocation) => {
              const result = Array.isArray(toolInvocation.output) ? undefined : toolInvocation.output
              if (getToolName(toolInvocation) === 'propose_bundle_addon' && result?.skipped) return false
              return true;
            });
            if (!text && !hasVisibleTool && m.role !== 'user') return null;

            return (
            <div key={`${m.id}-${mIdx}`} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl p-4 shadow-sm transition-colors ${
                m.role === 'user'
                  ? 'bg-indigo-600 dark:bg-blue-600 text-white rounded-br-none'
                  : 'bg-white dark:bg-[#1E2B4D]/95 dark:backdrop-blur-md border border-slate-200 dark:border-[#3B4D78]/80 text-slate-800 dark:text-slate-100 rounded-bl-none shadow-md dark:shadow-blue-900/10'
              }`}>
                {text && (
                  <>
                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{renderInlineBold(text.replace('__BASKET_ACTIONS__', ''))}</p>
                    {text.includes('__BASKET_ACTIONS__') && (
                      <div className="mt-4 flex flex-col gap-2 w-full md:w-3/4">
                        <button onClick={() => sendMessage({ text: 'What discounts are available?' })} className="text-left px-4 py-2 text-sm bg-white dark:bg-[#151f38] border border-slate-200 dark:border-[#2b3a5e] hover:bg-slate-50 dark:hover:bg-[#1a2644] rounded-lg transition-colors text-slate-700 dark:text-blue-100 shadow-sm flex items-center justify-between group">
                          <span>💰 View discounts</span>
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                        </button>
                        <button onClick={() => sendMessage({ text: 'Can you compare options?' })} className="text-left px-4 py-2 text-sm bg-white dark:bg-[#151f38] border border-slate-200 dark:border-[#2b3a5e] hover:bg-slate-50 dark:hover:bg-[#1a2644] rounded-lg transition-colors text-slate-700 dark:text-blue-100 shadow-sm flex items-center justify-between group">
                          <span>⚖️ Compare options</span>
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                        </button>
                        <button onClick={() => sendMessage({ text: 'What are the bundle options?' })} className="text-left px-4 py-2 text-sm bg-white dark:bg-[#151f38] border border-slate-200 dark:border-[#2b3a5e] hover:bg-slate-50 dark:hover:bg-[#1a2644] rounded-lg transition-colors text-slate-700 dark:text-blue-100 shadow-sm flex items-center justify-between group">
                          <span>🎁 See bundle options</span>
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                        </button>
                        <button onClick={() => sendMessage({ text: 'Proceed to checkout' })} className="text-left px-4 py-2 text-sm bg-indigo-600 dark:bg-blue-600 text-white hover:bg-indigo-700 dark:hover:bg-blue-700 border border-indigo-700 dark:border-blue-700 rounded-lg transition-colors shadow-sm font-medium flex items-center justify-between group">
                          <span>💳 Proceed to checkout</span>
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* Render Tool Invocations inside the Chat! */}
                {toolParts.map((toolInvocation, toolIdx) => {
                  const toolName = getToolName(toolInvocation)
                  const toolKey = `${toolInvocation.toolCallId || 'tool'}-${toolIdx}`
                  const result = Array.isArray(toolInvocation.output) ? undefined : toolInvocation.output
                  if (toolInvocation.state !== 'output-available') {
                    return (
                      <div key={toolKey} className="mt-2 text-xs font-mono text-slate-400 flex items-center gap-2">
                        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Agent is using tool: {toolName}...
                      </div>
                    )
                  }

                  // Render search_catalog results as selectable sliding cards.
                  // The tool now returns { intentUsed, products }, not a bare
                  // array, so the count comes off result.products.
                  // Render inline cart for basket tools
                  if (toolName === 'show_basket') {
                    if (!result || !result.items || result.items.length === 0) {
                      return <div key={toolKey} className="mt-4 p-4 border border-slate-200 bg-white rounded-xl text-center text-sm text-slate-500 shadow-sm">Your basket is empty.</div>
                    }

                    const cartTotal = result.items.reduce((sum, item) => sum + (item.product.price * item.quantity), 0)

                    return (
                      <div key={toolKey} className="mt-4 border border-indigo-100 bg-white rounded-xl overflow-hidden shadow-sm">
                        <div className="bg-indigo-50 px-4 py-3 flex justify-between items-center border-b border-indigo-100">
                          <span className="font-semibold text-indigo-900 flex items-center gap-2">
                            <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                            </svg>
                            Your Basket
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await clearCart()
                                  setMessages(prev => [...prev, { id: `${Date.now()}-cart-cleared`, role: 'assistant', parts: [{ type: 'text', text: 'I have cleared your shopping basket. How can I assist you next?' }] }])
                                } catch (e) {
                                  console.error('Failed to clear cart:', e)
                                }
                              }}
                              className="text-[11px] font-medium text-slate-500 hover:text-red-600 dark:hover:text-red-400 transition-colors underline underline-offset-2 mr-1"
                            >
                              Clear
                            </button>
                            <span className="text-xs font-bold bg-white px-2 py-1 rounded-full text-indigo-700 border border-indigo-200">
                              {result.items.reduce((sum, item) => sum + item.quantity, 0)} items
                            </span>
                          </div>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {result.items.map((item, itemIdx) => (
                            <div key={`${item.id}-${itemIdx}`} className="p-4 flex gap-4 hover:bg-slate-50 transition-colors">
                              {item.product.imageUrl ? (
                                <Image src={item.product.imageUrl} alt={item.product.name} width={64} height={64} unoptimized className="w-16 h-16 rounded-lg object-cover border border-slate-100 shadow-sm" />
                              ) : (
                                <div className="w-16 h-16 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 border border-slate-200">
                                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                </div>
                              )}
                              <div className="flex-1 flex flex-col justify-center">
                                <h4 className="text-sm font-semibold text-slate-900 leading-tight">{item.product.name}</h4>
                                <div className="mt-1 flex justify-between items-center text-sm">
                                  <span className="text-slate-500 font-medium">Qty: {item.quantity}</span>
                                  <span className="font-bold text-slate-900">{(item.product.price * item.quantity / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex justify-between items-center">
                          <span className="text-sm font-medium text-slate-600">Subtotal</span>
                          <span className="font-bold text-slate-900 text-base">{(cartTotal / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                        </div>
                      </div>
                    )
                  }

                  if (toolName === 'clear_basket') {
                    return (
                      <div key={toolKey} className="mt-4 p-3 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 rounded-xl text-xs font-medium border border-emerald-200 dark:border-emerald-800/30 flex items-center gap-2">
                        <span className="text-base">🗑️</span>
                        <span>{result?.message || 'Your shopping basket has been cleared.'}</span>
                      </div>
                    )
                  }

                  if (toolName === 'search_catalog') {
                    const products = result?.products ?? []
                    const searchedFor =
                      toolInvocation.input?.query ??
                      toolInvocation.input?.category ??
                      result?.intentUsed?.category.join(', ')

                    return (
                      <div key={toolKey} className="mt-2">
                        <div className="text-xs font-mono text-emerald-600 flex items-center gap-2">
                          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>
                            {searchedFor ? <>Searched catalog for &ldquo;{searchedFor}&rdquo;. </> : 'Searched catalog. '}
                            Found {products.length} items.
                            {result?.intentUsed?.maximumAmount != null && (
                              <> Budget: {(result.intentUsed.maximumAmount / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}.</>
                            )}
                          </span>
                        </div>
                        {result?.intentUsed?.pendingBudgetIncrease && (() => {
                          const pendingIncrease = result.intentUsed.pendingBudgetIncrease
                          return (
                            <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2 shadow-xs">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-amber-800">Budget Ceiling Locked:</span>
                                <span>
                                  Request to change budget to {pendingIncrease === 'UNLIMITED' ? 'no limit' : `₹${(Number(pendingIncrease) / 100).toLocaleString('en-IN')}`} requires customer authorization.
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={async () => {
                                  const targetAmount = pendingIncrease === 'UNLIMITED' ? null : Number(pendingIncrease)
                                  await fetch('/api/agent/budget', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ budgetAmount: targetAmount }),
                                  })
                                  sendMessage({ text: 'I have confirmed and authorized the budget update. Please show available products.' })
                                }}
                                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-medium text-xs transition-colors cursor-pointer"
                              >
                                Authorize Budget Update
                              </button>
                            </div>
                          )
                        })()}
                        {products.length > 0 && (
                          <div className="mt-3">
                            <ProductCards
                              products={products}
                              customerId={customerId}
                              merchantId={merchantId}
                              onSelect={(product) => {
                                // Selection is already a successful server action in
                                // ProductCards. Do not send a second LLM request just
                                // to confirm it: that made a working Select button
                                // appear to hang whenever the provider was slow.
                                setMessages((previous) => [
                                  ...previous,
                                  {
                                    id: `${Date.now()}-basket`,
                                    role: 'assistant',
                                    parts: [{
                                      type: 'text',
                                      text: `${product.name} has been added to your basket. __BASKET_ACTIONS__`,
                                    }],
                                  },
                                ])
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )
                  }

                  // Render Sliding Cards for propose_products tool
                  if (toolName === 'propose_products' && result?.products) {
                    return (
                      <div key={toolKey} className="mt-4">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Recommended Products</p>
                        <div className="flex overflow-x-auto gap-4 pb-4 snap-x">
                          {result.products.map((p, pIdx) => (
                            <div key={`${p.id}-${pIdx}`} className="shrink-0 w-64 bg-slate-50 border border-slate-200 rounded-xl overflow-hidden snap-start hover:border-indigo-300 transition-colors">
                              {p.imageUrl ? (
                                <Image src={p.imageUrl} alt={p.name} width={400} height={128} unoptimized className="w-full h-32 object-cover" />
                              ) : (
                                <div className="w-full h-32 bg-slate-200 flex items-center justify-center text-slate-400">
                                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                </div>
                              )}
                              <div className="p-4">
                                <h4 className="font-bold text-slate-900 truncate">{p.name}</h4>
                                <p className="mt-1 text-xs text-slate-600">{p.warrantyYears}-year warranty · {p.deliveryDays}-day delivery</p>
                                <div className="mt-2 flex flex-wrap gap-1">{Object.entries(p.attributes || {}).slice(0, 3).map(([key, value], aIdx) => <span key={`${key}-${aIdx}`} className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600">{key}: {String(value)}</span>)}</div>
                                <div className="mt-2 flex items-center justify-between">
                                  <span className="font-semibold text-indigo-600">{(p.price / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                                  <span className={`text-xs px-2 py-1 rounded-full ${p.inventory > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                    {p.inventory > 0 ? 'In Stock' : 'Out of Stock'}
                                  </span>
                                </div>
                                <button type="button" onClick={async () => { let text = `${p.name} has been added to your basket. __BASKET_ACTIONS__`; try { await addProductToCart(p.id) } catch (error) { text = error instanceof Error ? error.message : `${p.name} could not be added to your basket.` } setMessages(prev => [...prev, { id: `${Date.now()}-basket`, role: 'assistant', parts: [{ type: 'text', text }] }]) }} className="mt-3 w-full rounded-lg border border-indigo-200 bg-white py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">Add to basket</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  }

                  // Render the interactive cross-sell card for propose_bundle_addon.
                  if (toolName === 'propose_bundle_addon') {
                    if (result?.skipped) {
                      return (
                        <div key={toolKey} className="mt-3 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                          <span>🎁</span>
                          <span>{result.reason || 'All eligible bundle discounts have already been applied to your current items.'}</span>
                        </div>
                      )
                    }

                    const badgeAction = toPolicyBadgeAction(toolInvocation.toolCallId, toolName, result?.policyResult)

                    if (result?.error) {
                      // This tool's only error return is the policy refusal at
                      // route.ts:316, where error === policyResult.reason. So when
                      // the policyResult came through, the badge supersedes the
                      // hand-rolled notice: same sentence, plus the Details
                      // expander showing the raw checked/limit/requested/passed
                      // evaluation. The div stays as the fallback for an error
                      // arriving without one.
                      if (badgeAction) {
                        return <div key={toolKey} className="mt-4"><PolicyBadge action={badgeAction} /></div>
                      }
                      return <div key={toolKey} className="mt-4 p-3 bg-amber-50 text-amber-800 rounded-lg text-sm border border-amber-200">Bundle blocked by policy: {result.error}</div>
                    }

                    const { recommendationId, cartId, addonProductId, addon, pairedWith, discountPercent, bundleSubtotal, bundleDiscount, bundleTotal } = result ?? {}
                    if (!recommendationId || !cartId || !addonProductId || !addon || !pairedWith || discountPercent == null || bundleSubtotal == null || bundleDiscount == null || bundleTotal == null) return null

                    return (
                      <div key={toolKey} className="mt-4">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Frequently bought together</p>
                        <BundleOfferCard
                          recommendationId={recommendationId}
                          cartId={cartId}
                          addonProductId={addonProductId}
                          addon={addon}
                          pairedWith={pairedWith}
                          discountPercent={discountPercent}
                          bundleSubtotal={bundleSubtotal}
                          bundleDiscount={bundleDiscount}
                          bundleTotal={bundleTotal}
                          onDismiss={() => setMessages(prev => [...prev, { id: `${Date.now()}-bundle-declined`, role: 'assistant', parts: [{ type: 'text', text: `No problem, I will leave the ${addon.name} out. Shall I put together your final offer?` }] }])}
                        />
                        {/* Shows which policy cleared this bundle's discount, and to youths limit. */}
                        {badgeAction && <div className="mt-3"><PolicyBadge action={badgeAction} /></div>}
                      </div>
                    )
                  }

                  if (toolName === 'propose_upsell') {
                    if (result?.skipped) {
                      return (
                        <div key={toolKey} className="mt-3 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                          <span>⚡</span>
                          <span>{result.reason || 'No upgrade products available for this item.'}</span>
                        </div>
                      )
                    }

                    const badgeAction = toPolicyBadgeAction(toolInvocation.toolCallId, toolName, result?.policyResult)

                    if (result?.error) {
                      if (badgeAction) {
                        return <div key={toolKey} className="mt-4"><PolicyBadge action={badgeAction} /></div>
                      }
                      return <div key={toolKey} className="mt-4 p-3 bg-amber-50 text-amber-800 rounded-lg text-sm border border-amber-200">Upsell blocked by policy: {result.error}</div>
                    }

                    const { recommendationId, cartId, upgradeProductId, upgrade, replaces, discountPercent, upsellSubtotal, upsellDiscount, upsellTotal } = result ?? {}
                    if (!recommendationId || !cartId || !upgradeProductId || !upgrade || !replaces || discountPercent == null || upsellSubtotal == null || upsellDiscount == null || upsellTotal == null) return null

                    return (
                      <div key={toolKey} className="mt-4">
                        <p className="text-xs font-semibold text-indigo-500 uppercase tracking-wider mb-2">Recommended Upgrade</p>
                        <UpsellOfferCard
                          recommendationId={recommendationId}
                          cartId={cartId}
                          upgradeProductId={upgradeProductId}
                          upgrade={upgrade}
                          replaces={replaces}
                          discountPercent={discountPercent}
                          upsellSubtotal={upsellSubtotal}
                          upsellDiscount={upsellDiscount}
                          upsellTotal={upsellTotal}
                          onDismiss={() => setMessages(prev => [...prev, { id: `${Date.now()}-upsell-declined`, role: 'assistant', parts: [{ type: 'text', text: `Got it, keeping your current selection.` }] }])}
                        />
                        {badgeAction && <div className="mt-3"><PolicyBadge action={badgeAction} /></div>}
                      </div>
                    )
                  }

                  // Render Checkout Button for a policy-checked checkout offer.
                  if (toolName === 'generate_checkout_offer') {
                    const badgeAction = toPolicyBadgeAction(toolInvocation.toolCallId, toolName, result?.policyResult)

                    if (result?.error) {
                      // Two unrelated failures land here. route.ts:366 is a policy
                      // refusal -- not a system error, despite the label below -- and
                      // the badge states it precisely, naming the limit it breached.
                      // route.ts:373 is a genuine exception out of
                      // createOfferForCustomer, and on that path policyResult *passed*;
                      // a green "Policy Check Passed" beside a red failure would read
                      // as reassurance, so that case keeps the plain error notice.
                      if (badgeAction?.status === 'BLOCKED') {
                        return <div key={toolKey} className="mt-4"><PolicyBadge action={badgeAction} /></div>
                      }
                      return <div key={toolKey} className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-200">System Error: {result.error}</div>
                    }

                    const offer = result?.offer
                    const offerId = result?.offerId
                    if (!offer || !offerId) return null

                    return (
                      <div key={toolKey} className="mt-6">
                        <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-5 shadow-sm">
                          <div className="flex items-center gap-2 text-emerald-800 font-bold mb-4">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Final Offer Generated
                          </div>
                          <div className="space-y-2 mb-4">
                            {offer.items.map((i, itemIdx) => (
                              <div key={`${i.id}-${itemIdx}`} className="flex justify-between text-sm text-emerald-900">
                                <span>{i.product.name}</span>
                                <span>{(i.unitPrice / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                              </div>
                            ))}
                            <div className="border-t border-emerald-200 pt-2 flex justify-between text-sm font-semibold text-emerald-900">
                              <span>Subtotal</span>
                              <span>{(offer.subtotal / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                            </div>
                            {offer.discount > 0 && (
                              <div className="flex justify-between text-sm font-semibold text-red-600">
                                <span>Discount</span>
                                <span>-{(offer.discount / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                              </div>
                            )}
                            <div className="border-t border-emerald-200 pt-2 flex justify-between text-lg font-bold text-emerald-900">
                              <span>Total</span>
                              <span>{(offer.total / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                            </div>

                            <details className="mt-4 pt-2 border-t border-emerald-200 text-xs text-emerald-800">
                              <summary className="cursor-pointer font-semibold hover:text-emerald-900 transition-colors">
                                Why this price?
                              </summary>
                              <div className="mt-2 space-y-1 bg-emerald-100/50 p-2 rounded">
                                <p><strong>Cart verified:</strong> {offer.items.length} item(s) locked</p>
                                {result?.policyResult && (
                                  <>
                                    <p><strong>Discount policy:</strong> {result.policyResult.reason}</p>
                                    <p><strong>Limit applied:</strong> {result.policyResult.requested}% (Max: {result.policyResult.allowed}%)</p>
                                  </>
                                )}
                                <p><strong>Expires:</strong> {new Date(offer.expiresAt || Date.now() + 15 * 60000).toLocaleTimeString()}</p>
                                <p><strong>Requirement:</strong> Requires explicit customer acceptance signature</p>
                              </div>
                            </details>
                          </div>
                          <OfferCheckoutControl
                            offerId={offerId}
                            label={`Accept offer & pay ${(offer.total / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })} with Razorpay`}
                            merchantName="TechNest (Agent Negotiated)"
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                          />
                        </div>
                        {/* Sits outside the emerald card so an emerald-tinted badge keeps
                            its contrast, and so the policy verdict reads as a statement
                            about the offer rather than part of the offer's own pitch. */}
                        {badgeAction && <div className="mt-3"><PolicyBadge action={badgeAction} /></div>}
                      </div>
                    )
                  }

                  // Render the Razorpay checkout button once the server has
                  // created a real Razorpay order. Only the internal order id,
                  // Razorpay's order id, and the amount cross the boundary --
                  // the secret key stays server-side in the chat route.
                  if (toolName === 'generate_checkout_link') {
                    if (result?.status === 'AWAITING_CUSTOMER_CONFIRMATION') {
                      return (
                        <div key={toolKey} className="mt-4 p-3 bg-amber-50 text-amber-900 rounded-lg text-sm border border-amber-200 flex items-center gap-2">
                          <span className="font-semibold">Action Required:</span>
                          <span>{result.message || 'Please review and accept the offer card above to begin checkout.'}</span>
                        </div>
                      )
                    }

                    if (result?.error) {
                      return <div key={toolKey} className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-200">{result.error}</div>
                    }

                    const { orderId, razorpayOrderId, amount, currency } = result ?? {}
                    if (!orderId || !razorpayOrderId || amount == null) return null

                    return (
                      <div key={toolKey} className="mt-4">
                        {autonomousSettings.enabled && (
                          <div className="mb-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-300 text-xs flex items-center gap-2 font-medium">
                            <span className="text-base">⚡</span>
                            <div>
                              <span className="font-bold">Autonomous Checkout Pre-Authorized:</span> Offer validated against your ₹{(Number(autonomousSettings.autonomousSpendCeilingPaise ?? 0) / 100).toLocaleString('en-IN')} spend ceiling. Razorpay order established.
                            </div>
                          </div>
                        )}
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Secure checkout</p>
                        <CheckoutButton orderId={orderId} razorpayOrderId={razorpayOrderId} amount={amount} currency={currency} />
                      </div>
                    )
                  }

                  return null
                })}
              </div>
            </div>
            );
          })}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-none p-4 shadow-sm flex items-center gap-2">
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
              </div>
            </div>
          )}

          {/* Rendered as a UI-only notice, not appended to `messages` --
              it's a client-side cooldown state, not part of the
              conversation history the server persists. */}
          {rateLimited && (
            <div className="flex justify-start">
              <div className="max-w-[85%] md:max-w-[75%] rounded-2xl rounded-bl-none p-4 shadow-sm bg-amber-50 border border-amber-200 text-amber-800 flex items-start gap-2">
                <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86l-8.18 14.14A1.5 1.5 0 003.5 20h17a1.5 1.5 0 001.39-2L13.71 3.86a1.5 1.5 0 00-2.42 0z" />
                </svg>
                <p className="text-[15px] leading-relaxed font-medium">{RATE_LIMIT_MESSAGE}</p>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      <footer className="bg-white/80 dark:bg-[#0B1221]/80 backdrop-blur-md border-t border-slate-200 dark:border-gray-800 p-4 transition-colors z-10">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={onFormSubmit} className="flex gap-3">
            <input
              value={input || ''}
              onChange={handleInputChange}
              placeholder={rateLimited ? 'Please wait a moment before sending another message...' : 'E.g. I need a mechanical keyboard under 8000 rupees...'}
              className="flex-1 border border-slate-300 dark:border-[#3B4D78]/80 rounded-xl px-5 py-4 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-blue-400 shadow-sm bg-white dark:bg-[#1E2B4D]/95 dark:backdrop-blur-md disabled:bg-slate-50 dark:disabled:bg-[#151f38] disabled:text-slate-400 transition-colors"
              disabled={isLoading || rateLimited}
            />
            <button
              type="submit"
              disabled={isLoading || rateLimited || !input?.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl px-6 font-semibold transition-colors shadow-sm flex flex-col justify-center items-center"
            >
              <svg className="w-6 h-6 transform rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>
          <div className="text-center mt-3 text-xs text-slate-400">
            Powered by Groq & Razorpay
          </div>
        </div>
      </footer>
    </div>
  )
}
