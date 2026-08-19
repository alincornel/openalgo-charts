/**
 * Time conversions (ARCHITECTURE.md §4.0). Internal time is always UTC seconds.
 * Feed adapters convert broker formats here, at the edge:
 *   - REST history → IST date/time strings
 *   - WS feed      → epoch milliseconds
 * India observes no DST, so IST is a fixed UTC+5:30 offset.
 */

/** IST offset in seconds (UTC+5:30). */
export const IST_OFFSET_SECONDS = 5 * 3600 + 30 * 60;

/** Epoch milliseconds → UTC seconds. */
export function epochMsToUtcSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/**
 * Parse an IST wall-clock date/time string to UTC seconds. Accepts
 * `YYYY-MM-DD`, `YYYY-MM-DD HH:MM[:SS]`, and the `T`-separated ISO variant.
 * Parsing is explicit (never relies on the host machine's locale/timezone).
 */
export function istStringToUtcSeconds(input: string): number {
  const s = input.trim();
  const dt = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (dt === null) {
    throw new Error(`openalgo-charts: unparseable IST time string "${input}"`);
  }
  const year = Number(dt[1]);
  const month = Number(dt[2]);
  const day = Number(dt[3]);
  const hour = dt[4] !== undefined ? Number(dt[4]) : 0;
  const min = dt[5] !== undefined ? Number(dt[5]) : 0;
  const sec = dt[6] !== undefined ? Number(dt[6]) : 0;
  // Treat the components as IST wall-clock, then subtract the offset to get UTC.
  const asUtcMs = Date.UTC(year, month - 1, day, hour, min, sec);
  return Math.floor(asUtcMs / 1000) - IST_OFFSET_SECONDS;
}

export interface IstParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday .. 6 = Saturday, in IST. */
  weekday: number;
}

/** UTC seconds → IST calendar parts (for axis labels / tick decisions). */
export function utcSecondsToIstParts(utcSeconds: number): IstParts {
  const d = new Date((utcSeconds + IST_OFFSET_SECONDS) * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
  };
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** Format UTC seconds as an IST `HH:MM` clock label. */
export function formatIstTime(utcSeconds: number): string {
  const p = utcSecondsToIstParts(utcSeconds);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Format UTC seconds as an IST `HH:MM:SS` clock label (sub-minute / tick timeframes). */
export function formatIstTimeSeconds(utcSeconds: number): string {
  const p = utcSecondsToIstParts(utcSeconds);
  return `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
}

/** Format UTC seconds as an IST `YYYY-MM-DD` date (for OpenAlgo history requests). */
export function utcSecondsToIstDateString(utcSeconds: number): string {
  const p = utcSecondsToIstParts(utcSeconds);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format UTC seconds as an IST `DD Mon` date label. */
export function formatIstDate(utcSeconds: number): string {
  const p = utcSecondsToIstParts(utcSeconds);
  return `${pad2(p.day)} ${MONTHS[p.month - 1]}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Crosshair time-tag label in IST, matching the reference style:
 * `Wed 21 May '26`, with ` HH:MM` appended for intraday (non-midnight) bars.
 */
export function formatIstCrosshairLabel(utcSeconds: number): string {
  const p = utcSecondsToIstParts(utcSeconds);
  let s = `${WEEKDAYS[p.weekday]} ${pad2(p.day)} ${MONTHS[p.month - 1]} '${String(p.year).slice(-2)}`;
  if (p.hour !== 0 || p.minute !== 0 || p.second !== 0) {
    s += ` ${pad2(p.hour)}:${pad2(p.minute)}`;
    // Sub-minute (seconds / tick) timeframes: append :SS so bars within the
    // same minute are distinguishable.
    if (p.second !== 0) s += `:${pad2(p.second)}`;
  }
  return s;
}

/** True if the two UTC-second instants fall on different IST calendar days. */
export function isNewIstDay(prevUtcSeconds: number, utcSeconds: number): boolean {
  const a = utcSecondsToIstParts(prevUtcSeconds);
  const b = utcSecondsToIstParts(utcSeconds);
  return a.year !== b.year || a.month !== b.month || a.day !== b.day;
}

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86400;

/**
 * Median gap between consecutive timestamps. Median and not mean: a weekend, a
 * holiday or an outage leaves a handful of gaps orders of magnitude wider than
 * the timeframe, and an average would chase them.
 */
function medianGap(times: readonly number[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 0) gaps.push(d);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}

/**
 * Bar indices that open a new trading session, read back from the timestamps.
 *
 * An exchange's overnight break is the widest recurring gap in an intraday
 * series, and it is the only thing in the bars themselves that says where one
 * trading day ends. Reading it back beats assuming a timezone: the same code
 * has to serve an exchange in Mumbai and one in New York, and a fixed midnight
 * lands mid-session for one of them. Getting it wrong splices the tail of one
 * session onto the head of the next across the overnight gap, which inflates
 * that period's high-low range and throws anything measured from it a long way
 * off.
 *
 * Returns null when the series shows no readable session break: a market that
 * never closes, bars already a day or coarser, or a feed whose only gaps are
 * weekends. The caller then falls back to a calendar rule, which is the right
 * answer in exactly those cases.
 */
export function sessionStartIndices(times: readonly number[]): number[] | null {
  const gap = medianGap(times);
  if (gap <= 0 || gap >= DAY_SECONDS) return null;
  // At least four hours and at least four bars: every market that has both a
  // lunch break and an overnight break has the shorter one well under this.
  const threshold = Math.max(4 * gap, 4 * HOUR_SECONDS);
  const starts: number[] = [];
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] >= threshold) starts.push(i);
  }
  if (starts.length === 0) return null;
  // Spot FX breaks only at weekends and clears the same threshold, so its
  // "sessions" would be whole weeks. Accept the reading only when the breaks
  // recur at roughly daily cadence. The trailing partial session is left out:
  // it is short by construction and would drag the median down.
  const opens = [times[0], ...starts.map((i) => times[i])];
  const spans: number[] = [];
  for (let i = 1; i < opens.length; i++) spans.push(opens[i] - opens[i - 1]);
  spans.sort((a, b) => a - b);
  if (spans[spans.length >> 1] > 36 * HOUR_SECONDS) return null;
  return starts;
}

/**
 * Per-bar flags marking the first bar of each trading session.
 *
 * Falls back to the IST calendar day when the series has no readable session
 * break, which is the only answer available for daily bars and a defensible one
 * for a market that never closes.
 */
export function sessionStartFlags(times: readonly number[]): boolean[] {
  const out = new Array<boolean>(times.length).fill(false);
  const starts = sessionStartIndices(times);
  if (starts === null) {
    for (let i = 1; i < times.length; i++) out[i] = isNewIstDay(times[i - 1], times[i]);
    return out;
  }
  for (const i of starts) out[i] = true;
  return out;
}

/**
 * Per-bar flags marking the first bar of each calendar period, where `isNew`
 * decides what "period" means for two instants.
 *
 * The test runs on session opens rather than on every bar, so a session that
 * straddles the boundary is not cut in half: the last ninety minutes of a New
 * York Friday fall on a Saturday in IST, and testing bar to bar would start the
 * next week partway through Friday's session. With no readable sessions the
 * test runs bar to bar, which is the same thing when each bar is its own
 * session.
 */
export function calendarPeriodFlags(
  times: readonly number[],
  isNew: (prevUtcSeconds: number, utcSeconds: number) => boolean,
): boolean[] {
  const out = new Array<boolean>(times.length).fill(false);
  const starts = sessionStartIndices(times);
  if (starts === null) {
    for (let i = 1; i < times.length; i++) out[i] = isNew(times[i - 1], times[i]);
    return out;
  }
  let prevOpen = times[0];
  for (const i of starts) {
    if (isNew(prevOpen, times[i])) out[i] = true;
    prevOpen = times[i];
  }
  return out;
}
