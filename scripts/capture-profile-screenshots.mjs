/** Reproducible screenshots of the real synthetic-data profile demo. */
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const demoUrl = process.argv[2] ?? 'http://127.0.0.1:4173/examples/market-profile/index.html';
const output = fileURLToPath(new URL('../website/public/screenshots/market-profile/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const setSplit = async (split) => {
    if (await page.evaluate(() => window.__mp().isSessionSplit(5)) === split) return;
    await paint();
    const point = await page.evaluate(() => {
      const chart = window.__chart();
      const rect = document.getElementById('chart').getBoundingClientRect();
      const session = window.__profileResult().sessions[5];
      return { x: rect.left + chart.timeScale.indexToX(375) + 18,
        y: rect.top + chart.panes()[0].priceScale.priceToY(session.poc) };
    });
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await page.getByRole('menuitem', { name: split ? 'Split this day' : 'Unsplit this day', exact: true }).click();
    await page.mouse.move(700, 80);
  };
  for (const theme of ['dark', 'blue', 'graphite', 'emerald', 'ivory']) {
    const url = new URL(demoUrl);
    url.searchParams.set('theme', theme);
    await page.goto(url.href);
    await page.waitForFunction(() => typeof window.__mp === 'function');
    await page.locator('#compressed').click();
    await setSplit(true);
    await page.mouse.move(700, 80);
    await paint();
    await page.screenshot({ path: `${output}/${theme}.png` });
    console.log(`Captured ${theme}: 1600 x 1000, DPR 1, 5px rows, newest session split`);
  }
  await page.locator('#theme').selectOption('graphite');
  await page.locator('#comfortable').click();
  // Centre the latest session for the close views, without changing its rows.
  await page.evaluate(() => {
    const scale = window.__chart().panes()[0].priceScale;
    const s = window.__profileResult().sessions.at(-1);
    const span = scale.height * 2 / 12;
    const centre = (s.high + s.low) / 2;
    scale.setPriceRange({ min: centre - span / 2, max: centre + span / 2 });
  });
  for (const split of [false, true]) {
    await setSplit(split);
    await paint();
    const clip = await page.evaluate(() => {
      const chart = window.__chart();
      const rect = document.getElementById('chart').getBoundingClientRect();
      const x = Math.max(0, Math.floor(chart.timeScale.indexToX(375) - 30));
      return { x, y: Math.floor(rect.top), width: Math.floor(innerWidth - x), height: Math.floor(rect.height) };
    });
    await page.screenshot({ path: `${output}/${split ? 'split' : 'packed'}-detail.png`, clip });
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
