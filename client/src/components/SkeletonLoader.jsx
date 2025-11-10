import React from 'react'

export const TableSkeleton = ({ rows = 5, columns = 7 }) => {
  const cols = Array.from({ length: columns })
  return (
    <div className="p-4 bg-white dark:bg-slate-800 rounded shadow-sm">
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex space-x-3 items-center animate-pulse">
            {cols.map((_, c) => (
              <div key={c} className={`h-4 bg-gray-200 dark:bg-slate-700 rounded ${c === 0 ? 'w-2/5' : c % 3 === 0 ? 'w-3/4' : 'w-full'}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export const SidebarSkeleton = ({ count = 3 }) => {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-3 bg-gray-100 dark:bg-slate-700 rounded animate-pulse">
          <div className="h-4 bg-gray-200 dark:bg-slate-600 rounded w-3/4 mb-2" />
          <div className="h-3 bg-gray-200 dark:bg-slate-600 rounded w-1/2" />
        </div>
      ))}
    </div>
  )
}

export const FileCardSkeleton = ({ count = 3 }) => (
  <div className="space-y-3">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="p-3 bg-gray-50 dark:bg-slate-800 rounded animate-pulse">
        <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-1/2 mb-2" />
        <div className="h-3 bg-gray-200 dark:bg-slate-700 rounded w-1/3" />
      </div>
    ))}
  </div>
)

export default TableSkeleton
