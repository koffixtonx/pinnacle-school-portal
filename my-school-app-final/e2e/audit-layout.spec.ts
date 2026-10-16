import { expect, test } from '@playwright/test';
import {
  AUDIT_FIELDS,
  boxOf,
  fieldBox,
  hasAdminCredentials,
  labelBox,
  sameRow,
  signInAsAdmin,
  stackedBy,
} from './admin';

// The audit log is admin-only and its rows come from live changes, so this spec
// signs in for real and asserts layout and filter wiring only — never specific
// records. It stays skipped without a credential in the environment.
test.describe('audit log filter bar', () => {
  test.skip(!hasAdminCredentials, 'set E2E_ADMIN_SECRET to run the signed-in specs');
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto('/audit-log');
    await expect(page.locator(AUDIT_FIELDS[0])).toBeVisible();
    await expect(page.locator('.MuiSkeleton-root')).toHaveCount(0);
  });

  test('every field is one height and the four labels sit inside their borders', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const boxes = await Promise.all(AUDIT_FIELDS.map((field) => boxOf(page.locator(fieldBox(field)))));
    const labels = await Promise.all(AUDIT_FIELDS.map((field) => boxOf(page.locator(labelBox(field)))));

    expect(boxes.map((box) => box && Math.round(box.height))).toEqual([48, 48, 48, 48]);
    boxes.forEach((box, index) => {
      const label = labels[index];
      expect(label).not.toBeNull();
      if (!box || !label) return;
      // The floated label must clear the box's top edge and stay above its bottom
      // edge — the collision the old flex-wrap layout produced.
      expect(label.y >= box.y - 1).toBe(true);
      expect(label.y + label.height <= box.y + box.height + 1).toBe(true);
    });
  });

  test('under 768px the fields pair up with a 24px row gap and the buttons close the grid', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const boxes = await Promise.all(AUDIT_FIELDS.map((field) => boxOf(page.locator(fieldBox(field)))));

    expect(sameRow(boxes[0], boxes[1])).toBe(true);
    expect(sameRow(boxes[2], boxes[3])).toBe(true);
    expect(stackedBy(24)(boxes[0], boxes[2])).toBe(true);

    const to = boxes[3];
    const buttonRow = await boxOf(page.locator('div.MuiStack-root:has(> button:text-is("Refresh"))'));
    expect(stackedBy(24)(to, buttonRow)).toBe(true);
    // The button row spans the grid and right-aligns, so it ends where the field
    // above it ends.
    expect(buttonRow && to ? Math.abs(buttonRow.x + buttonRow.width - (to.x + to.width)) <= 1 : false).toBe(
      true,
    );
  });

  test('at 768px and wider all four fields share one row', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    const boxes = await Promise.all(AUDIT_FIELDS.map((field) => boxOf(page.locator(fieldBox(field)))));
    expect(boxes.every((box) => sameRow(box, boxes[0]))).toBe(true);
  });

  test('Clear counts the active filters and disappears once they are gone', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    // A fresh load must not pre-fill today's date: that silently hides older entries.
    await expect(page.getByRole('button', { name: /^Clear/ })).toHaveCount(0);
    expect(await page.locator('input[type="date"]').first().inputValue()).toBe('');

    await page.locator('input[type="date"]').first().fill('2026-01-01');
    await expect(page.getByRole('button', { name: 'Clear 1' })).toBeVisible();

    await page.locator('input[type="date"]').nth(1).fill('2026-12-31');
    await expect(page.getByRole('button', { name: 'Clear 2' })).toBeVisible();

    await page.getByRole('combobox', { name: 'Table' }).click();
    await page.getByRole('option', { name: 'Course registrations' }).click();
    await expect(page.getByRole('button', { name: 'Clear 3' })).toBeVisible();

    await page.getByRole('button', { name: 'Clear 3' }).click();
    await expect(page.getByRole('button', { name: /^Clear/ })).toHaveCount(0);
  });
});
