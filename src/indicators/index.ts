/**
 * Indicator tier (opt-in: "openalgo-charts/indicators").
 *
 * 18 Tier-1 built-ins — computed from the chart's own OHLCV, no extra data —
 * plus the Tier-2 contract for indicators that own an external fetch/subscribe
 * lifecycle. Importing this module registers every built-in as a side effect.
 *
 * ```ts
 * import { createChart } from 'openalgo-charts';
 * import 'openalgo-charts/indicators';
 *
 * const chart = createChart(el);
 * chart.addSeries('candlestick').setData(bars);
 * chart.addIndicator('macd');
 * chart.addIndicator('bollinger', { length: 20, stdDev: 2.5 });
 * ```
 *
 * `registerIndicator` is imported from `../index` (the base entry), never a
 * deep path: each tier is its own bundle, so a deep import would inline a
 * second copy of the registry and `chart.addIndicator` would never find what
 * this tier registers. `../index` is external for tier builds.
 */
import { registerIndicator } from 'openalgo-charts';
import type { IndicatorDescriptor } from 'openalgo-charts';
import { SMA, EMA, WMA, VWAP, BOLLINGER, SUPERTREND, PARABOLIC_SAR, ICHIMOKU } from './tier1-trend';
import { RSI, MACD, STOCHASTIC, ADX, CCI, MFI, ATR, WILLIAMS_VIX_FIX } from './tier1-momentum';
import { VOLUME, OBV, ADL } from './tier1-volume';

export const INDICATORS_TIER = 'indicators' as const;

/** Every built-in descriptor, in picker order. */
export const BUILTIN_INDICATORS: readonly IndicatorDescriptor[] = [
  SMA, EMA, WMA, VWAP, BOLLINGER, SUPERTREND, PARABOLIC_SAR, ICHIMOKU,
  RSI, MACD, STOCHASTIC, ADX, CCI, MFI, ATR, WILLIAMS_VIX_FIX,
  VOLUME, OBV, ADL,
];

let _registered = false;

/**
 * Register every built-in indicator. Called as a side effect on import, and
 * exported so bundlers that aggressively tree-shake a bare side-effect import
 * can call it explicitly. Idempotent.
 */
export function registerBuiltinIndicators(): void {
  if (_registered) return;
  _registered = true;
  for (const descriptor of BUILTIN_INDICATORS) registerIndicator(descriptor);
}

registerBuiltinIndicators(); // side effect on tier import

export { SMA, EMA, WMA, VWAP, BOLLINGER, SUPERTREND, PARABOLIC_SAR, ICHIMOKU } from './tier1-trend';
export { RSI, MACD, STOCHASTIC, ADX, CCI, MFI, ATR, WILLIAMS_VIX_FIX } from './tier1-momentum';
export { VOLUME, OBV, ADL } from './tier1-volume';
export { sma, wma, rma, stdev, highest, lowest, nulls } from './calc';
export {
  createTier2Indicator,
  type Tier2Descriptor,
  type Tier2Context,
  type Tier2Point,
} from './tier2';
