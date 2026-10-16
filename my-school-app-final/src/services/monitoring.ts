// Error reporting is opt-in. Without a DSN the SDK is still in the bundle but is
// never initialised, so no event, no session and no school data leaves the page.
// A DSN is a write-only ingest key, but it decides where crashes go, so it
// belongs in build-time env like the other VITE_ values.
import * as Sentry from '@sentry/react';

const DSN = String(import.meta.env.VITE_SENTRY_DSN ?? '').trim();

export const MONITORING_ENABLED = DSN.length > 0;

// The signed-in profile lives in localStorage (see hooks/useCurrentUser), and
// every auth path writes it. Reading it at report time means one place to keep
// correct instead of a setUser call in each of them. Only the row id and role
// are attached — names and email would be needless PII in an error payload.
function currentActor(): { id: string; role: string } | null {
  try {
    const raw = window.localStorage.getItem('user');
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { id, role } = parsed as { id?: unknown; role?: unknown };
    return typeof id === 'string' && typeof role === 'string' ? { id, role } : null;
  } catch {
    return null;
  }
}

export function initMonitoring(): void {
  if (!MONITORING_ENABLED) return;

  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    beforeSend(event) {
      const actor = currentActor();
      if (actor) {
        event.user = { id: actor.id };
        event.tags = { ...event.tags, role: actor.role };
      }
      return event;
    },
  });
}

// Scope the context to this one event instead of setContext, which would attach
// it to every later report from the same page load.
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!MONITORING_ENABLED) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
