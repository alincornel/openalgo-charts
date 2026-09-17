/**
 * An indicator fill paints the bars on screen, not the whole history.
 *
 * `draw` used to walk every point the band held on every frame — building a
 * polygon, and under a gradient a gradient object, for each run whether it was
 * on screen or years off to the left. The cost therefore grew with the history
 * a chart had paged in rather than with what it showed: an RSI on 20 000 daily
 * bars with 300 of them in view cost more than the candles did, and a few of
 * them made a zoomed-out daily chart stutter on a slower machine.
 */
import { describe, expect, it } from 'vitest';
import { IndicatorFill, type FillPoint } from '../src/primitives/indicator-fill';
import type { PrimitiveRenderContext } from '../src/primitives/primitive';
import { makeCtx, type RecordingContext } from './helpers/fake-ctx';

const WIDTH = 600;

/** A time scale showing logical indices [from, from + WIDTH / spacing]. */
function rcFor(from: number, spacing: number): PrimitiveRenderContext {
  return {
    dpr: 1,
    plotWidth: WIDTH,
    timeScale: {
      indexToX: (i: number) => (i - from) * spacing,
      visibleRange: () => ({ from, to: from + WIDTH / spacing }),
    },
    priceScale: { priceToY: (v: number) => 100 - v },
  } as unknown as PrimitiveRenderContext;
}

/**
 * An oscillating pair, so the band crosses and splits into many runs. The
 * phase is anchored to the newest bar, so the latest bars are the same band
 * however much history sits behind them.
 */
function band(n: number): FillPoint[] {
  return Array.from({ length: n }, (_, i) => ({ index: i, a: 50 + 20 * Math.sin((n - i) / 7), b: 50 }));
}

const vertices = (rec: RecordingContext): number[][] =>
  rec.ops.filter((op) => op.type === 'moveTo' || op.type === 'lineTo').map((op) => op.args);

describe('IndicatorFill on a long history', () => {
  it('builds vertices for the bars in view, however long the history is', () => {
    const counts = [2_000, 20_000].map((n) => {
      const fill = new IndicatorFill({ colorUp: '#0f0', colorDown: '#f00' });
      fill.setPoints(band(n));
      const { ctx, rec } = makeCtx();
      fill.draw(ctx, rcFor(n - 300, 2)); // the newest 300 bars
      return vertices(rec).length;
    });
    // Two vertices per visible bar, plus a crossing pair per flip: bounded by
    // the window, and the same for a ten times longer history.
    expect(counts[0]).toBeLessThan(1_000);
    expect(counts[1]).toBe(counts[0]);
  });

  it('still reaches both edges of the plot', () => {
    const fill = new IndicatorFill({ colorUp: '#0f0', colorDown: '#f00' });
    fill.setPoints(band(5_000));
    const { ctx, rec } = makeCtx();
    fill.draw(ctx, rcFor(2_000.5, 2));
    const xs = vertices(rec).map(([x]) => x);
    expect(Math.min(...xs)).toBeLessThanOrEqual(0);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(WIDTH);
  });

  it('paints the visible part exactly as the full walk did', () => {
    const points = band(400).map((p, i) => ({
      ...p,
      // A gap and a per-bar colour change inside the window, so the run
      // boundaries the window must reproduce are all there.
      a: i === 150 ? null : p.a,
      color: i >= 170 && i < 190 ? '#00f' : undefined,
    }));
    const fills = (rec: RecordingContext): number => rec.ops.filter((op) => op.type === 'fill').length;

    const windowed = new IndicatorFill({ colorUp: '#0f0', colorDown: '#f00' });
    windowed.setPoints(points);
    const w = makeCtx();
    windowed.draw(w.ctx, rcFor(100, 6)); // indices 100..200

    // The reference: the same band cut to the window by hand, drawn with
    // nothing off screen for the old full walk to spend time on.
    const reference = new IndicatorFill({ colorUp: '#0f0', colorDown: '#f00' });
    reference.setPoints(points.slice(99, 202));
    const r = makeCtx();
    reference.draw(r.ctx, rcFor(100, 6));

    expect(vertices(w.rec)).toEqual(vertices(r.rec));
    expect(fills(w.rec)).toBe(fills(r.rec));
  });

  it('grades a gradient band against its whole range, not the visible slice', () => {
    const points = band(1_000).map((p, i) => ({ ...p, a: i === 10 ? 95 : p.a }));
    const fill = new IndicatorFill({
      colorUp: '#0f0',
      colorDown: '#f00',
      gradient: { topColor: '#aaa', bottomColor: '#bbb' },
    });
    fill.setPoints(points);
    const { ctx, rec } = makeCtx();
    fill.draw(ctx, rcFor(700, 2)); // index 10, the band's top, is off screen
    const translate = rec.ops.find((op) => op.type === 'translate');
    expect(translate?.args).toEqual([0, 100 - 95]);
  });
});
