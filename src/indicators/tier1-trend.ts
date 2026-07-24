/**
 * Tier-1 trend indicators — computed from the chart's own OHLCV, no extra data.
 * Part of the lazy `openalgo-charts/indicators` tier.
 *
 * `ema`, `supertrend`, and the `sourceValues` helper come from the base bundle
 * (`../index`), not deep paths — see the note in `src/indicators/index.ts`.
 */
import { ema, supertrend, sourceValues, isNewIstDay } from 'openalgo-charts';
import type { IndicatorDescriptor, IndicatorSource } from 'openalgo-charts';
import { sma, wma, stdev, nulls } from './calc';

const num = (s: Readonly<Record<string, unknown>>, k: string, d: number): number => {
  const v = s[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
};
const src = (s: Readonly<Record<string, unknown>>, k = 'source'): IndicatorSource =>
  (s[k] as IndicatorSource) ?? 'close';

/** A moving-average descriptor — the three MAs differ only in their kernel. */
function movingAverage(
  id: string,
  name: string,
  color: string,
  kernel: (values: readonly number[], period: number) => number[],
): IndicatorDescriptor {
  return {
    id,
    name,
    category: 'Trend',
    placement: 'onchart',
    inputs: [
      { key: 'length', type: 'number', label: 'Length', default: 20, min: 1, max: 1000, step: 1 },
      { key: 'source', type: 'source', label: 'Source', default: 'close' },
      { key: 'color', type: 'color', label: 'Color', default: color },
    ],
    plots: [{ key: 'ma', type: 'line', title: name, colorKey: 'color', style: { color, lineWidth: 1.5 } }],
    calc: (bars, s) => ({ ma: nulls(kernel(sourceValues(bars, src(s)), num(s, 'length', 20))) }),
  };
}

export const SMA: IndicatorDescriptor = movingAverage('sma', 'SMA', '#4f8cff', sma);
export const WMA: IndicatorDescriptor = movingAverage('wma', 'WMA', '#ab47bc', wma);
export const EMA: IndicatorDescriptor = movingAverage('ema', 'EMA', '#f5a623', ema);

export const BOLLINGER: IndicatorDescriptor = {
  id: 'bollinger',
  name: 'Bollinger Bands',
  category: 'Volatility',
  placement: 'onchart',
  inputs: [
    { key: 'length', type: 'number', label: 'Length', default: 20, min: 2, max: 1000, step: 1 },
    { key: 'stdDev', type: 'number', label: 'StdDev', default: 2, min: 0.1, max: 10, step: 0.1 },
    { key: 'source', type: 'source', label: 'Source', default: 'close' },
    { key: 'basisColor', type: 'color', label: 'Basis', default: '#f5a623' },
    { key: 'bandColor', type: 'color', label: 'Bands', default: '#4f8cff' },
  ],
  plots: [
    { key: 'upper', type: 'line', title: 'BB Upper', colorKey: 'bandColor', style: { lineWidth: 1 } },
    { key: 'basis', type: 'line', title: 'BB Basis', colorKey: 'basisColor', style: { lineWidth: 1.5 } },
    { key: 'lower', type: 'line', title: 'BB Lower', colorKey: 'bandColor', style: { lineWidth: 1 } },
  ],
  calc: (bars, s) => {
    const values = sourceValues(bars, src(s));
    const length = num(s, 'length', 20);
    const mult = num(s, 'stdDev', 2);
    const basis = sma(values, length);
    const dev = stdev(values, length);
    const upper = basis.map((b, i) => b + mult * dev[i]);
    const lower = basis.map((b, i) => b - mult * dev[i]);
    return { upper: nulls(upper), basis: nulls(basis), lower: nulls(lower) };
  },
};

export const VWAP: IndicatorDescriptor = {
  id: 'vwap',
  name: 'VWAP',
  category: 'Volume',
  placement: 'onchart',
  inputs: [
    {
      key: 'anchor', type: 'select', label: 'Anchor', default: 'session',
      options: [{ label: 'Session (IST day)', value: 'session' }, { label: 'Continuous', value: 'continuous' }],
    },
    { key: 'source', type: 'source', label: 'Source', default: 'hlc3' },
    { key: 'color', type: 'color', label: 'Color', default: '#26c6da' },
  ],
  plots: [{ key: 'vwap', type: 'line', title: 'VWAP', colorKey: 'color', style: { lineWidth: 1.5 } }],
  calc: (bars, s) => {
    const values = sourceValues(bars, src(s));
    const perSession = s.anchor !== 'continuous';
    const out = new Array<number>(bars.length).fill(NaN);
    let pv = 0;
    let vol = 0;
    for (let i = 0; i < bars.length; i++) {
      if (perSession && i > 0 && isNewIstDay(bars[i - 1].time, bars[i].time)) { pv = 0; vol = 0; }
      const v = bars[i].volume ?? 0;
      pv += values[i] * v;
      vol += v;
      out[i] = vol > 0 ? pv / vol : NaN;
    }
    return { vwap: nulls(out) };
  },
};

export const SUPERTREND: IndicatorDescriptor = {
  id: 'supertrend',
  name: 'Supertrend',
  category: 'Trend',
  placement: 'onchart',
  inputs: [
    { key: 'period', type: 'number', label: 'ATR Period', default: 10, min: 1, max: 200, step: 1 },
    { key: 'multiplier', type: 'number', label: 'Multiplier', default: 3, min: 0.1, max: 20, step: 0.1 },
    { key: 'upColor', type: 'color', label: 'Uptrend', default: '#26a69a' },
    { key: 'downColor', type: 'color', label: 'Downtrend', default: '#ef5350' },
  ],
  // Two plots so the band changes color at a flip: each carries null while the
  // other is active, and the line renderer breaks across the gap.
  plots: [
    { key: 'up', type: 'line', title: 'Supertrend Up', colorKey: 'upColor', style: { lineWidth: 2 } },
    { key: 'down', type: 'line', title: 'Supertrend Down', colorKey: 'downColor', style: { lineWidth: 2 } },
  ],
  calc: (bars, s) => {
    const st = supertrend(bars, num(s, 'period', 10), num(s, 'multiplier', 3));
    const up: (number | null)[] = [];
    const down: (number | null)[] = [];
    for (const p of st) {
      const live = Number.isFinite(p.value);
      up.push(live && p.direction === -1 ? p.value : null);
      down.push(live && p.direction === 1 ? p.value : null);
    }
    return { up, down };
  },
};

export const PARABOLIC_SAR: IndicatorDescriptor = {
  id: 'parabolic-sar',
  name: 'Parabolic SAR',
  category: 'Trend',
  placement: 'onchart',
  inputs: [
    { key: 'start', type: 'number', label: 'Start', default: 0.02, min: 0.001, max: 1, step: 0.001 },
    { key: 'increment', type: 'number', label: 'Increment', default: 0.02, min: 0.001, max: 1, step: 0.001 },
    { key: 'maximum', type: 'number', label: 'Maximum', default: 0.2, min: 0.01, max: 1, step: 0.01 },
    { key: 'color', type: 'color', label: 'Color', default: '#e0b020' },
  ],
  plots: [{
    key: 'sar', type: 'line', title: 'SAR', colorKey: 'color',
    style: { markersOnly: true, markerRadius: 1.5 },
  }],
  calc: (bars, s) => {
    const n = bars.length;
    const out = new Array<number>(n).fill(NaN);
    if (n < 2) return { sar: nulls(out) };
    const step = num(s, 'start', 0.02);
    const inc = num(s, 'increment', 0.02);
    const max = num(s, 'maximum', 0.2);

    let rising = bars[1].close >= bars[0].close;
    let sar = rising ? bars[0].low : bars[0].high;
    let ep = rising ? bars[1].high : bars[1].low;
    let af = step;

    for (let i = 1; i < n; i++) {
      sar += af * (ep - sar);
      // SAR may not penetrate the prior two bars' range.
      const lo1 = bars[i - 1].low;
      const hi1 = bars[i - 1].high;
      const lo2 = i >= 2 ? bars[i - 2].low : lo1;
      const hi2 = i >= 2 ? bars[i - 2].high : hi1;
      if (rising) sar = Math.min(sar, lo1, lo2);
      else sar = Math.max(sar, hi1, hi2);

      if (rising && bars[i].low < sar) {
        rising = false; sar = ep; ep = bars[i].low; af = step;
      } else if (!rising && bars[i].high > sar) {
        rising = true; sar = ep; ep = bars[i].high; af = step;
      } else if (rising && bars[i].high > ep) {
        ep = bars[i].high; af = Math.min(max, af + inc);
      } else if (!rising && bars[i].low < ep) {
        ep = bars[i].low; af = Math.min(max, af + inc);
      }
      out[i] = sar;
    }
    return { sar: nulls(out) };
  },
};

/** Shift a series by `k` bars: positive = forward (later), negative = backward. */
function shift(values: readonly number[], k: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const j = i - k;
    if (j >= 0 && j < n) out[i] = values[j];
  }
  return out;
}

export const ICHIMOKU: IndicatorDescriptor = {
  id: 'ichimoku',
  name: 'Ichimoku Cloud',
  category: 'Trend',
  placement: 'onchart',
  inputs: [
    { key: 'conversionPeriod', type: 'number', label: 'Conversion', default: 9, min: 1, max: 200, step: 1 },
    { key: 'basePeriod', type: 'number', label: 'Base', default: 26, min: 1, max: 200, step: 1 },
    { key: 'laggingSpanPeriod', type: 'number', label: 'Lagging Span', default: 52, min: 1, max: 400, step: 1 },
    { key: 'displacement', type: 'number', label: 'Displacement', default: 26, min: 0, max: 200, step: 1 },
    { key: 'conversionColor', type: 'color', label: 'Conversion', default: '#4f8cff' },
    { key: 'baseColor', type: 'color', label: 'Base', default: '#ef5350' },
    { key: 'spanAColor', type: 'color', label: 'Span A', default: '#26a69a' },
    { key: 'spanBColor', type: 'color', label: 'Span B', default: '#ab47bc' },
    { key: 'laggingColor', type: 'color', label: 'Lagging', default: '#8892a6' },
  ],
  plots: [
    { key: 'conversion', type: 'line', title: 'Tenkan-sen', colorKey: 'conversionColor', style: { lineWidth: 1 } },
    { key: 'base', type: 'line', title: 'Kijun-sen', colorKey: 'baseColor', style: { lineWidth: 1 } },
    { key: 'spanA', type: 'line', title: 'Senkou Span A', colorKey: 'spanAColor', style: { lineWidth: 1 } },
    { key: 'spanB', type: 'line', title: 'Senkou Span B', colorKey: 'spanBColor', style: { lineWidth: 1 } },
    { key: 'lagging', type: 'line', title: 'Chikou Span', colorKey: 'laggingColor', style: { lineWidth: 1 } },
  ],
  calc: (bars, s) => {
    const n = bars.length;
    const conv = num(s, 'conversionPeriod', 9);
    const base = num(s, 'basePeriod', 26);
    const lag = num(s, 'laggingSpanPeriod', 52);
    const disp = num(s, 'displacement', 26);

    // Donchian midpoint over `p` bars.
    const mid = (p: number): number[] => {
      const out = new Array<number>(n).fill(NaN);
      for (let i = p - 1; i < n; i++) {
        let hi = -Infinity;
        let lo = Infinity;
        for (let k = 0; k < p; k++) {
          if (bars[i - k].high > hi) hi = bars[i - k].high;
          if (bars[i - k].low < lo) lo = bars[i - k].low;
        }
        out[i] = (hi + lo) / 2;
      }
      return out;
    };

    const conversion = mid(conv);
    const baseLine = mid(base);
    const spanA = conversion.map((c, i) => (c + baseLine[i]) / 2);
    const spanB = mid(lag);
    const closes = bars.map((b) => b.close);
    return {
      conversion: nulls(conversion),
      base: nulls(baseLine),
      spanA: nulls(shift(spanA, disp)),
      spanB: nulls(shift(spanB, disp)),
      lagging: nulls(shift(closes, -disp)),
    };
  },
};
