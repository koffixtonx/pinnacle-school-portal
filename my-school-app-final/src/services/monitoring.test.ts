import { beforeEach, describe, expect, it, vi } from 'vitest';

const { init, captureException } = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn() }));
vi.mock('@sentry/react', () => ({ init, captureException }));

type InitOptions = {
  beforeSend?: (event: Record<string, unknown>) => Record<string, unknown>;
};

// The module reads the DSN once, at import, exactly as Vite inlines it into the
// bundle — so each case re-imports it with the environment it would ship with.
async function load(dsn: string) {
  vi.resetModules();
  vi.stubEnv('VITE_SENTRY_DSN', dsn);
  return import('./monitoring');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe('monitoring', () => {
  it('stays inert with no DSN configured', async () => {
    const { MONITORING_ENABLED, initMonitoring, reportError } = await load('');
    expect(MONITORING_ENABLED).toBe(false);

    initMonitoring();
    reportError(new Error('boom'));
    expect(init).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('initialises and reports once a DSN is present', async () => {
    const { initMonitoring, reportError } = await load('https://k@o0.ingest.sentry.io/1');
    initMonitoring();
    expect(init).toHaveBeenCalledTimes(1);

    reportError(new Error('boom'), { route: '/audit-log' });
    expect(captureException).toHaveBeenCalledTimes(1);
    // Context goes with the event, not onto the scope, so it cannot leak into
    // the next unrelated report.
    expect(captureException.mock.calls[0]?.[1]).toEqual({ extra: { route: '/audit-log' } });
  });

  it('tags a report with the signed-in id and role, and nothing else', async () => {
    const { initMonitoring } = await load('https://k@o0.ingest.sentry.io/1');
    initMonitoring();
    window.localStorage.setItem(
      'user',
      JSON.stringify({
        id: '7c1a-uuid',
        email: 'koffixtonx+qoder-student@gmail.com',
        firstName: 'Smoke',
        lastName: 'Test',
        role: 'STUDENT',
      }),
    );

    const { beforeSend } = init.mock.calls[0]?.[0] as InitOptions;
    const event = beforeSend?.({}) ?? {};
    expect(event.user).toEqual({ id: '7c1a-uuid' });
    expect(event.tags).toEqual({ role: 'STUDENT' });
    // A crash report must not become a grade sheet or a fee statement.
    expect(JSON.stringify(event)).not.toMatch(/Smoke|Test|gmail/);
  });

  it('sends an anonymous event when nobody is signed in', async () => {
    const { initMonitoring } = await load('https://k@o0.ingest.sentry.io/1');
    initMonitoring();
    window.localStorage.setItem('user', 'not json');

    const { beforeSend } = init.mock.calls[0]?.[0] as InitOptions;
    expect(beforeSend?.({})).toEqual({});
  });
});
