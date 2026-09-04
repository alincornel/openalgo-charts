/**
 * A dragged order line versus the exchange state arriving underneath it.
 *
 * The host that ships this chart re-syncs its trading state whenever anything
 * in the payload moves, and with a position open that is every tick. Each of
 * those syncs used to write the broker's stored price back onto the line the
 * finger was holding, so the line snapped back and the next pointermove threw
 * it forward again: a drag that jumped instead of following the pointer.
 *
 * Driven through `Chart` pointer events rather than the controller's callbacks
 * on purpose — the bug lives in the seam between the two, and an option that
 * dies between chart and pane has bitten this repo before.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Chart } from '../src/core/chart';
import { PriceLine } from '../src/primitives/price-line';
import type { IPrimitive } from '../src/primitives/primitive';
import { fakeDocument, pointer, type FakeElement } from './helpers/fake-dom';
import type { Bar } from '../src/model/bar';
import type { TradingOrder } from '../src/core/trading-controller';

beforeAll(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window ??= {};
});

const W = 800;
const H = 600;

function bars(n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + Math.sin(i / 4) * 5;
    return { time: 1700000000 + i * 60, open: c, high: c + 2, low: c - 2, close: c, volume: 10 };
  });
}

function makeChart(): {
  chart: Chart;
  el: FakeElement;
  /** The live price-line for an order id, whether patched in place or rebuilt. */
  line: (id: string) => PriceLine;
  priceAt: (y: number) => number;
  paint: () => void;
} {
  const el = fakeDocument().createElement('div') as unknown as FakeElement;
  const chart = new Chart(el, {
    document: fakeDocument(),
    pixelRatio: () => 1,
    shortcuts: false,
    raf: { schedule: (cb: () => void) => { cb(); return 1; }, cancel: () => {} },
  });
  chart.applySize(W, H);
  chart.addSeries('candlestick').setData(bars(120));

  // The controller reaches its lines through the chart's `addPrimitive`, so
  // this is where a test can get hold of them.
  const added: PriceLine[] = [];
  const original = chart.addPrimitive.bind(chart);
  (chart as unknown as { addPrimitive: (p: IPrimitive) => void }).addPrimitive = (p: IPrimitive) => {
    if (p instanceof PriceLine) added.push(p);
    original(p);
  };

  return {
    chart,
    el,
    line: (id) => {
      const match = added.filter((l) => l.options().id === `ord:${id}`);
      const last = match[match.length - 1];
      if (last === undefined) throw new Error(`no line for ${id}`);
      return last;
    },
    priceAt: (y) => chart.coordinateToPrice(y, 0) as number,
    paint: () => { chart.applySize(W, H); },
  };
}

function order(price: number, extra: Partial<TradingOrder> = {}): TradingOrder {
  return { id: 'o1', type: 'limit', side: 'buy', price, size: 1, ...extra };
}

describe('an order line being dragged', () => {
  it('keeps the price under the pointer while the broker state syncs underneath', () => {
    const { chart, el, line, priceAt, paint } = makeChart();
    const onModify = vi.fn();
    chart.trading.on('trading:order_modify', onModify);

    const stored = priceAt(300);
    chart.trading.syncState({ orders: [order(stored)] });
    paint(); // give the line geometry to hit-test against

    el.dispatch('pointerdown', pointer('down', 400, 300));
    el.dispatch('pointermove', pointer('move', 400, 240));
    const held = priceAt(240);
    expect(line('o1').price).toBeCloseTo(held, 8);

    // The host re-syncs: nothing about this order changed, only the P&L text on
    // a position elsewhere in the same payload. The held line must not move.
    chart.trading.syncState({ orders: [order(stored)] });
    expect(line('o1').price).toBeCloseTo(held, 8);

    // A second move still tracks the pointer, and the release reports the drag
    // against where it started — not against whatever the sync carried.
    el.dispatch('pointermove', pointer('move', 400, 200));
    const released = priceAt(200);
    expect(line('o1').price).toBeCloseTo(released, 8);
    el.dispatch('pointerup', pointer('up', 400, 200));
    expect(onModify).toHaveBeenCalledTimes(1);
    const payload = onModify.mock.calls[0][0] as { orderId: string; newPrice: number; previousPrice: number };
    expect(payload.orderId).toBe('o1');
    expect(payload.newPrice).toBeCloseTo(released, 8);
    expect(payload.previousPrice).toBeCloseTo(stored, 8);

    // The finger is off: the broker is the truth again, including a rejection
    // that puts the order back where it was.
    chart.trading.syncState({ orders: [order(stored)] });
    expect(line('o1').price).toBeCloseTo(stored, 8);
  });

  it('takes the broker price mid-drag onto the entity, so the pill still reads true', () => {
    const { chart, el, priceAt, paint, line } = makeChart();
    const stored = priceAt(300);
    chart.trading.syncState({ orders: [order(stored)] });
    paint();

    el.dispatch('pointerdown', pointer('down', 400, 300));
    el.dispatch('pointermove', pointer('move', 400, 240));
    const moved = priceAt(260);
    // Someone modified the same order from another terminal.
    chart.trading.syncState({ orders: [order(moved)] });
    expect(chart.trading.getOrders()[0].price).toBeCloseTo(moved, 8);
    expect(line('o1').price).toBeCloseTo(priceAt(240), 8);

    el.dispatch('pointerup', pointer('up', 400, 240));
    // Released: what the trader dropped is what gets sent, and the line stops
    // where he dropped it rather than resurrecting the price that arrived
    // while he was holding it.
    expect(chart.trading.getOrders()[0].price).toBeCloseTo(priceAt(240), 8);
    expect(line('o1').price).toBeCloseTo(priceAt(240), 8);
  });

  it('gives the line back when a second finger turns the drag into a pinch', () => {
    const { chart, el, line, priceAt, paint } = makeChart();
    const onModify = vi.fn();
    chart.trading.on('trading:order_modify', onModify);

    const stored = priceAt(300);
    chart.trading.syncState({ orders: [order(stored)] });
    paint();

    el.dispatch('pointerdown', pointer('down', 400, 300));
    el.dispatch('pointermove', pointer('move', 400, 240));
    expect(line('o1').price).toBeCloseTo(priceAt(240), 8);

    // A second finger lands: the chart takes the gesture away for a pinch, and
    // the releases that end a pinch never reach the drag path. Without a cancel
    // seam the controller would hold this line at the finger's price for the
    // rest of its life — on a phone, a stop line lying about where the stop is.
    el.dispatch('pointerdown', pointer('down', 300, 300, { pointerId: 2, pointerType: 'touch' }));
    expect(line('o1').price).toBeCloseTo(stored, 8);

    el.dispatch('pointerup', pointer('up', 300, 300, { pointerId: 2, pointerType: 'touch' }));
    el.dispatch('pointerup', pointer('up', 400, 240));
    // A zoom is not an edit.
    expect(onModify).not.toHaveBeenCalled();

    // And the line is not frozen: the broker moves it again as normal.
    const next = priceAt(180);
    chart.trading.syncState({ orders: [order(next)] });
    expect(line('o1').price).toBeCloseTo(next, 8);
  });

  it('ends quietly when the order is filled or cancelled mid-drag', () => {
    const { chart, el, priceAt, paint } = makeChart();
    const onModify = vi.fn();
    chart.trading.on('trading:order_modify', onModify);

    const stored = priceAt(300);
    chart.trading.syncState({ orders: [order(stored)] });
    paint();

    el.dispatch('pointerdown', pointer('down', 400, 300));
    el.dispatch('pointermove', pointer('move', 400, 240));
    chart.trading.syncState({ orders: [] }); // filled at the exchange
    el.dispatch('pointerup', pointer('up', 400, 240));
    // Nothing to modify at a broker that has already filled it, and no line to
    // put the price on: the gesture just ends.
    expect(onModify).not.toHaveBeenCalled();
  });

  it('does not outlive its line when the release never arrives', () => {
    const { chart, el, line, priceAt, paint } = makeChart();
    const stored = priceAt(300);
    chart.trading.syncState({ orders: [order(stored)] });
    paint();

    el.dispatch('pointerdown', pointer('down', 400, 300));
    el.dispatch('pointermove', pointer('move', 400, 240));
    chart.trading.syncState({ orders: [] }); // filled, and the pointerup is lost

    // A later order carrying the same id must not be frozen by a gesture that
    // ended on a different one.
    chart.trading.syncState({ orders: [order(stored)] });
    const next = priceAt(180);
    chart.trading.syncState({ orders: [order(next)] });
    expect(line('o1').price).toBeCloseTo(next, 8);
  });
});
