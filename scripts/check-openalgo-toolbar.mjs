import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/** Exercise the real consumer controls against the harness's mocked transport. */
export async function checkToolbar({ page, check, screenshot, orderCount }) {
  const ordersBefore = orderCount();
  const toolbar = page.getByRole('toolbar', { name: 'Chart controls' });
  const state = () => page.evaluate(() => window.__compatTerminals.filter(t => !t.destroyed && t.chart).map(t => ({
    key: t.sk, symbol: t.sym?.symbol, interval: t.interval, type: t.ctype,
    picking: t.replayPickingBar(), studies: t.chart.indicators().map(s => s.indicatorId),
  })));
  const ready = () => page.waitForFunction(() => window.__compatTerminals.filter(t => !t.destroyed).every(t =>
    t.chart && t.price?.getData().length && !t.dataUnavailable() && t.chart.getDataContext()?.interval === t.interval));
  await check('one workspace toolbar remains after adding a second chart', async () => {
    await expect(page.getByRole('toolbar', { name: 'Chart controls' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Chart layout: Single', exact: true }).click();
    await page.getByTitle('2 columns', { exact: true }).click();
    await page.waitForFunction(() => window.__compatTerminals.filter(t => !t.destroyed && t.price?.getData().length).length === 2);
    await expect(page.locator('[data-toolbar-pane]')).toHaveCount(1);
    await expect(page.getByRole('toolbar', { name: 'Chart controls' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Alerts', exact: true })).toHaveCount(1);
    assert.equal(await page.locator('[data-toolbar-pane]').getAttribute('data-toolbar-pane'), 'p0');
  });
  await check('keyboard and chart selection move controls without recreating terminals', async () => {
    await page.evaluate(() => { window.__toolbarOwners = window.__compatTerminals.filter(t => !t.destroyed); });
    await page.locator('[data-chart-pane="p1"]').focus();
    await expect(toolbar).toHaveAttribute('data-toolbar-pane', 'p1');
    await expect(page.locator('[data-chart-pane="p1"]')).toHaveAttribute('data-chart-focused', 'true');
    await page.getByRole('button', { name: 'Selected chart: 2', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Chart 1: NSE:BHEL', exact: true }).click();
    await expect(toolbar).toHaveAttribute('data-toolbar-pane', 'p0');
    await page.locator('[data-chart-pane="p1"]').focus();
    await expect(toolbar).toHaveAttribute('data-toolbar-pane', 'p1');
    assert(await page.evaluate(() => window.__toolbarOwners.every(t => !t.destroyed && window.__compatTerminals.includes(t))));
  });
  await check('symbol interval and chart type controls act only on the selected chart', async () => {
    await toolbar.getByRole('button', { name: '5m', exact: true }).click();
    await page.getByRole('menuitem', { name: '15m', exact: true }).click();
    await ready();
    await toolbar.getByTitle('Candles', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Line', exact: true }).click();
    await ready();
    await toolbar.getByTitle('Search symbol', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Search symbol', exact: true }).fill('NIFTY29SEP26FUT');
    await page.getByRole('dialog', { name: 'Symbol Search', exact: true }).getByText('NIFTY29SEP26FUT', { exact: true }).click();
    await page.waitForFunction(() => window.__compatTerminals.some(t => !t.destroyed && t.sk === 'oa-trading-p1' && t.sym?.symbol === 'NIFTY29SEP26FUT' && !t.dataUnavailable()));
    assert.deepEqual((await state()).map(({ symbol, interval, type }) => ({ symbol, interval, type })), [
      { symbol: 'BHEL', interval: '5m', type: 'candlestick' },
      { symbol: 'NIFTY29SEP26FUT', interval: '15m', type: 'line' },
    ]);
  });
  await check('alerts snapshots and replay retain the selected chart owner', async () => {
    await toolbar.getByRole('button', { name: 'Alerts', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Alerts', exact: true })).toBeVisible();
    assert(await page.evaluate(() => {
      const t = window.__compatTerminals.find(t => !t.destroyed && t.sk === 'oa-trading-p1');
      return t.alertDialogOpen() && !window.__compatTerminals.find(t => !t.destroyed && t.sk === 'oa-trading-p0').alertDialogOpen();
    }));
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Alerts', exact: true })).toHaveCount(0);
    const downloaded = page.waitForEvent('download');
    await toolbar.getByRole('button', { name: 'Chart snapshot', exact: true }).click({ modifiers: ['Shift'] });
    assert.match((await downloaded).suggestedFilename(), /^NIFTY29SEP26FUT-15m-.*\.png$/);
    await page.locator('[data-sonner-toast] [data-close-button]').last().click();
    await toolbar.getByRole('button', { name: 'Replay', exact: true }).click();
    await expect.poll(async () => (await state()).map(pane => pane.picking)).toEqual([false, true]);
    await toolbar.getByTitle('Cancel bar selection', { exact: true }).click();
    await expect.poll(async () => (await state()).map(pane => pane.picking)).toEqual([false, false]);
  });
  await check('study controls add an indicator only to the selected chart', async () => {
    await toolbar.getByTitle('Indicators', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Search indicators', exact: true }).fill('EMA');
    await page.getByTitle('Add EMA', { exact: true }).click();
    await expect.poll(async () => (await state()).map(pane => pane.studies.includes('ema'))).toEqual([false, true]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Indicators', exact: true })).toHaveCount(0);
  });
  await check('fullscreen keeps one toolbar inside the selected chart', async () => {
    if (!await page.evaluate(() => document.fullscreenEnabled)) return;
    await toolbar.getByRole('button', { name: 'Toggle full screen chart', exact: true }).click();
    await page.waitForFunction(() => !!document.fullscreenElement?.querySelector('[data-toolbar-pane="p1"]'));
    await expect(page.locator('[data-toolbar-pane]')).toHaveCount(1);
    await expect(page.locator('[data-workspace-toolbar] [data-toolbar-pane]')).toHaveCount(0);
    await toolbar.getByRole('button', { name: 'Alerts', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Alerts', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
      // Escape can also leave native fullscreen, depending on the browser.
      if (document.fullscreenElement) await document.exitFullscreen();
    });
    await expect(page.locator('[data-workspace-toolbar] [data-toolbar-pane]')).toHaveCount(1);
  });
  await check('compact toolbar stays reachable without expanding the page', async () => {
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    await toolbar.getByRole('button', { name: 'Alerts', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Alerts', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const selection = await page.getByRole('button', { name: 'Selected chart: 2', exact: true }).boundingBox();
    assert(selection && selection.x >= 0 && selection.x + selection.width <= 390, 'Selected chart stays visible while controls scroll');
    if (screenshot) await page.screenshot({ path: screenshot.replace(/\.png$/, '-toolbar-mobile.png') });
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (screenshot) await page.screenshot({ path: screenshot.replace(/\.png$/, '-toolbar-desktop.png') });
  });
  await page.evaluate(async () => {
    const t = window.__compatTerminals.find(t => !t.destroyed && t.sk === 'oa-trading-p1');
    await t.applyIndicatorTemplate([], 'replace');
    await t.loadSymbol({ symbol: 'BHEL', exchange: 'NSE' });
    t.setInterval('5m');
    t.setChartType('candlestick');
  });
  await ready();
  // Return the fixture to the single-chart starting point for subsequent checks.
  await check('removing the selected chart falls back to the surviving chart', async () => {
    await page.getByRole('button', { name: 'Chart layout: 2 columns', exact: true }).click();
    await page.getByTitle('Single', { exact: true }).click();
    await page.waitForFunction(() => window.__compatTerminals.filter(t => !t.destroyed && t.chart).length === 1);
    await expect(toolbar).toHaveAttribute('data-toolbar-pane', 'p0');
    assert.equal(orderCount(), ordersBefore);
  });
}
