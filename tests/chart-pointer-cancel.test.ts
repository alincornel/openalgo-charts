/**
 * A cancelled pointer is not a release.
 *
 * The browser sends `pointercancel` when it takes a touch away from the page: a
 * system gesture, a notification pulled down, an incoming call, the palm check.
 * The finger did not choose to let go, so nothing the release would have done
 * may happen. `_onPointerCancel` used to hand the event straight to
 * `_onPointerUp`, and a finger resting still on a pill's button was therefore a
 * tap on that button — close the position, cancel the order — delivered by the
 * operating system rather than by the trader.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Chart } from '../src/core/chart';
import { fakeDocument, pointer, type FakeElement } from './helpers/fake-dom';
import type { Bar } from '../src/model/bar';
import { PriceLine } from '../src/primitives/price-line';

beforeAll(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window ??= {};
  vi.useFakeTimers();
});

const bars = (n = 120): Bar[] =>
  Array.from({ length: n }, (_, i) => ({
    time: 1735689600 + i * 300,
    open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10,
  }));

function makeChart(): { chart: Chart; el: FakeElement; clock: { t: number } } {
  const clock = { t: 1000 };
  const el = fakeDocument().createElement('div') as unknown as FakeElement;
  const chart = new Chart(el, {
    document: fakeDocument(), pixelRatio: () => 1, shortcuts: false,
    now: () => clock.t,
    // Each frame is 16 ms of the injected clock, so a fling started inside a
    // release can actually travel before the synchronous raf returns.
    raf: { schedule: (cb: () => void) => { clock.t += 16; cb(); return 1; }, cancel: () => {} },
  });
  chart.applySize(800, 600);
  chart.addSeries('candlestick').setData(bars());
  return { chart, el, clock };
}

const touch = (type: 'down' | 'move' | 'up', x: number, y: number, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  pointer(type, x, y, { pointerType: 'touch', ...extra });

describe('pointercancel', () => {
  it('is not a click on empty plot', () => {
    const { chart, el } = makeChart();
    const clicks: unknown[] = [];
    chart.on('click', (c) => clicks.push(c));

    el.dispatch('pointerdown', touch('down', 300, 250));
    el.dispatch('pointercancel', touch('up', 300, 250));

    expect(clicks).toEqual([]);
  });

  it('is not a press of the button under a still finger', () => {
    const { chart, el } = makeChart();
    chart.addPrimitive(new PriceLine({ price: 150, id: 'pos:p1::close', cursor: 'pointer', color: '#4f8cff' }), 0);
    const pressed: string[] = [];
    chart.subscribeClick((id) => pressed.push(id));
    const clicks: unknown[] = [];
    chart.on('click', (c) => clicks.push(c));
    const y = chart.priceToCoordinate(150) as number;

    el.dispatch('pointerdown', touch('down', 400, y));
    el.dispatch('pointercancel', touch('up', 400, y));
    expect(pressed).toEqual([]);
    expect(clicks).toEqual([]);

    // The same press released on purpose is still the tap it always was.
    el.dispatch('pointerdown', touch('down', 400, y, { pointerId: 2 }));
    el.dispatch('pointerup', touch('up', 400, y, { pointerId: 2 }));
    expect(pressed).toEqual(['pos:p1::close']);
  });

  it('cancels a line drag instead of committing it, moved or not', () => {
    const { chart, el } = makeChart();
    const onDrag = vi.fn();
    const onDragEnd = vi.fn();
    const onDragCancel = vi.fn();
    chart.subscribeDrag(onDrag, onDragEnd, onDragCancel);
    chart.addPrimitive(new PriceLine({ price: 150, id: 'ord:o1', cursor: 'ns-resize', color: '#4f8cff' }), 0);
    const pressed: string[] = [];
    chart.subscribeClick((id) => pressed.push(id));
    const ends: unknown[] = [];
    chart.on('drag:end', (d) => ends.push(d));
    const y = chart.priceToCoordinate(150) as number;

    // Still: the release would have been a click on the line.
    el.dispatch('pointerdown', touch('down', 400, y));
    el.dispatch('pointercancel', touch('up', 400, y));
    expect(pressed).toEqual([]);
    expect(onDragCancel).toHaveBeenCalledWith('ord:o1');

    // Moved: the release would have sent the order to the finger's price.
    el.dispatch('pointerdown', touch('down', 400, y, { pointerId: 2 }));
    el.dispatch('pointermove', touch('move', 400, y - 40, { pointerId: 2 }));
    expect(onDrag).toHaveBeenCalled();
    el.dispatch('pointercancel', touch('up', 400, y - 40, { pointerId: 2 }));
    expect(onDragEnd).not.toHaveBeenCalled();
    expect(ends).toEqual([]);
    expect(onDragCancel).toHaveBeenCalledTimes(2);
  });

  it('does not fling the chart the pan was moving', () => {
    const pan = (end: 'pointerup' | 'pointercancel'): { atLift: number; after: number } => {
      const { chart, el, clock } = makeChart();
      el.dispatch('pointerdown', touch('down', 600, 300));
      for (const x of [560, 520, 480, 440]) {
        clock.t += 16;
        el.dispatch('pointermove', touch('move', x, 300));
      }
      const atLift = chart.timeScale.rightOffset;
      clock.t += 16;
      el.dispatch(end, touch('up', 440, 300));
      // The injected raf runs a fling to completion inside the release.
      return { atLift, after: chart.timeScale.rightOffset };
    };
    // The control proves this pan is fast enough to fling when released.
    const released = pan('pointerup');
    expect(released.after).not.toBe(released.atLift);
    const cancelled = pan('pointercancel');
    expect(cancelled.after).toBe(cancelled.atLift);
  });

  it('places nothing while a drawing tool is armed', () => {
    const { chart, el } = makeChart();
    chart.setPlacementMode(true);
    const clicks: unknown[] = [];
    chart.on('click', (c) => clicks.push(c));

    el.dispatch('pointerdown', touch('down', 300, 250));
    el.dispatch('pointermove', touch('move', 380, 200));
    el.dispatch('pointercancel', touch('up', 380, 200));

    expect(clicks).toEqual([]);
  });

  it('does not put away a crosshair a still finger had adopted', () => {
    const { chart, el } = makeChart();
    const moves: Array<{ price: number | null }> = [];
    chart.on('crosshair:move', (p) => { moves.push(p as { price: number | null }); });
    el.dispatch('pointerdown', touch('down', 300, 250));
    vi.advanceTimersByTime(500); // long press summons it
    el.dispatch('pointerup', touch('up', 300, 250)); // and it stays

    el.dispatch('pointerdown', touch('down', 320, 260, { pointerId: 2 })); // adopted
    el.dispatch('pointercancel', touch('up', 320, 260, { pointerId: 2 }));

    // A still release of an adopted finger is the tap that dismisses it; a
    // cancel is not that tap.
    expect(typeof moves[moves.length - 1]?.price).toBe('number');
  });
});
