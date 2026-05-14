import { test, expect, Page } from '@playwright/test';
import {
  goToDashboard, selectDashboard, createTestDashboard,
  createTestWidget, getFirstSensorId,
} from './helpers';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Inject freshAt + expectedIntervalSeconds into the first app-widget-shell and
 *  trigger Angular change detection so the pipe re-evaluates. */
async function injectFreshness(
  page: Page,
  freshAt: string | null,
  expectedIntervalSeconds = 300,
): Promise<void> {
  await page.evaluate(
    ([ts, interval]) => {
      const shell = document.querySelector('app-widget-shell');
      if (!shell) throw new Error('No app-widget-shell found');
      const comp = (window as any).ng?.getComponent(shell);
      if (!comp) throw new Error('Angular getComponent() not available — is this a dev build?');
      comp.freshAt = ts;
      comp.expectedIntervalSeconds = interval;
      (window as any).ng?.applyChanges(comp);
    },
    [freshAt, expectedIntervalSeconds] as [string | null, number],
  );
  await page.waitForTimeout(150);
}

/** Return the text content of the first .widget-freshness footer, or null if absent. */
async function footerText(page: Page): Promise<string | null> {
  const footer = page.locator('.widget-freshness').first();
  const visible = await footer.isVisible().catch(() => false);
  if (!visible) return null;
  return (await footer.textContent())?.trim() ?? null;
}

/** Return the data-state attribute on the first .widget-freshness element, or null. */
async function footerState(page: Page): Promise<string | null> {
  const footer = page.locator('.widget-freshness').first();
  const visible = await footer.isVisible().catch(() => false);
  if (!visible) return null;
  return footer.getAttribute('data-state');
}

/** ISO timestamp that is `secondsAgo` seconds before now. */
function tsAgo(secondsAgo: number): string {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('FRESH', () => {

  // FRESH-01: footer absent during initial loading (before data arrives)
  test('FRESH-01 freshness footer is absent while widget is loading', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Fresh01');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);

      // Immediately after navigation — widget is in loading state, footer should be absent
      const footer = page.locator('.widget-freshness').first();
      const isVisible = await footer.isVisible().catch(() => false);
      expect(isVisible, 'Footer must be hidden while freshAt is null (loading)').toBe(false);
    } finally {
      await dispose();
    }
  });

  // FRESH-02: footer appears with "Xs ago" format after gauge widget data loads
  test('FRESH-02 freshness footer appears with "Xs ago" text after data loads', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Fresh02');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);

      // After data loads, inject a known-fresh timestamp and verify format
      await injectFreshness(page, tsAgo(5), 300);
      const text = await footerText(page);
      expect(text, 'Footer should show "Xs ago" format').toMatch(/^\d+s ago$/);
    } finally {
      await dispose();
    }
  });

  // FRESH-03: data-state="fresh" when data is recent (within 1× interval)
  test('FRESH-03 footer data-state is "fresh" when data age < 1× expectedIntervalSeconds', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Fresh03');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);

      await injectFreshness(page, tsAgo(10), 300);
      const state = await footerState(page);
      expect(state, 'data-state should be "fresh" for recent data').toBe('fresh');
    } finally {
      await dispose();
    }
  });

  // FRESH-04: data-state="stale" when 1× ≤ age < 5× interval
  test('FRESH-04 footer data-state is "stale" when 1× ≤ age < 5× expectedIntervalSeconds', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Fresh04');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);

      // age = 20s, interval = 10s → 2× interval → stale
      await injectFreshness(page, tsAgo(20), 10);
      const state = await footerState(page);
      expect(state, 'data-state should be "stale" when 1× ≤ age < 5×').toBe('stale');
    } finally {
      await dispose();
    }
  });

  // FRESH-05: data-state="offline" when age ≥ 5× interval + host gets data-state attribute
  test('FRESH-05 footer data-state is "offline" and host attr reflects it when age ≥ 5× interval', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Fresh05');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);

      // age = 60s, interval = 10s → 6× interval → offline
      await injectFreshness(page, tsAgo(60), 10);
      const state = await footerState(page);
      expect(state, 'footer data-state should be "offline"').toBe('offline');

      // HostBinding sets data-state on the host <app-widget-shell> element too
      const hostState = await page.locator('app-widget-shell').first().getAttribute('data-state');
      expect(hostState, 'host element data-state should be "offline"').toBe('offline');
    } finally {
      await dispose();
    }
  });

  // ── RelativeTimePipe boundary tests (FRESH-PIPE-*) ────────────────────────

  // FRESH-PIPE-01: null → footer is absent (ngIf guard)
  test('FRESH-PIPE-01 footer is absent when freshAt is null', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-FreshPipe01');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);
      await injectFreshness(page, null, 300);
      const footer = page.locator('.widget-freshness').first();
      expect(await footer.isVisible().catch(() => false)).toBe(false);
    } finally {
      await dispose();
    }
  });

  // FRESH-PIPE-02: 0s ago → "0s ago"
  test('FRESH-PIPE-02 0 seconds ago shows "0s ago"', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-FreshPipe02');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);
      await injectFreshness(page, tsAgo(0), 300);
      const text = await footerText(page);
      expect(text).toMatch(/^\d+s ago$/);
    } finally {
      await dispose();
    }
  });

  // FRESH-PIPE-03: 89s → "89s ago" (still in seconds bucket)
  test('FRESH-PIPE-03 89 seconds ago shows "89s ago"', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-FreshPipe03');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);
      await injectFreshness(page, tsAgo(89), 300);
      const text = await footerText(page);
      // seconds < 90 → "Xs ago"
      expect(text, '89s should still be in "Xs ago" bucket').toMatch(/^8\ds ago$/);
    } finally {
      await dispose();
    }
  });

  // FRESH-PIPE-04: 90s → "2 min ago" (crosses into minutes bucket)
  test('FRESH-PIPE-04 90 seconds ago shows "2 min ago"', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-FreshPipe04');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);
      await injectFreshness(page, tsAgo(90), 300);
      const text = await footerText(page);
      // 90s → Math.round(90/60)=2 → "2 min ago"
      expect(text, '90s should cross into minutes bucket').toBe('2 min ago');
    } finally {
      await dispose();
    }
  });

  // FRESH-PIPE-05: 89 min ago → "89 min ago" (still in minutes bucket)
  test('FRESH-PIPE-05 89 minutes ago shows "89 min ago"', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-FreshPipe05');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);
      await injectFreshness(page, tsAgo(89 * 60), 300);
      const text = await footerText(page);
      // 5340s < 5400 → minutes bucket → Math.round(5340/60) = 89
      expect(text, '89 min should still be in "X min ago" bucket').toBe('89 min ago');
    } finally {
      await dispose();
    }
  });

  // FRESH-PIPE-06: 90 min ago → "2h ago" (crosses into hours bucket)
  test('FRESH-PIPE-06 90 minutes ago shows "2h ago"', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-FreshPipe06');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);
      await injectFreshness(page, tsAgo(90 * 60), 300);
      const text = await footerText(page);
      // 5400s → NOT < 5400, < 86400 → hours: Math.round(5400/3600) = 2
      expect(text, '90 min should cross into hours bucket').toBe('2h ago');
    } finally {
      await dispose();
    }
  });

  // FRESH-PIPE-07: 23h ago → "23h ago" (still in hours bucket)
  test('FRESH-PIPE-07 23 hours ago shows "23h ago"', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-FreshPipe07');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);
      await injectFreshness(page, tsAgo(23 * 3600), 300);
      const text = await footerText(page);
      // 82800s < 86400 → hours: Math.round(82800/3600) = 23
      expect(text, '23h should still be in "Xh ago" bucket').toBe('23h ago');
    } finally {
      await dispose();
    }
  });

  // FRESH-PIPE-08: 24h ago → "1d ago" (crosses into days bucket)
  test('FRESH-PIPE-08 24 hours ago shows "1d ago"', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-FreshPipe08');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);
      await injectFreshness(page, tsAgo(24 * 3600), 300);
      const text = await footerText(page);
      // 86400s → NOT < 86400 → days: Math.round(86400/86400) = 1
      expect(text, '24h should cross into days bucket').toBe('1d ago');
    } finally {
      await dispose();
    }
  });

  // FRESH-PIPE-09: multi-day (48h) → "2d ago"
  test('FRESH-PIPE-09 48 hours ago shows "2d ago"', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-FreshPipe09');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);
      await injectFreshness(page, tsAgo(48 * 3600), 300);
      const text = await footerText(page);
      expect(text, '48h should show as "2d ago"').toBe('2d ago');
    } finally {
      await dispose();
    }
  });

});
