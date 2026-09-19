import { expect, test } from '@playwright/test';
import type { Widget } from '../../src/widget/widget';
import type { AlertTriggeredPayload, Bar } from '../../src/index';

declare global {
  interface Window {
    __widgetAlerts: { widget: Widget; fired: AlertTriggeredPayload[]; bars: Bar[]; tick(delta: number, next?: boolean): void };
  }
}

test('creates, triggers, edits and restores a once alert through the widget controls', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto('/tests/e2e/widget-alerts-fixture.html');
  await page.waitForFunction(() => !!window.__widgetAlerts);
  await page.locator('.oac-topbar__alerts').click();
  await page.getByRole('button', { name: 'Create alert', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Create alert', exact: true });
  await editor.getByLabel('Name', { exact: true }).fill('Desktop threshold');
  await editor.getByLabel('Threshold', { exact: true }).fill('105');
  await editor.getByLabel('Evaluate', { exact: true }).selectOption('onTouch');
  await expect(editor.getByLabel('Enabled', { exact: true })).toBeChecked();
  await expect(editor.getByLabel('Enabled', { exact: true })).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(editor).toContainText('absent from final history');
  await page.screenshot({ path: info.outputPath('alert-editor-desktop.png'), animations: 'disabled' });
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const list = page.getByRole('dialog', { name: 'Alerts', exact: true });
  await expect(list).toContainText('Desktop threshold');
  await list.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Price +5', exact: true }).click();
  expect(await page.evaluate(() => window.__widgetAlerts.fired)).toEqual([]);
  await page.getByRole('button', { name: 'Price +5', exact: true }).click();
  await expect(page.locator('.oac-toast__msg')).toContainText('Desktop threshold');
  await page.locator('.oac-topbar__alerts').click();
  await expect(list).toContainText('Triggered');
  await list.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog', { name: 'Edit alert', exact: true }).getByLabel('Name', { exact: true }).fill('Fired threshold');
  await page.getByRole('dialog', { name: 'Edit alert', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(list).toContainText('Triggered');
  await page.reload();
  await page.waitForFunction(() => !!window.__widgetAlerts);
  expect(await page.evaluate(() => window.__widgetAlerts.fired)).toEqual([]);
  await expect(page.locator('.oac-toast__msg')).toHaveCount(0);
  await page.locator('.oac-topbar__alerts').click();
  await expect(list).toContainText('Fired threshold');
  await expect(list).toContainText('Triggered');
  await page.screenshot({ path: info.outputPath('alert-list-desktop.png'), animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('keeps the editor usable on a narrow screen and selects a missing OI plot explicitly', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/e2e/widget-alerts-fixture.html');
  await page.waitForFunction(() => !!window.__widgetAlerts);
  await page.locator('[data-mobile-action="more"]').click();
  await page.locator('[data-mobile-action="alerts"]').click();
  await page.getByRole('button', { name: 'Create alert', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Create alert', exact: true });
  await editor.getByLabel('Source', { exact: true }).focus();
  await editor.getByLabel('Source', { exact: true }).selectOption('indicator');
  await expect(editor.getByLabel('Source', { exact: true })).toBeFocused();
  const instanceId = await page.evaluate(() => window.__widgetAlerts.widget.chart.indicators().find(item => item.indicatorId === 'open-interest')!.id);
  await editor.getByLabel('Study', { exact: true }).selectOption(instanceId);
  await expect(editor.getByLabel('Threshold', { exact: true })).toHaveValue('');
  await expect(editor).toContainText('current plot value is unavailable');
  await editor.getByLabel('Threshold', { exact: true }).fill('0');
  await editor.getByLabel('Name', { exact: true }).fill('OI zero reading');
  const bounds = await editor.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await editor.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('alert-editor-narrow.png'), animations: 'disabled' });
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const list = page.getByRole('dialog', { name: 'Alerts', exact: true });
  await expect(list).toContainText('OI zero reading');
  await expect(list).toContainText('Plot value is unavailable');
  await page.screenshot({ path: info.outputPath('alert-list-narrow.png'), animations: 'disabled' });
  await list.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(list).toContainText('No alerts');
  expect(errors).toEqual([]);
});

test('rejects a blank draft after blur and creates a drawing alert from a real context menu', async ({ page }, info) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto('/tests/e2e/widget-alerts-fixture.html');
  await page.waitForFunction(() => !!window.__widgetAlerts);
  await page.locator('.oac-topbar__alerts').click();
  await page.getByRole('button', { name: 'Create alert', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Create alert', exact: true });
  await editor.getByLabel('Threshold', { exact: true }).fill('');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Threshold', { exact: true })).toHaveValue('');
  await expect(editor.locator('.oac-alert-error')).toContainText('finite');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('dialog', { name: 'Alerts', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  const point = await page.evaluate(() => {
    const { widget, bars } = window.__widgetAlerts;
    const drawing = widget.draw.drawings()[0];
    widget.draw.update(drawing.id, { points: [{ time: bars[80].time, price: 102 }] });
    const rect = widget.root.querySelector('.oac-chart')!.getBoundingClientRect();
    return { x: rect.left + widget.chart.timeToCoordinate(bars[80].time)!, y: rect.top + widget.chart.priceToCoordinate(102)! };
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Create drawing alert...' }).click();
  await expect(editor.getByLabel('Source', { exact: true })).toHaveValue('drawing');
  await expect(editor.getByLabel('Level', { exact: true })).toHaveValue('line');
  await editor.getByLabel('Name', { exact: true }).fill('Drawing close');
  await page.screenshot({ path: info.outputPath('alert-drawing-editor.png'), animations: 'disabled' });
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Price +5', exact: true }).click();
  expect(await page.evaluate(() => window.__widgetAlerts.fired)).toEqual([]);
  await page.getByRole('button', { name: 'Close bar', exact: true }).click();
  await expect(page.locator('.oac-toast__msg')).toContainText('Drawing close');
});
