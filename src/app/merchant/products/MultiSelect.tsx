'use client'

import { useState, useRef, useEffect, useId } from 'react'

export interface MultiSelectOption {
  id: string
  name: string
  category?: string
  price?: number
}

interface MultiSelectProps {
  name: string
  options: MultiSelectOption[]
  initialSelectedIds: string[]
  placeholder?: string
}

export function MultiSelect({
  name,
  options,
  initialSelectedIds,
  placeholder = 'Select products...',
}: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchId = useId()

  const [prevInitial, setPrevInitial] = useState(initialSelectedIds)
  if (prevInitial !== initialSelectedIds) {
    setPrevInitial(initialSelectedIds)
    setSelectedIds(initialSelectedIds)
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [])

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [isOpen])

  const filtered = options.filter(
    (o) =>
      o.name.toLowerCase().includes(search.toLowerCase()) ||
      (o.category && o.category.toLowerCase().includes(search.toLowerCase()))
  )

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((x) => x !== id))
    } else {
      setSelectedIds([...selectedIds, id])
    }
  }

  const removeTag = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedIds(selectedIds.filter((x) => x !== id))
  }

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedIds([])
  }

  return (
    <div className="relative w-full" ref={containerRef}>
      {/* Hidden input preserves standard FormData submission */}
      <input type="hidden" name={name} value={selectedIds.join(',')} />

      {/* Main interactive trigger box */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setIsOpen(!isOpen)
          }
        }}
        className={`w-full min-h-[42px] px-3 py-2 rounded-xl text-left cursor-pointer transition-all duration-150 flex items-center justify-between gap-2 border bg-white dark:bg-slate-900/80 ${
          isOpen
            ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-sm'
            : 'border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 shadow-xs'
        }`}
      >
        <div className="flex-1 min-w-0">
          {selectedIds.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 py-0.5">
              {selectedIds.map((id) => {
                const opt = options.find((o) => o.id === id)
                const label = opt?.name || id
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/80 shadow-xs"
                  >
                    <span className="truncate max-w-[140px]">{label}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${label}`}
                      onClick={(e) => removeTag(id, e)}
                      className="text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-900/80 rounded p-0.5 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                )
              })}
            </div>
          ) : (
            <span className="text-xs text-slate-400 dark:text-slate-500 block truncate select-none">
              {placeholder}
            </span>
          )}
        </div>

        {/* Right action icons */}
        <div className="flex items-center gap-1.5 shrink-0 text-slate-400 dark:text-slate-500">
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              title="Clear all selections"
              className="p-1 hover:text-slate-600 dark:hover:text-slate-300 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180 text-indigo-500' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Floating Popover Menu */}
      {isOpen && (
        <div className="absolute left-0 right-0 z-50 mt-1.5 bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl overflow-hidden backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-100">
          {/* Search bar */}
          <div className="relative border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-2">
            <div className="relative flex items-center">
              <svg
                className="absolute left-2.5 w-3.5 h-3.5 text-slate-400 dark:text-slate-500 pointer-events-none"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                id={searchId}
                ref={searchInputRef}
                type="text"
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500/20"
                placeholder="Search catalog items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Options List */}
          <div className="max-h-56 overflow-y-auto p-1.5 space-y-0.5">
            {filtered.map((o) => {
              const isSelected = selectedIds.includes(o.id)
              return (
                <div
                  key={o.id}
                  onClick={() => toggle(o.id)}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors ${
                    isSelected
                      ? 'bg-indigo-50/80 dark:bg-indigo-950/50 text-indigo-900 dark:text-indigo-200 font-medium'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {/* Checkbox indicator */}
                    <div
                      className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'
                      }`}
                    >
                      {isSelected && (
                        <svg className="w-2.5 h-2.5 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-slate-900 dark:text-slate-100 font-medium">
                        {o.name}
                      </div>
                      {(o.category || o.price !== undefined) && (
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                          {o.category && <span className="capitalize">{o.category}</span>}
                          {o.category && o.price !== undefined && <span>•</span>}
                          {o.price !== undefined && (
                            <span>
                              {(o.price / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}

            {filtered.length === 0 && (
              <div className="py-6 px-4 text-center">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {options.length === 0 ? 'No other products found in catalog' : `No matches for "${search}"`}
                </p>
              </div>
            )}
          </div>

          {/* Footer with summary and Done button */}
          <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/80 dark:bg-slate-900/60 flex items-center justify-between text-[11px]">
            <span className="text-slate-500 dark:text-slate-400">
              {selectedIds.length} {selectedIds.length === 1 ? 'item' : 'items'} selected
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-medium transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
