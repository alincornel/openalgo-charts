/**
 * Pure calculation helpers shared by the Tier-1 indicator descriptors
 * (`openalgo-charts/indicators`). Every function returns an array the same
 * length as its input, with `NaN` in warmup slots — the line renderer breaks
 * across non-finite points and autoscale skips them, so a warmup gap draws as
 * nothing rather than as a spike to zero.
 *
 * `ema`, `rsi`, `atr`, `trueRange`, and `supertrend` are NOT re-implemented
 * here — they ship in the base bundle and the tier imports them from it.
 */

/** Simple moving average. First value lands at index `period - 1`. */
export function sma(values: readonly number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (period <= 0 || n < period) return out;
  // The running sum must never absorb a non-finite value: `sum += NaN` poisons
  // it permanently, and subtracting the NaN back out when it leaves the window
  // does not restore it (NaN - NaN is NaN). Any input with a warmup gap -- an
  // indicator chained onto another -- would then be NaN for the whole series.
  // So sum only the finite values and count the rest.
  let sum = 0;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (Number.isFinite(v)) sum += v;
    else bad += 1;
    if (i >= period) {
      const gone = values[i - period];
      if (Number.isFinite(gone)) sum -= gone;
      else bad -= 1;
    }
    if (i >= period - 1) out[i] = bad === 0 ? sum / period : NaN;
  }
  return out;
}

/** Linearly weighted moving average (most recent bar carries weight `period`). */
export function wma(values: readonly number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (period <= 0 || n < period) return out;
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < n; i++) {
    let acc = 0;
    for (let k = 0; k < period; k++) acc += values[i - k] * (period - k);
    out[i] = acc / denom;
  }
  return out;
}

/**
 * Wilder's smoothing (RMA): seed with the SMA of the first `period` values,
 * then `(prev * (period - 1) + v) / period`. The basis of RSI, ATR, and ADX.
 */
export function rma(values: readonly number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (period <= 0 || n < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** Rolling population standard deviation over `period`. */
export function stdev(values: readonly number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (period <= 0 || n < period) return out;
  const means = sma(values, period);
  for (let i = period - 1; i < n; i++) {
    let acc = 0;
    const m = means[i];
    for (let k = 0; k < period; k++) {
      const d = values[i - k] - m;
      acc += d * d;
    }
    out[i] = Math.sqrt(acc / period);
  }
  return out;
}

/** Rolling maximum over `period` bars. */
export function highest(values: readonly number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (period <= 0) return out;
  for (let i = period - 1; i < n; i++) {
    let m = -Infinity;
    for (let k = 0; k < period; k++) if (values[i - k] > m) m = values[i - k];
    out[i] = m;
  }
  return out;
}

/** Rolling minimum over `period` bars. */
export function lowest(values: readonly number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (period <= 0) return out;
  for (let i = period - 1; i < n; i++) {
    let m = Infinity;
    for (let k = 0; k < period; k++) if (values[i - k] < m) m = values[i - k];
    out[i] = m;
  }
  return out;
}

/** NaN → null, so a warmup slot serialises as an explicit gap. */
export function nulls(values: readonly number[]): (number | null)[] {
  const out = new Array<number | null>(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out[i] = Number.isFinite(v) ? v : null;
  }
  return out;
}
