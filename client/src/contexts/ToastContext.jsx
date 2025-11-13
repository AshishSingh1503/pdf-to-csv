import React from 'react'
import ToastContext from './toastContext'

export const ToastProvider = ({ children }) => {
  // Provide a no-op / console-based implementation so components importing the provider
  // won't break until all toast usages are fully removed.

  const showSuccess = (msg) => console.log(msg)
  const showError = (msg) => console.error(msg)
  const showInfo = (msg) => console.log(msg)
  const showWarning = (msg) => console.warn(msg)
  const showConfirm = (message, onConfirm = () => {}, onCancel = () => {}) => {
    const ok = window.confirm(message)
    if (ok) onConfirm(); else onCancel();
    return ok
  }

  const ctx = { showSuccess, showError, showInfo, showWarning, showConfirm }

  return (
    <ToastContext.Provider value={ctx}>
      {children}
    </ToastContext.Provider>
  )
}
