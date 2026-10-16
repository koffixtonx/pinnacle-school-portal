import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ErrorBoundary, { FatalScreen } from './components/ErrorBoundary'
import { initMonitoring, reportError } from './services/monitoring'
import { SUPABASE_CONFIG_ERROR } from './services/supabase-config'

// Before the first render, so a crash during mount is reported and caught.
initMonitoring()

const root = createRoot(document.getElementById('root')!)

if (SUPABASE_CONFIG_ERROR) {
  // App.tsx imports the service layer, which refuses to evaluate on a bad
  // config, so the message has to be rendered from above that import graph.
  root.render(
    <div style={{ maxWidth: 720, margin: '12vh auto', padding: '0 24px', font: '14px/1.6 ui-monospace, monospace' }}>
      <h2 style={{ fontSize: 18 }}>Check the Supabase configuration</h2>
      <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
        {SUPABASE_CONFIG_ERROR}
      </pre>
      <p>
        Both values come from Project Settings &rarr; API in the Supabase dashboard.{' '}
        {import.meta.env.DEV ? (
          <>
            Put them in <code>.env.local</code>, then restart <code>npm run dev</code> — Vite
            inlines them at start-up, so an edit made after the server launched is not picked up.
          </>
        ) : (
          <>
            This bundle was built without them. Set <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> as environment variables where the site is built,
            then redeploy — they are inlined at build time, so the live deployment keeps its old
            bundle until a new one is built.
          </>
        )}
      </p>
    </div>,
  )
} else {
  void import('./App.tsx')
    .then(({ default: App }) => {
      root.render(
        <StrictMode>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </StrictMode>,
      )
    })
    .catch((error: unknown) => {
      // A chunk that 404s after a redeploy rejects this import instead of
      // throwing during render, so ErrorBoundary below never sees it.
      reportError(error)
      root.render(<FatalScreen error={error} />)
    })
}
