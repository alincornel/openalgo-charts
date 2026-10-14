/**
 * The two-tap flatten after its 5 s window has run out.
 *
 * `updatePositionPnl` recorded the line's new signature but patched only the
 * money, so once the window had lapsed the pill it left behind had no badge,
 * size or close button, and the next `setPositions` (signature unchanged, so
 * patched in place) never put them back. And nothing repainted the pill when
 * the window lapsed, so it kept asking its question after the second tap had
 * stopped meaning yes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradingController, type TradingHost, type TradingPosition } from '../src/core/trading-controller';
import { PriceLine } from '../src/primitives/price-line';
import type { IPrimitive } from '../src/primitives/primitive';

function fakeHost(): { host: TradingHost; line: () => PriceLine; click: (id: string) => void } {
  const added: IPrimitive[] = [];
  let clickCb: (id: string) => void = () => {};
  const host: TradingHost = {
    addPrimitive: (p) => { added.push(p); },
    removePrimitive: (p) => { const i = added.indexOf(p); if (i >= 0) added.splice(i, 1); },
    subscribeClick: (cb) => { clickCb = cb; },
    subscribeDrag: () => {},
  };
  const line = (): PriceLine => added.filter((p): p is PriceLine => p instanceof PriceLine).at(-1)!;
  return { host, line, click: (id) => clickCb(id) };
}

const P1: TradingPosition = { id: 'p1', side: 'long', entryPrice: 100, size: 2, pnlText: '+$1' };

function expectClassicPill(line: PriceLine, money: string): void {
  const o = line.options();
  expect(o.pillSegments).toBeUndefined();
  expect(o.badge).toBe('LONG');
  expect(o.qty).toBe(2);
  expect(o.closeButton).toBe(true);
  expect(o.leftLabel).toBe(money);
}

describe('a flatten whose confirmation window has run out', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('repaints the normal pill when the window lapses, and the next tap asks again', () => {
    const h = fakeHost();
    const tc = new TradingController(h.host);
    const onClose = vi.fn();
    const onAsk = vi.fn();
    tc.on('trading:position_close', onClose);
    tc.on('trading:position_close_armed', onAsk);
    tc.setPositions([P1]);

    h.click('pos:p1::close');
    expect(h.line().options().pillSegments?.some((s) => s.text === 'SIGUR?')).toBe(true);
    vi.advanceTimersByTime(6_000);
    expectClassicPill(h.line(), '+$1');

    tc.updatePositionPnl('p1', 2, '+$2');
    expectClassicPill(h.line(), '+$2');
    tc.setPositions([{ ...P1, pnlText: '+$2' }]);
    expectClassicPill(h.line(), '+$2');

    h.click('pos:p1::close');
    expect(onClose).not.toHaveBeenCalled();
    expect(onAsk).toHaveBeenCalledTimes(2);
  });

  it('patches the badge, size and close button when a P&L update finds the window gone', () => {
    const h = fakeHost();
    const tc = new TradingController(h.host);
    tc.setPositions([P1]);
    h.click('pos:p1::close');
    // The clock moves on but the expiry has not run yet: the P&L update is
    // the first to see that the confirmation is over.
    vi.setSystemTime(Date.now() + 6_000);

    tc.updatePositionPnl('p1', 2, '+$2');
    expectClassicPill(h.line(), '+$2');
    tc.setPositions([{ ...P1, pnlText: '+$2' }]);
    expectClassicPill(h.line(), '+$2');
  });

  it('stops the expiry when the layer is cleared', () => {
    const h = fakeHost();
    const tc = new TradingController(h.host);
    tc.setPositions([P1]);
    h.click('pos:p1::close');
    tc.clear();
    expect(vi.getTimerCount()).toBe(0);
  });
});
