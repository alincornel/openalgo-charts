/**
 * A higher-timeframe view of the chart's own bars, one value per source bar.
 *
 * A study written for a script language asks for the daily high on a 5-minute
 * chart and gets a column the same length as the chart. The engine has no
 * such call, and every port that needed one folded the bars by hand, each a
 * little differently: some anchored an hourly bucket to midnight and some to
 * the session open, some read the bucket as it stood and some read its final
 * values. This is the one fold, with the three readings named:
 *
 * - `offset: 0` (the default) reads the bucket **as it stood at that bar**:
 *   its open so far, high and low so far, the bar's own close, volume so far.
 *   It is what the live bar sees and it never uses a later bar.
 * - `offset: k` reads the bucket that completed `k` buckets before, held
 *   constant across the current one. The classic non-repainting reference,
 *   `close[1]` on the higher timeframe.
 * - `lookahead: true` reads the current bucket's **final** values on every one
 *   of its bars. It uses bars that had not happened yet, which is what the
 *   source it is porting did; it is here so that can be reproduced, not
 *   recommended.
 *
 * Buckets follow the chart's calendar: a day is a day in `timezone`, a week
 * starts on Monday there, and a sub-day interval is anchored to the epoch, or
 * to the session open when `session` is given, which is how an exchange cuts
 * its hourly bars.
 */
import {
  DEFAULT_TIMEZONE,
  IndicatorInputError,
  bucketStartOf,
  parseSessionSpec,
  resolveInterval,
  startOfZonedDay,
  zonedDayIndex,
  zonedWeekIndex,
  type Bar,
  type Bucketing,
} from 'openalgo-charts';

export interface SecurityOptions {
  /** The calendar the buckets are cut in. Defaults to the shipped default zone. */
  timezone?: string;
  /** Read each bucket's final values on all of its bars. Default false. */
  lookahead?: boolean;
  /** Read the bucket completed this many buckets ago. Default 0, the current one. */
  offset?: number;
  /**
   * A session window, `'0915-1530'`, that anchors sub-day buckets to the
   * session open instead of the epoch. Without it a 30-minute bucket on a
   * 09:15 open runs 09:00 to 09:30; with it, 09:15 to 09:45.
   */
  session?: string;
}

export interface SecuritySeries {
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
  /** Null on a bucket none of whose bars carried volume. */
  volume: (number | null)[];
  /** Time of the first source bar in the bucket being read, UTC seconds. */
  bucketStart: (number | null)[];
  /** True on the first source bar of each bucket. */
  isNew: boolean[];
}

interface Bucket {
  start: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

const WEEK = 604800;
const DAY = 86400;

/** The bucket a bar belongs to, as a number equal for every bar in it. */
function keyOf(b: Bucketing, time: number, zone: string, sessionStart: number | null): number {
  if (b.mode === 'calendar') return bucketStartOf(b, time, zone);
  if (b.mode !== 'interval') return time; // unreachable: refused before the loop
  const s = b.seconds;
  if (s % WEEK === 0) return Math.floor(zonedWeekIndex(time, zone) / (s / WEEK));
  if (s % DAY === 0) return Math.floor(zonedDayIndex(time, zone) / (s / DAY));
  if (sessionStart === null) return bucketStartOf(b, time);
  // Anchored to this day's session open. The day index keeps two days' buckets
  // apart, which a per-day floor alone would not.
  const anchor = startOfZonedDay(time, zone) + sessionStart * 60;
  return zonedDayIndex(time, zone) * 1e6 + Math.floor((time - anchor) / s);
}

const finite = (v: number): boolean => Number.isFinite(v);

export function securitySeries(
  bars: readonly Bar[],
  interval: string,
  options: SecurityOptions = {},
): SecuritySeries {
  const zone = options.timezone ?? DEFAULT_TIMEZONE;
  const offset = Math.floor(options.offset ?? 0);
  if (!Number.isFinite(offset) || offset < 0) {
    throw new IndicatorInputError('securitySeries: offset must be zero or a positive count of buckets');
  }
  const lookahead = options.lookahead === true;
  const { bucketing } = resolveInterval(interval);
  if (bucketing.mode === 'ticks' || bucketing.mode === 'volume') {
    throw new IndicatorInputError(
      `securitySeries: "${interval}" closes on trade flow rather than the clock and cannot be folded from time bars`,
    );
  }
  let sessionStart: number | null = null;
  if (options.session !== undefined) {
    const spec = parseSessionSpec(options.session);
    if (spec === null) throw new IndicatorInputError(`securitySeries: cannot read session "${options.session}"`);
    sessionStart = spec.start;
  }

  const n = bars.length;
  const open = new Array<number | null>(n).fill(null);
  const high = new Array<number | null>(n).fill(null);
  const low = new Array<number | null>(n).fill(null);
  const close = new Array<number | null>(n).fill(null);
  const volume = new Array<number | null>(n).fill(null);
  const bucketStart = new Array<number | null>(n).fill(null);
  const isNew = new Array<boolean>(n).fill(false);
  if (n === 0) return { open, high, low, close, volume, bucketStart, isNew };

  // One pass groups the bars, which are time-sorted, into contiguous buckets
  // and folds each bucket's final values. A second pass reads them out.
  const buckets: Bucket[] = [];
  const of = new Array<number>(n);
  let prevKey = NaN;
  for (let i = 0; i < n; i++) {
    const bar = bars[i];
    const key = keyOf(bucketing, bar.time, zone, sessionStart);
    if (i === 0 || key !== prevKey) {
      buckets.push({
        start: bar.time,
        open: bar.open, high: bar.high, low: bar.low, close: bar.close,
        volume: bar.volume === undefined ? null : bar.volume,
      });
      isNew[i] = true;
    } else {
      const k = buckets[buckets.length - 1];
      if (!finite(k.open) && finite(bar.open)) k.open = bar.open;
      if (finite(bar.high) && (!finite(k.high) || bar.high > k.high)) k.high = bar.high;
      if (finite(bar.low) && (!finite(k.low) || bar.low < k.low)) k.low = bar.low;
      if (finite(bar.close)) k.close = bar.close;
      if (bar.volume !== undefined) k.volume = (k.volume ?? 0) + bar.volume;
    }
    of[i] = buckets.length - 1;
    prevKey = key;
  }

  let runHigh = NaN;
  let runLow = NaN;
  let runVolume: number | null = null;
  for (let i = 0; i < n; i++) {
    const bar = bars[i];
    const bi = of[i];
    if (offset > 0) {
      const src = bi - offset;
      if (src < 0) continue;
      const k = buckets[src];
      open[i] = k.open; high[i] = k.high; low[i] = k.low; close[i] = k.close;
      volume[i] = k.volume; bucketStart[i] = k.start;
      continue;
    }
    const k = buckets[bi];
    bucketStart[i] = k.start;
    if (lookahead) {
      open[i] = k.open; high[i] = k.high; low[i] = k.low; close[i] = k.close; volume[i] = k.volume;
      continue;
    }
    if (isNew[i]) {
      runHigh = bar.high; runLow = bar.low;
      runVolume = bar.volume === undefined ? null : bar.volume;
    } else {
      if (finite(bar.high) && (!finite(runHigh) || bar.high > runHigh)) runHigh = bar.high;
      if (finite(bar.low) && (!finite(runLow) || bar.low < runLow)) runLow = bar.low;
      if (bar.volume !== undefined) runVolume = (runVolume ?? 0) + bar.volume;
    }
    open[i] = k.open;
    high[i] = finite(runHigh) ? runHigh : null;
    low[i] = finite(runLow) ? runLow : null;
    close[i] = finite(bar.close) ? bar.close : null;
    volume[i] = runVolume;
  }
  return { open, high, low, close, volume, bucketStart, isNew };
}
