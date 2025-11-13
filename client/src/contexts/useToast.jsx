import React, { useContext } from 'react'
import ToastContext from './toastContext'

export const useToast = () => {
  const ctx = useContext(ToastContext)
  if (ctx) return ctx
  // fallback (no UI): map to console/window.confirm
  return {
    showSuccess: (m) => console.log(m),
    showError: (m) => console.error(m),
    showInfo: (m) => console.log(m),
    showWarning: (m) => console.warn(m),
    showConfirm: (m, onConfirm = () => {}, onCancel = () => {}) => {
      const ok = window.confirm(m)
      if (ok) onConfirm(); else onCancel();
      return ok
    }
  }
}

export default useToast
