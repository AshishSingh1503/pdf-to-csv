// client/src/components/ProgressBar.jsx
import React, { useMemo } from 'react'

const sizeMap = {
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-4',
}

const ProgressBar = ({ progress = 0, showPercentage = true, estimatedTimeRemaining = null, label = '', size = 'md' }) => {
  const pct = Math.max(0, Math.min(100, Math.round(progress)))

  const colorClass = useMemo(() => {
    if (pct <= 33) return 'bg-red-500'
    if (pct <= 66) return 'bg-yellow-400'
    return 'bg-green-500'
  }, [pct])

  const heightClass = sizeMap[size] || sizeMap.md

  const formatEta = (secs) => {
    if (!secs && secs !== 0) return ''
    const s = Number(secs)
    if (isNaN(s)) return ''
    const mins = Math.floor(s / 60)
    const rem = Math.floor(s % 60)
    return mins > 0 ? `~${mins}m ${rem}s remaining` : `~${rem}s remaining`
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        {label ? <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</div> : <div />}
        {showPercentage && (
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{pct}%</div>
        )}
      </div>

      <div className={`w-full bg-gray-200 dark:bg-slate-700 rounded-full ${heightClass} overflow-hidden`}>
        <div
          className={`${colorClass} ${heightClass} rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {estimatedTimeRemaining !== null && (
        <div className="mt-2 text-xs text-gray-600 dark:text-slate-300">{formatEta(estimatedTimeRemaining)}</div>
      )}
    </div>
  )
}

export default ProgressBar
