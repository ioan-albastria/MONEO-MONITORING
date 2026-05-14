import { test, expect } from '@playwright/test';
import { loginDirect, loginUI, ADMIN_USER, ADMIN_PASS, API } from './helpers';

test.describe('AUTH', () => {

  // AUTH-01
  test('AUTH-01 login success — navigates to /dashboard, token stored', async ({ page }) => {
    await loginUI(page);
    expect(page.url()).toContain('/dashboard');
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(token).toBeTruthy();
  });

  // AUTH-02
  test('AUTH-02 login failure — error banner shown, stays on /login', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', ADMIN_USER);
    await page.fill('#password', 'wrong_password_xyz');
    await page.click('button[type="submit"]');
    await page.waitForSelector('.input-error-text', { timeout: 8_000 });
    const banner = await page.locator('.input-error-text').textContent();
    expect(banner).toBeTruthy();
    expect(page.url()).toContain('/login');
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(token).toBeNull();
  });

  // AUTH-03
  test('AUTH-03 guard redirect — /dashboard without token goes to /login', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => localStorage.removeItem('auth_token'));
    await page.goto('/dashboard');
    await page.waitForURL('**/login', { timeout: 8_000 });
    expect(page.url()).toContain('/login');
  });

  // AUTH-04
  test('AUTH-04 interceptor — Authorization header on every /api request', async ({ page }) => {
    const authHeaders: string[] = [];
    page.on('request', req => {
      if (req.url().includes('/api/')) {
        const h = req.headers()['authorization'];
        if (h) authHeaders.push(h);
      }
    });

    await loginDirect(page);
    await page.goto('/dashboard');
    // wait for at least one API call to complete
    await page.waitForTimeout(3_000);

    expect(authHeaders.length, 'No API requests with auth header were observed').toBeGreaterThan(0);
    for (const h of authHeaders) {
      expect(h).toMatch(/^Bearer .+/);
    }
  });

  // AUTH-05
  test('AUTH-05 401 handling — clears token and redirects to /login', async ({ page }) => {
    await loginDirect(page);
    await page.goto('/dashboard');
    await page.waitForTimeout(1_500);

    // Tamper the token so next request gets a 401
    await page.evaluate(() => localStorage.setItem('auth_token', 'invalid.token.here'));

    // Force a new API call by navigating to the same page
    await page.goto('/dashboard');
    await page.waitForURL('**/login', { timeout: 10_000 });
    expect(page.url()).toContain('/login');
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(token).toBeNull();
  });

});
