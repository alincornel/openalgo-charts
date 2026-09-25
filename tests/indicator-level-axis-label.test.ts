/**
 * The right-axis tag of a price line, and the chart switch that turns it off
 * for indicator levels.
 *
 * On a short oscillator pane the level tags (RSI's 70 / 50 / 30, MACD's 0) sit
 * on the same axis as the study's own last-value tag and cover it whenever the
 * reading is near a level, which is most of the time. The dashed line already
 * says where the level is; a host can drop the tag and keep the reading.
 */
import { describe, it, expect, vi } from 'vitest';
import '../src/indicators/index'; // side effect: registers the built-ins (RSI, MACD)
import { Chart } from '../src/core/chart';
import { PriceLine, type PriceLineOptions } from '../src/primitives/price-line';
import type { PrimitiveRenderContext } from '../src/primitives/primitive';
import { darkTheme } from '../src/theme';
import { DataLayer } from '../src/model/data-layer';
import { PriceScale } from '../src/scale/price-scale';
import { TimeScale } from '../src/scale/time-scale';
import type { Bar } from '../src/model/bar';
import { RecordingContext } from './helpers/fake-ctx';
import { fakeDocument, type FakeElement } from './helpers/fake-dom';

function makeRc(): PrimitiveRenderContext {
  const dl = new DataLayer();
  const id = dl.createSeries();
  dl.setSeriesData(id, [{ time: 100, open: 50, high: 52, low: 48, close: 50 }]);
  const priceScale = new PriceScale();
  priceScale.setHeight(400);
  priceScale.setPriceRange({ min: 40, max: 60 });
  const timeScale = new TimeScale({ barSpacing: 20, rightOffset: 0 });
  timeScale.setWidth(600);
  timeScale.setBaseIndex(dl.baseIndex);
  return { timeScale, priceScale, dataLayer: dl, plotWidth: 600, plotHeight: 400, priceAxisWidth: 56, dpr: 1, theme: darkTheme };
}

function drawnTexts(opts: Partial<PriceLineOptions>): string[] {
  const ctx = new RecordingContext();
  new PriceLine({ price: 50, color: '#ef5350', id: 'x', ...opts }).draw(ctx as unknown as CanvasRenderingContext2D, makeRc());
  return ctx.ops.filter((o) => o.type === 'fillText').map((o) => String(o.text));
}

const BARS: Bar[] = Array.from({ length: 80 }, (_, i) => {
  const close = 100 + Math.sin(i / 4) * 5;
  return { time: 1_700_000_000 + i * 60, open: close - 0.5, high: close + 1, low: close - 1, close, volume: 100 };
});

function chartWith(options: Record<string, unknown>): Chart {
  const doc = fakeDocument();
  const el = doc.createElement('div') as unknown as FakeElement;
  Object.assign(el, { clientWidth: 900, clientHeight: 600 });
  const chart = new Chart(el, {
    document: doc,
    pixelRatio: () => 1,
    shortcuts: false,
    raf: { schedule: (cb: () => void) => { cb(); return 1; }, cancel: () => {} },
    ...options,
  });
  chart.applySize(900, 600);
  chart.addSeries('candlestick').setData(BARS);
  return chart;
}

function levelLineOptions(chart: Chart, indicator: string): PriceLineOptions[] {
  const spy = vi.spyOn(chart, 'addPriceLine');
  chart.addIndicator(indicator);
  return spy.mock.calls.map((call) => call[0]).filter((o) => o.id?.includes(':level:') === true);
}

describe('PriceLine axis tag', () => {
  it('draws the right-axis tag by default', () => {
    expect(drawnTexts({ label: '70' })).toContain('70');
  });

  it('draws no right-axis tag when axisLabelVisible is false, and keeps the line', () => {
    const ctx = new RecordingContext();
    new PriceLine({ price: 50, color: '#ef5350', id: 'x', label: '70', axisLabelVisible: false })
      .draw(ctx as unknown as CanvasRenderingContext2D, makeRc());
    expect(ctx.ops.some((o) => o.type === 'fillText' && o.text === '70')).toBe(false);
    expect(ctx.ops.some((o) => o.type === 'stroke')).toBe(true);
  });

  it('keeps the on-line pill (OB / OS) when only the axis tag is off', () => {
    expect(drawnTexts({ leftLabel: 'OB', axisLabelVisible: false })).toContain('OB');
  });
});

describe('Chart indicatorLevelAxisLabels', () => {
  it('leaves indicator level tags on by default', () => {
    const levels = levelLineOptions(chartWith({}), 'rsi');
    expect(levels.length).toBe(3);
    expect(levels.every((o) => o.axisLabelVisible !== false)).toBe(true);
  });

  it('turns every indicator level tag off when set to false', () => {
    const rsi = levelLineOptions(chartWith({ indicatorLevelAxisLabels: false }), 'rsi');
    expect(rsi.length).toBe(3);
    expect(rsi.every((o) => o.axisLabelVisible === false)).toBe(true);
  });

  it('does not touch a price line the host adds itself', () => {
    const chart = chartWith({ indicatorLevelAxisLabels: false });
    const spy = vi.spyOn(chart, 'addPriceLine');
    chart.addPriceLine({ price: 101, color: '#fff', id: 'host-line' });
    expect(spy.mock.calls[0]![0].axisLabelVisible).toBeUndefined();
  });
});
