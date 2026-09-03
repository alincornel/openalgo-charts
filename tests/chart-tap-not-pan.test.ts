/**
 * A press on a button painted on the chart is a tap, not the start of a pan.
 * Every assertion here failed before the input change: a thumb that rolls four
 * pixels used to scroll the chart and lose the click entirely.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Chart } from '../src/core/chart';
import { fakeDocument, pointer, type FakeElement } from './helpers/fake-dom';
import type { Bar } from '../src/model/bar';

beforeAll(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window ??= {};
});

describe('a press on an on-chart button does not pan', () => {
  const W = 800;
  const H = 600;
  const bars = (n: number): Bar[] => Array.from({ length: n }, (_, i) => {
    const c = 100 + Math.sin(i / 4) * 5;
    return { time: 1700000000 + i * 60, open: c, high: c + 2, low: c - 2, close: c, volume: 10 };
  });

  function makeChart(): { chart: Chart; el: FakeElement } {
    const el = fakeDocument().createElement('div') as unknown as FakeElement;
    const chart = new Chart(el, {
      document: fakeDocument(),
      pixelRatio: () => 1,
      shortcuts: false,
      raf: { schedule: (cb: () => void) => { cb(); return 1; }, cancel: () => {} },
    });
    chart.applySize(W, H);
    chart.addSeries('candlestick').setData(bars(120));
    return { chart, el };
  }

  /** A position pill with buttons, and the x of a point inside the TP one. */
  function withPositionPill(): { chart: Chart; el: FakeElement; y: number } {
    const { chart, el } = makeChart();
    const price = chart.coordinateToPrice(200, 0) as number;
    chart.trading.setPositions([
      { id: 'p1', side: 'long', entryPrice: price, size: 1, pnlText: '+$25.00', tpButton: true, slButton: true, extentFromRight: 1 },
    ]);
    chart.applySize(W, H); // force a paint so the pill has geometry to hit-test
    return { chart, el, y: 200 };
  }

  it('fires the button and leaves the viewport alone', () => {
    const { chart, el, y } = withPositionPill();
    const onTp = vi.fn();
    chart.trading.on('trading:position_tp', onTp);
    const offsetBefore = chart.timeScale.rightOffset;

    const x = tpButtonX(chart, el);
    el.dispatch('pointerdown', pointer('down', x, y, { pointerType: 'touch' }));
    // A thumb rolls a few pixels while it is down. That is still a tap.
    el.dispatch('pointermove', pointer('move', x + 4, y + 3, { pointerType: 'touch' }));
    el.dispatch('pointerup', pointer('up', x + 4, y + 3, { pointerType: 'touch' }));

    expect(onTp).toHaveBeenCalledWith({ positionId: 'p1' });
    expect(chart.timeScale.rightOffset).toBe(offsetBefore);
  });

  it('abandons the press when the finger travels, and still does not pan', () => {
    const { chart, el, y } = withPositionPill();
    const onTp = vi.fn();
    chart.trading.on('trading:position_tp', onTp);
    const offsetBefore = chart.timeScale.rightOffset;
    const x = tpButtonX(chart, el);

    el.dispatch('pointerdown', pointer('down', x, y, { pointerType: 'touch' }));
    el.dispatch('pointermove', pointer('move', x + 90, y, { pointerType: 'touch' }));
    el.dispatch('pointerup', pointer('up', x + 90, y, { pointerType: 'touch' }));

    expect(onTp).not.toHaveBeenCalled();
    expect(chart.timeScale.rightOffset).toBe(offsetBefore);
  });

  it('still pans from a press on the plot beside the pill', () => {
    const { chart, el } = withPositionPill();
    const offsetBefore = chart.timeScale.rightOffset;
    el.dispatch('pointerdown', pointer('down', 500, 400, { pointerType: 'touch' }));
    el.dispatch('pointermove', pointer('move', 420, 400, { pointerType: 'touch' }));
    el.dispatch('pointerup', pointer('up', 420, 400, { pointerType: 'touch' }));
    expect(chart.timeScale.rightOffset).not.toBe(offsetBefore);
  });

  /**
   * Walk a mouse across the pill's height until the chart says it is hovering
   * the TP button, and report where. Going through the chart's own hover path
   * rather than the primitive's geometry is deliberate: it is the same routing
   * a real press takes.
   */
  function tpButtonX(chart: Chart, el: FakeElement): number {
    let hovered: string | null = null;
    const off = chart.on('hover', (payload) => { hovered = (payload as { id: string | null }).id; });
    try {
      for (let x = 0; x < 760; x += 2) {
        el.dispatch('pointermove', pointer('move', x, 200, { buttons: 0 }));
        if (hovered === 'pos:p1::tp') return x;
      }
    } finally {
      off();
    }
    throw new Error('no TP button found on the pill');
  }
});
