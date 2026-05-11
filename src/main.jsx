import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the app-level service worker (separate from the folder-sync SW).
// Enables Add-to-Home-Screen, offline-capable navigation, and asset caching.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = (import.meta.env?.BASE_URL || '/').replace(/\/$/, '')
    navigator.serviceWorker
      .register(`${base}/app-sw.js`, { scope: `${base}/` })
      .catch((err) => console.warn('[app-sw] registration failed:', err))
  })
}
