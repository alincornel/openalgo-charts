import { darkTheme } from '../src/theme';
import { describe, it, expect } from 'vitest';
import { computeVolumeProfile } from '../src/profile/volume-profile';
import { computeTpo } from '../src/profile/tpo';
import {
  computeFootprint, diagonalImbalances, cumulativeDelta, stackedImbalances, type ClassifiedTrade,
} from '../src/profile/footprint';
import { HorizontalProfile } from '../src/profile/profile-primitive';
import { Footprint, compactVol, type FootprintOptions } from '../src/profile/footprint-primitive';
import { FootprintAggregator } from '../src/profile/footprint-aggregator';
import { priceBuckets } from '../src/profile/profile-model';
import type { Bar } from '../src/model/bar';
import type { PrimitiveRenderContext } from '../src/primitives/primitive';
import { PriceScale } from '../src/scale/price-scale';
import { TimeScale } from '../src/scale/time-scale';
import { DataLayer } from '../src/model/data-layer';
import { makeCtx, type Op, type RecordingContext } from './helpers/fake-ctx';

const bar = (time: number, o: number, h: number, l: number, c: number, v: number): Bar => ({ time, open: o, high: h, low: l, close: c, volume: v });

describe('priceBuckets', () => {
  it('spans inclusive low→high on the tick grid', () => {
    expect(priceBuckets(100, 100.2, 0.05)).toEqual([100, 100.05, 100.1, 100.15, 100.2]);
  });
});

describe('Volume Profile', () => {
  it('finds POC at the most-traded price and a 70% value area', () => {
    // bar that concentrates huge volume in a tight band around 100
    const bars = [
      bar(1, 100, 100.1, 99.9, 100, 100),
      bar(2, 100, 100.05, 99.95, 100, 5000), // dominant volume near 100
      bar(3, 101, 102, 100, 101, 100),
    ];
    const vp = computeVolumeProfile(bars, 0.05, 0.7);
    expect(vp.poc).toBeGreaterThanOrEqual(99.95);
    expect(vp.poc).toBeLessThanOrEqual(100.05);
    expect(vp.vah).toBeGreaterThanOrEqual(vp.val);
    // value area holds ~70% of volume
    const vaVol = vp.buckets.filter((b) => b.price <= vp.vah && b.price >= vp.val).reduce((s, b) => s + b.volume, 0);
    expect(vaVol).toBeGreaterThanOrEqual(vp.totalVolume * 0.7 - 1e-6);
  });

  it('handles empty input', () => {
    const vp = computeVolumeProfile([], 0.05);
    expect(vp.buckets).toHaveLength(0);
    expect(vp.totalVolume).toBe(0);
  });
});

describe('TPO / Market Profile', () => {
  it('counts periods at price, derives POC/VA and the initial balance', () => {
    const bars = [
      bar(1, 100, 101, 99, 100, 0), bar(2, 100, 101, 99, 100, 0), // period 0
      bar(3, 100, 100.5, 99.5, 100, 0), bar(4, 100, 100.5, 99.5, 100, 0), // period 1
      bar(5, 103, 104, 102, 103, 0), bar(6, 103, 104, 102, 103, 0), // period 2
    ];
    const tpo = computeTpo(bars, 2, 0.5, 0.7, 2); // 2 bars/period, IB = first 2 periods
    expect(tpo.buckets.length).toBeGreaterThan(0);
    // prices around 100 are touched by 2 periods → higher count than 103 band
    expect(tpo.poc).toBeGreaterThanOrEqual(99.5);
    expect(tpo.poc).toBeLessThanOrEqual(101);
    // IB spans the first two periods' combined range (99 .. 101)
    expect(tpo.ib.high).toBeCloseTo(101);
    expect(tpo.ib.low).toBeCloseTo(99);
  });
});

describe('Footprint & order flow', () => {
  const trades: ClassifiedTrade[] = [
    { price: 100.0, qty: 30, side: 'ask' },
    { price: 100.0, qty: 10, side: 'bid' },
    { price: 100.05, qty: 50, side: 'ask' },
    { price: 99.95, qty: 40, side: 'bid' },
  ];

  it('aggregates bid/ask per price and computes net delta', () => {
    const fp = computeFootprint(1, trades, 0.05);
    const at100 = fp.cells.find((c) => Math.abs(c.price - 100) < 1e-9)!;
    expect(at100.askVol).toBe(30);
    expect(at100.bidVol).toBe(10);
    // delta = Σ(ask − bid) = (30-10) + (50-0) + (0-40) = 20 + 50 - 40 = 30
    expect(fp.delta).toBe(30);
  });

  it('detects diagonal imbalances by ratio', () => {
    // strong ask at 100.05 vs bid at 100.0 → buy imbalance
    const fp = computeFootprint(1, trades, 0.05);
    const imb = diagonalImbalances(fp.cells, 3);
    expect(imb.some((i) => i.side === 'buy')).toBe(true);
  });

  it('cumulative delta accumulates across bars', () => {
    const bars = [
      computeFootprint(1, [{ price: 100, qty: 10, side: 'ask' }], 0.05), // +10
      computeFootprint(2, [{ price: 100, qty: 4, side: 'bid' }], 0.05),  // -4
      computeFootprint(3, [{ price: 100, qty: 6, side: 'ask' }], 0.05),  // +6
    ];
    expect(cumulativeDelta(bars)).toEqual([10, 6, 12]);
  });

  it('finds stacked imbalances of minimum length', () => {
    const cells = [
      { price: 100.15, bidVol: 1, askVol: 90 },
      { price: 100.10, bidVol: 1, askVol: 90 },
      { price: 100.05, bidVol: 1, askVol: 90 },
      { price: 100.00, bidVol: 1, askVol: 1 },
    ];
    const stacks = stackedImbalances(cells, 3, 3);
    expect(stacks.length).toBeGreaterThanOrEqual(1);
    expect(stacks[0].side).toBe('buy');
    expect(stacks[0].count).toBeGreaterThanOrEqual(3);
  });
});

describe('profile primitives render', () => {
  function rc(): PrimitiveRenderContext {
    const dl = new DataLayer();
    const id = dl.createSeries();
    dl.setSeriesData(id, [bar(1, 100, 101, 99, 100, 10), bar(2, 100, 101, 99, 100, 10)]);
    const priceScale = new PriceScale();
    priceScale.setHeight(400);
    priceScale.setPriceRange({ min: 98, max: 103 });
    const timeScale = new TimeScale();
    timeScale.setWidth(600);
    timeScale.setBaseIndex(dl.baseIndex);
    return { timeScale, priceScale, dataLayer: dl, plotWidth: 600, plotHeight: 400, priceAxisWidth: 56, dpr: 1, theme: darkTheme };
  }

  it('HorizontalProfile draws bars + POC/VA lines', () => {
    const hp = new HorizontalProfile({
      buckets: [{ price: 100, value: 50 }, { price: 100.5, value: 20 }, { price: 101, value: 5 }],
      poc: 100, vah: 100.5, val: 100, width: 120, side: 'right', barColor: '#345', vaColor: '#456',
    });
    const { ctx, rec } = makeCtx();
    hp.draw(ctx, rc());
    expect(rec.count('fillRect')).toBeGreaterThan(0);
    expect(rec.count('stroke')).toBe(3); // POC + VAH + VAL
  });

  it('Footprint draws cells aligned to chart bars', () => {
    const r = rc();
    const fp = new Footprint();
    fp.setBars([computeFootprint(1, [{ price: 100, qty: 5, side: 'ask' }, { price: 100, qty: 2, side: 'bid' }], 0.05)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    expect(rec.count('fillText')).toBeGreaterThan(0);
  });

  it('Footprint fills diagonal imbalances saturated rather than outlining them', () => {
    const r = rc();
    // ask 30 at 100.05 dominates bid 2 one tick below -> a buy imbalance.
    const bars = [computeFootprint(1, [
      { price: 100.05, qty: 30, side: 'ask' },
      { price: 100.0, qty: 2, side: 'bid' },
    ], 0.05)];
    const plain = new Footprint({ tickSize: 0.05, imbalanceRatio: 1e9, statsRows: [] });
    plain.setBars(bars);
    const a = makeCtx();
    plain.draw(a.ctx, r);

    const hot = new Footprint({ tickSize: 0.05, imbalanceRatio: 3, statsRows: [] });
    hot.setBars(bars);
    const b = makeCtx();
    hot.draw(b.ctx, r);

    // Same geometry either way — an outline would have added strokeRect calls.
    expect(b.rec.count('strokeRect')).toBe(0);
    expect(b.rec.count('roundRect')).toBe(a.rec.count('roundRect'));
    // ...but the imbalanced cell is painted a different (saturated) colour.
    const fills = (r2: RecordingContext): (string | undefined)[] =>
      r2.ops.filter((o) => o.type === 'fill').map((o) => o.fillStyle);
    expect(fills(b.rec)).not.toEqual(fills(a.rec));
  });

  it('Footprint grades cell colour by share of the bar peak', () => {
    const r = rc();
    const fp = new Footprint({ tickSize: 0.05, imbalanceRatio: 1e9, statsRows: [] });
    fp.setBars([computeFootprint(1, [
      { price: 100.0, qty: 1, side: 'ask' },
      { price: 100.05, qty: 100, side: 'ask' },
    ], 0.05)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    const fills = rec.ops.filter((o) => o.type === 'fill').map((o) => o.fillStyle);
    // A quiet row and a peak row must not share a colour.
    expect(new Set(fills).size).toBeGreaterThan(1);
  });

  it('Footprint computes per-bar stats with a running CVD', () => {
    const fp = new Footprint();
    fp.setBars([
      computeFootprint(1, [{ price: 100, qty: 10, side: 'ask' }], 0.05),  // +10
      computeFootprint(2, [{ price: 100, qty: 4, side: 'bid' }], 0.05),   // -4
      computeFootprint(3, [{ price: 100, qty: 6, side: 'ask' }], 0.05),   // +6
    ]);
    const s = fp.stats();
    expect(s.map((x) => x.delta)).toEqual([10, -4, 6]);
    expect(s.map((x) => x.cvd)).toEqual([10, 6, 12]);   // running, not per-bar
    expect(s[0].volume).toBe(10);
    expect(s[0].deltaPct).toBeCloseTo(100, 6);
    expect(s[1].deltaPct).toBeCloseTo(-100, 6);
  });

  it('Footprint draws one stats row per configured metric', () => {
    const r = rc();
    const bars = [computeFootprint(1, [{ price: 100, qty: 5, side: 'ask' }], 0.05)];
    const none = new Footprint({ tickSize: 0.05, statsRows: [] });
    none.setBars(bars);
    const a = makeCtx();
    none.draw(a.ctx, r);

    const four = new Footprint({ tickSize: 0.05, statsRows: ['volume', 'delta', 'deltaPct', 'cvd'] });
    four.setBars(bars);
    const b = makeCtx();
    four.draw(b.ctx, r);
    expect(b.rec.count('fillText')).toBe(a.rec.count('fillText') + 4);
  });

  it('Footprint is restylable at runtime instead of needing a rebuild', () => {
    const r = rc();
    const fp = new Footprint({ tickSize: 0.05, statsRows: [] });
    fp.setBars([computeFootprint(1, [{ price: 100, qty: 5, side: 'ask' }], 0.05)]);
    const a = makeCtx();
    fp.draw(a.ctx, r);
    fp.setOptions({ buyColor: '#00ff00' });
    const b = makeCtx();
    fp.draw(b.ctx, r);
    expect(fp.options().buyColor).toBe('#00ff00');
    const fills = (r2: RecordingContext): string =>
      r2.ops.filter((o) => o.type === 'fill').map((o) => o.fillStyle).join('|');
    expect(fills(b.rec)).not.toBe(fills(a.rec));
  });

  it('Footprint drops cell numbers when rows are too short to read', () => {
    const bars = [computeFootprint(1, [
      { price: 100, qty: 5, side: 'ask' }, { price: 100.05, qty: 5, side: 'bid' },
    ], 0.05)];
    const roomy = new Footprint({ tickSize: 0.05, statsRows: [], minTextHeight: 1 });
    roomy.setBars(bars);
    const a = makeCtx();
    roomy.draw(a.ctx, rc());

    const cramped = new Footprint({ tickSize: 0.05, statsRows: [], minTextHeight: 10000 });
    cramped.setBars(bars);
    const b = makeCtx();
    cramped.draw(b.ctx, rc());
    expect(a.rec.count('fillText')).toBeGreaterThan(0);
    expect(b.rec.count('fillText')).toBe(0);   // heatmap only
    expect(b.rec.count('roundRect')).toBeGreaterThan(0);
  });

  it('Footprint drives autoscale so the top and bottom rows are not clipped', () => {
    const fp = new Footprint();
    fp.setBars([computeFootprint(1, [
      { price: 100, qty: 1, side: 'ask' }, { price: 101, qty: 1, side: 'bid' },
    ], 0.5)]);
    expect(fp.autoscaleInfo()).toEqual({ min: 100, max: 101 });
  });

  it('Footprint hit-tests a column and reports its stats', () => {
    const r = rc();
    const fp = new Footprint({ tickSize: 0.05 });
    fp.setBars([computeFootprint(1, [{ price: 100, qty: 7, side: 'ask' }], 0.05)]);
    const { ctx } = makeCtx();
    fp.draw(ctx, r);                       // hit-testing needs the drawn geometry
    const x = r.timeScale.indexToX(0);
    const hit = fp.hitTest(x, 50);
    expect(hit?.externalId).toBe('footprint:1');
    const hover = fp.hoverAt(x, r.priceScale.priceToY(100), r);
    expect(hover?.stats.volume).toBe(7);
    expect(hover?.cell?.askVol).toBe(7);
    expect(fp.hitTest(-500, 50)).toBeNull();
  });

  it('Footprint hoverAt reuses the last draw context when none is passed', () => {
    // Hosts should not have to fabricate a PrimitiveRenderContext to show a tooltip.
    const r = rc();
    const fp = new Footprint({ tickSize: 0.05 });
    fp.setBars([computeFootprint(1, [{ price: 100, qty: 7, side: 'ask' }], 0.05)]);
    const x = r.timeScale.indexToX(0);
    expect(fp.hoverAt(x, r.priceScale.priceToY(100))).toBeNull();  // nothing drawn yet
    const { ctx } = makeCtx();
    fp.draw(ctx, r);
    const hover = fp.hoverAt(x, r.priceScale.priceToY(100));
    expect(hover?.stats.volume).toBe(7);
    expect(hover?.cell?.askVol).toBe(7);
  });

  it('rowTicks widens footprint bricks without changing the tick size', () => {
    // Nifty-style: 0.1 tick, 2-point bricks -> rowTicks 20.
    const trades: ClassifiedTrade[] = [];
    for (let i = 0; i < 60; i++) {
      trades.push({ price: 24000 + i * 0.1, qty: 1, side: i % 2 === 0 ? 'ask' : 'bid' });
    }
    const fine = computeFootprint(1, trades, 0.1);
    const coarse = computeFootprint(1, trades, 0.1, 20);
    expect(fine.cells.length).toBeGreaterThan(50);
    expect(coarse.cells.length).toBeLessThan(6);
    // Rows really are 2 points apart, and no volume was lost in the regrouping.
    expect(Math.abs((coarse.cells[0].price - coarse.cells[1].price) - 2)).toBeLessThan(1e-6);
    const sum = (b: typeof fine) => b.cells.reduce((n, c) => n + c.bidVol + c.askVol, 0);
    expect(sum(coarse)).toBe(sum(fine));
  });

  it('FootprintAggregator buckets ticks onto the rowTicks grid', () => {
    const agg = new FootprintAggregator({ mode: 'interval', seconds: 60 }, 0.1, 20);
    let bar = agg.onTick({ time: 0, price: 24000.1, qty: 5, side: 'ask' }).bar;
    bar = agg.onTick({ time: 1, price: 24000.7, qty: 7, side: 'ask' }).bar;
    // Both prints round onto the same 2-point brick.
    expect(bar.cells).toHaveLength(1);
    expect(bar.cells[0].price).toBe(24000);
    expect(bar.cells[0].askVol).toBe(12);
    // A print a full brick away opens a new row.
    bar = agg.onTick({ time: 2, price: 24002.4, qty: 3, side: 'bid' }).bar;
    expect(bar.cells).toHaveLength(2);
  });

  it('compactVol formats to three significant figures', () => {
    expect(compactVol(4_530_000)).toBe('4.53M');
    expect(compactVol(13_000_000)).toBe('13M');
    expect(compactVol(30_200_000)).toBe('30.2M');
    expect(compactVol(47_100)).toBe('47.1K');
    expect(compactVol(128_000)).toBe('128K');
    expect(compactVol(3_000)).toBe('3K');
    expect(compactVol(-943_000)).toBe('-943K');
    expect(compactVol(512)).toBe('512');
  });

  it('Footprint draws only traded rows by default', () => {
    const r = rc();
    // Two prints four rows apart: three interior rows never traded.
    const fp = new Footprint({ tickSize: 0.05, statsRows: [], stackedImbalances: 0 });
    fp.setBars([computeFootprint(1, [
      { price: 100.0, qty: 5, side: 'ask' },
      { price: 100.2, qty: 5, side: 'ask' },
    ], 0.05)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    expect(rec.count('roundRect')).toBe(4);   // 2 rows x (bid + ask)
  });

  it('Footprint zeroFill draws a row for every price between high and low', () => {
    const r = rc();
    const fp = new Footprint({ tickSize: 0.05, statsRows: [], stackedImbalances: 0, zeroFill: true });
    fp.setBars([computeFootprint(1, [
      { price: 100.0, qty: 5, side: 'ask' },
      { price: 100.2, qty: 5, side: 'ask' },
    ], 0.05)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    expect(rec.count('roundRect')).toBe(10);  // 5 rows x 2, three of them 0 x 0
  });

  it('Footprint zeroFill leaves stats, POC and autoscale untouched', () => {
    const b = computeFootprint(1, [
      { price: 100.0, qty: 5, side: 'ask' },
      { price: 100.2, qty: 9, side: 'bid' },
    ], 0.05);
    const plain = new Footprint({ tickSize: 0.05 });
    const filled = new Footprint({ tickSize: 0.05, zeroFill: true });
    plain.setBars([b]); filled.setBars([b]);
    expect(filled.stats()).toEqual(plain.stats());          // volume, delta, cvd, trades, poc
    expect(filled.autoscaleInfo()).toEqual(plain.autoscaleInfo());
  });

  it('Footprint zeroFill judges the diagonal against the adjacent row, not the next traded one', () => {
    // ask 30 at 100.2 against an UNTRADED row below: with zeroFill that neighbour
    // is a real 0 row (imbalance at the default max(1, 0) rule), without it the
    // "row below" is the traded row four steps away.
    const r = rc();
    const bars = [computeFootprint(1, [
      { price: 100.2, qty: 30, side: 'ask' },
      { price: 100.0, qty: 40, side: 'bid' },
    ], 0.05)];
    const style = { tickSize: 0.05, statsRows: [] as [], imbalanceRatio: 3, buyColor: '#00ff00', sellColor: '#ff0000' };
    const off = new Footprint(style);
    const on = new Footprint({ ...style, zeroFill: true });
    off.setBars(bars); on.setBars(bars);
    const a = makeCtx(); off.draw(a.ctx, r);
    const b = makeCtx(); on.draw(b.ctx, r);
    const fills = (x: typeof a): (string | undefined)[] =>
      x.rec.ops.filter((o) => o.type === 'fill').map((o) => o.fillStyle);
    expect(fills(b)).not.toEqual(fills(a));
    // A saturated cell is painted the raw colour; only zeroFill finds the diagonal.
    expect(fills(b)).toContain('#00ff00');
    expect(fills(a)).not.toContain('#00ff00');
  });

  it('Footprint zeroFill gives up on a bar whose range would need more rows than the cap', () => {
    const r = rc();
    const fp = new Footprint({
      tickSize: 0.05, statsRows: [], stackedImbalances: 0, zeroFill: true, maxZeroFillRows: 3,
    });
    fp.setBars([computeFootprint(1, [
      { price: 100.0, qty: 1, side: 'ask' },
      { price: 100.2, qty: 1, side: 'ask' },   // 5 rows, over the cap
    ], 0.05)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    expect(rec.count('roundRect')).toBe(4);   // falls back to the traded rows
  });

  it('Footprint zeroFill leaves a session-gap bar alone under the default cap', () => {
    const r = rc();
    const fp = new Footprint({ tickSize: 0.05, statsRows: [], stackedImbalances: 0, zeroFill: true });
    fp.setBars([computeFootprint(1, [
      { price: 100.0, qty: 1, side: 'ask' },
      { price: 200.0, qty: 1, side: 'ask' },   // 2000 rows apart
    ], 0.05)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    // Only the on-pane traded row survives the cull; a filled grid would have
    // put ~60 rows (120 cells) inside the 98..103 window.
    expect(rec.count('roundRect')).toBe(2);
  });

  /** `rc()` plus the pane's OHLC, which `PrimitiveRenderContext.bars` is optional about. */
  const rcBars = (ohlc: Bar[]): PrimitiveRenderContext => ({ ...rc(), bars: () => ohlc });

  const askBar = (): ReturnType<typeof computeFootprint> => computeFootprint(1, [
    { price: 100.0, qty: 5, side: 'ask' },
    { price: 100.2, qty: 7, side: 'ask' },
  ], 0.05);
  const candleStyle = {
    tickSize: 0.05, statsRows: [] as [], stackedImbalances: 0, showPoc: false,
    buyColor: '#00ff00', sellColor: '#ff0000',
  };
  const rects = (rec: RecordingContext): Op[] => rec.ops.filter((o) => o.type === 'fillRect');

  it("Footprint candle 'off' draws neither a range bar nor a candle", () => {
    const fp = new Footprint({ ...candleStyle, candle: 'off' });
    fp.setBars([askBar()]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, rcBars([bar(1, 100.0, 100.3, 99.9, 100.25, 0)]));
    expect(rects(rec)).toHaveLength(0);
  });

  it("Footprint 'behind' keeps the legacy delta-coloured range bar", () => {
    const fp = new Footprint({ ...candleStyle, candle: 'behind' });
    fp.setBars([askBar()]);   // all ask, so delta > 0
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, rcBars([bar(1, 100.25, 100.3, 99.9, 100.0, 0)]));   // close < open
    const r = rects(rec);
    expect(r).toHaveLength(1);                       // one range bar, no OHLC pair
    expect(r[0].fillStyle).not.toBe('#00ff00');      // half-alpha, not the raw colour
    expect(r[0].fillStyle).toContain('0');           // rgba(...)
  });

  it("Footprint 'gutter' draws a wick from high to low and a body from open to close", () => {
    const r = rcBars([bar(1, 100.0, 100.3, 99.9, 100.25, 0)]);
    // A roomy slot: the default 24 px one leaves a 5 px gutter, which is strip
    // territory (see the narrow-slot test below).
    const fp = new Footprint({ ...candleStyle, candle: 'gutter', cellWidth: 60 });
    fp.setBars([askBar()]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    const [wick, body] = rects(rec);
    expect(rects(rec)).toHaveLength(2);
    expect(wick.args[1]).toBeCloseTo(r.priceScale.priceToY(100.3));
    expect(wick.args[1] + wick.args[3]).toBeCloseTo(r.priceScale.priceToY(99.9));
    expect(body.args[1]).toBeCloseTo(r.priceScale.priceToY(100.25));
    expect(body.args[1] + body.args[3]).toBeCloseTo(r.priceScale.priceToY(100.0));
    // The body is the direction strip; the wick is a hairline that vanishes into
    // it once the slot is narrow.
    expect(body.args[2]).toBeGreaterThan(wick.args[2]);
    expect(wick.args[2]).toBe(1);
    expect(body.fillStyle).toBe('#00ff00');          // close > open
  });

  it("Footprint 'gutter' colours the body by close vs open, not by delta", () => {
    const fp = new Footprint({ ...candleStyle, candle: 'gutter' });
    fp.setBars([askBar()]);                          // delta > 0
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, rcBars([bar(1, 100.25, 100.3, 99.9, 100.0, 0)]));   // close < open
    expect(rects(rec)[1].fillStyle).toBe('#ff0000');
  });

  it("Footprint 'gutter' pushes the ladder right so the candle has its own strip", () => {
    const r = rcBars([bar(1, 100.0, 100.3, 99.9, 100.25, 0)]);
    const leftmost = (rec: RecordingContext): number =>
      Math.min(...rec.ops.filter((o) => o.type === 'roundRect').map((o) => o.args[0]));
    const off = new Footprint({ ...candleStyle, candle: 'off' });
    off.setBars([askBar()]);
    const a = makeCtx(); off.draw(a.ctx, r);
    const on = new Footprint({ ...candleStyle, candle: 'gutter' });
    on.setBars([askBar()]);
    const b = makeCtx(); on.draw(b.ctx, r);
    expect(leftmost(b.rec)).toBeGreaterThan(leftmost(a.rec));
  });

  it("Footprint 'gutter' moves the hit window with the ladder", () => {
    const r = rcBars([bar(1, 100.0, 100.3, 99.9, 100.25, 0)]);
    const off = new Footprint({ ...candleStyle, candle: 'off' });
    off.setBars([askBar()]);
    const a = makeCtx();
    off.draw(a.ctx, r);
    // The left edge of the unguttered ladder, taken from what it actually drew.
    const leftEdge = Math.min(...a.rec.ops.filter((o) => o.type === 'roundRect').map((o) => o.args[0])) + 1;
    expect(off.hitTest(leftEdge, 50)).not.toBeNull();
    const on = new Footprint({ ...candleStyle, candle: 'gutter' });
    on.setBars([askBar()]);
    on.draw(makeCtx().ctx, r);
    expect(on.hitTest(leftEdge, 50)).toBeNull();     // that x is gutter now
  });

  it("Footprint 'gutter' falls back to the cell range when the pane has no OHLC", () => {
    const r = rc();                                   // no `bars` provider at all
    const fp = new Footprint({ ...candleStyle, candle: 'gutter' });
    fp.setBars([askBar()]);
    const { ctx, rec } = makeCtx();
    expect(() => fp.draw(ctx, r)).not.toThrow();
    const only = rects(rec);
    expect(only).toHaveLength(1);                     // a wick, no body
    expect(only[0].args[1]).toBeCloseTo(r.priceScale.priceToY(100.2));
    expect(only[0].args[1] + only[0].args[3]).toBeCloseTo(r.priceScale.priceToY(100.0));
  });

  const texts = (rec: RecordingContext): (string | undefined)[] =>
    rec.ops.filter((o) => o.type === 'fillText').map((o) => o.text);
  const cellStyle = {
    tickSize: 0.05, statsRows: [] as [], stackedImbalances: 0, showPoc: false,
    candle: 'off' as const, minTextHeight: 1, buyColor: '#00ff00', sellColor: '#ff0000',
  };

  it("Footprint 'bidAsk' cells stay bid against ask", () => {
    const fp = new Footprint(cellStyle);
    fp.setBars([computeFootprint(1, [
      { price: 100.0, qty: 7, side: 'ask' }, { price: 100.0, qty: 2, side: 'bid' },
    ], 0.05)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, rc());
    expect(texts(rec)).toEqual(['2', '7']);
  });

  it("Footprint 'deltaVolume' cells show the row delta against the row volume", () => {
    const fp = new Footprint({ ...cellStyle, cells: 'deltaVolume' });
    fp.setBars([computeFootprint(1, [
      { price: 100.0, qty: 7, side: 'ask' }, { price: 100.0, qty: 2, side: 'bid' },
    ], 0.05)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, rc());
    expect(texts(rec)).toEqual(['5', '9']);   // delta 7-2, volume 7+2
  });

  it("Footprint 'deltaVolume' writes a negative row delta in the sell colour", () => {
    const fp = new Footprint({ ...cellStyle, cells: 'deltaVolume' });
    fp.setBars([computeFootprint(1, [
      { price: 100.0, qty: 2, side: 'ask' }, { price: 100.0, qty: 9, side: 'bid' },
    ], 0.05)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, rc());
    const delta = rec.ops.filter((o) => o.type === 'fillText').find((o) => o.text === '-7');
    expect(delta?.fillStyle).toBe('rgba(255,0,0,0.9)');
    const vol = rec.ops.filter((o) => o.type === 'fillText').find((o) => o.text === '11');
    expect(vol?.fillStyle).toBe('rgba(255,255,255,0.9)');
  });

  it("Footprint 'deltaVolume' reads 0 | 0 on a zero-filled row", () => {
    const fp = new Footprint({ ...cellStyle, cells: 'deltaVolume', zeroFill: true });
    fp.setBars([computeFootprint(1, [
      { price: 100.0, qty: 5, side: 'ask' }, { price: 100.1, qty: 5, side: 'ask' },
    ], 0.05)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, rc());
    expect(texts(rec)).toEqual(['5', '5', '0', '0', '5', '5']);   // high, filled, low
  });

  const cellFills = (rec: RecordingContext): string[] =>
    rec.ops.filter((o) => o.type === 'fill').map((o) => o.fillStyle as string);
  const green = (rgb: string): number => Number(rgb.replace(/^rgba?\(/, '').split(',')[1]);
  const twoRows = (topAsk: number, botBid: number): ReturnType<typeof computeFootprint> =>
    computeFootprint(1, [
      { price: 100.05, qty: topAsk, side: 'ask' }, { price: 100.0, qty: botBid, side: 'bid' },
    ], 0.05);

  it("Footprint colorBy 'delta' paints both halves of a row one colour", () => {
    const style = { ...cellStyle, imbalanceRatio: 1e9 };
    const imb = new Footprint(style);
    imb.setBars([twoRows(10, 20)]);
    const a = makeCtx(); imb.draw(a.ctx, rc());
    expect(cellFills(a.rec)[0]).not.toBe(cellFills(a.rec)[1]);   // bid side vs ask side

    const dlt = new Footprint({ ...style, colorBy: 'delta' });
    dlt.setBars([twoRows(10, 20)]);
    const b = makeCtx(); dlt.draw(b.ctx, rc());
    const f = cellFills(b.rec);
    expect(f[0]).toBe(f[1]);          // the +10 row, one colour across
    expect(f[2]).toBe(f[3]);          // the -20 row
    expect(f[0]).not.toBe(f[2]);      // and the two rows differ by sign
    expect(green(f[0])).toBeGreaterThan(green(f[2]));
  });

  it("Footprint colorBy 'delta' scales the tint by the row's share of the bar's busiest row", () => {
    const fp = new Footprint({ ...cellStyle, colorBy: 'delta' });
    fp.setBars([computeFootprint(1, [
      { price: 100.05, qty: 20, side: 'ask' }, { price: 100.0, qty: 5, side: 'ask' },
    ], 0.05)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, rc());
    const f = cellFills(rec);
    expect(green(f[0])).toBeGreaterThan(green(f[2]));   // 20 of 20 against 5 of 20
  });

  it("Footprint colorBy 'delta' drops the saturated imbalance highlight", () => {
    const bars = [twoRows(30, 2)];                      // ask 30 over bid 2: a buy imbalance
    const imb = new Footprint({ ...cellStyle, imbalanceRatio: 3 });
    imb.setBars(bars);
    const a = makeCtx(); imb.draw(a.ctx, rc());
    expect(cellFills(a.rec)).toContain('#00ff00');      // saturated

    const dlt = new Footprint({ ...cellStyle, imbalanceRatio: 3, colorBy: 'delta' });
    dlt.setBars(bars);
    const b = makeCtx(); dlt.draw(b.ctx, rc());
    expect(cellFills(b.rec)).not.toContain('#00ff00');
  });

  it('Footprint draws no POC outline unless one is asked for', () => {
    const fp = new Footprint(cellStyle);
    fp.setBars([twoRows(30, 2)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, rc());
    expect(rec.count('strokeRect')).toBe(0);
  });

  it('Footprint pocOutline rings the bar highest-volume row', () => {
    const r = rc();
    const fp = new Footprint({ ...cellStyle, pocOutline: '#f0a020' });
    fp.setBars([twoRows(30, 2)]);                 // 30 at 100.05 is the POC row
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    const boxes = rec.ops.filter((o) => o.type === 'strokeRect');
    expect(boxes).toHaveLength(1);
    expect(boxes[0].strokeStyle).toBe('#f0a020');
    const [, y, , h] = boxes[0].args;
    // The row box is snapped to whole px, so its centre lands within one of the price.
    expect(Math.abs(y + h / 2 - r.priceScale.priceToY(100.05))).toBeLessThanOrEqual(1);
    expect(fp.stats()[0].poc).toBe(100.05);
  });

  it('Footprint reports the row and pane geometry a host needs to size rows by legibility', () => {
    const fine = new Footprint({ ...cellStyle, minTextHeight: 12 });
    fine.setBars([twoRows(30, 2)]);
    expect(fine.layout()).toEqual({ rowHeight: 0, paneHeight: 0, minTextHeight: 12 });  // nothing drawn yet
    fine.draw(makeCtx().ctx, rc());
    // 0.05 over a 5-point pane 400 px tall: 4 px a row, floored at 6, unreadable.
    expect(fine.layout()).toEqual({ rowHeight: 6, paneHeight: 400, minTextHeight: 12 });

    const coarse = new Footprint({ ...cellStyle, tickSize: 0.25, minTextHeight: 12 });
    coarse.setBars([twoRows(30, 2)]);
    coarse.draw(makeCtx().ctx, rc());
    const l = coarse.layout();
    expect(l.rowHeight).toBeCloseTo(20, 6);              // 0.25 over the same pane
    expect(l.rowHeight).toBeGreaterThanOrEqual(l.minTextHeight);
  });

  it("Footprint 'gutter' degrades to a full-height direction strip in a narrow slot", () => {
    const r = rcBars([bar(1, 100.0, 100.3, 99.9, 100.25, 0)]);
    // 14 px of slot leaves a 3 px gutter: a body over open-close there is a stub
    // nobody can read, so the strip takes the whole range and carries the colour.
    const fp = new Footprint({ ...candleStyle, candle: 'gutter', cellWidth: 14 });
    fp.setBars([askBar()]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    const [wick, strip] = rects(rec);
    expect(rects(rec)).toHaveLength(2);
    expect(wick.args[2]).toBe(1);                     // still a hairline wick
    expect(strip.args[1]).toBeCloseTo(r.priceScale.priceToY(100.3));
    expect(strip.args[1] + strip.args[3]).toBeCloseTo(r.priceScale.priceToY(99.9));
    expect(strip.fillStyle).toBe('#00ff00');          // close > open

    const down = new Footprint({ ...candleStyle, candle: 'gutter', cellWidth: 14 });
    down.setBars([askBar()]);
    const b = makeCtx();
    down.draw(b.ctx, rcBars([bar(1, 100.25, 100.3, 99.9, 100.0, 0)]));
    expect(rects(b.rec)[1].fillStyle).toBe('#ff0000');
  });

  it('Footprint hoverAt reports a zero-filled row instead of snapping to a traded one', () => {
    const r = rc();
    const fp = new Footprint({ tickSize: 0.05, statsRows: [], zeroFill: true });
    fp.setBars([computeFootprint(1, [
      { price: 100.0, qty: 5, side: 'ask' },
      { price: 100.2, qty: 7, side: 'ask' },
    ], 0.05)]);
    fp.draw(makeCtx().ctx, r);
    const x = r.timeScale.indexToX(0);
    // 100.05 is one row above a traded print, so the old scan snapped to it.
    expect(fp.hoverAt(x, r.priceScale.priceToY(100.05), r)?.cell)
      .toEqual({ price: 100.05, bidVol: 0, askVol: 0 });
    expect(fp.hoverAt(x, r.priceScale.priceToY(100.2), r)?.cell?.askVol).toBe(7);
  });

  it('Footprint zeroFill survives cells handed over low to high', () => {
    const r = rc();
    const fp = new Footprint({ ...cellStyle, zeroFill: true });
    // `FootprintBar.cells` is documented high to low, but nothing enforces it.
    fp.setBars([{
      time: 1,
      cells: [{ price: 100.0, bidVol: 0, askVol: 5 }, { price: 100.1, bidVol: 0, askVol: 5 }],
      delta: 10,
    }]);
    const { ctx, rec } = makeCtx();
    expect(() => fp.draw(ctx, r)).not.toThrow();
    expect(rec.count('roundRect')).toBe(6);          // 3 rows, still filled
  });

  it('Footprint zeroFill sums cells that collide on the row grid', () => {
    const r = rc();
    const fp = new Footprint({ ...cellStyle, zeroFill: true });
    // Aggregated at 0.01 but drawn on a 0.05 grid: the two prints share a row.
    fp.setBars([{
      time: 1,
      cells: [{ price: 100.01, bidVol: 0, askVol: 3 }, { price: 100.0, bidVol: 0, askVol: 4 }],
      delta: 7,
    }]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    expect(texts(rec)).toEqual(['0', '7']);          // not '4', which is last-wins
  });

  it('Footprint pocOutline lands on the row rect, not across its edges', () => {
    const r = rc();
    const fp = new Footprint({ ...cellStyle, pocOutline: '#f0a020' });
    fp.setBars([twoRows(30, 2)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    const cells = rec.ops.filter((o) => o.type === 'roundRect');
    const boxes = rec.ops.filter((o) => o.type === 'strokeRect');
    const box = boxes[0];
    // One closed rectangle around the whole row, not four corner marks: the
    // row is the unit the eye is being pointed at, and a bracket reads as a
    // range instead. Nothing is stroked as a path here.
    expect(boxes).toHaveLength(1);
    expect(rec.count('stroke')).toBe(0);
    expect(rec.count('moveTo')).toBe(0);
    const [cx, cy, , ch] = cells[0].args;                       // POC row, bid half
    const right = cells[1].args[0] + cells[1].args[2];          // ask half's right edge
    const lw = 1;                                              // dpr 1
    // A stroke straddles its path, so the rect is inset by half a line width.
    expect(box.args[0]).toBeCloseTo(cx + lw / 2);
    expect(box.args[0] + box.args[2]).toBeCloseTo(right - lw / 2);
    expect(box.args[1]).toBeCloseTo(cy + lw / 2);
    expect(box.args[1] + box.args[3]).toBeCloseTo(cy + ch - lw / 2);
  });

  it('Footprint onLayout pushes the geometry once per change, not once per frame', () => {
    const seen: { rowHeight: number; paneHeight: number; minTextHeight: number }[] = [];
    const fp = new Footprint({ ...cellStyle, onLayout: (l) => { seen.push(l); } });
    fp.setBars([twoRows(30, 2)]);
    const r = rc();
    fp.draw(makeCtx().ctx, r);
    expect(seen).toEqual([{ rowHeight: 6, paneHeight: 400, minTextHeight: 1 }]);
    fp.draw(makeCtx().ctx, r);
    expect(seen).toHaveLength(1);                    // same geometry, no second push
    fp.draw(makeCtx().ctx, { ...r, plotHeight: 300 });
    expect(seen).toHaveLength(2);                    // the pane resized
    expect(seen[1].paneHeight).toBe(300);
  });

  it('Footprint layout reports zeroes while there is nothing to draw', () => {
    const seen: number[] = [];
    const fp = new Footprint({ ...cellStyle, onLayout: (l) => { seen.push(l.paneHeight); } });
    fp.setBars([twoRows(30, 2)]);
    fp.draw(makeCtx().ctx, rc());
    fp.setBars([]);
    fp.draw(makeCtx().ctx, rc());
    expect(fp.layout()).toEqual({ rowHeight: 0, paneHeight: 0, minTextHeight: 1 });
    expect(seen).toEqual([400, 0]);
    expect(fp.hitTest(rc().timeScale.indexToX(0), 50)).toBeNull();   // no stale columns
  });
  it('Footprint keeps the background ramp, and ignores the plate knobs, until a plate is set', () => {
    const r = rc();
    const bars = [twoRows(30, 2)];
    const plain = new Footprint({ ...cellStyle, imbalanceRatio: 1e9 });
    plain.setBars(bars);
    const a = makeCtx(); plain.draw(a.ctx, r);
    // tintFloor, tintGain and tintCurve shape the plate ramp only. With no
    // plate the legacy background ramp has to survive them op for op.
    const knobs = new Footprint({
      ...cellStyle, imbalanceRatio: 1e9, tintFloor: 0.9, tintGain: 0.1, tintCurve: 'linear',
    });
    knobs.setBars(bars);
    const b = makeCtx(); knobs.draw(b.ctx, r);
    expect(b.rec.ops).toEqual(a.rec.ops);
    expect(knobs.stats()).toEqual(plain.stats());
    expect(knobs.autoscaleInfo()).toEqual(plain.autoscaleInfo());
    // And the ramp is still the eased one off the pane: 0.08 of the way at zero
    // volume, 0.70 at the bar's peak side, mixed per channel off #0d0e12.
    const f = cellFills(a.rec);
    expect(f[0]).toBe('rgb(32,13,17)');    // 0 bid, sell #ff0000 at 0.08
    expect(f[1]).toBe('rgb(4,183,5)');     // 30 of 30 ask, buy #00ff00 at 0.70
  });

  it('Footprint cellBaseColor tints from an opaque plate instead of the pane background', () => {
    const r = rc();
    const fp = new Footprint({ ...cellStyle, imbalanceRatio: 1e9, cellBaseColor: '#a0a0a0' });
    fp.setBars([twoRows(30, 2)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    const f = cellFills(rec);
    // tintFloor 0 with tintGain 1: an untraded half is the bare plate and the
    // bar's peak side is the raw colour. A one-lot row now sits on an opaque
    // plate rather than fading into the pane, which is the whole point.
    expect(f[0]).toBe('rgb(160,160,160)');
    expect(f[1]).toBe('rgb(0,255,0)');
    expect(f[3]).toBe('rgb(160,160,160)');
    expect(f[2]).not.toBe('rgb(160,160,160)');   // 2 of 30 bid, faintly tinted
  });

  it('Footprint cellBaseColor also backs the flat delta column', () => {
    const fp = new Footprint({ ...cellStyle, cells: 'deltaVolume', cellBaseColor: '#a0a0a0' });
    fp.setBars([twoRows(30, 2)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, rc());
    // The delta half carries no intensity, so it is the plate itself. Left on
    // the pane background it would read as a hole in the ladder.
    expect(cellFills(rec)[0]).toBe('rgb(160,160,160)');
  });

  it('Footprint tintCurve, tintFloor and tintGain shape the plate ramp', () => {
    const r = rc();
    const bars = [computeFootprint(1, [
      { price: 100.05, qty: 100, side: 'ask' }, { price: 100.0, qty: 25, side: 'ask' },
    ], 0.05)];
    const paint = (o: Partial<FootprintOptions>): string[] => {
      const fp = new Footprint({ ...cellStyle, imbalanceRatio: 1e9, cellBaseColor: '#a0a0a0', ...o });
      fp.setBars(bars);
      const { ctx, rec } = makeCtx();
      fp.draw(ctx, r);
      return cellFills(rec);
    };
    // The quiet row carries a quarter of the peak: eased that reads at half the
    // ramp, linear at a quarter of it.
    expect(paint({})[3]).toBe('rgb(80,208,80)');
    expect(paint({ tintCurve: 'linear' })[3]).toBe('rgb(120,184,120)');
    // Gain 0 flattens the ladder to one tone at the floor.
    const flat = paint({ tintFloor: 0.6, tintGain: 0 });
    expect(flat[1]).toBe('rgb(64,217,64)');
    expect(flat[3]).toBe(flat[1]);
    // The ramp is clamped, so a floor plus a full gain lands on the raw colour
    // rather than overshooting it into nonsense.
    expect(paint({ tintFloor: 0.5 })[1]).toBe('rgb(0,255,0)');
  });
  it('Footprint draws no per-row volume bar unless one is asked for', () => {
    const r = rc();
    const bars = [twoRows(30, 15)];
    const off = new Footprint(cellStyle);
    off.setBars(bars);
    const a = makeCtx(); off.draw(a.ctx, r);
    // The colour and the width factor are inert on their own: a host that
    // styles the bar without switching it on gets today's ladder back.
    const styled = new Footprint({ ...cellStyle, volumeBarColor: '#ff7e00', volumeBarWidthFactor: 2 });
    styled.setBars(bars);
    const b = makeCtx(); styled.draw(b.ctx, r);
    expect(b.rec.ops).toEqual(a.rec.ops);
    expect(a.rec.count('fillRect')).toBe(0);
    expect(styled.stats()).toEqual(off.stats());
    expect(styled.autoscaleInfo()).toEqual(off.autoscaleInfo());
  });

  it('Footprint showVolumeBar draws one bar a row, scaled by the bar busiest row', () => {
    const r = rc();
    const fp = new Footprint({ ...cellStyle, showVolumeBar: true });
    fp.setBars([twoRows(30, 15)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    const cells = rec.ops.filter((o) => o.type === 'roundRect');
    const vols = rec.ops.filter((o) => o.type === 'fillRect');
    expect(vols).toHaveLength(cells.length / 2);        // one a row, not one a cell
    const colW = 24;                                   // the auto-sized column
    const right = cells[1].args[0] + cells[1].args[2];  // the ladder's right edge
    // The busiest row runs the full length and the half-volume row half of it,
    // both clear of the ask cells rather than under their numbers.
    expect(vols[0].args[0]).toBeCloseTo(right + 1);
    expect(vols[0].args[2]).toBeCloseTo(colW * 0.5);
    expect(vols[1].args[2]).toBeCloseTo(colW * 0.5 * 0.5);
    // Row aligned, so the bar reads as part of its row.
    expect(vols[0].args[1]).toBe(cells[0].args[1]);
    expect(vols[0].args[3]).toBe(cells[0].args[3]);
  });

  it('Footprint volume bars take the row direction unless a colour is pinned', () => {
    const r = rc();
    const fp = new Footprint({ ...cellStyle, showVolumeBar: true });
    fp.setBars([twoRows(30, 15)]);                     // an ask row over a bid row
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    expect(rec.ops.filter((o) => o.type === 'fillRect').map((o) => o.fillStyle))
      .toEqual(['#00ff00', '#ff0000']);
    const pinned = new Footprint({ ...cellStyle, showVolumeBar: true, volumeBarColor: '#ff7e00' });
    pinned.setBars([twoRows(30, 15)]);
    const b = makeCtx(); pinned.draw(b.ctx, r);
    expect(b.rec.ops.filter((o) => o.type === 'fillRect').map((o) => o.fillStyle))
      .toEqual(['#ff7e00', '#ff7e00']);
  });

  it('Footprint volumeBarWidthFactor measures the bar against the column', () => {
    const r = rc();
    const paint = (f: number): number => {
      const fp = new Footprint({ ...cellStyle, showVolumeBar: true, volumeBarWidthFactor: f, cellWidth: 40 });
      fp.setBars([twoRows(30, 15)]);
      const { ctx, rec } = makeCtx();
      fp.draw(ctx, r);
      return (rec.ops.find((o) => o.type === 'fillRect') as Op).args[2];
    };
    expect(paint(0.5)).toBeCloseTo(20);
    expect(paint(1)).toBeCloseTo(40);
  });

  it('Footprint volume bars cost a visible row each, not a row of the bar', () => {
    const r = rc();                                    // the pane covers 98..103
    const fp = new Footprint({ ...cellStyle, showVolumeBar: true, zeroFill: true });
    fp.setBars([computeFootprint(1, [
      { price: 100.0, qty: 1, side: 'ask' },
      { price: 200.0, qty: 1, side: 'ask' },
    ], 0.05)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    expect(rec.count('roundRect')).toBe(2);            // one row survives the cull
    expect(rec.count('fillRect')).toBe(1);             // and one bar with it
  });
  it('Footprint writes white on a graded cell and near-black on a saturated one', () => {
    const r = rc();
    const fp = new Footprint({ ...cellStyle, imbalanceRatio: 3 });
    fp.setBars([twoRows(30, 2)]);          // the 30 ask is a buy imbalance
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    // The automatic choice, which an unset pair has to leave exactly as it is:
    // white at 0.9, dimmed to 0.45 on a zero row, near-black on a hot plate.
    expect(rec.ops.filter((o) => o.type === 'fillText').map((o) => [o.text, o.fillStyle])).toEqual([
      ['0', 'rgba(255,255,255,0.45)'],
      ['30', 'rgba(13,15,20,1)'],
      ['2', 'rgba(255,255,255,0.9)'],
      ['0', 'rgba(255,255,255,0.45)'],
    ]);
  });

  it('Footprint cellTextColor and cellTextColorHot restyle the numbers without moving them', () => {
    const r = rc();
    const style = { ...cellStyle, imbalanceRatio: 3 };
    const plain = new Footprint(style);
    plain.setBars([twoRows(30, 2)]);
    const a = makeCtx(); plain.draw(a.ctx, r);
    const themed = new Footprint({ ...style, cellTextColor: '#101010', cellTextColorHot: '#fefefe' });
    themed.setBars([twoRows(30, 2)]);
    const b = makeCtx(); themed.draw(b.ctx, r);
    const text = (rec: RecordingContext): Op[] => rec.ops.filter((o) => o.type === 'fillText');
    expect(text(b.rec).map((o) => o.fillStyle)).toEqual([
      'rgba(16,16,16,0.45)', 'rgba(254,254,254,1)', 'rgba(16,16,16,0.9)', 'rgba(16,16,16,0.45)',
    ]);
    // Only the ink changed: same numbers in the same places on the same plates.
    expect(text(b.rec).map((o) => [o.text, ...o.args])).toEqual(text(a.rec).map((o) => [o.text, ...o.args]));
    expect(b.rec.ops.filter((o) => o.type === 'fill')).toEqual(a.rec.ops.filter((o) => o.type === 'fill'));
  });

  it('Footprint keeps the deltaVolume sign colour ahead of cellTextColor', () => {
    const fp = new Footprint({ ...cellStyle, cells: 'deltaVolume', cellTextColor: '#101010' });
    fp.setBars([computeFootprint(1, [
      { price: 100.0, qty: 2, side: 'ask' }, { price: 100.0, qty: 9, side: 'bid' },
    ], 0.05)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, rc());
    const t = rec.ops.filter((o) => o.type === 'fillText');
    // A negative row delta says which way it went in the sell colour. That is
    // the number's meaning, not its theme, so the ink colour does not take it.
    expect(t.find((o) => o.text === '-7')?.fillStyle).toBe('rgba(255,0,0,0.9)');
    expect(t.find((o) => o.text === '11')?.fillStyle).toBe('rgba(16,16,16,0.9)');
  });
  it('Footprint pocOutlineWidth thickens the ring, in media px', () => {
    const r = rc();
    const ring = (o: Partial<FootprintOptions>, into: PrimitiveRenderContext): Op => {
      const fp = new Footprint({ ...cellStyle, pocOutline: '#f0a020', ...o });
      fp.setBars([twoRows(30, 2)]);
      const { ctx, rec } = makeCtx();
      fp.draw(ctx, into);
      return rec.ops.filter((op) => op.type === 'strokeRect')[0];
    };
    // The default is the hairline the ladder shipped with.
    expect(ring({}, r).lineWidth).toBe(1);
    const thick = ring({ pocOutlineWidth: 3 }, r);
    expect(thick.lineWidth).toBe(3);
    // A stroke straddles its path, so the inset follows the width and a fat
    // ring still lands inside its own row instead of over its neighbours.
    expect(thick.args[0]).toBeCloseTo(ring({}, r).args[0] + 1);
    expect(thick.args[2]).toBeCloseTo(ring({}, r).args[2] - 2);
    // Media px, so the ring is the same weight on a retina pane: 1 becomes 2
    // device px there and 3 becomes 6.
    const hidpi = { ...r, dpr: 2 };
    expect(ring({}, hidpi).lineWidth).toBe(2);
    expect(ring({ pocOutlineWidth: 3 }, hidpi).lineWidth).toBe(6);
  });
  it('Footprint volume bars clear the stacked-imbalance bracket lane', () => {
    const r = rc();
    // Three consecutive ask-dominant rows: a buy run, so the bracket draws in
    // the lane just right of the ladder, which is where the bar starts too.
    const fp = new Footprint({
      ...cellStyle, showVolumeBar: true, stackedImbalances: 3, imbalanceRatio: 3,
    });
    fp.setBars([computeFootprint(1, [
      { price: 100.15, qty: 90, side: 'ask' },
      { price: 100.10, qty: 90, side: 'ask' },
      { price: 100.05, qty: 90, side: 'ask' },
      { price: 100.00, qty: 1, side: 'bid' },
    ], 0.05)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    const lane = rec.ops.filter((o) => o.type === 'moveTo' || o.type === 'lineTo');
    const vols = rec.ops.filter((o) => o.type === 'fillRect');
    expect(lane.length).toBeGreaterThan(0);          // the bracket really drew
    expect(vols.length).toBeGreaterThan(0);
    const bracketRight = Math.max(...lane.map((o) => o.args[0]));
    const barLeft = Math.min(...vols.map((o) => o.args[0]));
    expect(barLeft).toBeGreaterThanOrEqual(bracketRight);
  });

  it('Footprint keeps the volume bar tight to the ladder with no brackets to clear', () => {
    const r = rc();
    const fp = new Footprint({ ...cellStyle, showVolumeBar: true });   // stackedImbalances 0
    fp.setBars([twoRows(30, 15)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    const cells = rec.ops.filter((o) => o.type === 'roundRect');
    const right = cells[1].args[0] + cells[1].args[2];
    expect((rec.ops.find((o) => o.type === 'fillRect') as Op).args[0]).toBeCloseTo(right + 1);
  });

  it('Footprint clamps the POC ring to the row it is ringing', () => {
    const r = rc();
    const fp = new Footprint({ ...cellStyle, pocOutline: '#f0a020', pocOutlineWidth: 8 });
    fp.setBars([twoRows(30, 2)]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, r);
    const box = rec.ops.filter((o) => o.type === 'strokeRect')[0];
    // The row is 5 px tall here, so 8 px of ring cannot straddle it: clamped,
    // the rect degrades to a filled row rather than inverting its height.
    expect(box.lineWidth).toBe(5);
    expect(box.args[3]).toBe(0);
    expect(box.args[2]).toBeGreaterThanOrEqual(0);
  });
});
