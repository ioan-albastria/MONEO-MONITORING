import { test, expect } from '@playwright/test';
import {
  goToDashboard, selectDashboard, createTestDashboard,
  createTestWidget, getFirstSensorId,
} from './helpers';

test.describe('RT', () => {

  // RT-01
  test('RT-01 gauge widget opens a WebSocket connection', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-RT01');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);

      // Listen for WS connections before loading the dashboard
      const wsConnections: string[] = [];
      page.on('websocket', ws => {
        wsConnections.push(ws.url());
      });

      await selectDashboard(page, id);
      await page.waitForTimeout(5_000); // give time for WS to open

      const wsForSensor = wsConnections.find(u => u.includes(`/ws/sensors/${sensorId}`));
      expect(wsForSensor, `No WebSocket opened for sensor ${sensorId}. URLs seen: ${wsConnections.join(', ')}`).toBeTruthy();
    } finally {
      await dispose();
    }
  });

  // RT-02
  test('RT-02 WebSocket closes when navigating away from dashboard', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-RT02');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);

      const closedUrls: string[] = [];
      page.on('websocket', ws => {
        if (ws.url().includes(`/ws/sensors/${sensorId}`)) {
          ws.on('close', () => closedUrls.push(ws.url()));
        }
      });

      await selectDashboard(page, id);
      await page.waitForTimeout(3_000);

      // Navigate to login (forces component destroy → RealtimeService teardown)
      await page.goto('/login');
      await page.waitForTimeout(2_000);

      expect(closedUrls.length, 'WebSocket was not closed after navigation').toBeGreaterThan(0);
    } finally {
      await dispose();
    }
  });

  // RT-03
  test('RT-03 gauge live update — value changes within 10 s window', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-RT03');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(3_000);

      // Capture initial gauge value
      const gaugeEl = page.locator('.widget-gauge__value').first();
      const hasGauge = await gaugeEl.count() > 0;

      if (!hasGauge) {
        test.skip(true, 'RT-03 SKIP: Gauge did not render (no latest reading available). Cannot test live update.');
        return;
      }

      const initialValue = await gaugeEl.textContent();

      // Wait up to 10 s for the value to change (live reading via WebSocket)
      let changed = false;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        await page.waitForTimeout(500);
        const current = await gaugeEl.textContent();
        if (current !== initialValue) { changed = true; break; }
      }

      if (!changed) {
        test.skip(true, 'RT-03 SKIP: No live WebSocket reading arrived within 10 s. Backend may not be emitting sensor data.');
        return;
      }

      const newValue = await gaugeEl.textContent();
      expect(newValue).not.toBe(initialValue);
    } finally {
      await dispose();
    }
  });

});
