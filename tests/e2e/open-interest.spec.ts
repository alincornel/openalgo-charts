import { expect, test } from '@playwright/test';
import type { Bar } from '../../src/model/bar';
import type { Widget } from '../../src/widget/widget';

declare global {
  interface Window { __oiDemo: { widget: Widget; bars: Bar[] } }
}

test('OI studies paint all regimes and the readout honors zero, absence and capability', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/tests/e2e/open-interest-fixture.html');
  await page.waitForFunction(() => !!window.__oiDemo);
  await expect(page.locator('.oac-statusline__oi')).toBeHidden();

  await expect.poll(() => page.locator('.oac-chart canvas').first().evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 0 && pixels[i + 1] === 238 && pixels[i + 2] === 0) counts[0]++;
      if (pixels[i] === 238 && pixels[i + 1] === 0 && pixels[i + 2] === 0) counts[1]++;
      if (pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 238) counts[2]++;
      if (pixels[i] === 238 && pixels[i + 1] === 238 && pixels[i + 2] === 0) counts[3]++;
    }
    return Math.min(...counts);
  })).toBeGreaterThan(100);

  await page.getByRole('button', { name: 'Chart settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Readout', exact: true }).click();
  const setting = page.locator('#oac-cset-statusLine-openInterest');
  await expect(setting).not.toBeChecked();
  await setting.check();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  const point = await page.evaluate(() => {
    const { widget, bars } = window.__oiDemo;
    const rect = widget.root.querySelector('.oac-chart')!.getBoundingClientRect();
    return { x: rect.left + widget.chart.timeToCoordinate(bars[16].time)!, y: rect.top + 110 };
  });
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.oac-statusline__oi b')).toHaveText('0');
  await expect(page.locator('.oac-statusline__oi')).toBeVisible();
  const studies = await page.evaluate(() => window.__oiDemo.widget.chart.indicators().map(study => ({
    id: study.indicatorId, values: study.values(),
  })));
  expect(studies.find(study => study.id === 'open-interest')!.values.oi[20]).toBeNull();
  expect(studies.find(study => study.id === 'open-interest-change')!.values.change.slice(20, 22)).toEqual([null, null]);
  const screenshot = info.outputPath('open-interest-studies.png');
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  await info.attach('OI studies and zero readout', { path: screenshot, contentType: 'image/png' });

  await page.evaluate(() => window.__oiDemo.widget.chart.setDataContext({ hasOpenInterest: false }));
  await expect(page.locator('.oac-statusline__oi')).toBeHidden();
  await page.getByRole('button', { name: 'Chart settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Readout', exact: true }).click();
  await expect(setting).toBeDisabled();
  await expect(setting).toBeChecked();
  const disabled = info.outputPath('open-interest-unavailable.png');
  await page.screenshot({ path: disabled, animations: 'disabled' });
  await info.attach('Unavailable OI keeps preference', { path: disabled, contentType: 'image/png' });
  await page.evaluate(() => window.__oiDemo.widget.chart.setDataContext({ hasOpenInterest: true }));
  await expect(setting).toBeEnabled();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.mouse.move(5, 5);
  await expect(page.locator('.oac-statusline__oi')).toBeHidden();
  expect(errors).toEqual([]);
});
