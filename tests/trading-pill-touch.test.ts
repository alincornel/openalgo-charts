/**
 * The position pill as a set of buttons, and what it takes for a thumb to
 * press one. Every assertion here exists because a mouse could already do the
 * thing and a finger could not: the segment was too small, the press was
 * consumed by the pan, or the release landed after the chart had scrolled.
 */
import { describe, it, expect, vi } from 'vitest';
import { TradingController } from '../src/core/trading-controller';
import type { TradingHost } from '../src/core/trading-controller';
import { PriceLine } from '../src/primitives/price-line';
import type { IPrimitive, PrimitiveRenderContext } from '../src/primitives/primitive';
import { DataLayer } from '../src/model/data-layer';
import { PriceScale } from '../src/scale/price-scale';
import { TimeScale } from '../src/scale/time-scale';
import { darkTheme } from '../src/theme';
import { RecordingContext } from './helpers/fake-ctx';

function fakeHost(): { host: TradingHost; lines: () => PriceLine[]; click: (id: string) => void } {
  const added: IPrimitive[] = [];
  let clickCb: (id: string) => void = () => {};
  const host: TradingHost = {
    addPrimitive: (p) => { added.push(p); },
    removePrimitive: (p) => { const i = added.indexOf(p); if (i >= 0) added.splice(i, 1); },
    subscribeClick: (cb) => { clickCb = cb; },
    subscribeDrag: () => {},
  };
  return { host, lines: () => added.filter((p): p is PriceLine => p instanceof PriceLine), click: (id) => clickCb(id) };
}

function rc(): PrimitiveRenderContext {
  const dl = new DataLayer();
  const id = dl.createSeries();
  dl.setSeriesData(id, [{ time: 100, open: 50, high: 52, low: 48, close: 50 }]);
  const priceScale = new PriceScale();
  priceScale.setHeight(400);
  priceScale.setPriceRange({ min: 40, max: 60 });
  const timeScale = new TimeScale({ barSpacing: 20, rightOffset: 0 });
  timeScale.setWidth(600);
  timeScale.setBaseIndex(dl.baseIndex);
  return { timeScale, priceScale, dataLayer: dl, plotWidth: 600, plotHeight: 400, priceAxisWidth: 56, dpr: 1, theme: darkTheme };
}

describe('position pill buttons', () => {
  it('offers TP and SL only when the host asks, each on its own', () => {
    const h = fakeHost();
    const tc = new TradingController(h.host);
    tc.setPositions([{ id: 'p1', side: 'long', entryPrice: 100, size: 2, pnlText: '+$25.00' }]);
    // Nothing asked for: the classic pill, byte-identical to what shipped.
    expect(h.lines()[0].options().pillSegments).toBeUndefined();
    expect(h.lines()[0].options().badge).toBe('LONG');

    // A position that already has a stop working at the broker should be
    // offered the target alone, which is why the two are separate flags.
    tc.setPositions([{ id: 'p1', side: 'long', entryPrice: 100, size: 2, pnlText: '+$25.00', tpButton: true }]);
    expect(h.lines()[0].options().pillSegments?.map((s) => s.id)).toEqual([
      undefined, undefined, undefined, 'pos:p1::tp', 'pos:p1::close',
    ]);

    tc.setPositions([{ id: 'p1', side: 'long', entryPrice: 100, size: 2, pnlText: '+$25.00', tpButton: true, slButton: true }]);
    const segments = h.lines()[0].options().pillSegments;
    expect(segments?.map((s) => s.close === true ? 'close' : s.text)).toEqual([
      'LONG', '2', '+$25.00', 'TP', 'SL', 'close',
    ]);
  });

  it('emits a distinct event per button, and still closes on the x', () => {
    const h = fakeHost();
    const tc = new TradingController(h.host);
    const onTp = vi.fn();
    const onSl = vi.fn();
    const onClose = vi.fn();
    tc.on('trading:position_tp', onTp);
    tc.on('trading:position_sl', onSl);
    tc.on('trading:position_close', onClose);
    tc.setPositions([{ id: 'p1', side: 'short', entryPrice: 100, size: 1, tpButton: true, slButton: true }]);

    h.click('pos:p1::tp');
    h.click('pos:p1::sl');
    // Two taps on the ✕: attaching a bracket is one tap because it is
    // reversible, flattening is two because it is not.
    h.click('pos:p1::close');
    h.click('pos:p1::close');
    expect(onTp).toHaveBeenCalledWith({ positionId: 'p1' });
    expect(onSl).toHaveBeenCalledWith({ positionId: 'p1' });
    expect(onClose).toHaveBeenCalledWith({ positionId: 'p1' });
  });

  it('keeps the same line when only the money on it changed', () => {
    const h = fakeHost();
    const tc = new TradingController(h.host);
    const position = { id: 'p1', side: 'long' as const, entryPrice: 100, size: 1, tpButton: true };
    tc.setPositions([{ ...position, pnlText: '+$25.00' }]);
    const line = h.lines()[0];
    // P&L moves with every print. Rebuilding the primitive at that rate would
    // flicker the pill and strand any drag in progress.
    tc.setPositions([{ ...position, pnlText: '+$50.00' }]);
    expect(h.lines()[0]).toBe(line);
    expect(line.options().pillSegments?.[2].text).toBe('+$50.00');
  });

  it('moves the money on a segmented pill, not only on the classic one', () => {
    const h = fakeHost();
    const tc = new TradingController(h.host);
    // A position with a leg missing gets a button for it, and a pill with
    // buttons draws its money in a SEGMENT rather than in the left label. This
    // is the pill a live chart shows most of the time.
    tc.setPositions([{ id: 'p1', side: 'long', entryPrice: 100, size: 1, pnlText: '+$25.00', tpButton: true }]);
    const line = h.lines()[0];
    expect(line.options().leftLabel).toBeUndefined();

    // P&L takes the patch path between syncs, because pushing it through
    // `syncState` re-asserts every stored price on every print.
    tc.updatePositionPnl('p1', 50, '+$50.00');
    expect(h.lines()[0]).toBe(line);
    expect(line.options().pillSegments?.[2].text).toBe('+$50.00');

    // And the sync that follows patches the same line rather than rebuilding
    // it over money it already carries.
    tc.setPositions([{ id: 'p1', side: 'long', entryPrice: 100, size: 1, pnlText: '+$50.00', tpButton: true }]);
    expect(h.lines()[0]).toBe(line);
  });

  it('gives a pill its first money without tearing the line down', () => {
    const h = fakeHost();
    const tc = new TradingController(h.host);
    // No last price yet: the pill omits the money rather than printing one
    // computed against nothing, so the segment is not there at all.
    tc.setPositions([{ id: 'p1', side: 'short', entryPrice: 100, size: 1, tpButton: true, slButton: true }]);
    const line = h.lines()[0];
    expect(line.options().pillSegments?.map((s) => s.text)).toEqual(['SHORT', '1', 'TP', 'SL', undefined]);

    tc.updatePositionPnl('p1', -12.5, '−$12.50');
    expect(h.lines()[0]).toBe(line);
    expect(line.options().pillSegments?.map((s) => s.text)).toEqual(['SHORT', '1', '−$12.50', 'TP', 'SL', undefined]);
  });

  it('does not rebuild the line when the money it was just given comes back in a sync', () => {
    const h = fakeHost();
    const tc = new TradingController(h.host);
    const position = { id: 'p1', side: 'long' as const, entryPrice: 100, size: 1, tpButton: true };
    // No last price yet, so no money segment at all.
    tc.setPositions([position]);
    const line = h.lines()[0];

    // The first money CHANGES THE SEGMENT COUNT, and the signature counts
    // segments. Applied here in place, it has to be recorded here too, or the
    // very next sync tears the line down over a change already on screen.
    tc.updatePositionPnl('p1', 25, '+$25.00');
    expect(h.lines()[0]).toBe(line);
    tc.setPositions([{ ...position, pnlText: '+$25.00' }]);
    expect(h.lines()[0]).toBe(line);
  });

  it('takes the money off a pill when the host no longer has one', () => {
    const h = fakeHost();
    const tc = new TradingController(h.host);
    tc.setPositions([{ id: 'p1', side: 'long', entryPrice: 100, size: 1, pnlText: '+$25.00' }]);
    const line = h.lines()[0];
    expect(line.options().leftLabel).toBe('+$25.00');

    // No last trade, or a contract with no multiplier: there is no honest
    // number to print. A pill that keeps the last one is read as live.
    tc.updatePositionPnl('p1', null, null);
    expect(line.options().leftLabel).toBe('');

    // `undefined` still means "leave it alone", which is what a host that only
    // wants to update the percentage relies on.
    tc.updatePositionPnl('p1', 30, '+$30.00');
    expect(line.options().leftLabel).toBe('+$30.00');
    tc.updatePositionPnl('p1', null);
    expect(line.options().leftLabel).toBe('+$30.00');
  });

  it('takes the money off a segmented pill too', () => {
    const h = fakeHost();
    const tc = new TradingController(h.host);
    tc.setPositions([{ id: 'p1', side: 'short', entryPrice: 100, size: 1, pnlText: '−$12.50', slButton: true }]);
    const line = h.lines()[0];
    expect(line.options().pillSegments?.map((segment) => segment.text)).toEqual(['SHORT', '1', '−$12.50', 'SL', undefined]);

    tc.updatePositionPnl('p1', null, null);
    expect(line.options().pillSegments?.map((segment) => segment.text)).toEqual(['SHORT', '1', 'SL', undefined]);
  });

  it('carries a note segment on an order without recreating it per tick', () => {
    const h = fakeHost();
    const tc = new TradingController(h.host);
    const order = { id: 'tp1', type: 'limit' as const, side: 'sell' as const, price: 110, size: 1, bracketRole: 'tp' as const };
    tc.setOrders([{ ...order, note: '+$150.00' }]);
    const line = h.lines()[0];
    expect(line.options().note).toBe('+$150.00');
    tc.setOrders([{ ...order, note: '+$160.00' }]);
    expect(h.lines()[0]).toBe(line);
    expect(line.options().note).toBe('+$160.00');
  });
});

describe('the pill on a phone-sized plot', () => {
  /** The same context, at the plot width a 390 px phone actually gives. */
  function narrowRc(): PrimitiveRenderContext {
    return { ...rc(), plotWidth: 334, timeScale: rc().timeScale };
  }

  it('slides left to stay inside the plot instead of running under the axis', () => {
    // 334 px of plot is a 390 px phone minus its price axis. The pill anchors
    // at 30% from the right, which on a screen this narrow leaves nowhere near
    // enough room for six segments, so it has to give ground to the left.
    const line = new PriceLine({
      price: 50, color: '#2f6df6', id: 'pos:p1', extentFromRight: 1, pillInsetFromRight: 0.3,
      pillSegments: [
        { text: 'LONG', fill: '#2f6df6' },
        { text: '1' },
        { text: '-$1,234.50' },
        { id: 'pos:p1::tp', text: 'TP', fill: '#26a69a', minWidth: 40 },
        { id: 'pos:p1::sl', text: 'SL', fill: '#ef5350', minWidth: 40 },
        { id: 'pos:p1::close', close: true, minWidth: 40 },
      ],
    });
    const context = narrowRc();
    line.draw(new RecordingContext() as unknown as CanvasRenderingContext2D, context);

    // Every button still answers, and none of them sits off the plot.
    for (const id of ['pos:p1::tp', 'pos:p1::sl', 'pos:p1::close']) {
      const x = firstXAnswering(line, context, id);
      expect(x).not.toBeNull();
      expect(x as number).toBeGreaterThanOrEqual(0);
      expect(x as number).toBeLessThanOrEqual(context.plotWidth);
    }
  });

  /** The leftmost x at which the line hit-tests as `id`, or null. */
  function firstXAnswering(line: PriceLine, context: PrimitiveRenderContext, id: string): number | null {
    for (let x = 0; x <= context.plotWidth; x += 1) {
      if (line.hitTest(x, 200, context)?.externalId === id) return x;
    }
    return null;
  }
});

describe('a pill segment is a target, not a glyph', () => {
  /** Draw a pill and report which id a press at (x, y) resolves to. */
  function pressed(line: PriceLine, x: number, y: number): string | null {
    const context = rc();
    line.draw(new RecordingContext() as unknown as CanvasRenderingContext2D, context);
    return line.hitTest(x, y, context)?.externalId ?? null;
  }

  it('resolves a press inside a button to that button', () => {
    const line = new PriceLine({
      price: 50, color: '#fff', id: 'pos:p1', extentFromRight: 1, pillInsetFromRight: 1,
      pillSegments: [
        { text: 'LONG', fill: '#2f6df6' },
        { id: 'pos:p1::tp', text: 'TP', fill: '#26a69a', minWidth: 40 },
        { id: 'pos:p1::close', close: true, minWidth: 40 },
      ],
    });
    // y = 200 is the line itself: price 50 in a 40..60 range over 400px.
    // Segment 0 measures 4 glyphs * 6 + 12 = 36 px from x = 6.
    expect(pressed(line, 20, 200)).toBe('pos:p1');
    expect(pressed(line, 60, 200)).toBe('pos:p1::tp');
    expect(pressed(line, 105, 200)).toBe('pos:p1::close');
  });

  it('widens a two-letter button to a size a thumb can find', () => {
    const narrow = new PriceLine({
      price: 50, color: '#fff', id: 'pos:p1', pillInsetFromRight: 1,
      pillSegments: [{ id: 'pos:p1::tp', text: 'TP', fill: '#26a69a' }],
    });
    const padded = new PriceLine({
      price: 50, color: '#fff', id: 'pos:p1', pillInsetFromRight: 1,
      pillSegments: [{ id: 'pos:p1::tp', text: 'TP', fill: '#26a69a', minWidth: 40 }],
    });
    // 'TP' measures 24 px of glyphs plus 12 of padding: a 36 px hit box that
    // ends before x = 42, where the padded one still answers.
    expect(pressed(narrow, 42, 200)).toBe('pos:p1');
    expect(pressed(padded, 42, 200)).toBe('pos:p1::tp');
  });

  it('accepts a press a few pixels off the pill, which is how a thumb lands', () => {
    const line = new PriceLine({
      price: 50, color: '#fff', id: 'pos:p1', pillInsetFromRight: 1,
      pillSegments: [{ id: 'pos:p1::tp', text: 'TP', fill: '#26a69a', minWidth: 40 }],
    });
    // The pill draws 18 px tall. A finger that lands 12 px high still meant it.
    expect(pressed(line, 20, 189)).toBe('pos:p1::tp');
    expect(pressed(line, 20, 211)).toBe('pos:p1::tp');
    // Far enough away and it is the plain line again, not the button.
    expect(pressed(line, 20, 180)).toBeNull();
  });

  it('keeps the ✕ when a full bracket has taken the TP and SL buttons away', () => {
    // The host stops offering TP/SL once both exist. If that also removed the
    // segments, a protected position would be the one you cannot flatten from
    // the chart.
    const h = fakeHost();
    const tc = new TradingController(h.host);
    const onClose = vi.fn();
    tc.on('trading:position_close', onClose);
    tc.setPositions([{ id: 'p1', side: 'long', entryPrice: 100, size: 1, tpButton: false, slButton: false }]);

    h.click('pos:p1::close');
    h.click('pos:p1::close');
    expect(onClose).toHaveBeenCalledWith({ positionId: 'p1' });
  });
});
