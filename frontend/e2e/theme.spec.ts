import { test, expect } from '@playwright/test';
import { goToDashboard } from './helpers';

test.describe('THEME', () => {

  // THEME-01
  test('THEME-01 theme toggle — adds theme-light class to <html>', async ({ page }) => {
    await goToDashboard(page);

    // Ensure we start in dark mode
    await page.evaluate(() => {
      document.documentElement.classList.remove('theme-light');
      document.documentElement.classList.add('theme-dark');
    });

    await page.click('button[title="Toggle theme"]');
    const classes = await page.evaluate(() => document.documentElement.className);
    expect(classes).toContain('theme-light');
  });

  // THEME-02
  test('THEME-02 theme toggle again — returns to dark (removes theme-light)', async ({ page }) => {
    await goToDashboard(page);

    // Force light mode first
    await page.evaluate(() => {
      document.documentElement.classList.remove('theme-dark');
      document.documentElement.classList.add('theme-light');
      localStorage.setItem('ui.theme', 'operational-light');
    });

    await page.click('button[title="Toggle theme"]');
    const classes = await page.evaluate(() => document.documentElement.className);
    expect(classes).toContain('theme-dark');
    expect(classes).not.toContain('theme-light');
  });

  // THEME-03
  test('THEME-03 theme persists — localStorage updated', async ({ page }) => {
    await goToDashboard(page);

    // Start dark
    await page.evaluate(() => {
      document.documentElement.classList.remove('theme-light');
      document.documentElement.classList.add('theme-dark');
      localStorage.setItem('ui.theme', 'operational-dark');
    });

    await page.click('button[title="Toggle theme"]');
    const stored = await page.evaluate(() => localStorage.getItem('ui.theme'));
    expect(stored).toBe('operational-light');
  });

  // THEME-04
  test('THEME-04 density toggle — adds density-compact class to <html>', async ({ page }) => {
    await goToDashboard(page);

    // Ensure comfortable baseline
    await page.evaluate(() => {
      document.documentElement.classList.remove('density-compact');
      document.documentElement.classList.add('density-comfortable');
    });

    // The density toggle is in the nav rail (not the page header button, which also works)
    // Both header "Density" button and nav-rail button call the same service method.
    await page.click('button[title="Toggle density"]');
    const classes = await page.evaluate(() => document.documentElement.className);
    expect(classes).toContain('density-compact');
  });

  // THEME-05
  test('THEME-05 density persists — localStorage updated', async ({ page }) => {
    await goToDashboard(page);

    await page.evaluate(() => {
      document.documentElement.classList.remove('density-compact');
      document.documentElement.classList.add('density-comfortable');
      localStorage.setItem('ui.density', 'density-comfortable');
    });

    await page.click('button[title="Toggle density"]');
    const stored = await page.evaluate(() => localStorage.getItem('ui.density'));
    expect(stored).toBe('density-compact');
  });

});
