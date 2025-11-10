import React from 'react'

const EmptyState = ({ icon = '📭', title, description = '', action = null, className = '' }) => {
  return (
    <div className={`flex flex-col items-center justify-center py-12 ${className}`} role="status" aria-live="polite">
      <div className="text-6xl mb-4">{icon}</div>
      <h3 className="text-xl font-semibold mb-2 text-slate-800 dark:text-slate-100">{title}</h3>
      {description && <p className="text-sm text-gray-600 dark:text-slate-400 mb-4 text-center max-w-xl">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

export default EmptyState
