/**
 * A tap on an order line is not a drag. A press on a draggable line arms its
 * drag, and the release used to reach the drag subscribers whether or not the
 * pointer had moved, so the trading controller sent `trading:order_modify` at
 * the price under the tap: a click 3 px off a working order moved it at the
 * broker. Driven through `Chart` pointer events, the real path.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Chart } from '../src/core/chart';
import { PriceLine } from '../src/primitives/price-line';
import type { IPrimitive } from '../src/primitives/primitive';
import { fakeDocument, pointer, type FakeElement } from './helpers/fake-dom';
import type { Bar } from '../src/model/bar';
import { TradingController, type TradingOrder } from '../src/core/trading-controller';

beforeAll(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window ??= {};
});

function bars(n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 150 + Math.sin(i / 4) * 5;
    return { time: 1700000000 + i * 60, open: c, high: c + 2, low: c - 2, close: c, volume: 10 };
  });
}

function makeChart(): { chart: Chart; el: FakeElement; line: () => PriceLine; yOf: (price: number) => number; priceAt: (y: number) => number } {
  const el = fakeDocument().createElement('div') as unknown as FakeElement;
  const chart = new Chart(el, {
    document: fakeDocument(),
    pixelRatio: () => 1,
    shortcuts: false,
    raf: { schedule: (cb: () => void) => { cb(); return 1; }, cancel: () => {} },
  });
  chart.applySize(800, 600);
  chart.addSeries('candlestick').setData(bars(120));
  const added: PriceLine[] = [];
  const original = chart.addPrimitive.bind(chart);
  (chart as unknown as { addPrimitive: (p: IPrimitive) => void }).addPrimitive = (p: IPrimitive) => {
    if (p instanceof PriceLine) added.push(p);
    original(p);
  };
  const order: TradingOrder = { id: 'o1', type: 'limit', side: 'buy', price: 150, size: 1 };
  chart.trading.syncState({ orders: [order] });
  chart.applySize(800, 600); // give the line geometry to hit-test against
  return {
    chart,
    el,
    line: () => added.filter((l) => l.options().id === 'ord:o1').at(-1)!,
    yOf: (price) => chart.priceToCoordinate(price, 0) as number,
    priceAt: (y) => chart.coordinateToPrice(y, 0) as number,
  };
}

describe('a tap on an order line', () => {
  it('sends no order_modify for a click 3 px off the line, and leaves it at its price', () => {
    const { chart, el, line, yOf } = makeChart();
    const onModify = vi.fn();
    const onClick = vi.fn();
    chart.trading.on('trading:order_modify', onModify);
    chart.trading.on('trading:order_click', onClick);
    const y = yOf(150) + 3;

    el.dispatch('pointerdown', pointer('down', 400, y));
    el.dispatch('pointerup', pointer('up', 400, y));

    expect(onModify).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1); // the tap is still a click on the pill
    expect(line().price).toBe(150);
    expect(chart.trading.getOrders()[0]!.price).toBe(150);
  });

  it('sends no order_modify when the finger rolls inside the click slop, and puts the line back', () => {
    const { chart, el, line, yOf } = makeChart();
    const onModify = vi.fn();
    chart.trading.on('trading:order_modify', onModify);
    const y = yOf(150) + 1;

    el.dispatch('pointerdown', pointer('down', 400, y));
    el.dispatch('pointermove', pointer('move', 401, y + 2));
    el.dispatch('pointerup', pointer('up', 401, y + 2));

    expect(onModify).not.toHaveBeenCalled();
    expect(line().price).toBe(150);
  });

  it('still sends order_modify for a real drag', () => {
    const { chart, el, line, yOf, priceAt } = makeChart();
    const onModify = vi.fn();
    chart.trading.on('trading:order_modify', onModify);
    const y = yOf(150);

    el.dispatch('pointerdown', pointer('down', 400, y));
    el.dispatch('pointermove', pointer('move', 400, y - 40));
    el.dispatch('pointerup', pointer('up', 400, y - 40));

    expect(onModify).toHaveBeenCalledTimes(1);
    const payload = onModify.mock.calls[0]![0] as { orderId: string; newPrice: number; previousPrice: number };
    expect(payload.orderId).toBe('o1');
    expect(payload.previousPrice).toBe(150);
    expect(payload.newPrice).toBeCloseTo(priceAt(y - 40), 8);
    expect(line().price).toBeCloseTo(priceAt(y - 40), 8);
  });
});

describe('a drag dropped on the price the order has', () => {
  it('modifies nothing', () => {
    let drag: (id: string, price: number) => void = () => {};
    let end: (id: string, price: number) => void = () => {};
    const tc = new TradingController({
      addPrimitive: () => {},
      removePrimitive: () => {},
      subscribeClick: () => {},
      subscribeDrag: (d, e) => { drag = d; if (e) end = e; },
    });
    const onModify = vi.fn();
    tc.on('trading:order_modify', onModify);
    tc.setOrders([{ id: 'o1', type: 'limit', side: 'buy', price: 150, size: 1 }]);
    drag('ord:o1', 151);
    drag('ord:o1', 150);
    end('ord:o1', 150);
    expect(onModify).not.toHaveBeenCalled();
    expect(tc.getOrders()[0]!.price).toBe(150);
  });
});
