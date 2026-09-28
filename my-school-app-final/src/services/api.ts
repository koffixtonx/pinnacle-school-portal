import { createClient, type PostgrestError } from '@supabase/supabase-js';

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set. Copy .env.example to .env.local.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Sessions live in the browser's own storage; Supabase refreshes the access
    // token automatically, so the old /auth/refresh round-trip is gone.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  global: { headers: { 'x-application-name': 'pinnacle-school-portal' } },
});

/**
 * Pages throughout the app surface failures by reading
 * `err.response?.data?.message`, which is the axios shape. This keeps that
 * contract alive now that the transport is supabase-js instead of rewriting
 * every call site.
 */
export class ServiceError extends Error {
  response: { data: { message: string; code?: string } };

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ServiceError';
    this.response = { data: { message, code } };
  }
}

const FALLBACK_MESSAGES: Record<string, string> = {
  '23505': 'That record already exists.',
  '23503': 'This record is still referenced by other data.',
  '23514': 'One of the values is not allowed.',
  '42P01': 'The database schema has not been migrated yet.',
};

export function toServiceError(error: PostgrestError | Error | null, fallback = 'Request failed.'): ServiceError {
  if (!error) return new ServiceError(fallback);
  const code = (error as PostgrestError).code;
  const raw = error.message || '';
  // Postgres constraint names leak implementation detail into the UI.
  const message = raw && !/^duplicate key|violates/i.test(raw) ? raw : (code && FALLBACK_MESSAGES[code]) || raw || fallback;
  return new ServiceError(message, code);
}

type Row = Record<string, any>;

const camelKey = (key: string) => key.replace(/_([a-z0-9])/g, (_m, chr: string) => chr.toUpperCase());

/** Postgres columns are snake_case; the React pages speak camelCase. */
export function camel<T = any>(value: any): T {
  if (Array.isArray(value)) return value.map((item) => camel(item)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Row).map(([key, val]) => [camelKey(key), camel(val)]),
    ) as T;
  }
  return value as T;
}

export const fullName = (row?: Row | null) =>
  row ? `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() : '';

/** Person embeds are returned as `{ id, firstName, lastName }` everywhere. */
export const person = (row?: Row | null) =>
  row ? { id: row.id, firstName: row.first_name, lastName: row.last_name } : null;

export function paged<T>(data: T, nextCursor: string | null) {
  return { data, paging: { nextCursor } };
}

/**
 * Turns a `{ data, error }` PostgREST result into the plain value the service
 * layer expects, throwing a ServiceError on failure.
 *
 * `any` rather than an inferred type on purpose: this project has no generated
 * `Database` types, so the builders narrow write results to `never`, which
 * would poison every call site.
 */
export function unwrap<T = any>(result: { data: any; error: PostgrestError | null }, fallback?: string): T {
  if (result.error) throw toServiceError(result.error, fallback);
  return (result.data ?? (null as unknown as T)) as T;
}

export async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw toServiceError(error, 'Session unavailable.');
  const userId = data.session?.user?.id;
  if (!userId) throw new ServiceError('Authentication required.');
  return userId;
}

/**
 * Storage paths are stored as `bucket/object`. Legacy rows from the Express
 * era still hold `/uploads/<file>` values, which no longer resolve anywhere.
 */
export function resolveAssetUrl(path?: string | null): string {
  if (!path) return '';
  if (path.startsWith('http') || path.startsWith('data:') || path.startsWith('blob:')) return path;
  // Legacy rows written by the retired Express server; those files are gone.
  if (path.startsWith('/uploads')) return '';
  const [bucket, ...rest] = path.replace(/^\/+/, '').split('/');
  if (!bucket || !rest.length) return path;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
