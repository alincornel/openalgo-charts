import { test, expect, type Page } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:8124';
const PAGE = ORIGIN + '/examples/yfinance/index.html?test=1';
const PROBE = ORIGIN + '/api/history?symbol=AAPL&interval=1d&period=1mo';

test('reference selection survives hover and snapshot menus retain their chart owner', async ({ page }, info) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await openDemo(page);
  await page.getByRole('button', { name: /Open a second, linked chart/ }).click();
  await page.waitForFunction(() => (window as any).__oac.app.chart2?.primaryBars().length > 0);
  const secondary = page.locator('#chart2');
  const primary = page.locator('#chart');
  const box = (await secondary.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.35);
  await expect(secondary).toHaveAttribute('data-chart-focused', 'true');
  const other = (await primary.boundingBox())!;
  await page.mouse.move(other.x + other.width * 0.4, other.y + other.height * 0.35);
  expect(await page.evaluate(() => (window as any).__oac.app.focusPane)).toBe(2);
  const edge = await page.screenshot({ clip: { x: box.x, y: box.y + 80, width: 3, height: 12 } });
  const visibleSelection = await page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] === 45 && pixels[index + 1] === 212 && pixels[index + 2] === 191) return true;
    }
    return false;
  }, edge.toString('base64'));
  expect(visibleSelection, 'selected chart border must paint above its canvas').toBe(true);
  await page.screenshot({ path: info.outputPath('reference-selected-chart.png') });
  await page.getByRole('button', { name: 'Chart snapshot', exact: true }).click();
  await primary.focus();
  await expect(primary).toHaveAttribute('data-chart-focused', 'true');
  const exported = page.waitForEvent('download');
  await page.locator('#snap-save').click();
  expect((await exported).suggestedFilename()).toMatch(/^MSFT-1h-.*\.png$/);
  const primaryExport = page.waitForEvent('download');
  await primary.focus();
  await page.keyboard.press('Control+Alt+s');
  expect((await primaryExport).suggestedFilename()).toMatch(/^AAPL-1d-.*\.png$/);
  expect(await page.evaluate(() => ({
    orders: (window as any).__oac.app.orders.length,
    fills: (window as any).__oac.app.fills.length,
  }))).toEqual({ orders: 0, fills: 0 });
});

for (const pane of [1, 2]) {
  test(`reference context alert creation stays on chart ${pane}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1360, height: 900 });
    await openDemo(page);
    if (pane === 2) {
      await page.getByRole('button', { name: /Open a second, linked chart/ }).click();
      await page.waitForFunction(() => (window as any).__oac.app.chart2?.primaryBars().length > 0);
    }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const point = await page.evaluate(pane => {
      const app = (window as any).__oac.app;
      const chart = pane === 1 ? app.chart : app.chart2;
      const draw = pane === 1 ? app.draw : app.draw2;
      const box = document.querySelector(pane === 1 ? '#chart' : '#chart2')!.getBoundingClientRect();
      chart.panes()[0].priceScale.setAutoScale(false);
      chart.panes()[0].priceScale.setPriceRange({ min: 80, max: 160 });
      draw.add({ id: 'clicked-context', tool: 'horizontal-line', paneIndex: 0,
        points: [{ time: chart.primaryBars().at(-1).time, price: 120 }], style: {} });
      return { x: box.left + box.width * 0.45, y: box.top + chart.priceToCoordinate(120, 0) };
    }, pane);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await page.evaluate(pane => { (window as any).__oac.app.focusPane = pane === 1 ? 2 : 1; }, pane);
    await page.getByRole('menuitem', { name: 'Create drawing alert', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Create alert', exact: true });
    await expect(editor.getByLabel('Source', { exact: true })).toHaveValue('drawing');
    await expect(editor.getByLabel('Drawing', { exact: true })).toHaveValue('clicked-context');
    await editor.getByLabel('Name', { exact: true }).fill(`Chart ${pane} context`);
    await page.screenshot({ path: info.outputPath(`reference-context-${pane}.png`) });
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    const result = await page.evaluate(() => {
      const app = (window as any).__oac.app;
      return { primary: app.alerts.list(), secondary: app.alerts2?.list() ?? [], orders: app.orders.length };
    });
    expect(pane === 1 ? result.primary : result.secondary).toMatchObject([{ title: `Chart ${pane} context`,
      source: { kind: 'drawing', drawingId: 'clicked-context' }, scope: { symbol: pane === 1 ? 'AAPL' : 'MSFT' } }]);
    expect(pane === 1 ? result.secondary : result.primary).toEqual([]);
    expect(result.orders).toBe(0);
  });
}

test('reference oscillator context offers its study alert without price order actions', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await openDemo(page);
  const point = await page.evaluate(() => {
    const { chart } = (window as any).__oac;
    const study = chart.indicators().find((item: any) => item.indicatorId === 'rsi');
    const values = study.values().rsi;
    const range = chart.getVisibleLogicalRange();
    let index = Math.max(20, Math.ceil(range.from));
    while (index < Math.min(values.length - 1, range.to) && !(values[index] > 10 && values[index] < 90
      && [30, 50, 70].every(level => Math.abs(values[index] - level) > 8))) index++;
    const box = document.querySelector('#chart')!.getBoundingClientRect();
    return { x: box.left + chart.timeToCoordinate(chart.primaryBars()[index].time),
      y: box.top + chart.priceToCoordinate(values[index], study.paneIndex), id: study.id };
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(page.getByRole('menuitem', { name: /Buy|Sell/ })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Create study alert', exact: true }).click();
  await expect(page.getByLabel('Study', { exact: true })).toHaveValue(point.id);
  await expect(page.getByLabel('Plot', { exact: true })).toHaveValue('rsi');
});

test('reference alerts retain drawing anchors through rebuild and reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openDemo(page);
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await page.getByRole('button', { name: 'Create alert', exact: true }).click();
  const editor = page.locator('.oac-alert-editor');
  await editor.locator('[data-key="title"] input').fill('Reference price');
  await editor.locator('[data-key="condition"] select').selectOption('greaterThan');
  await editor.locator('[data-key="price"] input').fill('1');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const drawingId = await page.evaluate(() => {
    const { app } = (window as any).__oac;
    const tail = app.chart.primaryBars().at(-1);
    const drawing = app.draw.add({ tool: 'horizontal-line', paneIndex: 0,
      points: [{ time: tail.time, price: tail.close + 10 }], style: {} });
    app.alertUi.openEditor({ source: { kind: 'drawing', drawingId: drawing.id } });
    return drawing.id;
  });
  await editor.locator('[data-key="title"] input').fill('Reference drawing');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const studyId = await page.evaluate(() => (window as any).__oac.chart.indicators().find((study: any) => study.indicatorId === 'rsi').id);
  await page.getByRole('button', { name: 'Create alert', exact: true }).click();
  await editor.locator('[data-key="kind"] select').selectOption('indicator');
  await editor.locator('[data-key="instanceId"] select').selectOption(studyId);
  await editor.locator('[data-key="title"] input').fill('Reference study');
  await editor.locator('[data-key="condition"] select').selectOption('greaterThan');
  await editor.locator('[data-key="value"] input').fill('1');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await page.evaluate(() => (window as any).__oac.app.alertUi.close());
  await page.getByRole('button', { name: 'Chart type', exact: true }).click();
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__oac.app.alerts.list().length)).toBe(3);
  expect(await page.evaluate(id => (window as any).__oac.chart.indicators().some((study: any) => study.id === id), studyId)).toBe(true);
  expect(await page.evaluate(id => Boolean((window as any).__oac.draw.get(id)), drawingId)).toBe(true);
  await page.evaluate(() => {
    const { app } = (window as any).__oac;
    const tail = app.chart.primaryBars().at(-1);
    app.price.update({ ...tail, time: tail.time + 86400 });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__oac.app.alerts.list()[0].state)).toBe('triggered');
  await page.waitForTimeout(350);
  await page.reload();
  await page.waitForFunction(() => (window as any).__oac?.app.alerts?.list().length === 3);
  expect(await page.evaluate(() => (window as any).__oac.app.alerts.list().find((alert: any) => alert.title === 'Reference study').source.instanceId)).toBe(studyId);
  expect(await page.evaluate(() => (window as any).__oac.app.alerts.list()[0].state)).toBe('triggered');
  expect(await page.evaluate(id => Boolean((window as any).__oac.draw.get(id)), drawingId)).toBe(true);
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await expect(page.locator('.oac-alerts')).toContainText('Reference drawing');
  await page.screenshot({ path: testInfo.outputPath('reference-alerts-desktop.png') });
  await page.setViewportSize({ width: 390, height: 740 });
  await expect(page.locator('.oac-alerts')).toBeVisible();
  await page.getByRole('button', { name: 'Create alert', exact: true }).click();
  await expect(editor).toBeVisible();
  const bounds = await editor.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('reference-alerts-narrow.png') });
});

let serverUp: boolean | null = null;

test('reference alert dialogs do not commit a replay pick underneath them', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openDemo(page);
  await page.evaluate(async () => {
    const path = '/examples/yfinance/src/replay.js';
    const replay = await import(path);
    replay.enterReplay();
    (window as any).__oac.app.alertUi.openEditor();
  });
  await page.locator('.oac-alert-editor').getByRole('button', { name: 'Save', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__oac.app.replayPicking)).toBe(true);
});

test('reference replay loading and playback stay silent and cancellation leaves no late replay', async ({ page }) => {
  await openDemo(page);
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/history?**', async route => {
    if (new URL(route.request().url()).searchParams.get('interval') !== '60m') { await route.continue(); return; }
    started();
    await gate;
    await route.fulfill({ json: [] }).catch(() => {});
  });
  await page.evaluate(async () => {
    const { app } = (window as any).__oac;
    (window as any).__alertDeliveries = [];
    app.chart.on('alert:triggered', (event: any) => (window as any).__alertDeliveries.push(event));
    app.alerts.add({ source: { kind: 'price', price: 1 }, condition: 'greaterThan', policy: 'onTouch' });
    const path = '/examples/yfinance/src/replay.js';
    const replay = await import(path);
    void replay.startReplayAt(10);
  });
  await waiting;
  const loading = await page.evaluate(async () => {
    const { app } = (window as any).__oac;
    const tail = app.chart.primaryBars().at(-1);
    app.price.update({ ...tail, close: tail.close + 1, high: tail.high + 1 });
    const path = '/examples/yfinance/src/orders.js';
    const orders = await import(path);
    orders.placeOrder('BUY', 'MARKET', tail.close);
    return { loading: app.replayLoading, orders: app.orders.length, fills: app.fills.length, fired: (window as any).__alertDeliveries.length };
  });
  expect(loading).toEqual({ loading: true, orders: 0, fills: 0, fired: 0 });
  await page.evaluate(async () => { const path = '/examples/yfinance/src/replay.js'; (await import(path)).exitReplay(); });
  release();
  await page.unrouteAll({ behavior: 'wait' });
  const state = await page.evaluate(async () => {
    const { app } = (window as any).__oac;
    const path = '/examples/yfinance/src/replay.js';
    const replay = await import(path);
    await replay.startReplayAt(10);
    app.replay.step();
    app.replay.seek(20);
    replay.exitReplay();
    return { loading: app.replayLoading, replay: app.replay, fired: (window as any).__alertDeliveries.length, state: app.alerts.list()[0].state };
  });
  expect(state).toEqual({ loading: false, replay: null, fired: 0, state: 'armed' });
});

test('reference second-chart alerts restore on reload and stay scoped to that chart', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openDemo(page);
  await page.getByRole('button', { name: /Open a second, linked chart/ }).click();
  await page.waitForFunction(() => (window as any).__oac.app.chart2?.primaryBars().length > 0);
  await page.evaluate(() => { (window as any).__oac.app.focusPane = 2; });
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await page.getByRole('button', { name: 'Create alert', exact: true }).click();
  await page.locator('.oac-alert-editor [data-key="title"] input').fill('Secondary alert');
  await page.locator('.oac-alert-editor').getByRole('button', { name: 'Save', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__oac.app.alerts.list().length)).toBe(0);
  expect(await page.evaluate(() => (window as any).__oac.app.alerts2.list()[0].scope.symbol)).toBe('MSFT');
  await page.waitForTimeout(350);
  await page.reload();
  await page.waitForFunction(() => (window as any).__oac?.app.alerts2?.list().length === 1);
  expect(await page.evaluate(() => (window as any).__oac.app.alerts2.list()[0].title)).toBe('Secondary alert');
  await page.setViewportSize({ width: 390, height: 740 });
  await page.evaluate(() => (window as any).__oac.app.alertUi2.openEditor());
  const editor = page.locator('.oac-alert-editor');
  await expect(editor).toBeVisible();
  const bounds = await editor.boundingBox();
  expect(bounds!.width).toBeGreaterThan(300);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('reference-secondary-alerts-narrow.png') });
});

test.use({
  viewport: { width: 390, height: 740 },
  hasTouch: true,
});

test.beforeEach(async ({ request }) => {
  if (serverUp === null) serverUp = await request.get(PROBE).then((response) => response.ok(), () => false);
  test.skip(!serverUp, 'the yfinance fixture server is not available');
});

async function openDemo(page: Page): Promise<void> {
  await page.goto(PAGE);
  await page.waitForFunction(() => {
    const host = (window as any).__oac;
    return Boolean(host && host.chart && host.draw && host.app.currentBars.length > 0);
  });
}

test('compact touch controls draw, undo and navigate in portrait and landscape', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  await openDemo(page);

  const bar = page.locator('#mobilebar');
  await expect(bar).toBeVisible();
  await expect(page.locator('#rail')).toBeHidden();
  const sizes = await bar.locator('select, button').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(44);

  await page.locator('#mobile-draw').selectOption('trend-line');
  expect(await page.evaluate(() => (window as any).__oac.draw.activeTool())).toBe('trend-line');
  const chart = page.locator('#chart');
  const box = await chart.boundingBox();
  if (!box) throw new Error('the chart has no layout box');
  await page.touchscreen.tap(box.x + box.width * 0.28, box.y + box.height * 0.46);
  await page.touchscreen.tap(box.x + box.width * 0.58, box.y + box.height * 0.30);
  await expect.poll(() => page.evaluate(() => (window as any).__oac.draw.drawings().length)).toBe(1);

  await page.locator('#mobile-cursor').click();
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => (window as any).__oac.draw.drawings().length)).toBe(0);
  await expect(page.locator('#mobile-undo')).toBeDisabled();
  await expect(page.locator('#mobile-redo')).toBeEnabled();
  await page.locator('#mobile-redo').click();
  await expect.poll(() => page.evaluate(() => (window as any).__oac.draw.drawings().length)).toBe(1);
  await page.locator('#mobile-undo').click();
  await expect.poll(() => page.evaluate(() => (window as any).__oac.draw.drawings().length)).toBe(0);
  await page.locator('#mobile-redo').click();
  await expect.poll(() => page.evaluate(() => (window as any).__oac.draw.drawings().length)).toBe(1);

  const span = () => page.evaluate(() => {
    const range = (window as any).__oac.chart.getVisibleLogicalRange();
    return range.to - range.from;
  });
  const before = await span();
  await page.locator('#mobile-zoom-in').click();
  expect(await span()).toBeLessThan(before);

  await page.setViewportSize({ width: 740, height: 390 });
  await expect(bar).toBeVisible();
  const shell = await page.locator('#shellbar').boundingBox();
  const landscapeChart = await chart.boundingBox();
  expect(shell?.height).toBeLessThanOrEqual(54);
  expect(landscapeChart?.height).toBeGreaterThan(200);
  expect(await page.evaluate(() => (window as any).__oac.draw.drawings().length)).toBe(1);

  await page.setViewportSize({ width: 1024, height: 600 });
  await expect(bar).toBeVisible();
  await page.getByRole('button', { name: 'Replay this session bar by bar' }).click();
  await expect(page.locator('#replaypick')).toBeVisible();
  const wideChart = await chart.boundingBox();
  if (!wideChart) throw new Error('the wide chart has no layout box');
  await page.touchscreen.tap(wideChart.x + wideChart.width * 0.4, wideChart.y + wideChart.height * 0.4);
  await expect(page.locator('#replaybar')).toBeVisible();
  const replayBox = await page.locator('#replaybar').boundingBox();
  const mobileBox = await bar.boundingBox();
  if (!replayBox || !mobileBox) throw new Error('the replay or mobile controls have no layout box');
  expect(replayBox.y + replayBox.height).toBeLessThanOrEqual(mobileBox.y);
  const magnetHit = await page.locator('#mobile-magnet').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('#mobile-magnet') === node;
  });
  expect(magnetHit).toBe(true);
  expect(errors).toEqual([]);
});

test('reduced motion makes wheel navigation settle in the input frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDemo(page);
  const wheelSpacing = (selector: '#chart' | '#chart2', key: 'chart' | 'chart2') => page.locator(selector).evaluate((node, chartKey) => {
    const host = (window as any).__oac;
    const chart = chartKey === 'chart2' ? host.app.chart2 : host.chart;
    const before = chart.timeScale.barSpacing;
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -120,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      bubbles: true,
      cancelable: true,
    }));
    return {
      before,
      after: chart.timeScale.barSpacing,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  }, key);

  const wheelFactor = Math.exp(Math.log(1.1) * 1.2);
  const primary = await wheelSpacing('#chart', 'chart');
  expect(primary.reduced).toBe(true);
  expect(primary.after).toBeCloseTo(primary.before * wheelFactor, 8);

  await page.getByRole('button', { name: /Open a second, linked chart/ }).click();
  await page.waitForFunction(() => {
    const second = (window as any).__oac.app.chart2;
    return Boolean(second && second.dataLayer.length > 0);
  });
  const second = await wheelSpacing('#chart2', 'chart2');
  expect(second.after).toBeCloseTo(second.before * wheelFactor, 8);
});

test('watermark and host branding survive chart-type and profile-mode rebuilds', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openDemo(page);
  expect(await page.evaluate(() => (window as any).__oac.chart.watermarkOptions().visible)).toBe(false);
  await page.evaluate(() => {
    const { chart } = (window as any).__oac;
    chart.setWatermarkOptions({ visible: true, text: 'Research', opacity: 0.2, fontSize: 54 });
    chart.setBranding({ label: 'Research charts', href: 'https://example.com/charts' });
  });
  for (const type of ['Line', 'Point & Figure']) {
    await page.getByRole('button', { name: 'Chart type', exact: true }).click();
    await page.getByRole('button', { name: type, exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__oac.chart.watermarkOptions().text)).toBe('Research');
    expect(await page.evaluate(() => (window as any).__oac.chart.exportSVG())).toContain('Research');
    await expect(page.getByRole('link', { name: 'Research charts', exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'P&F box sizing', exact: true }).click();
  await page.getByRole('button', { name: 'P&F: 1% box', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__oac.chart.watermarkOptions())).toMatchObject({ visible: true, text: 'Research', opacity: 0.2, fontSize: 54 });
  await page.evaluate(() => {
    const { chart } = (window as any).__oac;
    chart.setWatermarkOptions(false);
    chart.setBranding(false);
  });
  await page.getByRole('button', { name: 'Chart type', exact: true }).click();
  await page.getByRole('button', { name: 'Candles', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 740 });
  expect(await page.evaluate(() => (window as any).__oac.chart.watermarkOptions().visible)).toBe(false);
  expect(await page.evaluate(() => (window as any).__oac.chart.brandingOptions())).toBe(false);
  await expect(page.getByRole('link', { name: 'Research charts', exact: true })).toHaveCount(0);
});
