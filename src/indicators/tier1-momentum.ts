/**
 * Tier-1 momentum / volatility indicators, computed from the chart's own OHLCV.
 * Part of the lazy `openalgo-charts/indicators` tier.
 */
import { ema, rsi, atr, trueRange, sourceValues } from 'openalgo-charts';
import type { IndicatorDescriptor, IndicatorSource } from 'openalgo-charts';
import { sma, rma, highest, lowest, nulls } from './calc';

const num = (s: Readonly<Record<string, unknown>>, k: string, d: number): number => {
  const v = s[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
};
const src = (s: Readonly<Record<string, unknown>>): IndicatorSource => (s.source as IndicatorSource) ?? 'close';

export const RSI: IndicatorDescriptor = {
  id: 'rsi',
  name: 'RSI',
  category: 'Momentum',
  placement: 'pane',
  inputs: [
    { key: 'length', type: 'number', label: 'Length', default: 14, min: 1, max: 500, step: 1 },
    { key: 'source', type: 'source', label: 'Source', default: 'close' },
    { key: 'color', type: 'color', label: 'Color', default: '#e0b020' },
    { key: 'overbought', type: 'number', label: 'Overbought', default: 70, min: 50, max: 100, step: 1 },
    { key: 'oversold', type: 'number', label: 'Oversold', default: 30, min: 0, max: 50, step: 1 },
  ],
  plots: [{ key: 'rsi', type: 'line', title: 'RSI', colorKey: 'color', style: { lineWidth: 1.5 } }],
  calc: (bars, s) => ({ rsi: nulls(rsi(sourceValues(bars, src(s)), num(s, 'length', 14))) }),
  levels: (s) => [
    { price: num(s, 'overbought', 70), color: '#ef5350', title: 'OB', dashed: true },
    { price: 50, color: '#5a6b8c', title: '', dashed: true },
    { price: num(s, 'oversold', 30), color: '#26a69a', title: 'OS', dashed: true },
  ],
  range: () => ({ min: 0, max: 100 }),
};

export const MACD: IndicatorDescriptor = {
  id: 'macd',
  name: 'MACD',
  category: 'Momentum',
  placement: 'pane',
  inputs: [
    { key: 'fastPeriod', type: 'number', label: 'Fast', default: 12, min: 1, max: 500, step: 1 },
    { key: 'slowPeriod', type: 'number', label: 'Slow', default: 26, min: 1, max: 500, step: 1 },
    { key: 'signalPeriod', type: 'number', label: 'Signal', default: 9, min: 1, max: 500, step: 1 },
    { key: 'source', type: 'source', label: 'Source', default: 'close' },
    { key: 'macdColor', type: 'color', label: 'MACD', default: '#4f8cff' },
    { key: 'signalColor', type: 'color', label: 'Signal', default: '#f5a623' },
  ],
  plots: [
    { key: 'histogram', type: 'histogram', title: 'Histogram', style: { color: '#3a4666', base: 0 } },
    { key: 'macd', type: 'line', title: 'MACD', colorKey: 'macdColor', style: { lineWidth: 1.5 } },
    { key: 'signal', type: 'line', title: 'Signal', colorKey: 'signalColor', style: { lineWidth: 1.5 } },
  ],
  calc: (bars, s) => {
    const values = sourceValues(bars, src(s));
    const fast = ema(values, num(s, 'fastPeriod', 12));
    const slow = ema(values, num(s, 'slowPeriod', 26));
    const macd = fast.map((f, i) => f - slow[i]);
    const signal = ema(macd, num(s, 'signalPeriod', 9));
    const histogram = macd.map((m, i) => m - signal[i]);
    return { macd: nulls(macd), signal: nulls(signal), histogram: nulls(histogram) };
  },
  levels: () => [{ price: 0, color: '#5a6b8c', dashed: true }],
};

export const STOCHASTIC: IndicatorDescriptor = {
  id: 'stochastic',
  name: 'Stochastic',
  category: 'Momentum',
  placement: 'pane',
  inputs: [
    { key: 'kPeriod', type: 'number', label: '%K Length', default: 14, min: 1, max: 500, step: 1 },
    { key: 'kSmoothing', type: 'number', label: '%K Smoothing', default: 3, min: 1, max: 100, step: 1 },
    { key: 'dPeriod', type: 'number', label: '%D Smoothing', default: 3, min: 1, max: 100, step: 1 },
    { key: 'kColor', type: 'color', label: '%K', default: '#4f8cff' },
    { key: 'dColor', type: 'color', label: '%D', default: '#f5a623' },
  ],
  plots: [
    { key: 'k', type: 'line', title: '%K', colorKey: 'kColor', style: { lineWidth: 1.5 } },
    { key: 'd', type: 'line', title: '%D', colorKey: 'dColor', style: { lineWidth: 1.5 } },
  ],
  calc: (bars, s) => {
    const hi = highest(bars.map((b) => b.high), num(s, 'kPeriod', 14));
    const lo = lowest(bars.map((b) => b.low), num(s, 'kPeriod', 14));
    const raw = bars.map((b, i) => {
      const span = hi[i] - lo[i];
      return span > 0 ? ((b.close - lo[i]) / span) * 100 : NaN;
    });
    const k = sma(raw, num(s, 'kSmoothing', 3));
    const d = sma(k, num(s, 'dPeriod', 3));
    return { k: nulls(k), d: nulls(d) };
  },
  levels: () => [
    { price: 80, color: '#ef5350', title: 'OB', dashed: true },
    { price: 20, color: '#26a69a', title: 'OS', dashed: true },
  ],
  range: () => ({ min: 0, max: 100 }),
};

export const ADX: IndicatorDescriptor = {
  id: 'adx',
  name: 'ADX / DMI',
  category: 'Trend',
  placement: 'pane',
  inputs: [
    { key: 'period', type: 'number', label: 'DI Length', default: 14, min: 1, max: 500, step: 1 },
    { key: 'adxPeriod', type: 'number', label: 'ADX Smoothing', default: 14, min: 1, max: 500, step: 1 },
    { key: 'adxColor', type: 'color', label: 'ADX', default: '#e0e3ea' },
    { key: 'plusColor', type: 'color', label: '+DI', default: '#26a69a' },
    { key: 'minusColor', type: 'color', label: '-DI', default: '#ef5350' },
  ],
  plots: [
    { key: 'plusDi', type: 'line', title: '+DI', colorKey: 'plusColor', style: { lineWidth: 1 } },
    { key: 'minusDi', type: 'line', title: '-DI', colorKey: 'minusColor', style: { lineWidth: 1 } },
    { key: 'adx', type: 'line', title: 'ADX', colorKey: 'adxColor', style: { lineWidth: 1.5 } },
  ],
  calc: (bars, s) => {
    const n = bars.length;
    const period = num(s, 'period', 14);
    const high = bars.map((b) => b.high);
    const low = bars.map((b) => b.low);
    const close = bars.map((b) => b.close);
    const tr = trueRange(high, low, close);
    const plusDm = new Array<number>(n).fill(0);
    const minusDm = new Array<number>(n).fill(0);
    for (let i = 1; i < n; i++) {
      const up = high[i] - high[i - 1];
      const down = low[i - 1] - low[i];
      plusDm[i] = up > down && up > 0 ? up : 0;
      minusDm[i] = down > up && down > 0 ? down : 0;
    }
    const trR = rma(tr, period);
    const plusR = rma(plusDm, period);
    const minusR = rma(minusDm, period);
    const plusDi = new Array<number>(n).fill(NaN);
    const minusDi = new Array<number>(n).fill(NaN);
    const dx = new Array<number>(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(trR[i]) || trR[i] === 0) continue;
      plusDi[i] = (plusR[i] / trR[i]) * 100;
      minusDi[i] = (minusR[i] / trR[i]) * 100;
      const sum = plusDi[i] + minusDi[i];
      dx[i] = sum > 0 ? (Math.abs(plusDi[i] - minusDi[i]) / sum) * 100 : 0;
    }
    // The DX series is NaN during DI warmup; smooth only the finite tail.
    const start = dx.findIndex((v) => Number.isFinite(v));
    const adx = new Array<number>(n).fill(NaN);
    if (start >= 0) {
      const smoothed = rma(dx.slice(start), num(s, 'adxPeriod', 14));
      for (let i = 0; i < smoothed.length; i++) adx[start + i] = smoothed[i];
    }
    return { plusDi: nulls(plusDi), minusDi: nulls(minusDi), adx: nulls(adx) };
  },
  levels: () => [{ price: 25, color: '#5a6b8c', title: '25', dashed: true }],
};

export const CCI: IndicatorDescriptor = {
  id: 'cci',
  name: 'CCI',
  category: 'Momentum',
  placement: 'pane',
  inputs: [
    { key: 'period', type: 'number', label: 'Length', default: 20, min: 1, max: 500, step: 1 },
    { key: 'constant', type: 'number', label: 'Constant', default: 0.015, min: 0.001, max: 1, step: 0.001 },
    { key: 'color', type: 'color', label: 'Color', default: '#26c6da' },
  ],
  plots: [{ key: 'cci', type: 'line', title: 'CCI', colorKey: 'color', style: { lineWidth: 1.5 } }],
  calc: (bars, s) => {
    const period = num(s, 'period', 20);
    const k = num(s, 'constant', 0.015);
    const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
    const avg = sma(tp, period);
    const out = new Array<number>(bars.length).fill(NaN);
    for (let i = period - 1; i < bars.length; i++) {
      let dev = 0;
      for (let j = 0; j < period; j++) dev += Math.abs(tp[i - j] - avg[i]);
      const md = dev / period;
      out[i] = md > 0 ? (tp[i] - avg[i]) / (k * md) : 0;
    }
    return { cci: nulls(out) };
  },
  levels: () => [
    { price: 100, color: '#ef5350', dashed: true },
    { price: 0, color: '#5a6b8c', dashed: true },
    { price: -100, color: '#26a69a', dashed: true },
  ],
};

export const MFI: IndicatorDescriptor = {
  id: 'mfi',
  name: 'Money Flow Index',
  category: 'Momentum',
  placement: 'pane',
  inputs: [
    { key: 'period', type: 'number', label: 'Length', default: 14, min: 1, max: 500, step: 1 },
    { key: 'color', type: 'color', label: 'Color', default: '#ab47bc' },
  ],
  plots: [{ key: 'mfi', type: 'line', title: 'MFI', colorKey: 'color', style: { lineWidth: 1.5 } }],
  calc: (bars, s) => {
    const n = bars.length;
    const period = num(s, 'period', 14);
    const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
    const pos = new Array<number>(n).fill(0);
    const neg = new Array<number>(n).fill(0);
    for (let i = 1; i < n; i++) {
      const flow = tp[i] * (bars[i].volume ?? 0);
      if (tp[i] > tp[i - 1]) pos[i] = flow;
      else if (tp[i] < tp[i - 1]) neg[i] = flow;
    }
    const out = new Array<number>(n).fill(NaN);
    for (let i = period; i < n; i++) {
      let p = 0;
      let q = 0;
      for (let j = 0; j < period; j++) { p += pos[i - j]; q += neg[i - j]; }
      out[i] = q === 0 ? 100 : 100 - 100 / (1 + p / q);
    }
    return { mfi: nulls(out) };
  },
  levels: () => [
    { price: 80, color: '#ef5350', title: 'OB', dashed: true },
    { price: 20, color: '#26a69a', title: 'OS', dashed: true },
  ],
  range: () => ({ min: 0, max: 100 }),
};

export const ATR: IndicatorDescriptor = {
  id: 'atr',
  name: 'ATR',
  category: 'Volatility',
  placement: 'pane',
  inputs: [
    { key: 'period', type: 'number', label: 'Length', default: 14, min: 1, max: 500, step: 1 },
    { key: 'color', type: 'color', label: 'Color', default: '#f5a623' },
  ],
  plots: [{ key: 'atr', type: 'line', title: 'ATR', colorKey: 'color', style: { lineWidth: 1.5 } }],
  calc: (bars, s) => ({
    atr: nulls(atr(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), num(s, 'period', 14))),
  }),
};
