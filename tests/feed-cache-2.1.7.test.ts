/**
 * Regressions found reviewing the 2.1.7 merge, where upstream's durability was
 * folded into the fork's cache model. Each one is a place the two met badly:
 * an abort that took a healthy entry with it, a peek that adopted without
 * paying, a cache-first read that could not hear the fork's request shape, and
 * a clock correction read as corruption.
 */
import { describe, it, expect } from 'vitest';
import type { Bar } from '../src/model/bar';
import type { BarsRequest, DataFeed } from '../src/feed/types';
import { withBarCache, barCacheKey, type BarCacheStore, type CachedBars } from '../src/feed/cache';

const T0 = 1_700_000_000;
const MIN = 60;
const REQ = { symbol: 'ES', exchange: 'CME', interval: '1m' };
const KEY = 'ES|CME|1m';

function makeBars(start: number, count: number): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    time: start + i * MIN, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10 * i,
  }));
}

/** A feed that answers the fork's count-and-end shape as well as a window. */
class CountFeed implements DataFeed {
  public calls: BarsRequest[] = [];
  public constructor(public bars: Bar[]) {}
  public get count(): number { return this.calls.length; }
  public async getBars(req: BarsRequest): Promise<Bar[]> {
    this.calls.push({ ...req });
    const end = req.endSec ?? req.to;
    const upto = end === undefined ? this.bars : this.bars.filter(b => b.time <= end);
    const from = req.from;
    const inside = from === undefined ? upto : upto.filter(b => b.time >= from);
    return (req.count === undefined ? inside : inside.slice(Math.max(0, inside.length - req.count)))
      .map(b => ({ ...b }));
  }
}

class MapStore implements BarCacheStore {
  public readonly map = new Map<string, CachedBars>();
  public async get(key: string): Promise<CachedBars | undefined> { return this.map.get(key); }
  public async set(key: string, value: CachedBars): Promise<void> {
    this.map.set(key, JSON.parse(JSON.stringify(value)) as CachedBars);
  }
  public async delete(key: string): Promise<void> { this.map.delete(key); }
  public async keys(): Promise<string[]> { return [...this.map.keys()]; }
}

describe('BarCache abort during a durable write', () => {
  it('keeps the entry that was already there when a later put is cancelled mid-write', async () => {
    // Five closed 1m bars, then a forced refetch that is abandoned while the
    // store is still busy. Dropping the key there wiped bars the FIRST write
    // had put in, so a cancelled scroll emptied a warm cache.
    const feed = new CountFeed(makeBars(T0, 5));
    const store = new MapStore();
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { started = resolve; });
    const plain = store.set.bind(store);
    let block = false;
    store.set = async (key, value): Promise<void> => {
      if (!block) return plain(key, value);
      block = false;                       // block the abandoned write, not the restore
      started!();
      await new Promise<void>((resolve) => { release = resolve; });
      return plain(key, value);
    };
    const cache = withBarCache(feed, { storage: store, now: () => (T0 + 5 * MIN) * 1000 });

    await cache.getBars({ ...REQ, endSec: T0 + 5 * MIN, count: 5 });
    expect((await cache.peek(REQ))?.bars).toHaveLength(5);

    block = true;
    const controller = new AbortController();
    const cancelled = cache.getBars({ ...REQ, endSec: T0 + 5 * MIN, count: 5, noCache: true, signal: controller.signal });
    await blocked;
    controller.abort();
    release!();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });

    expect((await cache.peek(REQ))?.bars).toHaveLength(5);
    expect(store.map.get(KEY)?.bars).toHaveLength(5);
    expect(cache.stats()).toMatchObject({ entries: 1, bars: 5 });
  });

  it('still drops a key the cancelled put created, having nothing to put back', async () => {
    const feed = new CountFeed(makeBars(T0, 5));
    const store = new MapStore();
    const controller = new AbortController();
    const plain = store.set.bind(store);
    store.set = async (key, value): Promise<void> => { controller.abort(); return plain(key, value); };
    const cache = withBarCache(feed, { storage: store, now: () => (T0 + 5 * MIN) * 1000 });

    await expect(cache.getBars({ ...REQ, endSec: T0 + 5 * MIN, count: 5, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(await cache.peek(REQ)).toBeUndefined();
    expect(store.map.has(KEY)).toBe(false);
    expect(cache.stats()).toMatchObject({ entries: 0, bars: 0 });
  });
});

describe('BarCache.peek adoption is bounded', () => {
  it('evicts on the entry cap it just pushed past, instead of holding every peeked series', async () => {
    // A peek ADOPTS an entry into this session's bounds. Adopting without
    // evicting meant forty cold series left forty entries in memory against a
    // cap of twenty-four, which is the bound not holding.
    const store = new MapStore();
    const bars = makeBars(T0, 100);
    const nowSec = T0 + 99 * MIN + 30;     // the newest bar is still forming
    const writer = withBarCache(new CountFeed(bars), { storage: store, max: 64, now: () => nowSec * 1000 });
    for (let i = 0; i < 40; i++) {
      await writer.getBars({ ...REQ, symbol: `S${i}`, endSec: nowSec, count: 100 });
    }

    const cache = withBarCache(new CountFeed(bars), { storage: store, max: 24, now: () => nowSec * 1000 });
    for (let i = 0; i < 40; i++) await cache.peek({ ...REQ, symbol: `S${i}` });
    const stats = cache.stats();
    expect(stats.entries).toBe(24);
    expect(stats.bars).toBe(24 * 99);
    expect(stats.evictions).toBe(16);
    // `max` and `maxBars` bound what this session holds in RAM. A look must not
    // delete somebody else's disk: sweeping the store is `prune(maxAgeMs)`.
    expect(store.map.size).toBe(40);
  });

  it('does not copy an entry onto itself when the read came from memory', async () => {
    const feed = new CountFeed(makeBars(T0, 100));
    const cache = withBarCache(feed, { now: () => (T0 + 99 * MIN + 30) * 1000 });
    await cache.getBars({ ...REQ, endSec: T0 + 99 * MIN + 30, count: 100 });
    const first = await cache.peek(REQ);
    const second = await cache.peek(REQ);
    // The peek still hands out clones; what stops is re-cloning the stored
    // entry into memory on every look.
    expect(first!.bars).not.toBe(second!.bars);
    first!.bars[0].close = -1;
    expect((await cache.peek(REQ))!.bars[0].close).toBe(100.5);
  });
});

describe('BarCache.getCachedBars speaks both request shapes', () => {
  it('answers a count-and-end request, which used to return undefined', async () => {
    const feed = new CountFeed(makeBars(T0, 100));
    const nowSec = T0 + 99 * MIN + 30;     // the newest bar is still forming
    const cache = withBarCache(feed, { now: () => nowSec * 1000 });
    expect(await cache.getCachedBars({ ...REQ, endSec: nowSec, count: 10 })).toBeUndefined();

    await cache.getBars({ ...REQ, endSec: nowSec, count: 100 });
    const warm = await cache.getCachedBars({ ...REQ, endSec: nowSec, count: 10 });
    expect(warm).toHaveLength(10);
    expect(warm![warm!.length - 1].time).toBe(T0 + 98 * MIN); // the forming bar is not cached
    expect(feed.count).toBe(1);
  });

  it('still answers a window, and still refuses noCache', async () => {
    const feed = new CountFeed(makeBars(T0, 100));
    const cache = withBarCache(feed, { now: () => (T0 + 99 * MIN + 30) * 1000 });
    await cache.getBars({ ...REQ, from: T0, to: T0 + 99 * MIN });
    expect(await cache.getCachedBars({ ...REQ, from: T0 + 10 * MIN, to: T0 + 19 * MIN })).toHaveLength(10);
    expect(await cache.getCachedBars({ ...REQ, from: T0, to: T0 + 99 * MIN, noCache: true })).toBeUndefined();
    expect(feed.count).toBe(1);
  });
});

describe('BarCache and a clock that steps backwards', () => {
  it('keeps a durable entry stamped in the future and revalidates its tail once', async () => {
    // An NTP correction of thirty seconds used to fail entry validation, which
    // deletes. A whole session of history went with it.
    const store = new MapStore();
    const bars = makeBars(T0, 5);
    const writer = withBarCache(new CountFeed(bars), { storage: store, now: () => (T0 + 5 * MIN) * 1000 });
    await writer.getBars({ ...REQ, endSec: T0 + 5 * MIN, count: 5 });
    expect(store.map.get(KEY)!.storedAt).toBe((T0 + 5 * MIN) * 1000);

    const feed = new CountFeed(bars);
    const stepped = withBarCache(feed, { storage: store, ttlMs: 60_000, now: () => (T0 + 5 * MIN - 30) * 1000 });
    // The closed bars survive: a peek never fetches and still sees four of the
    // five. The fifth has NOT closed on this clock — the writing clock thought
    // it had — so it is cut off and treated as never stored rather than served
    // while still forming, or taken down with the whole entry.
    expect((await stepped.peek(REQ))?.bars.map((value) => value.time))
      .toEqual([T0, T0 + MIN, T0 + 2 * MIN, T0 + 3 * MIN]);
    expect(store.map.has(barCacheKey(REQ))).toBe(true);
    expect(feed.count).toBe(0);
    // What the stamp can no longer do is vouch for the tail, so a request that
    // reaches it refetches exactly once.
    await stepped.getBars({ ...REQ, endSec: T0 + 5 * MIN - 30, count: 5 });
    expect(feed.count).toBe(1);
  });
});

describe('BarCache and a key dropped while a put is in flight', () => {
  /** A store whose first blocked write waits for the test to release it. */
  function blocking(store: MapStore) {
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const inside = new Promise<void>((resolve) => { started = resolve; });
    const plain = store.set.bind(store);
    let armed = false;
    store.set = async (key, value): Promise<void> => {
      if (!armed) return plain(key, value);
      armed = false;
      started!();
      await new Promise<void>((resolve) => { release = resolve; });
      return plain(key, value);
    };
    return { arm: (): void => { armed = true; }, inside, release: (): void => release!() };
  }

  async function warm(): Promise<{ cache: ReturnType<typeof withBarCache>; store: MapStore; gate: ReturnType<typeof blocking> }> {
    const store = new MapStore();
    const gate = blocking(store);
    const cache = withBarCache(new CountFeed(makeBars(T0, 5)), { storage: store, now: () => (T0 + 5 * MIN) * 1000 });
    await cache.getBars({ ...REQ, endSec: T0 + 5 * MIN, count: 5 });
    gate.arm();
    return { cache, store, gate };
  }

  const gone = async (cache: ReturnType<typeof withBarCache>, store: MapStore): Promise<void> => {
    expect(await cache.peek(REQ)).toBeUndefined();
    expect(store.map.has(KEY)).toBe(false);
    expect(cache.stats()).toMatchObject({ entries: 0, bars: 0 });
  };

  it('does not resurrect a series invalidate() removed under an aborted put', async () => {
    const { cache, store, gate } = await warm();
    const controller = new AbortController();
    const cancelled = cache.getBars({ ...REQ, endSec: T0 + 5 * MIN, count: 5, noCache: true, signal: controller.signal });
    await gate.inside;
    controller.abort();
    await cache.invalidate(REQ);
    gate.release();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await gone(cache, store);
  });

  it('does not resurrect it under a put that succeeded, either', async () => {
    // The same hole without a signal anywhere near it: the write lands after
    // the drop and the series is back, bars and all.
    const { cache, store, gate } = await warm();
    const put = cache.getBars({ ...REQ, endSec: T0 + 5 * MIN, count: 5, noCache: true });
    await gate.inside;
    await cache.invalidate(REQ);
    gate.release();
    expect(await put).toHaveLength(5);      // the CALLER still gets its answer
    await gone(cache, store);
  });

  it('treats clear() the same as invalidate()', async () => {
    const { cache, store, gate } = await warm();
    const put = cache.getBars({ ...REQ, endSec: T0 + 5 * MIN, count: 5, noCache: true });
    await gate.inside;
    await cache.clear();
    gate.release();
    await put;
    await gone(cache, store);
  });
});

describe('BarCache._remember elides a copy onto itself', () => {
  it('clones nothing when the read came from the memory copy', async () => {
    const feed = new CountFeed(makeBars(T0, 100));
    const cache = withBarCache(feed, { now: () => (T0 + 99 * MIN + 30) * 1000 });
    await cache.getBars({ ...REQ, endSec: T0 + 99 * MIN + 30, count: 100 });

    // The elision is invisible from outside — a peek hands out a fresh slice
    // either way — so it is pinned where it happens.
    const internals = cache as unknown as { _cloneEntry(entry: CachedBars): CachedBars };
    const original = internals._cloneEntry;
    let clones = 0;
    internals._cloneEntry = function (entry: CachedBars): CachedBars {
      clones++;
      return original.call(this, entry);
    };
    await cache.peek(REQ);
    await cache.peek(REQ);
    await cache.getCachedBars({ ...REQ, endSec: T0 + 99 * MIN + 30, count: 10 });
    expect(clones).toBe(0);
  });
});
