/**
 * Tier-1 trend indicators — computed from the chart's own OHLCV, no extra data.
 * Part of the lazy `openalgo-charts/indicators` tier.
 *
 * `ema`, `supertrend`, and the `sourceValues` helper come from the base bundle
 * (`../index`), not deep paths — see the note in `src/indicators/index.ts`.
 */
import { ema, supertrend, atr, sourceValues, isNewIstDay } from 'openalgo-charts';
import type { IndicatorDescriptor, IndicatorSource } from 'openalgo-charts';
import { sma, wma, stdev, highest, lowest, nulls } from './calc';

const num = (s: Readonly<Record<string, unknown>>, k: string, d: number): number => {
  const v = s[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
};
const str = (s: Readonly<Record<string, unknown>>, k: string, d: string): string => {
  const v = s[k];
  return typeof v === 'string' && v !== '' ? v : d;
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
    { key: 'cloudUpColor', type: 'color', label: 'Cloud up', default: '#26a69a' },
    { key: 'cloudDownColor', type: 'color', label: 'Cloud down', default: '#ef5350' },
  ],
  plots: [
    { key: 'conversion', type: 'line', title: 'Tenkan-sen', colorKey: 'conversionColor', style: { lineWidth: 1 } },
    { key: 'base', type: 'line', title: 'Kijun-sen', colorKey: 'baseColor', style: { lineWidth: 1 } },
    { key: 'spanA', type: 'line', title: 'Senkou Span A', colorKey: 'spanAColor', style: { lineWidth: 1 } },
    { key: 'spanB', type: 'line', title: 'Senkou Span B', colorKey: 'spanBColor', style: { lineWidth: 1 } },
    { key: 'lagging', type: 'line', title: 'Chikou Span', colorKey: 'laggingColor', style: { lineWidth: 1 } },
  ],
  // The Kumo. Two lines are not the same picture as a filled cloud: the shading
  // is what makes "price is above the cloud" and "the cloud flipped" readable,
  // and which span leads is itself the signal, hence the two colours.
  fills: [{
    between: ['spanA', 'spanB'],
    colorUpKey: 'cloudUpColor',
    colorDownKey: 'cloudDownColor',
    opacity: 0.14,
  }],
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

/**
 * HalfTrend — a trend-following level that only moves against the trend once
 * the opposing side of the range genuinely gives way, so it holds flat through
 * noise where a moving average would wobble.
 *
 * Two state machines run at once. `trend` is what is drawn; `nextTrend` is which
 * flip is currently *armed*. While a down-flip is armed the indicator tracks the
 * running maximum of the `amplitude`-bar low; the flip only fires when the mean
 * high drops under that maximum **and** the bar closes below the previous bar's
 * low. The up-flip is the mirror. Requiring both a mean crossing and a close
 * beyond the prior bar's extreme is what keeps the level still.
 *
 * On a flip the new level starts from the level the other side ended on, which
 * is why the line steps rather than jumping to price. `channelDeviation` half-ATR
 * bands ride the level as a channel, and the flip bar is marked half an ATR
 * inside the channel.
 *
 * Original implementation written from the algorithm's published behaviour, per
 * ARCHITECTURE.md §0.1 — not ported from any third-party source.
 */
export const HALFTREND: IndicatorDescriptor = {
  id: 'halftrend',
  name: 'HalfTrend',
  category: 'Trend',
  placement: 'onchart',
  inputs: [
    { key: 'amplitude', type: 'number', label: 'Amplitude', default: 2, min: 1, max: 100, step: 1 },
    { key: 'channelDeviation', type: 'number', label: 'Channel Deviation', default: 2, min: 0, max: 20, step: 0.1 },
    { key: 'atrPeriod', type: 'number', label: 'ATR Period', default: 100, min: 1, max: 500, step: 1 },
    { key: 'showChannels', type: 'boolean', label: 'Show Channels', default: true },
    { key: 'showSignals', type: 'boolean', label: 'Show Signals', default: true },
    { key: 'showLabels', type: 'boolean', label: 'Show Buy/Sell Labels', default: true },
    { key: 'upColor', type: 'color', label: 'Uptrend', default: '#2962ff' },
    { key: 'downColor', type: 'color', label: 'Downtrend', default: '#ef5350' },
  ],
  // The level is split across two plots so it recolours at a flip, exactly as
  // Supertrend does: each carries null while the other is active and the line
  // renderer breaks across the gap.
  plots: [
    { key: 'up', type: 'line', title: 'HalfTrend Up', colorKey: 'upColor', style: { lineWidth: 2 } },
    { key: 'down', type: 'line', title: 'HalfTrend Down', colorKey: 'downColor', style: { lineWidth: 2 } },
    {
      key: 'atrHigh', type: 'line', title: 'Channel High', colorKey: 'downColor',
      style: { markersOnly: true, markerRadius: 1 },
    },
    {
      key: 'atrLow', type: 'line', title: 'Channel Low', colorKey: 'upColor',
      style: { markersOnly: true, markerRadius: 1 },
    },
    {
      key: 'buySignal', type: 'line', title: 'Buy', colorKey: 'upColor',
      style: { markersOnly: true, markerRadius: 3.5 },
    },
    {
      key: 'sellSignal', type: 'line', title: 'Sell', colorKey: 'downColor',
      style: { markersOnly: true, markerRadius: 3.5 },
    },
  ],
  // One ribbon per side. Both endpoints must be non-null for a fill to appear,
  // and only the active side's level is non-null, so the tint follows the trend
  // without any per-bar colour logic.
  fills: [
    { between: ['up', 'atrLow'], colorUpKey: 'upColor', colorDownKey: 'upColor', opacity: 0.15 },
    { between: ['down', 'atrHigh'], colorUpKey: 'downColor', colorDownKey: 'downColor', opacity: 0.15 },
  ],
  // The flip is an event with a name, not a column of prices, so it is a
  // marker rather than a plot. The plate hangs off the channel edge it belongs
  // to, tail pointing at it, which is why buy is a labelUp and sell a labelDown.
  markers: ({ bars, values, settings }) => {
    if (settings.showLabels === false) return [];
    const buy = values.buySignal ?? [];
    const sell = values.sellSignal ?? [];
    const out = [];
    for (let i = 0; i < bars.length; i++) {
      const b = buy[i];
      if (b !== null && b !== undefined) {
        out.push({
          time: bars[i].time, position: 'atPrice' as const, price: b,
          shape: 'labelUp' as const, size: 'small' as const,
          color: str(settings, 'upColor', '#2962ff'), text: 'Buy',
        });
        continue;
      }
      const sg = sell[i];
      if (sg !== null && sg !== undefined) {
        out.push({
          time: bars[i].time, position: 'atPrice' as const, price: sg,
          shape: 'labelDown' as const, size: 'small' as const,
          color: str(settings, 'downColor', '#ef5350'), text: 'Sell',
        });
      }
    }
    return out;
  },
  calc: (bars, s) => {
    const n = bars.length;
    const up: (number | null)[] = new Array(n).fill(null);
    const down: (number | null)[] = new Array(n).fill(null);
    const chHigh: (number | null)[] = new Array(n).fill(null);
    const chLow: (number | null)[] = new Array(n).fill(null);
    const buy: (number | null)[] = new Array(n).fill(null);
    const sell: (number | null)[] = new Array(n).fill(null);
    const out = { up, down, atrHigh: chHigh, atrLow: chLow, buySignal: buy, sellSignal: sell };
    if (n === 0) return out;

    const amp = Math.max(1, Math.round(num(s, 'amplitude', 2)));
    const chDev = num(s, 'channelDeviation', 2);
    const showChannels = s.showChannels !== false;
    const showSignals = s.showSignals !== false;

    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const halfAtr = atr(highs, lows, bars.map((b) => b.close), Math.max(1, Math.round(num(s, 'atrPeriod', 100))));
    const meanHigh = sma(highs, amp);
    const meanLow = sma(lows, amp);
    const rollHigh = highest(highs, amp);
    const rollLow = lowest(lows, amp);

    // 0 = uptrend, 1 = downtrend. `armed` is the flip currently being tracked.
    let trend = 0;
    let armed = 0;
    let maxLow = lows[0];
    let minHigh = highs[0];
    let upLevel = 0;
    let downLevel = 0;
    let seeded = false;

    for (let i = 0; i < n; i++) {
      const half = halfAtr[i] / 2;
      const dev = chDev * half;
      const barHigh = rollHigh[i];
      const barLow = rollLow[i];
      // Bar 0 has no predecessor; comparing against itself can never satisfy the
      // flip condition, which is the correct no-signal answer for a single bar.
      const prevHigh = i > 0 ? highs[i - 1] : highs[0];
      const prevLow = i > 0 ? lows[i - 1] : lows[0];
      const wasTrend = seeded ? trend : -1;

      if (armed === 1) {
        if (Number.isFinite(barLow)) maxLow = Math.max(barLow, maxLow);
        if (Number.isFinite(meanHigh[i]) && meanHigh[i] < maxLow && bars[i].close < prevLow) {
          trend = 1;
          armed = 0;
          minHigh = barHigh;
        }
      } else {
        if (Number.isFinite(barHigh)) minHigh = Math.min(barHigh, minHigh);
        if (Number.isFinite(meanLow[i]) && meanLow[i] > minHigh && bars[i].close > prevHigh) {
          trend = 0;
          armed = 1;
          maxLow = barLow;
        }
      }

      let level: number;
      if (trend === 0) {
        if (wasTrend === 1) {
          upLevel = downLevel; // step across from where the other side ended
          if (showSignals && Number.isFinite(half)) buy[i] = upLevel - half;
        } else {
          upLevel = wasTrend === -1 ? maxLow : Math.max(maxLow, upLevel);
        }
        level = upLevel;
      } else {
        if (wasTrend === 0) {
          downLevel = upLevel;
          if (showSignals && Number.isFinite(half)) sell[i] = downLevel + half;
        } else {
          downLevel = wasTrend === -1 ? minHigh : Math.min(minHigh, downLevel);
        }
        level = downLevel;
      }
      seeded = true;

      if (!Number.isFinite(level)) continue;
      if (trend === 0) up[i] = level;
      else down[i] = level;
      // The level needs no ATR, so it starts well before the channel does.
      if (showChannels && Number.isFinite(dev)) {
        chHigh[i] = level + dev;
        chLow[i] = level - dev;
      }
    }
    return out;
  },
};
