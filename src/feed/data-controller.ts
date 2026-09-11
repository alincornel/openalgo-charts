import type { Bar } from '../model/bar';
import type { BarsRequest, DataFeed, UnsubscribeFn } from './types';
import { type HistoryRequestPool, sharedHistoryRequests, withHistoryDeadline } from './request-pool';

export type DataLoadingStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'refreshing' | 'stale' | 'error';
export type HistoryLoadingStatus = 'idle' | 'loading' | 'error' | 'exhausted' | 'limited';
export type DataUpdateReason = 'load' | 'cache' | 'live' | 'refresh' | 'prepend' | 'resume' | 'state';

/** Display bars are held still while paused; bars() retains the live store. */
export interface DataLoadingSnapshot {
  readonly request: Readonly<BarsRequest> | null;
  readonly bars: readonly Bar[];
  readonly status: DataLoadingStatus;
  readonly historyStatus: HistoryLoadingStatus;
  readonly hasMore: boolean | null;
  readonly error?: Error;
  readonly historyError?: Error;
  readonly reason: DataUpdateReason;
  readonly paused: boolean;
}

export interface DataLoadingOptions {
  requestPool?: HistoryRequestPool;
  timeoutMs?: number;
  pageSize?: number;
  /** Date-window fallback for feeds without getBarsPage. Defaults to the load window. */
  pageWindowSec?: number;
  /** Empty windows inspected per gesture, without claiming permanent exhaustion. */
  maxEmptyPages?: number;
  maxBars?: number;
  /** Optional history repair cadence. Zero disables polling. */
  pollIntervalMs?: number;
  /** UTC seconds. */
  now?: () => number;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error ?? 'History request failed'));
}
function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive and finite`);
  return value;
}
function normalize(bars: readonly Bar[]): Bar[] {
  const result = new Map<number, Bar>();
  for (const bar of bars) {
    if (![bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)
      || bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close)
      || (bar.volume !== undefined && (!Number.isFinite(bar.volume) || bar.volume < 0))) {
      throw new Error('History contains an invalid candle');
    }
    result.set(bar.time, { ...bar });
  }
  return [...result.values()].sort((a, b) => a.time - b.time);
}
function merge(...parts: readonly (readonly Bar[])[]): Bar[] {
  return normalize(parts.flat());
}

/**
 * Owns history, paging and live updates for one current instrument. Consumers
 * decide how to paint snapshots; no canvas, DOM or broker execution is owned here.
 */
export class DataLoadingController {
  private readonly _feed: DataFeed;
  private readonly _pool: HistoryRequestPool;
  private readonly _options: DataLoadingOptions;
  private readonly _listeners = new Set<(snapshot: DataLoadingSnapshot) => void>();
  private _state: DataLoadingSnapshot = { request: null, bars: [], status: 'idle', historyStatus: 'idle', hasMore: null, reason: 'state', paused: false };
  private _bars: Bar[] = [];
  private _scope = new AbortController();
  private _refreshAbort: AbortController | null = null;
  private _pageAbort: AbortController | null = null;
  private _loadWork: Promise<readonly Bar[]> | null = null;
  private _pageWork: Promise<readonly Bar[]> | null = null;
  private _unsubscribe: UnsubscribeFn | null = null;
  private _stream = 0;
  private _generation = 0;
  private _refreshId = 0;
  private _before: number | undefined;
  private _buffer: Map<number, Bar> | null = null;
  private _poll: ReturnType<typeof setTimeout> | null = null;
  private _visible = true;
  private _destroyed = false;

  public constructor(feed: DataFeed, options: DataLoadingOptions = {}) {
    this._feed = feed;
    this._pool = options.requestPool ?? sharedHistoryRequests(feed);
    this._options = { pageSize: 500, maxEmptyPages: 4, maxBars: 100_000, pollIntervalMs: 0, ...options };
    for (const key of ['pageSize', 'maxEmptyPages', 'maxBars'] as const) {
      const value = positive(this._options[key]!, key);
      if (!Number.isInteger(value)) throw new RangeError(`${key} must be an integer`);
    }
    if (options.pageWindowSec !== undefined) positive(options.pageWindowSec, 'pageWindowSec');
    if (options.timeoutMs !== undefined) positive(options.timeoutMs, 'timeoutMs');
    if (!Number.isFinite(this._options.pollIntervalMs) || this._options.pollIntervalMs! < 0) throw new RangeError('pollIntervalMs must be nonnegative');
  }

  public getState(): DataLoadingSnapshot { return this._state; }
  public bars(): readonly Bar[] { return this._bars; }
  public subscribe(listener: (snapshot: DataLoadingSnapshot) => void): UnsubscribeFn {
    if (this._destroyed) return () => {};
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  public load(req: BarsRequest): Promise<readonly Bar[]> {
    if (this._destroyed) return Promise.resolve([]);
    const generation = ++this._generation;
    this._cancel();
    if (!this._current(generation)) return this._loadWork ?? Promise.resolve(this._bars);
    this._scope = new AbortController();
    this._bars = [];
    this._before = undefined;
    const request = { ...req, signal: undefined, timeoutMs: req.timeoutMs ?? this._options.timeoutMs };
    this._state = { request, bars: [], status: 'loading', historyStatus: 'idle', hasMore: null, reason: 'load', paused: false };
    let complete!: (bars: readonly Bar[]) => void;
    const work = new Promise<readonly Bar[]>(resolve => { complete = resolve; });
    this._loadWork = work;
    this._publish('load');
    void this._load(request, req.signal, generation).then(complete);
    void work.then(() => { if (this._loadWork === work) this._loadWork = null; });
    return work;
  }

  private async _load(req: BarsRequest, callerSignal: AbortSignal | undefined, generation: number): Promise<readonly Bar[]> {
    if (!this._current(generation)) return this._bars;
    const scope = this._scope;
    const abort = (): void => scope.abort();
    callerSignal?.addEventListener('abort', abort, { once: true });
    if (callerSignal?.aborted) scope.abort();
    try {
      let cached: Bar[] | undefined;
      if (!req.noCache && this._feed.getCachedBars) {
        try {
          const snapshot = await withHistoryDeadline({ signal: scope.signal, timeoutMs: Math.min(req.timeoutMs ?? 500, 500) },
            signal => this._feed.getCachedBars!({ ...req, signal }));
          cached = snapshot ? normalize(snapshot) : undefined;
        } catch { /* A cache failure cannot prevent authoritative history loading. */ }
      }
      if (!this._current(generation)) return this._bars;
      if (scope.signal.aborted) throw scope.signal.reason;
      if (cached?.length) {
        this._bars = cached;
        this._publish('cache', { status: 'refreshing' });
      }
      const from = cached?.length && req.from !== undefined && cached[0].time <= req.from
        ? Math.max(req.from, cached[Math.max(0, cached.length - 2)].time) : req.from;
      const fresh = await this._pool.getBars({ ...req, from, signal: scope.signal, noCache: req.noCache || !!this._feed.getCachedBars }, 10);
      if (!this._current(generation)) return this._bars;
      this._bars = this._replaceWindow(normalize(fresh), from, req.to);
      this._limit();
      this._before = this._bars[0]?.time ?? req.from;
      this._publish('load', { status: this._bars.length ? 'ready' : 'empty', error: undefined });
      this._startStream(generation);
      if (this._current(generation)) this._schedulePoll();
    } catch (error) {
      if (this._current(generation)) this._publish('state', {
        status: scope.signal.aborted ? 'idle' : this._bars.length ? 'stale' : 'error',
        error: scope.signal.aborted ? undefined : asError(error),
      });
    } finally { callerSignal?.removeEventListener('abort', abort); }
    return this._bars;
  }

  public async refresh(): Promise<readonly Bar[]> {
    if (this._destroyed || !this._state.request) return this._bars;
    if (this._loadWork) return this._loadWork;
    const generation = this._generation;
    const id = ++this._refreshId;
    const previous = this._refreshAbort;
    this._refreshAbort = null;
    previous?.abort();
    if (!this._current(generation) || id !== this._refreshId) return this._bars;
    const abort = new AbortController();
    this._refreshAbort = abort;
    this._clearPoll();
    this._buffer ??= new Map();
    const original = this._state.request;
    const to = Math.max(original.to ?? 0, (this._options.now ?? (() => Date.now() / 1000))());
    const width = original.from !== undefined && original.to !== undefined ? original.to - original.from : undefined;
    const from = width === undefined ? original.from : to - width;
    this._publish('state', { status: 'refreshing', error: undefined });
    try {
      const fresh = await this._pool.getBars({ ...original, from, to, noCache: true, signal: abort.signal }, 5);
      if (!this._current(generation) || id !== this._refreshId) return this._bars;
      if (fresh.length === 0 && this._bars.length) throw new Error('History refresh returned no bars');
      const updated = this._replaceWindow(normalize(fresh), from, to);
      const byTime = new Map(updated.map(bar => [bar.time, bar]));
      for (const live of this._buffer?.values() ?? []) {
        const historical = byTime.get(live.time);
        // Whole-bar observations cannot reveal their overlap with a REST snapshot.
        // Preserve observed live extrema/close without adding the volumes twice.
        byTime.set(live.time, historical ? { ...historical,
          high: Math.max(historical.high, live.high), low: Math.min(historical.low, live.low), close: live.close,
          volume: historical.volume === undefined && live.volume === undefined ? undefined : Math.max(historical.volume ?? 0, live.volume ?? 0),
        } : live);
      }
      this._bars = normalize([...byTime.values()]);
      this._buffer = null;
      this._limit();
      this._publish('refresh', { status: this._bars.length ? 'ready' : 'empty', error: undefined });
      this._startStream(generation);
    } catch (error) {
      if (!this._current(generation) || id !== this._refreshId || abort.signal.aborted) return this._bars;
      // Retain buffered observations through failed repair and retry. The last
      // authoritative display stays visible and explicitly stale in the meantime.
      this._limit();
      this._publish('refresh', { status: this._bars.length ? 'stale' : 'error', error: asError(error) });
    } finally {
      if (this._current(generation) && id === this._refreshId) {
        this._refreshAbort = null;
        this._schedulePoll();
      }
    }
    return this._bars;
  }

  /** Supply bars from an existing host subscription instead of subscribing twice. */
  public pushBar(value: Bar): void {
    if (this._destroyed || !this._state.request) return;
    let bar: Bar;
    try { bar = normalize([value])[0]; } catch (error) {
      this._publish('state', { status: this._bars.length ? 'stale' : 'error', error: asError(error) });
      return;
    }
    const tail = this._bars[this._bars.length - 1];
    if (tail && bar.time < tail.time) return;
    if (this._buffer) {
      this._buffer.set(bar.time, bar);
      while (this._buffer.size > this._options.maxBars!) this._buffer.delete(this._buffer.keys().next().value!);
    }
    const next = this._bars.slice();
    if (tail?.time === bar.time) next[next.length - 1] = { ...bar, volume: bar.volume ?? tail.volume };
    else next.push(bar);
    this._bars = next;
    this._limit();
    if (this._buffer) return;
    this._publish('live', { status: this._state.status === 'stale' ? 'stale' : 'ready' });
  }

  public loadMore(): Promise<readonly Bar[]> {
    if (this._pageWork) return this._pageWork;
    if (this._destroyed || !this._state.request || this._loadWork || this._state.paused || this._state.hasMore === false) return Promise.resolve(this._bars);
    if (this._bars.length >= this._options.maxBars!) {
      this._publish('state', { historyStatus: 'limited' });
      return Promise.resolve(this._bars);
    }
    const generation = this._generation;
    let complete!: (bars: readonly Bar[]) => void;
    const work = new Promise<readonly Bar[]>(resolve => { complete = resolve; });
    this._pageWork = work;
    void this._loadMore(generation).then(complete);
    void work.then(() => { if (this._pageWork === work) this._pageWork = null; });
    return work;
  }

  private async _loadMore(generation: number): Promise<readonly Bar[]> {
    const req = this._state.request!;
    const window = this._options.pageWindowSec ?? Math.max(1, (req.to ?? 0) - (req.from ?? 0) || 86400);
    const abort = new AbortController();
    this._pageAbort = abort;
    this._publish('state', { historyStatus: 'loading', historyError: undefined });
    try {
      for (let attempt = 0; attempt < this._options.maxEmptyPages!; attempt++) {
        const before = this._before ?? this._bars[0]?.time ?? req.from;
        if (before === undefined) throw new Error('Older history needs a starting time');
        const request = { ...req, from: before - window, to: before - 0.000001, before,
          countBack: this._options.pageSize!, signal: abort.signal };
        const page = this._feed.getBarsPage ? await this._pool.getBarsPage(request)
          : { bars: await this._pool.getBars(request), hasMore: undefined, nextBefore: undefined };
        if (!this._current(generation) || abort.signal.aborted) return this._bars;
        const older = normalize(page.bars).filter(bar => bar.time < before);
        const cursor = page.nextBefore ?? older[0]?.time ?? before - window;
        if (!Number.isFinite(cursor) || cursor >= before) throw new Error('History page did not advance its cursor');
        this._before = cursor;
        if (older.length) {
          const retained = new Set(this._bars.map(bar => bar.time));
          const additions = older.filter(bar => !retained.has(bar.time));
          const room = Math.max(0, this._options.maxBars! - this._bars.length);
          this._bars = merge(room ? additions.slice(-room) : [], this._bars);
          const limited = additions.length > room || this._bars.length >= this._options.maxBars!;
          // Retention is a local limit, not evidence of provider exhaustion.
          this._publish('prepend', { hasMore: additions.length > room ? true : page.hasMore ?? null,
            historyStatus: limited ? 'limited' : page.hasMore === false ? 'exhausted' : 'idle' });
          return this._bars;
        }
        if (page.hasMore === false) { this._publish('state', { hasMore: false, historyStatus: 'exhausted' }); return this._bars; }
      }
      this._publish('state', { hasMore: null, historyStatus: 'idle' });
    } catch (error) {
      if (this._current(generation) && !abort.signal.aborted) this._publish('state', { historyStatus: 'error', historyError: asError(error) });
    } finally { if (this._pageAbort === abort) this._pageAbort = null; }
    return this._bars;
  }

  public setPaused(paused: boolean): void {
    if (this._destroyed || paused === this._state.paused) return;
    this._state = { ...this._state, paused };
    this._publish(paused ? 'state' : 'resume');
  }

  public setVisible(visible: boolean): void {
    if (this._destroyed || visible === this._visible) return;
    this._visible = visible;
    if (!visible) this._clearPoll();
    else void this.refresh();
  }

  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._generation++;
    this._cancel();
    this._listeners.clear();
  }

  private _current(generation: number): boolean { return !this._destroyed && generation === this._generation; }
  private _replaceWindow(fresh: Bar[], from?: number, to?: number): Bar[] {
    if (from === undefined || to === undefined) return fresh;
    return merge(this._bars.filter(bar => bar.time < from || bar.time > to), fresh);
  }
  private _limit(): void {
    if (this._bars.length > this._options.maxBars!) this._bars = this._bars.slice(-this._options.maxBars!);
  }
  private _publish(reason: DataUpdateReason, patch: Partial<DataLoadingSnapshot> = {}): void {
    if (this._destroyed) return;
    this._state = { ...this._state, ...patch, reason, bars: this._state.paused || this._buffer ? this._state.bars : this._bars };
    const snapshot = this._state;
    for (const listener of [...this._listeners]) {
      if (this._destroyed || this._state !== snapshot) break;
      try { listener(snapshot); } catch { /* One host listener cannot stop data ownership or cleanup. */ }
    }
  }
  private _startStream(generation: number): void {
    if (!this._current(generation)) return;
    const previousId = this._stream;
    const stream = ++this._stream;
    const previous = this._unsubscribe;
    this._unsubscribe = null;
    if (!this._feed.subscribeBars) { this._release(previous); return; }
    try {
      const unsubscribe = this._feed.subscribeBars(this._state.request!, bar => {
        if (this._current(generation) && stream === this._stream) this.pushBar(bar);
      }, { seedFrom: this._bars[this._bars.length - 1], onResync: () => {
        if (this._current(generation) && stream === this._stream) void this.refresh();
      } });
      if (this._current(generation) && stream === this._stream) this._unsubscribe = unsubscribe;
      else this._release(unsubscribe);
      // Acquire before releasing so ref-counted feeds retain the underlying topic.
      this._release(previous);
    } catch (error) {
      if (this._current(generation) && stream === this._stream) {
        this._stream = previousId;
        this._unsubscribe = previous;
        this._buffer ??= new Map();
        this._publish('state', { status: this._bars.length ? 'stale' : 'error', error: asError(error) });
      } else this._release(previous);
    }
  }
  private _release(unsubscribe: UnsubscribeFn | null): void {
    try { unsubscribe?.(); } catch { /* A provider cleanup cannot block the remaining owned resources. */ }
  }
  private _clearPoll(): void { if (this._poll !== null) clearTimeout(this._poll); this._poll = null; }
  private _schedulePoll(): void {
    this._clearPoll();
    if (!this._destroyed && this._visible && this._options.pollIntervalMs! > 0) {
      this._poll = setTimeout(() => { this._poll = null; void this.refresh(); }, this._options.pollIntervalMs);
    }
  }
  private _cancel(): void {
    const scope = this._scope;
    const refresh = this._refreshAbort;
    const page = this._pageAbort;
    const unsubscribe = this._unsubscribe;
    // Detach ownership before callbacks: a provider may synchronously open the
    // next context from an abort or unsubscribe handler.
    this._refreshAbort = null;
    this._pageAbort = null;
    this._loadWork = null;
    this._pageWork = null;
    this._buffer = null;
    this._stream++;
    this._unsubscribe = null;
    this._clearPoll();
    scope.abort();
    refresh?.abort();
    page?.abort();
    this._release(unsubscribe);
  }
}
