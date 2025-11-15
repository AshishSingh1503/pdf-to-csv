import { createContext } from 'react'

// DELETED: toast context shim - kept temporarily for compatibility during cleanup.
const ToastContext = createContext(null)

export { ToastProvider } from './ToastContext.jsx'

export default ToastContext
