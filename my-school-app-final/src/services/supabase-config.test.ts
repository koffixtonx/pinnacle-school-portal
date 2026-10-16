import { beforeEach, describe, expect, it, vi } from 'vitest';

// SUPABASE_CONFIG_ERROR is computed once when the module is first evaluated,
// which is exactly how the bundle behaves, so every case re-imports it.
async function load(url: string, anonKey: string) {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', url);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', anonKey);
  const { SUPABASE_CONFIG_ERROR } = await import('./supabase-config');
  return SUPABASE_CONFIG_ERROR;
}

const PROJECT_REF = 'ngvqnmgjkpegupkobhse';
const URL = `https://${PROJECT_REF}.supabase.co`;
const HEADER = 'eyJhbGciOiJIUTI1NiIsInR5cCI6IkpXVCJ9';
// A structurally complete legacy anon JWT, the way the dashboard hands one out.
const jwt = (payload: Record<string, string>) =>
  `${HEADER}.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.${'a'.repeat(43)}`;
const ANON_JWT = jwt({ role: 'anon', ref: PROJECT_REF });

beforeEach(() => {
  vi.unstubAllEnvs();
  // The start-up health probe would hit the network from every case.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in tests'))));
});

describe('supabase configuration guard', () => {
  it('accepts a matching URL and anon key', async () => {
    expect(await load(URL, ANON_JWT)).toBeNull();
  });

  it('accepts the newer publishable key format', async () => {
    expect(await load(URL, 'sb_publishable_abcdefghij0123456789')).toBeNull();
  });

  it('names both variables when they are missing', async () => {
    expect(await load('', '')).toContain('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set');
  });

  it('rejects a key that was pasted from a different project', async () => {
    const mismatched = await load(URL, jwt({ role: 'anon', ref: 'oth3rprojectref' }));
    expect(mismatched).toContain('belongs to');
    expect(mismatched).toContain(PROJECT_REF);
  });

  it('rejects a signature truncated by selecting the field text', async () => {
    const truncated = `${HEADER}.${ANON_JWT.split('.')[1]}.${'a'.repeat(10)}`;
    expect(await load(URL, truncated)).toContain('is truncated');
  });

  it('rejects the service_role key, which is a JWT too', async () => {
    expect(await load(URL, jwt({ role: 'service_role', ref: PROJECT_REF }))).toContain(
      'bypasses Row Level Security',
    );
  });

  it('rejects the sb_secret_ form of the same key', async () => {
    expect(await load(URL, 'sb_secret_AAAAAAAAAAAAAAAAAAAAAA')).toContain('secret API key');
  });

  it('rejects the unfilled placeholder from .env.example', async () => {
    expect(await load('https://YOUR-PROJECT-REF.supabase.co', 'your-publishable-or-anon-key')).toContain(
      'not a Supabase key',
    );
  });
});
