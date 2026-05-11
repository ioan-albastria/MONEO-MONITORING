import { Page, expect } from '@playwright/test';

export const BASE = 'http://localhost:4200';
export const API  = 'http://localhost:8000';

export const ADMIN_USER = 'admin';
export const ADMIN_PASS = 'changeme';

// ── Auth helpers ──────────────────────────────────────────────────────────────

export async function loginViaApi(page: Page): Promise<string> {
  const res = await page.request.post(`${API}/api/auth/login`, {
    data: { username: ADMIN_USER, password: ADMIN_PASS },
  });
  expect(res.ok(), `login API returned ${res.status()}`).toBe(true);
  const body = await res.json();
  return body.access_token as string;
}

/** Inject the token straight into localStorage so we bypass the login UI. */
export async function loginDirect(page: Page): Promise<string> {
  await page.goto('/login');
  const token = await loginViaApi(page);
  await page.evaluate((t) => localStorage.setItem('auth_token', t), token);
  return token;
}

/** Full UI login flow. */
export async function loginUI(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('#username', ADMIN_USER);
  await page.fill('#password', ADMIN_PASS);
  await page.click('button.btn-login');
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
}

// ── Dashboard helpers ─────────────────────────────────────────────────────────

export async function apiGet<T>(page: Page, path: string, token: string): Promise<T> {
  const res = await page.request.get(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBe(true);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(page: Page, path: string, body: unknown, token: string): Promise<T> {
  const res = await page.request.post(`${API}${path}`, {
    data: body,
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBe(true);
  return res.json() as Promise<T>;
}

export async function apiDelete(page: Page, path: string, token: string): Promise<void> {
  await page.request.delete(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Create a test dashboard and return its id. Cleans up via returned dispose(). */
export async function createTestDashboard(
  page: Page, token: string, name: string, isPublic = false
): Promise<{ id: number; dispose: () => Promise<void> }> {
  const d = await apiPost<{ id: number }>(page, '/api/dashboards', { name, is_public: isPublic }, token);
  return {
    id: d.id,
    dispose: () => apiDelete(page, `/api/dashboards/${d.id}`, token),
  };
}

/** Create a widget on a dashboard. Returns widgetId. */
export async function createTestWidget(
  page: Page, token: string, dashboardId: number,
  widgetType: string, sensorId: number
): Promise<number> {
  const colsMap: Record<string, number> = {
    line_chart: 12, bar_chart: 8, gauge: 4, stat_card: 4,
  };
  const rowsMap: Record<string, number> = {
    line_chart: 5, bar_chart: 5, gauge: 4, stat_card: 3,
  };
  const settingsMap: Record<string, object> = {
    line_chart: { sensor_ids: [sensorId], time_range_hours: 24, aggregated: true, bucket_minutes: 60 },
    bar_chart:  { sensor_ids: [sensorId], time_range_hours: 24, aggregated: true, bucket_minutes: 60 },
    gauge:      { sensor_ids: [sensorId], gauge_min: 0, gauge_max: 100 },
    stat_card:  { sensor_ids: [sensorId], time_range_hours: 24 },
  };
  const w = await apiPost<{ id: number }>(page, `/api/dashboards/${dashboardId}/widgets`, {
    widget_type: widgetType,
    x: 0, y: 0,
    cols: colsMap[widgetType] ?? 6,
    rows: rowsMap[widgetType] ?? 4,
    settings: settingsMap[widgetType] ?? { sensor_ids: [sensorId] },
  }, token);
  return w.id;
}

/** Wait until the dashboard page has finished its initial load (spinner gone). */
export async function waitForDashboardLoaded(page: Page): Promise<void> {
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
  // wait for loading spinner to disappear
  await page.waitForSelector('.dashboard-loading', { state: 'hidden', timeout: 15_000 }).catch(() => {});
}

/** Navigate to /dashboard with a pre-seeded token (no UI login). */
export async function goToDashboard(page: Page): Promise<string> {
  const token = await loginDirect(page);
  await page.goto('/dashboard');
  await waitForDashboardLoaded(page);
  return token;
}

/** Pick the dashboard in the select by its numeric id. */
export async function selectDashboard(page: Page, id: number): Promise<void> {
  await page.selectOption('select.dashboard-toolbar__select', String(id));
  await page.waitForTimeout(800); // allow getDashboard fetch
}

/** Get the first available sensor id via the API. */
export async function getFirstSensorId(page: Page, token: string): Promise<number> {
  const sensors = await apiGet<{ id: number }[]>(page, '/api/sensors', token);
  expect(sensors.length, 'Need at least one sensor in the backend').toBeGreaterThan(0);
  return sensors[0].id;
}
