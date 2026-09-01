/**
 * The icon set, checked mechanically.
 *
 * Fifty-one glyphs cannot be kept consistent by review. What makes a set look
 * drawn rather than assembled is not the quality of any single glyph, it is that
 * they share a grid, a stroke weight, a margin and a visual density; and every
 * one of those is a property a test can hold and a reader cannot.
 *
 * The previous hand-drawn sets in the demo and the terminal drifted on exactly
 * these axes because nothing checked them. This file is the reason the next
 * glyph added will match the fifty-one before it.
 */
import { describe, it, expect } from 'vitest';
import '../src/indicators/index';
import {
  DRAWING_TOOL_ICONS, drawingToolIcon, drawingToolIconIds,
  ICON_VIEWBOX, ICON_STROKE, ICON_ATTRS,
} from '../src/draw/icons';
import { registeredDrawingTools, registerBuiltinDrawingTools } from '../src/draw/index';

registerBuiltinDrawingTools();

/** Every coordinate in a path, as numbers. */
function coords(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

/**
 * Coordinates that are positions on the grid, excluding the arc parameters of
 * `A rx ry rot large sweep x y`, whose flags and radii are not grid points.
 */
function gridPoints(d: string): number[] {
  // A path walker, not a number scraper. Relative commands carry the pen from
  // the current point, so scraping the literals reports a span of zero for a
  // glyph drawn with h and v, and the balance check silently passes.
  const out: number[] = [];
  let x = 0;
  let y = 0;
  let started = false;
  const put = (px: number, py: number): void => { out.push(px, py); x = px; y = py; };
  for (const m of d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^A-Za-z]*)/g)) {
    const cmd = m[1];
    const n = (m[2].match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    switch (cmd) {
      case 'M': case 'L':
        for (let i = 0; i + 1 < n.length; i += 2) put(n[i], n[i + 1]);
        started = true;
        break;
      case 'm': case 'l':
        for (let i = 0; i + 1 < n.length; i += 2) put(started ? x + n[i] : n[i], started ? y + n[i + 1] : n[i + 1]);
        started = true;
        break;
      case 'H': for (const v of n) put(v, y); break;
      case 'h': for (const v of n) put(x + v, y); break;
      case 'V': for (const v of n) put(x, v); break;
      case 'v': for (const v of n) put(x, y + v); break;
      // Curves: the endpoint is the only part that has to sit on the grid.
      case 'C': for (let i = 5; i < n.length; i += 6) put(n[i - 1], n[i]); break;
      case 'c': for (let i = 5; i < n.length; i += 6) put(x + n[i - 1], y + n[i]); break;
      case 'S': case 'Q': for (let i = 3; i < n.length; i += 4) put(n[i - 1], n[i]); break;
      case 's': case 'q': for (let i = 3; i < n.length; i += 4) put(x + n[i - 1], y + n[i]); break;
      case 'A': for (let i = 6; i < n.length; i += 7) put(n[i - 1], n[i]); break;
      case 'a': for (let i = 6; i < n.length; i += 7) put(x + n[i - 1], y + n[i]); break;
      default: break; // Z closes; T is unused here.
    }
  }
  return out;
}

const ENTRIES = Object.entries(DRAWING_TOOL_ICONS);

describe('the set shares one grid', () => {
  it('has a glyph for every registered drawing tool', () => {
    // The whole point of shipping these is that an adopter never has to draw
    // one. A tool with no glyph pushes that work straight back onto them.
    const missing = registeredDrawingTools()
      .map((t) => t.id)
      .filter((id) => drawingToolIcon(id) === undefined);
    expect(missing, `tools with no icon: ${missing.join(', ')}`).toEqual([]);
  });

  it.each(ENTRIES)('%s stays inside the 2..22 live area', (_id, d) => {
    // A glyph that reaches the edge of the box looks larger than its
    // neighbours, and a rail of them reads as ragged.
    for (const n of gridPoints(d)) {
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(22);
    }
  });

  it.each(ENTRIES)('%s lands on whole units', (_id, d) => {
    // With a stroke of 2, an orthogonal edge centred on an integer covers
    // exactly two device pixels at 1:1. Half units were the old set's
    // crispness bug: nothing landed on a pixel boundary at any size.
    for (const n of coords(d)) expect(Number.isInteger(n), `${n} in ${d}`).toBe(true);
  });

  it.each(ENTRIES)('%s carries no presentation attributes of its own', (_id, d) => {
    // Weight, cap and colour belong to the host's one `<svg>`, so a glyph
    // cannot quietly opt out of the set.
    expect(d).not.toMatch(/stroke|fill|width|style|class/i);
  });

  it.each(ENTRIES)('%s is a path, not a document', (_id, d) => {
    expect(d).not.toMatch(/[<>]/);
    expect(d.trim()).toMatch(/^[Mm]/);
  });
});

describe('the set has one visual weight', () => {
  it('declares a single stroke, applied by the host', () => {
    expect(ICON_STROKE).toBe(2);
    expect(ICON_ATTRS.strokeWidth).toBe(ICON_STROKE);
    expect(ICON_ATTRS.fill).toBe('none');
    expect(ICON_ATTRS.stroke).toBe('currentColor');
  });

  it('rounds every cap and join, so no glyph ends square beside a round one', () => {
    expect(ICON_ATTRS.strokeLinecap).toBe('round');
    expect(ICON_ATTRS.strokeLinejoin).toBe('round');
  });

  it('shares one viewBox', () => {
    expect(ICON_VIEWBOX).toBe('0 0 24 24');
    expect(ICON_ATTRS.viewBox).toBe(ICON_VIEWBOX);
  });
});

describe('the set is balanced', () => {
  it('keeps every glyph within a sane complexity band', () => {
    // A glyph far busier than the rest dominates a rail whatever its weight.
    // Fib retracement and Gann box are the densest by nature; nothing should
    // be denser than they are.
    for (const [id, d] of ENTRIES) {
      const commands = (d.match(/[A-Za-z]/g) ?? []).length;
      expect(commands, `${id} has ${commands} commands`).toBeLessThanOrEqual(14);
      expect(commands, `${id} is empty`).toBeGreaterThan(0);
    }
  });

  it('uses most of the live area rather than floating small in the box', () => {
    // A glyph occupying a third of its box reads as a different size from one
    // that fills it, even at the same nominal dimensions.
    for (const [id, d] of ENTRIES) {
      const pts = gridPoints(d);
      if (pts.length < 4) continue;
      const xs = pts.filter((_, i) => i % 2 === 0);
      const ys = pts.filter((_, i) => i % 2 === 1);
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      expect(span, `${id} spans only ${span} units`).toBeGreaterThanOrEqual(10);
    }
  });

  it('has no duplicate glyph, which would make two tools indistinguishable', () => {
    const seen = new Map<string, string>();
    for (const [id, d] of ENTRIES) {
      const prev = seen.get(d);
      expect(prev, `${id} draws the same as ${prev}`).toBeUndefined();
      seen.set(d, id);
    }
  });
});

describe('the lookup', () => {
  it('returns undefined for an unknown tool rather than a placeholder', () => {
    // A host handed a question mark ships it; one handed nothing sees the gap.
    expect(drawingToolIcon('no-such-tool')).toBeUndefined();
  });

  it('lists every id it covers', () => {
    expect(drawingToolIconIds().length).toBe(ENTRIES.length);
    expect(drawingToolIconIds()).toContain('trend-line');
  });
});
