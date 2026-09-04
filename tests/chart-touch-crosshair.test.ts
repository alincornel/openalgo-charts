/**
 * The long press on a touch device summons the crosshair and keeps it.
 *
 * Before this there was no crosshair on a phone at all, and the reason was
 * mechanical rather than missing: every touch move was spent panning, so the
 * one gesture that could have moved a crosshair never reached it.
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

const W = 800;
const H = 600;

const bars = (n: number): Bar[] => Array.from({ length: n }, (_, i) => {
  const c = 100 + Math.sin(i / 4) * 5;
  return { time: 1700000000 + i * 60, open: c, high: c + 2, low: c - 2, close: c, volume: 10 };
});

function makeChart(painted = true): { chart: Chart; el: FakeElement; moves: Array<{ price: number | null }> } {
  const el = fakeDocument().createElement('div') as unknown as FakeElement;
  const chart = new Chart(el, {
    document: fakeDocument(),
    pixelRatio: () => 1,
    shortcuts: false,
    raf: painted ? { schedule: (cb: () => void) => { cb(); return 1; }, cancel: () => {} } : { schedule: () => 0 },
  });
  chart.applySize(W, H);
  chart.addSeries('candlestick').setData(bars(120));
  const moves: Array<{ price: number | null }> = [];
  chart.on('crosshair:move', (payload) => { moves.push(payload as { price: number | null }); });
  return { chart, el, moves };
}

const touch = (type: 'down' | 'move' | 'up', x: number, y: number): Record<string, unknown> =>
  pointer(type, x, y, { pointerType: 'touch' });

/** The most recent crosshair payload, or undefined when none was emitted. */
const last = (moves: Array<{ price: number | null }>): { price: number | null } | undefined =>
  moves[moves.length - 1];

describe('long press summons the crosshair', () => {
  it('shows it where the finger rested, and pans nothing', () => {
    const { chart, el, moves } = makeChart();
    const offsetBefore = chart.timeScale.rightOffset;

    el.dispatch('pointerdown', touch('down', 300, 250));
    vi.advanceTimersByTime(500);

    // `not.toBeNull()` would pass on an empty list, which is exactly the state
    // this test exists to reject, so the price has to BE a price, and one that
    // could have come from this data: the bars run 93 to 107, and a pane that
    // was never measured answers off a 0..1 placeholder scale instead.
    const price = last(moves)?.price as number;
    expect(typeof price).toBe('number');
    expect(price).toBeGreaterThan(90);
    expect(price).toBeLessThan(110);
    expect(chart.timeScale.rightOffset).toBe(offsetBefore);
  });

  it('follows the finger afterwards instead of scrolling the chart', () => {
    const { chart, el, moves } = makeChart();
    const offsetBefore = chart.timeScale.rightOffset;

    el.dispatch('pointerdown', touch('down', 300, 250));
    vi.advanceTimersByTime(500);
    const firstPrice = last(moves)?.price;
    el.dispatch('pointermove', touch('move', 420, 180));

    expect(last(moves)?.price).not.toBe(firstPrice);
    // The move that used to be spent panning now moves the crosshair.
    expect(chart.timeScale.rightOffset).toBe(offsetBefore);
  });

  it('outlives the finger, so what it reveals can still be tapped', () => {
    const { el, moves } = makeChart();
    el.dispatch('pointerdown', touch('down', 300, 250));
    vi.advanceTimersByTime(500);
    el.dispatch('pointerup', touch('up', 300, 250));
    // A real touch release fires `pointerleave` as well, and that is what this
    // test missed: it passed here while a phone cleared the crosshair the
    // instant the finger came off, leaving nothing to tap. Dispatch both, in
    // the order a browser does, or the test is not testing the gesture.
    el.dispatch('pointerleave', touch('up', 300, 250));
    const price = last(moves)?.price as number;
    expect(price).toBeGreaterThan(90);
    expect(price).toBeLessThan(110);
  });

  it('is dismissed by the next plain tap on the plot', () => {
    const { el, moves } = makeChart();
    el.dispatch('pointerdown', touch('down', 300, 250));
    vi.advanceTimersByTime(500);
    el.dispatch('pointerup', touch('up', 300, 250));

    el.dispatch('pointerdown', touch('down', 500, 300));
    el.dispatch('pointerup', touch('up', 500, 300));
    expect(last(moves)?.price).toBeNull();
  });

  it('a finger that moves is panning, and gets no crosshair', () => {
    const { chart, el, moves } = makeChart();
    const offsetBefore = chart.timeScale.rightOffset;

    el.dispatch('pointerdown', touch('down', 300, 250));
    el.dispatch('pointermove', touch('move', 240, 250));
    vi.advanceTimersByTime(500);
    el.dispatch('pointerup', touch('up', 240, 250));

    expect(moves.filter((m) => m.price !== null)).toHaveLength(0);
    expect(chart.timeScale.rightOffset).not.toBe(offsetBefore);
  });

  it('a second finger is a pinch, not a long press', () => {
    const { el, moves } = makeChart();
    el.dispatch('pointerdown', touch('down', 300, 250));
    el.dispatch('pointerdown', pointer('down', 400, 250, { pointerType: 'touch', pointerId: 2 }));
    vi.advanceTimersByTime(500);
    expect(moves.filter((m) => m.price !== null)).toHaveLength(0);
  });

  it('a mouse press is never a long press, it is a drag', () => {
    const { el, moves } = makeChart();
    el.dispatch('pointerdown', pointer('down', 300, 250));
    vi.advanceTimersByTime(500);
    // A mouse already has hover, and its crosshair follows the pointer without
    // being asked. Only the moves it makes should appear here, and it made none.
    expect(moves.filter((m) => m.price !== null)).toHaveLength(0);
  });

  it('reads a real price on a chart no frame has painted yet', () => {
    // The pane's readout scale sits on its 0..1 placeholder until something
    // measures it, so a long press between `setData` and the first frame used
    // to report a crosshair price of about 0.5. Every other path that turns a
    // y into a price scales the pane first; this one has to as well.
    const { el, moves } = makeChart(false);
    el.dispatch('pointerdown', touch('down', 300, 250));
    vi.advanceTimersByTime(500);
    const price = last(moves)?.price as number;
    expect(price).toBeGreaterThan(90);
    expect(price).toBeLessThan(110);
  });

  it('survives a tap on something, because that tap may need its price', () => {
    // The failure this pins: a host button that appears at the crosshair reads
    // the crosshair's price when tapped, and the chart used to clear the
    // crosshair one line before delivering that click, so the button always
    // read null and did nothing.
    const { chart, el, moves } = makeChart();
    const price = chart.coordinateToPrice(200, 0) as number;
    chart.trading.setPositions([
      { id: 'p1', side: 'long', entryPrice: price, size: 1, tpButton: true, extentFromRight: 1 },
    ]);
    chart.applySize(W, H);
    const onTp = vi.fn(() => {
      // Read at delivery time, which is when a host reads it.
      expect(last(moves)?.price).not.toBeNull();
    });
    chart.trading.on('trading:position_tp', onTp);

    el.dispatch('pointerdown', touch('down', 300, 250));
    vi.advanceTimersByTime(500);
    el.dispatch('pointerup', touch('up', 300, 250));

    let x = -1;
    let hovered: string | null = null;
    const off = chart.on('hover', (payload) => { hovered = (payload as { id: string | null }).id; });
    for (let candidate = 0; candidate < 700; candidate += 2) {
      el.dispatch('pointermove', pointer('move', candidate, 200, { buttons: 0 }));
      if (hovered === 'pos:p1::tp') { x = candidate; break; }
    }
    off();
    expect(x).toBeGreaterThan(-1);

    el.dispatch('pointerdown', touch('down', x, 200));
    el.dispatch('pointerup', touch('up', x, 200));
    expect(onTp).toHaveBeenCalledTimes(1);
  });

  it('hideCrosshair puts it away and says so', () => {
    const { chart, el, moves } = makeChart();
    el.dispatch('pointerdown', touch('down', 300, 250));
    vi.advanceTimersByTime(500);
    el.dispatch('pointerup', touch('up', 300, 250));

    chart.hideCrosshair();
    expect(last(moves)?.price).toBeNull();
  });

  it('is grabbed by the next finger, so it can be aimed without a second long press', () => {
    const { el, moves } = makeChart();
    el.dispatch('pointerdown', touch('down', 300, 250));
    vi.advanceTimersByTime(500);
    el.dispatch('pointerup', touch('up', 300, 250));
    el.dispatch('pointerleave', touch('up', 300, 250));
    const first = last(moves)?.price as number;

    // A fresh finger, no long press: it steers immediately. Before this the
    // crosshair sat where the summoning gesture left it and the only handle on
    // it was the `+` itself — a crosshair you cannot aim.
    el.dispatch('pointerdown', touch('down', 300, 350));
    el.dispatch('pointermove', touch('move', 300, 400));
    el.dispatch('pointerup', touch('up', 300, 400));
    const second = last(moves)?.price as number;
    expect(second).not.toBe(first);
    expect(second).toBeLessThan(first); // lower on the pane is a lower price
  });

  it('a tap that does not move still puts it away', () => {
    const { el, moves } = makeChart();
    el.dispatch('pointerdown', touch('down', 300, 250));
    vi.advanceTimersByTime(500);
    el.dispatch('pointerup', touch('up', 300, 250));
    el.dispatch('pointerleave', touch('up', 300, 250));
    expect(last(moves)?.price).not.toBeNull();

    // Adopted and released without moving: that is the dismiss gesture, and it
    // has to survive the grab-to-steer change above or the crosshair becomes
    // impossible to get rid of.
    el.dispatch('pointerdown', touch('down', 420, 300));
    el.dispatch('pointerup', touch('up', 420, 300));
    expect(last(moves)?.price).toBeNull();
  });
});
