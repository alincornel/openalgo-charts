/**
 * Pointer bookkeeping that outlived its gesture or reached past it.
 *
 * A finger on an on-chart button whose capture was taken away left the
 * button's tap id behind, which switches off the "a press that moved 3 px is
 * not a click" rule for the NEXT gesture. And a `pointercancel` for a pointer
 * the chart was not tracking cancelled the line drag another pointer held.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Chart } from '../src/core/chart';
import type { ChartOptions } from '../src/core/chart-types';
import { fakeDocument, pointer, type FakeElement } from './helpers/fake-dom';
import type { Bar } from '../src/model/bar';

beforeAll(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window ??= {};
});

const W = 800;
const H = 600;

function makeChart(options: ChartOptions = {}): { chart: Chart; el: FakeElement } {
  const el = fakeDocument().createElement('div') as unknown as FakeElement;
  const chart = new Chart(el, {
    document: fakeDocument(),
    pixelRatio: () => 1,
    shortcuts: false,
    raf: { schedule: (cb: () => void) => { cb(); return 1; }, cancel: () => {} },
    ...options,
  });
  chart.applySize(W, H);
  chart.addSeries('candlestick').setData(Array.from({ length: 120 }, (_, i): Bar => {
    const c = 100 + Math.sin(i / 4) * 5;
    return { time: 1700000000 + i * 60, open: c, high: c + 2, low: c - 2, close: c, volume: 10 };
  }));
  return { chart, el };
}

/** Walk a hovering mouse along y until the chart hovers `id`; its x. */
function xOf(chart: Chart, el: FakeElement, id: string, y: number): number {
  let hovered: string | null = null;
  const off = chart.on('hover', (payload) => { hovered = (payload as { id: string | null }).id; });
  try {
    for (let x = 0; x < 760; x += 2) {
      el.dispatch('pointermove', pointer('move', x, y, { buttons: 0 }));
      if (hovered === id) return x;
    }
  } finally {
    off();
  }
  throw new Error(`no ${id} at y ${y}`);
}

describe('a button press whose capture was taken', () => {
  it('leaves no tap behind: the next press that moves 6 px is not a click', () => {
    const { chart, el } = makeChart({ navigation: { panEnabled: false } });
    const price = chart.coordinateToPrice(200, 0) as number;
    chart.trading.setPositions([{ id: 'p1', side: 'long', entryPrice: price, size: 1, tpButton: true, extentFromRight: 1 }]);
    chart.applySize(W, H);
    const x = xOf(chart, el, 'pos:p1::tp', 200);
    const clicks = vi.fn();
    chart.on('click', clicks);

    el.dispatch('pointerdown', pointer('down', x, 200, { pointerType: 'touch', pointerId: 7 }));
    el.dispatch('lostpointercapture', pointer('up', x, 200, { pointerType: 'touch', pointerId: 7 }));
    el.dispatch('pointerup', pointer('up', x, 200, { pointerType: 'touch', pointerId: 7 }));
    clicks.mockClear();

    el.dispatch('pointerdown', pointer('down', 500, 400, { pointerType: 'touch', pointerId: 8 }));
    el.dispatch('pointermove', pointer('move', 506, 400, { pointerType: 'touch', pointerId: 8 }));
    el.dispatch('pointerup', pointer('up', 506, 400, { pointerType: 'touch', pointerId: 8 }));
    expect(clicks).not.toHaveBeenCalled();
  });
});

describe('a pointercancel for a pointer the chart is not tracking', () => {
  it('leaves the line drag another pointer holds alone, and announces no drag:cancel', () => {
    const { chart, el } = makeChart();
    const price = chart.coordinateToPrice(300, 0) as number;
    chart.trading.setOrders([{ id: 'o1', type: 'limit', side: 'buy', price, size: 1 }]);
    chart.applySize(W, H);
    const onModify = vi.fn();
    const onCancel = vi.fn();
    chart.trading.on('trading:order_modify', onModify);
    chart.on('drag:cancel', onCancel);

    el.dispatch('pointerdown', pointer('down', 400, 300));
    el.dispatch('pointermove', pointer('move', 400, 260));
    el.dispatch('pointercancel', pointer('up', 50, 50, { pointerId: 9, pointerType: 'touch' }));
    expect(onCancel).not.toHaveBeenCalled();
    el.dispatch('pointermove', pointer('move', 400, 240));
    el.dispatch('pointerup', pointer('up', 400, 240));

    expect(onModify).toHaveBeenCalledTimes(1);
    expect((onModify.mock.calls[0]![0] as { newPrice: number }).newPrice).toBeCloseTo(chart.coordinateToPrice(240, 0) as number, 8);
  });

  it('does not turn a still press on a line into a drag', () => {
    const { chart, el } = makeChart();
    const price = chart.coordinateToPrice(300, 0) as number;
    chart.trading.setOrders([{ id: 'o1', type: 'limit', side: 'buy', price, size: 1 }]);
    chart.applySize(W, H);
    const onClick = vi.fn();
    chart.trading.on('trading:order_click', onClick);

    el.dispatch('pointerdown', pointer('down', 400, 300));
    el.dispatch('pointercancel', pointer('up', 50, 50, { pointerId: 9, pointerType: 'touch' }));
    el.dispatch('pointerup', pointer('up', 400, 300));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
