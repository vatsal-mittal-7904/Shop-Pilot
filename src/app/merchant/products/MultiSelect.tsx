'use client'
import { useState, useRef, useEffect } from 'react'

export function MultiSelect({ name, options, initialSelectedIds, placeholder }: { name: string, options: {id: string, name: string}[], initialSelectedIds: string[], placeholder: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = options.filter(o => o.name.toLowerCase().includes(search.toLowerCase()))

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) setSelectedIds(selectedIds.filter(x => x !== id))
    else setSelectedIds([...selectedIds, id])
  }

  return (
    <div className="relative" ref={containerRef}>
      <input type="hidden" name={name} value={selectedIds.join(',')} />
      <div className="w-full px-3 py-2 border rounded-lg bg-white cursor-pointer min-h-[42px]" onClick={() => setIsOpen(!isOpen)}>
        {selectedIds.length > 0 ? (
           <div className="flex flex-wrap gap-1">
             {selectedIds.map(id => {
               const name = options.find(o => o.id === id)?.name || id
               return <span key={id} className="bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded-full">{name}</span>
             })}
           </div>
        ) : (
          <span className="text-slate-400">{placeholder}</span>
        )}
      </div>

      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 flex flex-col">
          <input
             type="text"
             className="w-full px-3 py-2 border-b outline-none"
             placeholder="Search..."
             value={search}
             onChange={e => setSearch(e.target.value)}
             onClick={e => e.stopPropagation()}
          />
          <div className="overflow-y-auto p-1">
            {filtered.map(o => (
              <label key={o.id} className="flex items-center px-3 py-2 hover:bg-slate-50 cursor-pointer rounded-md">
                <input type="checkbox" className="mr-2" checked={selectedIds.includes(o.id)} onChange={() => toggle(o.id)} />
                <span className="text-sm truncate">{o.name}</span>
              </label>
            ))}
            {filtered.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">No products found</div>}
          </div>
        </div>
      )}
    </div>
  )
}
