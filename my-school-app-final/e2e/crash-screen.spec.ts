import { expect, test } from '@playwright/test';

// A redeploy un-publishes the chunk an already-open tab asks for next. That
// rejects the dynamic import in main.tsx rather than throwing during render, so
// it needs its own path to the crash screen — otherwise the visitor sees a blank
// page with nothing to click.
test('a chunk that fails to load still shows the crash screen', async ({ page }) => {
  await page.route('**/assets/App-*.js', (route) => route.abort());
  await page.goto('/login');

  await expect(page.getByText('This page could not be displayed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
});
