import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../services/monitoring';

// Plain DOM with inline styles, on purpose: this renders when ThemeProvider or
// the router is what broke — the same reason main.tsx hand-rolls the Supabase
// config error screen.
export function FatalScreen({ error }: { error: unknown }): ReactNode {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div
      style={{
        maxWidth: 640,
        margin: '12vh auto',
        padding: '0 24px',
        font: '14px/1.6 system-ui, sans-serif',
        color: '#1c2333',
      }}
    >
      <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>This page could not be displayed</h2>
      <p style={{ margin: '0 0 16px' }}>
        The rest of the portal is still available. Reloading usually clears this.
      </p>
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: '#f5f5f5',
          padding: 16,
          borderRadius: 8,
          margin: '0 0 16px',
          font: '12px/1.5 ui-monospace, monospace',
        }}
      >
        {message || 'Unknown error'}
      </pre>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          font: 'inherit',
          padding: '9px 18px',
          borderRadius: 8,
          border: '1px solid #1c2333',
          background: '#1c2333',
          color: '#fff',
          cursor: 'pointer',
        }}
      >
        Reload
      </button>
    </div>
  );
}

interface State {
  error: unknown;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, { componentStack: info.componentStack });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error) return <FatalScreen error={error} />;
    return this.props.children;
  }
}
