import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/albert-sans/400.css'
import '@fontsource/albert-sans/500.css'
import '@fontsource/albert-sans/600.css'
import '@fontsource/funnel-display/700.css'
import '@fontsource/funnel-display/800.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import { App } from './App'
import './app.css'

if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)) await import('./dev/standin')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
