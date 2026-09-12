/**
 * The fork asks history as a COUNT and an END; upstream 2.1.6 added a request
 * pool and a loading controller that both speak windows. These are the two
 * places the shapes collided: a dedupe key that could not tell two counts
 * apart, and a page request carrying a count its caller never meant to send.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HistoryRequestPool } from '../src/feed/request-pool';
import { DataLoadingController } from '../src/feed/data-controller';
import { withBarCache } from '../src/feed/cache';
import type { Bar } from '../src/model/bar';
import type { BarsRequest, DataFeed } from '../src/feed/types';

const REQ: BarsRequest = { symbol: 'ES', exchange: 'CME', interval: '1m' };
const bar = (time: number): Bar => ({ time, open: 100, high: 101, low: 99, close: 100.5, volume: 1 });

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); });

describe('HistoryRequestPool and the count-and-end shape', () => {
  it('does not hand a request for 500 bars the answer to a request for 50', async () => {
    // The key omitted `endSec` and `count`, so both asks hashed to one job and
    // the second caller silently received the first one's bars.
    let release: ((bars: Bar[]) => void) | undefined;
    const seen: BarsRequest[] = [];
    const feed: DataFeed = {
      getBars: (request) => {
        seen.push({ ...request });
        return seen.length === 1
          ? new Promise<Bar[]>((resolve) => { release = resolve; })
          : Promise.resolve([bar(1), bar(2)]);
      },
    };
    const pool = new HistoryRequestPool(feed);
    const small = pool.getBars({ ...REQ, endSec: 1_000, count: 50 });
    const large = pool.getBars({ ...REQ, endSec: 1_000, count: 500 });
    release!([bar(1)]);

    expect(await small).toHaveLength(1);
    expect(await large).toHaveLength(2);
    expect(seen.map((request) => request.count)).toEqual([50, 500]);
  });

  it('still coalesces two identical count requests into one', async () => {
    let calls = 0;
    const pool = new HistoryRequestPool({ getBars: async () => { calls++; return [bar(1)]; } });
    await Promise.all([
      pool.getBars({ ...REQ, endSec: 1_000, count: 50 }),
      pool.getBars({ ...REQ, endSec: 1_000, count: 50 }),
    ]);
    expect(calls).toBe(1);
  });
});

describe('DataLoadingController paging under a count-shaped host request', () => {
  function make(feed: DataFeed, options = {}): DataLoadingController {
    const controller = new DataLoadingController(feed, { now: () => 600, ...options });
    cleanups.push(() => controller.destroy());
    return controller;
  }

  it('pages backwards through a cache that prefers the count shape', async () => {
    // The host asked in `{ endSec, count }`; the controller spread that request
    // to build its own page window. The cache then answered the NEWEST bars to
    // a question about the oldest, the controller filtered every one of them
    // out, and the gesture paged for ever loading nothing.
    const history = Array.from({ length: 600 }, (_, i) => bar(1 + i * 60));
    const source: DataFeed = {
      getBars: async (request) => {
        const end = request.endSec ?? request.to ?? Infinity;
        const from = request.from ?? -Infinity;
        const inside = history.filter((value) => value.time >= from && value.time <= end);
        const n = request.count ?? request.countBack;
        return (n === undefined ? inside : inside.slice(Math.max(0, inside.length - n))).map(v => ({ ...v }));
      },
    };
    const feed = withBarCache(source, { now: () => 36_000 * 1000 });
    const controller = make(feed, { pageSize: 50, pageWindowSec: 3_000, maxBars: 5_000, now: () => 36_000 });

    await controller.load({ ...REQ, endSec: 36_000, count: 100, from: 30_000, to: 36_000 });
    const first = controller.bars().length;
    expect(first).toBeGreaterThan(0);

    await controller.loadMore();
    const grown = controller.bars().length;
    expect(grown).toBeGreaterThan(first);
    expect(controller.bars()[0].time).toBeLessThan(30_000);
  });

  it('leaves a host request that carries no window alone', async () => {
    const seen: BarsRequest[] = [];
    const controller = make({ getBars: async (request) => { seen.push({ ...request }); return [bar(100)]; } });
    await controller.load({ ...REQ, endSec: 600, count: 25 });
    expect(seen[0]).toMatchObject({ endSec: 600, count: 25 });
  });
});

describe('BarCache._ask prefers a supplied window over an inherited count', () => {
  it('answers an older page rather than the newest bars it already holds', async () => {
    const history = Array.from({ length: 300 }, (_, i) => bar(1 + i * 60));
    const calls: BarsRequest[] = [];
    const source: DataFeed = {
      getBars: async (request) => {
        calls.push({ ...request });
        const end = request.endSec ?? request.to ?? Infinity;
        const from = request.from ?? -Infinity;
        return history.filter((value) => value.time >= from && value.time <= end).map(v => ({ ...v }));
      },
    };
    const cache = withBarCache(source, { now: () => 20_000 * 1000 });
    await cache.getBars({ ...REQ, endSec: 18_000, count: 300 });

    // A page request built by spreading the host's count-shaped one. The window
    // is what it means; the count is a leftover.
    const page = await cache.getBars({ ...REQ, endSec: 18_000, count: 300, from: 60, to: 600 });
    expect(page.map((value) => value.time)).toEqual([61, 121, 181, 241, 301, 361, 421, 481, 541]);
  });
});
