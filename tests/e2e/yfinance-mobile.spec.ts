import { test, expect, type Page } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:8124';
const PAGE = ORIGIN + '/examples/yfinance/index.html?test=1';
const PROBE = ORIGIN + '/api/history?symbol=AAPL&interval=1d&period=1mo';

test('comparison controls retain chart ownership and saved visibility through reload', async ({ page }, info) => {
  const faults: string[] = [];
  page.on('pageerror', error => faults.push(error.message));
  await page.setViewportSize({ width: 1360, height: 900 });
  await openDemo(page);
  await page.getByRole('button', { name: /Open a second, linked chart/ }).click();
  await page.waitForFunction(() => (window as any).__oac?.app.chart2?.primaryBars().length > 0 && !(window as any).__oac.app.loading2);
  await page.locator('#chart2').focus();
  await page.getByRole('button', { name: 'Compare a second symbol', exact: true }).click();
  await expect(page.locator('#cmp-title')).toHaveText('Compare symbols: chart 2');
  await page.locator('#cmp-sym').fill('TSLA');
  await page.locator('#cmp-add').click();
  await expect(page.locator('#cmp-list')).toContainText('TSLA');
  await expect(page.locator('#cmp-list')).toContainText('matched');
  await page.locator('#cmp-mode').selectOption('indexed-to-100');
  await page.locator('#chart').focus();
  await page.locator('#cmp-sym').fill('NVDA');
  await page.locator('#cmp-add').click();
  await expect(page.locator('#cmp-list')).toContainText('NVDA');
  expect(await page.evaluate(() => {
    const app = (window as any).__oac.app;
    return { first: app.comparisons.map((item: any) => item.symbol), second: app.comparisons2.map((item: any) => item.symbol),
      mode: app.cmpMode2, source: app.comparisons2[0].dataKey };
  })).toEqual({ first: [], second: ['TSLA', 'NVDA'], mode: 'indexed-to-100', source: expect.stringContaining('1h') });
  await page.screenshot({ path: info.outputPath('reference-owned-comparisons.png') });
  await page.getByRole('button', { name: 'Remove NVDA', exact: true }).click();
  await page.locator('#cmp-close').click();
  await page.evaluate(() => {
    const app = (window as any).__oac.app;
    app.chart2.emit('click', { id: 'cmp:TSLA::hide' });
  });
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => {
    const app = (window as any).__oac?.app;
    return app?.comparisons2?.[0]?.handle && !app.loading && !app.loading2 && !app.restoringSecondary;
  });
  expect(await page.evaluate(() => {
    const app = (window as any).__oac.app;
    return { first: app.comparisons.length, symbol: app.comparisons2[0].symbol, hidden: app.comparisons2[0].hidden,
      visible: app.chart2.panes()[0].series().find((series: any) => series.style.color === app.comparisons2[0].color)?.style.visible, mode: app.cmpMode2 };
  })).toEqual({ first: 0, symbol: 'TSLA', hidden: true, visible: false, mode: 'indexed-to-100' });
  await page.locator('#chart2').focus();
  await page.getByRole('button', { name: 'Chart type', exact: true }).click();
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  expect(faults).toEqual([]);
  await page.getByRole('button', { name: 'Comparing TSLA', exact: true }).click();
  await page.getByRole('button', { name: 'Remove TSLA', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__oac.app.comparisons2.length)).toBe(0);
  expect(await page.evaluate(() => (window as any).__oac.app.chart2.panes()[0].priceScale.options.mode)).toBe('linear');
});

test('comparison history failures remain visible and retry uses its own chart interval', async ({ page }, info) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await openDemo(page);
  await page.getByRole('button', { name: /Open a second, linked chart/ }).click();
  await page.waitForFunction(() => (window as any).__oac?.app.chart2?.primaryBars().length > 0 && !(window as any).__oac.app.loading2);
  await page.locator('#chart2').focus();
  await page.getByRole('button', { name: 'Compare a second symbol', exact: true }).click();
  await page.locator('#cmp-sym').fill('TSLA');
  await page.locator('#cmp-add').click();
  await expect(page.locator('#cmp-list')).toContainText('matched');
  await page.locator('#cmp-close').click();
  const history = '**/api/history?**';
  await page.route(history, route => {
    const url = new URL(route.request().url());
    return url.searchParams.get('symbol') === 'TSLA' && url.searchParams.get('interval') === '15m'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Comparison source unavailable' }) })
      : route.continue();
  });
  await page.locator('#shellbar .pills').getByRole('button', { name: '15M', exact: true }).click();
  await page.waitForFunction(() => {
    const app = (window as any).__oac.app;
    return app.p2.interval === '15m' && !app.loading2 && app.comparisons2[0].error;
  });
  await page.getByRole('button', { name: 'Comparing TSLA', exact: true }).click();
  await expect(page.locator('#cmp-list')).toContainText('Comparison source unavailable');
  await expect(page.locator('#cmp-list').getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  expect(await page.evaluate(() => {
    const app = (window as any).__oac.app;
    return { primary: app.req.interval, bars: app.comparisons2[0].bars.length, handle: Boolean(app.comparisons2[0].handle) };
  })).toEqual({ primary: '1d', bars: 0, handle: false });
  await page.screenshot({ path: info.outputPath('reference-comparison-source-error.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const modal = (await page.locator('#cmpmodal .set-card').boundingBox())!;
  const remove = (await page.getByRole('button', { name: 'Remove TSLA', exact: true }).boundingBox())!;
  expect(remove.x + remove.width).toBeLessThanOrEqual(modal.x + modal.width);
  await page.screenshot({ path: info.outputPath('reference-comparison-source-error-narrow.png') });
  await page.unroute(history);
  await page.locator('#cmp-list').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('#cmp-list')).toContainText('matched');
  await expect(page.locator('#cmp-list').getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__oac.app.comparisons2[0].dataKey)).toContain('15m');
});

test('reference selection survives hover and snapshot menus retain their chart owner', async ({ page }, info) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await openDemo(page);
  await page.getByRole('button', { name: /Open a second, linked chart/ }).click();
  await page.waitForFunction(() => (window as any).__oac?.app.chart2?.primaryBars().length > 0);
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

test('shared request and type controls preserve independent charts through reload', async ({ page }, info) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await openDemo(page);
  await page.getByRole('button', { name: /Open a second, linked chart/ }).click();
  await page.waitForFunction(() => (window as any).__oac?.app.chart2?.primaryBars().length > 0);
  await page.locator('#chart2').focus();
  await expect(page.getByRole('button', { name: 'Change symbol', exact: true })).toContainText('MSFT');
  await page.locator('#shellbar .pills').getByRole('button', { name: '15M', exact: true }).click();
  await page.waitForFunction(() => {
    const app = (window as any).__oac.app;
    return app.p2.interval === '15m' && !app.loading2 && app.chart2.primaryBars().length > 0;
  });
  expect(await page.evaluate(() => (window as any).__oac.app.req.interval)).toBe('1d');
  await expect(page.getByRole('button', { name: 'Place a Buy OCO bracket: entry, target and stop', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Place a Sell OCO bracket: entry, target and stop', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Change symbol', exact: true }).click();
  await page.getByPlaceholder('Symbol or expression').fill('TSLA');
  await page.getByPlaceholder('Symbol or expression').press('Enter');
  await page.waitForFunction(() => {
    const app = (window as any).__oac.app;
    return app.chart2.getDataContext().symbol === 'TSLA' && !app.loading2;
  });
  await page.getByRole('button', { name: 'Add an indicator', exact: true }).click();
  await page.getByRole('button', { name: 'EMA', exact: true }).click();
  const study = await page.evaluate(() => (window as any).__oac.app.chart2.indicators()[0]?.id);
  expect(study).toBeTruthy();
  await page.evaluate(async (id) => {
    const source = '/examples/yfinance/src/indicators.js';
    (await import(source)).openSettings(id);
  }, study);
  await expect(page.locator('#setmodal')).toBeVisible();
  await page.locator('#set-body [data-key="length"]').fill('9');
  await page.locator('#set-ok').click();
  expect(await page.evaluate(() => (window as any).__oac.app.chart2.indicators()[0].settings().length)).toBe(9);
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await page.getByRole('button', { name: 'None', exact: true }).click();
  expect(await page.evaluate(() => {
    const app = (window as any).__oac.app;
    return [app.chart.gridOptions().vertLines, app.chart2.gridOptions().vertLines];
  })).toEqual([true, false]);
  await page.getByRole('button', { name: 'Chart type', exact: true }).click();
  await page.locator('#chart').focus();
  await expect(page.getByRole('button', { name: 'Place a Buy OCO bracket: entry, target and stop', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  expect(await page.evaluate(() => {
    const app = (window as any).__oac.app;
    return { primary: app.chart.getState().series[0].type, secondary: app.chart2.getState().series[0].type,
      symbol: app.req.symbol, study: app.chart2.indicators()[0].id };
  })).toEqual({ primary: 'candlestick', secondary: 'line', symbol: 'AAPL', study });
  await page.locator('#chart2').focus();
  await expect(page.getByRole('button', { name: 'Chart type', exact: true })).toContainText('Line');
  await expect(page.locator('#p2bar .pills')).toHaveCount(0);
  const primaryView = await page.evaluate(() => (window as any).__oac.app.chart.getVisibleLogicalRange());
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => {
    const app = (window as any).__oac?.app;
    return app?.chart2?.primaryBars().length > 0 && !app.loading && !app.loading2 && !app.restoringSecondary;
  });
  expect(await page.evaluate(() => {
    const app = (window as any).__oac.app;
    return { request: app.p2.symbol + '/' + app.p2.interval, type: app.chart2.getState().series[0].type,
      study: app.chart2.indicators()[0].id, length: app.chart2.indicators()[0].settings().length,
      grid: app.chart2.gridOptions().vertLines, selected: app.focusPane };
  })).toEqual({ request: 'TSLA/15m', type: 'line', study, length: 9, grid: false, selected: 2 });
  const restoredView = await page.evaluate(() => (window as any).__oac.app.chart.getVisibleLogicalRange());
  expect(restoredView.from).toBeCloseTo(primaryView.from, 5);
  expect(restoredView.to).toBeCloseTo(primaryView.to, 5);
  expect(await page.evaluate(() => (window as any).__oac.app.chart2.exportSVG())).toContain('TSLA');
  await page.screenshot({ path: info.outputPath('reference-shared-controls.png') });
});

test('chart settings retain their selected owner through cancel, rebuild and reload', async ({ page }, info) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await openDemo(page);
  await page.getByRole('button', { name: /Open a second, linked chart/ }).click();
  await page.waitForFunction(() => (window as any).__oac?.app.chart2?.primaryBars().length > 0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const firstView = await page.evaluate(() => {
    const chart = (window as any).__oac.app.chart2;
    return { ...chart.timeScale.getVisibleLogicalRange(), count: chart.primaryBars().length };
  });
  expect(firstView.to).toBeGreaterThanOrEqual(firstView.count - 1);
  expect(firstView.from).toBeLessThanOrEqual(1);
  await page.locator('#chart2').focus();
  const settings = page.getByRole('button', { name: 'Chart settings (or right-click the chart)', exact: true });
  await settings.click();
  await page.locator('#cset-tabs').getByRole('button', { name: 'Readout', exact: true }).click();
  await page.locator('[data-key="statusLine.titleMode"]').selectOption('description');
  expect(await page.evaluate(() => (window as any).__oac.app.chart2.statusLineOptions().titleMode)).toBe('description');
  expect(await page.evaluate(() => (window as any).__oac.app.chart.statusLineOptions().titleMode)).not.toBe('description');
  await page.locator('#chart').focus();
  await page.locator('#cset-cancel').click();
  expect(await page.evaluate(() => (window as any).__oac.app.chart2.statusLineOptions().titleMode)).toBe('symbol');
  await page.locator('#chart2').focus();
  await settings.click();
  await page.locator('#cset-tabs').getByRole('button', { name: 'Readout', exact: true }).click();
  await page.locator('[data-key="statusLine.titleMode"]').selectOption('description');
  await page.locator('[data-key="statusLine.barChange"]').uncheck();
  await page.locator('#cset-tabs').getByRole('button', { name: 'Axes', exact: true }).click();
  await page.locator('[data-key="time.timezone"]').selectOption('UTC');
  await page.locator('#cset-ok').click();
  expect(await page.evaluate(() => (window as any).__oac.app.chart.timezone())).toBe('Asia/Kolkata');
  expect(await page.evaluate(() => (window as any).__oac.app.chart2.timezone())).toBe('UTC');
  expect(await page.evaluate(() => (window as any).__oac.app.chart2.exportSVG())).toContain('Microsoft Corporation');
  await page.getByRole('button', { name: 'Chart type', exact: true }).click();
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__oac.app.chart2.statusLineOptions().barChange)).toBe(false);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const secondaryView = await page.evaluate(() => (window as any).__oac.app.chart2.timeScale.getVisibleLogicalRange());
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => (window as any).__oac?.app.chart2?.primaryBars().length > 0 && !(window as any).__oac.app.restoringSecondary);
  expect(await page.evaluate(() => (window as any).__oac.app.chart2.timezone())).toBe('UTC');
  expect(await page.evaluate(() => (window as any).__oac.app.chart.timezone())).toBe('Asia/Kolkata');
  expect(await page.evaluate(() => (window as any).__oac.app.chart2.statusLineOptions().titleMode)).toBe('description');
  const secondaryRestored = await page.evaluate(() => (window as any).__oac.app.chart2.timeScale.getVisibleLogicalRange());
  expect(secondaryRestored.from).toBeCloseTo(secondaryView.from, 5);
  expect(secondaryRestored.to).toBeCloseTo(secondaryView.to, 5);
  await page.mouse.move(5, 895);
  await page.screenshot({ path: info.outputPath('reference-owned-settings.png') });
  await settings.click();
  await page.evaluate(async () => { const source = '/examples/yfinance/src/split.js'; (await import(source)).closeSplit(); });
  await expect(page.locator('#chartset')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__oac.app.chart.statusLineOptions().titleMode)).not.toBe('description');
});

test('reference volume settings follow each chart and update their own average', async ({ page }, info) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await openDemo(page);
  await page.getByRole('button', { name: /Open a second, linked chart/ }).click();
  await page.waitForFunction(() => (window as any).__oac?.app.chart2?.primaryBars().length > 0);
  await page.locator('#chart2').focus();
  await page.getByRole('button', { name: 'Chart settings (or right-click the chart)', exact: true }).click();
  await page.locator('#cset-tabs').getByRole('button', { name: 'Volume', exact: true }).click();
  await page.locator('[data-key="volume.showMA"]').check();
  await page.locator('[data-key="volume.maPeriod"]').fill('3');
  await page.locator('[data-key="volume.maPeriod"]').press('Tab');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const colorFace = await page.locator('[data-key="volume.maColor"]').screenshot();
  const colorPixels = await page.evaluate(async encoded => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), value => value.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0); bitmap.close();
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let at = 0; at < data.length; at += 4) {
      if (data[at] === 230 && data[at + 1] === 181 && data[at + 2] === 60) count++;
    }
    return count;
  }, colorFace.toString('base64'));
  expect(colorPixels, 'colour control must show the selected colour').toBeGreaterThan(20);
  await page.screenshot({ path: info.outputPath('reference-volume-settings.png') });
  await page.locator('#cset-tabs').getByRole('button', { name: 'Price', exact: true }).click();
  await page.locator('[data-key="symbol.upColor"]').fill('#11aa22');
  await page.locator('[data-key="symbol.downColor"]').fill('#cc3344');
  await page.locator('#cset-ok').click();
  const result = await page.evaluate(() => {
    const app = (window as any).__oac.app;
    const time = app.chart2.primaryBars()[0].time;
    const bars = [10, 20, 30, 40].map((volume, index) => ({
      time: time + index * 3600, open: 100, high: 103, low: 97, close: index % 2 ? 99 : 101, volume,
    }));
    app.chart2.primarySeries().setData(bars);
    const initial = app.volumeMA2.getData().map((bar: any) => bar.close);
    const colors = app.volume2.getData().map((bar: any) => bar.color);
    app.chart2.primarySeries().update({ ...bars[3], volume: 60 });
    const replaced = app.volumeMA2.getData().at(-1).close;
    app.chart2.primarySeries().update({ ...bars[3], time: time + 4 * 3600, volume: 50 });
    return { initial, colors, replaced, appended: app.volumeMA2.getData().at(-1).close,
      sharedScale: app.volumeMA2.priceScale() === app.volume2.priceScale(),
      primaryAverage: app.volumeMA.getData().length };
  });
  expect(result.initial).toEqual([NaN, NaN, 20, 30]);
  expect(result.colors).toEqual(['#11aa22', '#cc3344', '#11aa22', '#cc3344']);
  expect(result.replaced).toBeCloseTo(110 / 3);
  expect(result.appended).toBeCloseTo(140 / 3);
  expect(result.sharedScale).toBe(true);
  expect(result.primaryAverage).toBe(0);
  await page.evaluate(async () => {
    const app = (window as any).__oac.app;
    await app.loadSecondary();
    const path = '/examples/yfinance/src/split.js';
    (await import(path)).withoutViewportSync(() => app.chart2.resetScale());
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => (window as any).__oac?.app.chart2?.primaryBars().length > 0 && !(window as any).__oac.app.restoringSecondary);
  expect(await page.evaluate(() => (window as any).__oac.app.chart2.primarySeriesInfo().style.upColor)).toBe('#11aa22');
  expect(await page.evaluate(() => (window as any).__oac.app.chart2.primarySeriesInfo().style.downColor)).toBe('#cc3344');
  await page.getByRole('button', { name: 'Chart settings (or right-click the chart)', exact: true }).click();
  await page.locator('#cset-tabs').getByRole('button', { name: 'Volume', exact: true }).click();
  await expect(page.locator('[data-key="volume.showMA"]')).toBeChecked();
  await expect(page.locator('[data-key="volume.maPeriod"]')).toHaveValue('3');
  await page.locator('[data-key="volume.visible"]').uncheck();
  await page.locator('#cset-ok').click();
  expect(await page.evaluate(() => (window as any).__oac.app.chart.getState().series.filter((series: any) => series.type === 'histogram')[0].style.visible)).not.toBe(false);
  expect(await page.evaluate(() => (window as any).__oac.app.chart2.getState().series.filter((series: any) => series.priceScaleId === '').every((series: any) => series.style.visible === false))).toBe(true);
  await page.getByRole('button', { name: 'Chart settings (or right-click the chart)', exact: true }).click();
  await page.locator('#cset-tabs').getByRole('button', { name: 'Volume', exact: true }).click();
  await page.locator('[data-key="volume.visible"]').check();
  await page.locator('#cset-ok').click();
  await page.mouse.move(5, 895);
  await page.locator('#shellbar').evaluate(element => { element.scrollLeft = 0; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: info.outputPath('reference-volume-average.png') });
  for (const theme of ['dark', 'light']) {
    await page.evaluate(async (name) => {
      const path = '/examples/yfinance/src/ui.js';
      (await import(path)).setTheme(name);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, theme);
    const box = (await page.locator('#chart2').boundingBox())!;
    const histogram = await page.screenshot({ clip: { x: box.x + 2, y: box.y + box.height * 0.82,
      width: box.width - 66, height: box.height * 0.14 } });
    const pixels = await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0); bitmap.close();
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const counts = [0, 0];
      for (let at = 0; at < data.length; at += 4) {
        if (data[at] === 17 && data[at + 1] === 170 && data[at + 2] === 34) counts[0]++;
        if (data[at] === 204 && data[at + 1] === 51 && data[at + 2] === 68) counts[1]++;
      }
      return counts;
    }, histogram.toString('base64'));
    expect(pixels[0], theme + ' up-volume pixels').toBeGreaterThan(20);
    expect(pixels[1], theme + ' down-volume pixels').toBeGreaterThan(20);
    if (theme === 'light') await page.screenshot({ path: info.outputPath('reference-volume-average-light.png') });
  }
  await page.getByRole('button', { name: 'Chart type', exact: true }).click();
  await page.getByRole('button', { name: 'Renko', exact: true }).click();
  await page.getByRole('button', { name: 'Chart settings (or right-click the chart)', exact: true }).click();
  await page.locator('#cset-tabs').getByRole('button', { name: 'Volume', exact: true }).click();
  await expect(page.locator('[data-key="volume.showMA"]')).toBeDisabled();
  await page.locator('#cset-ok').click();
  await page.getByRole('button', { name: 'Chart type', exact: true }).click();
  await page.getByRole('button', { name: 'Candles', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__oac.app.volumeMA2.getData().length)).toBeGreaterThan(3);
  await page.getByRole('button', { name: 'Chart type', exact: true }).click();
  await page.getByRole('button', { name: 'Heikin Ashi', exact: true }).click();
  expect(await page.evaluate(() => Boolean((window as any).__oac.app.volume2))).toBe(true);
  const transformed = await page.evaluate(() => {
    const app = (window as any).__oac.app, chart = app.chart2;
    const style = { upColor: chart.theme().upColor, downColor: chart.theme().downColor, ...chart.primarySeriesInfo().style };
    return { actual: app.volume2.getData().map((bar: any) => [bar.close, bar.color]),
      expected: chart.primaryBars().map((bar: any) => [bar.volume, bar.close >= bar.open ? style.upColor : style.downColor]),
      average: app.volumeMA2.getData().length, count: chart.primaryBars().length };
  });
  expect(transformed.actual).toEqual(transformed.expected);
  expect(transformed.average).toBe(transformed.count);
});

test('transformed price readout uses displayed candles', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Chart type', exact: true }).click();
  await page.getByRole('button', { name: 'Heikin Ashi', exact: true }).click();
  const reading = await page.evaluate(async () => {
    const app = (window as any).__oac.app;
    const path = '/examples/yfinance/src/ui.js';
    const { fmt } = await import(path);
    const bars = app.chart.primaryBars();
    const svg = new DOMParser().parseFromString(app.chart.exportSVG(), 'image/svg+xml');
    const texts = [...svg.querySelectorAll('text')].map(node => node.textContent);
    return { actual: texts[texts.indexOf('C') + 1],
      expected: fmt(bars.at(-1).close), volume: Boolean(app.volume) };
  });
  expect(reading.actual).toBe(reading.expected);
  expect(reading.volume).toBe(true);
});

test('calendar timezone settings refold only their owner after confirmation', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: /Open a second, linked chart/ }).click();
  await page.waitForFunction(() => (window as any).__oac?.app.chart2?.primaryBars().length > 0);
  await page.locator('#chart2').focus();
  await page.locator('#shellbar .pills').getByRole('button', { name: '1MO', exact: true }).click();
  await page.waitForFunction(() => !(window as any).__oac.app.loading2 && (window as any).__oac.app.p2.interval === '1mo');
  await page.evaluate(() => { (window as any).__settingsOwner = (window as any).__oac.app.chart2; });
  const settings = page.getByRole('button', { name: 'Chart settings (or right-click the chart)', exact: true });
  await settings.click();
  await page.locator('#cset-tabs').getByRole('button', { name: 'Axes', exact: true }).click();
  await page.locator('[data-key="time.timezone"]').selectOption('UTC');
  await page.locator('#cset-cancel').click();
  expect(await page.evaluate(() => (window as any).__oac.app.chart2 === (window as any).__settingsOwner)).toBe(true);
  expect(await page.evaluate(() => (window as any).__oac.app.p2.timezone)).toBe('Asia/Kolkata');
  await settings.click();
  await page.locator('#cset-tabs').getByRole('button', { name: 'Axes', exact: true }).click();
  await page.locator('[data-key="time.timezone"]').selectOption('UTC');
  await page.locator('#cset-ok').click();
  await page.waitForFunction(() => !(window as any).__oac.app.loading2 && (window as any).__oac.app.chart2 !== (window as any).__settingsOwner);
  const firstTime = await page.evaluate(() => (window as any).__oac.app.chart2.primaryBars()[0].time);
  const first = new Date(firstTime * 1000);
  expect([first.getUTCDate(), first.getUTCHours(), first.getUTCMinutes()]).toEqual([1, 0, 0]);
  expect(await page.evaluate(() => (window as any).__oac.app.chart.timezone())).toBe('Asia/Kolkata');
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => (window as any).__oac?.app.chart2?.primaryBars().length > 0 && !(window as any).__oac.app.restoringSecondary);
  expect(await page.evaluate(() => (window as any).__oac.app.chart2.primaryBars()[0].time)).toBe(firstTime);
  expect(await page.evaluate(() => (window as any).__oac.app.chart2.timezone())).toBe('UTC');
});

test('volume and daily readout follow the replay prefix without future readings', async ({ page }) => {
  await openDemo(page);
  const evidence = await page.evaluate(async () => {
    const { app } = (window as any).__oac;
    const volumePath = '/examples/yfinance/src/volume.js';
    const replayPath = '/examples/yfinance/src/replay.js';
    const statusPath = '/examples/yfinance/src/status.js';
    const volume = await import(volumePath), replay = await import(replayPath), status = await import(statusPath);
    volume.applyVolumeSettings(1, { 'volume.showMA': true, 'volume.maPeriod': 3 });
    const count = app.chart.primaryBars().length;
    await replay.startReplayAt(10);
    const samples = [];
    const record = () => {
      const bars = app.chart.primaryBars();
      const expected = volume.volumeAverage(bars.map((bar: any) => ({ time: bar.time, close: bar.volume })), 3);
      samples.push({ times: bars.map((bar: any) => bar.time), volume: app.volume.getData(),
        average: app.volumeMA.getData(), expected, amounts: bars.map((bar: any) => bar.volume),
        reading: status.dayChangeReading(bars, app.chart.timezone())?.text,
        supplied: app.symbolLegend.options().status().lastDayChange?.text,
        svg: app.chart.exportSVG() });
    };
    record();
    app.replay.step(); record();
    app.replay.stepBack(); record();
    app.replay.seek(30); record();
    replay.exitReplay();
    return { samples, count, restored: app.volume.getData().length, restoredAverage: app.volumeMA.getData().length };
  });
  for (const sample of evidence.samples) {
    expect(sample.times.length).toBeGreaterThan(2);
    expect(sample.times.length).toBeLessThan(evidence.count);
    expect(sample.volume.map((bar: any) => bar.time)).toEqual(sample.times);
    expect(sample.volume.map((bar: any) => bar.close)).toEqual(sample.amounts);
    expect(sample.average.map((bar: any) => bar.close)).toEqual(sample.expected.map((bar: any) => bar.close));
    expect(sample.reading).toBeTruthy();
    expect(sample.supplied).toBe(sample.reading);
    expect(sample.svg).toContain(sample.reading!);
  }
  expect(evidence.restored).toBe(evidence.count);
  expect(evidence.restoredAverage).toBe(evidence.count);
});

test('secondary requests cancel stale history and retain the last saved source during loading', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await openDemo(page);
  await page.getByRole('button', { name: /Open a second, linked chart/ }).click();
  await page.waitForFunction(() => (window as any).__oac?.app.chart2?.primaryBars().length > 0);
  await page.locator('#chart2').focus();
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  let release: (() => void) | undefined;
  let cancelled = 0;
  page.on('requestfailed', request => { if (request.url().includes('symbol=SLOW')) cancelled++; });
  await page.route('**/api/history**', async route => {
    if (new URL(route.request().url()).searchParams.get('symbol') !== 'SLOW') { await route.continue(); return; }
    const response = await route.fetch();
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ response });
  });
  const symbol = async (value: string) => {
    await page.getByRole('button', { name: 'Change symbol', exact: true }).click();
    await page.getByPlaceholder('Symbol or expression').fill(value);
    await page.getByPlaceholder('Symbol or expression').press('Enter');
  };
  try {
    await symbol('SLOW');
    await expect.poll(() => Boolean(release)).toBe(true);
    expect(await page.evaluate(() => {
      const app = (window as any).__oac.app;
      return { loading: app.loading2, bars: app.chart2.primaryBars().length };
    })).toEqual({ loading: true, bars: 0 });
    await expect(page.getByRole('button', { name: 'Chart type', exact: true })).toBeDisabled();
    await page.evaluate(async () => {
      const source = '/examples/yfinance/src/persist.js';
      (await import(source)).flushAutosave();
    });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('oa-charts:layout')!).secondary.request.symbol)).toBe('MSFT');
    await symbol('TSLA');
    await page.waitForFunction(() => {
      const app = (window as any).__oac.app;
      return app.chart2.getDataContext().symbol === 'TSLA' && !app.loading2 && app.chart2.primaryBars().length > 0;
    });
    await expect.poll(() => cancelled).toBe(1);
    release?.();
    release = undefined;
    await symbol('SLOW');
    await expect.poll(() => Boolean(release)).toBe(true);
    await page.getByRole('button', { name: 'Close the second chart', exact: true }).click();
    await expect.poll(() => cancelled).toBe(2);
    release?.();
    release = undefined;
    expect(await page.evaluate(() => {
      const app = (window as any).__oac.app;
      return { secondary: app.chart2, loading: app.loading2, selected: app.focusPane, primary: app.req.symbol,
        orders: app.orders.length, fills: app.fills.length };
    })).toEqual({ secondary: null, loading: false, selected: 1, primary: 'AAPL', orders: 0, fills: 0 });
  } finally {
    release?.();
  }
});

test('reference interval sync is optional and follows the selected chart', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await openDemo(page);
  await page.getByRole('button', { name: /Open a second, linked chart/ }).click();
  await page.waitForFunction(() => (window as any).__oac?.app.chart2?.primaryBars().length > 0);
  expect(await page.evaluate(() => (window as any).__oac.app.linkGroup.options().interval)).toBe(false);
  await page.locator('#chart2').focus();
  await page.getByRole('button', { name: /^Chart linking \(/ }).click();
  await page.getByRole('button', { name: /^Interval/ }).click();
  await page.waitForFunction(() => {
    const app = (window as any).__oac.app;
    return app.req.interval === app.p2.interval && !app.loading && !app.loading2;
  });
  await page.locator('#shellbar .pills').getByRole('button', { name: '30M', exact: true }).click();
  await page.waitForFunction(() => {
    const app = (window as any).__oac.app;
    return app.req.interval === '30m' && app.p2.interval === '30m' && !app.loading && !app.loading2;
  });
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => {
    const app = (window as any).__oac?.app;
    return app?.chart2?.primaryBars().length > 0 && !app.loading && !app.loading2 && !app.restoringSecondary;
  });
  expect(await page.evaluate(() => (window as any).__oac.app.linkGroup.options().interval)).toBe(true);
  expect(await page.evaluate(() => {
    const app = (window as any).__oac.app;
    return [app.req.interval, app.p2.interval];
  })).toEqual(['30m', '30m']);
  await page.getByRole('button', { name: /^Chart linking \(/ }).click();
  await page.getByRole('button', { name: /^Interval/ }).click();
  await page.locator('#chart').focus();
  await page.locator('#shellbar .pills').getByRole('button', { name: '1D', exact: true }).click();
  await page.waitForFunction(() => !(window as any).__oac.app.loading);
  expect(await page.evaluate(() => {
    const app = (window as any).__oac.app;
    return [app.req.interval, app.p2.interval, app.linkGroup.options().interval];
  })).toEqual(['1d', '30m', false]);
});

for (const pane of [1, 2]) {
  test(`reference context alert creation stays on chart ${pane}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1360, height: 900 });
    await openDemo(page);
    if (pane === 2) {
      await page.getByRole('button', { name: /Open a second, linked chart/ }).click();
      await page.waitForFunction(() => (window as any).__oac?.app.chart2?.primaryBars().length > 0);
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
  await page.waitForFunction(() => (window as any).__oac?.app.chart2?.primaryBars().length > 0);
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
