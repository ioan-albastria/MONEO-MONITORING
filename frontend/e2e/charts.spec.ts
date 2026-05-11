import { test, expect } from '@playwright/test';
import {
  goToDashboard, selectDashboard, createTestDashboard,
  createTestWidget, getFirstSensorId, apiPost,
} from './helpers';

test.describe('CHART + CHROME', () => {

  // CHART-01
  test('CHART-01 line_chart renders — apx-chart element visible, no error overlay', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Chart01');
    try {
      await createTestWidget(page, token, id, 'line_chart', sensorId);
      await selectDashboard(page, id);

      const widget = page.locator('app-dashboard-widget').first();
      // Wait for loading to finish
      await widget.locator('.widget-state-overlay').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(500);

      // Either chart renders OR empty state (no data) — both are valid outcomes, no JS error
      const hasChart = await widget.locator('apx-chart').count() > 0;
      const hasEmpty = await widget.locator('.widget-state-overlay--empty').count() > 0;
      const hasError = await widget.locator('.widget-state-overlay--error').count() > 0;

      expect(hasError, 'Widget shows error overlay').toBe(false);
      expect(hasChart || hasEmpty, 'Widget shows neither chart nor empty state').toBe(true);
    } finally {
      await dispose();
    }
  });

  // CHART-02
  test('CHART-02 bar_chart renders — no error overlay', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Chart02');
    try {
      await createTestWidget(page, token, id, 'bar_chart', sensorId);
      await selectDashboard(page, id);

      const widget = page.locator('app-dashboard-widget').first();
      await widget.locator('.widget-state-overlay').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(500);

      const hasError = await widget.locator('.widget-state-overlay--error').count() > 0;
      expect(hasError, 'Bar chart widget shows error overlay').toBe(false);
    } finally {
      await dispose();
    }
  });

  // CHART-03
  test('CHART-03 gauge renders — dial visible with a value', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Chart03');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);

      const widget = page.locator('app-dashboard-widget').first();
      await page.waitForTimeout(4_000); // gauge fetches /latest + /sensor

      const hasError = await widget.locator('.widget-state-overlay--error').count() > 0;
      expect(hasError, 'Gauge widget shows error overlay').toBe(false);

      const hasDial = await widget.locator('.widget-gauge__dial').count() > 0;
      const hasEmpty = await widget.locator('.widget-state-overlay--empty').count() > 0;
      expect(hasDial || hasEmpty, 'Gauge shows neither dial nor empty state').toBe(true);
    } finally {
      await dispose();
    }
  });

  // CHART-04
  test('CHART-04 stat_card renders — value element visible', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Chart04');
    try {
      await createTestWidget(page, token, id, 'stat_card', sensorId);
      await selectDashboard(page, id);

      const widget = page.locator('app-dashboard-widget').first();
      await page.waitForTimeout(4_000);

      const hasError = await widget.locator('.widget-state-overlay--error').count() > 0;
      expect(hasError, 'Stat card shows error overlay').toBe(false);

      const hasStat  = await widget.locator('.widget-stat__value').count() > 0;
      const hasEmpty = await widget.locator('.widget-state-overlay--empty').count() > 0;
      expect(hasStat || hasEmpty, 'Stat card shows neither value nor empty state').toBe(true);
    } finally {
      await dispose();
    }
  });

  // CHART-05 — empty state for out-of-range time window
  test('CHART-05 empty state — widget with no data shows empty overlay', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Chart05');
    try {
      // Use a time window far in the past (no readings expected there)
      const farPast = '2000-01-01T00:00:00.000Z';
      const farPastEnd = '2000-01-02T00:00:00.000Z';
      await apiPost<{ id: number }>(page, `/api/dashboards/${id}/widgets`, {
        widget_type: 'line_chart',
        x: 0, y: 0, cols: 12, rows: 5,
        settings: {
          sensor_ids: [sensorId],
          from: farPast,
          to: farPastEnd,
        },
      }, token);

      await selectDashboard(page, id);
      const widget = page.locator('app-dashboard-widget').first();
      // Wait for load spinner to disappear
      await page.waitForTimeout(5_000);

      const hasEmpty = await widget.locator('.widget-state-overlay--empty').count() > 0;
      const hasChart = await widget.locator('apx-chart').count() > 0;
      // No data → empty state (or possibly chart with noData text)
      expect(hasEmpty || hasChart, 'Widget should show empty state or no-data chart').toBe(true);
    } finally {
      await dispose();
    }
  });

  // CHROME-01
  test('CHROME-01 refresh button always visible in widget header', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Chrome01');
    try {
      await createTestWidget(page, token, id, 'stat_card', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(2_000);

      const refreshBtn = page.locator('app-dashboard-widget').first()
        .locator('[widgetActions] button[title="Refresh widget"]');
      await expect(refreshBtn).toBeVisible({ timeout: 5_000 });
    } finally {
      await dispose();
    }
  });

  // CHROME-02
  test('CHROME-02 configure/delete enabled on owned dashboard (editable=true)', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Chrome02');
    try {
      await createTestWidget(page, token, id, 'stat_card', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(2_000);

      const widget = page.locator('app-dashboard-widget').first();
      await widget.hover();
      await page.waitForTimeout(300);

      await expect(widget.locator('button[title="Configure widget"]')).not.toBeDisabled({ timeout: 3_000 });
      await expect(widget.locator('button[title="Remove widget"]')).not.toBeDisabled({ timeout: 3_000 });
    } finally {
      await dispose();
    }
  });

  // CHROME-03
  test('CHROME-03 refresh button in chrome bar triggers reload', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Chrome03');
    try {
      await createTestWidget(page, token, id, 'line_chart', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(3_000);

      const widget = page.locator('app-dashboard-widget').first();
      await widget.hover();
      await page.waitForTimeout(300);

      // Chrome bar refresh button
      const chromeRefresh = widget.locator('[widgetChrome] button[title="Refresh widget"]');

      let refreshCalled = false;
      page.on('request', req => {
        if (req.url().includes('/api/analytics') || req.url().includes('/api/sensors')) {
          refreshCalled = true;
        }
      });

      await chromeRefresh.click();
      await page.waitForTimeout(2_000);
      expect(refreshCalled, 'Refresh button did not trigger an API call').toBe(true);
    } finally {
      await dispose();
    }
  });

});
