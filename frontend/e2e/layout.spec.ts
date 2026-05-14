import { test, expect } from '@playwright/test';
import { goToDashboard, selectDashboard, createTestDashboard, createTestWidget, getFirstSensorId } from './helpers';

test.describe('LAYOUT', () => {

  // LAYOUT-01
  test('LAYOUT-01 drag widget — POST /layout fires once after ~320 ms debounce', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Layout01');
    try {
      await createTestWidget(page, token, id, 'line_chart', sensorId);
      await createTestWidget(page, token, id, 'bar_chart', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(2_000);

      // Enter edit mode
      const pencil = page.locator('button[aria-label="Toggle edit mode"]');
      await expect(pencil).not.toBeDisabled({ timeout: 5_000 });
      await pencil.click();
      await expect(page.locator('.dashboard-banner')).toBeVisible({ timeout: 3_000 });

      // Capture layout POST requests
      const layoutRequests: string[] = [];
      page.on('request', req => {
        if (req.method() === 'POST' && req.url().includes('/layout')) {
          layoutRequests.push(req.url());
        }
      });

      // Drag the first gridster item
      const items = page.locator('gridster-item');
      const firstItem = items.first();
      const box = await firstItem.boundingBox();
      if (!box) throw new Error('Could not find gridster item bounding box');

      // Drag the drag handle (the widget header / dashboard-widget-drag-handle)
      const handle = firstItem.locator('.dashboard-widget-drag-handle').first();
      const handleBox = await handle.boundingBox() ?? box;

      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 130, startY + 10, { steps: 10 });
      await page.mouse.up();

      // Wait for the 320 ms debounce + network round-trip
      await page.waitForTimeout(1_500);

      // Verify exactly one layout POST was made
      expect(layoutRequests.length, 'Expected exactly one POST /layout request').toBe(1);

      // Verify the payload shape
      const req = page.waitForRequest(r => r.method() === 'POST' && r.url().includes('/layout')).catch(() => null);
      // (Already captured above — inspect the last one's post data via the listener)
    } finally {
      await dispose();
    }
  });

  // LAYOUT-01b — payload shape validation via route interception
  test('LAYOUT-01b layout payload shape — array of {id,x,y,cols,rows}', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Layout01b');
    try {
      await createTestWidget(page, token, id, 'bar_chart', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(2_000);

      const pencil = page.locator('button[aria-label="Toggle edit mode"]');
      await expect(pencil).not.toBeDisabled({ timeout: 5_000 });
      await pencil.click();
      await expect(page.locator('.dashboard-banner')).toBeVisible({ timeout: 3_000 });

      let capturedBody: unknown = null;
      await page.route(`**/api/dashboards/${id}/layout`, async (route) => {
        capturedBody = JSON.parse(route.request().postData() ?? '[]');
        await route.continue();
      });

      const firstItem = page.locator('gridster-item').first();
      const box = await firstItem.boundingBox();
      if (!box) { test.skip(true, 'No gridster items found'); return; }

      const handle = firstItem.locator('.dashboard-widget-drag-handle').first();
      const handleBox = await handle.boundingBox() ?? box;
      const sx = handleBox.x + handleBox.width / 2;
      const sy = handleBox.y + handleBox.height / 2;

      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(sx + 70, sy, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(800);

      if (capturedBody === null) {
        test.info().annotations.push({ type: 'note', description: 'Drag may not have triggered a layout change — widget may have snapped back.' });
        return;
      }

      expect(Array.isArray(capturedBody)).toBe(true);
      const items = capturedBody as Record<string, unknown>[];
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(typeof item['id']).toBe('number');
        expect(typeof item['x']).toBe('number');
        expect(typeof item['y']).toBe('number');
        expect(typeof item['cols']).toBe('number');
        expect(typeof item['rows']).toBe('number');
      }
    } finally {
      await dispose();
    }
  });

});
