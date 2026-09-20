import { test, expect } from '@playwright/test';

test('different chart intervals expose only candles available at the replay clock', async ({ page }, info) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__ready);
  const initial = await page.evaluate(async () => {
    (window as any).__api.chart.destroy();
    const source = '/dist/openalgo-charts.mjs';
    const lib = await import(source);
    document.body.innerHTML = '<div id="fast" style="position:absolute;inset:0 50% 0 0"></div>'
      + '<div id="slow" style="position:absolute;inset:0 0 0 50%"></div>';
    const origin = 1700000000;
    const bars = (step: number, count: number) => Array.from({ length: count }, (_, index) => ({
      time: origin + step * index, open: 100 + index, high: 105 + index,
      low: 98 + index, close: 102 + index, volume: 100 + index,
    }));
    const charts = [lib.createChart(document.getElementById('fast')), lib.createChart(document.getElementById('slow'))];
    charts[0].addSeries('candlestick').setData(bars(60, 10));
    charts[1].addSeries('candlestick').setData(bars(300, 2));
    const controllers = charts.map((chart: any, index: number) => new lib.ReplayController(chart, {
      timing: { barEndTime: (bar: any) => bar.time + (index ? 300 : 60) }, startTime: origin + 120,
    }));
    (window as any).__timed = { charts, controllers, origin };
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return charts.map((chart: any) => chart.primaryBars().map((bar: any) => bar.time - origin));
  });
  expect(initial).toEqual([[0, 60], []]);
  await page.screenshot({ path: info.outputPath('replay-time-before-coarse-close.png') });
  const complete = await page.evaluate(async () => {
    const { charts, controllers, origin } = (window as any).__timed;
    controllers.forEach((controller: any) => controller.seekTime(origin + 300));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return charts.map((chart: any) => chart.primaryBars().map((bar: any) => bar.time - origin));
  });
  expect(complete).toEqual([[0, 60, 120, 180, 240], [0]]);
  await page.screenshot({ path: info.outputPath('replay-time-at-coarse-close.png') });
  expect(await page.evaluate(() => {
    const { charts, controllers } = (window as any).__timed;
    controllers.forEach((controller: any) => controller.stop());
    return charts.map((chart: any) => chart.primaryBars().length);
  })).toEqual([10, 2]);
});
