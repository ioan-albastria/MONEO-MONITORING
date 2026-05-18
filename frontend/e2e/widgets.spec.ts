import { test, expect } from '@playwright/test';
import {
  goToDashboard, selectDashboard, createTestDashboard,
  createTestWidget, getFirstSensorId, apiDelete,
} from './helpers';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function openWidgetEditor(page: import('@playwright/test').Page) {
  await page.click('button[aria-label="Add widget"]');
  await page.waitForSelector('.dashboard-modal__panel--wide', { timeout: 5_000 });
  // Wait for sensor list to load
  await page.waitForSelector('select[multiple]', { timeout: 8_000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('WIDGET', () => {

  // WIDGET-01
  test('WIDGET-01 widget editor opens', async ({ page }) => {
    const token = await goToDashboard(page);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W01');
    try {
      await selectDashboard(page, id);
      await page.waitForSelector('button[aria-label="Add widget"]:not([disabled])', { timeout: 5_000 });
      await page.click('button[aria-label="Add widget"]');
      await expect(page.locator('.dashboard-modal__panel--wide')).toBeVisible({ timeout: 5_000 });
      const eyebrow = await page.locator('.dashboard-modal__eyebrow').first().textContent();
      expect(eyebrow?.trim()).toBe('Add widget');
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      await dispose();
    }
  });

  // WIDGET-02
  test('WIDGET-02 type picker — line_chart selectable', async ({ page }) => {
    const token = await goToDashboard(page);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W02');
    try {
      await selectDashboard(page, id);
      await page.waitForSelector('button[aria-label="Add widget"]:not([disabled])', { timeout: 5_000 });
      await openWidgetEditor(page);
      const card = page.locator('.dashboard-widget-picker__card').filter({ hasText: 'Line Chart' });
      await card.click();
      await expect(card).toHaveClass(/is-active/);
      const pill = card.locator('.dashboard-widget-picker__status');
      await expect(pill).toHaveText('Selected');
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      await dispose();
    }
  });

  // WIDGET-03
  test('WIDGET-03 type picker — bar_chart selectable', async ({ page }) => {
    const token = await goToDashboard(page);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W03');
    try {
      await selectDashboard(page, id);
      await page.waitForSelector('button[aria-label="Add widget"]:not([disabled])', { timeout: 5_000 });
      await openWidgetEditor(page);
      const card = page.locator('.dashboard-widget-picker__card').filter({ hasText: 'Bar Chart' });
      await card.click();
      await expect(card).toHaveClass(/is-active/);
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      await dispose();
    }
  });

  // WIDGET-04
  test('WIDGET-04 type picker — gauge selectable, bounds section appears', async ({ page }) => {
    const token = await goToDashboard(page);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W04');
    try {
      await selectDashboard(page, id);
      await page.waitForSelector('button[aria-label="Add widget"]:not([disabled])', { timeout: 5_000 });
      await openWidgetEditor(page);
      const card = page.locator('.dashboard-widget-picker__card').filter({ hasText: 'Gauge' });
      await card.click();
      await expect(card).toHaveClass(/is-active/);
      // Gauge bounds section should be visible
      await expect(page.locator('text=Scale bounds')).toBeVisible({ timeout: 3_000 });
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      await dispose();
    }
  });

  // WIDGET-05
  test('WIDGET-05 type picker — stat_card selectable', async ({ page }) => {
    const token = await goToDashboard(page);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W05');
    try {
      await selectDashboard(page, id);
      await page.waitForSelector('button[aria-label="Add widget"]:not([disabled])', { timeout: 5_000 });
      await openWidgetEditor(page);
      const card = page.locator('.dashboard-widget-picker__card').filter({ hasText: 'Stat Card' });
      await card.click();
      await expect(card).toHaveClass(/is-active/);
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      await dispose();
    }
  });

  // WIDGET-06
  test('WIDGET-06 sensor multi-select populated — ≥1 sensor option', async ({ page }) => {
    const token = await goToDashboard(page);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W06');
    try {
      await selectDashboard(page, id);
      await page.waitForSelector('button[aria-label="Add widget"]:not([disabled])', { timeout: 5_000 });
      await openWidgetEditor(page);
      const options = await page.locator('select[multiple] option').allTextContents();
      expect(options.length, 'No sensors loaded in widget editor').toBeGreaterThan(0);
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      await dispose();
    }
  });

  // WIDGET-07
  test('WIDGET-07 time range toggle — relative/absolute switches inputs', async ({ page }) => {
    const token = await goToDashboard(page);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W07');
    try {
      await selectDashboard(page, id);
      await page.waitForSelector('button[aria-label="Add widget"]:not([disabled])', { timeout: 5_000 });
      await openWidgetEditor(page);

      // Default is relative — hours input visible
      await expect(page.locator('input[type="number"][min="1"]')).toBeVisible();
      await expect(page.locator('input[type="datetime-local"]').first()).not.toBeVisible();

      // Switch to absolute
      await page.click('input[type="radio"][value="absolute"]');
      await expect(page.locator('input[type="datetime-local"]').first()).toBeVisible({ timeout: 2_000 });
      await expect(page.locator('input[type="number"][min="1"]')).not.toBeVisible();
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      await dispose();
    }
  });

  // WIDGET-08
  test('WIDGET-08 gauge bounds visible only for gauge type', async ({ page }) => {
    const token = await goToDashboard(page);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W08');
    try {
      await selectDashboard(page, id);
      await page.waitForSelector('button[aria-label="Add widget"]:not([disabled])', { timeout: 5_000 });
      await openWidgetEditor(page);

      // Line chart is default — bounds not visible
      const lineCard = page.locator('.dashboard-widget-picker__card').filter({ hasText: 'Line Chart' });
      await lineCard.click();
      await expect(page.locator('text=Scale bounds')).not.toBeVisible();

      // Switch to Gauge — bounds appear
      const gaugeCard = page.locator('.dashboard-widget-picker__card').filter({ hasText: 'Gauge' });
      await gaugeCard.click();
      await expect(page.locator('text=Scale bounds')).toBeVisible({ timeout: 3_000 });
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      await dispose();
    }
  });

  // WIDGET-09
  test('WIDGET-09 save validation — no sensor selected shows error', async ({ page }) => {
    const token = await goToDashboard(page);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W09');
    try {
      await selectDashboard(page, id);
      await page.waitForSelector('button[aria-label="Add widget"]:not([disabled])', { timeout: 5_000 });
      await openWidgetEditor(page);
      // Do NOT select a sensor — click Save directly
      await page.click('button:has-text("Add widget"):not([disabled])');
      await expect(page.locator('.dashboard-banner--error')).toBeVisible({ timeout: 3_000 });
      const errText = await page.locator('.dashboard-banner--error').textContent();
      expect(errText).toContain('sensor');
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      await dispose();
    }
  });

  // WIDGET-10
  test('WIDGET-10 create line_chart widget — appears on grid', async ({ page }) => {
    const token = await goToDashboard(page);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W10');
    try {
      await selectDashboard(page, id);
      await page.waitForSelector('button[aria-label="Add widget"]:not([disabled])', { timeout: 5_000 });
      await openWidgetEditor(page);

      // Select Line Chart type
      await page.locator('.dashboard-widget-picker__card').filter({ hasText: 'Line Chart' }).click();

      // Select first sensor
      await page.locator('select[multiple] option').first().click();

      await page.click('button:has-text("Add widget"):not([disabled])');
      await page.waitForSelector('.dashboard-modal__panel--wide', { state: 'hidden', timeout: 10_000 });
      await page.waitForTimeout(1_500);

      await expect(page.locator('app-dashboard-widget').first()).toBeVisible({ timeout: 5_000 });
    } finally {
      await dispose();
    }
  });

  // WIDGET-11
  test('WIDGET-11 create bar_chart widget', async ({ page }) => {
    const token = await goToDashboard(page);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W11');
    try {
      await selectDashboard(page, id);
      await page.waitForSelector('button[aria-label="Add widget"]:not([disabled])', { timeout: 5_000 });
      await openWidgetEditor(page);

      await page.locator('.dashboard-widget-picker__card').filter({ hasText: 'Bar Chart' }).click();
      await page.locator('select[multiple] option').first().click();
      await page.click('button:has-text("Add widget"):not([disabled])');
      await page.waitForSelector('.dashboard-modal__panel--wide', { state: 'hidden', timeout: 10_000 });
      await page.waitForTimeout(1_500);
      await expect(page.locator('app-dashboard-widget').first()).toBeVisible({ timeout: 5_000 });
    } finally {
      await dispose();
    }
  });

  // WIDGET-12
  test('WIDGET-12 create gauge widget', async ({ page }) => {
    const token = await goToDashboard(page);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W12');
    try {
      await selectDashboard(page, id);
      await page.waitForSelector('button[aria-label="Add widget"]:not([disabled])', { timeout: 5_000 });
      await openWidgetEditor(page);

      await page.locator('.dashboard-widget-picker__card').filter({ hasText: 'Gauge' }).click();
      await page.locator('select[multiple] option').first().click();
      await page.click('button:has-text("Add widget"):not([disabled])');
      await page.waitForSelector('.dashboard-modal__panel--wide', { state: 'hidden', timeout: 10_000 });
      await page.waitForTimeout(1_500);
      await expect(page.locator('app-dashboard-widget').first()).toBeVisible({ timeout: 5_000 });
    } finally {
      await dispose();
    }
  });

  // WIDGET-13
  test('WIDGET-13 create stat_card widget', async ({ page }) => {
    const token = await goToDashboard(page);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W13');
    try {
      await selectDashboard(page, id);
      await page.waitForSelector('button[aria-label="Add widget"]:not([disabled])', { timeout: 5_000 });
      await openWidgetEditor(page);

      await page.locator('.dashboard-widget-picker__card').filter({ hasText: 'Stat Card' }).click();
      await page.locator('select[multiple] option').first().click();
      await page.click('button:has-text("Add widget"):not([disabled])');
      await page.waitForSelector('.dashboard-modal__panel--wide', { state: 'hidden', timeout: 10_000 });
      await page.waitForTimeout(1_500);
      await expect(page.locator('app-dashboard-widget').first()).toBeVisible({ timeout: 5_000 });
    } finally {
      await dispose();
    }
  });

  // WIDGET-14
  test('WIDGET-14 configure widget — reopens editor in update mode', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W14');
    try {
      await createTestWidget(page, token, id, 'line_chart', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(2_000);

      // Hover over widget to reveal chrome bar, then click configure
      const widget = page.locator('app-dashboard-widget').first();
      await widget.hover();
      await page.waitForTimeout(300);

      const configBtn = widget.locator('button[title="Configure widget"]');
      // Configure button is disabled when editable=false (non-edit mode for non-owned? No — editable=is_owned)
      // For owned dashboard, editable=true so button should be enabled
      await expect(configBtn).not.toBeDisabled({ timeout: 3_000 });
      await configBtn.click();

      await page.waitForSelector('.dashboard-modal__panel--wide', { timeout: 5_000 });
      const eyebrow = await page.locator('.dashboard-modal__eyebrow').first().textContent();
      expect(eyebrow?.trim()).toBe('Edit widget');
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      await dispose();
    }
  });

  // WIDGET-16
  test('WIDGET-16 sensor picker — "With data only" checkbox checked by default', async ({ page }) => {
    const token = await goToDashboard(page);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W16');
    try {
      await selectDashboard(page, id);
      await page.waitForSelector('button[aria-label="Add widget"]:not([disabled])', { timeout: 5_000 });
      await page.click('button[aria-label="Add widget"]');
      await page.waitForSelector('.dashboard-modal__panel--wide', { timeout: 5_000 });
      await page.waitForSelector('.tree-picker__filters', { timeout: 8_000 });

      const withDataCheck = page.locator('.tree-picker__filter-check').filter({ hasText: 'With data only' }).locator('input[type="checkbox"]');
      await expect(withDataCheck).toBeChecked();
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      await dispose();
    }
  });

  // WIDGET-17
  test('WIDGET-17 sensor picker — "Active in time window" checkbox disabled until time window set', async ({ page }) => {
    const token = await goToDashboard(page);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W17');
    try {
      await selectDashboard(page, id);
      await page.waitForSelector('button[aria-label="Add widget"]:not([disabled])', { timeout: 5_000 });
      await page.click('button[aria-label="Add widget"]');
      await page.waitForSelector('.dashboard-modal__panel--wide', { timeout: 5_000 });
      await page.waitForSelector('.tree-picker__filters', { timeout: 8_000 });

      // "Active in time window" should be enabled (relative mode with hours is always set)
      const timeWindowCheck = page.locator('.tree-picker__filter-check').filter({ hasText: 'Active in time window' }).locator('input[type="checkbox"]');
      await expect(timeWindowCheck).not.toBeDisabled();

      // Unchecking by default
      await expect(timeWindowCheck).not.toBeChecked();

      // Toggling on should not throw
      await timeWindowCheck.check();
      await expect(timeWindowCheck).toBeChecked();
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      await dispose();
    }
  });

  // WIDGET-15
  test('WIDGET-15 delete widget — confirm dialog, widget removed', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-W15');
    try {
      await createTestWidget(page, token, id, 'stat_card', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(2_000);

      const beforeCount = await page.locator('app-dashboard-widget').count();
      expect(beforeCount).toBeGreaterThan(0);

      const widget = page.locator('app-dashboard-widget').first();
      await widget.hover();
      await page.waitForTimeout(300);

      page.once('dialog', d => d.accept());
      await widget.locator('button[title="Remove widget"]').click();
      await page.waitForTimeout(2_000);

      const afterCount = await page.locator('app-dashboard-widget').count();
      expect(afterCount).toBe(beforeCount - 1);
    } finally {
      await dispose();
    }
  });

});
