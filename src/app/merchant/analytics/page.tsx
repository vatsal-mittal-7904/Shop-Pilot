import { requireMerchant } from '@/backend/auth/session'
import { getMerchantROI } from '@/backend/actions/analytics'
import { MetricCard } from './_components/MetricCard'
import { ImpactBar } from './_components/ImpactBar'
import Link from 'next/link'

export default async function MerchantAnalyticsPage() {
  const { merchant } = await requireMerchant()
  const roiData = await getMerchantROI(merchant.id)

  return (
    <div className="min-h-screen bg-transparent pt-24 pb-12 transition-colors text-slate-800 dark:text-slate-200 font-sans">
      <main className="max-w-6xl mx-auto px-6 lg:px-8">
        
        <div className="mb-6">
          <Link href="/merchant" className="inline-flex items-center text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors">
            <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Dashboard
          </Link>
        </div>

        <div className="mb-10">
          <h1 className="text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">AI Performance ROI</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">Recovery revenue includes only paid orders attributable to issued recovery offers; cross-sell and upsell metrics are reported separately.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
          <MetricCard
            title="Total Revenue Generated"
            value={(roiData.totalRevenueGenerated / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
            description="Overall merchant revenue"
            accentColor="emerald"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />

          <MetricCard
            title="Abandoned Carts Recovered"
            value={roiData.abandonedCartsRecovered.toLocaleString()}
            description="Paid recovery-offer orders only"
            accentColor="sky"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            }
          />

          <MetricCard
            title="Cross-Sell Paid Rate"
            value={roiData.crossSellTotal === 0 ? "—" : `${roiData.crossSellPaidRate.toFixed(1)}%`}
            description={roiData.crossSellTotal === 0 ? "No cross-sells yet" : `${roiData.crossSellAccepted} accepted (+${(roiData.crossSellIncrementalRevenue / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })})`}
            accentColor="indigo"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            }
          />

          <MetricCard
            title="Upsell Paid Rate"
            value={roiData.upsellTotal === 0 ? "—" : `${roiData.upsellPaidRate.toFixed(1)}%`}
            description={roiData.upsellTotal === 0 ? "No upsells yet" : `${roiData.upsellAccepted} accepted (+${(roiData.upsellIncrementalRevenue / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })})`}
            accentColor="rose"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            }
          />

          <MetricCard
            title="Discount Policy Blocks"
            value={roiData.blockedDiscountPolicyRequests.toLocaleString()}
            description="Requests stopped for exceeding the merchant discount limit"
            accentColor="amber"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            }
          />
        </div>

        <ImpactBar
          aiRevenue={roiData.aiRecoveredRevenue}
          totalRevenue={roiData.totalRevenueGenerated}
        />
      </main>
    </div>
  )
}
