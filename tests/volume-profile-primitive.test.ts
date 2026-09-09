import { describe, it, expect } from 'vitest';
import { VolumeProfile } from '../src/profile/volume-profile-primitive';
import { computeVolumeProfileSessions } from '../src/profile/volume-profile-family';
import { istStringToUtcSeconds } from '../src/feed/time';
import type { Bar } from '../src/model/bar';
import type { PrimitiveRenderContext } from '../src/primitives/primitive';

const bar = (time: number, low: number, high: number, open: number, close: number, volume: number): Bar =>
  ({ time, low, high, open, close, volume });

function makeResult() {
  const t0 = istStringToUtcSeconds('2024-01-15 09:15:00');
  const bars = [
    bar(t0, 100, 103, 100, 103, 300),
    bar(t0 + 1800, 101, 104, 104, 101, 200),
  ];
  return { result: computeVolumeProfileSessions(bars, { tickSize: 1, session: 'composite' }), t0 };
}

function recorder() {
  const calls = { fillRect: 0, fillText: 0, stroke: 0 };
  const ctx = {
    canvas: {}, globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() { calls.stroke++; }, fillRect() { calls.fillRect++; }, fillText() { calls.fillText++; },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function makeRc(startTime: number, endTime: number): PrimitiveRenderContext {
  return {
    dpr: 2, plotWidth: 600, plotHeight: 300, priceAxisWidth: 60,
    timeScale: { indexToX: (i: number) => 100 + i * 40 },
    priceScale: { priceToY: (p: number) => 400 - p, format: (p: number) => p.toFixed(2) },
    dataLayer: { timeToIndex: (t: number) => (t === startTime ? 0 : t === endTime ? 5 : 5) },
    theme: {},
  } as unknown as PrimitiveRenderContext;
}

describe('VolumeProfile primitive', () => {
  it('draws histogram bars and POC/VA lines (total mode)', () => {
    const { result, t0 } = makeResult();
    const vp = new VolumeProfile(result);
    const { ctx, calls } = recorder();
    vp.draw(ctx, makeRc(t0, t0 + 1800));
    expect(calls.fillRect).toBeGreaterThan(0);
    expect(calls.stroke).toBeGreaterThan(0);
    expect(calls.fillText).toBeGreaterThan(0);
  });

  it('renders buy/sell split (two rects per non-empty row)', () => {
    const { result, t0 } = makeResult();
    const total = new VolumeProfile(result, { displayMode: 'total', showPoc: false, showValueArea: false, highlightValueArea: false });
    const split = new VolumeProfile(result, { displayMode: 'buySell', showPoc: false, showValueArea: false, highlightValueArea: false });
    const a = recorder(); total.draw(a.ctx, makeRc(t0, t0 + 1800));
    const c = recorder(); split.draw(c.ctx, makeRc(t0, t0 + 1800));
    expect(c.calls.fillRect).toBeGreaterThan(a.calls.fillRect); // split adds a second segment per row
  });

  it('reports price extent and is a no-op with no data', () => {
    const { result } = makeResult();
    expect(new VolumeProfile(result).autoscaleInfo()).toEqual({ min: 100, max: 104 });
    const empty = new VolumeProfile(null);
    const { ctx, calls } = recorder();
    empty.draw(ctx, makeRc(0, 1));
    expect(calls.fillRect + calls.stroke + calls.fillText).toBe(0);
    expect(empty.autoscaleInfo()).toBeNull();
  });
});

// ─── anchorTo: where the bars grow out of ───────────────────────────────────
//
// `makeRc` maps the session's end index (5) to media x 300, so with dpr 2 the
// session's right edge is device x 600 while the pane's is `plotWidth * dpr` =
// 1200. The two are far apart on purpose: every assertion below would pass by
// accident if they coincided.

function geometry() {
  const rects: { x: number; w: number }[] = [];
  const lines: { from: number; to: number }[] = [];
  const texts: { x: number; align: string }[] = [];
  let pendingFrom = 0;
  let align = '';
  const ctx = {
    canvas: {}, globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
    textBaseline: '',
    get textAlign() { return align; },
    set textAlign(v: string) { align = v; },
    save() {}, restore() {}, beginPath() {},
    moveTo(x: number) { pendingFrom = x; },
    lineTo(x: number) { lines.push({ from: pendingFrom, to: x }); },
    stroke() {},
    fillRect(x: number, _y: number, w: number) { rects.push({ x, w }); },
    fillText(_t: string, x: number) { texts.push({ x, align }); },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, rects, lines, texts };
}

const SESSION_RIGHT_DEV = 600;
const PANE_RIGHT_DEV = 1200;
const WIDTH_DEV = 90 * 2;

describe('VolumeProfile anchorTo', () => {
  it('defaults to the session edge, so existing consumers do not move', () => {
    const { result, t0 } = makeResult();
    const explicit = new VolumeProfile(result, { anchorTo: 'session' });
    const implicit = new VolumeProfile(result);
    const a = geometry(); explicit.draw(a.ctx, makeRc(t0, t0 + 1800));
    const b = geometry(); implicit.draw(b.ctx, makeRc(t0, t0 + 1800));
    expect(b.rects).toEqual(a.rects);
    expect(b.lines).toEqual(a.lines);
    expect(b.texts).toEqual(a.texts);
    // and that geometry really is the session's right edge, not the pane's
    const rightmost = Math.max(...a.rects.map((r) => r.x + r.w));
    expect(rightmost).toBe(SESSION_RIGHT_DEV);
  });

  it('anchors the band at the pane edge when asked, on the right', () => {
    const { result, t0 } = makeResult();
    const vp = new VolumeProfile(result, { anchorTo: 'pane', side: 'right' });
    const g = geometry(); vp.draw(g.ctx, makeRc(t0, t0 + 1800));
    const rightmost = Math.max(...g.rects.map((r) => r.x + r.w));
    const leftmost = Math.min(...g.rects.map((r) => r.x));
    expect(rightmost).toBe(PANE_RIGHT_DEV);
    expect(leftmost).toBeGreaterThanOrEqual(PANE_RIGHT_DEV - WIDTH_DEV);
  });

  it('anchors at x=0 on the left, and never spills past the band', () => {
    const { result, t0 } = makeResult();
    const vp = new VolumeProfile(result, { anchorTo: 'pane', side: 'left' });
    const g = geometry(); vp.draw(g.ctx, makeRc(t0, t0 + 1800));
    expect(Math.min(...g.rects.map((r) => r.x))).toBe(0);
    expect(Math.max(...g.rects.map((r) => r.x + r.w))).toBeLessThanOrEqual(WIDTH_DEV);
  });

  it('stretches the POC line to reach a pane-anchored band', () => {
    const { result, t0 } = makeResult();
    const vp = new VolumeProfile(result, { anchorTo: 'pane', side: 'right', showPoc: true });
    const g = geometry(); vp.draw(g.ctx, makeRc(t0, t0 + 1800));
    expect(g.lines.length).toBeGreaterThan(0);
    // every line must span far enough right to touch the bars it marks
    for (const l of g.lines) expect(Math.max(l.from, l.to)).toBeGreaterThanOrEqual(PANE_RIGHT_DEV - WIDTH_DEV);
  });

  it('keeps a pane-anchored label inside the pane, off the bars tip', () => {
    const { result, t0 } = makeResult();
    // labelSide 'right' would put the label past the pane edge, over the price
    // axis — pane anchoring must ignore it and use the tip instead.
    const vp = new VolumeProfile(result, { anchorTo: 'pane', side: 'right', labelSide: 'right' });
    const g = geometry(); vp.draw(g.ctx, makeRc(t0, t0 + 1800));
    expect(g.texts.length).toBeGreaterThan(0);
    for (const t of g.texts) {
      expect(t.x).toBeLessThan(PANE_RIGHT_DEV - WIDTH_DEV);
      expect(t.align).toBe('right');
    }
  });
});

// ─── dock: the band holds a PLOT edge, not a time edge ──────────────────────
//
// `makeRc` keeps the session's right edge at device x 600 and the pane's at
// `plotWidth * dpr` = 1200, so a docked band and a session-anchored one can
// never be confused for each other. The default inset is 4 media px, 8 device.

const DOCK_INSET_DEV = 4 * 2;
const PAD_DEV = 3 * 2;
const SESSION_LEFT_DEV = 200;

describe('VolumeProfile dock', () => {
  it('defaults to none, which draws exactly what it drew before', () => {
    const { result, t0 } = makeResult();
    const implicit = new VolumeProfile(result);
    const explicit = new VolumeProfile(result, { dock: 'none' });
    const a = geometry(); implicit.draw(a.ctx, makeRc(t0, t0 + 1800));
    const b = geometry(); explicit.draw(b.ctx, makeRc(t0, t0 + 1800));
    expect(b.rects).toEqual(a.rects);
    expect(b.lines).toEqual(a.lines);
    expect(b.texts).toEqual(a.texts);
    expect(Math.max(...a.rects.map((r) => r.x + r.w))).toBe(SESSION_RIGHT_DEV);
  });

  it('leaves the pane anchor alone when it is not docked', () => {
    const { result, t0 } = makeResult();
    const before = new VolumeProfile(result, { anchorTo: 'pane', side: 'right' });
    const after = new VolumeProfile(result, { anchorTo: 'pane', side: 'right', dock: 'none' });
    const a = geometry(); before.draw(a.ctx, makeRc(t0, t0 + 1800));
    const b = geometry(); after.draw(b.ctx, makeRc(t0, t0 + 1800));
    expect(b.rects).toEqual(a.rects);
    expect(b.texts).toEqual(a.texts);
    // an un-inset pane anchor still sits ON the edge, not a dock's 8 px off it
    expect(Math.max(...a.rects.map((r) => r.x + r.w))).toBe(PANE_RIGHT_DEV);
  });

  it('docks left: bars start at dockInset and grow rightwards', () => {
    const { result, t0 } = makeResult();
    const vp = new VolumeProfile(result, { dock: 'left' });
    const g = geometry(); vp.draw(g.ctx, makeRc(t0, t0 + 1800));
    expect(Math.min(...g.rects.map((r) => r.x))).toBe(DOCK_INSET_DEV);
    expect(Math.max(...g.rects.map((r) => r.x + r.w))).toBeLessThanOrEqual(DOCK_INSET_DEV + WIDTH_DEV);
  });

  it('docks right: bars end at plotWidth minus dockInset and grow leftwards', () => {
    const { result, t0 } = makeResult();
    const vp = new VolumeProfile(result, { dock: 'right' });
    const g = geometry(); vp.draw(g.ctx, makeRc(t0, t0 + 1800));
    expect(Math.max(...g.rects.map((r) => r.x + r.w))).toBe(PANE_RIGHT_DEV - DOCK_INSET_DEV);
    expect(Math.min(...g.rects.map((r) => r.x))).toBeGreaterThanOrEqual(PANE_RIGHT_DEV - DOCK_INSET_DEV - WIDTH_DEV);
  });

  it('honours dockInset, and 0 puts the band flush against the edge', () => {
    const { result, t0 } = makeResult();
    const wide = new VolumeProfile(result, { dock: 'right', dockInset: 20 });
    const flush = new VolumeProfile(result, { dock: 'right', dockInset: 0 });
    const a = geometry(); wide.draw(a.ctx, makeRc(t0, t0 + 1800));
    const b = geometry(); flush.draw(b.ctx, makeRc(t0, t0 + 1800));
    expect(Math.max(...a.rects.map((r) => r.x + r.w))).toBe(PANE_RIGHT_DEV - 20 * 2);
    expect(Math.max(...b.rects.map((r) => r.x + r.w))).toBe(PANE_RIGHT_DEV);
  });

  it('outranks side and anchorTo for x placement', () => {
    const { result, t0 } = makeResult();
    // every non-dock placement option asks for the opposite edge
    const vp = new VolumeProfile(result, { dock: 'right', side: 'left', anchorTo: 'session' });
    const g = geometry(); vp.draw(g.ctx, makeRc(t0, t0 + 1800));
    expect(Math.max(...g.rects.map((r) => r.x + r.w))).toBe(PANE_RIGHT_DEV - DOCK_INSET_DEV);
    expect(Math.min(...g.rects.map((r) => r.x))).toBeGreaterThan(SESSION_RIGHT_DEV);
  });

  it('stretches the POC and value-area lines to reach the docked band', () => {
    const { result, t0 } = makeResult();
    const left = new VolumeProfile(result, { dock: 'left' });
    const right = new VolumeProfile(result, { dock: 'right' });
    const a = geometry(); left.draw(a.ctx, makeRc(t0, t0 + 1800));
    const b = geometry(); right.draw(b.ctx, makeRc(t0, t0 + 1800));
    expect(a.lines.length).toBeGreaterThan(0);
    // the union of the session span and the band, exactly as a pane anchor does
    for (const l of a.lines) {
      expect(Math.min(l.from, l.to)).toBe(DOCK_INSET_DEV);
      expect(Math.max(l.from, l.to)).toBe(SESSION_RIGHT_DEV);
    }
    for (const l of b.lines) {
      expect(Math.min(l.from, l.to)).toBe(SESSION_LEFT_DEV);
      expect(Math.max(l.from, l.to)).toBe(PANE_RIGHT_DEV - DOCK_INSET_DEV);
    }
  });

  it('respects labelSide under a dock, and keeps the text inside the plot', () => {
    const { result, t0 } = makeResult();
    const bandLeft = PANE_RIGHT_DEV - DOCK_INSET_DEV - WIDTH_DEV;
    const cases = [
      { dock: 'left' as const, labelSide: 'left' as const, x: DOCK_INSET_DEV + PAD_DEV, align: 'left' },
      { dock: 'left' as const, labelSide: 'right' as const, x: DOCK_INSET_DEV + WIDTH_DEV + PAD_DEV, align: 'left' },
      { dock: 'right' as const, labelSide: 'left' as const, x: bandLeft - PAD_DEV, align: 'right' },
      { dock: 'right' as const, labelSide: 'right' as const, x: PANE_RIGHT_DEV - DOCK_INSET_DEV - PAD_DEV, align: 'right' },
    ];
    for (const c of cases) {
      const vp = new VolumeProfile(result, { dock: c.dock, labelSide: c.labelSide });
      const g = geometry(); vp.draw(g.ctx, makeRc(t0, t0 + 1800));
      expect(g.texts.length).toBeGreaterThan(0);
      for (const t of g.texts) {
        expect(t.x).toBe(c.x);
        expect(t.align).toBe(c.align);
        // never over the price axis, and never off the left of the plot
        expect(t.x).toBeGreaterThan(0);
        expect(t.x).toBeLessThan(PANE_RIGHT_DEV);
      }
    }
  });

  it('setOptions moves the band live and asks for a repaint', () => {
    const { result, t0 } = makeResult();
    let updates = 0;
    const vp = new VolumeProfile(result);
    vp.attached({ requestUpdate: () => { updates++; } });

    const a = geometry(); vp.draw(a.ctx, makeRc(t0, t0 + 1800));
    expect(Math.max(...a.rects.map((r) => r.x + r.w))).toBe(SESSION_RIGHT_DEV);

    vp.setOptions({ dock: 'right' });
    expect(updates).toBe(1);
    const b = geometry(); vp.draw(b.ctx, makeRc(t0, t0 + 1800));
    expect(Math.max(...b.rects.map((r) => r.x + r.w))).toBe(PANE_RIGHT_DEV - DOCK_INSET_DEV);

    vp.setOptions({ dock: 'left' });
    const c = geometry(); vp.draw(c.ctx, makeRc(t0, t0 + 1800));
    expect(Math.min(...c.rects.map((r) => r.x))).toBe(DOCK_INSET_DEV);

    // and back: undocking restores the geometry it started with, byte for byte
    vp.setOptions({ dock: 'none' });
    const d = geometry(); vp.draw(d.ctx, makeRc(t0, t0 + 1800));
    expect(d.rects).toEqual(a.rects);
    expect(d.lines).toEqual(a.lines);
    expect(d.texts).toEqual(a.texts);
  });

  it('docks per instance, so one pane can carry both placements', () => {
    const { result, t0 } = makeResult();
    const docked = new VolumeProfile(result, { dock: 'left' });
    const anchored = new VolumeProfile(result);
    const g = geometry();
    docked.draw(g.ctx, makeRc(t0, t0 + 1800));
    anchored.draw(g.ctx, makeRc(t0, t0 + 1800));
    expect(Math.min(...g.rects.map((r) => r.x))).toBe(DOCK_INSET_DEV);
    expect(Math.max(...g.rects.map((r) => r.x + r.w))).toBe(SESSION_RIGHT_DEV);
  });

  it('leaves autoscale to price, whatever the dock', () => {
    const { result } = makeResult();
    const expected = { min: 100, max: 104 };
    expect(new VolumeProfile(result, { dock: 'left' }).autoscaleInfo()).toEqual(expected);
    expect(new VolumeProfile(result, { dock: 'right', dockInset: 40 }).autoscaleInfo()).toEqual(expected);
  });
});
