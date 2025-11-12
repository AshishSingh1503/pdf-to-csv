import React, { useContext } from 'react'
import toast from 'react-hot-toast'
import ToastContext from './toastContext'

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

export default useToast
