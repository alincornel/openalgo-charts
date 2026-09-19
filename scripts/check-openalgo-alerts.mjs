import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/** Drive the shared alert controls against the installed candidate and real terminal. */
export async function checkAlerts({ page, terminal, check, reload, sendDepth, screenshot, orderCount }) {
  const ordersBefore = orderCount();
  const ready = () => page.waitForFunction(() => {
    const terminal = window.__compatTerminals?.findLast(t => !t.destroyed && t.chart);
    return !!terminal?.alerts && !terminal.dataUnavailable() && !terminal.preparingWorkspace
      && !!terminal.container.closest('[data-workspace-active="true"]')
      && !document.querySelector('[data-workspace-active="false"]');
  });
  const open = async () => {
    await page.getByRole('button', { name: 'Alerts', exact: true }).last().click();
    await expect(page.getByRole('dialog', { name: 'Alerts', exact: true })).toBeVisible();
  };
  const close = async () => {
    await terminal(t => t.alertUi?.close());
    await expect(page.locator('.oac-alert-host [role="dialog"]')).toHaveCount(0);
  };
  const create = async (name, source, id, threshold) => {
    await page.getByRole('button', { name: 'Create alert', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Create alert', exact: true });
    await editor.getByLabel('Name', { exact: true }).fill(name);
    await editor.getByLabel('Source', { exact: true }).selectOption(source);
    if (source === 'indicator') await editor.getByLabel('Study', { exact: true }).selectOption(id);
    if (source === 'drawing') await editor.getByLabel('Drawing', { exact: true }).selectOption(id);
    else await editor.getByLabel('Threshold', { exact: true }).fill(String(threshold));
    await editor.getByLabel('Evaluate', { exact: true }).selectOption('onTouch');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
  };
  let identities;
  await check('alert editor creates price, study and drawing sources in the real terminal', async () => {
    identities = await terminal(async t => {
      t.stopReplay();
      await t.loadSymbol({ symbol: 'NIFTY29SEP26FUT', exchange: 'NFO' });
      await t.applyIndicatorTemplate([{ indicatorId: 'ema', settings: { length: 1 }, paneIndex: 0 }], 'replace');
      await t.setDrawTool(null);
      const study = t.chart.indicators()[0];
      const drawing = t.draw.add({ id: 'alert-browser-line', tool: 'horizontal-line', paneIndex: 0,
        style: {}, points: [{ time: t.rawBars.at(-1).time, price: 1000 }] });
      return { study: study.id, drawing: drawing.id };
    });
    await open();
    await create('Price breakout', 'price', null, 120);
    await create('Study threshold', 'indicator', identities.study, 1000);
    await create('Drawing threshold', 'drawing', identities.drawing);
    assert.deepEqual(await terminal(t => t.alerts.list().map(a => a.source.kind)), ['price', 'indicator', 'drawing']);
    if (screenshot) await page.screenshot({ path: screenshot.replace(/\.png$/, '-alerts-list.png') });
    await close();
  });
  await check('live alert triggers once and a saved workspace retains lifecycle and both anchors', async () => {
    await sendDepth('NIFTY29SEP26FUT', 'NFO', 130);
    await expect.poll(() => terminal(t => t.alerts.list()[0]?.state)).toBe('triggered');
    // Named workspaces with autosave off require an explicit configuration save.
    await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
    await page.getByLabel('Workspace name', { exact: true }).fill('Alerts research');
    await page.getByRole('button', { name: 'Save as', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Workspace saved' }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
    await reload();
    await ready();
    assert.deepEqual(await terminal(t => t.alerts.list().map(a => a.state)), ['triggered', 'armed', 'armed']);
    assert.equal(await terminal(t => t.chart.indicators()[0].id), identities.study);
    assert(await terminal((t, id) => !!t.draw.get(id), identities.drawing));
    await open();
    await expect(page.getByRole('dialog', { name: 'Alerts', exact: true })).toContainText('Triggered');
    await close();
  });
  await check('alert evaluation and order entry remain locked during cancellable replay history', async () => {
    await terminal(t => {
      const alert = t.alerts.add({ id: 'replay-guard', title: 'Replay guard', source: { kind: 'price', price: 150 }, policy: 'onTouch' });
      window.__alertReplayLoader = t.loadReplaySubBars;
      t.loadReplaySubBars = () => new Promise(resolve => { window.__finishAlertReplay = resolve; });
      window.__pendingAlertReplay = t.beginReplayAt(2);
      t.price.update({ ...t.price.getData().at(-1), high: 200, close: 200 });
      return alert.id;
    });
    assert.equal(await terminal(t => t.replayLoadingBars()), true);
    assert.equal(await terminal(t => t.alerts.list().find(a => a.id === 'replay-guard').state), 'armed');
    const refusal = await terminal(async t => {
      try { await t.placeTicket({ symbol: t.sym.symbol, exchange: t.sym.exchange, action: 'BUY',
        quantity: 1, product: 'MIS', pricetype: 'MARKET' }); return ''; }
      catch (error) { return error.message; }
    });
    assert.match(refusal, /replay/i);
    await terminal(async t => {
      t.stopReplay();
      window.__finishAlertReplay(null);
      await window.__pendingAlertReplay;
      t.loadReplaySubBars = window.__alertReplayLoader;
      t.alerts.remove('replay-guard');
    });
    assert.equal(await terminal(t => t.replayActive() || t.replayLoadingBars()), false);
    assert.equal(orderCount(), ordersBefore);
  });
  await check('narrow split charts give the alert editor the full viewport and release it on rebuild', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open();
    await page.getByRole('button', { name: 'Create alert', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Create alert', exact: true });
    const box = await editor.boundingBox();
    assert(box && box.width >= 320 && box.x >= 0 && box.x + box.width <= 391);
    await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
    if (screenshot) await page.screenshot({ path: screenshot.replace(/\.png$/, '-alerts-mobile.png') });
    await terminal(async t => { t.buildChart(); await t.chartToolsReady; });
    await expect(page.locator('.oac-alert-host')).toHaveCount(0);
    assert.equal(await terminal(t => t.alerts.list().length), 3);
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(orderCount(), ordersBefore);
  });
}
