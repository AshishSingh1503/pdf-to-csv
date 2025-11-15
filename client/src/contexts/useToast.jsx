// Toast system removed — hook kept as a harmless stub that logs to console.
// DELETED: Toast hook removed. This file is a placeholder pending removal.
export const useToast = () => ({
  showSuccess: (m) => console.log(m),
  showError: (m) => console.error(m),
  showInfo: (m) => console.log(m),
  showWarning: (m) => console.warn(m),
  showConfirm: (m, onConfirm = () => {}, onCancel = () => {}) => {
    const ok = window.confirm(m)
    if (ok) onConfirm(); else onCancel()
    return ok
  }
})

export default useToast
