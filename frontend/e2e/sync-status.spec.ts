/**
 * SYNC-STATUS e2e tests
 *
 * These tests cover the admin sync-status indicator, panel, and banner.
 * They use route-level API mocking via page.route() to stub
 * GET /api/admin/sync/health without requiring the backend sync machinery.
 *
 * Test IDs: SYNC-01 … SYNC-05
 */
import { test, expect, Page } from '@playwright/test';
import { loginDirect, API } from './helpers';

// ── Stub helpers ──────────────────────────────────────────────────────────────

function makeSource(overrides: Record<string, unknown> = {}) {
  return {
    derived_status: 'healthy',
    last_status: 'success',
    last_run_started_at: '2026-05-17T10:00:00Z',
    last_run_finished_at: '2026-05-17T10:00:05Z',
    last_success_at: '2026-05-17T10:00:05Z',
    lag_seconds: 30,
    consecutive_failures: 0,
    records_in: 200,
    records_written: 195,
    error_count: 0,
    last_error_kind: null,
    last_error_message: null,
    ...overrides,
  };
}

function healthPayload(
  readingsOverrides: Record<string, unknown> = {},
  metadataOverrides: Record<string, unknown> = {},
) {
  return {
    'moneo.readings': makeSource(readingsOverrides),
    'moneo.metadata': makeSource(metadataOverrides),
  };
}

async function stubHealth(page: Page, payload: object, status = 200) {
  await page.route('**/api/admin/sync/health', route =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    }),
  );
}

async function goToDashboard(page: Page) {
  await loginDirect(page);
  await page.goto('/dashboard');
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
  // Give Angular time to bootstrap and the first health poll to complete
  await page.waitForTimeout(1_500);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('SYNC-STATUS', () => {

  // SYNC-01: Admin sees indicator; clicking opens panel with two sources
  test('SYNC-01 admin sees indicator; click opens panel with both sources', async ({ page }) => {
    await stubHealth(page, healthPayload());
    await goToDashboard(page);

    const indicator = page.locator('app-sync-status-indicator button');
    await expect(indicator).toBeVisible({ timeout: 8_000 });

    // Panel is not visible yet
    await expect(page.locator('app-sync-status-panel')).not.toBeVisible();

    // Click to open
    await indicator.click();
    await expect(page.locator('app-sync-status-panel')).toBeVisible({ timeout: 4_000 });

    // Both source sections are present
    const sourceLabels = page.locator('.sync-panel__source-label');
    await expect(sourceLabels).toHaveCount(2);
    const texts = await sourceLabels.allTextContents();
    expect(texts.map(t => t.trim())).toContain('Readings');
    expect(texts.map(t => t.trim())).toContain('Metadata');
  });

  // SYNC-02: Non-admin (simulated by 403) does NOT see the indicator
  test('SYNC-02 non-admin (403 on health) does not see the indicator', async ({ page }) => {
    await page.route('**/api/admin/sync/health', route =>
      route.fulfill({ status: 403, body: 'Forbidden' }),
    );
    await goToDashboard(page);

    const indicator = page.locator('app-sync-status-indicator button');
    // Wait briefly to confirm it never appears
    await expect(indicator).not.toBeVisible({ timeout: 4_000 });
    await expect(page.locator('app-sync-status-banner .sync-error-banner')).not.toBeVisible();
  });

  // SYNC-03: overall=failed → red banner appears; dismiss hides it for the session
  test('SYNC-03 failed health shows red banner; dismissal persists for session', async ({ page }) => {
    await stubHealth(page, healthPayload(
      { derived_status: 'failed', last_error_kind: 'api_error', last_success_at: '2026-05-17T09:00:00Z' },
      { derived_status: 'failed', last_error_kind: 'api_error', last_success_at: '2026-05-17T09:00:00Z' },
    ));
    await goToDashboard(page);

    const banner = page.locator('.sync-error-banner');
    await expect(banner).toBeVisible({ timeout: 8_000 });

    // Dismiss the banner
    await page.locator('.sync-error-banner__dismiss-btn').click();
    await expect(banner).not.toBeVisible({ timeout: 3_000 });

    // sessionStorage key is set
    const dismissed = await page.evaluate(() =>
      sessionStorage.getItem('sync-banner-dismissed'),
    );
    expect(dismissed).toBe('true');
  });

  // SYNC-04: neverSynced state → indicator shows "Awaiting first sync", NO red banner
  test('SYNC-04 neverSynced state shows pending indicator and no red banner', async ({ page }) => {
    await stubHealth(page, healthPayload(
      { derived_status: 'failed', last_success_at: null, last_run_started_at: null,
        last_run_finished_at: null, last_status: null },
      { derived_status: 'failed', last_success_at: null, last_run_started_at: null,
        last_run_finished_at: null, last_status: null },
    ));
    await goToDashboard(page);

    // Indicator visible with pending label
    const label = page.locator('app-sync-status-indicator .sync-label');
    await expect(label).toBeVisible({ timeout: 8_000 });
    await expect(label).toHaveText('Awaiting first sync');

    // Red banner must NOT appear
    await expect(page.locator('.sync-error-banner')).not.toBeVisible();
  });

  // SYNC-05: Panel "View details" from banner opens the panel
  test('SYNC-05 "View details" in banner opens the sync status panel', async ({ page }) => {
    await stubHealth(page, healthPayload(
      { derived_status: 'failed', last_error_kind: 'api_error', last_success_at: '2026-05-17T09:00:00Z' },
      { derived_status: 'failed', last_error_kind: 'api_error', last_success_at: '2026-05-17T09:00:00Z' },
    ));
    await goToDashboard(page);

    await expect(page.locator('.sync-error-banner')).toBeVisible({ timeout: 8_000 });

    await page.locator('.sync-error-banner__details-btn').click();
    await expect(page.locator('app-sync-status-banner app-sync-status-panel')).toBeVisible({ timeout: 4_000 });
  });

});
