/**
 * Tier-2 contract — indicators whose data is **not** derived from the chart's
 * OHLCV: open interest, cumulative volume delta, PCR, an external analytics
 * feed. Where a Tier-1 descriptor is a pure `calc(bars, settings)`, a Tier-2
 * descriptor owns a fetch / subscribe / merge lifecycle and its own series.
 *
 * `createTier2Indicator` wraps that lifecycle into an ordinary
 * `IndicatorDescriptor`, so the chart runtime, the settings model, panes,
 * levels, and removal all work identically — there is no second runtime.
 *
 * The alignment rule is deliberate and worth knowing: external points carry
 * their own timestamps, which rarely match bar times. Each bar takes the most
 * recent external point **at or before** that bar's time (last-known-value,
 * never interpolated and never forward-looking), and bars before the first
 * point are `null`.
 */
import type {
  Bar,
  ChartDataContext,
  IndicatorDataStatus,
  IndicatorDescriptor,
  IndicatorPlot,
  IndicatorInput,
  IndicatorLevel,
  IndicatorSettings,
  IndicatorValues,
} from 'openalgo-charts';

/** One external observation: a timestamp plus a value per plot key. */
export interface Tier2Point {
  /** UTC seconds. */
  time: number;
  values: Readonly<Record<string, number | null>>;
}

export interface Tier2Context {
  /** Host identity when supplied. Indicator settings remain independent. */
  dataContext?: Readonly<ChartDataContext>;
  /** Cancelled when this request is obsolete or the instance is removed. */
  signal?: AbortSignal;
  settings: Readonly<IndicatorSettings>;
  /** The chart's current source bars — use for the requested time window. */
  bars: readonly Bar[];
  /** UTC seconds of the first and last source bar (0 when there are none). */
  from: number;
  to: number;
}

export interface Tier2Descriptor {
  id: string;
  name: string;
  category?: string;
  placement: 'onchart' | 'pane';
  inputs: readonly IndicatorInput[];
  plots: readonly IndicatorPlot[];
  /** A host/provider can explicitly decline data it cannot supply. */
  supports?(ctx: Tier2Context): boolean;
  /** Load the series for the current window. */
  fetch(ctx: Tier2Context): Promise<readonly Tier2Point[]>;
  /**
   * Optional live subscription. Call `push` with each incoming point; return an
   * unsubscribe function.
   */
  subscribe?(ctx: Tier2Context, push: (point: Tier2Point) => void): () => void;
  /**
   * Settings keys that invalidate the fetched data when they change (symbol,
   * exchange, resolution). Changing anything else only re-runs alignment.
   */
  refetchOn?: readonly string[];
  levels?(settings: Readonly<IndicatorSettings>): readonly IndicatorLevel[];
  range?(settings: Readonly<IndicatorSettings>): { min: number; max: number } | null;
}

interface Tier2Request {
  promise: Promise<readonly Tier2Point[]>;
  controller: AbortController;
  from: number;
  to: number;
  extend: boolean;
}

interface Tier2State {
  key: string | null;
  points: Tier2Point[];
  live: Tier2Point[];
  loaded: boolean;
  from: number;
  to: number;
  status: IndicatorDataStatus;
  request: Tier2Request | null;
  unsubscribe: (() => void) | null;
  generation: number;
}

const STATE = '__tier2';

const stateOf = (store: Record<string, unknown>): Tier2State | undefined =>
  store[STATE] as Tier2State | undefined;

/** Cache key from the settings that invalidate data. */
function cacheKey(d: Tier2Descriptor, settings: Readonly<IndicatorSettings>): string {
  const keys = d.refetchOn ?? [];
  return keys.map((k) => `${k}=${String(settings[k])}`).join('&');
}

/** Upsert a point by time, keeping the series time-sorted. */
function upsert(points: Tier2Point[], point: Tier2Point): void {
  const last = points[points.length - 1];
  if (last === undefined || point.time > last.time) { points.push(point); return; }
  if (point.time === last.time) { points[points.length - 1] = point; return; }
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time < point.time) lo = mid + 1;
    else hi = mid;
  }
  if (points[lo]?.time === point.time) points[lo] = point;
  else points.splice(lo, 0, point);
}

/**
 * Project time-stamped external points onto the bar timeline: each bar reads
 * the latest point at or before it. Both arrays are time-sorted, so this is a
 * single linear merge, not a per-bar search.
 */
function align(
  bars: readonly Bar[],
  points: readonly Tier2Point[],
  plots: readonly IndicatorPlot[],
): IndicatorValues {
  const out: Record<string, (number | null)[]> = {};
  for (const plot of plots) out[plot.key] = new Array<number | null>(bars.length).fill(null);
  if (points.length === 0) return out;
  let p = -1;
  for (let i = 0; i < bars.length; i++) {
    while (p + 1 < points.length && points[p + 1].time <= bars[i].time) p += 1;
    if (p < 0) continue;
    const values = points[p].values;
    for (const plot of plots) {
      const v = values[plot.key];
      out[plot.key][i] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
  }
  return out;
}

/**
 * Wrap a Tier-2 descriptor as a normal `IndicatorDescriptor`.
 *
 * ```ts
 * export const OPEN_INTEREST = createTier2Indicator({
 *   id: 'open-interest', name: 'Open Interest', placement: 'pane',
 *   inputs: [{ key: 'symbol', type: 'text', label: 'Symbol', default: '' }],
 *   plots: [{ key: 'oi', type: 'line', title: 'OI' }],
 *   refetchOn: ['symbol'],
 *   fetch: async ({ settings, from, to }) => loadOi(settings.symbol, from, to),
 * });
 * registerIndicator(OPEN_INTEREST);
 * ```
 */
export function createTier2Indicator(d: Tier2Descriptor): IndicatorDescriptor {
  return {
    id: d.id,
    name: d.name,
    category: d.category,
    placement: d.placement,
    inputs: d.inputs,
    plots: d.plots,
    levels: d.levels,
    range: d.range,

    calc: (bars, _settings, store) => {
      const state = stateOf(store);
      return align(bars, state?.points ?? [], d.plots);
    },

    attach: (ctx) => {
      // A synchronous style reattach inherits pending history and its signal.
      const state: Tier2State = stateOf(ctx.store) ?? {
        key: null, points: [], live: [], loaded: false, from: 0, to: 0,
        status: { state: 'empty' }, request: null, unsubscribe: null, generation: 0,
      };
      ctx.store[STATE] = state;
      let generation = ++state.generation;
      let active = true;
      let observed: Tier2Request | null = null;
      let unsubscribeChanges: () => void = () => {};
      state.unsubscribe?.();
      state.unsubscribe = null;

      const current = (): boolean => active && state.generation === generation && !ctx.signal?.aborted;
      const publish = (status: IndicatorDataStatus): void => {
        state.status = status;
        if (current()) ctx.setDataStatus?.(status);
      };
      const context = (): Tier2Context => {
        const bars = ctx.bars();
        const market = ctx.dataContext?.() ?? {
          symbol: ctx.symbol?.(), interval: ctx.interval?.(),
        };
        return {
          settings: ctx.settings(), bars,
          dataContext: { ...market },
          from: bars[0]?.time ?? 0, to: bars[bars.length - 1]?.time ?? 0,
        };
      };
      const cancel = (): void => {
        state.request?.controller.abort();
        state.request = null;
        observed = null;
      };
      const stopLive = (): void => {
        state.unsubscribe?.();
        state.unsubscribe = null;
      };
      const observe = (request: Tier2Request): void => {
        if (observed === request) return;
        observed = request;
        void request.promise.then((points) => {
          if (!current() || state.request !== request || request.controller.signal.aborted) return;
          state.request = null;
          observed = null;
          const prepend = request.extend && request.from < state.from;
          const merged: Tier2Point[] = request.extend && !prepend ? state.points.slice() : [];
          for (const point of points.slice().sort((a, b) => a.time - b.time)) {
            if (Number.isFinite(point.time)) upsert(merged, point);
          }
          // An older page must not overwrite the already loaded boundary or live tail.
          if (prepend) for (const point of state.points) upsert(merged, point);
          for (const point of state.live) upsert(merged, point);
          state.points = merged;
          state.from = state.loaded ? Math.min(state.from, request.from) : request.from;
          state.to = state.loaded ? Math.max(state.to, request.to) : request.to;
          state.loaded = true;
          publish({ state: merged.length > 0 ? 'ready' : 'empty' });
          ctx.requestRecompute();
          refresh();
        }, (error: unknown) => {
          if (!current() || state.request !== request || request.controller.signal.aborted) return;
          state.request = null;
          observed = null;
          publish({ state: 'error', error });
        });
      };
      const load = (c: Tier2Context, from: number, to: number, extend: boolean): void => {
        const controller = new AbortController();
        publish({ state: 'loading' });
        let promise: Promise<readonly Tier2Point[]>;
        try { promise = d.fetch({ ...c, from, to, signal: controller.signal }); }
        catch (error) { publish({ state: 'error', error }); return; }
        const request: Tier2Request = { promise, controller, from, to, extend };
        state.request = request;
        observe(request);
      };
      const refresh = (retry = false): void => {
        if (!current()) return;
        const c = context();
        const market = c.dataContext;
        const key = JSON.stringify([cacheKey(d, c.settings), market?.symbol, market?.exchange, market?.interval]);
        const changed = key !== state.key;
        if (changed) {
          // Invalidate before stopping providers, whose cleanup can call back synchronously.
          generation = ++state.generation;
          stopLive();
          cancel();
          state.key = key;
          state.loaded = false;
          state.live = [];
          state.status = { state: 'empty' };
          if (state.points.length > 0) {
            state.points = [];
            ctx.requestRecompute();
          }
        }
        let supported: boolean;
        try { supported = d.supports?.(c) ?? true; }
        catch (error) { publish({ state: 'error', error }); return; }
        if (!supported) {
          generation = ++state.generation;
          stopLive();
          cancel();
          state.loaded = false;
          state.live = [];
          if (state.points.length > 0) { state.points = []; ctx.requestRecompute(); }
          publish({ state: 'unsupported' });
          return;
        }
        if (c.bars.length === 0) {
          // Replay may temporarily hide every bar. Retain same-source history.
          if (state.request === null) publish({ state: 'empty' });
          return;
        }
        if (state.request !== null) observe(state.request);
        else if (retry || changed || state.status.state !== 'error') {
          if (!state.loaded || retry) load(c, c.from, c.to, false);
          else if (c.from < state.from) load(c, c.from, state.from, true);
          else if (d.subscribe === undefined && c.to > state.to) load(c, state.to, c.to, true);
          else publish({ state: state.points.length > 0 ? 'ready' : 'empty' });
        }
        if (state.unsubscribe === null && d.subscribe !== undefined) {
          const liveGeneration = generation;
          try {
            state.unsubscribe = d.subscribe(c, (point) => {
              if (!current() || generation !== liveGeneration || !Number.isFinite(point.time)) return;
              upsert(state.live, point);
              upsert(state.points, point);
              if (state.request === null && state.status.state !== 'error') publish({ state: 'ready' });
              ctx.requestRecompute();
            });
          } catch (error) { publish({ state: 'error', error }); }
        }
      };
      const cleanup = (): void => {
        if (!current() && !active) return;
        active = false;
        unsubscribeChanges();
        ctx.signal?.removeEventListener('abort', abort);
        if (state.generation !== generation) return;
        state.generation += 1;
        stopLive();
        ctx.setDataRetry?.(null);
        // Hand-built contexts have no lifetime signal. Allow synchronous style
        // reattachment before aborting history that no attachment still owns.
        const detached = state.generation;
        queueMicrotask(() => { if (state.generation === detached) cancel(); });
      };
      const abort = (): void => { cancel(); cleanup(); };
      ctx.signal?.addEventListener('abort', abort, { once: true });
      unsubscribeChanges = ctx.subscribeDataChanges?.(() => refresh()) ?? (() => {});
      ctx.setDataRetry?.(() => refresh(true));
      ctx.setDataStatus?.(state.status);
      refresh(state.status.state === 'error');
      return cleanup;
    },
  };
}
