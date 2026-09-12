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
 * **A request is a COUNT and an END, and coverage is the BARS.** `{ endSec,
 * count }` — "the last `count` bars at or before this instant" — is the shape
 * a history endpoint can answer without knowing anything about sessions, and
 * the shape this cache judges itself by. The older `{ from, to }` shape still
 * works and is adapted onto it. The difference is not cosmetic: a clock window
 * assumes the market never closes, so a Monday-morning ask for 2000 one-minute
 * bars spans a 49-hour weekend and a third of the answer is thrown away, and
 * no window narrow enough to be honest can page back across that weekend at
 * all. A count has nothing to be wrong about.
 *
 * **Freshness.** Three independent checks, all of which must pass:
 *   1. `ttlMs` bounds the age of the TAIL, not of the entry. A closed bar is
 *      immutable, so age alone says nothing about it; only the last couple of
 *      bars can still change under us (a late print, a backend heal, a session
 *      rebuild). So the gate fires only for a request that reaches into the
 *      last two bar spans, and an entry past its TTL is kept rather than
 *      deleted — its older bars remain the fastest correct answer available.
 *   2. The entry holds at least `count` bars at or before `endSec` — or it is
 *      `short`, the server's own word that nothing older exists. Fewer bars
 *      than were asked for is a real gap at the left edge, and painting a chart
 *      that silently starts late is worse than a refetch; but a market that was
 *      shut is not a gap, and only the server can tell the two apart.
 *   3. Nothing new can have closed. An entry is complete through the close of
 *      its last bar; the next one closes at `nextClose`, measured on the feed's
 *      own bar grid rather than on UTC midnight, so a daily Indian bar opening
 *      at 03:45 UTC is judged against its own session, not the wrong boundary.
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
 * **Storage.** A bounded in-memory copy is always kept, and a host may inject
 * `storage` on top of it to persist (localStorage, IndexedDB); the engine will
 * not reach for either itself, because choosing a persistence layer is the
 * host's business, localStorage is synchronous and small, and IndexedDB is
 * asynchronous. Store methods may therefore return a promise. Durable reads,
 * writes and deletes are best effort: storage denial or an exhausted quota
 * degrades this to the memory copy rather than blocking market data.
 * `prune(maxAgeMs)` is how a persistent store sheds keys this session never
 * touched. `CachedBars` is plain JSON so it round-trips through
 * `JSON.stringify` unchanged, and it carries a {@link BAR_CACHE_VERSION}: a
 * durable entry that does not validate is deleted and refetched rather than
 * painted.
 *
 * **Opt-out.** `getBars({ ..., noCache: true })` always hits the network (and
 * refreshes the entry); `invalidate()` and `clear()` drop entries by hand.
 *
 * **Look before you leap.** `peek()` reports what is stored without fetching,
 * for a host that wants to paint closed bars immediately and then ask for the
 * tail itself. A miss inside `getBars` is a fetch, so it cannot express that.
 * `getCachedBars()` is the same look in the `DataFeed` shape the shared
 * `DataLoadingController` asks for: bars, or nothing.
 */
import type { Bar, UTCSeconds } from '../model/bar';
import type { BarsPage, BarsPageRequest, BarsRequest, DataFeed, MarketDepth, UnsubscribeFn } from './types';
import { nextBucketStart, tryResolveInterval } from './intervals';

export type MaybePromise<T> = T | Promise<T>;

/**
 * One cached series. Plain JSON: safe to persist as-is.
 *
 * There is no `from`/`to` here, and their absence is the whole model: coverage
 * IS `bars`. The left edge is `bars[0].time`, the right edge is the close of
 * `bars[bars.length - 1]`, and nothing in between is claimed that is not held.
 * Recording a requested window instead let an entry assert coverage over a band
 * it had no bars for and had never been told about — a market closure and a
 * range nobody ever fetched look identical from inside such a window, and the
 * cache served `[]` for both.
 */
export interface CachedBars {
  /**
   * Persisted schema version. Missing means an entry from before versioning,
   * which is read on its own merits: the validator decides, not the number.
   */
  version?: number;
  /** Closed bars only, ascending by time. */
  bars: Bar[];
  /**
   * The oldest instant this entry speaks for: `bars[0].time`, DERIVED from the
   * bars rather than recorded from a request. It exists so a durable entry
   * describes itself well enough to be validated on the way back in — a stored
   * blob that claims bars outside its own coverage is corrupt — and it is never
   * consulted to answer a request. Coverage is still the bars: recording a
   * requested window instead let an entry assert coverage over a band it had no
   * bars for, and a market closure and a range nobody ever fetched then looked
   * identical from inside such a window.
   */
  from: UTCSeconds;
  /** The newest instant this entry speaks for: one second before its last bar closes. */
  to: UTCSeconds;
  /** Wall clock (ms) when the TAIL was last revalidated, for the TTL gate. */
  storedAt: number;
  /**
   * When the bar AFTER the last one held closes, so freshness needs no
   * re-resolve. Null is impossible here: an entry whose bars have no knowable
   * close is never stored in the first place.
   */
  nextClose: UTCSeconds;
  /**
   * The server's own statement that nothing older exists: the fetch that
   * established this entry's left edge asked for more bars than it got back.
   * It is the ONLY evidence of that available — a client-side session table is
   * a second source of truth that goes stale every year, differs per product
   * and cannot know about an unplanned halt — so without it a chart pages back
   * into a closed weekend for ever, one identical empty answer at a time.
   *
   * Absent means "not known to be short". It is cleared by any later answer
   * that establishes the left edge in full, and by a `maxBars` trim, after
   * which the entry no longer holds the left edge it was speaking about.
   *
   * It is a BELIEF, not a fact, which is why it carries {@link
   * CachedBars.shortAt}: a server clamp, a heal in flight or a store still
   * filling all answer short for reasons that pass, and a belief with no age
   * on it ends paging for that series until something drops the entry.
   */
  short?: boolean;
  /**
   * Wall clock (ms) when `short` was last established or confirmed. Only
   * meaningful while `short` is true, and deliberately NOT `storedAt`: the tail
   * is revalidated on every new bar, so a clock shared with it would never
   * grow old and the belief would never be re-checked.
   */
  shortAt?: number;
}

/**
 * What the store holds for one series, as reported by {@link BarCache.peek}.
 *
 * Everything except `bars` is the entry's own, carrying exactly the meaning
 * {@link CachedBars} gives it — `short` included, so a caller can tell "the
 * server has no more" from "I have not asked yet". `bars` is the slice the peek
 * asked for rather than everything the entry holds.
 */
export interface CachedPeek extends Omit<CachedBars, 'bars'> {
  /** Closed bars the peek asked for, ascending. Clones. */
  bars: Bar[];
}

/**
 * Pluggable durable store, on top of the bounded memory copy the cache always
 * keeps. Sync or async: everything is awaited, and every operation is isolated
 * from the network result, so a store that throws costs speed and nothing else.
 * Implement it over localStorage, IndexedDB, or anything else.
 */
export interface BarCacheStore {
  get(key: string): MaybePromise<CachedBars | undefined>;
  set(key: string, value: CachedBars): MaybePromise<void>;
  delete(key: string): MaybePromise<void>;
  /**
   * Every key this store holds, including keys written by earlier sessions.
   * Optional, because a store need not be enumerable — but without it
   * {@link BarCache.prune} has nothing to walk and does nothing, and a key for a
   * symbol never reopened stays in the store for ever: recency and size are
   * tracked in memory, so eviction cannot see it.
   */
  keys?(): MaybePromise<string[]>;
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
  /** Optional durable store. Bounded in-memory retention is always enabled. */
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
 * Current persisted entry schema. Legacy entries without this field are read on
 * their structure alone, so an entry a previous version wrote survives if it
 * still describes itself correctly. An entry stamped with a version this build
 * does not know is dropped rather than guessed at.
 */
export const BAR_CACHE_VERSION = 1;

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

/**
 * A request reduced to what this cache reasons about: how many bars, ending
 * when. `from` is set only by a range request, and only so the answer can be
 * sliced back to the window that host asked for.
 */
interface BarsAsk {
  endSec: UTCSeconds;
  count: number;
  from?: UTCSeconds;
}

/**
 * The answer to one ask, cloned: the bars at or before `endSec`, cut to the
 * requested window for a range ask and to the newest `count` for a bar-count
 * one. A range keeps everything inside its window even when that is more bars
 * than the count it implies — the window is what the caller asked for.
 */
function sliceBars(bars: Bar[], ask: BarsAsk): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    if (b.time > ask.endSec) break;
    if (ask.from !== undefined && b.time < ask.from) continue;
    out.push({ ...b });
  }
  if (ask.from === undefined && out.length > ask.count) out.splice(0, out.length - ask.count);
  return out;
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
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

  private readonly _backing: BarCacheStore | undefined;
  /**
   * The copy that is always there. A durable store is an addition to it, never
   * a replacement: a denied read, an exhausted quota or a refused delete then
   * costs speed rather than the session's history.
   */
  private readonly _memory = new Map<string, CachedBars>();
  /** Keys whose durable value may still exist after a failed write or delete. */
  private readonly _tombstones = new Set<string>();
  private readonly _ttlMs: number;
  private readonly _max: number;
  private readonly _maxBars: number;
  private readonly _now: () => number;
  private readonly _barCloses: (interval: string, barStartSec: UTCSeconds) => number | null;
  private readonly _index = new Map<string, IndexEntry>();
  /** One write chain per key, so concurrent puts cannot lose each other. */
  private readonly _writes = new Map<string, Promise<void>>();
  /**
   * The signal of the put currently at the end of a key's chain. An ABORTED put
   * has nothing worth waiting for — its bars are already disowned — so the next
   * put for that key skips the queue instead of blocking behind a write that
   * may still be in flight inside the store.
   */
  private readonly _queuedSignals = new Map<string, AbortSignal | undefined>();
  /** The newest put to have claimed a key, so a slow loser can stand down. */
  private readonly _latestWrite = new Map<string, symbol>();
  /** Bumped on every commit and every drop, so a stale read is detectable. */
  private readonly _gen = new Map<string, number>();
  private _tick = 0;
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  public constructor(feed: DataFeed, options: BarCacheOptions = {}) {
    this.source = feed;
    this._backing = options.storage;
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
    // Pagination is forwarded, not cached: a page is a provider answer about a
    // window this cache has no entry shape for, and advertising the capability
    // the source does not have would make a host ask for pages nobody can serve.
    if (typeof feed.getBarsPage === 'function') {
      this.getBarsPage = (req): Promise<BarsPage> => feed.getBarsPage!(req);
    }
  }

  // `...rest` is part of the signature so a caller holding the concrete
  // `BarCache` can still pass a wrapped feed's extra options through.
  public subscribeBars?: (req: BarsRequest, onBar: (bar: Bar) => void, ...rest: unknown[]) => UnsubscribeFn;
  public subscribeDepth?: (req: BarsRequest, onDepth: (depth: MarketDepth) => void, ...rest: unknown[]) => UnsubscribeFn;
  public getBarsPage?: (req: BarsPageRequest) => Promise<BarsPage>;

  public async getBars(req: CachedBarsRequest): Promise<Bar[]> {
    throwIfAborted(req.signal);
    // An open-ended request cannot be reasoned about: we would not know what the
    // entry covers. An interval whose bars have no knowable close cannot be
    // cached at all, because nothing tells us which of them are complete. Both
    // pass straight through, uncached in either direction.
    const ask = this._ask(req);
    if (ask === undefined) {
      const passthrough = await this.source.getBars(req);
      throwIfAborted(req.signal);
      return passthrough;
    }
    const key = barCacheKey(req);
    // The entry the lookup reads is handed to the put below, so a miss costs ONE
    // store read instead of two. Over IndexedDB an entry is measured in
    // megabytes and every read deserialises the whole of it on the main thread,
    // which is a real cost on the hot path rather than a rounding error.
    let hint: EntryHint | undefined;
    if (req.noCache !== true) {
      const entry = await this._readEntry(key, req.interval);
      throwIfAborted(req.signal);
      hint = { entry, gen: this._gen.get(key) ?? 0 };
      const hit = entry === undefined ? undefined : this._serve(key, entry, req.interval, ask);
      if (hit !== undefined) {
        this._hits++;
        return hit;
      }
      this._misses++;
    }
    // Awaited, not caught: a rejected fetch must propagate untouched and must
    // leave the previous entry alone. Nothing is written unless bars arrive.
    // The request goes to the source EXACTLY as it arrived: the adaptation
    // below is this cache's own bookkeeping, and a feed that speaks ranges must
    // keep being asked in ranges.
    throwIfAborted(req.signal);
    const bars = await this.source.getBars(req);
    // A cancelled request must neither publish nor cache: the caller has moved
    // on to another symbol or another window, and an answer to the question it
    // stopped asking is exactly the wrong thing to put in the entry.
    throwIfAborted(req.signal);
    await this._put(key, ask, req.interval, bars, hint, req.signal);
    throwIfAborted(req.signal);
    return bars;
  }

  /**
   * The closed bars this cache already holds inside a window, or nothing —
   * never a fetch. It is {@link BarCache.peek} in the shape `DataFeed` declares,
   * so the shared `DataLoadingController` can paint closed history the instant
   * it mounts and then refresh, and it answers the plain question that shape
   * asks: bars, or nothing.
   *
   * Unlike a `getBars` hit this does not judge the answer's left edge or its
   * tail. A caller that asks for a snapshot has already decided to refresh, so
   * withholding immutable closed bars from it would buy a blank chart and
   * nothing else. An entry past its TTL is served here for the same reason it
   * is kept in the store: age is not evidence about a bar that has closed.
   */
  public async getCachedBars(req: BarsRequest): Promise<Bar[] | undefined> {
    throwIfAborted(req.signal);
    if (req.noCache === true) return undefined;
    // The same two shapes `getBars` takes. Gating on `from`/`to` alone made the
    // cache-first paint dead code for a count-shaped host, which is the shape
    // this fork's own consumer asks in.
    const ask = this._ask(req);
    if (ask === undefined) return undefined;
    const key = barCacheKey(req);
    const entry = await this._readEntry(key, req.interval);
    throwIfAborted(req.signal);
    if (entry === undefined) return undefined;
    const snapshot = sliceBars(entry.bars, ask);
    if (snapshot.length === 0) return undefined;
    this._remember(key, entry);
    await this._evict();
    throwIfAborted(req.signal);
    return snapshot;
  }

  /**
   * The request as a bar count and an end, whichever shape it arrived in, or
   * `undefined` for one that cannot be reasoned about at all.
   *
   * `{ endSec, count }` is already the model and passes through untouched.
   * `{ from, to }` is adapted — `count` is how many bars the window has room
   * for, `endSec` is `to` — and keeps `from`, because a range request must
   * still be ANSWERED as a range: the caller asked for a window and slicing to
   * it is the only thing that leaves such a host's behaviour unchanged. The
   * count it implies is used for the coverage question alone.
   */
  private _ask(req: BarsRequest): BarsAsk | undefined {
    const windowed = req.from !== undefined && req.to !== undefined;
    // A page request carries a window AND, if its caller spread a host request
    // to build it, the host's `endSec`/`count` as well. Reading the count there
    // answers the NEWEST n bars to a question about the oldest, which is how a
    // scroll-back pages backwards for ever loading nothing. The window a caller
    // actually supplied wins over a count it did not mean to send.
    if (!windowed && (req as { before?: UTCSeconds }).before === undefined
      && req.endSec !== undefined && req.count !== undefined) {
      return { endSec: req.endSec, count: req.count };
    }
    if (req.from === undefined || req.to === undefined) return undefined;
    const from = req.from, to = req.to;
    const close = this._barCloses(req.interval, from);
    // A span of 0 (an interval with no knowable close) leaves `count` at 0, so
    // the left-edge gate cannot fire. Such a series is never stored anyway.
    const span = close === null ? 0 : Math.max(1, close - from);
    return {
      endSec: to,
      count: span === 0 ? 0 : Math.ceil((to - from) / span),
      from,
    };
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
   *
   * It takes the same two request shapes `getBars` does: `{ endSec, count }`
   * for "the last N bars you hold at or before this instant" — the seed a
   * chart paints — or `{ from, to }` for a window. With neither, it hands back
   * everything the entry holds. `short` comes back with the bars, and it is the
   * answer to the question a peek cannot otherwise settle: fewer bars than you
   * asked for means the server has no more, not that nobody has asked yet.
   *
   * Two empty answers, and they mean different things:
   *   - `undefined` — nothing is stored for this series. Load it cold.
   *   - `{ bars: [], … }` — an entry EXISTS, but nothing it holds is inside the
   *     window asked for. Peek again without one to see where its bars are.
   *
   * It does touch LRU recency, because an entry about to be extended must not
   * be the next victim. Nothing is written here, but the touch ADOPTS the entry
   * into this session's index — which is the point over a persistent store,
   * where a reload starts with an empty index — and from then on it counts
   * towards `max` and `maxBars`. It therefore evicts like any other adoption:
   * peeking forty cold series with `max: 24` used to leave forty entries in
   * memory and no evictions at all, which is the bound not holding rather than
   * the peek being free.
   *
   * What it evicts is the MEMORY copy. `max` and `maxBars` bound what this
   * session holds in RAM; a look must not delete somebody else's disk. Sweeping
   * a persistent store is `prune(maxAgeMs)`, on an age the host chooses.
   */
  public async peek(req: BarsRequest): Promise<CachedPeek | undefined> {
    const key = barCacheKey(req);
    const entry = await this._readEntry(key, req.interval);
    if (entry === undefined || entry.bars.length === 0) return undefined;
    // An entry about to be extended must not be the next LRU victim.
    this._remember(key, entry);
    await this._evict(false);
    const bars = sliceBars(entry.bars, {
      endSec: req.endSec ?? req.to ?? entry.bars[entry.bars.length - 1].time,
      // A window is answered as a window: `count` narrows a peek that gave one.
      count: req.count ?? entry.bars.length,
      from: req.from,
    });
    return {
      bars,
      version: entry.version,
      from: entry.from,
      to: entry.to,
      storedAt: entry.storedAt,
      nextClose: entry.nextClose,
      short: entry.short === true,
    };
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
    // Everything this instance can name: what it has indexed, what it is holding
    // in memory, and every key whose durable copy a failed write or delete may
    // have left behind.
    const keys = new Set([...this._index.keys(), ...this._memory.keys(), ...this._tombstones]);
    for (const k of keys) await this._drop(k);
  }

  /**
   * Drop every entry whose tail was last revalidated longer than `maxAgeMs`
   * ago, and report how many went.
   *
   * The bounds (`max`, `maxBars`) only see what THIS session has touched,
   * because recency and size are tracked in memory. With a persistent store
   * that leaves a hole: an entry written weeks ago for a symbol nobody has
   * reopened is invisible to eviction and never expires either, since an
   * expired entry is now kept rather than deleted. So it would live in
   * IndexedDB for ever. `prune` is the answer, and it deliberately walks the
   * STORE's keys rather than the in-memory index — the keys it needs to find
   * are exactly the ones the index does not have. Call it on a timer, or once
   * at startup.
   *
   * A store with no `keys()` cannot be walked, so this does nothing and returns
   * 0 rather than pretending.
   */
  public async prune(maxAgeMs: number): Promise<number> {
    const cutoff = this._now() - maxAgeMs;
    let dropped = 0;
    // With no durable store the memory copy IS the store, and it can always be
    // listed; with one, its keys are exactly the ones the in-memory index does
    // not have, which is the whole reason this method exists.
    if (this._backing === undefined) {
      for (const [key, entry] of [...this._memory]) {
        if (entry.storedAt >= cutoff) continue;
        await this._drop(key);
        dropped++;
      }
      return dropped;
    }
    if (this._backing.keys === undefined) return 0;
    let keys: string[];
    try {
      keys = await this._backing.keys();
    } catch {
      return 0;
    }
    for (const key of keys) {
      let entry: CachedBars | undefined;
      try {
        entry = await this._backing.get(key);
      } catch {
        continue;
      }
      if (entry === undefined || entry.storedAt >= cutoff) continue;
      await this._drop(key);
      dropped++;
    }
    return dropped;
  }

  public stats(): BarCacheStats {
    let bars = 0;
    for (const e of this._index.values()) bars += e.bars;
    return { entries: this._index.size, bars, hits: this._hits, misses: this._misses, evictions: this._evictions };
  }

  /** The three checks and the slice, over an entry the caller has already read. */
  private _serve(key: string, entry: CachedBars, interval: string, ask: BarsAsk): Bar[] | undefined {
    const last = entry.bars[entry.bars.length - 1] as Bar | undefined;
    if (last === undefined) return undefined;
    const nowMs = this._now();
    const nowSec = Math.floor(nowMs / 1000);
    // The entry is complete through `lastClose - 1`, and `span` is the length of
    // the bar that follows. Both come off the bars themselves now that no
    // requested window is recorded to read them from.
    const lastClose = this._barCloses(interval, last.time) ?? entry.nextClose;
    const span = Math.max(1, entry.nextClose - lastClose);
    // A closed bar is immutable, so age alone is no reason to throw an entry
    // away — that is what made a warm chart cold on every reload and out of
    // hours. Only the recent tail can still change under us: a late print, a
    // backend heal, a session rebuild. So the TTL gates the tail and nothing
    // else, and an expired entry is KEPT: its older bars are still the fastest
    // correct paint available, and a host that wants them gone calls
    // `invalidate()`.
    if (ask.endSec > nowSec - 2 * span && nowMs - entry.storedAt > this._ttlMs) return undefined;
    // Reaching further back than we hold is a real gap at the left edge, so
    // refetch rather than paint a chart that silently starts late. A bar-count
    // ask measures that in bars; a range ask measures it at its own `from`,
    // because the count a window implies is an over-count by exactly the bars
    // that cannot be stored — the forming one above all — and gating on it
    // would miss on every live request.
    //
    // Unless the entry is `short` and that belief is still fresh: the server
    // has said it has no more, and asking again is an identical answer every
    // time the user drags left. But `short` is a belief with an age, so it is
    // re-checked once per TTL — one request, which is the only thing that can
    // prove there IS older history after a transient shortfall, and cheaper
    // than a series that can never be paged again.
    if (entry.short !== true || nowMs - (entry.shortAt ?? 0) > this._ttlMs) {
      if (ask.from !== undefined) {
        if (ask.from < entry.bars[0].time) return undefined;
      } else {
        let available = 0;
        for (const b of entry.bars) {
          if (b.time > ask.endSec) break;
          available++;
        }
        if (ask.count > available) return undefined;
      }
    }
    // Past our coverage: allowed only while the bar after our last closed one
    // is still forming, i.e. nothing new could have been fetched anyway.
    if (ask.endSec >= lastClose && nowSec >= entry.nextClose) return undefined;
    this._index.set(key, { lastUsed: ++this._tick, bars: entry.bars.length });
    return sliceBars(entry.bars, ask);
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
    ask: BarsAsk,
    interval: string,
    bars: Bar[],
    hint?: EntryHint,
    signal?: AbortSignal,
  ): Promise<void> {
    // An aborted put is not worth queueing behind: its bars are already
    // disowned, and the store call it may still be sitting inside would hold up
    // an answer somebody is waiting for. The loser sorts the store out itself,
    // in `_commit`, by rewriting whatever the winner left in memory.
    const ahead = this._queuedSignals.get(key)?.aborted === true
      ? Promise.resolve()
      : this._writes.get(key) ?? Promise.resolve();
    const queued = ahead.then(
      () => this._commit(key, ask, interval, bars, hint, signal),
    );
    this._queuedSignals.set(key, signal);
    // The chain is joined on a SETTLED promise: one failed write must not
    // poison every later put for the key. The caller still sees the rejection.
    const settled = queued.then(() => undefined, () => undefined);
    this._writes.set(key, settled);
    void settled.then(() => {
      if (this._writes.get(key) === settled) {
        this._writes.delete(key);
        this._queuedSignals.delete(key);
      }
    });
    return queued;
  }

  private async _commit(
    key: string,
    ask: BarsAsk,
    interval: string,
    bars: Bar[],
    hint?: EntryHint,
    signal?: AbortSignal,
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
    const previous = hint !== undefined && hint.gen === gen ? hint.entry : await this._readEntry(key, interval);
    // Measured on what the SOURCE answered, before the forming bar was dropped:
    // "the server ran out" is a statement about the server, and an answer one
    // bar short because its newest bar is still open is not one.
    const entry = this._mergeEntry(previous, fresh, bars.length < ask.count, ask, interval, nowMs);
    if (entry === undefined) return;
    // An entry this build would refuse to read back is an entry not worth
    // writing: the next session would delete it and refetch anyway, and the
    // store would have carried it in the meantime for nothing.
    if (!this._validEntry(entry, interval, nowMs)) return;
    throwIfAborted(signal);
    const write = Symbol(key);
    this._latestWrite.set(key, write);
    // Memory first: a durable write that fails, or one a newer put overtakes,
    // must still leave this session holding the bars it just fetched.
    this._remember(key, entry);
    // Read-modify-write, not `gen + 1`: an `invalidate()` or an eviction may have
    // bumped the generation during the awaits above, and rewinding it would make
    // a hint taken before that drop look current again.
    this._gen.set(key, (this._gen.get(key) ?? 0) + 1);
    await this._writeBacking(key, entry);
    // A newer put claimed the key while this one was inside the store, so the
    // store now holds the loser. Put the winner back rather than leaving the
    // durable copy behind what memory already knows.
    if (this._latestWrite.get(key) !== write) {
      await this._restoreLatestBacking(key);
      throwIfAborted(signal);
      return;
    }
    // `invalidate()`, `clear()` or an eviction dropped the key while this write
    // was inside the store, and the store is now holding an entry the cache has
    // decided to forget. Memory is the record of that decision — the write put
    // this entry there itself, so its absence can only mean a drop — and the
    // durable copy has to follow it out. Without this, a put in flight
    // resurrected a series `invalidate()` had just removed, aborted or not.
    if (!this._memory.has(key)) {
      await this._deleteBacking(key);
      this._latestWrite.delete(key);
      throwIfAborted(signal);
      return;
    }
    if (signal?.aborted === true) {
      // The caller walked away while the store was busy, so this answer must not
      // be published. What was already there is a different question: dropping
      // the key outright threw away bars earlier, successful writes had put
      // here, and a cancelled request is no evidence against them. Only a key
      // this put CREATED goes.
      if (previous === undefined) await this._drop(key);
      else await this._restore(key, previous);
      this._latestWrite.delete(key);
      throwIfAborted(signal);
    }
    await this._evict();
    if (this._latestWrite.get(key) === write) this._latestWrite.delete(key);
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
    answeredShort: boolean,
    ask: BarsAsk,
    interval: string,
    nowMs: number,
  ): CachedBars | undefined {
    // One bar's span at a given start, for adjacency. Null (a tick series, an
    // unregistered code) collapses this to the plain seconds comparison.
    const spanAfter = (t: UTCSeconds): number => {
      const close = this._barCloses(interval, t);
      return close === null ? 1 : Math.max(1, close - t);
    };
    const freshLast = fresh[fresh.length - 1].time;
    const prevBars = previous === undefined ? [] : previous.bars;
    const prevFirst = prevBars.length === 0 ? 0 : prevBars[0].time;
    const prevLast = prevBars.length === 0 ? 0 : prevBars[prevBars.length - 1].time;
    let union = false;
    if (prevBars.length > 0) {
      // Adjacency is a question about the BAR GRID, not about seconds. An older
      // page whose last bar sits immediately before the entry's first bar is
      // contiguous, even though a whole span separates them in seconds;
      // comparing seconds there replaced a warm 2000-bar entry with the page
      // that was meant to extend it.
      //
      // The end term is the ASK, not the answer: a request that reached the
      // entry's left edge was told about everything down to its own last bar,
      // so a weekend between the two is a band the server ANSWERED and put no
      // bars in — a union, not a hole. Only a band nobody asked about is a hole,
      // and that still replaces.
      const startsInTime = (ask.from ?? fresh[0].time) <= prevLast + spanAfter(prevLast);
      const endsInTime = Math.max(ask.endSec + 1, freshLast + spanAfter(freshLast)) >= prevFirst;
      union = startsInTime && endsInTime;
    }
    // An older page the entry is not adjacent to must not TAKE ITS PLACE. This
    // is the shape a deep scroll-back makes once `maxBars` has trimmed the
    // entry: the painted anchor walks left past what the entry still holds, so
    // the fetch stops being adjacent, and replacing there threw away the tail —
    // the one part of an entry that must never go, since it is what a reload
    // paints and what the live subscription continues. The page is answered
    // from the network and simply not cached. Replacement survives for the
    // other disjoint shape, a fetch NEWER than a stale entry after a long
    // absence, where the tail is exactly what is being replaced.
    if (prevBars.length > 0 && !union && freshLast < prevFirst) return undefined;
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
    // ones a scroll-back can refetch cheaply. The entry then no longer holds the
    // left edge it was told about, so a request reaching further back misses and
    // refetches rather than being served a series that silently starts late.
    let trimmed = false;
    if (bars.length > this._maxBars) {
      // One series larger than the whole budget would evict everything else and
      // then itself on the next write, so it is simply not cached.
      if (fresh.length > this._maxBars) return undefined;
      bars = bars.slice(bars.length - this._maxBars);
      // The trim dropped everything this answer contributed, so the entry is
      // already exactly what it would be written as. Writing it would move
      // megabytes through IndexedDB to store what is there, and clear `short`
      // on the way. An entry is a WINDOW on the newest `maxBars` bars; a page
      // older than the window is not part of it.
      if (freshLast < bars[0].time) return undefined;
      trimmed = true;
    }
    const last = bars[bars.length - 1];
    // Non-null by construction: the caller only kept bars that had a close, and
    // `nextClose` is the close of the bar that follows the last one, which is
    // the instant a hit past coverage stops being safe.
    const lastClose = this._barCloses(interval, last.time) as UTCSeconds;
    const nextClose = this._barCloses(interval, lastClose) ?? lastClose;
    // `short` is a statement about the LEFT EDGE, so only an answer that
    // established one may set it: a replace (the fresh bars are the whole entry
    // now) or a union reaching at or past the oldest bar held. A tail fetch
    // coming back short says nothing about history and must not end paging.
    // A trim clears it, because the entry no longer holds the edge it spoke of.
    let short = answeredShort;
    let shortAt = nowMs;
    if (union && fresh[0].time > prevFirst) {
      short = previous!.short === true;
      // Carried, not restamped: an answer that established nothing about the
      // left edge cannot renew a belief about it either, or a chart taking its
      // tail every minute would keep an exhausted verdict alive for ever.
      shortAt = previous!.shortAt ?? nowMs;
    }
    if (trimmed) short = false;
    return {
      version: BAR_CACHE_VERSION,
      bars,
      // Derived, always: the entry describes the bars it holds, so a validator
      // reading it back can tell a truncated or corrupted blob from a real one
      // without being told what anybody once asked for.
      from: bars[0].time,
      to: (lastClose - 1) as UTCSeconds,
      short,
      shortAt,
      // `storedAt` answers "when was the TAIL last revalidated". An answer that
      // ends behind the newest bar the entry already held proves nothing about
      // it — and that is just as true when the fetch is disjoint enough to
      // replace the entry as when it unions, so the clock is carried over.
      storedAt: prevBars.length > 0 && freshLast < prevLast ? previous!.storedAt : nowMs,
      nextClose,
    };
  }

  private async _drop(key: string): Promise<void> {
    this._memory.delete(key);
    this._index.delete(key);
    // A hint taken before this drop must not be unioned against afterwards: it
    // would resurrect an entry the cache has just decided to forget.
    this._gen.set(key, (this._gen.get(key) ?? 0) + 1);
    await this._deleteBacking(key);
  }

  /**
   * Bring `max` and `maxBars` back. `durable` says whether the victim's stored
   * copy goes with its memory copy: a write that pushed the bounds over owns
   * what it evicts, while a peek is a look and may only forget.
   */
  private async _evict(durable = true): Promise<void> {
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
      if (durable) await this._drop(victim);
      else this._forget(victim);
    }
  }

  /** Drop the memory copy only, leaving whatever the store holds alone. */
  private _forget(key: string): void {
    this._memory.delete(key);
    this._index.delete(key);
    // A hint taken before this must not be unioned against: the next read comes
    // off the store, and the entry it finds may not be the one that was here.
    this._gen.set(key, (this._gen.get(key) ?? 0) + 1);
  }

  /** Take the entry into memory and into this session's bounds, as one act. */
  private _remember(key: string, entry: CachedBars): void {
    // A warm read hands back the object memory is already holding, and copying
    // it onto itself is pure cost: a 50k-bar entry peeked twenty times spent
    // 25 ms cloning bars nobody was going to mutate.
    if (this._memory.get(key) === entry) {
      this._index.set(key, { lastUsed: ++this._tick, bars: entry.bars.length });
      return;
    }
    const copy = this._cloneEntry(entry);
    this._memory.set(key, copy);
    this._index.set(key, { lastUsed: ++this._tick, bars: copy.bars.length });
  }

  /** Put a known-good entry back, in memory and in the store, after a failed put. */
  private async _restore(key: string, entry: CachedBars): Promise<void> {
    this._remember(key, entry);
    // A hint taken before the abandoned write must not be unioned against.
    this._gen.set(key, (this._gen.get(key) ?? 0) + 1);
    await this._writeBacking(key, entry);
  }

  /**
   * The entry for a key, from the durable store when it has something newer to
   * say and from memory otherwise.
   *
   * A durable read is best effort in both directions: a store that throws is
   * treated as a store that holds nothing, and a stored value that does not
   * describe itself correctly is deleted rather than painted — a half-written
   * IndexedDB record, an entry from a schema this build does not know, or one
   * whose newest bar has not closed yet all reach a chart as bars nobody can
   * source.
   *
   * Validation is skipped when memory already holds something at least as
   * recent, because that entry was validated on the way out and re-walking
   * every bar of it on every hit is the one cost this cache exists to avoid.
   */
  private async _readEntry(key: string, interval: string): Promise<CachedBars | undefined> {
    const memory = this._memory.get(key);
    if (this._backing === undefined || this._tombstones.has(key)) return memory;
    let stored: unknown;
    try {
      stored = await this._backing.get(key);
    } catch {
      return memory;
    }
    if (stored === undefined) return memory;
    const storedAt = (stored as Partial<CachedBars>).storedAt;
    if (memory !== undefined && typeof storedAt === 'number' && memory.storedAt >= storedAt) return memory;
    const nowMs = this._now();
    // A `storedAt` in the future is a clock that stepped backwards, not a
    // corrupt record: the bars are still bars, and deleting the entry for it
    // threw away a whole durable cache over a 30-second NTP correction. What
    // that entry cannot be trusted about is its TAIL — a bar the writing clock
    // thought had closed has not closed on ours — so the unclosed tail is cut
    // off and treated as never stored, rather than the whole entry being either
    // swallowed whole or thrown away.
    const candidate = typeof storedAt === 'number' && storedAt > nowMs
      ? this._trimUnclosed(stored, interval, nowMs) : stored;
    if (candidate === undefined || !this._validEntry(candidate, interval, nowMs)) {
      await this._deleteBacking(key);
      return memory;
    }
    const durable = this._cloneEntry(candidate);
    // The stamp can no longer vouch for freshness either, so it is read as
    // unrevalidated and the next request reaching the tail refetches once.
    if (durable.storedAt > nowMs) durable.storedAt = Math.max(0, nowMs - this._ttlMs - 1);
    return durable;
  }

  /**
   * The entry with every trailing bar that has not closed by `nowMs` removed,
   * its coverage and `nextClose` recomputed to match what is left. `undefined`
   * when nothing closed survives, and the value unchanged when the shape is not
   * one this can reason about — the validator has the last word either way.
   */
  private _trimUnclosed(value: unknown, interval: string, nowMs: number): unknown {
    if (typeof value !== 'object' || value === null) return value;
    const entry = value as Partial<CachedBars>;
    if (!Array.isArray(entry.bars) || entry.bars.length === 0) return value;
    const nowSec = Math.floor(nowMs / 1000);
    let end = entry.bars.length;
    while (end > 0) {
      const bar = entry.bars[end - 1] as Partial<Bar>;
      const close = typeof bar?.time === 'number' ? this._barCloses(interval, bar.time) : null;
      if (close !== null && close <= nowSec) break;
      end--;
    }
    if (end === entry.bars.length) return value;
    if (end === 0) return undefined;
    const bars = entry.bars.slice(0, end);
    const lastClose = this._barCloses(interval, bars[bars.length - 1].time) as UTCSeconds;
    return {
      ...entry,
      bars,
      to: (lastClose - 1) as UTCSeconds,
      nextClose: this._barCloses(interval, lastClose) ?? lastClose,
    };
  }

  /**
   * Whether a value is an entry this cache would stand behind: the right schema
   * version, coverage that matches the bars it holds, bars that are bars and
   * ascend, and a tail that has genuinely closed by now. Everything here is a
   * statement the entry makes about ITSELF, so it can be checked without
   * knowing what anybody asked for.
   */
  private _validEntry(value: unknown, interval: string, nowMs: number): value is CachedBars {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Partial<CachedBars>;
    if (candidate.version !== undefined && candidate.version !== BAR_CACHE_VERSION) return false;
    if (!Number.isInteger(candidate.from) || !Number.isInteger(candidate.to)) return false;
    if (!Number.isFinite(candidate.storedAt) || candidate.storedAt! < 0) return false;
    if (!Number.isInteger(candidate.nextClose)) return false;
    if (candidate.from! > candidate.to! || candidate.nextClose! <= candidate.to!) return false;
    if (!Array.isArray(candidate.bars) || candidate.bars.length === 0) return false;
    if (candidate.bars.length > this._maxBars || this._max < 1) return false;
    const nowSec = Math.floor(nowMs / 1000);
    let previous = -Infinity;
    let lastClose: number | null = null;
    for (const bar of candidate.bars) {
      if (!this._validBar(bar) || bar.time <= previous) return false;
      if (bar.time < candidate.from! || bar.time > candidate.to!) return false;
      lastClose = this._barCloses(interval, bar.time);
      // A bar that has not closed is the one thing this cache must never serve:
      // it keeps moving, and a chart painting it has no way to know.
      if (lastClose === null || lastClose > nowSec) return false;
      previous = bar.time;
    }
    const expectedNextClose = this._barCloses(interval, lastClose as UTCSeconds) ?? lastClose;
    return candidate.nextClose === expectedNextClose;
  }

  private _validBar(value: unknown): value is Bar {
    if (typeof value !== 'object' || value === null) return false;
    const bar = value as Partial<Bar>;
    if (!Number.isInteger(bar.time)) return false;
    if (![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) return false;
    if (bar.volume !== undefined && !Number.isFinite(bar.volume)) return false;
    return bar.color === undefined || typeof bar.color === 'string';
  }

  /** Bars are mutated in place by live builders, so nothing shares an array. */
  private _cloneEntry(entry: CachedBars): CachedBars {
    const copy: CachedBars = {
      bars: cloneBars(entry.bars),
      from: entry.from,
      to: entry.to,
      storedAt: entry.storedAt,
      nextClose: entry.nextClose,
    };
    if (entry.version !== undefined) copy.version = entry.version;
    // `short` and `shortAt` are the entry's belief about its own left edge, and
    // a copy that dropped them would start a chart paging into a closed weekend
    // again on the next reload.
    if (entry.short !== undefined) copy.short = entry.short;
    if (entry.shortAt !== undefined) copy.shortAt = entry.shortAt;
    return copy;
  }

  private async _writeBacking(key: string, entry: CachedBars): Promise<void> {
    if (this._backing === undefined) return;
    try {
      await this._backing.set(key, this._cloneEntry(entry));
      this._tombstones.delete(key);
    } catch {
      // The durable copy is now unknown: it may hold a previous entry, or half
      // of this one. Reading it again would be reading a guess, so this session
      // answers from memory for this key until a write succeeds.
      this._tombstones.add(key);
    }
  }

  private async _deleteBacking(key: string): Promise<void> {
    if (this._backing === undefined) return;
    try {
      await this._backing.delete(key);
      this._tombstones.delete(key);
    } catch {
      this._tombstones.add(key);
    }
  }

  private async _restoreLatestBacking(key: string): Promise<void> {
    const latest = this._memory.get(key);
    if (latest === undefined) await this._deleteBacking(key);
    else await this._writeBacking(key, latest);
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
