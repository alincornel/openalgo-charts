/**
 * A cancelled drag puts the drawing back.
 *
 * The chart cancels a drag in two places: a second finger turning the gesture
 * into a pinch, and a `pointercancel` from the browser. Neither ends with
 * `drag:end`, and the controller listened for nothing else, so a drawing moved
 * by the frames before the cancel stayed there — never announced, never saved,
 * with the gesture still open and a lifted shape left riding above the series.
 */
import { describe, it, expect } from 'vitest';
import { DrawingController } from '../src/draw/index';
import type { DrawingChartHost } from '../src/draw/controller';
import type { DataLayer } from '../src/model/data-layer';
import type { Drawing } from '../src/draw/types';

function busHost(): DrawingChartHost & { events: string[] } {
  const handlers = new Map<string, ((p: unknown) => void)[]>();
  const events: string[] = [];
  return {
    events,
    on: (event, handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => handlers.set(event, (handlers.get(event) ?? []).filter((h) => h !== handler));
    },
    emit: (event, payload) => {
      events.push(event);
      for (const h of handlers.get(event) ?? []) h(payload);
    },
    addPrimitive: () => {},
    removePrimitive: () => {},
    dataLayer: { baseIndex: 2, indexToTime: (i: number) => 1700000000 + i * 300 } as unknown as DataLayer,
    getVisibleLogicalRange: () => null,
    drawingState: () => null,
    setDrawingState: () => {},
  };
}

const line = (draw: DrawingController, extra: Partial<Drawing> = {}): Drawing =>
  draw.add({
    tool: 'trend-line', paneIndex: 0, style: {},
    points: [{ time: 1000, price: 10 }, { time: 2000, price: 20 }],
    ...extra,
  });

const drag = (chart: DrawingChartHost, id: string, time: number, price: number): void =>
  chart.emit('drag', { id, time, price, paneIndex: 0 });

describe('drag:cancel', () => {
  it('returns the drawing to where the gesture found it, and announces nothing', () => {
    const chart = busHost();
    const draw = new DrawingController(chart);
    const a = line(draw);
    draw.select(a.id);
    drag(chart, `draw:${a.id}`, 1000, 10);
    drag(chart, `draw:${a.id}`, 1400, 14);
    expect(draw.get(a.id)?.points[0]).toEqual({ time: 1400, price: 14 });

    chart.events.length = 0;
    chart.emit('drag:cancel', { id: `draw:${a.id}` });

    expect(draw.get(a.id)?.points).toEqual([{ time: 1000, price: 10 }, { time: 2000, price: 20 }]);
    expect(chart.events).not.toContain('draw:update');
  });

  it('leaves no undo step for a move that never happened', () => {
    const chart = busHost();
    const draw = new DrawingController(chart);
    const a = line(draw);
    draw.select(a.id);
    drag(chart, `draw:${a.id}`, 1000, 10);
    drag(chart, `draw:${a.id}`, 1400, 14);
    chart.emit('drag:cancel', { id: `draw:${a.id}` });

    // The one undo left is the add, so undoing removes the drawing rather
    // than replaying a cancelled move.
    expect(draw.undo()).toBe(true);
    expect(draw.get(a.id)).toBeUndefined();
  });

  it('ignores a cancel for a drag that was not a drawing', () => {
    const chart = busHost();
    const draw = new DrawingController(chart);
    const a = line(draw);
    chart.emit('drag:cancel', { id: 'ord:o1' });
    expect(draw.get(a.id)?.points[0]).toEqual({ time: 1000, price: 10 });
    expect(draw.undo()).toBe(true); // the add is still the only undo step
    expect(draw.undo()).toBe(false);
  });
});
