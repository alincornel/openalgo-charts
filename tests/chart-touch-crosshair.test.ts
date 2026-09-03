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

function makeChart(): { chart: Chart; el: FakeElement; moves: Array<{ price: number | null }> } {
  const el = fakeDocument().createElement('div') as unknown as FakeElement;
  const chart = new Chart(el, {
    document: fakeDocument(),
    pixelRatio: () => 1,
    shortcuts: false,
    raf: { schedule: (cb: () => void) => { cb(); return 1; }, cancel: () => {} },
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
    // this test exists to reject, so the price has to BE a price.
    expect(typeof last(moves)?.price).toBe('number');
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
    expect(typeof last(moves)?.price).toBe('number');
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

  it('hideCrosshair puts it away and says so', () => {
    const { chart, el, moves } = makeChart();
    el.dispatch('pointerdown', touch('down', 300, 250));
    vi.advanceTimersByTime(500);
    el.dispatch('pointerup', touch('up', 300, 250));

    chart.hideCrosshair();
    expect(last(moves)?.price).toBeNull();
  });
});
