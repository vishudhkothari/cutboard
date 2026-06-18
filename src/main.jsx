import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './lib/ErrorBoundary'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)

// PWA: register the service worker (production only — it would fight Vite's dev
// server, and the demo/QA build skips it so it doesn't cache stale screenshots).
if ('serviceWorker' in navigator && import.meta.env.PROD && import.meta.env.VITE_DEMO !== '1') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
