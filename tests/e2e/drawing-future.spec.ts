import { test, expect, type Page } from '@playwright/test';

async function mount(page: Page) {
  await page.setViewportSize({ width: 1200, height: 760 });
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__ready);
  await page.evaluate(async () => {
    (window as any).__api.chart.destroy();
    const base = '/dist/openalgo-charts.mjs';
    const tier = '/dist/openalgo-charts.draw.mjs';
    const { createChart } = await import(base);
    const { DrawingController } = await import(tier);
    const chart = createChart(document.getElementById('c'), { priceAxisWidth: 64, timeNavigator: false });
    const bars = Array.from({ length: 100 }, (_, i) => {
      const close = 23800 + Math.sin(i / 8) * 160;
      return { time: 1750000000 + i * 86400, open: close - 20, high: close + 35, low: close - 40, close };
    });
    const series = chart.addSeries('candlestick');
    series.setData(bars);
    chart.setVisibleLogicalRange({ from: 0, to: 140 });
    const draw = new DrawingController(chart, { defaultStyle: { color: '#ff00ff', lineWidth: 3 } });
    let crosshair: unknown;
    chart.subscribeCrosshairMove((event: unknown) => { crosshair = event; });
    (window as any).__future = { chart, draw, series, bars, DrawingController, crosshair: () => crosshair };
  });
}

async function futureInk(page: Page) {
  return page.locator('#c canvas').nth(1).evaluate(canvas => {
    const c = canvas as HTMLCanvasElement;
    const dpr = c.width / c.getBoundingClientRect().width;
    const x = Math.round(850 * dpr);
    const pixels = c.getContext('2d')!.getImageData(x, 100 * dpr, 260 * dpr, 500 * dpr).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 180 && pixels[i + 1] < 90 && pixels[i + 2] > 180 && pixels[i + 3] > 80) ink++;
    }
    return ink;
  });
}

for (const tool of ['trend-line', 'rectangle']) {
  test(`${tool} previews, commits and remains editable beyond the latest candle`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await mount(page);
    await page.evaluate(id => (window as any).__future.draw.setTool(id), tool);
    await page.mouse.click(620, 220);
    await page.mouse.move(1040, 430, { steps: 12 });
    await page.screenshot({ path: info.outputPath('future-preview.png') });
    const hovered = await page.evaluate(() => (window as any).__future.crosshair());
    expect(hovered.time).toBeNull();
    expect(hovered.bar).toBeNull();
    await expect.poll(() => futureInk(page)).toBeGreaterThan(100);
    await page.mouse.click(1040, 430);
    expect(await page.evaluate(() => (window as any).__future.draw.drawings().length)).toBe(1);
    await page.mouse.move(1040, 430);
    await page.mouse.down();
    await page.mouse.move(1080, 450, { steps: 10 });
    await page.mouse.up();
    const endpoint = await page.evaluate(() => {
      const { chart, draw } = (window as any).__future;
      const point = draw.drawings()[0].points[1];
      return { x: chart.timeToCoordinate(point.time), y: chart.priceToCoordinate(point.price) };
    });
    expect(endpoint.x).toBeCloseTo(1080, 4);
    expect(endpoint.y).toBeCloseTo(450, 4);
    await page.evaluate(() => {
      const api = (window as any).__future;
      const saved = JSON.parse(JSON.stringify(api.draw.toJSON()));
      api.draw.destroy();
      api.draw = new api.DrawingController(api.chart);
      api.draw.fromJSON(saved);
      api.series.update({ ...api.bars.at(-1), time: api.bars.at(-1).time + 86400 });
    });
    await page.mouse.move(10, 10);
    await expect.poll(() => futureInk(page)).toBeGreaterThan(100);
    await page.screenshot({ path: info.outputPath('future-restored.png') });
    expect(errors).toEqual([]);
  });
}

test('freehand strokes can start and continue in future space', async ({ page }, info) => {
  await mount(page);
  await page.evaluate(() => (window as any).__future.draw.setTool('brush'));
  await page.mouse.move(880, 280);
  await page.mouse.down();
  await page.mouse.move(960, 220, { steps: 8 });
  await page.mouse.move(1060, 350, { steps: 8 });
  await page.mouse.up();
  await page.mouse.move(10, 10);
  await page.screenshot({ path: info.outputPath('future-freehand.png') });
  expect(await page.evaluate(() => (window as any).__future.draw.drawings().length)).toBe(1);
  await expect.poll(() => futureInk(page)).toBeGreaterThan(100);
});
