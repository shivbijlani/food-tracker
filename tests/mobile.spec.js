import { test, expect } from '@playwright/test';

test('Mobile Advanced Mode Parallel Estimation UI', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); // iPhone 12 Mini
  await page.goto('http://localhost:5173');

  // Wait for storage
  await page.waitForSelector('.app-title');

  // Ensure we are in Advanced Mode
  const isSimple = await page.isVisible('text=Today\'s plan');
  if (isSimple) {
    await page.click('.settings-btn');
    await page.click('text=Advanced');
    await page.click('button:has-text("✕"), .settings-modal-header button');
  }

  // Type multi-item description
  await page.fill('textarea[placeholder*="e.g."]', '2 eggs, bacon, toast');

  // Click estimate
  await page.click('text=Estimate nutrition');

  // Wait for loading states
  await page.waitForSelector('.preview-item');

  // Verify 3 items plus Total
  const previews = page.locator('.preview-item');
  await expect(previews).toHaveCount(3);

  await expect(page.locator('text=Total')).toBeVisible();

  // Check layout of stats (should be 3 columns)
  const firstStatGrid = page.locator('.preview-item .stat-grid').first();
  await expect(firstStatGrid).toBeVisible();

  // Take screenshot
  await page.screenshot({ path: 'mobile_advanced.png', fullPage: true });
});

test('Mobile Simple Mode Parallel Estimation UI', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); // iPhone 12 Mini
  await page.goto('http://localhost:5173');

  // Switch to Simple Mode
  await page.click('.settings-btn');
  await page.click('text=Simple');
  await page.click('button:has-text("✕"), .settings-modal-header button');

  // Type multi-item description
  await page.fill('input[placeholder*="protein shake"]', 'protein shake, chicken breast');

  // Click estimate
  await page.click('text=Estimate');

  // Wait for items
  await page.waitForSelector('.simple-estimate-item');

  const items = page.locator('.simple-estimate-item');
  await expect(items).toHaveCount(2);

  await expect(page.locator('text=Total: 0g pro')).toBeVisible();

  // Take screenshot
  await page.screenshot({ path: 'mobile_simple.png', fullPage: true });
});
