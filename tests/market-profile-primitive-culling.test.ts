/**
 * The Market Profile paints the sessions and rows on screen, in every mode.
 *
 * Only `compact` culled: `blocks+letters` and `blocks` walked every level of
 * every session on every frame — a block and a letter per TPO for twenty
 * sessions scrolled out of view — so a host drawing in those modes had to cap
 * how many sessions it asked for. A session wholly off the plot now draws
 * nothing, and a row stops at the plot's right edge instead of running on.
 */
import { describe, expect, it } from 'vitest';
import { MarketProfile, type MarketProfilePrimitiveOptions } from '../src/profile/market-profile-primitive';
import { computeMarketProfile } from '../src/profile/market-profile';
import { istStringToUtcSeconds } from '../src/feed/time';
import type { Bar } from '../src/model/bar';
import type { PrimitiveRenderContext } from '../src/primitives/primitive';

const DAY = 86_400;
const t0 = istStringToUtcSeconds('2024-01-15 09:15:00');

/** `days` sessions of two 30-minute periods each, every row 100..110 printed twice. */
function history(days: number): Bar[] {
  const bars: Bar[] = [];
  for (let d = 0; d < days; d++) {
    for (let p = 0; p < 2; p++) {
      bars.push({ time: t0 + d * DAY + p * 1800, open: 100, high: 110, low: 100, close: 110, volume: 100 });
    }
  }
  return bars;
}

function counter() {
  const calls = { fillRect: 0, fillText: 0 };
  const ctx = {
    canvas: {}, globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, rect() {}, clip() {},
    measureText: (t: string) => ({ width: t.length * 6 }),
    fillRect() { calls.fillRect++; },
    fillText() { calls.fillText++; },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

/**
 * Bars 400 px apart with the newest bar at x 140: only the last session (its
 * two bars) is on the plot, and every older one ends hundreds of pixels to the
 * left of it — beyond the reach of its right-hand labels too.
 */
function rcFor(bars: Bar[], priceToY: (p: number) => number = (p) => 40 + (110 - p) * 20): PrimitiveRenderContext {
  const index = new Map(bars.map((b, i) => [b.time, i]));
  const last = bars.length - 1;
  return {
    dpr: 1, plotWidth: 600, plotHeight: 300, priceAxisWidth: 60,
    timeScale: { indexToX: (i: number) => 140 - (last - i) * 400 },
    priceScale: { priceToY, format: (p: number) => p.toFixed(2) },
    dataLayer: { timeToIndex: (t: number) => index.get(t) },
    theme: {},
  } as unknown as PrimitiveRenderContext;
}

const MODES: MarketProfilePrimitiveOptions['blockDisplay'][] = ['blocks+letters', 'blocks', 'compact'];

describe('MarketProfile culling', () => {
  it.each(MODES)('draws twenty sessions for the price of the one on screen (%s)', (blockDisplay) => {
    const all = history(20);
    const newest = all.slice(-2);
    const options = { blockDisplay, showVolumeProfile: true, showTpoCounts: true };

    const many = counter();
    new MarketProfile(computeMarketProfile(all, { tickSize: 1, blockMinutes: 30 }), options).draw(many.ctx, rcFor(all));
    // The same newest session alone, at the same x.
    const one = counter();
    new MarketProfile(computeMarketProfile(newest, { tickSize: 1, blockMinutes: 30 }), options)
      .draw(one.ctx, rcFor(all));

    expect(one.calls.fillRect).toBeGreaterThan(0);
    expect(many.calls).toEqual(one.calls);
  });

  it.each(['blocks+letters', 'blocks'] as const)('stops a row at the right edge of the plot (%s)', (blockDisplay) => {
    // One wide session whose later periods run past the plot's right edge.
    const bars: Bar[] = Array.from({ length: 12 }, (_, p) => (
      { time: t0 + p * 1800, open: 100, high: 110, low: 100, close: 110, volume: 100 }));
    const result = computeMarketProfile(bars, { tickSize: 1, blockMinutes: 30 });
    const options = { blockDisplay, letterWidth: 100, split: true, fillValueArea: false, showValueArea: false,
      showPoc: false, showInitialBalance: false, showSinglePrints: false, showTails: false, showSessionLabel: false };
    const rc = rcFor(bars);
    Object.assign(rc, { timeScale: { indexToX: (i: number) => 10 + i * 100 } });

    const drawn = counter();
    new MarketProfile(result, options).draw(drawn.ctx, rc);
    // 600 px of plot holds six 100 px columns per row, not twelve.
    expect(drawn.calls.fillRect).toBeLessThanOrEqual(11 * 7);
    expect(drawn.calls.fillRect).toBeGreaterThan(0);
  });

  it('still records a hover box for a session it did not paint', () => {
    const all = history(3);
    const mp = new MarketProfile(computeMarketProfile(all, { tickSize: 1, blockMinutes: 30 }), { blockDisplay: 'blocks' });
    const { ctx } = counter();
    mp.draw(ctx, rcFor(all));
    // The oldest session is off the plot; its box is still where hit-testing
    // expects it, so a hover that reaches it is answered rather than dropped.
    expect(mp.hitTest(140 - 5 * 400 + 20, 100)?.externalId).toBe('mp:0');
  });
});
