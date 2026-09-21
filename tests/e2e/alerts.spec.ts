import { expect, test, type Page } from '@playwright/test';
import type { AlertController, Chart, SeriesApi, Bar, AlertTriggeredPayload } from '../../src/index';
import type { DrawingController } from '../../src/draw/index';

declare global {
  interface Window {
    __alertsDemo: {
      chart: Chart; series: SeriesApi; draw: DrawingController; alerts: AlertController;
      bars: Bar[]; ids: Record<string, string>; drawingId: string; fired: AlertTriggeredPayload[];
    };
  }
}

async function ink(page: Page, rgb: readonly number[]) {
  return page.locator('#chart canvas').evaluateAll((elements, rgb) => {
    let count = 0;
    for (const element of elements) {
      const canvas = element as HTMLCanvasElement;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] === rgb[0] && pixels[i + 1] === rgb[1] && pixels[i + 2] === rgb[2] && pixels[i + 3] > 200) count++;
      }
    }
    return count;
  }, [...rgb]);
}

test('price alerts remain visible across timeframes while their original evaluation stays paused', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto('/tests/e2e/alerts-fixture.html');
  await page.waitForFunction(() => !!window.__alertsDemo);
  await page.evaluate(() => {
    const { chart, series, alerts, bars } = window.__alertsDemo;
    const document = alerts.toJSON();
    series.setData([]);
    chart.setDataContext({ symbol: 'ALERT FIXTURE', exchange: 'SIM', interval: '5m' });
    series.setData(bars.filter((_, index) => index % 5 === 0));
    alerts.fromJSON(document);
    chart.fitContent();
  });
  await expect.poll(() => page.evaluate(() => window.__alertsDemo.chart.exportSVG().includes('Confirmed threshold (1m)'))).toBe(true);
  const paused = await page.evaluate(() => {
    const { chart, alerts, ids, fired } = window.__alertsDemo;
    return { svg: chart.exportSVG(), availability: alerts.availability(ids.close), fired: fired.length, count: alerts.list().length };
  });
  expect(paused.availability).toMatchObject({ available: false, reason: expect.stringContaining('1m') });
  expect(paused.count).toBe(5);
  expect(paused.fired).toBe(0);
  expect(paused.svg).toContain('Paused');
  expect(paused.svg).toContain('Disabled');
  expect(paused.svg).toContain('Expired');
  expect(paused.svg).not.toContain('Drawing threshold');
  await expect.poll(() => ink(page, [59, 130, 246])).toBeGreaterThan(100);
  const point = await page.evaluate(() => {
    const { chart } = window.__alertsDemo;
    const box = document.getElementById('chart')!.getBoundingClientRect();
    return { x: box.left + 400, y: box.top + chart.priceToCoordinate(110)! };
  });
  await page.mouse.move(point.x, point.y);
  expect(await page.locator('#chart').evaluate(node => node.style.cursor)).not.toBe('ns-resize');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: info.outputPath('alerts-other-timeframe.png'), animations: 'disabled' });
  await page.evaluate(() => {
    const { chart, series, bars } = window.__alertsDemo;
    series.setData([]);
    chart.setDataContext({ symbol: 'ALERT FIXTURE', exchange: 'SIM', interval: '1m' });
    series.setData(bars);
    chart.fitContent();
  });
  expect(await page.evaluate(() => window.__alertsDemo.fired)).toEqual([]);
  expect(await page.evaluate(() => window.__alertsDemo.alerts.availability(window.__alertsDemo.ids.close).available)).toBe(true);
  expect(await page.evaluate(() => window.__alertsDemo.chart.exportSVG())).toContain('Drawing threshold');
  await page.evaluate(() => {
    const { series, bars } = window.__alertsDemo;
    const tail = bars[bars.length - 1];
    series.update({ ...tail, close: 112, high: 113 });
    series.update({ ...tail, time: tail.time + 60, open: 112, close: 112, high: 113 });
  });
  expect(await page.evaluate(() => {
    const { fired, ids } = window.__alertsDemo;
    return fired.filter(event => event.alertId === ids.close).length;
  })).toBe(1);
  expect(errors).toEqual([]);
});

test('drawing alerts follow a real drag and render armed, triggered, disabled and expired levels', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto('/tests/e2e/alerts-fixture.html');
  await page.waitForFunction(() => !!window.__alertsDemo);
  for (const rgb of [[59, 130, 246], [100, 116, 139], [217, 119, 6]]) {
    await expect.poll(() => ink(page, rgb)).toBeGreaterThan(100);
  }
  expect(await page.evaluate(() => window.__alertsDemo.chart.exportSVG())).toContain('Confirmed threshold');
  await page.screenshot({ path: info.outputPath('alerts-armed.png'), animations: 'disabled' });
  const point = await page.evaluate(() => {
    const { chart, bars } = window.__alertsDemo;
    const rect = document.getElementById('chart')!.getBoundingClientRect();
    return { x: rect.left + chart.timeToCoordinate(bars[27].time), y: rect.top + chart.priceToCoordinate(108)!,
      targetY: rect.top + chart.priceToCoordinate(112)! };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x, point.targetY, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => {
    const { draw, drawingId } = window.__alertsDemo;
    return draw.get(drawingId)!.points[0].price;
  })).toBeCloseTo(112, 1);
  await page.evaluate(() => {
    const { series, bars } = window.__alertsDemo;
    series.update({ ...bars[bars.length - 1], high: 114 });
  });
  await expect.poll(() => page.evaluate(() => window.__alertsDemo.fired.length)).toBe(2);
  expect(await page.evaluate(() => window.__alertsDemo.alerts.list().filter(alert => alert.state === 'triggered').map(alert => alert.id).sort()))
    .toEqual(await page.evaluate(() => [window.__alertsDemo.ids.touch, window.__alertsDemo.ids.drawing].sort()));
  await expect.poll(() => ink(page, [34, 197, 94])).toBeGreaterThan(100);
  await page.evaluate(() => {
    const { series, bars } = window.__alertsDemo;
    const last = bars[bars.length - 1];
    series.update(last);
    series.update({ ...last, time: last.time + 60 });
  });
  expect(await page.evaluate(() => window.__alertsDemo.alerts.list().find(alert => alert.id === window.__alertsDemo.ids.close)!.state)).toBe('armed');
  const svg = await page.evaluate(() => window.__alertsDemo.chart.exportSVG());
  for (const label of ['Triggered', 'Alert', 'Disabled', 'Expired']) expect(svg).toContain(label);
  const overdraw = await page.evaluate(() => {
    const { chart, draw, drawingId } = window.__alertsDemo;
    const price = draw.get(drawingId)!.points[0].price;
    const overlay = document.querySelectorAll<HTMLCanvasElement>('#chart canvas')[1];
    const dpr = overlay.width / overlay.getBoundingClientRect().width;
    const y = chart.priceToCoordinate(price)!;
    const pixels = overlay.getContext('2d')!.getImageData(8 * dpr, Math.round(y * dpr), 140 * dpr, 1).data;
    let magenta = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 200 && pixels[i + 1] > 70 && pixels[i + 1] < 160 && pixels[i + 2] > 200) magenta++;
    }
    return magenta;
  });
  expect(overdraw, 'Drawing strokes must not strike through alert state and title').toBe(0);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: info.outputPath('alerts-triggered.png'), animations: 'disabled' });
  await page.evaluate(() => window.__alertsDemo.draw.remove(window.__alertsDemo.drawingId));
  expect(await page.evaluate(() => window.__alertsDemo.chart.exportSVG())).not.toContain('Drawing threshold');
  expect(errors).toEqual([]);
});

test('clear plot space preserves pane panning and alert teardown removes every overlay', async ({ page }) => {
  await page.goto('/tests/e2e/alerts-fixture.html');
  await page.waitForFunction(() => !!window.__alertsDemo);
  const point = await page.evaluate(() => {
    const { chart } = window.__alertsDemo;
    const rect = document.getElementById('chart')!.getBoundingClientRect();
    return { x: rect.left + 500, y: rect.top + chart.priceToCoordinate(101)!, from: chart.getVisibleLogicalRange()!.from };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 120, point.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__alertsDemo.chart.getVisibleLogicalRange()!.from)).not.toBe(point.from);
  await page.evaluate(() => window.__alertsDemo.alerts.destroy());
  const svg = await page.evaluate(() => window.__alertsDemo.chart.exportSVG());
  for (const label of ['Intrabar threshold', 'Confirmed threshold', 'Drawing threshold', 'Disabled level', 'Expired level']) expect(svg).not.toContain(label);
});

test('a page reload restores drawing anchors and triggered once levels without new delivery', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto('/tests/e2e/alerts-fixture.html');
  await page.waitForFunction(() => !!window.__alertsDemo);
  await page.evaluate(() => {
    const { series, bars, chart } = window.__alertsDemo;
    series.update({ ...bars[bars.length - 1], high: 114 });
    sessionStorage.setItem('saved-alert-chart', JSON.stringify(chart.getState()));
  });
  expect(await page.evaluate(() => window.__alertsDemo.fired.length)).toBe(2);
  await page.reload();
  await page.waitForFunction(() => !!window.__alertsDemo);
  expect(await page.evaluate(() => window.__alertsDemo.chart.restoreState(JSON.parse(sessionStorage.getItem('saved-alert-chart')!)).applied)).toBe(true);
  expect(await page.evaluate(() => window.__alertsDemo.alerts.list().map(alert => [alert.title, alert.state]))).toEqual([
    ['Intrabar threshold', 'triggered'], ['Confirmed threshold', 'armed'], ['Drawing threshold', 'triggered'],
    ['Disabled level', 'disabled'], ['Expired level', 'expired'],
  ]);
  expect(await page.evaluate(() => {
    const { alerts, draw } = window.__alertsDemo;
    const source = alerts.list().find(alert => alert.title === 'Drawing threshold')!.source;
    return source.kind === 'drawing' && draw.get(source.drawingId)?.points[0].price;
  })).toBe(108);
  await page.evaluate(() => {
    const { series, bars } = window.__alertsDemo;
    const last = bars[bars.length - 1];
    series.update({ ...last, high: 115 });
    series.update({ ...last, time: last.time + 60 });
  });
  expect(await page.evaluate(() => window.__alertsDemo.fired)).toEqual([]);
  await expect.poll(() => ink(page, [34, 197, 94])).toBeGreaterThan(100);
  const svg = await page.evaluate(() => window.__alertsDemo.chart.exportSVG());
  for (const title of ['Intrabar threshold', 'Confirmed threshold', 'Drawing threshold', 'Disabled level', 'Expired level']) {
    expect(svg.split(title).length - 1).toBe(1);
  }
  await page.screenshot({ path: info.outputPath('alerts-restored.png'), animations: 'disabled' });
  expect(errors).toEqual([]);
});
