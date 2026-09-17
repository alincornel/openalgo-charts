/**
 * A pinch over a touch crosshair ends when its last finger lifts, whichever
 * finger that is.
 *
 * Upstream 2.3.x keeps a pinch alive until EVERY finger is off the glass, so
 * its remaining finger cannot place a drawing on release. The fork's crosshair
 * finger takes its release in its own branch, which returns before the pinch
 * branch: when that finger lifted last, the pinch was never cleared, and the
 * next one-finger gesture was spent on a pinch that no longer existed — the
 * crosshair would not follow and a tap on a pill was swallowed.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Chart } from '../src/core/chart';
import { fakeDocument, pointer, type FakeElement } from './helpers/fake-dom';
import type { Bar } from '../src/model/bar';

beforeAll(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window ??= {};
  vi.useFakeTimers();
});

const bars = (n: number): Bar[] => Array.from({ length: n }, (_, i) => {
  const c = 100 + Math.sin(i / 4) * 5;
  return { time: 1700000000 + i * 60, open: c, high: c + 2, low: c - 2, close: c, volume: 10 };
});

function makeChart(): { chart: Chart; el: FakeElement; moves: Array<{ price: number | null }> } {
  const el = fakeDocument().createElement('div') as unknown as FakeElement;
  const chart = new Chart(el, {
    document: fakeDocument(),
    pixelRatio: () => 1,
    shortcuts: false,
    raf: { schedule: (cb: () => void) => { cb(); return 1; }, cancel: () => {} },
  });
  chart.applySize(800, 600);
  chart.addSeries('candlestick').setData(bars(120));
  const moves: Array<{ price: number | null }> = [];
  chart.on('crosshair:move', (payload) => { moves.push(payload as { price: number | null }); });
  return { chart, el, moves };
}

const touch = (type: 'down' | 'move' | 'up', x: number, y: number, pointerId: number): Record<string, unknown> =>
  pointer(type, x, y, { pointerType: 'touch', pointerId });

/**
 * The next finger after the pinch has to reach the chart. The crosshair is
 * still up, so that finger adopts it and steers it (a stuck pinch swallowed
 * every move instead); once a plain tap puts it away, a finger pans again.
 */
function expectNextFingersWork(chart: Chart, el: FakeElement, moves: Array<{ price: number | null }>, pointerId: number): void {
  el.dispatch('pointerdown', touch('down', 500, 300, pointerId));
  const adopted = moves[moves.length - 1]?.price;
  el.dispatch('pointermove', touch('move', 500, 150, pointerId));
  expect(moves[moves.length - 1]?.price).not.toBe(adopted);
  el.dispatch('pointerup', touch('up', 500, 150, pointerId));

  el.dispatch('pointerdown', touch('down', 500, 300, pointerId + 1));
  el.dispatch('pointerup', touch('up', 500, 300, pointerId + 1)); // plain tap: dismiss

  const before = chart.timeScale.rightOffset;
  el.dispatch('pointerdown', touch('down', 500, 300, pointerId + 2));
  el.dispatch('pointermove', touch('move', 400, 300, pointerId + 2));
  el.dispatch('pointermove', touch('move', 300, 300, pointerId + 2));
  expect(chart.timeScale.rightOffset).not.toBe(before);
}

describe('a pinch over the touch crosshair', () => {
  it('ends when the finger that summoned the crosshair lifts last', () => {
    const { chart, el, moves } = makeChart();
    el.dispatch('pointerdown', touch('down', 300, 250, 1));
    vi.advanceTimersByTime(500); // long press: finger 1 owns the crosshair
    el.dispatch('pointerdown', touch('down', 400, 250, 2));
    el.dispatch('pointermove', touch('move', 450, 250, 2));
    el.dispatch('pointerup', touch('up', 450, 250, 2));
    el.dispatch('pointerup', touch('up', 300, 250, 1));

    expectNextFingersWork(chart, el, moves, 3);
  });

  it('ends when the finger that adopted the crosshair lifts last', () => {
    const { chart, el, moves } = makeChart();
    el.dispatch('pointerdown', touch('down', 300, 250, 1));
    vi.advanceTimersByTime(500);
    el.dispatch('pointerup', touch('up', 300, 250, 1)); // the crosshair stays
    el.dispatch('pointerdown', touch('down', 320, 260, 2)); // adopts it
    el.dispatch('pointerdown', touch('down', 420, 260, 3)); // pinch
    el.dispatch('pointermove', touch('move', 470, 260, 3));
    el.dispatch('pointerup', touch('up', 470, 260, 3));
    el.dispatch('pointerup', touch('up', 320, 260, 2));

    expectNextFingersWork(chart, el, moves, 4);
  });

  it('leaves the crosshair on screen', () => {
    const { el, moves } = makeChart();
    el.dispatch('pointerdown', touch('down', 300, 250, 1));
    vi.advanceTimersByTime(500);
    el.dispatch('pointerdown', touch('down', 400, 250, 2));
    el.dispatch('pointerup', touch('up', 400, 250, 2));
    el.dispatch('pointerup', touch('up', 300, 250, 1));

    // A pinch takes the gesture, not the crosshair: nothing emitted a clear.
    expect(typeof moves[moves.length - 1]?.price).toBe('number');
  });
});
