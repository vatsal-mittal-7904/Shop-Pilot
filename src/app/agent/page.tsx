'use client'

import { useChat } from 'ai/react'
import { useRef, useEffect, useState } from 'react'
import Link from 'next/link'
import { addProductToCart } from '@/backend/actions/commerce'
import { startCheckout } from '@/backend/actions/payment'

type ProductCard = { id: string; name: string; price: number; inventory: number; imageUrl?: string | null; warrantyYears: number; deliveryDays: number; attributes: Record<string, unknown> }
type CheckoutOffer = { items: Array<{ id: string; unitPrice: number; product: ProductCard }>; subtotal: number; discount: number; total: number }
type ToolInvocationView = { toolCallId: string; state: string; toolName: string; args?: { query?: string }; result?: { products?: ProductCard[]; offer?: CheckoutOffer; offerId?: string; error?: string } | ProductCard[] }
type RazorpayOptions = { key: string; amount: number; currency: string; name: string; description: string; order_id: string; handler: (response: { razorpay_payment_id: string }) => void; prefill: { name: string; email: string } }

export default function AgentSimulation() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, setMessages } = useChat({
    api: '/api/chat',
    maxSteps: 5, // Allow the agent to call tools automatically in a loop
  })

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [checkingOut, setCheckingOut] = useState(false)

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
          content: 'Hello! I am the TechNest AI Agent. How can I help you today? Please let me know what kind of product you are looking for, your requirements, and your budget.'
        }
      ])
    }
  }, [messages.length, setMessages])

  const handleCheckout = async (offerId: string) => {
    setCheckingOut(true)
    try {
      const { razorpayOrder } = await startCheckout(offerId)
      
      const options: RazorpayOptions = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || 'rzp_test_dummy',
        amount: Number(razorpayOrder.amount),
        currency: 'INR',
        name: 'TechNest (Agent Negotiated)',
        description: 'AI Autonomous Purchase',
        order_id: razorpayOrder.id,
        handler: function (response: { razorpay_payment_id: string }) {
          alert(`Payment submitted. We are waiting for secure Razorpay webhook verification. Payment ID: ${response.razorpay_payment_id}`)
          setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: 'Your payment was submitted. I will only confirm the order after the Razorpay webhook verifies it.' }])
        },
        prefill: {
          name: 'AI Agent Purchaser',
          email: localStorage.getItem('customer_email') || 'agent@buyer.com'
        }
      }
      
      const Razorpay = (window as unknown as { Razorpay: new (options: RazorpayOptions) => { open: () => void } }).Razorpay
      const rzp = new Razorpay(options)
      rzp.open()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Checkout failed.')
    }
    setCheckingOut(false)
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 font-sans selection:bg-indigo-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">TechNest AI Sales Agent</h1>
            <p className="text-xs text-emerald-600 font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Online & Ready to negotiate
            </p>
          </div>
        </div>
        <Link href="/" className="text-sm font-medium text-slate-500 hover:text-indigo-600 transition-colors bg-slate-100 hover:bg-indigo-50 px-4 py-2 rounded-lg">Exit Store</Link>
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-6 pb-20">
          
          <div className="bg-indigo-50 border border-indigo-100 text-indigo-800 text-sm p-4 rounded-xl mb-8 flex gap-3">
            <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <strong>Pro Tip:</strong> To get the best results, tell the agent your <strong>budget</strong>, <strong>category</strong> (e.g. keyboard), and <strong>specific requirements</strong> (e.g. wireless, mechanical). It will search the catalog and negotiate the best deal!
            </div>
          </div>

          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl p-4 shadow-sm ${
                m.role === 'user' 
                  ? 'bg-indigo-600 text-white rounded-br-none' 
                  : 'bg-white border border-slate-200 text-slate-800 rounded-bl-none'
              }`}>
                {m.content && <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{m.content}</p>}
                
                {/* Render Tool Invocations inside the Chat! */}
                {m.toolInvocations?.map((rawToolInvocation: unknown) => {
                  const toolInvocation = rawToolInvocation as ToolInvocationView
                  const result = Array.isArray(toolInvocation.result) ? undefined : toolInvocation.result
                  if (toolInvocation.state !== 'result') {
                    return (
                      <div key={toolInvocation.toolCallId} className="mt-2 text-xs font-mono text-slate-400 flex items-center gap-2">
                        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Agent is using tool: {toolInvocation.toolName}...
                      </div>
                    )
                  }

                  // Render search_catalog result text
                  if (toolInvocation.toolName === 'search_catalog') {
                    return (
                      <div key={toolInvocation.toolCallId} className="mt-2 text-xs font-mono text-emerald-600 flex items-center gap-2">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Searched catalog for &ldquo;{toolInvocation.args?.query}&rdquo;. Found {Array.isArray(toolInvocation.result) ? toolInvocation.result.length : 0} items.
                      </div>
                    )
                  }

                  // Render Sliding Cards for propose_products tool
                  if (toolInvocation.toolName === 'propose_products' && result?.products) {
                    return (
                      <div key={toolInvocation.toolCallId} className="mt-4">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Recommended Products</p>
                        <div className="flex overflow-x-auto gap-4 pb-4 snap-x">
                          {result.products.map((p) => (
                            <div key={p.id} className="shrink-0 w-64 bg-slate-50 border border-slate-200 rounded-xl overflow-hidden snap-start hover:border-indigo-300 transition-colors">
                              {p.imageUrl ? (
                                <img src={p.imageUrl} alt={p.name} className="w-full h-32 object-cover" />
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
                                <div className="mt-2 flex flex-wrap gap-1">{Object.entries(p.attributes || {}).slice(0, 3).map(([key, value]) => <span key={key} className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600">{key}: {String(value)}</span>)}</div>
                                <div className="mt-2 flex items-center justify-between">
                                  <span className="font-semibold text-indigo-600">{(p.price / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                                  <span className={`text-xs px-2 py-1 rounded-full ${p.inventory > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                    {p.inventory > 0 ? 'In Stock' : 'Out of Stock'}
                                  </span>
                                </div>
                                <button type="button" onClick={async () => { await addProductToCart(p.id); setMessages(prev => [...prev, { id: `${Date.now()}-basket`, role: 'assistant', content: `${p.name} has been added to your basket. Ask me to compare options, negotiate, or create your final offer.` }]) }} className="mt-3 w-full rounded-lg border border-indigo-200 bg-white py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">Add to basket</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  }

                  // Render Checkout Button for a policy-checked checkout offer.
                  if (toolInvocation.toolName === 'generate_checkout_offer') {
                    if (result?.error) {
                      return <div key={toolInvocation.toolCallId} className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-200">System Error: {result.error}</div>
                    }

                    const offer = result?.offer
                    const offerId = result?.offerId
                    if (!offer || !offerId) return null

                    return (
                      <div key={toolInvocation.toolCallId} className="mt-6 border border-emerald-200 bg-emerald-50 rounded-xl p-5 shadow-sm">
                        <div className="flex items-center gap-2 text-emerald-800 font-bold mb-4">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Final Offer Generated
                        </div>
                        <div className="space-y-2 mb-4">
                          {offer.items.map((i) => (
                            <div key={i.id} className="flex justify-between text-sm text-emerald-900">
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
                        </div>
                        <button 
                          onClick={() => handleCheckout(offerId)}
                          disabled={checkingOut}
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                        >
                          {checkingOut ? 'Processing...' : `Pay ${(offer.total / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })} with Razorpay`}
                        </button>
                      </div>
                    )
                  }

                  return null
                })}
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-none p-4 shadow-sm flex items-center gap-2">
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 p-4">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              value={input}
              onChange={handleInputChange}
              placeholder="E.g. I need a mechanical keyboard under 8000 rupees..."
              className="flex-1 border border-slate-300 rounded-xl px-5 py-4 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm bg-white"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl px-6 font-semibold transition-colors shadow-sm flex flex-col justify-center items-center"
            >
              <svg className="w-6 h-6 transform rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>
          <div className="text-center mt-3 text-xs text-slate-400">
            Powered by Gemini 1.5 Pro & Razorpay
          </div>
        </div>
      </footer>
      
      <script src="https://checkout.razorpay.com/v1/checkout.js" async></script>
    </div>
  )
}
