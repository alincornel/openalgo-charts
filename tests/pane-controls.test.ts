import { describe, it, expect, beforeAll } from 'vitest';
import '../src/indicators/index';
import { Chart } from '../src/core/chart';
import { PaneLegend } from '../src/primitives/pane-legend';
import { fakeDocument, pointer, type FakeElement } from './helpers/fake-dom';
import type { Bar } from '../src/model/bar';

const bars = (n: number): Bar[] =>
  Array.from({ length: n }, (_, i) => {
    const c = 100 + Math.sin(i / 4) * 5;
    return { time: 1700000000 + i * 60, open: c, high: c + 1, low: c - 1, close: c, volume: 10 + i };
  });

const W = 800;
const H = 600;

// The chart only wires pointer listeners when a `window` exists (`_attachInput`),
// so under the node environment these tests would otherwise assert against
// handlers that were never attached — and pass for the wrong reason.
beforeAll(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window ??= {};
});

function makeChart(): { chart: Chart; el: FakeElement } {
  const el = fakeDocument().createElement('div') as unknown as FakeElement;
  const chart = new Chart(el, {
    document: fakeDocument(),
    raf: { schedule: () => 0 },
    pixelRatio: () => 1,
    shortcuts: false,
  });
  chart.applySize(W, H);
  return { chart, el };
}

/** Cumulative pane tops, mirroring the chart's own weighted layout. */
function paneTops(chart: Chart): number[] {
  const total = chart.panes().reduce((s, p) => s + p.weight, 0);
  let top = 0;
  return chart.panes().map((p) => {
    const t = top;
    top += (H * p.weight) / total;
    return t;
  });
}

describe('pane weights', () => {
  it('setPaneWeight resizes and sizes the DOM box to the same pixels', () => {
    const { chart } = makeChart();
    chart.addSeries('candlestick').setData(bars(50));
    chart.addSeries('histogram', { paneIndex: 1 }).setData(bars(50));
    chart.setPaneWeight(1, 0.8);
    expect(chart.paneWeight(1)).toBe(0.8);
    // The DOM flex-basis must equal the pixel height the canvas was sized to —
    // when they diverge, every hit-test lands somewhere other than what's drawn.
    const total = 1 + 0.8;
    const expected = (H * 0.8) / total;
    expect(chart.panes()[1].element.style.flex).toBe(`0 0 ${expected}px`);
  });

  it('clamps a non-positive weight instead of collapsing the layout', () => {
    const { chart } = makeChart();
    chart.addSeries('candlestick').setData(bars(10));
    chart.setPaneWeight(0, 0);
    expect(chart.paneWeight(0)).toBeGreaterThan(0);
  });
});

describe('pane divider drag', () => {
  function threePane(): { chart: Chart; el: FakeElement } {
    const made = makeChart();
    made.chart.addSeries('candlestick').setData(bars(60));
    made.chart.addSeries('histogram', { paneIndex: 1 }).setData(bars(60));
    made.chart.addSeries('line', { paneIndex: 2 }).setData(bars(60));
    return made;
  }

  it('dragging the boundary moves height between the two adjacent panes', () => {
    const { chart, el } = threePane();
    const tops = paneTops(chart);
    const boundary = tops[2]; // between pane 1 and pane 2
    const before = chart.panes().map((p) => p.weight);

    el.dispatch('pointerdown', pointer('down', 400, boundary));
    el.dispatch('pointermove', pointer('move', 400, boundary - 40));
    el.dispatch('pointerup', pointer('up', 400, boundary - 40));

    const after = chart.panes().map((p) => p.weight);
    expect(after[1]).toBeLessThan(before[1]);   // pane above shrank
    expect(after[2]).toBeGreaterThan(before[2]); // pane below grew
    // Panes not adjacent to the boundary are untouched.
    expect(after[0]).toBe(before[0]);
    // ...and the pair's combined weight is conserved.
    expect(after[1] + after[2]).toBeCloseTo(before[1] + before[2], 9);
  });

  it('grabs the divider anywhere within the tolerance band', () => {
    for (const offset of [-3, 0, 3]) {
      const { chart, el } = threePane();
      const boundary = paneTops(chart)[2];
      const before = chart.paneWeight(1);
      el.dispatch('pointerdown', pointer('down', 400, boundary + offset));
      el.dispatch('pointermove', pointer('move', 400, boundary + offset - 30));
      el.dispatch('pointerup', pointer('up', 400, boundary + offset - 30));
      expect(chart.paneWeight(1), `offset ${offset}`).toBeLessThan(before);
    }
  });

  it('ignores a press well away from any boundary (that still pans)', () => {
    const { chart, el } = threePane();
    const before = chart.panes().map((p) => p.weight);
    const mid = paneTops(chart)[1] + 40;
    el.dispatch('pointerdown', pointer('down', 400, mid));
    el.dispatch('pointermove', pointer('move', 400, mid - 40));
    el.dispatch('pointerup', pointer('up', 400, mid - 40));
    expect(chart.panes().map((p) => p.weight)).toEqual(before);
  });

  it('never collapses a pane to zero, however far the drag goes', () => {
    const { chart, el } = threePane();
    const boundary = paneTops(chart)[2];
    el.dispatch('pointerdown', pointer('down', 400, boundary));
    el.dispatch('pointermove', pointer('move', 400, boundary - 5000));
    el.dispatch('pointerup', pointer('up', 400, boundary - 5000));
    for (const p of chart.panes()) expect(p.weight).toBeGreaterThan(0);
  });
});

describe('pane legend rows', () => {
  it('stacks host-added and indicator legends in one sequence', () => {
    const { chart } = makeChart();
    chart.addSeries('candlestick').setData(bars(60));
    // A host row (symbol / OHLC) added first must keep row 0, with the
    // indicator's own legend flowing beneath it rather than overlapping.
    const symbol = new PaneLegend({ id: 'symbol', title: 'AAPL', actions: [] });
    chart.addPrimitive(symbol, 0);
    chart.addIndicator('ema'); // onchart → same pane
    expect(symbol.options().row).toBe(0);
    const ema = chart.indicators()[0].legend();
    expect(ema?.options().row).toBe(1);
  });

  it('starts indicator legends below a host overlay when legendOffset says so', () => {
    // A host that draws its own OHLC readout in the corner needs the canvas
    // rows pushed clear of it — otherwise they land underneath, and their
    // settings / close buttons are invisible and unclickable.
    const el = fakeDocument().createElement('div') as unknown as FakeElement;
    const chart = new Chart(el, {
      document: fakeDocument(), raf: { schedule: () => 0 },
      pixelRatio: () => 1, shortcuts: false,
      legendOffset: { top: 40, left: 14 },
    });
    chart.applySize(800, 600);
    chart.addSeries('candlestick').setData(bars(60));
    chart.addIndicator('ema');

    const opts = chart.indicators()[0].legend()?.options();
    expect(opts?.top).toBe(40);
    expect(opts?.left).toBe(14);
    expect(opts?.row).toBe(0); // still the first row, just lower down
  });

  it('offsets only the overlaid pane, leaving lower panes at the corner', () => {
    // A lower indicator pane is short. Applying a price-pane offset there would
    // push its legend — and so its settings and close buttons — off the pane.
    const el = fakeDocument().createElement('div') as unknown as FakeElement;
    const chart = new Chart(el, {
      document: fakeDocument(), raf: { schedule: () => 0 },
      pixelRatio: () => 1, shortcuts: false,
      legendOffset: { top: 80 },
    });
    chart.applySize(800, 600);
    chart.addSeries('candlestick').setData(bars(60));
    chart.addIndicator('ema');   // onchart -> pane 0, shifted
    chart.addIndicator('rsi');   // own pane -> default corner

    const [onchart, lower] = chart.indicators();
    expect(onchart.legend()?.options().top).toBe(80);
    expect(lower.paneIndex).toBeGreaterThan(0);
    expect(lower.legend()?.options().top).toBe(6);
  });

  it('honours an explicit paneIndex for the offset', () => {
    const el = fakeDocument().createElement('div') as unknown as FakeElement;
    const chart = new Chart(el, {
      document: fakeDocument(), raf: { schedule: () => 0 },
      pixelRatio: () => 1, shortcuts: false,
      legendOffset: { top: 40, paneIndex: 1 },
    });
    chart.applySize(800, 600);
    chart.addSeries('candlestick').setData(bars(60));
    chart.addIndicator('ema');   // pane 0 -> untouched now
    chart.addIndicator('rsi');   // pane 1 -> shifted
    const [onchart, lower] = chart.indicators();
    expect(onchart.legend()?.options().top).toBe(6);
    expect(lower.legend()?.options().top).toBe(40);
  });

  it('leaves legends at the default corner with no offset given', () => {
    const { chart } = makeChart();
    chart.addSeries('candlestick').setData(bars(60));
    chart.addIndicator('ema');
    const opts = chart.indicators()[0].legend()?.options();
    expect(opts?.top).toBe(6);
    expect(opts?.left).toBe(8);
  });

  it('closes the gap when a legend above is removed', () => {
    const { chart } = makeChart();
    chart.addSeries('candlestick').setData(bars(60));
    const a = new PaneLegend({ id: 'a', title: 'A', actions: [] });
    const b = new PaneLegend({ id: 'b', title: 'B', actions: [] });
    chart.addPrimitive(a, 0);
    chart.addPrimitive(b, 0);
    expect(b.options().row).toBe(1);
    chart.removePrimitive(a);
    expect(b.options().row).toBe(0);
  });

  it('reports one reading per plot, in each plot colour', () => {
    const { chart } = makeChart();
    chart.addSeries('candlestick').setData(bars(60));
    const inst = chart.addIndicator('macd');
    inst.setSettings({ macdColor: '#111111', signalColor: '#222222' });
    const legend = inst.legend();
    const values = (legend as unknown as { _values: { text: string; color?: string }[] })._values;
    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(values.map((v) => v.color)).toContain('#111111');
    expect(values.map((v) => v.color)).toContain('#222222');
  });

  it('gives every plot colour / opacity / thickness / line style', () => {
    const { chart } = makeChart();
    chart.addSeries('candlestick').setData(bars(60));
    const macd = chart.addIndicator('macd');
    const s = macd.settings();
    // Generated per-plot appearance keys, no descriptor boilerplate.
    expect(s['macd:width']).toBeDefined();
    expect(s['macd:opacity']).toBe(100);
    expect(s['macd:lineStyle']).toBe('solid');

    macd.setSettings({ 'macd:width': 4, 'macd:lineStyle': 'dashed', 'macd:opacity': 50, macdColor: '#ff0000' });
    const series = macd.series('macd') as unknown as { __style?: unknown };
    void series;
    expect(macd.settings()['macd:width']).toBe(4);
    // Opacity folds into the colour as an alpha — a canvas stroke has no
    // separate opacity channel.
    const legend = macd.legend();
    const values = (legend as unknown as { _values: { color?: string }[] })._values;
    expect(values.some((v) => v.color === '#ff0000')).toBe(true);
  });

  it('hides a source without removing it', () => {
    const { chart } = makeChart();
    chart.addSeries('candlestick').setData(bars(60));
    const rsi = chart.addIndicator('rsi');
    expect(rsi.visible()).toBe(true);
    rsi.setVisible(false);
    expect(rsi.visible()).toBe(false);
    expect(chart.indicators()).toHaveLength(1); // hidden, not deleted
    rsi.setVisible(true);
    expect(rsi.visible()).toBe(true);
  });
});

describe('pane removal, ordering, and maximize', () => {
  it('removePane drops the pane, its series, and its indicators', () => {
    const { chart } = makeChart();
    chart.addSeries('candlestick').setData(bars(60));
    const rsi = chart.addIndicator('rsi');
    expect(chart.panes().length).toBe(2);
    expect(chart.removePane(rsi.paneIndex)).toBe(true);
    expect(chart.panes().length).toBe(1);
    expect(chart.indicators()).toHaveLength(0);
  });

  it('refuses to remove the price pane', () => {
    const { chart } = makeChart();
    chart.addSeries('candlestick').setData(bars(20));
    expect(chart.removePane(0)).toBe(false);
    expect(chart.removePane(99)).toBe(false);
  });

  it('re-indexes indicators below a removed pane', () => {
    const { chart } = makeChart();
    chart.addSeries('candlestick').setData(bars(60));
    const rsi = chart.addIndicator('rsi');    // pane 1
    const macd = chart.addIndicator('macd');  // pane 2
    expect([rsi.paneIndex, macd.paneIndex]).toEqual([1, 2]);
    chart.removePane(1);
    expect(macd.paneIndex).toBe(1); // shifted up with its pane
  });

  it('movePane swaps two panes and their indicators', () => {
    const { chart } = makeChart();
    chart.addSeries('candlestick').setData(bars(60));
    const rsi = chart.addIndicator('rsi');
    const macd = chart.addIndicator('macd');
    expect(chart.movePane(2, -1)).toBe(true);
    expect(macd.paneIndex).toBe(1);
    expect(rsi.paneIndex).toBe(2);
    expect(chart.movePane(0, 1)).toBe(false);  // the price pane is pinned
    expect(chart.movePane(1, -1)).toBe(false); // ...and cannot be displaced
  });

  it('maximizePane expands one pane and restores the previous weights', () => {
    const { chart } = makeChart();
    chart.addSeries('candlestick').setData(bars(60));
    chart.addIndicator('rsi');
    const before = chart.panes().map((p) => p.weight);
    chart.maximizePane(1);
    expect(chart.maximizedPane()).toBe(1);
    expect(chart.paneWeight(1)).toBeGreaterThan(chart.paneWeight(0));
    chart.maximizePane(1);
    expect(chart.maximizedPane()).toBeNull();
    expect(chart.panes().map((p) => p.weight)).toEqual(before);
  });
});

describe('repeated indicators get distinct colours', () => {
  // Three EMAs in the descriptor's one default blue are indistinguishable on
  // the chart and in the legend alike.
  const emaColor = (i: { settings(): Record<string, unknown> }): unknown => i.settings().color;

  it('rotates the colour for the 2nd and later instances', () => {
    const { chart } = makeChart();
    chart.addSeries('candlestick').setData(bars(80));
    const a = chart.addIndicator('ema');
    const b = chart.addIndicator('ema');
    const c = chart.addIndicator('ema');
    expect(emaColor(b)).not.toBe(emaColor(a));
    expect(emaColor(c)).not.toBe(emaColor(a));
    expect(emaColor(c)).not.toBe(emaColor(b));
  });

  it('leaves the first instance on the descriptor colour', () => {
    const one = makeChart().chart;
    one.addSeries('candlestick').setData(bars(80));
    const two = makeChart().chart;
    two.addSeries('candlestick').setData(bars(80));
    expect(emaColor(one.addIndicator('ema'))).toBe(emaColor(two.addIndicator('ema')));
  });

  it('never overrides a colour the caller passed', () => {
    const { chart } = makeChart();
    chart.addSeries('candlestick').setData(bars(80));
    chart.addIndicator('ema');
    expect(emaColor(chart.addIndicator('ema', { color: '#123456' }))).toBe('#123456');
  });

  it('counts per indicator id, so another indicator starts fresh', () => {
    const { chart } = makeChart();
    chart.addSeries('candlestick').setData(bars(80));
    chart.addIndicator('ema');
    chart.addIndicator('ema');
    const other = makeChart().chart;
    other.addSeries('candlestick').setData(bars(80));
    expect(emaColor(chart.addIndicator('rsi'))).toBe(emaColor(other.addIndicator('rsi')));
  });
});
