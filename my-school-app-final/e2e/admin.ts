import type { Locator, Page } from '@playwright/test';

// The QA accounts live in the Supabase project this build points at. The
// password is never committed: pass it in the environment, and the signed-in
// specs stay skipped without it.
const ADMIN_ID = process.env.E2E_ADMIN_ID ?? 'koffixtonx+qoder-admin@gmail.com';
const ADMIN_SECRET = process.env.E2E_ADMIN_SECRET ?? '';

export const hasAdminCredentials = ADMIN_SECRET.length > 0;

/**
 * Signs in as a school administrator. This suite drives the real portal against
 * the real Supabase project the bundle was built for; there is no fixture
 * server. The audit log is admin-only and its rows come from live changes, so
 * only the layout and filter wiring is asserted here, never specific records.
 */
export async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.getByLabel('Email Address').fill(ADMIN_ID);
  await page.getByLabel('Password').fill(ADMIN_SECRET);
  await page.getByRole('button', { name: 'Sign In' }).click();
  // App.tsx treats a session as live only once the profile is mirrored into
  // localStorage, which is also what the route guard reads.
  await page.waitForFunction(() => !!localStorage.getItem('user'), null, { timeout: 30_000 });
}

export const AUDIT_FIELDS = [
  '.MuiTextField-root:has(> .MuiFormLabel-root:text-is("Table"))',
  '.MuiTextField-root:has(> .MuiFormLabel-root:text-is("Action"))',
  '.MuiTextField-root:has(> .MuiFormLabel-root:text-is("From"))',
  '.MuiTextField-root:has(> .MuiFormLabel-root:text-is("To"))',
];

/** The bordered box is `.MuiOutlinedInput-root`; the inner input is only part of it. */
export const fieldBox = (field: string): string => `${field} .MuiOutlinedInput-root`;

/** The label floated inside that box, which is what must not collide. */
export const labelBox = (field: string): string => `${field} .MuiFormLabel-root`;

export const boxOf = (locator: Locator) => locator.boundingBox();

export const sameRow = (a: { y: number } | null, b: { y: number } | null): boolean =>
  !!a && !!b && Math.abs(a.y - b.y) < 2;

/** True when `below` starts exactly `gap` pixels after `above` ends. */
export const stackedBy =
  (gap: number) =>
  (
    above: { y: number; height: number } | null,
    below: { y: number; height: number } | null,
  ): boolean => !!above && !!below && Math.round(below.y - (above.y + above.height)) === gap;
