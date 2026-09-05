
'use client'
import Image from 'next/image';

import { useEffect, useState } from 'react'
import {
  getMerchantDashboardData,
  addProduct,
  updateProduct,
  deleteProduct,
  addBundleOption,
  removeBundleOption,
  applyMerchantBundlePresets,
} from '@/backend/actions/merchant'
import { MultiSelect } from './MultiSelect'

type Product = Awaited<ReturnType<typeof getMerchantDashboardData>>['products'][number]

export default function ProductAdder() {
  const [products, setProducts] = useState<Product[]>([])
  const [policies, setPolicies] = useState<Record<string, number>>({})
  const [addingProduct, setAddingProduct] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [isDeleting, setIsDeleting] = useState<string | null>(null)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)

  // Bundle Studio states
  const [activeTab, setActiveTab] = useState<'inventory' | 'bundles'>('inventory')
  const [bundlePrimaryId, setBundlePrimaryId] = useState<string>('')
  const [bundleAddonId, setBundleAddonId] = useState<string>('')
  const [isSubmittingBundle, setIsSubmittingBundle] = useState(false)
  const [isApplyingPresets, setIsApplyingPresets] = useState(false)
  const [unlinkingPair, setUnlinkingPair] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const refreshData = async () => {
    const res = await getMerchantDashboardData()
    setProducts(res.products || [])
    setPolicies(res.policies || {})
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshData()
  }, [])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setAddingProduct(true)
    const form = e.currentTarget
    const formData = new FormData(form)

    const productData = {
      name: formData.get('name') as string,
      category: formData.get('category') as string,
      price: parseInt(formData.get('price') as string) * 100,
      cost: parseInt(formData.get('cost') as string) * 100,
      inventory: parseInt(formData.get('inventory') as string),
      warrantyYears: parseInt(formData.get('warrantyYears') as string),
      deliveryDays: parseInt(formData.get('deliveryDays') as string),
      imageUrl: (formData.get('imageUrl') as string) || undefined,
      tags: (formData.get('tags') as string).split(',').map((tag) => tag.trim()).filter(Boolean),
      attributes: { highlights: formData.get('highlights') as string },
      relatedProducts: ((formData.get('relatedProducts') as string) || '').split(',').map((id) => id.trim()).filter(Boolean),
      complementaryProducts: ((formData.get('complementaryProducts') as string) || '').split(',').map((id) => id.trim()).filter(Boolean),
      upgradeProducts: ((formData.get('upgradeProducts') as string) || '').split(',').map((id) => id.trim()).filter(Boolean),
    }

    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, productData)
      } else {
        await addProduct(productData)
      }
      form.reset()
      setEditingProduct(null)
      await refreshData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error saving product')
    } finally {
      setAddingProduct(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return;
    setIsDeleting(id)
    try {
      await deleteProduct(id)
      await refreshData()
    } catch {
      alert('Could not delete product. It might be used in existing carts or orders.')
    } finally {
      setIsDeleting(null)
    }
  }

  const defaultDiscount = policies.DEFAULT_CAMPAIGN_DISCOUNT ?? 10
  const minMargin = policies.MIN_MARGIN_PERCENTAGE ?? 8
  const totalBundlesCount = products.reduce((acc, p) => acc + (p.complementaryProducts?.length || 0), 0)
  const productsWithBundles = products.filter((p) => (p.complementaryProducts?.length || 0) > 0)

  const handleCreateBundlePair = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!bundlePrimaryId || !bundleAddonId) return
    setIsSubmittingBundle(true)
    setActionError(null)
    setNotice(null)
    try {
      await addBundleOption(bundlePrimaryId, bundleAddonId)
      await refreshData()
      setNotice('Bundle option created successfully!')
      setBundleAddonId('')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create bundle option')
    } finally {
      setIsSubmittingBundle(false)
    }
  }

  const handleRemoveBundlePair = async (primaryId: string, addonId: string) => {
    setUnlinkingPair(`${primaryId}-${addonId}`)
    setActionError(null)
    setNotice(null)
    try {
      await removeBundleOption(primaryId, addonId)
      await refreshData()
      setNotice('Bundle option removed.')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to remove bundle option')
    } finally {
      setUnlinkingPair(null)
    }
  }

  const handleApplyBundlePresets = async () => {
    if (!confirm('Apply curated bundle presets? This will automatically configure high-converting accessory bundles for your keyboards, audio, mouse, and workstation products.')) return
    setIsApplyingPresets(true)
    setActionError(null)
    setNotice(null)
    try {
      const res = await applyMerchantBundlePresets()
      await refreshData()
      setNotice(`Successfully applied curated bundle presets across ${res.count} products!`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to apply presets')
    } finally {
      setIsApplyingPresets(false)
    }
  }

  return (
    <div className="min-h-screen bg-transparent pt-16 transition-colors font-sans selection:bg-indigo-100">
      <header className="bg-slate-900/90 dark:bg-[#0B1221]/90 backdrop-blur-md border-b border-slate-800 dark:border-gray-800 px-8 py-5 flex justify-between items-center shadow-lg sticky top-0 z-10">
        <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          Shop-Pilot <span className="text-indigo-400 font-medium">| Product Catalog</span>
        </h1>
        <a href="/merchant/portal" className="text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-full transition-all">
          Back to Hub
        </a>
      </header>

      <main className="p-8 max-w-7xl mx-auto mt-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-2">
            <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Merchant Merchandising</h2>
          </div>

          {/* Tab Switcher */}
          <div className="inline-flex p-1 bg-slate-200/80 dark:bg-slate-800/80 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('inventory')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'inventory'
                  ? 'bg-white dark:bg-[#0f1629] text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>📦 Product Catalog</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {products.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('bundles')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'bundles'
                  ? 'bg-white dark:bg-[#0f1629] text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>🎁 Bundle Studio</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 font-bold">
                {totalBundlesCount} pairs
              </span>
            </button>
          </div>
        </div>

        {notice && (
          <div className="flex items-center justify-between p-4 mb-6 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-300 text-sm">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>{notice}</span>
            </div>
            <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold underline">Dismiss</button>
          </div>
        )}

        {actionError && (
          <div className="flex items-center justify-between p-4 mb-6 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 text-rose-800 dark:text-rose-300 text-sm">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span>{actionError}</span>
            </div>
            <button type="button" onClick={() => setActionError(null)} className="text-xs font-semibold underline">Dismiss</button>
          </div>
        )}

        {activeTab === 'bundles' ? (
          <div className="space-y-8">
            {/* Bundle Metrics & Guardrails Banner */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white/90 dark:bg-[#0f1629]/90 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 p-5 rounded-2xl shadow-xs">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Bundled Products</div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white">
                  {productsWithBundles.length} <span className="text-xs font-normal text-slate-500">/ {products.length} SKUs</span>
                </div>
                <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">Cross-sell enabled</div>
              </div>
              <div className="bg-white/90 dark:bg-[#0f1629]/90 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 p-5 rounded-2xl shadow-xs">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Active Bundle Pairings</div>
                <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                  {totalBundlesCount}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Available in AI checkout</div>
              </div>
              <div className="bg-white/90 dark:bg-[#0f1629]/90 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 p-5 rounded-2xl shadow-xs">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Default Bundle Discount</div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white">
                  {defaultDiscount}%
                </div>
                <div className="text-[11px] text-indigo-500 dark:text-indigo-400 mt-1">Grounded merchant policy</div>
              </div>
              <div className="bg-white/90 dark:bg-[#0f1629]/90 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 p-5 rounded-2xl shadow-xs">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Floor Margin Protection</div>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  &ge; {minMargin}%
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Enforced by deterministic policy</div>
              </div>
            </div>

            {/* Actions: Presets and Quick Pairing Form */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* 1-Click Curated Presets Card */}
              <div className="bg-gradient-to-br from-indigo-900/90 to-slate-900/90 text-white p-6 rounded-2xl border border-indigo-800/80 shadow-md flex flex-col justify-between">
                <div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 mb-3">
                    <span>⚡ AI Recommended Presets</span>
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">Curated Bundle Presets</h3>
                  <p className="text-xs text-indigo-200/80 leading-relaxed mb-4">
                    Automatically provision high-converting cross-sell packages (Wrist Rests, Desk Mats, Aviator Cables, Headphone Stands, and Laptop Risers) with optimal margin protection.
                  </p>
                  <ul className="text-xs text-slate-300 space-y-1.5 mb-6">
                    <li className="flex items-center gap-2">
                      <span className="text-indigo-400 font-bold">&check;</span> Keyboards &rarr; Wrist Rest & Desk Mat XXL
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-indigo-400 font-bold">&check;</span> Audio &rarr; Headphone Stand & Ear Cushions
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-indigo-400 font-bold">&check;</span> Mice &rarr; Desk Mat & USB-C Cable
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-indigo-400 font-bold">&check;</span> Docking Hub &rarr; Laptop Riser Stand
                    </li>
                  </ul>
                </div>

                <button
                  type="button"
                  disabled={isApplyingPresets}
                  onClick={handleApplyBundlePresets}
                  className="w-full py-3 px-4 rounded-xl bg-indigo-500 hover:bg-indigo-600 active:bg-indigo-700 text-white font-semibold text-sm transition-all shadow-md hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isApplyingPresets ? (
                    <>
                      <svg className="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Applying presets...</span>
                    </>
                  ) : (
                    <span>✨ Apply Curated Presets (1-Click)</span>
                  )}
                </button>
              </div>

              {/* Manual Quick Bundle Pairing Form */}
              <div className="lg:col-span-2 bg-white/90 dark:bg-[#0f1629]/90 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 p-6 rounded-2xl shadow-sm">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
                  <span>🔗 Quick Pair Bundle Option</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
                  Select a primary product and link an accessory as an eligible bundle option for the AI checkout agent.
                </p>

                <form onSubmit={handleCreateBundlePair} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                        Primary Product (Main item in cart)
                      </label>
                      <select
                        required
                        value={bundlePrimaryId}
                        onChange={(e) => setBundlePrimaryId(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white text-sm focus:outline-none focus:border-indigo-500"
                      >
                        <option value="">-- Select primary product --</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({(p.price / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                        Add-on Product (Bundle cross-sell)
                      </label>
                      <select
                        required
                        value={bundleAddonId}
                        onChange={(e) => setBundleAddonId(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white text-sm focus:outline-none focus:border-indigo-500"
                      >
                        <option value="">-- Select accessory to bundle --</option>
                        {products
                          .filter((p) => p.id !== bundlePrimaryId && p.inventory > 0)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.category}) - {(p.price / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })} [{p.inventory} in stock]
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={isSubmittingBundle || !bundlePrimaryId || !bundleAddonId}
                      className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-xs transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                    >
                      {isSubmittingBundle ? 'Pairing...' : '+ Link as Bundle Option'}
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Active Bundle Matrix: Product Cards with Configured Bundles */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>Active Product Bundle Packages</span>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {productsWithBundles.length} configured
                  </span>
                </h3>
              </div>

              {productsWithBundles.length === 0 ? (
                <div className="bg-white/90 dark:bg-[#0f1629]/90 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-12 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-3 mx-auto shadow-xs">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V4a2 2 0 10-2 2h2m0 13l4-4m-4 4l-4-4" />
                    </svg>
                  </div>
                  <h4 className="text-base font-bold text-slate-900 dark:text-white mb-1">No Bundle Pairings Yet</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-5">
                    You have not configured bundle add-ons yet. Use 1-Click Curated Presets above or manually pair products.
                  </p>
                  <button
                    type="button"
                    disabled={isApplyingPresets}
                    onClick={handleApplyBundlePresets}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs transition-all shadow-xs"
                  >
                    <span>✨ Apply Curated Bundle Presets Now</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6">
                  {productsWithBundles.map((primary) => {
                    const bundledProducts = (primary.complementaryProducts || [])
                      .map((id) => products.find((p) => p.id === id))
                      .filter(Boolean) as Product[]

                    return (
                      <div
                        key={primary.id}
                        className="bg-white/90 dark:bg-[#0f1629]/90 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-6 shadow-sm"
                      >
                        {/* Primary Product Header */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-4 border-b border-slate-200/80 dark:border-slate-800/80 gap-3">
                          <div className="flex items-center gap-3">
                            {primary.imageUrl ? (
                              <Image
                                src={primary.imageUrl}
                                alt=""
                                width={44}
                                height={44}
                                unoptimized
                                className="w-11 h-11 rounded-xl object-cover border border-slate-200 dark:border-slate-700"
                              />
                            ) : (
                              <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                                📦
                              </div>
                            )}
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="font-bold text-slate-900 dark:text-white text-base">{primary.name}</h4>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 capitalize">
                                  {primary.category}
                                </span>
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Base Price: <span className="font-semibold text-slate-800 dark:text-slate-200">{(primary.price / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span> · Stock: <span className="font-medium">{primary.inventory} units</span>
                              </div>
                            </div>
                          </div>

                          <div className="inline-flex items-center gap-2">
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60">
                              🎁 {bundledProducts.length} Cross-Sell Add-on{bundledProducts.length === 1 ? '' : 's'}
                            </span>
                          </div>
                        </div>

                        {/* Grid of Bundle Add-ons */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {bundledProducts.map((addon) => {
                            const discountPaise = Math.floor(addon.price * (defaultDiscount / 100))
                            const bundleAddonPrice = addon.price - discountPaise
                            const bundleTotal = primary.price + bundleAddonPrice
                            const totalCost = (primary.cost || 0) + (addon.cost || 0)
                            const marginPercent = bundleTotal > 0 ? Math.round(((bundleTotal - totalCost) / bundleTotal) * 100) : 0
                            const isUnlinking = unlinkingPair === `${primary.id}-${addon.id}`

                            return (
                              <div
                                key={addon.id}
                                className="bg-slate-50/70 dark:bg-slate-900/50 border border-slate-200/70 dark:border-slate-800/70 rounded-xl p-4 flex flex-col justify-between hover:border-indigo-300 dark:hover:border-indigo-700/60 transition-colors group"
                              >
                                <div>
                                  <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-2.5">
                                      {addon.imageUrl ? (
                                        <Image
                                          src={addon.imageUrl}
                                          alt=""
                                          width={36}
                                          height={36}
                                          unoptimized
                                          className="w-9 h-9 rounded-lg object-cover border border-slate-200 dark:border-slate-700"
                                        />
                                      ) : (
                                        <div className="w-9 h-9 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-xs">
                                          ⚡
                                        </div>
                                      )}
                                      <div>
                                        <div className="font-semibold text-xs text-slate-900 dark:text-white line-clamp-1">{addon.name}</div>
                                        <div className="text-[10px] text-slate-500 capitalize">{addon.category}</div>
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      disabled={isUnlinking}
                                      onClick={() => handleRemoveBundlePair(primary.id, addon.id)}
                                      className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 p-1 rounded-md transition-colors text-xs font-bold cursor-pointer"
                                      title="Unlink bundle option"
                                    >
                                      {isUnlinking ? '…' : '✕'}
                                    </button>
                                  </div>

                                  <div className="bg-white/80 dark:bg-[#0f1629]/80 rounded-lg p-2.5 border border-slate-200/60 dark:border-slate-800/60 my-2 space-y-1 text-xs">
                                    <div className="flex justify-between text-slate-500 dark:text-slate-400 text-[11px]">
                                      <span>Add-on Price:</span>
                                      <span className="line-through">{(addon.price / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                                    </div>
                                    <div className="flex justify-between text-indigo-600 dark:text-indigo-400 text-[11px] font-medium">
                                      <span>Bundle Discount ({defaultDiscount}%):</span>
                                      <span>-{(discountPaise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                                    </div>
                                    <div className="border-t border-slate-100 dark:border-slate-800 pt-1 flex justify-between font-bold text-slate-900 dark:text-white">
                                      <span>Bundle Total:</span>
                                      <span className="text-indigo-600 dark:text-indigo-400">{(bundleTotal / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between text-[11px] pt-1">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-semibold ${
                                    marginPercent >= minMargin
                                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                      : 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                                  }`}>
                                    {marginPercent}% Margin
                                  </span>
                                  <span className="text-slate-400 dark:text-slate-500">
                                    {addon.inventory} in stock
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Add Product Form */}
            <div className="bg-white/90 dark:bg-[#0f1629]/90 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 text-slate-900 dark:text-slate-100 p-6 rounded-2xl shadow-sm self-start sticky top-28">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>{editingProduct ? 'Edit Product' : 'Add New Product'}</span>
                  {editingProduct && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 font-semibold uppercase">
                      Editing
                    </span>
                  )}
                </h3>
                {editingProduct && (
                  <button
                    type="button"
                    onClick={() => setEditingProduct(null)}
                    className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
              <form key={editingProduct?.id || 'new'} onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">Product Name</label>
                  <input
                    required
                    defaultValue={editingProduct?.name}
                    name="name"
                    type="text"
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    placeholder="e.g. Wireless Ergonomic Mouse"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">Category</label>
                  <input
                    required
                    defaultValue={editingProduct?.category}
                    name="category"
                    type="text"
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    placeholder="e.g. Mouse, Keyboards, Audio"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">Price (INR)</label>
                    <input
                      required
                      defaultValue={editingProduct ? editingProduct.price / 100 : ''}
                      name="price"
                      type="number"
                      min="1"
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                      placeholder="7499"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">Cost (INR)</label>
                    <input
                      required
                      defaultValue={editingProduct ? editingProduct.cost / 100 : ''}
                      name="cost"
                      type="number"
                      min="0"
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                      placeholder="4499"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">Stock</label>
                    <input
                      required
                      defaultValue={editingProduct?.inventory}
                      name="inventory"
                      type="number"
                      min="0"
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                      placeholder="25"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">Warranty (Yrs)</label>
                    <input
                      required
                      defaultValue={editingProduct?.warrantyYears ?? 1}
                      name="warrantyYears"
                      type="number"
                      min="0"
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">Delivery (Days)</label>
                    <input
                      required
                      defaultValue={editingProduct?.deliveryDays ?? 3}
                      name="deliveryDays"
                      type="number"
                      min="1"
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">Tags (Comma-separated)</label>
                  <input
                    defaultValue={editingProduct?.tags?.join(', ')}
                    name="tags"
                    type="text"
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    placeholder="wireless, ergonomic, mechanical"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">Key Highlights</label>
                  <input
                    defaultValue={(editingProduct?.attributes as { highlights?: string })?.highlights || ''}
                    name="highlights"
                    type="text"
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    placeholder="Up to 120h battery, RGB backlight"
                  />
                </div>

                {/* Product Relationships Section */}
                <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800/80">
                  <div className="mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                      Product Relationships
                    </span>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Configure cross-sells, upsells, and alternatives
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <span>🔗 Related Products</span>
                        </label>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">Alternative options</span>
                      </div>
                      <MultiSelect
                        key={`related-${editingProduct?.id || 'new'}`}
                        name="relatedProducts"
                        options={products
                          .filter((p) => p.id !== editingProduct?.id)
                          .map((p) => ({
                            id: p.id,
                            name: p.name,
                            category: p.category,
                            price: p.price,
                          }))}
                        initialSelectedIds={editingProduct?.relatedProducts || []}
                        placeholder="Select alternative products..."
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <span>🎁 Complementary Products</span>
                        </label>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">Cross-sell bundle add-ons</span>
                      </div>
                      <MultiSelect
                        key={`complementary-${editingProduct?.id || 'new'}`}
                        name="complementaryProducts"
                        options={products
                          .filter((p) => p.id !== editingProduct?.id)
                          .map((p) => ({
                            id: p.id,
                            name: p.name,
                            category: p.category,
                            price: p.price,
                          }))}
                        initialSelectedIds={editingProduct?.complementaryProducts || []}
                        placeholder="Select cross-sell accessories..."
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <span>⚡ Upgrade Products</span>
                        </label>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">Higher-tier upsells</span>
                      </div>
                      <MultiSelect
                        key={`upgrade-${editingProduct?.id || 'new'}`}
                        name="upgradeProducts"
                        options={products
                          .filter((p) => p.id !== editingProduct?.id)
                          .map((p) => ({
                            id: p.id,
                            name: p.name,
                            category: p.category,
                            price: p.price,
                          }))}
                        initialSelectedIds={editingProduct?.upgradeProducts || []}
                        placeholder="Select premium tier upgrades..."
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">Image URL (Optional)</label>
                  <input
                    defaultValue={editingProduct?.imageUrl || ''}
                    name="imageUrl"
                    type="url"
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    placeholder="https://images.unsplash.com/..."
                  />
                </div>

                <button
                  type="submit"
                  disabled={addingProduct}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-medium py-3 rounded-xl shadow-sm hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {addingProduct ? (
                    <>
                      <svg className="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>{editingProduct ? 'Update Product' : 'Add Product to Catalog'}</span>
                  )}
                </button>
              </form>
            </div>

            {/* Product List */}
            <div className="lg:col-span-2 bg-white/90 dark:bg-[#0f1629]/90 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 rounded-2xl shadow-sm overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between">
                <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
                  <span>Active Catalog</span>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {products.length} {products.length === 1 ? 'item' : 'items'}
                  </span>
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200/80 dark:divide-slate-800/80">
                  <thead className="bg-slate-50/80 dark:bg-slate-900/80">
                    <tr>
                      <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Product</th>
                      <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Category</th>
                      <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Price</th>
                      <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Stock</th>
                      <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Bundles</th>
                      <th className="px-6 py-3.5 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white/40 dark:bg-[#0f1629]/40 divide-y divide-slate-200/80 dark:divide-slate-800/60">
                    {products && products.length > 0 ? (
                      products.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-white flex items-center gap-3">
                            {p.imageUrl ? (
                              <Image src={p.imageUrl} alt="" width={40} height={40} unoptimized className="w-10 h-10 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 dark:text-slate-500">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                              </div>
                            )}
                            <div>
                              <div className="font-semibold">{p.name}</div>
                              {p.tags && p.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-0.5">
                                  {p.tags.slice(0, 3).map((tag, idx) => (
                                    <span key={idx} className="text-[10px] text-slate-400 dark:text-slate-500">#{tag}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300 capitalize">{p.category}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-900 dark:text-white">{(p.price / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${p.inventory > 10 ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60' : 'bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800/60'}`}>
                              {p.inventory} in stock
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300">
                            {p.complementaryProducts && p.complementaryProducts.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setBundlePrimaryId(p.id)
                                  setActiveTab('bundles')
                                }}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/70 dark:hover:bg-indigo-900/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 transition-colors cursor-pointer"
                              >
                                <span>🎁 {p.complementaryProducts.length} Add-on{p.complementaryProducts.length > 1 ? 's' : ''}</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setBundlePrimaryId(p.id)
                                  setActiveTab('bundles')
                                }}
                                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-600 dark:text-slate-500 dark:hover:text-indigo-400 font-medium transition-colors cursor-pointer"
                              >
                                <span>+ Pair bundle</span>
                              </button>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium">
                            <div className="relative inline-block text-left">
                              <button
                                type="button"
                                onClick={() => setOpenDropdown(openDropdown === p.id ? null : p.id)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none transition-colors"
                              >
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                  <circle cx="5" cy="12" r="2" />
                                  <circle cx="12" cy="12" r="2" />
                                  <circle cx="19" cy="12" r="2" />
                                </svg>
                              </button>

                              {openDropdown === p.id && (
                                <>
                                  <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)}></div>
                                  <div className="absolute right-0 top-8 z-50 w-44 bg-white dark:bg-[#1a2333] rounded-xl shadow-2xl py-1.5 flex flex-col border border-slate-200 dark:border-slate-700 overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() => { setEditingProduct(p); setOpenDropdown(null); }}
                                      className="w-full text-left px-4 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors flex items-center gap-2"
                                    >
                                      <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                      Edit Details
                                    </button>
                                    <div className="border-t border-slate-100 dark:border-slate-800 my-1"></div>
                                    <button
                                      type="button"
                                      onClick={() => { handleDelete(p.id); setOpenDropdown(null); }}
                                      disabled={isDeleting === p.id}
                                      className="w-full text-left px-4 py-2.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-50 flex items-center gap-2"
                                    >
                                      <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                      {isDeleting === p.id ? 'Deleting...' : 'Delete Product'}
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="px-6 py-16 text-center">
                          <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                            <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-3 shadow-xs">
                              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                              </svg>
                            </div>
                            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">No Products in Catalog</h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                              Use the form on the left to add your first product with inventory, pricing, and AI recommendation links.
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
