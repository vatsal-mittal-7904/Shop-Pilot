'use client'

import Link from 'next/link'

export default function MerchantPortalSelector() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-8 font-sans selection:bg-indigo-100">
      
      <div className="text-center mb-12">
        <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight mb-4">
          Merchant<span className="text-indigo-600">OS</span> Hub
        </h1>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto">
          Welcome back, Admin. Where would you like to go today?
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl w-full">
        
        {/* Product Adder */}
        <Link href="/merchant/products" className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all group relative overflow-hidden flex flex-col h-full cursor-pointer">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-indigo-500 transform origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300"></div>
          
          <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center mb-6 text-indigo-600">
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Product Catalog</h2>
          <p className="text-slate-600 mb-8 flex-1">
            Manually add products to your catalog. The AI agent will automatically detect them to create bundles and upsells.
          </p>
          
          <div className="mt-auto inline-flex items-center text-indigo-600 font-semibold group-hover:text-indigo-700">
            Go to Product Adder
            <svg className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </div>
        </Link>

        {/* AI Growth Dashboard */}
        <Link href="/merchant" className="bg-slate-900 rounded-3xl p-8 shadow-sm border border-slate-800 hover:border-emerald-300 hover:shadow-2xl transition-all group relative overflow-hidden flex flex-col h-full cursor-pointer">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-600 rounded-bl-full opacity-10"></div>
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 to-teal-500 transform origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300"></div>
          
          <div className="w-14 h-14 bg-slate-800 rounded-2xl flex items-center justify-center mb-6 text-emerald-400 relative z-10">
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          
          <h2 className="text-2xl font-bold text-white mb-3 relative z-10">AI Growth Dashboard</h2>
          <p className="text-slate-400 mb-8 flex-1 relative z-10">
            Monitor revenue, approve dynamic AI campaigns (like abandoned carts and cross-sells), and review the system audit trail.
          </p>
          
          <div className="mt-auto inline-flex items-center text-emerald-400 font-semibold group-hover:text-emerald-300 relative z-10">
            Go to AI Dashboard
            <svg className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </div>
        </Link>

        {/* AI Performance ROI */}
        <Link href="/merchant/analytics" className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 hover:border-violet-300 hover:shadow-md transition-all group relative overflow-hidden flex flex-col h-full cursor-pointer">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-violet-400 to-fuchsia-500 transform origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300"></div>

          <div className="w-14 h-14 bg-violet-50 rounded-2xl flex items-center justify-center mb-6 text-violet-600">
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
            </svg>
          </div>

          <h2 className="text-2xl font-bold text-slate-900 mb-3">AI Performance ROI</h2>
          <p className="text-slate-600 mb-8 flex-1">
            See what the agent actually earned: revenue generated, carts recovered, bundle upsell conversion, and margins protected by policy.
          </p>

          <div className="mt-auto inline-flex items-center text-violet-600 font-semibold group-hover:text-violet-700">
            Go to Analytics
            <svg className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </div>
        </Link>

      </div>
    </div>
  )
}
