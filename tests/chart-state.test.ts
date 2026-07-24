import { describe, it, expect } from 'vitest';
import '../src/indicators/index'; // register built-ins so restore can recreate them
import { Chart } from '../src/core/chart';
import { DataLayer } from '../src/model/data-layer';
import { CHART_STATE_VERSION } from '../src/model/chart-state';
import { fakeDocument } from './helpers/fake-dom';
import type { Bar } from '../src/model/bar';

const bars = (n: number, step = 60): Bar[] =>
  Array.from({ length: n }, (_, i) => {
    const c = 100 + Math.sin(i / 4) * 5;
    return { time: 1700000000 + i * step, open: c, high: c + 1, low: c - 1, close: c, volume: 10 + i };
  });

const makeChart = (): Chart => {
  const chart = new Chart(fakeDocument().createElement('div'), {
    document: fakeDocument(),
    raf: { schedule: () => 0 },
    pixelRatio: () => 1,
    shortcuts: false,
  });
  chart.applySize(800, 600);
  return chart;
};

describe('DataLayer fractional time mapping', () => {
  const layer = (): DataLayer => {
    const d = new DataLayer();
    const id = d.createSeries();
    d.setSeriesData(id, bars(5)); // times 1700000000 + i*60
    return d;
  };

  it('returns exact bar times at whole indices', () => {
    const d = layer();
    expect(d.indexToTimeFloat(0)).toBe(1700000000);
    expect(d.indexToTimeFloat(4)).toBe(1700000240);
  });

  it('interpolates between bars — the positions a gapless axis collapses', () => {
    expect(layer().indexToTimeFloat(1.5)).toBe(1700000090);
  });

  it('extrapolates past both edges at the local bar spacing', () => {
    const d = layer();
    expect(d.indexToTimeFloat(6)).toBe(1700000240 + 2 * 60); // right of the last bar
    expect(d.indexToTimeFloat(-2)).toBe(1700000000 - 2 * 60);
  });

  it('round-trips through timeToIndexFloat', () => {
    const d = layer();
    for (const index of [-3, 0, 1.5, 2, 3.25, 4, 7.5]) {
      expect(d.timeToIndexFloat(d.indexToTimeFloat(index))).toBeCloseTo(index, 9);
    }
  });

  it('degrades safely with no data and with one bar', () => {
    const empty = new DataLayer();
    expect(Number.isNaN(empty.indexToTimeFloat(3))).toBe(true);
    expect(Number.isNaN(empty.timeToIndexFloat(1700000000))).toBe(true);

    const one = new DataLayer();
    one.setSeriesData(one.createSeries(), bars(1));
    expect(one.indexToTimeFloat(5)).toBe(1700000000);
    expect(one.timeToIndexFloat(1700009999)).toBe(0);
  });

  it('handles an irregular (gap-collapsed) time axis', () => {
    const d = new DataLayer();
    const id = d.createSeries();
    // A weekend gap: Fri, Mon, Tue. The collapsed axis has no index inside it.
    d.setSeriesData(id, [
      { time: 1000, open: 1, high: 1, low: 1, close: 1 },
      { time: 300000, open: 1, high: 1, low: 1, close: 1 },
      { time: 386400, open: 1, high: 1, low: 1, close: 1 },
    ]);
    expect(d.indexToTimeFloat(0.5)).toBe((1000 + 300000) / 2);
    expect(d.timeToIndexFloat(300000)).toBe(1);
  });
});

describe('chart.getState / restoreState', () => {
  it('captures a JSON-safe snapshot', () => {
    const chart = makeChart();
    chart.addSeries('candlestick', { style: { upColor: '#123456' } }).setData(bars(50));
    const state = chart.getState();
    expect(state.version).toBe(CHART_STATE_VERSION);
    expect(() => JSON.parse(JSON.stringify(state))).not.toThrow();
    expect(state.series?.[0]).toMatchObject({ type: 'candlestick', paneIndex: 0, priceScaleId: 'right' });
    expect(state.series?.[0].style.upColor).toBe('#123456');
    expect(state.panes).toHaveLength(1);
  });

  it('round-trips grid, crosshair mode, and pane price-scale settings', () => {
    const a = makeChart();
    a.addSeries('candlestick').setData(bars(50));
    a.setGridOptions({ vertLines: false, horzLines: true });
    a.applyOptions({ crosshairMode: 'magnet' });
    a.panes()[0].priceScale.setOptions({ mode: 'logarithmic', inverted: true, marginTop: 0.2 });
    a.panes()[0].priceScale.setAutoScale(false);
    a.panes()[0].priceScale.setPriceRange({ min: 90, max: 110 });
    const state = JSON.parse(JSON.stringify(a.getState()));

    const b = makeChart();
    b.addSeries('candlestick').setData(bars(50));
    const report = b.restoreState(state);
    expect(report.applied).toBe(true);
    expect(b.gridOptions()).toEqual({ vertLines: false, horzLines: true });
    const scale = b.panes()[0].priceScale;
    expect(scale.options.mode).toBe('logarithmic');
    expect(scale.options.inverted).toBe(true);
    expect(scale.options.marginTop).toBe(0.2);
    expect(scale.autoScale).toBe(false);
    expect(scale.priceRange()).toEqual({ min: 90, max: 110 });
  });

  it('recreates indicators with their settings and pane', () => {
    const a = makeChart();
    a.addSeries('candlestick').setData(bars(60));
    a.addIndicator('macd', { fastPeriod: 8 });
    a.addIndicator('ema', { length: 55 });
    const state = JSON.parse(JSON.stringify(a.getState()));
    expect(state.indicators).toHaveLength(2);

    const b = makeChart();
    b.addSeries('candlestick').setData(bars(60));
    const report = b.restoreState(state);
    expect(report.indicators).toBe(2);
    expect(b.indicators().map((i) => i.indicatorId)).toEqual(['macd', 'ema']);
    expect(b.indicators()[0].settings().fastPeriod).toBe(8);
    expect(b.indicators()[1].settings().length).toBe(55);
    expect(b.indicators()[0].values().macd).toHaveLength(60);
  });

  it('is idempotent — restoring twice does not duplicate indicators', () => {
    const chart = makeChart();
    chart.addSeries('candlestick').setData(bars(40));
    chart.addIndicator('rsi');
    const state = JSON.parse(JSON.stringify(chart.getState()));
    chart.restoreState(state);
    chart.restoreState(state);
    expect(chart.indicators()).toHaveLength(1);
  });

  it('reports series descriptors rather than recreating them', () => {
    const a = makeChart();
    a.addSeries('candlestick').setData(bars(30));
    a.addSeries('histogram', { paneIndex: 1 }).setData(bars(30));
    const state = JSON.parse(JSON.stringify(a.getState()));

    const b = makeChart();
    const report = b.restoreState(state);
    expect(report.series).toHaveLength(2);
    expect(report.series[1]).toMatchObject({ type: 'histogram', paneIndex: 1 });
    // The chart has no data for them, so it must not have invented series.
    expect(b.panes()[0].series()).toHaveLength(0);
  });

  it('skips indicators whose tier is not loaded instead of throwing', () => {
    const chart = makeChart();
    chart.addSeries('candlestick').setData(bars(30));
    const report = chart.restoreState({
      version: CHART_STATE_VERSION,
      indicators: [{ indicatorId: 'not-registered', settings: {}, paneIndex: 1 }],
    });
    expect(report.applied).toBe(true);
    expect(report.indicators).toBe(0);
  });

  it('rejects junk and future versions without throwing', () => {
    const chart = makeChart();
    expect(chart.restoreState(null).applied).toBe(false);
    expect(chart.restoreState('nope').applied).toBe(false);
    expect(chart.restoreState({}).applied).toBe(false);
    const future = chart.restoreState({ version: CHART_STATE_VERSION + 1 });
    expect(future.applied).toBe(false);
    expect(future.reason).toMatch(/newer/);
  });

  it('round-trips the opaque drawings slot untouched', () => {
    const chart = makeChart();
    const payload = { tools: [{ id: 'a', points: [{ time: 1, price: 2 }] }] };
    chart.setDrawingState(payload);
    const state = JSON.parse(JSON.stringify(chart.getState()));
    expect(state.drawings).toEqual(payload);

    const other = makeChart();
    other.restoreState(state);
    expect(other.drawingState()).toEqual(payload);
  });

  it('restores the viewport once data exists', () => {
    const a = makeChart();
    a.addSeries('candlestick').setData(bars(200));
    a.setVisibleLogicalRange({ from: 50, to: 120 });
    const state = JSON.parse(JSON.stringify(a.getState()));

    const b = makeChart();
    b.addSeries('candlestick').setData(bars(200));
    b.restoreState(state);
    const range = b.getVisibleLogicalRange();
    expect(range.to - range.from).toBeCloseTo(70, 6);
  });
});

describe('drag carries time as well as price', () => {
  it('maps container x to a time on the gapless axis', () => {
    const chart = makeChart();
    chart.addSeries('candlestick').setData(bars(100));
    // A round-trip through the public coordinate helpers is the contract the
    // drag callback's `time` argument relies on.
    const t = chart.coordinateToTime(400);
    expect(Number.isFinite(t)).toBe(true);
    expect(chart.timeToCoordinate(t)).toBeCloseTo(400, 6);
  });

  it('gives a usable time to the right of the last bar', () => {
    const chart = makeChart();
    const data = bars(100);
    chart.addSeries('candlestick').setData(data);
    const lastX = chart.timeToCoordinate(data[99].time);
    const beyond = chart.coordinateToTime(lastX + 200);
    expect(beyond).toBeGreaterThan(data[99].time);
  });
});
