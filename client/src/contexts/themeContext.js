import { createContext } from 'react'

const ThemeContext = createContext()

// Re-export the provider from ThemeContext.jsx so imports like
// `import { ThemeProvider } from './contexts/ThemeContext'` continue to work
export { ThemeProvider } from './ThemeContext.jsx'

export default ThemeContext
