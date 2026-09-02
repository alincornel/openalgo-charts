/**
 * Warm-load bar cache: a wrapper around ANY `DataFeed`, so a custom feed gets
 * the same behaviour as `OpenAlgoDataFeed`.
 *
 *     const feed = withBarCache(new OpenAlgoDataFeed(cfg), { ttlMs: 60_000 });
 *
 * The design decisions, all of which are load-bearing:
 *
 * **Key.** `symbol | exchange | interval`. The requested range is deliberately
 * NOT part of the key: one entry per series holds the widest set fetched so
 * far, and a narrower request is served by slicing it. Keying on the range
 * would miss on every pan and on every "same chart, one bar later" reload,
 * which is exactly the traffic warm-load is meant to remove.
 *
 * **Freshness.** Two independent gates, both of which must pass:
 *   1. `ttlMs` bounds the age of the TAIL, not of the entry. A closed bar is
 *      immutable, so age alone says nothing about it; only the last couple of
 *      bars can still change under us (a late print, a backend heal, a session
 *      rebuild). So the gate fires only for a request that reaches into the
 *      last two bar spans, and an entry past its TTL is kept rather than
 *      deleted — its older bars remain the fastest correct answer available.
 *   2. Nothing new can have closed. An entry is complete through `to`; the next
 *      bar closes at `to + 1 + intervalSec`, measured on the feed's own bar
 *      grid rather than on UTC midnight, so a daily Indian bar opening at 03:45
 *      UTC is judged against its own session, not against the wrong boundary.
 * The effect is what you want from a warm cache: yesterday's closed session
 * stays usable for days, while the live tail is re-read once per TTL.
 *
 * **The forming bar is never cached.** A bar whose close time is still in the
 * future keeps moving, and serving yesterday's snapshot of it to a live chart
 * is worse than not caching at all: the chart would paint a frozen candle and
 * have no way to know. So the trailing forming bar is dropped on store, and
 * coverage ends at the last CLOSED bar. A cache hit can therefore be short by
 * at most one bar, the one a live subscription re-supplies immediately, and is
 * never wrong about a bar it does return.
 *
 * **Bounds.** Capped on both entry count (`max`) and total cached bars
 * (`maxBars`), LRU-evicted. Entries alone do not bound memory (one intraday
 * series can be 100k bars); bar count is the honest proxy for bytes that can be
 * measured without serialising. Byte counting would mean stringifying every
 * entry on every write, which costs more than the cache saves.
 *
 * **Storage.** In-memory by default. A host may inject `storage` to persist
 * (localStorage, IndexedDB) but the engine will not reach for either itself:
 * choosing a persistence layer is the host's business, localStorage is
 * synchronous and small, and IndexedDB is asynchronous. Store methods may
 * therefore return a promise. `CachedBars` is plain JSON so it round-trips
 * through `JSON.stringify` unchanged.
 *
 * **Opt-out.** `getBars({ ..., noCache: true })` always hits the network (and
 * refreshes the entry); `invalidate()` and `clear()` drop entries by hand.
 *
 * **Look before you leap.** `peek()` reports what is stored without fetching,
 * for a host that wants to paint closed bars immediately and then ask for the
 * tail itself. A miss inside `getBars` is a fetch, so it cannot express that.
 */
import type { Bar, UTCSeconds } from '../model/bar';
import type { BarsRequest, DataFeed, MarketDepth, UnsubscribeFn } from './types';
import { nextBucketStart, tryResolveInterval } from './intervals';

export type MaybePromise<T> = T | Promise<T>;

/** One cached series. Plain JSON: safe to persist as-is. */
export interface CachedBars {
  /** Closed bars only, ascending by time. */
  bars: Bar[];
  /** Coverage start: the `from` of the request that filled this entry. */
  from: UTCSeconds;
  /** Coverage end (inclusive): the last instant this entry is complete to. */
  to: UTCSeconds;
  /** Wall clock (ms) when the TAIL was last revalidated, for the TTL gate. */
  storedAt: number;
  /**
   * When the bar AFTER this entry's coverage closes, so freshness needs no
   * re-resolve. Null is impossible here: an entry whose bars have no knowable
   * close is never stored in the first place.
   */
  nextClose: UTCSeconds;
}

/** What the store holds for one series, as reported by {@link BarCache.peek}. */
export interface CachedPeek {
  /** Closed bars inside the requested window, ascending. Clones. */
  bars: Bar[];
  /** Entry coverage start. */
  from: UTCSeconds;
  /** Entry coverage end (inclusive). */
  to: UTCSeconds;
  /** Wall clock (ms) when the tail was last revalidated. */
  storedAt: number;
  /** When the bar after the entry's coverage closes. */
  nextClose: UTCSeconds;
}

/**
 * Pluggable backing store. Sync or async: everything is awaited. Implement it
 * over localStorage, IndexedDB, or anything else; the default is a Map.
 */
export interface BarCacheStore {
  get(key: string): MaybePromise<CachedBars | undefined>;
  set(key: string, value: CachedBars): MaybePromise<void>;
  delete(key: string): MaybePromise<void>;
}

export interface BarCacheOptions {
  /**
   * How long the tail stays trusted, ms. Default 5 minutes. It bounds only
   * requests that reach into the last two bar spans; closed bars behind that
   * are served whatever the entry's age.
   */
  ttlMs?: number;
  /** Maximum entries before LRU eviction. Default 24. */
  max?: number;
  /** Maximum total cached bars before LRU eviction. Default 250_000. */
  maxBars?: number;
  /** Backing store. Default: in-memory Map. */
  storage?: BarCacheStore;
  /** Injectable clock (ms), for tests and for hosts with a server clock. */
  now?: () => number;
  /**
   * Interval token to seconds, for feeds with tokens this does not know
   * (tick, Renko, range bars). Return 0 to disable caching for that interval.
   */
  /**
   * Override how the cache decides when a bar closes. Return null for "unknown",
   * which makes the cache refuse to store the series rather than guess. Defaults
   * to {@link barCloseSec}, which asks the interval registry.
   */
  barCloses?: (interval: string, barStartSec: UTCSeconds) => number | null;
  /** IANA zone for calendar intervals. Defaults to the engine default. */
  timezone?: string;
}

/** A `BarsRequest` that can force a fresh fetch. */
export interface CachedBarsRequest extends BarsRequest {
  /** Skip the cached entry, fetch, and replace it with the fresh result. */
  noCache?: boolean;
}

/** Counts what this instance is tracking, not what a persistent store holds. */
export interface BarCacheStats {
  entries: number;
  bars: number;
  hits: number;
  misses: number;
  evictions: number;
}

const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_MAX = 24;
const DEFAULT_MAX_BARS = 250_000;

/**
 * Interval token to seconds. Case matters where it disambiguates: lowercase
 * The instant a bar starting at `barStartSec` closes, or null when that cannot
 * be known from the interval alone.
 *
 * This asks the interval registry rather than parsing the token itself. A second
 * parser here was the bug: it matched a fixed set of letter codes and returned
 * 60 seconds for anything else, so a host that registered its own code got a
 * cache that believed a new bar closed every minute. A tick-count series keyed
 * that way is served stale for up to a minute at a time, and a registered
 * calendar code was approximated at 30 days.
 *
 * Null means "no fixed close", and it is returned for three genuinely different
 * situations that all demand the same conservative answer:
 *
 *  - **tick and volume bars**, which close on trade flow. A 500-tick bar may run
 *    for a second or an hour, so nothing about elapsed time says whether the
 *    last bar is complete.
 *  - **an unregistered code.** Guessing 60 seconds is how the old parser turned
 *    a typo into a silently wrong cache.
 *
 * The caller must treat null as "cannot cache and cannot serve past coverage",
 * which is the safe direction: it refetches rather than serving something stale.
 */
export function barCloseSec(interval: string, barStartSec: UTCSeconds, zone?: string): number | null {
  const found = tryResolveInterval(interval);
  if (found === null) return null;
  const b = found.bucketing;
  // A fixed interval closes one span after the bar itself opens, NOT at the next
  // boundary of the epoch-anchored grid. Those are the same thing only when the
  // feed's bars happen to sit on that grid, and a session-anchored feed (09:15 in
  // Mumbai, 09:30 in New York) does not: asking the grid there answers early, and
  // the cache then treats a closed bar as still forming and refetches forever.
  // Grid alignment is how a tick is assigned to a bar, which is a different
  // question from how long that bar lasts.
  if (b.mode === 'interval') return barStartSec + b.seconds;
  // Calendar bars genuinely do start on a boundary, and their length is not fixed:
  // February and a leap February differ, and so do a 30 and a 31 day month. Only
  // the registry can resolve that, on the chart's calendar, hence the zone.
  return nextBucketStart(b, barStartSec, zone);
}

// `from` and `to` are optional on `BarsRequest`, so a caller holding only the
// three key fields (`invalidate`, `peek`) is already assignable here. Narrowing
// the parameter to a `Pick` would reject a full request literal instead, on the
// excess-property check.
export function barCacheKey(req: BarsRequest): string {
  return `${req.symbol}|${req.exchange}|${req.interval}`;
}

/** Bars are mutated in place by live builders; never hand out our own objects. */
function cloneBars(bars: Bar[]): Bar[] {
  const out: Bar[] = new Array(bars.length) as Bar[];
  for (let i = 0; i < bars.length; i++) out[i] = { ...bars[i] };
  return out;
}

class MemoryStore implements BarCacheStore {
  private readonly _m = new Map<string, CachedBars>();
  public get(key: string): CachedBars | undefined { return this._m.get(key); }
  public set(key: string, value: CachedBars): void { this._m.set(key, value); }
  public delete(key: string): void { this._m.delete(key); }
}

/** Recency and size bookkeeping, kept in memory even when the store is not. */
interface IndexEntry { lastUsed: number; bars: number }

/**
 * The entry a lookup already read, plus the write generation it was read at.
 * The generation is what makes it safe to reuse: a queued put or an eviction in
 * between bumps it, and the put falls back to reading the store.
 */
interface EntryHint { entry: CachedBars | undefined; gen: number }

export class BarCache implements DataFeed {
  /** The wrapped feed, for callers that need something this wrapper does not forward. */
  public readonly source: DataFeed;

  private readonly _backing: BarCacheStore;
  private readonly _ttlMs: number;
  private readonly _max: number;
  private readonly _maxBars: number;
  private readonly _now: () => number;
  private readonly _barCloses: (interval: string, barStartSec: UTCSeconds) => number | null;
  private readonly _index = new Map<string, IndexEntry>();
  /** One write chain per key, so concurrent puts cannot lose each other. */
  private readonly _writes = new Map<string, Promise<void>>();
  /** Bumped on every commit and every drop, so a stale read is detectable. */
  private readonly _gen = new Map<string, number>();
  private _tick = 0;
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  public constructor(feed: DataFeed, options: BarCacheOptions = {}) {
    this.source = feed;
    this._backing = options.storage ?? new MemoryStore();
    this._ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this._max = options.max ?? DEFAULT_MAX;
    this._maxBars = options.maxBars ?? DEFAULT_MAX_BARS;
    this._now = options.now ?? (() => Date.now());
    const zone = options.timezone;
    this._barCloses = options.barCloses ?? ((iv, t) => barCloseSec(iv, t, zone));
    // Only advertise the optional DataFeed methods the wrapped feed actually
    // has: the codebase feature-detects `subscribeBars` to tell a history-only
    // feed from a live one, and a stub that always exists would defeat that.
    // Forwarded with every argument, not just the two `DataFeed` declares:
    // `OpenAlgoLiveDataFeed.subscribeBars` takes a third `opts` (seedFrom,
    // cumDayVolumeSoFar) and a wrapper that dropped it would silently stop a
    // live bar continuing the last history bar's bucket. Nothing here reads the
    // extra arguments; they only have to survive the hop.
    if (typeof feed.subscribeBars === 'function') {
      this.subscribeBars = (req, onBar, ...rest): UnsubscribeFn =>
        (feed.subscribeBars as (...a: unknown[]) => UnsubscribeFn)(req, onBar, ...rest);
    }
    if (typeof feed.subscribeDepth === 'function') {
      this.subscribeDepth = (req, onDepth, ...rest): UnsubscribeFn =>
        (feed.subscribeDepth as (...a: unknown[]) => UnsubscribeFn)(req, onDepth, ...rest);
    }
  }

  // `...rest` is part of the signature so a caller holding the concrete
  // `BarCache` can still pass a wrapped feed's extra options through.
  public subscribeBars?: (req: BarsRequest, onBar: (bar: Bar) => void, ...rest: unknown[]) => UnsubscribeFn;
  public subscribeDepth?: (req: BarsRequest, onDepth: (depth: MarketDepth) => void, ...rest: unknown[]) => UnsubscribeFn;

  public async getBars(req: CachedBarsRequest): Promise<Bar[]> {
    // An open-ended request cannot be reasoned about: we would not know what the
    // entry covers. An interval whose bars have no knowable close cannot be
    // cached at all, because nothing tells us which of them are complete. Both
    // pass straight through, uncached in either direction.
    if (req.from === undefined || req.to === undefined) {
      return this.source.getBars(req);
    }
    const key = barCacheKey(req);
    // The entry the lookup reads is handed to the put below, so a miss costs ONE
    // store read instead of two. Over IndexedDB an entry is measured in
    // megabytes and every read deserialises the whole of it on the main thread,
    // which is a real cost on the hot path rather than a rounding error.
    let hint: EntryHint | undefined;
    if (req.noCache !== true) {
      const entry = await this._backing.get(key);
      hint = { entry, gen: this._gen.get(key) ?? 0 };
      const hit = entry === undefined ? undefined : this._serve(key, entry, req.from, req.to);
      if (hit !== undefined) {
        this._hits++;
        return hit;
      }
      this._misses++;
    }
    // Awaited, not caught: a rejected fetch must propagate untouched and must
    // leave the previous entry alone. Nothing is written unless bars arrive.
    const bars = await this.source.getBars(req);
    await this._put(key, req.from, req.to, req.interval, bars, hint);
    return bars;
  }

  /**
   * What this cache holds for a series, without ever fetching.
   *
   * `getBars` cannot express "paint what you have, I will ask for the rest
   * myself": a miss there IS a fetch. A live chart that wants to paint closed
   * bars from disk in the frame it mounts, and only then request the tail,
   * needs to look before it leaps. `peek` never fetches, never drops, never
   * counts as a hit or a miss, and returns only bars this cache considers
   * closed — the forming bar was dropped on store and is not here to be served.
   * Coverage is reported as-is so the caller can see a left-edge gap.
   */
  public async peek(
    req: Pick<BarsRequest, 'symbol' | 'exchange' | 'interval'> & { from?: UTCSeconds; to?: UTCSeconds },
  ): Promise<CachedPeek | undefined> {
    const key = barCacheKey(req);
    const entry = await this._backing.get(key);
    if (entry === undefined || entry.bars.length === 0) return undefined;
    // An entry about to be extended must not be the next LRU victim.
    this._index.set(key, { lastUsed: ++this._tick, bars: entry.bars.length });
    const from = req.from ?? entry.bars[0].time;
    const to = req.to ?? entry.bars[entry.bars.length - 1].time;
    const bars: Bar[] = [];
    for (const b of entry.bars) {
      if (b.time < from) continue;
      if (b.time > to) break;
      bars.push({ ...b });
    }
    return { bars, from: entry.from, to: entry.to, storedAt: entry.storedAt, nextClose: entry.nextClose };
  }

  /**
   * Drop one series, or (with no argument) everything this cache knows of.
   * "Knows of" is literal with an injected persistent store: recency and size
   * are tracked in memory, so a key written by an earlier session is adopted
   * when it is next read — expired or not, since expiry now only forces a tail
   * refetch — and comes under this instance's bounds from then on, rather than
   * being reachable by `clear()` before that. A store that outlives the process
   * is responsible for its own overall quota.
   */
  public async invalidate(req?: Pick<BarsRequest, 'symbol' | 'exchange' | 'interval'>): Promise<void> {
    if (req === undefined) return this.clear();
    await this._drop(barCacheKey(req));
  }

  public async clear(): Promise<void> {
    for (const k of [...this._index.keys()]) await this._drop(k);
  }

  public stats(): BarCacheStats {
    let bars = 0;
    for (const e of this._index.values()) bars += e.bars;
    return { entries: this._index.size, bars, hits: this._hits, misses: this._misses, evictions: this._evictions };
  }

  /** The three checks and the slice, over an entry the caller has already read. */
  private _serve(key: string, entry: CachedBars, from: UTCSeconds, to: UTCSeconds): Bar[] | undefined {
    const nowMs = this._now();
    const nowSec = Math.floor(nowMs / 1000);
    // One bar's span at the tail, read off the entry rather than re-resolving
    // the interval: `nextClose` is the close of the bar AFTER the last one held,
    // and `to + 1` is that last bar's close.
    const span = Math.max(1, entry.nextClose - (entry.to + 1));
    // A closed bar is immutable, so age alone is no reason to throw an entry
    // away — that is what made a warm chart cold on every reload and out of
    // hours. Only the recent tail can still change under us: a late print, a
    // backend heal, a session rebuild. So the TTL gates the tail and nothing
    // else, and an expired entry is KEPT: its older bars are still the fastest
    // correct paint available, and a host that wants them gone calls
    // `invalidate()`.
    if (to > nowSec - 2 * span && nowMs - entry.storedAt > this._ttlMs) return undefined;
    // Older bars than we hold: a real gap at the left edge, so refetch rather
    // than paint a chart that silently starts late.
    if (from < entry.from) return undefined;
    // Past our coverage: allowed only while the bar after our last closed one
    // is still forming, i.e. nothing new could have been fetched anyway.
    if (to > entry.to && nowSec >= entry.nextClose) return undefined;
    this._index.set(key, { lastUsed: ++this._tick, bars: entry.bars.length });
    const out: Bar[] = [];
    for (const b of entry.bars) {
      if (b.time < from) continue;
      if (b.time > to) break;
      out.push({ ...b });
    }
    return out;
  }

  /**
   * Serialise writes per key. Two puts for one series overlap routinely — an
   * older-page lazy load racing a resume recovery, two panes on the same symbol
   * — and every put reads the entry before it writes. Over an async store both
   * would read the same entry and the second would commit a union of what it
   * read, silently dropping the first one's bars. Chaining costs nothing when
   * there is no contention: the map is empty and the put runs immediately.
   */
  private _put(
    key: string,
    from: UTCSeconds,
    to: UTCSeconds,
    interval: string,
    bars: Bar[],
    hint?: EntryHint,
  ): Promise<void> {
    const queued = (this._writes.get(key) ?? Promise.resolve()).then(
      () => this._commit(key, from, to, interval, bars, hint),
    );
    // The chain is joined on a SETTLED promise: one failed write must not
    // poison every later put for the key. The caller still sees the rejection.
    const settled = queued.then(() => undefined, () => undefined);
    this._writes.set(key, settled);
    void settled.then(() => {
      if (this._writes.get(key) === settled) this._writes.delete(key);
    });
    return queued;
  }

  private async _commit(
    key: string,
    from: UTCSeconds,
    to: UTCSeconds,
    interval: string,
    bars: Bar[],
    hint?: EntryHint,
  ): Promise<void> {
    const nowMs = this._now();
    const nowSec = Math.floor(nowMs / 1000);
    let end = bars.length;
    // Drop every trailing bar that has not closed yet. Normally that is the one
    // forming candle; the loop also copes with a feed that stamps a bar ahead.
    // Each bar is asked for its OWN close. A calendar month is not a fixed span,
    // so a single duration would mis-date February and every 31 day month; and a
    // bar with no knowable close (a tick series, an unregistered code) is never
    // complete as far as this cache is concerned, so the loop drops the lot and
    // the entry is abandoned below.
    while (end > 0) {
      const close = this._barCloses(interval, bars[end - 1].time);
      if (close !== null && close <= nowSec) break;
      end--;
    }
    if (end === 0) return; // Nothing closed to cache, and an empty entry would only mislead.
    const fresh = cloneBars(bars.slice(0, end));
    const gen = this._gen.get(key) ?? 0;
    // A hint is only good while nothing has written to the key since it was
    // read. A put queued ahead of this one, or an eviction, makes it a stale
    // base to union against, and reading the store is then the cheap option
    // next to silently dropping bars.
    const previous = hint !== undefined && hint.gen === gen ? hint.entry : await this._backing.get(key);
    const entry = this._mergeEntry(previous, fresh, from, to, interval, nowMs);
    if (entry === undefined) return;
    await this._backing.set(key, entry);
    this._gen.set(key, gen + 1);
    this._index.set(key, { lastUsed: ++this._tick, bars: entry.bars.length });
    await this._evict();
  }

  /**
   * Union the fresh bars into what the entry already holds, so a small tail
   * fetch EXTENDS the series instead of replacing it with the tail. Replacing
   * was correct while every request covered the whole visible range; a
   * cache-first seed asks for ten bars, and replacing there would throw away
   * the very history the seed just painted.
   *
   * Replacement survives for the one case a union would lie about: two ranges
   * with a hole between them. `from`..`to` is a single interval, so a union
   * across a hole would claim coverage the entry does not have, and a later
   * request inside the hole would be served short instead of refetching.
   */
  private _mergeEntry(
    previous: CachedBars | undefined,
    fresh: Bar[],
    from: UTCSeconds,
    to: UTCSeconds,
    interval: string,
    nowMs: number,
  ): CachedBars | undefined {
    // One bar's span at a given start, for adjacency. Null (a tick series, an
    // unregistered code) collapses this to the plain seconds comparison.
    const spanAfter = (t: UTCSeconds): number => {
      const close = this._barCloses(interval, t);
      return close === null ? 1 : Math.max(1, close - t);
    };
    let union = false;
    if (previous !== undefined) {
      const prevLast = previous.bars[previous.bars.length - 1].time;
      const freshLast = fresh[fresh.length - 1].time;
      // Adjacency is a question about the BAR GRID, not about seconds. An older
      // page whose last bar sits immediately before the entry's first bar is
      // contiguous, even though its requested `to` is a whole span short of the
      // entry's `from`; comparing seconds there replaced a warm 2000-bar entry
      // with the page that was meant to extend it. Coverage bounds are still
      // honoured, so a request that deliberately stopped short still counts.
      const startsInTime = from <= Math.max(previous.to + 1, prevLast + spanAfter(prevLast));
      const endsInTime = Math.max(to + 1, freshLast + spanAfter(freshLast)) >= previous.from;
      union = startsInTime && endsInTime;
    }
    let bars = fresh;
    if (union) {
      // The server is the truth for the range it ANSWERED, deletions included:
      // a corrected bucketing that drops a bar must drop it here too, or the
      // chart paints a ghost candle nothing upstream agrees with. The window is
      // the first and last bar actually returned, NOT the requested `from`/`to`
      // — an answer truncated at either edge would otherwise punch a hole
      // through cached bars the server never spoke about.
      const authorityFrom = fresh[0].time;
      const authorityTo = fresh[fresh.length - 1].time;
      const previousBars = previous!.bars;
      // Both arrays are ascending and `fresh` owns one contiguous window, so
      // the union is a three-way concat rather than a sort: everything the
      // entry holds before the window, the window itself, everything after.
      const merged: Bar[] = [];
      let i = 0;
      while (i < previousBars.length && previousBars[i].time < authorityFrom) merged.push(previousBars[i++]);
      for (const bar of fresh) merged.push(bar);
      while (i < previousBars.length && previousBars[i].time <= authorityTo) i++;
      while (i < previousBars.length) merged.push(previousBars[i++]);
      bars = merged;
    }
    // A merged series past the budget keeps the NEWEST bars: the oldest are the
    // ones a scroll-back can refetch cheaply. `from` moves up with them, so the
    // next request reaching further back misses and refetches rather than being
    // served a series that silently starts late.
    let trimmed = false;
    if (bars.length > this._maxBars) {
      // One series larger than the whole budget would evict everything else and
      // then itself on the next write, so it is simply not cached.
      if (fresh.length > this._maxBars) return undefined;
      bars = bars.slice(bars.length - this._maxBars);
      trimmed = true;
    }
    const last = bars[bars.length - 1];
    // Non-null by construction: the caller only kept bars that had a close, and
    // `nextClose` is the close of the bar that follows the last one, which is
    // the instant a hit past coverage stops being safe.
    const lastClose = this._barCloses(interval, last.time) as UTCSeconds;
    const nextClose = this._barCloses(interval, lastClose) ?? lastClose;
    const coveredFrom = union ? Math.min(previous!.from, from) : from;
    const coveredTo = union ? Math.max(previous!.to, to) : to;
    return {
      bars,
      // NOT `bars[0].time` in the untrimmed case: an instrument whose history
      // starts later than the request must keep the requested `from` as
      // coverage, or gate (2) turns every identical reload into a miss.
      from: trimmed ? bars[0].time : coveredFrom,
      // Complete through whichever ends first: what we asked for, or the close
      // of the last bar we actually hold.
      to: Math.min(coveredTo, lastClose - 1),
      // `storedAt` answers "when was the TAIL last revalidated". An older-page
      // fetch adds bars behind the tail and proves nothing about it.
      storedAt: union && to < previous!.to ? previous!.storedAt : nowMs,
      nextClose,
    };
  }

  private async _drop(key: string): Promise<void> {
    this._index.delete(key);
    // A hint taken before this drop must not be unioned against afterwards: it
    // would resurrect an entry the cache has just decided to forget.
    this._gen.set(key, (this._gen.get(key) ?? 0) + 1);
    await this._backing.delete(key);
  }

  private async _evict(): Promise<void> {
    for (;;) {
      let bars = 0;
      for (const e of this._index.values()) bars += e.bars;
      if (this._index.size <= this._max && bars <= this._maxBars) return;
      let victim: string | undefined;
      let oldest = Infinity;
      for (const [k, e] of this._index) {
        if (e.lastUsed < oldest) { oldest = e.lastUsed; victim = k; }
      }
      if (victim === undefined) return;
      this._evictions++;
      await this._drop(victim);
    }
  }
}

/**
 * Wrap any `DataFeed` in a warm-load bar cache.
 *
 *     const feed = withBarCache(new OpenAlgoDataFeed(cfg), { ttlMs, max, storage });
 */
export function withBarCache(feed: DataFeed, options?: BarCacheOptions): BarCache {
  return new BarCache(feed, options);
}
