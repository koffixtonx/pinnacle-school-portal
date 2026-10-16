import { expect, test } from '@playwright/test';

// Nothing here reaches Supabase: these routes bounce to /login before they load
// a list, so the suite runs without credentials and without touching any data.
test('an anonymous visitor on /audit-log is sent to the sign-in page', async ({ page }) => {
  await page.goto('/audit-log');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  await expect(page.getByLabel('Email Address')).toBeVisible();
});

test('an anonymous visitor on /students is sent to the sign-in page', async ({ page }) => {
  await page.goto('/students');
  await expect(page).toHaveURL(/\/login$/);
});

test('an anonymous visitor on /settings is sent to the sign-in page', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login$/);
});
