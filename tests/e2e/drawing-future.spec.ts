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
    const chart = createChart(document.getElementById('c'), { priceAxisWidth: 64, timeAxisHeight: 28, timeNavigator: false });
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


test('saved drawings remain visible in future space and stay outside the price axis', async ({ page }, info) => {
  await mount(page);
  await page.evaluate(() => {
    const { draw, bars } = (window as any).__future;
    draw.add({ tool: 'trend-line', points: [
      { time: bars[80].time, price: 23700 },
      { time: bars[99].time + 65 * 86400, price: 23900 },
    ], style: { color: '#ff00ff', lineWidth: 4 }, paneIndex: 0 });
    draw.add({ tool: 'rectangle', points: [
      { time: bars[90].time, price: 23780 },
      { time: bars[99].time + 50 * 86400, price: 23830 },
    ], style: { color: '#ff00ff', lineWidth: 4 }, paneIndex: 0 });
    const saved = JSON.parse(JSON.stringify(draw.toJSON()));
    draw.fromJSON(saved);
  });
  await page.mouse.move(10, 10);
  await expect.poll(() => futureInk(page)).toBeGreaterThan(100);
  const axisInk = await page.locator('#c canvas').nth(1).evaluate(canvas => {
    const c = canvas as HTMLCanvasElement;
    const chart = (window as any).__future.chart;
    const dpr = c.width / c.getBoundingClientRect().width;
    const x = Math.ceil(chart.timeScale.width * dpr);
    const pixels = c.getContext('2d')!.getImageData(x, 0, c.width - x, c.height).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 180 && pixels[i + 1] < 90 && pixels[i + 2] > 180 && pixels[i + 3] > 80) ink++;
    }
    return ink;
  });
  await page.screenshot({ path: info.outputPath('saved-future-axis.png') });
  expect(axisInk).toBe(0);
});

for (const placement of ['left', 'pane', 'left-only'] as const) {
  test(`selected drawings clip to the ${placement} plot and time-axis boundary`, async ({ page }, info) => {
    await mount(page);
    await page.evaluate(where => {
      const { chart, draw, bars } = (window as any).__future;
      const paneIndex = where === 'pane' ? 1 : 0;
      if (paneIndex) chart.addSeries('line', { paneIndex }).setData(bars);
      else if (where === 'left-only') chart.movePriceAxis(0, 'right', 'left');
      else chart.addSeries('line', { priceScaleId: 'left' }).setData(bars);
      const drawing = draw.add({ tool: 'trend-line', paneIndex, points: [
        { time: bars[0].time - 20 * 86400, price: 24000 },
        { time: bars[99].time + 65 * 86400, price: 23500 },
      ], style: { color: '#ff00ff', lineWidth: 4 } });
      draw.select(drawing.id);
    }, placement);
    await page.mouse.move(10, 10);
    const canvas = page.locator('#c canvas').nth(placement === 'pane' ? 3 : 1);
    const pixels = async () => canvas.evaluate((element, where) => {
      const c = element as HTMLCanvasElement;
      const chart = (window as any).__future.chart;
      const dpr = c.width / c.getBoundingClientRect().width;
      const left = where === 'pane' ? 0 : 64 * dpr;
      const right = left + chart.timeScale.width * dpr;
      const bottom = c.height - 28 * dpr;
      const pixels = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let plot = 0, outside = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 180 && pixels[i + 1] < 90 && pixels[i + 2] > 180 && pixels[i + 3] > 80) {
          const x = (i / 4) % c.width, y = Math.floor((i / 4) / c.width);
          if (x < left || x >= right || y >= bottom) outside++; else plot++;
        }
      }
      return { plot, outside };
    }, placement);
    await expect.poll(async () => (await pixels()).plot).toBeGreaterThan(100);
    await page.screenshot({ path: info.outputPath(`selected-${placement}-axis.png`) });
    expect((await pixels()).outside).toBe(0);
  });
}


test('a future endpoint remains draggable after moving the primary scale left', async ({ page }) => {
  await mount(page);
  const start = await page.evaluate(() => {
    const { chart, draw, bars } = (window as any).__future;
    const drawing = draw.add({ tool: 'trend-line', paneIndex: 0, points: [
      { time: bars[40].time, price: 23880 },
      { time: bars[99].time + 21 * 86400, price: 23750 },
    ], style: { color: '#ff00ff', lineWidth: 4 } });
    chart.movePriceAxis(0, 'right', 'left');
    draw.select(drawing.id);
    const endpoint = drawing.points[1];
    return { x: chart.timeToCoordinate(endpoint.time), y: chart.priceToCoordinate(endpoint.price) };
  });
  await expect.poll(() => futureInk(page)).toBeGreaterThan(100);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y - 30, { steps: 8 });
  await page.mouse.up();
  const moved = await page.evaluate(() => {
    const { chart, draw } = (window as any).__future;
    const endpoint = draw.drawings()[0].points[1];
    return { x: chart.timeToCoordinate(endpoint.time), y: chart.priceToCoordinate(endpoint.price) };
  });
  // Browser pointer events may quantize coordinates to whole CSS pixels.
  expect(Math.abs(moved.x - (start.x + 40))).toBeLessThanOrEqual(1);
  expect(Math.abs(moved.y - (start.y - 30))).toBeLessThanOrEqual(1);
});
