/**
 * Tier-1 volume indicators, computed from the chart's own OHLCV.
 * Part of the lazy `openalgo-charts/indicators` tier.
 */
import type { IndicatorDescriptor } from 'openalgo-charts';
import { nulls } from './calc';

export const VOLUME: IndicatorDescriptor = {
  id: 'volume',
  name: 'Volume',
  category: 'Volume',
  placement: 'pane',
  inputs: [{ key: 'color', type: 'color', label: 'Color', default: '#3a4666' }],
  plots: [{ key: 'volume', type: 'histogram', title: 'Volume', colorKey: 'color', style: { base: 0 } }],
  calc: (bars) => ({ volume: nulls(bars.map((b) => b.volume ?? 0)) }),
};

export const OBV: IndicatorDescriptor = {
  id: 'obv',
  name: 'On-Balance Volume',
  category: 'Volume',
  placement: 'pane',
  inputs: [{ key: 'color', type: 'color', label: 'Color', default: '#26c6da' }],
  plots: [{ key: 'obv', type: 'line', title: 'OBV', colorKey: 'color', style: { lineWidth: 1.5 } }],
  calc: (bars) => {
    const out = new Array<number>(bars.length).fill(NaN);
    let acc = 0;
    for (let i = 0; i < bars.length; i++) {
      if (i > 0) {
        const v = bars[i].volume ?? 0;
        if (bars[i].close > bars[i - 1].close) acc += v;
        else if (bars[i].close < bars[i - 1].close) acc -= v;
      }
      out[i] = acc;
    }
    return { obv: nulls(out) };
  },
};

export const ADL: IndicatorDescriptor = {
  id: 'adl',
  name: 'Accumulation/Distribution',
  category: 'Volume',
  placement: 'pane',
  inputs: [{ key: 'color', type: 'color', label: 'Color', default: '#4f8cff' }],
  plots: [{ key: 'adl', type: 'line', title: 'A/D Line', colorKey: 'color', style: { lineWidth: 1.5 } }],
  calc: (bars) => {
    const out = new Array<number>(bars.length).fill(NaN);
    let acc = 0;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const span = b.high - b.low;
      // A doji bar (high === low) has an undefined money-flow multiplier;
      // the standard treatment is to contribute nothing.
      if (span > 0) acc += (((b.close - b.low) - (b.high - b.close)) / span) * (b.volume ?? 0);
      out[i] = acc;
    }
    return { adl: nulls(out) };
  },
};
