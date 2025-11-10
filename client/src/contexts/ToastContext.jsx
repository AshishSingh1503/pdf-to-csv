import React, { createContext, useContext } from 'react'
import toast, { Toaster } from 'react-hot-toast'
import { useTheme } from './ThemeContext'

const ToastContext = createContext(null)

export const ToastProvider = ({ children }) => {
  const { effectiveTheme } = useTheme()

  const showSuccess = (msg, opts = {}) => toast.success(msg, { duration: 4000, ...opts })
  const showError = (msg, opts = {}) => toast.error(msg, { duration: 6000, ...opts })
  const showInfo = (msg, opts = {}) => toast(msg, { icon: 'ℹ️', duration: 4000, ...opts })
  const showWarning = (msg, opts = {}) => toast(msg, { icon: '⚠️', duration: 5000, ...opts })

  const showConfirm = (message, onConfirm = () => {}, onCancel = () => {}) => {
    const id = toast.custom(() => (
      <div
        className={`max-w-md w-full bg-white dark:bg-slate-800 rounded shadow p-4 border`}
        role="dialog"
        aria-modal="true"
        aria-live="polite"
      >
        <div className="flex items-start justify-between">
          <div className="mr-3">
            <div className="text-sm text-slate-900 dark:text-slate-100">{message}</div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => { toast.dismiss(id); onCancel(); }}
              className="px-3 py-1 rounded bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-slate-700 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-blue-500"
              aria-label="Cancel"
            >
              Cancel
            </button>
            <button
              onClick={() => { toast.dismiss(id); onConfirm(); }}
              className="px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-red-500"
              aria-label="Confirm delete"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    ), { duration: Infinity })
    return id
  }

  const ctx = { showSuccess, showError, showInfo, showWarning, showConfirm }

  return (
    <ToastContext.Provider value={ctx}>
      <Toaster
        key={effectiveTheme}
        position="top-right"
        reverseOrder={false}
        toastOptions={{
          duration: 4000,
          style: {
            background: effectiveTheme === 'dark' ? '#0f172a' : '#ffffff',
            color: effectiveTheme === 'dark' ? '#e6eef8' : '#0f172a',
            boxShadow: 'var(--tw-shadow, 0 2px 10px rgba(2,6,23,0.2))',
          },
        }}
      />
      {children}
    </ToastContext.Provider>
  )
}

export const useToast = () => {
  const ctx = useContext(ToastContext)
  if (ctx) return ctx
  // fallback (shouldn't be used if provider is mounted)
  return {
    showSuccess: (m, o) => toast.success(m, o),
    showError: (m, o) => toast.error(m, o),
    showInfo: (m, o) => toast(m, o),
    showWarning: (m, o) => toast(m, o),
    showConfirm: (m, onConfirm = () => {}, onCancel = () => {}) => {
      const id = toast.custom(() => (
        <div className={`max-w-md w-full bg-white dark:bg-slate-800 rounded shadow p-4 border`} role="dialog" aria-modal="true">
          <div className="flex items-start justify-between"><div className="mr-3"><div className="text-sm text-slate-900 dark:text-slate-100">{m}</div></div>
          <div className="flex items-center space-x-2"><button onClick={() => { toast.dismiss(id); onCancel(); }} className="px-3 py-1 rounded bg-gray-200">Cancel</button><button onClick={() => { toast.dismiss(id); onConfirm(); }} className="px-3 py-1 rounded bg-red-600 text-white">Delete</button></div></div>
        </div>
      ), { duration: Infinity })
      return id
    }
  }
}

export default ToastContext
