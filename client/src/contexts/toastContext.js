import { createContext } from 'react'

const ToastContext = createContext(null)

// Re-export the provider from ToastContext.jsx so imports like
// `import { ToastProvider } from './contexts/ToastContext'` continue to work
export { ToastProvider } from './ToastContext.jsx'

export default ToastContext
