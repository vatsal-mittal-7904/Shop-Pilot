import React from 'react'

type ImpactBarProps = {
  aiRevenue: number
  totalRevenue: number
}

export function ImpactBar({ aiRevenue, totalRevenue }: ImpactBarProps) {
  const percentage = totalRevenue > 0 ? Math.min(100, Math.max(0, (aiRevenue / totalRevenue) * 100)) : 0
  
  return (
    <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 mt-8">
      <div className="mb-4 flex justify-between items-end">
        <div>
          <h2 className="text-xl font-bold text-slate-900">AI Revenue Impact</h2>
          <p className="text-slate-500 text-sm mt-1">Share of total revenue generated automatically by the AI assistant</p>
        </div>
        <div className="text-right">
          <span className="text-3xl font-extrabold text-indigo-600">{percentage.toFixed(1)}%</span>
        </div>
      </div>
      
      <div className="w-full bg-slate-100 h-6 rounded-full overflow-hidden relative">
        <div 
          className="bg-indigo-600 h-full rounded-full transition-all duration-1000 ease-out" 
          style={{ width: `${percentage}%` }}
        />
      </div>
      
      <div className="flex justify-between mt-3 text-sm font-medium">
        <div className="text-indigo-600 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-indigo-600 inline-block" />
          AI-Recovered: {(aiRevenue / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
        </div>
        <div className="text-slate-500 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-slate-300 inline-block" />
          Total Revenue: {(totalRevenue / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
        </div>
      </div>
    </div>
  )
}
