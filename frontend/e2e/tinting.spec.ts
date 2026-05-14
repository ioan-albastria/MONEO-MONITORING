import { test, expect } from '@playwright/test';
import {
  goToDashboard, selectDashboard, createTestDashboard,
  createTestWidget, getFirstSensorId,
} from './helpers';

test.describe('TINT', () => {

  // TINT-01: --tone-tint inline style is set on the shell section after a widget renders
  test('TINT-01 shell section has --tone-tint inline style after widget renders', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Tint01');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);

      const section = page.locator('app-widget-shell section').first();
      const toneTint = await section.evaluate(
        (el: HTMLElement) => el.style.getPropertyValue('--tone-tint'),
      );
      expect(toneTint.trim().length, '--tone-tint not set on shell section').toBeGreaterThan(0);
    } finally {
      await dispose();
    }
  });

  // TINT-02: background-image is not 'none' — gradient tint is applied
  test('TINT-02 shell section has a background-image tint applied (not none)', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Tint02');
    try {
      await createTestWidget(page, token, id, 'stat_card', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);

      const section = page.locator('app-widget-shell section').first();
      const bgImage = await section.evaluate(
        (el: HTMLElement) => getComputedStyle(el).backgroundImage,
      );
      expect(bgImage, 'background-image should be a linear-gradient, not none').not.toBe('none');
    } finally {
      await dispose();
    }
  });

  // TINT-03: theme toggle updates border-color (dark vs light alpha values differ)
  test('TINT-03 theme toggle changes shell section border-color', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Tint03');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);

      const section = page.locator('app-widget-shell section').first();

      // Force dark mode
      await page.evaluate(() => {
        document.documentElement.classList.remove('theme-light');
        document.documentElement.classList.add('theme-dark');
      });
      await page.waitForTimeout(400);
      const borderDark = await section.evaluate(
        (el: HTMLElement) => getComputedStyle(el).borderColor,
      );

      // Force light mode
      await page.evaluate(() => {
        document.documentElement.classList.remove('theme-dark');
        document.documentElement.classList.add('theme-light');
      });
      await page.waitForTimeout(400);
      const borderLight = await section.evaluate(
        (el: HTMLElement) => getComputedStyle(el).borderColor,
      );

      expect(borderLight, 'Border colour must differ between dark and light modes').not.toBe(borderDark);
    } finally {
      await dispose();
    }
  });

  // TINT-04: --tone-text inline style is always set (covers stale grey path)
  test('TINT-04 shell section always has --tone-text inline style set', async ({ page }) => {
    const token = await goToDashboard(page);
    const sensorId = await getFirstSensorId(page, token);
    const { id, dispose } = await createTestDashboard(page, token, 'E2E-Tint04');
    try {
      await createTestWidget(page, token, id, 'gauge', sensorId);
      await selectDashboard(page, id);
      await page.waitForTimeout(4_000);

      const section = page.locator('app-widget-shell section').first();
      const toneText = await section.evaluate(
        (el: HTMLElement) => el.style.getPropertyValue('--tone-text'),
      );
      expect(toneText.trim().length, '--tone-text should always be set as inline style').toBeGreaterThan(0);
    } finally {
      await dispose();
    }
  });

});
