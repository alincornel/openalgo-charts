/**
 * The option has to survive the whole way to a primitive.
 *
 * `touchTargets` was set on the chart, honoured by `PriceLine`, and covered by
 * a passing test — and changed nothing on a phone, because the pane builds the
 * primitive's render context field by field and simply did not copy it. Every
 * unit test in the chain was green while the chain was broken, since each one
 * fabricated its own context and skipped the join. This one goes through the
 * chart, which is the only way that gap shows up.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Chart } from '../src/core/chart';
import { fakeDocument, type FakeElement } from './helpers/fake-dom';
import type { IPrimitive, PrimitiveRenderContext } from '../src/primitives/primitive';
import type { Bar } from '../src/model/bar';
import { InvalidationLevel } from '../src/core/invalidate-mask';

beforeAll(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window ??= {};
});

const bars: Bar[] = Array.from({ length: 30 }, (_, i) => ({
  time: 1700000000 + i * 60, open: 100, high: 101, low: 99, close: 100, volume: 10,
}));

/** A primitive whose only job is to report what context it was handed. */
function spy(): { primitive: IPrimitive; seen: (boolean | number | undefined)[] } {
  const seen: (boolean | number | undefined)[] = [];
  return {
    seen,
    primitive: {
      draw(_ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext): void { seen.push(rc.touchTargets); },
      zOrder: () => 'top',
    } as unknown as IPrimitive,
  };
}

function chartWith(touchTargets: boolean | number | undefined): (boolean | number | undefined)[] {
  const el = fakeDocument().createElement('div') as unknown as FakeElement;
  const chart = new Chart(el, {
    document: fakeDocument(),
    pixelRatio: () => 1,
    // A synchronous raf, so a full invalidation paints inline and the spy has
    // been called by the time we look at it.
    raf: { schedule: (cb: () => void) => { cb(); return 1; }, cancel: () => {} },
    shortcuts: false,
    timeNavigator: false,
    ...(touchTargets === undefined ? {} : { touchTargets }),
  } as never);
  const series = chart.addSeries('candlestick', {});
  series.setData(bars);
  const s = spy();
  // `addPrimitive(primitive, paneIndex)` — the pane comes second.
  chart.addPrimitive(s.primitive, 0);
  // A full invalidation paints inline under the synchronous raf these tests
  // install, so the primitive has drawn by the time this returns.
  chart.invalidate((m) => m.invalidateGlobal(InvalidationLevel.Full));
  chart.destroy();
  return s.seen;
}

describe('touchTargets reaches the primitives', () => {
  it('arrives as the number the host set', () => {
    const seen = chartWith(2.4);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((v) => v === 2.4)).toBe(true);
  });

  it('arrives as the boolean the host set', () => {
    expect(chartWith(true).every((v) => v === true)).toBe(true);
  });

  it('is falsy when the host said nothing, rather than undefined-by-accident', () => {
    expect(chartWith(undefined).every((v) => v !== true && v !== 2.4)).toBe(true);
  });
});
