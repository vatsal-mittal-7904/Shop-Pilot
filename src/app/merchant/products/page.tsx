'use client'

import { useEffect, useState } from 'react'
import { getMerchantDashboardData, addProduct, updateProduct, deleteProduct } from '@/backend/actions/merchant'

type Product = Awaited<ReturnType<typeof getMerchantDashboardData>>['products'][number]

export default function ProductAdder() {
  const [products, setProducts] = useState<Product[]>([])
  const [addingProduct, setAddingProduct] = useState(false)
  const [editingProduct, setEditingProduct] = useState<any>(null)
  const [isDeleting, setIsDeleting] = useState<string | null>(null)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)

  const refreshData = async () => {
    const res = await getMerchantDashboardData()
    setProducts(res.products || [])
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
    } catch (err) {
      alert('Could not delete product. It might be used in existing carts or orders.')
    } finally {
      setIsDeleting(null)
    }
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
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-900">{editingProduct ? 'Edit Product' : 'Add New Product'}</h3>
              {editingProduct && (
                <button onClick={() => setEditingProduct(null)} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
              )}
            </div>
            <form key={editingProduct?.id || 'new'} onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Product Name</label>
                <input required defaultValue={editingProduct?.name} name="name" type="text" className="w-full px-3 py-2 border rounded-lg text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500" placeholder="e.g. Wireless Mouse" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                <input required defaultValue={editingProduct?.category} name="category" type="text" className="w-full px-3 py-2 border rounded-lg text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500" placeholder="e.g. mouse" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Price (INR)</label>
                  <input required defaultValue={editingProduct ? editingProduct.price / 100 : ''} name="price" type="number" min="1" className="w-full px-3 py-2 border rounded-lg text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500" placeholder="1500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Cost (INR)</label>
                  <input required defaultValue={editingProduct ? editingProduct.cost / 100 : ''} name="cost" type="number" min="0" className="w-full px-3 py-2 border rounded-lg text-slate-900" placeholder="900" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Inventory</label>
                  <input required defaultValue={editingProduct?.inventory} name="inventory" type="number" min="1" className="w-full px-3 py-2 border rounded-lg text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500" placeholder="50" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">Warranty years<input required defaultValue={editingProduct?.warrantyYears ?? 1} name="warrantyYears" type="number" min="0" className="mt-1 w-full px-3 py-2 border rounded-lg text-slate-900" /></label>
                <label className="block text-sm font-medium text-slate-700 mb-1">Delivery days<input required defaultValue={editingProduct?.deliveryDays ?? 3} name="deliveryDays" type="number" min="0" className="mt-1 w-full px-3 py-2 border rounded-lg text-slate-900" /></label>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tags</label>
                <input required defaultValue={editingProduct?.tags?.join(', ')} name="tags" type="text" className="w-full px-3 py-2 border rounded-lg text-slate-900" placeholder="programming, wireless" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Feature highlights</label>
                <input required defaultValue={editingProduct?.attributes?.highlights || ''} name="highlights" type="text" className="w-full px-3 py-2 border rounded-lg text-slate-900" placeholder="Wireless, mechanical switches" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Image URL (Optional)</label>
                <input defaultValue={editingProduct?.imageUrl || ''} name="imageUrl" type="url" className="w-full px-3 py-2 border rounded-lg text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500" placeholder="https://..." />
              </div>
              <button type="submit" disabled={addingProduct} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-lg transition-colors">
                {addingProduct ? 'Saving...' : (editingProduct ? 'Update Product' : 'Add Product')}
              </button>
            </form>
          </div>

          {/* Product List */}
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider rounded-tl-2xl">Product</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Category</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Price</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Stock</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider rounded-tr-2xl">Actions</th>
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
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium">
                        <div className="relative inline-block text-left">
                          <button 
                            onClick={() => setOpenDropdown(openDropdown === p.id ? null : p.id)} 
                            className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 focus:outline-none transition-colors"
                          >
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
                            </svg>
                          </button>
                          
                          {openDropdown === p.id && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setOpenDropdown(null)}></div>
                              <div className="absolute right-8 top-0 z-50 w-32 bg-white rounded-md shadow-lg border border-slate-200 py-1 ring-1 ring-black ring-opacity-5">
                                <button 
                                  onClick={() => { setEditingProduct(p); setOpenDropdown(null); }} 
                                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-indigo-600"
                                >
                                  Edit
                                </button>
                                <button 
                                  onClick={() => { handleDelete(p.id); setOpenDropdown(null); }} 
                                  disabled={isDeleting === p.id} 
                                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                                >
                                  {isDeleting === p.id ? 'Deleting...' : 'Delete'}
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
                    <td colSpan={5} className="px-6 py-8 text-center text-slate-500">No products found. Add one on the left!</td>
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
