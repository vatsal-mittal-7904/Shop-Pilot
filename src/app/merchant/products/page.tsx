'use client'

import { useEffect, useState } from 'react'
import { getMerchantDashboardData, addProduct } from '@/backend/actions/merchant'

type Product = Awaited<ReturnType<typeof getMerchantDashboardData>>['products'][number]

export default function ProductAdder() {
  const [products, setProducts] = useState<Product[]>([])
  const [addingProduct, setAddingProduct] = useState(false)

  const refreshData = async () => {
    const res = await getMerchantDashboardData()
    setProducts(res.products || [])
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshData()
  }, [])

  const handleAddProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setAddingProduct(true)
    const form = e.currentTarget
    const formData = new FormData(form)
    await addProduct({
      name: formData.get('name') as string,
      category: formData.get('category') as string,
      price: parseInt(formData.get('price') as string) * 100, // convert INR to paise
      cost: parseInt(formData.get('cost') as string) * 100,
      inventory: parseInt(formData.get('inventory') as string),
      warrantyYears: parseInt(formData.get('warrantyYears') as string),
      deliveryDays: parseInt(formData.get('deliveryDays') as string),
      imageUrl: (formData.get('imageUrl') as string) || undefined,
      tags: (formData.get('tags') as string).split(',').map((tag) => tag.trim()).filter(Boolean),
      attributes: { highlights: formData.get('highlights') as string },
    })
    form.reset()
    await refreshData()
    setAddingProduct(false)
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans selection:bg-indigo-100">
      <header className="bg-slate-900 border-b border-slate-800 px-8 py-5 flex justify-between items-center shadow-lg sticky top-0 z-10">
        <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          MerchantOS <span className="text-indigo-400 font-medium">| Product Catalog</span>
        </h1>
        <a href="/merchant/portal" className="text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-full transition-all">
          Back to Hub
        </a>
      </header>

      <main className="p-8 max-w-7xl mx-auto mt-6">
        <div className="flex items-center gap-2 mb-6">
          <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <h2 className="text-2xl font-bold text-slate-900">Manage Inventory</h2>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Add Product Form */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 self-start sticky top-28">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Add New Product</h3>
            <form onSubmit={handleAddProduct} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Product Name</label>
                <input required name="name" type="text" className="w-full px-3 py-2 border rounded-lg text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500" placeholder="e.g. Wireless Mouse" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                <input required name="category" type="text" className="w-full px-3 py-2 border rounded-lg text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500" placeholder="e.g. mouse" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Price (INR)</label>
                  <input required name="price" type="number" min="1" className="w-full px-3 py-2 border rounded-lg text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500" placeholder="1500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Cost (INR)</label>
                  <input required name="cost" type="number" min="0" className="w-full px-3 py-2 border rounded-lg text-slate-900" placeholder="900" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Inventory</label>
                  <input required name="inventory" type="number" min="1" className="w-full px-3 py-2 border rounded-lg text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500" placeholder="50" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">Warranty years<input required defaultValue="1" name="warrantyYears" type="number" min="0" className="mt-1 w-full px-3 py-2 border rounded-lg text-slate-900" /></label>
                <label className="block text-sm font-medium text-slate-700 mb-1">Delivery days<input required defaultValue="3" name="deliveryDays" type="number" min="0" className="mt-1 w-full px-3 py-2 border rounded-lg text-slate-900" /></label>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tags</label>
                <input required name="tags" type="text" className="w-full px-3 py-2 border rounded-lg text-slate-900" placeholder="programming, wireless" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Feature highlights</label>
                <input required name="highlights" type="text" className="w-full px-3 py-2 border rounded-lg text-slate-900" placeholder="Wireless, mechanical switches" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Image URL (Optional)</label>
                <input name="imageUrl" type="url" className="w-full px-3 py-2 border rounded-lg text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500" placeholder="https://..." />
              </div>
              <button type="submit" disabled={addingProduct} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-lg transition-colors">
                {addingProduct ? 'Adding...' : 'Add Product'}
              </button>
            </form>
          </div>

          {/* Product List */}
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Product</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Category</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Price</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Stock</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {products && products.length > 0 ? (
                  products.map((p) => (
                    <tr key={p.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 flex items-center gap-3">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="" className="w-10 h-10 rounded-md object-cover border border-slate-200" />
                        ) : (
                          <div className="w-10 h-10 rounded-md bg-slate-100 flex items-center justify-center text-slate-300">
                             <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                          </div>
                        )}
                        {p.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{p.category}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">{(p.price / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${p.inventory > 10 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          {p.inventory} in stock
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-slate-500">No products found. Add one on the left!</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
