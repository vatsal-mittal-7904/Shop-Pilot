'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  approveOpportunity,
  getMerchantDashboardData,
  approveCampaign,
  rejectCampaign,
  modifyCampaign,
  generateCampaigns,
  runCartSweeper,
} from '@/backend/actions/merchant'

type DashboardData = Awaited<ReturnType<typeof getMerchantDashboardData>>
type Opportunity = DashboardData['opportunities'][number]
type CampaignItem = DashboardData['campaigns'][number]

const CAMPAIGN_STATUS_STYLES: Record<string, string> = {
  PROPOSED: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-rose-100 text-rose-700',
  COMPLETED: 'bg-slate-200 text-slate-700',
}

export default function MerchantDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState<string | null>(null)

  const [actingCampaignId, setActingCampaignId] = useState<string | null>(null)
  const [modifyingId, setModifyingId] = useState<string | null>(null)
  const [draftDiscount, setDraftDiscount] = useState<string>('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [sweeping, setSweeping] = useState(false)

  const refreshData = async () => {
    const res = await getMerchantDashboardData()
    setData(res)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshData().then(() => setLoading(false))
  }, [])

  const handleExecute = async (opp: Opportunity) => {
    setExecuting(opp.id)
    await approveOpportunity(opp.id)
    await refreshData()
    setExecuting(null)
  }

  const maxDiscount = data?.policies?.MAX_DISCOUNT_PERCENTAGE ?? null

  const openModify = (campaign: CampaignItem) => {
    setModifyingId(campaign.id)
    setDraftDiscount(campaign.discountPercent != null ? String(campaign.discountPercent) : '')
  }

  const cancelModify = () => {
    setModifyingId(null)
    setDraftDiscount('')
  }

  const handleApproveCampaign = async (campaign: CampaignItem) => {
    setActingCampaignId(campaign.id)
    await approveCampaign(campaign.id)
    await refreshData()
    setActingCampaignId(null)
  }

  const handleRejectCampaign = async (campaign: CampaignItem) => {
    setActingCampaignId(campaign.id)
    await rejectCampaign(campaign.id)
    await refreshData()
    setActingCampaignId(null)
  }

  const handleSaveModify = async (campaign: CampaignItem) => {
    const value = Number(draftDiscount)
    if (!Number.isFinite(value) || value < 0 || (maxDiscount != null && value > maxDiscount)) return
    setSavingId(campaign.id)
    await modifyCampaign(campaign.id, value)
    await refreshData()
    setSavingId(null)
    setModifyingId(null)
  }

  const handleGenerate = async () => {
    setGenerating(true)
    await generateCampaigns()
    await refreshData()
    setGenerating(false)
  }

  // getMerchantDashboardData() doesn't expose a top-level merchantId, but
  // runCartSweeper() doesn't need one from the client -- it resolves the
  // merchant from the authenticated session itself.
  const handleRunSweeper = async () => {
    setSweeping(true)
    await runCartSweeper()
    await refreshData()
    setSweeping(false)
  }

  if (loading || !data) return <div className="p-8 text-center text-slate-500">Loading MerchantOS AI...</div>

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans">
      <header className="bg-indigo-900 text-white px-8 py-5 flex items-center justify-between sticky top-0 z-10 shadow-md">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MerchantOS AI <span className="font-light text-indigo-300">| Growth Dashboard</span></h1>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/merchant/analytics" className="text-sm font-medium text-indigo-200 hover:text-white">Analytics</Link>
          <a href="/agent" className="text-sm font-medium text-indigo-200 hover:text-white">Simulate Agent Buyer</a>
          <div className="h-8 w-8 rounded-full bg-indigo-500 flex items-center justify-center font-bold">TN</div>
        </div>
      </header>

      <main className="p-8 max-w-[1600px] mx-auto space-y-8">
        
        {/* Overview Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-2">Total Revenue</h3>
            <div className="text-3xl font-bold text-slate-900">{(data.overview.totalRevenue / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</div>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-2">Paid Orders</h3>
            <div className="text-3xl font-bold text-slate-900">{data.overview.paidOrders} / {data.overview.totalOrders}</div>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 bg-gradient-to-br from-indigo-50 to-white">
            <h3 className="text-sm font-medium text-indigo-600 uppercase tracking-wider mb-2">AI-Recovered Revenue</h3>
            <div className="text-3xl font-bold text-indigo-900">{(data.overview.aiRecoveredRevenue / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</div>
            <div className="text-xs text-indigo-500 mt-1">From automated campaigns</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* AI Growth Opportunities */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              <h2 className="text-xl font-bold text-slate-900">AI Growth Opportunities</h2>
            </div>
            
            <div className="grid grid-cols-1 gap-4">
                {data.opportunities.map((opp) => (
                <div key={opp.id} className="bg-white p-6 rounded-2xl shadow-sm border border-indigo-100 hover:border-indigo-300 transition-colors">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">{opp.title}</h3>
                      <p className="text-slate-600 mt-1">{opp.reason}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-emerald-600 font-semibold uppercase">Est. Impact</div>
                      <div className="text-xl font-bold text-emerald-600">+{(opp.estimatedImpact / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</div>
                    </div>
                  </div>
                  <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                    <span className="text-sm text-slate-500">Action: {opp.type} · {opp.policy.reason}</span>
                    <button 
                      onClick={() => handleExecute(opp)}
                      disabled={executing === opp.id}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
                    >
                      {executing === opp.id ? 'Executing...' : 'Execute Approved Action'}
                    </button>
                  </div>
                </div>
              ))}
              {data.opportunities.length === 0 && (
                <div className="p-8 text-center bg-white border border-dashed border-slate-300 rounded-2xl text-slate-500">
                  No pending growth opportunities. Your AI Agent is fully optimized.
                </div>
              )}
            </div>

            <div className="mt-8 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <h2 className="text-xl font-bold text-slate-900">AI Campaigns</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRunSweeper}
                    disabled={sweeping}
                    title="Demo utility: immediately marks stale active carts as abandoned instead of waiting out the ABANDONED_CART_MINUTES policy window."
                    className="border border-indigo-300 bg-white hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed text-indigo-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    {sweeping ? 'Sweeping…' : 'Run Cart Sweeper'}
                  </button>
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
                  >
                    {generating ? 'Generating…' : 'Generate opportunities'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {data.campaigns.map((campaign) => {
                  const isModifying = modifyingId === campaign.id
                  const draftNumber = Number(draftDiscount)
                  const exceedsPolicy =
                    maxDiscount != null &&
                    draftDiscount !== '' &&
                    Number.isFinite(draftNumber) &&
                    draftNumber > maxDiscount
                  const saveDisabled =
                    draftDiscount === '' ||
                    !Number.isFinite(draftNumber) ||
                    draftNumber < 0 ||
                    exceedsPolicy ||
                    savingId === campaign.id

                  return (
                    <div key={campaign.id} className="bg-white p-6 rounded-2xl shadow-sm border border-indigo-100 hover:border-indigo-300 transition-colors">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold text-slate-900">{campaign.title}</h3>
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${CAMPAIGN_STATUS_STYLES[campaign.status] ?? 'bg-slate-100 text-slate-600'}`}>
                              {campaign.status}
                            </span>
                          </div>
                          <p className="text-slate-600 mt-1">{campaign.rationale}</p>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <div className="text-sm text-emerald-600 font-semibold uppercase">Est. Impact</div>
                          <div className="text-xl font-bold text-emerald-600">+{(campaign.estimatedImpact / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</div>
                          <div className="text-xs text-slate-500 mt-1">
                            Discount: {campaign.discountPercent != null ? `${campaign.discountPercent}%` : '—'}
                          </div>
                        </div>
                      </div>

                      {isModifying && (
                        <div className="mb-4 rounded-xl bg-slate-50 border border-slate-200 p-4">
                          <label className="block text-sm font-medium text-slate-700 mb-2">New discount (%)</label>
                          <div className="flex items-center gap-3">
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              value={draftDiscount}
                              onChange={(event) => setDraftDiscount(event.target.value)}
                              className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            />
                            <button
                              onClick={() => handleSaveModify(campaign)}
                              disabled={saveDisabled}
                              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:text-slate-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                            >
                              {savingId === campaign.id ? 'Saving…' : 'Save'}
                            </button>
                            <button onClick={cancelModify} className="text-sm font-medium text-slate-500 hover:text-slate-700">
                              Cancel
                            </button>
                          </div>
                          {exceedsPolicy && (
                            <p className="mt-2 text-sm text-rose-600">
                              Exceeds merchant policy — maximum discount is {maxDiscount}%.
                            </p>
                          )}
                        </div>
                      )}

                      <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                        <span className="text-sm text-slate-500">Type: {campaign.type}</span>
                        {campaign.status === 'PROPOSED' && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleApproveCampaign(campaign)}
                              disabled={actingCampaignId === campaign.id}
                              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
                            >
                              {actingCampaignId === campaign.id ? 'Working…' : 'Approve'}
                            </button>
                            <button
                              onClick={() => handleRejectCampaign(campaign)}
                              disabled={actingCampaignId === campaign.id}
                              className="bg-rose-50 hover:bg-rose-100 disabled:bg-rose-50 disabled:text-rose-300 text-rose-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => (isModifying ? cancelModify() : openModify(campaign))}
                              className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                            >
                              {isModifying ? 'Close' : 'Modify'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
                {data.campaigns.length === 0 && (
                  <div className="p-8 text-center bg-white border border-dashed border-slate-300 rounded-2xl text-slate-500">
                    No campaigns yet. Generate opportunities to get AI-proposed campaigns.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-8">
              <h2 className="text-xl font-bold text-slate-900 mb-4">Recent Orders</h2>
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500 uppercase font-semibold">
                    <tr>
                      <th className="px-6 py-4">Order ID</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Amount</th>
                      <th className="px-6 py-4">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.orders.map((o) => (
                      <tr key={o.id}>
                        <td className="px-6 py-4 font-mono text-xs">{o.id}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            o.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' :
                            o.status === 'PAYMENT_FAILED' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {o.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-medium">{(o.totalAmount / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</td>
                        <td className="px-6 py-4 text-slate-500">{new Date(o.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                    {data.orders.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-6 py-8 text-center text-slate-500">No orders yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Audit Log */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col h-[800px] overflow-hidden sticky top-28">
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">System Audit Trail</h2>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{data.auditLogs.length} Events</span>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {data.auditLogs.map((log) => (
                  <div key={log.id} className="relative pl-4 border-l-2 border-slate-200">
                    <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-indigo-400"></div>
                    <div className="text-xs text-slate-400 mb-1">{new Date(log.createdAt).toLocaleString()}</div>
                    <div className="font-semibold text-sm text-slate-900">{log.action}</div>
                    <div className="text-xs font-medium mt-1 uppercase">
                      <span className={log.status === 'EXECUTED' || log.status === 'APPROVED' ? 'text-emerald-600' : 'text-rose-600'}>
                        {log.status}
                      </span>
                    </div>
                    {log.reason && <div className="text-sm text-slate-600 mt-1">{log.reason}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
