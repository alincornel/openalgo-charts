import { describe, it, expect } from 'vitest';
import type { Bar } from '../src/model/bar';
import type { BarsRequest, DataFeed, UnsubscribeFn } from '../src/feed/types';
import {
  withBarCache,
  barCacheKey,
  barCloseSec,

  type BarCacheStore,
  type CachedBars,
} from '../src/feed/cache';
import { registerInterval } from '../src/feed/intervals';

const T0 = 1_700_000_000; // arbitrary round epoch, UTC seconds
const MIN = 60;

function makeBars(start: number, count: number, intervalSec = MIN): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < count; i++) {
    const t = start + i * intervalSec;
    bars.push({ time: t, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10 * i });
  }
  return bars;
}

/** History-only stub feed that counts calls and honours the requested range. */
class StubFeed implements DataFeed {
  public calls: BarsRequest[] = [];
  public bars: Bar[] = [];
  public error: Error | null = null;

  public constructor(bars: Bar[] = []) {
    this.bars = bars;
  }

  public get count(): number {
    return this.calls.length;
  }

  public async getBars(req: BarsRequest): Promise<Bar[]> {
    this.calls.push({ ...req });
    if (this.error !== null) throw this.error;
    return this.bars
      .filter((b) => (req.from === undefined || b.time >= req.from) && (req.to === undefined || b.time <= req.to))
      .map((b) => ({ ...b }));
  }
}

/** Live stub: same, plus the optional subscription methods. */
class LiveStubFeed extends StubFeed {
  public subscribed = 0;
  public subscribeBars(_req: BarsRequest, _onBar: (bar: Bar) => void): UnsubscribeFn {
    this.subscribed++;
    return () => { this.subscribed--; };
  }
}

/** Async store that records every call, standing in for IndexedDB. */
class RecordingStore implements BarCacheStore {
  public readonly map = new Map<string, CachedBars>();
  public gets: string[] = [];
  public sets: string[] = [];
  public deletes: string[] = [];

  public async get(key: string): Promise<CachedBars | undefined> {
    this.gets.push(key);
    return this.map.get(key);
  }
  public async set(key: string, value: CachedBars): Promise<void> {
    this.sets.push(key);
    // Round-trip through JSON: proves the entry is persistable as-is.
    this.map.set(key, JSON.parse(JSON.stringify(value)) as CachedBars);
  }
  public async delete(key: string): Promise<void> {
    this.deletes.push(key);
    this.map.delete(key);
  }
}

const REQ: BarsRequest = { symbol: 'RELIANCE', exchange: 'NSE', interval: '1m', from: T0, to: T0 + 3600 };

/** 60 closed 1m bars, T0 .. T0+3540; the last one closes exactly at T0+3600. */
function closedSetup(overrides: { ttlMs?: number; max?: number; maxBars?: number; nowSec?: number } = {}) {
  const feed = new StubFeed(makeBars(T0, 60));
  let nowMs = (overrides.nowSec ?? T0 + 3600) * 1000;
  const cache = withBarCache(feed, {
    ttlMs: overrides.ttlMs ?? 10_000,
    max: overrides.max,
    maxBars: overrides.maxBars,
    now: () => nowMs,
  });
  return { feed, cache, advance: (sec: number) => { nowMs += sec * 1000; }, nowMs: () => nowMs };
}

describe('barCloseSec', () => {
  it('closes a fixed interval one span after the bar opens', () => {
    // One span after the bar OPENS, whatever the epoch grid says. T0 is 20s into
    // a minute, which is what a session-anchored feed looks like, and answering
    // from the grid there would report the bar closing 40s early.
    expect(barCloseSec('1m', T0)).toBe(T0 + 60);
    expect(barCloseSec('5m', T0)).toBe(T0 + 300);
    expect(barCloseSec('1h', T0)).toBe(T0 + 3600);
  });

  it('closes a registered calendar bar on the real boundary, not an average month', () => {
    // February 2024 is a leap month: 29 days, not the 30 an averaged span
    // assumes, and January is 31. A fixed duration is wrong for both.
    const dispose = registerInterval({
      code: 'MO',
      bucketing: { mode: 'calendar', unit: 'month', count: 1, timezone: 'UTC' },
    });
    try {
      const jan = Date.UTC(2024, 0, 1) / 1000;
      const feb = Date.UTC(2024, 1, 1) / 1000;
      expect(barCloseSec('MO', jan, 'UTC')).toBe(feb);
      expect(barCloseSec('MO', jan, 'UTC')! - jan).toBe(31 * 86_400);
      expect(barCloseSec('MO', feb, 'UTC')! - feb).toBe(29 * 86_400);
    } finally {
      dispose();
    }
  });

  it('refuses upper-case M rather than reading it as minutes', () => {
    // Every terminal reads lower-case m as minutes and upper-case M as a month.
    // Folding the two made a monthly bar close every sixty seconds.
    expect(barCloseSec('M', T0)).toBeNull();
    expect(barCloseSec('1M', T0)).toBeNull();
    expect(barCloseSec('1m', Math.floor(T0 / 60) * 60)).toBe(Math.floor(T0 / 60) * 60 + 60);
  });

  it('returns null rather than guessing, which is what the old parser got wrong', () => {
    // An unregistered code used to resolve to 60 seconds, so a cache keyed on it
    // served a stale tail for a minute at a time.
    expect(barCloseSec('renko-10', T0)).toBeNull();
    expect(barCloseSec('not-an-interval', T0)).toBeNull();
  });
});

describe('barCacheKey', () => {
  it('separates symbol, exchange and interval', () => {
    expect(barCacheKey({ symbol: 'X', exchange: 'NSE', interval: '5m' })).toBe('X|NSE|5m');
    expect(barCacheKey({ symbol: 'X', exchange: 'BSE', interval: '5m' }))
      .not.toBe(barCacheKey({ symbol: 'X', exchange: 'NSE', interval: '5m' }));
  });
});

describe('BarCache hit and miss', () => {
  it('serves a repeat request without touching the network', async () => {
    const { feed, cache } = closedSetup();
    const first = await cache.getBars(REQ);
    expect(feed.count).toBe(1);
    const second = await cache.getBars(REQ);
    expect(feed.count).toBe(1);
    expect(second).toEqual(first);
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, entries: 1 });
  });

  it('misses on a different symbol, exchange or interval', async () => {
    const { feed, cache } = closedSetup();
    await cache.getBars(REQ);
    await cache.getBars({ ...REQ, symbol: 'TCS' });
    expect(feed.count).toBe(2);
    await cache.getBars({ ...REQ, exchange: 'BSE' });
    expect(feed.count).toBe(3);
    await cache.getBars({ ...REQ, interval: '5m' });
    expect(feed.count).toBe(4);
  });

  it('expires on TTL', async () => {
    const { feed, cache, advance } = closedSetup({ ttlMs: 10_000 });
    await cache.getBars(REQ);
    advance(9);
    await cache.getBars(REQ);
    expect(feed.count).toBe(1);
    advance(2); // 11s total, past the 10s TTL
    await cache.getBars(REQ);
    expect(feed.count).toBe(2);
  });

  it('does not cache an empty result', async () => {
    const feed = new StubFeed([]);
    const cache = withBarCache(feed, { now: () => (T0 + 3600) * 1000 });
    expect(await cache.getBars(REQ)).toEqual([]);
    await cache.getBars(REQ);
    expect(feed.count).toBe(2);
    expect(cache.stats().entries).toBe(0);
  });
});

describe('BarCache range coverage', () => {
  it('satisfies a narrower request from a wider cached range', async () => {
    const { feed, cache } = closedSetup();
    await cache.getBars(REQ);
    const narrow = await cache.getBars({ ...REQ, from: T0 + 600, to: T0 + 1200 });
    expect(feed.count).toBe(1);
    expect(narrow.map((b) => b.time)).toEqual([T0 + 600, T0 + 660, T0 + 720, T0 + 780, T0 + 840, T0 + 900,
      T0 + 960, T0 + 1020, T0 + 1080, T0 + 1140, T0 + 1200]);
  });

  it('misses when the request reaches further back than the cached range', async () => {
    const { feed, cache } = closedSetup();
    await cache.getBars({ ...REQ, from: T0 + 600 });
    await cache.getBars({ ...REQ, from: T0 });
    expect(feed.count).toBe(2);
  });

  it('misses when the request reaches past a bar that has since closed', async () => {
    const { feed, cache, advance } = closedSetup({ ttlMs: 10 * 60_000 });
    await cache.getBars(REQ); // covers through T0+3599
    advance(59); // still inside the forming T0+3600 bar
    await cache.getBars({ ...REQ, to: T0 + 3659 });
    expect(feed.count).toBe(1);
    advance(1); // the T0+3600 bar has now closed: a fresh fetch would return more
    await cache.getBars({ ...REQ, to: T0 + 3660 });
    expect(feed.count).toBe(2);
  });

  it('serves a request that ends inside the cached range regardless of the clock', async () => {
    const { feed, cache, advance } = closedSetup({ ttlMs: 60 * 60_000 });
    await cache.getBars(REQ);
    advance(600); // ten new bars would exist by now
    await cache.getBars({ ...REQ, to: T0 + 1200 }); // but this range is fully closed history
    expect(feed.count).toBe(1);
  });
});

describe('BarCache forming bar rule', () => {
  it('never stores or serves the currently forming bar', async () => {
    // 61 bars: T0 .. T0+3600. At T0+3630 the last one is still forming.
    const feed = new StubFeed(makeBars(T0, 61));
    let nowMs = (T0 + 3630) * 1000;
    const cache = withBarCache(feed, { ttlMs: 10 * 60_000, now: () => nowMs });

    const live = await cache.getBars(REQ);
    expect(live[live.length - 1].time).toBe(T0 + 3600); // the feed's own answer includes it

    // The forming bar moves. A cache that served its old close would paint a
    // frozen candle; this one has not kept it at all.
    feed.bars[60] = { ...feed.bars[60], close: 999, high: 1000 };
    const warm = await cache.getBars(REQ);
    expect(feed.count).toBe(1); // still a hit
    expect(warm[warm.length - 1].time).toBe(T0 + 3540);
    expect(warm.some((b) => b.close === 999)).toBe(false);

    // Once that bar closes, the entry no longer covers what is available.
    nowMs = (T0 + 3661) * 1000;
    const refetched = await cache.getBars({ ...REQ, to: T0 + 3661 });
    expect(feed.count).toBe(2);
    expect(refetched[refetched.length - 1].close).toBe(999);
  });

  it('caches nothing when every returned bar is still forming', async () => {
    const feed = new StubFeed(makeBars(T0 + 3600, 1));
    const cache = withBarCache(feed, { now: () => (T0 + 3630) * 1000 });
    await cache.getBars({ ...REQ, from: T0 + 3600, to: T0 + 3660 });
    await cache.getBars({ ...REQ, from: T0 + 3600, to: T0 + 3660 });
    expect(feed.count).toBe(2);
    expect(cache.stats().entries).toBe(0);
  });
});

describe('BarCache bounds', () => {
  it('evicts the least recently used entry over the entry cap', async () => {
    const { feed, cache } = closedSetup({ max: 2 });
    await cache.getBars({ ...REQ, symbol: 'A' });
    await cache.getBars({ ...REQ, symbol: 'B' });
    await cache.getBars({ ...REQ, symbol: 'A' }); // A is now the most recent
    expect(feed.count).toBe(2);
    await cache.getBars({ ...REQ, symbol: 'C' }); // evicts B
    expect(cache.stats()).toMatchObject({ entries: 2, evictions: 1 });
    await cache.getBars({ ...REQ, symbol: 'A' });
    expect(feed.count).toBe(3); // A survived
    await cache.getBars({ ...REQ, symbol: 'B' });
    expect(feed.count).toBe(4); // B was evicted
  });

  it('evicts on the total bar cap, not just the entry count', async () => {
    const { feed, cache } = closedSetup({ max: 10, maxBars: 100 });
    await cache.getBars({ ...REQ, symbol: 'A' }); // 60 bars
    expect(cache.stats().bars).toBe(60);
    await cache.getBars({ ...REQ, symbol: 'B' }); // 120 > 100, so A goes
    expect(cache.stats()).toMatchObject({ entries: 1, bars: 60, evictions: 1 });
    await cache.getBars({ ...REQ, symbol: 'A' });
    expect(feed.count).toBe(3);
  });

  it('refuses to cache a single series larger than the whole budget', async () => {
    const { cache } = closedSetup({ maxBars: 10 });
    await cache.getBars(REQ);
    expect(cache.stats()).toMatchObject({ entries: 0, evictions: 0 });
  });
});

describe('BarCache injected storage', () => {
  it('reads and writes through the injected store', async () => {
    const store = new RecordingStore();
    const feed = new StubFeed(makeBars(T0, 60));
    const cache = withBarCache(feed, { storage: store, ttlMs: 10_000, now: () => (T0 + 3600) * 1000 });
    await cache.getBars(REQ);
    expect(store.sets).toEqual(['RELIANCE|NSE|1m']);
    await cache.getBars(REQ);
    expect(feed.count).toBe(1);
    // Two lookups and no more: the entry the first lookup read is handed to the
    // put, so filling the entry does not read it back.
    expect(store.gets.length).toBe(2);
    expect(store.map.get('RELIANCE|NSE|1m')?.bars.length).toBe(60);
  });

  it('warm-loads from a store filled by an earlier session', async () => {
    const store = new RecordingStore();
    const previous = new StubFeed(makeBars(T0, 60));
    const first = withBarCache(previous, { storage: store, ttlMs: 60_000, now: () => (T0 + 3600) * 1000 });
    await first.getBars(REQ);

    // New process, new cache instance, same store. No network at all.
    const feed = new StubFeed(makeBars(T0, 60));
    const second = withBarCache(feed, { storage: store, ttlMs: 60_000, now: () => (T0 + 3610) * 1000 });
    const bars = await second.getBars(REQ);
    expect(feed.count).toBe(0);
    expect(bars.length).toBe(60);
  });

  it('keeps an expired entry in the store rather than deleting it', async () => {
    // The TTL only says the TAIL needs revalidating. The closed bars behind it
    // are still the fastest correct paint available, so the entry is rewritten
    // by the refetch, never thrown away.
    const store = new RecordingStore();
    const feed = new StubFeed(makeBars(T0, 60));
    let nowMs = (T0 + 3600) * 1000;
    const cache = withBarCache(feed, { storage: store, ttlMs: 10_000, now: () => nowMs });
    await cache.getBars(REQ);
    nowMs += 11_000;
    await cache.getBars(REQ);
    expect(feed.count).toBe(2);
    expect(store.deletes).not.toContain('RELIANCE|NSE|1m');
    expect(store.map.get('RELIANCE|NSE|1m')?.bars.length).toBe(60);
  });
});

describe('BarCache failure handling', () => {
  it('does not cache anything when the fetch rejects', async () => {
    const feed = new StubFeed(makeBars(T0, 60));
    feed.error = new Error('network down');
    const cache = withBarCache(feed, { now: () => (T0 + 3600) * 1000 });
    await expect(cache.getBars(REQ)).rejects.toThrow('network down');
    expect(cache.stats().entries).toBe(0);
    feed.error = null;
    expect((await cache.getBars(REQ)).length).toBe(60);
    expect(feed.count).toBe(2);
  });

  it('leaves a good entry intact when a later forced fetch fails', async () => {
    const feed = new StubFeed(makeBars(T0, 60));
    const cache = withBarCache(feed, { ttlMs: 10 * 60_000, now: () => (T0 + 3600) * 1000 });
    await cache.getBars(REQ);
    feed.error = new Error('network down');
    await expect(cache.getBars({ ...REQ, noCache: true })).rejects.toThrow('network down');
    feed.error = null;
    const bars = await cache.getBars(REQ);
    expect(bars.length).toBe(60);
    expect(feed.count).toBe(2); // the initial fill and the failed forced fetch
  });
});

describe('BarCache opt-out and invalidation', () => {
  it('noCache always fetches and refreshes the entry', async () => {
    const { feed, cache } = closedSetup({ ttlMs: 10 * 60_000 });
    await cache.getBars(REQ);
    feed.bars = makeBars(T0, 60).map((b) => ({ ...b, close: b.close + 5 }));
    await cache.getBars({ ...REQ, noCache: true });
    expect(feed.count).toBe(2);
    const after = await cache.getBars(REQ); // served from the refreshed entry
    expect(feed.count).toBe(2);
    expect(after[0].close).toBe(feed.bars[0].close);
  });

  it('invalidate drops one series and clear drops all of them', async () => {
    const { feed, cache } = closedSetup({ ttlMs: 10 * 60_000 });
    await cache.getBars({ ...REQ, symbol: 'A' });
    await cache.getBars({ ...REQ, symbol: 'B' });
    await cache.invalidate({ symbol: 'A', exchange: 'NSE', interval: '1m' });
    expect(cache.stats().entries).toBe(1);
    await cache.getBars({ ...REQ, symbol: 'A' });
    expect(feed.count).toBe(3);
    await cache.getBars({ ...REQ, symbol: 'B' });
    expect(feed.count).toBe(3);
    await cache.clear();
    expect(cache.stats().entries).toBe(0);
    await cache.getBars({ ...REQ, symbol: 'B' });
    expect(feed.count).toBe(4);
  });

  it('passes an open-ended request straight through, uncached', async () => {
    const { feed, cache } = closedSetup();
    await cache.getBars({ symbol: 'RELIANCE', exchange: 'NSE', interval: '1m' });
    await cache.getBars({ symbol: 'RELIANCE', exchange: 'NSE', interval: '1m' });
    expect(feed.count).toBe(2);
    expect(cache.stats().entries).toBe(0);
  });

  it('a barCloses override returning null opts that interval out', async () => {
    const feed = new StubFeed(makeBars(T0, 60));
    const cache = withBarCache(feed, {
      now: () => (T0 + 3600) * 1000,
      barCloses: (i: string, t: number) => (i === '1m' ? null : t + 60),
    });
    await cache.getBars(REQ);
    await cache.getBars(REQ);
    expect(feed.count).toBe(2);
  });

  it('refuses to cache a series whose bars have no knowable close', async () => {
    // A tick-count series is the real case: a 500-tick bar may run a second or an
    // hour, so nothing about elapsed time says the last one is complete. The old
    // parser answered 60 seconds and cached it anyway.
    const feed = new StubFeed(makeBars(T0, 60));
    const cache = withBarCache(feed, { now: () => (T0 + 3600) * 1000 });
    await cache.getBars({ ...REQ, interval: 'T500' });
    await cache.getBars({ ...REQ, interval: 'T500' });
    expect(feed.count).toBe(2);
    expect(cache.stats().entries).toBe(0);
  });
});

describe('BarCache isolation and passthrough', () => {
  it('hands out copies so a caller mutating a hit cannot corrupt the cache', async () => {
    const { cache } = closedSetup({ ttlMs: 10 * 60_000 });
    await cache.getBars(REQ); // fill
    const hit = await cache.getBars(REQ);
    hit[0].close = -1; // a live chart mutates its last bar in place; so might any caller
    hit.length = 1;
    const again = await cache.getBars(REQ);
    expect(again.length).toBe(60);
    expect(again[0].close).toBe(100.5);
  });

  it('stores copies so the wrapped feed mutating its own bars cannot corrupt the cache', async () => {
    // A feed that hands back the very objects it keeps, as a live builder does.
    const held = makeBars(T0, 60);
    const feed: DataFeed = {
      getBars: async (req) => held.filter((b) => b.time >= req.from! && b.time <= req.to!),
    };
    const cache = withBarCache(feed, { ttlMs: 10 * 60_000, now: () => (T0 + 3600) * 1000 });
    await cache.getBars(REQ);
    held[0].close = -1;
    const hit = await cache.getBars(REQ);
    expect(hit[0].close).toBe(100.5);
  });

  it('exposes subscribeBars only when the wrapped feed has it', async () => {
    const historyOnly = withBarCache(new StubFeed());
    expect(historyOnly.subscribeBars).toBeUndefined();

    const live = new LiveStubFeed();
    const wrapped = withBarCache(live);
    expect(typeof wrapped.subscribeBars).toBe('function');
    const off = wrapped.subscribeBars!(REQ, () => {});
    expect(live.subscribed).toBe(1);
    off();
    expect(live.subscribed).toBe(0);
    expect(wrapped.source).toBe(live);
  });
});

/**
 * Bars T0 .. T0+99m against a clock 30s into the T0+99m bar, so the newest bar
 * the stub returns is still forming and is dropped on store. That is the shape
 * a live chart actually fetches in.
 */
const UNION_NOW_MS = (T0 + 99 * MIN + 30) * 1000;
const UNION_KEY = 'X|E|1m';
const UNION_REQ = { symbol: 'X', exchange: 'E', interval: '1m' };

function unionSetup(overrides: { max?: number; maxBars?: number; nowMs?: number } = {}) {
  const store = new RecordingStore();
  const feed = new StubFeed(makeBars(T0, 100));
  let nowMs = overrides.nowMs ?? UNION_NOW_MS;
  const cache = withBarCache(feed, {
    storage: store,
    max: overrides.max,
    maxBars: overrides.maxBars,
    now: () => nowMs,
  });
  return { store, feed, cache, setNow: (ms: number) => { nowMs = ms; } };
}

describe('BarCache._put union', () => {
  it('extends an entry with a tail fetch instead of shrinking it to the tail', async () => {
    const { store, cache } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN, noCache: true });
    await cache.getBars({ ...UNION_REQ, from: T0 + 90 * MIN, to: T0 + 99 * MIN, noCache: true });
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(99); // was 9 before this change: the tail replaced the page
    expect(entry.bars[0].time).toBe(T0);
    expect(entry.bars[entry.bars.length - 1].time).toBe(T0 + 98 * MIN);
  });

  it('lets the fresh bar win on a timestamp both ranges carry', async () => {
    const { store, feed, cache } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN, noCache: true });
    // A closed bar the server later corrects: a late print, a backend heal.
    feed.bars[95] = { ...feed.bars[95], close: 999 };
    await cache.getBars({ ...UNION_REQ, from: T0 + 90 * MIN, to: T0 + 99 * MIN, noCache: true });
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.find((b) => b.time === T0 + 95 * MIN)!.close).toBe(999);
    // and a bar the second range never covered is untouched
    expect(entry.bars.find((b) => b.time === T0 + 10 * MIN)!.close).toBe(110.5);
  });

  it('extends coverage backwards for an older page', async () => {
    const { store, cache } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0 + 50 * MIN, to: T0 + 99 * MIN, noCache: true });
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 50 * MIN, noCache: true });
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(99);
    expect(entry.bars[0].time).toBe(T0);
  });

  it('unions two pages that are adjacent on the bar grid', async () => {
    const { store, cache } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0 + 50 * MIN, to: T0 + 99 * MIN, noCache: true });
    // The older page's last bar sits immediately before the entry's first one:
    // contiguous on the bar grid, one whole span apart in seconds.
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 49 * MIN, noCache: true });
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(99);
    expect(entry.bars[0].time).toBe(T0);
  });

  it('still replaces when an older page leaves a bar-sized hole', async () => {
    const { store, cache } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0 + 50 * MIN, to: T0 + 99 * MIN, noCache: true });
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 48 * MIN, noCache: true }); // T0+49m missing
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(49);
    expect(entry.bars[0].time).toBe(T0);
  });

  it('replaces, not unions, when the two ranges leave a hole', async () => {
    const { store, cache } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 9 * MIN, noCache: true });
    await cache.getBars({ ...UNION_REQ, from: T0 + 50 * MIN, to: T0 + 59 * MIN, noCache: true });
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(10);
    expect(entry.bars[0].time).toBe(T0 + 50 * MIN);
  });

  it('drops a cached bar the server no longer reports inside the refetched window', async () => {
    const { store, feed, cache } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN, noCache: true });
    // A corrected bucketing: the server stops reporting a bar we hold. Leaving
    // it would paint a ghost candle nothing on the server agrees with.
    feed.bars = feed.bars.filter((b) => b.time !== T0 + 95 * MIN);
    await cache.getBars({ ...UNION_REQ, from: T0 + 90 * MIN, to: T0 + 99 * MIN, noCache: true });
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.some((b) => b.time === T0 + 95 * MIN)).toBe(false);
    expect(entry.bars.length).toBe(98);
    expect(entry.bars[0].time).toBe(T0);
  });

  it('keeps cached bars outside the range the server actually returned', async () => {
    const { store, feed, cache } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN, noCache: true });
    // The server answers SHORT at the left edge of what we asked for. Deleting
    // up to the requested `from` would punch a hole in bars it never covered.
    feed.bars = feed.bars.filter((b) => b.time < T0 + 90 * MIN || b.time >= T0 + 95 * MIN);
    await cache.getBars({ ...UNION_REQ, from: T0 + 90 * MIN, to: T0 + 99 * MIN, noCache: true });
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(99);
    for (let i = 90; i < 95; i++) expect(entry.bars.some((b) => b.time === T0 + i * MIN)).toBe(true);
  });

  it('keeps the newest bars and drops the left edge when the union exceeds maxBars', async () => {
    const { store, cache } = unionSetup({ maxBars: 50 });
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 39 * MIN, noCache: true });
    await cache.getBars({ ...UNION_REQ, from: T0 + 30 * MIN, to: T0 + 69 * MIN, noCache: true });
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(50);
    expect(entry.bars[0].time).toBe(T0 + 20 * MIN);
    expect(entry.bars[49].time).toBe(T0 + 69 * MIN);
  });

  it('does not restart the freshness clock on an older-page put', async () => {
    const { store, cache, setNow } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0 + 50 * MIN, to: T0 + 99 * MIN, noCache: true });
    const tailStoredAt = store.map.get(UNION_KEY)!.storedAt;
    setNow(UNION_NOW_MS + 60_000);
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 50 * MIN, noCache: true });
    expect(store.map.get(UNION_KEY)!.storedAt).toBe(tailStoredAt);
  });

  it('does not restart the freshness clock when a replace lands an older page', async () => {
    const { store, cache, setNow } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0 + 50 * MIN, to: T0 + 99 * MIN, noCache: true });
    const tailStoredAt = store.map.get(UNION_KEY)!.storedAt;
    setNow(UNION_NOW_MS + 60_000);
    // A hole, so this replaces — but it is still an older page, and it
    // revalidates nothing about any tail.
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 40 * MIN, noCache: true });
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(41);
    expect(entry.storedAt).toBe(tailStoredAt);
  });

  it('unions a fresh range that sits strictly inside the entry', async () => {
    const { store, cache, setNow } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN, noCache: true });
    const before = store.map.get(UNION_KEY)!;
    setNow(UNION_NOW_MS + 60_000);
    await cache.getBars({ ...UNION_REQ, from: T0 + 50 * MIN, to: T0 + 59 * MIN, noCache: true });
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(99);
    expect(entry.bars[0].time).toBe(T0);
    expect(entry.nextClose).toBe(before.nextClose);
    expect(entry.storedAt).toBe(before.storedAt); // an interior page proves nothing about the tail
  });

  it('keeps one entry for an identical re-request', async () => {
    const { store, cache, setNow } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN, noCache: true });
    const before = store.map.get(UNION_KEY)!;
    setNow(UNION_NOW_MS + 10_000); // still inside the forming bar, so nothing new closed
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN, noCache: true });
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(99); // no duplication, no shrink
    expect(entry.bars[0].time).toBe(T0);
    expect(entry.nextClose).toBe(before.nextClose);
    expect(entry.storedAt).toBe(UNION_NOW_MS + 10_000); // this one DID revalidate the tail
  });

  it('leaves the entry untouched when the fetch returns only a forming bar', async () => {
    const { store, cache } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN, noCache: true });
    const writes = store.sets.length;
    await cache.getBars({ ...UNION_REQ, from: T0 + 99 * MIN, to: T0 + 99 * MIN, noCache: true });
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(99);
    expect(store.sets.length).toBe(writes); // nothing was written at all
  });

  it('leaves the previous entry intact when the fresh page alone exceeds maxBars', async () => {
    const { store, cache } = unionSetup({ maxBars: 50 });
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 39 * MIN, noCache: true });
    await cache.getBars({ ...UNION_REQ, from: T0 + 30 * MIN, to: T0 + 99 * MIN, noCache: true }); // 69 bars
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(40);
    expect(entry.bars[0].time).toBe(T0);
  });

  it('still drops the trailing unclosed bar after a union', async () => {
    const { store, cache, setNow } = unionSetup({ nowMs: (T0 + 50 * MIN + 30) * 1000 });
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 49 * MIN, noCache: true });
    setNow((T0 + 60 * MIN + 30) * 1000);
    await cache.getBars({ ...UNION_REQ, from: T0 + 45 * MIN, to: T0 + 61 * MIN, noCache: true });
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(60);
    expect(entry.bars[entry.bars.length - 1].time).toBe(T0 + 59 * MIN);
    expect(entry.bars.some((b) => b.time === T0 + 60 * MIN)).toBe(false);
  });
});

describe('BarCache TTL as a tail gate', () => {
  const DAY = 86_400;

  function ttlSetup(ttlMs = 10_000) {
    const store = new RecordingStore();
    const feed = new StubFeed(makeBars(T0, 100));
    let nowMs = UNION_NOW_MS;
    const cache = withBarCache(feed, { storage: store, ttlMs, now: () => nowMs });
    return { store, feed, cache, setNow: (ms: number) => { nowMs = ms; } };
  }

  it('serves closed bars from an entry older than the TTL when the request stops short of the tail', async () => {
    const { feed, cache, setNow } = ttlSetup();
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN });
    expect(feed.count).toBe(1);
    setNow(UNION_NOW_MS + DAY * 1000); // a day later: every one of those bars is still closed
    const bars = await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 50 * MIN });
    expect(feed.count).toBe(1);
    expect(bars.length).toBe(51);
    expect(bars[0].time).toBe(T0);
  });

  it('refetches when the request reaches into the last two bar spans', async () => {
    const { feed, cache, setNow } = ttlSetup();
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN });
    const laterMs = UNION_NOW_MS + DAY * 1000;
    setNow(laterMs);
    await cache.getBars({ ...UNION_REQ, from: T0, to: Math.floor(laterMs / 1000) });
    expect(feed.count).toBe(2);
  });

  it('keeps the entry instead of deleting it when the TTL has passed', async () => {
    const { store, cache, setNow } = ttlSetup();
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN });
    const laterMs = UNION_NOW_MS + DAY * 1000;
    setNow(laterMs);
    await cache.getBars({ ...UNION_REQ, from: T0, to: Math.floor(laterMs / 1000) });
    expect(store.deletes).not.toContain(UNION_KEY);
    expect(store.map.has(UNION_KEY)).toBe(true);
  });

  it('still refetches an unexpired entry whose coverage ended before the next close', async () => {
    const { feed, cache, setNow } = ttlSetup(10 * 60_000);
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN });
    setNow((T0 + 99 * MIN + 59) * 1000); // the T0+99m bar is still forming
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN + 59 });
    expect(feed.count).toBe(1);
    setNow((T0 + 100 * MIN + 1) * 1000); // it has closed: a fresh fetch would return more
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 100 * MIN + 1 });
    expect(feed.count).toBe(2);
  });
});

describe('BarCache.peek', () => {
  it('returns undefined for an unknown series without touching the feed', async () => {
    const { feed, cache } = unionSetup();
    expect(await cache.peek(UNION_REQ)).toBeUndefined();
    expect(feed.count).toBe(0);
  });

  it('returns the cached closed bars and what it knows about them, without fetching', async () => {
    const { store, feed, cache } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN });
    const before = cache.stats();
    const peeked = (await cache.peek(UNION_REQ))!;
    const entry = store.map.get(UNION_KEY)!;
    expect(feed.count).toBe(1);
    expect(peeked.bars.length).toBe(99);
    // The forming bar was dropped on store, so it is not here to be served.
    expect(peeked.bars[peeked.bars.length - 1].time).toBe(T0 + 98 * MIN);
    expect(peeked.storedAt).toBe(entry.storedAt);
    expect(peeked.nextClose).toBe(entry.nextClose);
    // A peek is neither a hit nor a miss: it is a look, not a request.
    expect(cache.stats()).toMatchObject({ hits: before.hits, misses: before.misses });
  });

  it('slices to the requested window', async () => {
    const { cache } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN });
    const peeked = (await cache.peek({ ...UNION_REQ, from: T0 + 50 * MIN, to: T0 + 59 * MIN }))!;
    expect(peeked.bars.length).toBe(10);
    expect(peeked.bars[0].time).toBe(T0 + 50 * MIN);
    expect(peeked.bars[peeked.bars.length - 1].time).toBe(T0 + 59 * MIN);
  });

  it('reports an entry whose bars fall outside the window as empty, not missing', async () => {
    // The two empty answers mean different things: `undefined` is "nothing
    // stored, load it cold", while an entry with no bars in the window is an
    // entry whose bars are somewhere else — a windowless peek says where.
    const { cache } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0 + 50 * MIN, to: T0 + 99 * MIN, noCache: true });
    const peeked = await cache.peek({ ...UNION_REQ, from: T0, to: T0 + 10 * MIN });
    expect(peeked).toBeDefined();
    expect(peeked!.bars).toEqual([]);
    expect((await cache.peek(UNION_REQ))!.bars[0].time).toBe(T0 + 50 * MIN);
  });

  it('returns an entry the TTL would have rejected', async () => {
    const store = new RecordingStore();
    const feed = new StubFeed(makeBars(T0, 100));
    let nowMs = UNION_NOW_MS;
    const cache = withBarCache(feed, { storage: store, ttlMs: 10_000, now: () => nowMs });
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN });
    nowMs += 86_400_000;
    const peeked = (await cache.peek(UNION_REQ))!;
    expect(peeked.bars.length).toBe(99);
    expect(feed.count).toBe(1);
  });

  it('hands out clones', async () => {
    const { cache } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN });
    const first = (await cache.peek(UNION_REQ))!;
    first.bars[0].close = -1;
    first.bars.length = 1;
    const second = (await cache.peek(UNION_REQ))!;
    expect(second.bars.length).toBe(99);
    expect(second.bars[0].close).toBe(100.5);
  });

  it('reads a store filled by an earlier session, with a cold in-memory index', async () => {
    // The reload path: a fresh cache instance knows nothing, but the store is
    // warm. `peek` must answer from it without a fetch.
    const store = new RecordingStore();
    const earlier = withBarCache(new StubFeed(makeBars(T0, 100)), { storage: store, now: () => UNION_NOW_MS });
    await earlier.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN });

    const feed = new StubFeed(makeBars(T0, 100));
    const cache = withBarCache(feed, { storage: store, now: () => UNION_NOW_MS + 86_400_000 });
    expect(cache.stats().entries).toBe(0);
    const peeked = (await cache.peek(UNION_REQ))!;
    expect(peeked.bars.length).toBe(99);
    expect(feed.count).toBe(0);
    // and the peek adopts it, so this session's bounds now account for it
    expect(cache.stats().entries).toBe(1);
  });

  it('touches LRU recency so the peeked entry is not the next victim', async () => {
    const { store, cache } = unionSetup({ max: 2 });
    await cache.getBars({ ...UNION_REQ, symbol: 'A', from: T0, to: T0 + 99 * MIN });
    await cache.getBars({ ...UNION_REQ, symbol: 'B', from: T0, to: T0 + 99 * MIN });
    expect(await cache.peek({ ...UNION_REQ, symbol: 'A' })).toBeDefined(); // A is now the most recent
    await cache.getBars({ ...UNION_REQ, symbol: 'C', from: T0, to: T0 + 99 * MIN }); // evicts B
    expect(store.map.has('B|E|1m')).toBe(false);
    expect((await cache.peek({ ...UNION_REQ, symbol: 'A' }))!.bars.length).toBe(99);
  });
});

/** Every store operation crosses a task boundary, the way IndexedDB does. */
const tick = (): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

class SlowStore extends RecordingStore {
  public async get(key: string): Promise<CachedBars | undefined> {
    await tick();
    return super.get(key);
  }
  public async set(key: string, value: CachedBars): Promise<void> {
    await tick();
    return super.set(key, value);
  }
}

class SlowFeed extends StubFeed {
  public async getBars(req: BarsRequest): Promise<Bar[]> {
    await tick();
    return super.getBars(req);
  }
}

describe('BarCache._put concurrency', () => {
  const TAIL = { from: T0 + 50 * MIN, to: T0 + 99 * MIN };
  const PAGE = { from: T0, to: T0 + 50 * MIN };

  function slowSetup() {
    const store = new SlowStore();
    const feed = new SlowFeed(makeBars(T0, 100));
    const cache = withBarCache(feed, { storage: store, now: () => UNION_NOW_MS });
    return { store, cache };
  }

  it('ends with the union when the two puts run in sequence', async () => {
    const { store, cache } = slowSetup();
    await cache.getBars({ ...UNION_REQ, ...TAIL, noCache: true });
    await cache.getBars({ ...UNION_REQ, ...PAGE, noCache: true });
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(99);
    expect(entry.bars[0].time).toBe(T0);
  });

  it('re-reads the entry when a queued write has invalidated the hint', async () => {
    // Both lookups miss and both carry the entry they read (nothing) into their
    // put. The second put runs behind the first, so its hint is stale and must
    // be thrown away rather than unioned against.
    const { store, cache } = slowSetup();
    await Promise.all([
      cache.getBars({ ...UNION_REQ, ...TAIL }),
      cache.getBars({ ...UNION_REQ, ...PAGE }),
    ]);
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(99);
    expect(entry.bars[0].time).toBe(T0);
  });

  it('ends with the union when the two puts race', async () => {
    // An older-page lazy load racing a resume recovery. Both read the entry
    // before either writes, so an unguarded put loses one of them outright.
    const { store, cache } = slowSetup();
    await Promise.all([
      cache.getBars({ ...UNION_REQ, ...TAIL, noCache: true }),
      cache.getBars({ ...UNION_REQ, ...PAGE, noCache: true }),
    ]);
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(99);
    expect(entry.bars[0].time).toBe(T0);
  });
});

/** A store that can list what it holds, as IndexedDB and localStorage both can. */
class ListingStore extends RecordingStore {
  public async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
}

describe('BarCache.prune', () => {
  const DAY_MS = 86_400_000;
  const WHOLE = { from: T0, to: T0 + 99 * MIN };

  it('deletes a stale key this session never touched', async () => {
    const store = new ListingStore();
    const earlier = withBarCache(new StubFeed(makeBars(T0, 100)), { storage: store, now: () => UNION_NOW_MS });
    await earlier.getBars({ ...UNION_REQ, ...WHOLE });

    // A new session: the in-memory index is empty, so eviction can never see
    // this key and it would otherwise sit in IndexedDB for ever.
    const feed = new StubFeed(makeBars(T0, 100));
    const cache = withBarCache(feed, { storage: store, now: () => UNION_NOW_MS + 3 * DAY_MS });
    expect(cache.stats().entries).toBe(0);
    expect(await cache.prune(2 * DAY_MS)).toBe(1);
    expect(store.map.has(UNION_KEY)).toBe(false);
    expect(await cache.peek(UNION_REQ)).toBeUndefined();
  });

  it('keeps an entry inside the cutoff', async () => {
    const store = new ListingStore();
    const cache = withBarCache(new StubFeed(makeBars(T0, 100)), { storage: store, now: () => UNION_NOW_MS });
    await cache.getBars({ ...UNION_REQ, ...WHOLE });
    expect(await cache.prune(DAY_MS)).toBe(0);
    expect(store.map.has(UNION_KEY)).toBe(true);
  });

  it('prunes the in-memory store it ships with', async () => {
    const feed = new StubFeed(makeBars(T0, 100));
    let nowMs = UNION_NOW_MS;
    const cache = withBarCache(feed, { now: () => nowMs });
    await cache.getBars({ ...UNION_REQ, ...WHOLE });
    nowMs += 3 * DAY_MS;
    expect(await cache.prune(2 * DAY_MS)).toBe(1);
    expect(cache.stats().entries).toBe(0);
    await cache.getBars({ ...UNION_REQ, ...WHOLE });
    expect(feed.count).toBe(2);
  });

  it('keeps an entry stamped exactly at the cutoff', async () => {
    // The boundary is inclusive-keep: `prune(0)` on an entry stored this instant
    // must not throw away what was just written.
    const store = new ListingStore();
    const cache = withBarCache(new StubFeed(makeBars(T0, 100)), { storage: store, now: () => UNION_NOW_MS });
    await cache.getBars({ ...UNION_REQ, ...WHOLE });
    expect(await cache.prune(0)).toBe(0);
    expect(store.map.has(UNION_KEY)).toBe(true);
  });

  it('is a no-op for a store that cannot list its keys', async () => {
    const store = new RecordingStore(); // no `keys()`
    let nowMs = UNION_NOW_MS;
    const cache = withBarCache(new StubFeed(makeBars(T0, 100)), { storage: store, now: () => nowMs });
    await cache.getBars({ ...UNION_REQ, ...WHOLE });
    nowMs += 3 * DAY_MS; // old enough that a listable store WOULD drop it
    expect(await cache.prune(DAY_MS)).toBe(0);
    expect(store.map.has(UNION_KEY)).toBe(true);
    expect(store.deletes).not.toContain(UNION_KEY);
  });
});

/**
 * The model this cache is built on: a history request is a COUNT and an END,
 * and the only thing that ever says "there is no more history" is the server
 * answering short.
 *
 * The grid below is the shape a futures chart actually meets on a Monday: 600
 * one-minute bars, a 49-hour weekend hole, then 32 bars of the new session. A
 * clock window is wrong about it in both directions — 100 minutes ending "now"
 * contains 32 bars, and no window narrow enough to be honest reaches Friday —
 * while a bar count is not wrong about it at all.
 */
const GAP_PRE = 600;                                   // Friday's session, 1m bars
const GAP_HOLE = 49 * 3600;                            // Fri 16:00 CT -> Sun 17:00 CT
const GAP_POST_OPEN = T0 + GAP_PRE * MIN + GAP_HOLE;   // the new session's first bar
const GAP_POST = 32;                                   // what has printed by "Monday 09:00"
const GAP_NOW_SEC = GAP_POST_OPEN + GAP_POST * MIN + 30;
const GAP_KEY = 'ES|CME|1m';
const GAP_REQ = { symbol: 'ES', exchange: 'CME', interval: '1m' };

/** The backend's own contract: "the last `count` closed bars at or before `endSec`". */
class CountFeed implements DataFeed {
  public calls: BarsRequest[] = [];
  public bars: Bar[];

  public constructor(bars: Bar[]) {
    this.bars = bars;
  }

  public get count(): number {
    return this.calls.length;
  }

  public async getBars(req: BarsRequest): Promise<Bar[]> {
    this.calls.push({ ...req });
    const end = req.endSec ?? req.to;
    const upto = end === undefined ? this.bars : this.bars.filter((b) => b.time <= end);
    const n = req.count;
    const taken = n === undefined ? upto : upto.slice(Math.max(0, upto.length - n));
    return taken.map((b) => ({ ...b }));
  }
}

function gapSetup(nowSec = GAP_NOW_SEC) {
  const store = new RecordingStore();
  const feed = new CountFeed([...makeBars(T0, GAP_PRE), ...makeBars(GAP_POST_OPEN, GAP_POST)]);
  const cache = withBarCache(feed, { storage: store, ttlMs: 60_000, now: () => nowSec * 1000 });
  return { store, feed, cache };
}

describe('BarCache bar-count requests across a session gap', () => {
  it('stores the bars it was given, not the ones inside a clock window', async () => {
    const { store, feed, cache } = gapSetup();
    const bars = await cache.getBars({ ...GAP_REQ, endSec: GAP_NOW_SEC, count: 100 });
    expect(feed.count).toBe(1);
    // 100 bars: the 32 that have printed since the open, and 68 from Friday. A
    // 100-minute window ending now would have held the 32 alone.
    expect(bars.length).toBe(100);
    const entry = store.map.get(GAP_KEY)!;
    expect(entry.bars.length).toBe(100);
    expect(entry.bars[0].time).toBe(T0 + (GAP_PRE - 68) * MIN);
    expect(entry.bars[entry.bars.length - 1].time).toBe(GAP_POST_OPEN + (GAP_POST - 1) * MIN);
    // and asking for the same count again is a hit, sliced from those bars
    const again = await cache.getBars({ ...GAP_REQ, endSec: GAP_NOW_SEC, count: 100 });
    expect(feed.count).toBe(1);
    expect(again.length).toBe(100);
  });

  it('pages older across the gap and keeps both runs', async () => {
    const { store, feed, cache } = gapSetup();
    await cache.getBars({ ...GAP_REQ, endSec: GAP_NOW_SEC, count: GAP_POST });
    expect(store.map.get(GAP_KEY)!.bars.length).toBe(GAP_POST);

    // The page the chart asks for when the user drags past the open: 20 more
    // bars ending just before the oldest one it holds. The server walks back
    // over the weekend by itself and answers with Friday's last 20.
    const page = await cache.getBars({ ...GAP_REQ, endSec: GAP_POST_OPEN - 1, count: 20 });
    expect(feed.count).toBe(2);
    expect(page.length).toBe(20);
    expect(page[0].time).toBe(T0 + (GAP_PRE - 20) * MIN);
    expect(page[page.length - 1].time).toBe(T0 + (GAP_PRE - 1) * MIN);

    // Both runs are held: the band between them was ANSWERED (the request
    // reached the entry's left edge and the server put no bars in it), so this
    // is a union, and coverage is the bars rather than a claim about a window.
    const entry = store.map.get(GAP_KEY)!;
    expect(entry.bars.length).toBe(20 + GAP_POST);
    expect(entry.bars[0].time).toBe(T0 + (GAP_PRE - 20) * MIN);
    // and the same page again is served from those bars
    const repeat = await cache.getBars({ ...GAP_REQ, endSec: GAP_POST_OPEN - 1, count: 20 });
    expect(feed.count).toBe(2);
    expect(repeat.map((b) => b.time)).toEqual(page.map((b) => b.time));
  });

  it('records the server running out, and stops asking again', async () => {
    const { store, feed, cache } = gapSetup();
    const all = await cache.getBars({ ...GAP_REQ, endSec: GAP_NOW_SEC, count: 2000 });
    expect(all.length).toBe(GAP_PRE + GAP_POST);
    // The short answer is the ONLY evidence that no older bars exist. Without
    // it the cache would refetch for ever, one identical empty page at a time.
    expect(store.map.get(GAP_KEY)!.short).toBe(true);
    const again = await cache.getBars({ ...GAP_REQ, endSec: GAP_NOW_SEC, count: 2000 });
    expect(feed.count).toBe(1);
    expect(again.length).toBe(GAP_PRE + GAP_POST);
  });
});

describe('BarCache short answers', () => {
  it('clears short once the server answers in full', async () => {
    const { store, feed, cache } = gapSetup();
    await cache.getBars({ ...GAP_REQ, endSec: GAP_NOW_SEC, count: 2000 });
    expect(store.map.get(GAP_KEY)!.short).toBe(true);
    // The backend backfills the history it was missing. `short` must not be a
    // one-way door: a transient shortfall would otherwise stop paging for the
    // life of the entry.
    feed.bars = [...makeBars(T0 - 500 * MIN, 500), ...feed.bars];
    await cache.getBars({ ...GAP_REQ, endSec: GAP_NOW_SEC, count: 1000, noCache: true });
    const entry = store.map.get(GAP_KEY)!;
    expect(entry.short).toBe(false);
    expect(entry.bars.length).toBe(1000);
  });

  it('clears short when a maxBars trim drops the left edge', async () => {
    const store = new RecordingStore();
    const feed = new CountFeed(makeBars(T0, 40));
    let nowMs = (T0 + 40 * MIN) * 1000;
    const cache = withBarCache(feed, { storage: store, maxBars: 80, ttlMs: 10 * 60_000, now: () => nowMs });
    await cache.getBars({ ...UNION_REQ, endSec: T0 + 39 * MIN, count: 200 });
    expect(store.map.get(UNION_KEY)!.short).toBe(true);

    // The session runs on and the entry outgrows its budget. The bars it kept
    // are the newest, so it is no longer holding the left edge it was told
    // about and must not go on claiming the server has nothing older.
    feed.bars = makeBars(T0, 100);
    nowMs = UNION_NOW_MS;
    await cache.getBars({ ...UNION_REQ, endSec: T0 + 99 * MIN, count: 60 });
    const entry = store.map.get(UNION_KEY)!;
    expect(entry.bars.length).toBe(80);
    expect(entry.bars[0].time).toBe(T0 + 19 * MIN); // the oldest 19 went with the trim
    expect(entry.short).toBe(false);
  });

  it('does not end paging on a tail answer that is merely sparse', async () => {
    const { store, feed, cache } = unionSetup();
    await cache.getBars({ ...UNION_REQ, from: T0, to: T0 + 99 * MIN, noCache: true });
    // Five bars missing inside the tail window: a halt, a thin session, a hole
    // in the server's own store. The answer is short of the window's capacity,
    // but it establishes nothing about the left edge and must not be read as
    // "there is no more history".
    feed.bars = feed.bars.filter((b) => b.time < T0 + 90 * MIN || b.time >= T0 + 95 * MIN);
    await cache.getBars({ ...UNION_REQ, from: T0 + 90 * MIN, to: T0 + 99 * MIN, noCache: true });
    expect(store.map.get(UNION_KEY)!.short).toBe(false);
  });
});
