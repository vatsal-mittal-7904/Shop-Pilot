import React from 'react'

type MetricCardProps = {
  title: string
  value: React.ReactNode
  description?: string
  icon?: React.ReactNode
  accentColor?: 'indigo' | 'emerald' | 'sky' | 'amber' | 'rose'
}

export function MetricCard({ title, value, description, icon, accentColor = 'indigo' }: MetricCardProps) {
  const colorClasses = {
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-500/30 dark:text-indigo-300 dark:backdrop-blur-xl',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-500/30 dark:text-emerald-300 dark:backdrop-blur-xl',
    sky: 'bg-sky-50 border-sky-200 text-sky-700 dark:bg-sky-900/30 dark:border-sky-500/30 dark:text-sky-300 dark:backdrop-blur-xl',
    amber: 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/30 dark:border-amber-500/30 dark:text-amber-300 dark:backdrop-blur-xl',
    rose: 'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-900/30 dark:border-rose-500/30 dark:text-rose-300 dark:backdrop-blur-xl',
  }

  const bgClass = colorClasses[accentColor]

  return (
    <div className={`p-6 rounded-2xl shadow-sm border ${bgClass}`}>
      <div className="flex justify-between items-start mb-2">
        <h3 className="text-sm font-bold uppercase tracking-wider opacity-80">{title}</h3>
        {icon && <div className="opacity-70">{icon}</div>}
      </div>
      <div className="text-3xl font-extrabold">{value}</div>
      {description && <div className="text-sm opacity-80 mt-2">{description}</div>}
    </div>
  )
}
