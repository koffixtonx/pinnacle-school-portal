// Read and validated here, rather than inside api.ts, so the app can report a
// bad configuration on screen: api.ts throws, and nothing that imports it
// renders. A hand-pasted anon key is the usual culprit, and the failure is
// otherwise invisible — createClient accepts anything and every later request
// dies with an opaque network or 401 error.

export const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
export const SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

const decodePayload = (token: string): Record<string, unknown> | null => {
  const segment = token.split('.')[1];
  if (!segment) return null;
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
  } catch {
    return null;
  }
};

const describe = (url: string, anonKey: string): string[] => {
  const problems: string[] = [];
  if (!url || !anonKey) {
    return ['VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set. Copy .env.example to .env.local.'];
  }

  let projectRef: string | null = null;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) {
      problems.push(`VITE_SUPABASE_URL must be http(s), got "${url}".`);
    } else if (parsed.hostname.endsWith('.supabase.co')) {
      projectRef = parsed.hostname.slice(0, -'.supabase.co'.length);
    }
  } catch {
    problems.push(`VITE_SUPABASE_URL is not a valid URL: "${url}".`);
  }

  // The dashboard hands out two shapes: the legacy anon key, which is a JWT, and
  // the newer sb_publishable_… key, which is not. Only the legacy one can be
  // checked structurally here.
  if (/^eyJ/.test(anonKey)) {
    const segments = anonKey.split('.');
    if (segments.length !== 3) {
      problems.push(
        `VITE_SUPABASE_ANON_KEY is not a complete JWT (found ${segments.length} dot-separated ` +
          'part(s), expected 3). Use the "Copy" button in Project Settings; selecting the field text truncates it.',
      );
    } else {
      // Supabase signs anon keys with HS256, so a complete signature is 32 bytes,
      // which base64url writes as exactly 43 characters. Shorter means cut off.
      if (segments[2].length < 43) {
        problems.push(
          `VITE_SUPABASE_ANON_KEY is truncated: its signature is ${segments[2].length} ` +
            'character(s), a complete one is 43. Copy the key with the "Copy" button.',
        );
      }
      const payload = decodePayload(anonKey);
      if (!payload) {
        problems.push('VITE_SUPABASE_ANON_KEY has a payload that is not decodable JSON.');
      } else {
        if (payload.role === 'service_role') {
          problems.push(
            'VITE_SUPABASE_ANON_KEY is the service_role key. It bypasses Row Level Security ' +
              'and must never be inlined into a browser bundle; use the anon key here.',
          );
        }
        if (projectRef && typeof payload.ref === 'string' && payload.ref !== projectRef) {
          problems.push(
            `VITE_SUPABASE_URL points at project "${projectRef}" but VITE_SUPABASE_ANON_KEY belongs ` +
              `to "${payload.ref}". Both must come from the same project.`,
          );
        }
      }
    }
  } else if (/^sb_(secret|admin)_/.test(anonKey)) {
    problems.push(
      'VITE_SUPABASE_ANON_KEY is a secret API key. It bypasses Row Level Security and must ' +
        'stay on a server; use the publishable key in a browser.',
    );
  } else if (!/^sb_(publishable|public|anon)_/.test(anonKey)) {
    problems.push(
      `VITE_SUPABASE_ANON_KEY is not a Supabase key: it starts with "${anonKey.slice(0, 6)}" ` +
        'instead of "eyJ" (legacy anon) or "sb_publishable" (new key).',
    );
  }

  probe(url, anonKey);
  return problems;
};

// Confirms in development that the named project resolves. Both a self-hosted
// URL and a deleted or paused project pass the checks above. GoTrue's health
// endpoint answers 200 for any valid key, unlike /rest/v1/, which Supabase
// restricts to secret keys and so would log a spurious 401 on every load.
const probe = (url: string, anonKey: string): void => {
  if (!import.meta.env.DEV) return;
  void fetch(`${url.replace(/\/$/, '')}/auth/v1/health`, {
    headers: { apikey: anonKey },
    signal: AbortSignal.timeout(8000),
  })
    .then((res) => {
      if (!res.ok) console.error(`[supabase] ${url} replied ${res.status}.`);
    })
    .catch((err: unknown) => {
      console.error(
        `[supabase] ${url} is unreachable (${err instanceof Error ? err.message : String(err)}). ` +
          'A domain that does not resolve means that project does not exist.',
      );
    });
};

export const SUPABASE_CONFIG_ERROR: string | null = (() => {
  const problems = describe(SUPABASE_URL, SUPABASE_ANON_KEY);
  return problems.length ? problems.join('\n') : null;
})();
