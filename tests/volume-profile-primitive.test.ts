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
