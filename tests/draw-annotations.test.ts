/**
 * The annotation tools: the ones whose whole job is to put a human sentence on
 * the chart.
 *
 * They share plate-and-tail machinery, so what distinguishes them is where the
 * tail leaves the plate and how the plate is shaped. That is exactly what a
 * test can pin and a reviewer cannot see by reading: two tools drawing the same
 * rectangle in different places look identical in source.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  NOTE, BALLOON, COMMENT, SIGNPOST, PRICE_NOTE, TABLE,
  ARROW_LEFT, ARROW_RIGHT, ARROW_UP,
  registeredDrawingTools, registerBuiltinDrawingTools,
} from '../src/draw/index';
import { RecordingContext } from './helpers/fake-ctx';
import type { DrawingTool, DrawContext, Drawing } from '../src/draw/types';

beforeAll(() => { registerBuiltinDrawingTools(); });

const PANE = { plotWidth: 800, plotHeight: 400, dpr: 1 };

/** Draw a one-anchor tool at (x, y) and hand back what it painted. */
function paint(tool: DrawingTool, text?: string, x = 300, y = 200): RecordingContext {
  const rec = new RecordingContext();
  const drawing: Drawing = {
    id: 'd1', tool: tool.id, paneIndex: 0,
    points: [{ time: 1735689600, price: 1339.7 }],
    style: { ...tool.defaultStyle, ...(text === undefined ? {} : { text }) },
  };
  const c = {
    ctx: rec as unknown as CanvasRenderingContext2D,
    rc: { ...PANE, theme: { background: '#0d0e12' } },
    pts: [{ x, y }],
    drawing,
    style: { color: '#4f8cff', lineWidth: 1, ...drawing.style },
    selected: false,
    formatPrice: (p: number) => p.toFixed(2),
  } as unknown as DrawContext;
  tool.draw(c);
  return rec;
}

const texts = (rec: RecordingContext): string[] =>
  rec.ops.filter((o) => o.type === 'fillText').map((o) => o.text ?? '');
const boxes = (rec: RecordingContext) =>
  rec.ops.filter((o) => o.type === 'roundRect' || o.type === 'rect');

describe('every annotation is registered and draws its text', () => {
  const ALL = [NOTE, BALLOON, COMMENT, SIGNPOST, PRICE_NOTE, TABLE];

  it('registers all of them', () => {
    const ids = new Set(registeredDrawingTools().map((t) => t.id));
    for (const t of ALL) expect(ids.has(t.id), t.id).toBe(true);
    expect(ids.has('arrow-left')).toBe(true);
    expect(ids.has('arrow-right')).toBe(true);
  });

  it.each(ALL.map((t) => [t.id, t] as const))('%s paints its own text', (_id, tool) => {
    const rec = paint(tool, 'Hello');
    expect(texts(rec).join(' ')).toContain('Hello');
  });

  it.each(ALL.map((t) => [t.id, t] as const))('%s leaves the context balanced', (_id, tool) => {
    const rec = paint(tool, 'Hello');
    expect(rec.count('save')).toBe(rec.count('restore'));
  });

  it.each(ALL.map((t) => [t.id, t] as const))('%s falls back to a label when empty', (_id, tool) => {
    // An annotation with no text is still a mark on the chart, and an empty
    // plate reads as a rendering bug rather than as an empty note.
    const rec = paint(tool, '');
    expect(texts(rec).some((t) => t.length > 0)).toBe(true);
  });
});

describe('each annotation puts its plate somewhere different', () => {
  const plateY = (tool: DrawingTool): number => {
    const b = boxes(paint(tool, 'X'))[0];
    return b ? Math.round(b.args[1]) : Number.NaN;
  };

  it('sits the balloon above the anchor and the note beside it', () => {
    // Both are one-anchor text marks; the placement is the whole difference.
    expect(plateY(BALLOON)).toBeLessThan(200);
    expect(plateY(NOTE)).toBeLessThan(200);
    expect(plateY(BALLOON)).not.toBe(plateY(NOTE));
  });

  it('stands the signpost clear of the price action', () => {
    // The post is 34px, so the plate must clear the anchor by at least that.
    expect(plateY(SIGNPOST)).toBeLessThan(200 - 34);
  });
});

describe('the price note reads its price rather than storing one', () => {
  it('prints the anchor price, formatted by the pane', () => {
    // A typed price is a number that was true once, which is worse on a chart
    // than no number at all.
    expect(texts(paint(PRICE_NOTE, 'Support'))).toContain('1339.70');
  });

  it('keeps the user text beneath it', () => {
    expect(texts(paint(PRICE_NOTE, 'Support')).join(' ')).toContain('Support');
  });
});

describe('the table lays out rows and columns', () => {
  it('splits rows on newline and columns on a pipe', () => {
    const drawn = texts(paint(TABLE, 'Level|Price\nEntry|100\nStop|95'));
    expect(drawn).toEqual(expect.arrayContaining(['Level', 'Price', 'Entry', '100', 'Stop', '95']));
  });

  it('draws the header row in a heavier face than the body', () => {
    const rec = paint(TABLE, 'Head|Col\nBody|Cell');
    const head = rec.ops.find((o) => o.type === 'fillText' && o.text === 'Head');
    const body = rec.ops.find((o) => o.type === 'fillText' && o.text === 'Body');
    expect(head?.font).not.toBe(body?.font);
    expect(head?.font).toContain('600');
  });

  it('survives a single cell with no separators at all', () => {
    expect(() => paint(TABLE, 'just one')).not.toThrow();
    expect(texts(paint(TABLE, 'just one'))).toContain('just one');
  });
});

describe('the sideways arrows are the vertical one turned', () => {
  it('points left and right rather than up', () => {
    const at = (tool: DrawingTool) => {
      const rec = paint(tool);
      // moveTo counts: a horizontal arrow's shaft starts at the tip, so
      // measuring lineTo alone misses the length that makes it horizontal.
      const xs = rec.ops
        .filter((o) => o.type === 'lineTo' || o.type === 'moveTo')
        .map((o) => o.args[0]);
      return { min: Math.min(...xs), max: Math.max(...xs) };
    };
    const l = at(ARROW_LEFT);
    const r = at(ARROW_RIGHT);
    // The shaft runs along x, so the horizontal spread is far wider than the
    // vertical arrow's, which only spreads by its head width.
    expect(l.max - l.min).toBeGreaterThan(at(ARROW_UP).max - at(ARROW_UP).min);
    // And they lie on opposite sides of the anchor.
    expect(l.max).toBeGreaterThan(300);
    expect(r.min).toBeLessThan(300);
  });
});

describe('every annotation can be grabbed', () => {
  const ALL = [NOTE, BALLOON, COMMENT, SIGNPOST, PRICE_NOTE, TABLE];

  it.each(ALL.map((t) => [t.id, t] as const))('%s hit-tests on its plate', (_id, tool) => {
    const drawing: Drawing = {
      id: 'd1', tool: tool.id, paneIndex: 0,
      points: [{ time: 1735689600, price: 1339.7 }],
      style: { ...tool.defaultStyle, text: 'Hello' },
    };
    const h = { pts: [{ x: 300, y: 200 }], drawing, rc: PANE } as never;
    // Somewhere on the plate has to be grabbable, or the drawing cannot be
    // selected, moved or deleted once placed.
    let hit = false;
    for (let dx = -140; dx <= 200 && !hit; dx += 10) {
      for (let dy = -90; dy <= 60 && !hit; dy += 10) {
        if (tool.distance(300 + dx, 200 + dy, h) === 0) hit = true;
      }
    }
    expect(hit).toBe(true);
  });

  it.each(ALL.map((t) => [t.id, t] as const))('%s misses far away', (_id, tool) => {
    const drawing: Drawing = {
      id: 'd1', tool: tool.id, paneIndex: 0,
      points: [{ time: 1735689600, price: 1339.7 }],
      style: { ...tool.defaultStyle, text: 'Hello' },
    };
    const h = { pts: [{ x: 300, y: 200 }], drawing, rc: PANE } as never;
    expect(tool.distance(700, 380, h)).not.toBe(0);
  });
});
