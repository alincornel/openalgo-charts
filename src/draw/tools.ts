/**
 * Built-in drawing tools + the tool registry. Same philosophy as the chart-type
 * and indicator registries: a tool is a descriptor, the layer just runs it, and
 * `registerDrawingTool` makes a custom one first-class.
 *
 * `draw` receives anchors already in device px; `distance` receives them in
 * media px, the same space as the incoming cursor.
 */
import type { DrawContext, DrawingStyle, DrawingTool, ScreenPoint } from './types';
import {
  distToSegment, distToLine, distToHorizontal, distToVertical,
  distToRect, distToEllipse, distToPolyline, rectOf, extendSegment,
} from './geometry';

const registry = new Map<string, DrawingTool>();

export function registerDrawingTool(tool: DrawingTool): void {
  registry.set(tool.id, tool);
}

export function getDrawingTool(id: string): DrawingTool {
  const t = registry.get(id);
  if (t === undefined) throw new Error(`openalgo-charts: unknown drawing tool "${id}"`);
  return t;
}

export function hasDrawingTool(id: string): boolean {
  return registry.has(id);
}

export function registeredDrawingTools(): DrawingTool[] {
  return Array.from(registry.values());
}

// ── shared drawing helpers ────────────────────────────────────────────────

function applyStroke(c: DrawContext): void {
  const { ctx, rc, style } = c;
  const d = rc.dpr;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = Math.max(1, Math.round(style.lineWidth * d));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(
    style.lineStyle === 'dashed' ? [6 * d, 4 * d]
      : style.lineStyle === 'dotted' ? [1 * d, 3 * d]
      : [],
  );
}

function fillStyleOf(c: DrawContext): string {
  return c.style.fillColor ?? c.style.color;
}

function withFill(c: DrawContext, paint: () => void): void {
  if (c.style.fill !== true) return;
  const { ctx } = c;
  ctx.save();
  ctx.globalAlpha = c.style.fillOpacity ?? 0.12;
  ctx.fillStyle = fillStyleOf(c);
  paint();
  ctx.restore();
}

function label(c: DrawContext, text: string, x: number, y: number, color?: string): void {
  const { ctx, rc, style } = c;
  const size = (style.fontSize ?? 11) * rc.dpr;
  ctx.save();
  ctx.setLineDash([]);
  ctx.font = `${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const w = ctx.measureText(text).width;
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = rc.theme.background;
  ctx.fillRect(x - 2 * rc.dpr, y - size * 0.75, w + 4 * rc.dpr, size * 1.5);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color ?? style.color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

const DEFAULT_FIB: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

// ── line family ───────────────────────────────────────────────────────────

/** Trend line, ray, and extended line differ only in which ends extend. */
function lineTool(id: string, name: string, left: boolean, right: boolean): DrawingTool {
  return {
    id, name, points: 2,
    defaultStyle: { extendLeft: left, extendRight: right },
    draw: (c) => {
      const [a, b] = extendSegment(
        c.pts[0], c.pts[1], c.rc.plotWidth * c.rc.dpr,
        c.style.extendLeft ?? left, c.style.extendRight ?? right,
      );
      applyStroke(c);
      c.ctx.beginPath();
      c.ctx.moveTo(a.x, a.y);
      c.ctx.lineTo(b.x, b.y);
      c.ctx.stroke();
      c.ctx.setLineDash([]);
    },
    distance: (x, y, h) => {
      const el = h.drawing.style.extendLeft ?? left;
      const er = h.drawing.style.extendRight ?? right;
      if (el && er) return distToLine(x, y, h.pts[0], h.pts[1]);
      const [a, b] = extendSegment(h.pts[0], h.pts[1], h.rc.plotWidth, el, er);
      return distToSegment(x, y, a, b);
    },
  };
}

export const TREND_LINE = lineTool('trend-line', 'Trend Line', false, false);
export const RAY = lineTool('ray', 'Ray', false, true);
export const EXTENDED_LINE = lineTool('extended-line', 'Extended Line', true, true);

export const ARROW: DrawingTool = {
  id: 'arrow', name: 'Arrow', points: 2,
  draw: (c) => {
    const [a, b] = c.pts;
    applyStroke(c);
    c.ctx.beginPath();
    c.ctx.moveTo(a.x, a.y);
    c.ctx.lineTo(b.x, b.y);
    c.ctx.stroke();
    // Head at the far anchor, sized off the line width so it scales with style.
    const head = Math.max(8, c.style.lineWidth * 5) * c.rc.dpr;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    c.ctx.beginPath();
    c.ctx.moveTo(b.x, b.y);
    c.ctx.lineTo(b.x - head * Math.cos(ang - 0.4), b.y - head * Math.sin(ang - 0.4));
    c.ctx.lineTo(b.x - head * Math.cos(ang + 0.4), b.y - head * Math.sin(ang + 0.4));
    c.ctx.closePath();
    c.ctx.fillStyle = c.style.color;
    c.ctx.fill();
    c.ctx.setLineDash([]);
  },
  distance: (x, y, h) => distToSegment(x, y, h.pts[0], h.pts[1]),
};

export const HORIZONTAL_LINE: DrawingTool = {
  id: 'horizontal-line', name: 'Horizontal Line', points: 1,
  defaultStyle: { showLabels: true },
  draw: (c) => {
    const y = Math.round(c.pts[0].y) + 0.5;
    applyStroke(c);
    c.ctx.beginPath();
    c.ctx.moveTo(0, y);
    c.ctx.lineTo(c.rc.plotWidth * c.rc.dpr, y);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
    if (c.style.showLabels !== false) {
      label(c, c.formatPrice(c.drawing.points[0].price), 4 * c.rc.dpr, y - 8 * c.rc.dpr);
    }
  },
  distance: (_x, y, h) => distToHorizontal(y, h.pts[0].y),
};

export const HORIZONTAL_RAY: DrawingTool = {
  id: 'horizontal-ray', name: 'Horizontal Ray', points: 1,
  defaultStyle: { showLabels: true },
  draw: (c) => {
    const y = Math.round(c.pts[0].y) + 0.5;
    applyStroke(c);
    c.ctx.beginPath();
    c.ctx.moveTo(c.pts[0].x, y);
    c.ctx.lineTo(c.rc.plotWidth * c.rc.dpr, y);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
    if (c.style.showLabels !== false) {
      label(c, c.formatPrice(c.drawing.points[0].price), c.pts[0].x + 4 * c.rc.dpr, y - 8 * c.rc.dpr);
    }
  },
  distance: (x, y, h) => (x < h.pts[0].x ? null : distToHorizontal(y, h.pts[0].y)),
};

export const VERTICAL_LINE: DrawingTool = {
  id: 'vertical-line', name: 'Vertical Line', points: 1,
  draw: (c) => {
    const x = Math.round(c.pts[0].x) + 0.5;
    applyStroke(c);
    c.ctx.beginPath();
    c.ctx.moveTo(x, 0);
    c.ctx.lineTo(x, c.rc.plotHeight * c.rc.dpr);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
  },
  distance: (x, _y, h) => distToVertical(x, h.pts[0].x),
};

export const CROSS_LINE: DrawingTool = {
  id: 'cross-line', name: 'Cross Line', points: 1,
  draw: (c) => {
    const x = Math.round(c.pts[0].x) + 0.5;
    const y = Math.round(c.pts[0].y) + 0.5;
    applyStroke(c);
    c.ctx.beginPath();
    c.ctx.moveTo(x, 0); c.ctx.lineTo(x, c.rc.plotHeight * c.rc.dpr);
    c.ctx.moveTo(0, y); c.ctx.lineTo(c.rc.plotWidth * c.rc.dpr, y);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
  },
  distance: (x, y, h) => Math.min(distToVertical(x, h.pts[0].x), distToHorizontal(y, h.pts[0].y)),
};

// ── shapes ────────────────────────────────────────────────────────────────

export const RECTANGLE: DrawingTool = {
  id: 'rectangle', name: 'Rectangle', points: 2,
  defaultStyle: { fill: true },
  draw: (c) => {
    const r = rectOf(c.pts[0], c.pts[1]);
    withFill(c, () => c.ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0));
    applyStroke(c);
    c.ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    c.ctx.setLineDash([]);
  },
  distance: (x, y, h) => distToRect(x, y, h.pts[0], h.pts[1], h.drawing.style.fill === true),
};

export const ELLIPSE: DrawingTool = {
  id: 'ellipse', name: 'Ellipse', points: 2,
  defaultStyle: { fill: true },
  draw: (c) => {
    const r = rectOf(c.pts[0], c.pts[1]);
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const rx = Math.max(1, (r.x1 - r.x0) / 2);
    const ry = Math.max(1, (r.y1 - r.y0) / 2);
    const path = (): void => {
      c.ctx.beginPath();
      c.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    };
    withFill(c, () => { path(); c.ctx.fill(); });
    applyStroke(c);
    path();
    c.ctx.stroke();
    c.ctx.setLineDash([]);
  },
  distance: (x, y, h) => distToEllipse(x, y, h.pts[0], h.pts[1], h.drawing.style.fill === true),
};

export const PARALLEL_CHANNEL: DrawingTool = {
  id: 'parallel-channel', name: 'Parallel Channel', points: 3,
  defaultStyle: { fill: true },
  draw: (c) => {
    const [a, b, t] = c.pts;
    // The third anchor sets the channel width as a vertical offset.
    const dy = t.y - (a.y + (b.y - a.y) * 0.5);
    const a2 = { x: a.x, y: a.y + dy };
    const b2 = { x: b.x, y: b.y + dy };
    withFill(c, () => {
      c.ctx.beginPath();
      c.ctx.moveTo(a.x, a.y); c.ctx.lineTo(b.x, b.y);
      c.ctx.lineTo(b2.x, b2.y); c.ctx.lineTo(a2.x, a2.y);
      c.ctx.closePath();
      c.ctx.fill();
    });
    applyStroke(c);
    c.ctx.beginPath();
    c.ctx.moveTo(a.x, a.y); c.ctx.lineTo(b.x, b.y);
    c.ctx.moveTo(a2.x, a2.y); c.ctx.lineTo(b2.x, b2.y);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
  },
  distance: (x, y, h) => {
    const [a, b, t] = h.pts;
    const dy = t.y - (a.y + (b.y - a.y) * 0.5);
    const d1 = distToSegment(x, y, a, b);
    const d2 = distToSegment(x, y, { x: a.x, y: a.y + dy }, { x: b.x, y: b.y + dy });
    return Math.min(d1, d2);
  },
};

// ── fibonacci ─────────────────────────────────────────────────────────────

/** Retracement (2 anchors) and extension (3) share the level-drawing body. */
function fibTool(id: string, name: string, anchors: 2 | 3): DrawingTool {
  return {
    id, name, points: anchors,
    defaultStyle: { showLabels: true, levels: [...DEFAULT_FIB], fill: true, fillOpacity: 0.06 },
    draw: (c) => {
      const levels = c.style.levels ?? DEFAULT_FIB;
      const p = c.drawing.points;
      // Retracement measures p0→p1; extension projects that leg from p2.
      const from = anchors === 2 ? p[0].price : p[2].price;
      const span = anchors === 2 ? p[1].price - p[0].price : p[1].price - p[0].price;
      const x0 = Math.min(c.pts[0].x, c.pts[anchors - 1].x);
      const x1 = Math.max(c.pts[0].x, c.pts[anchors - 1].x);
      const right = c.style.extendRight === true ? c.rc.plotWidth * c.rc.dpr : x1;
      applyStroke(c);
      let prevY: number | null = null;
      for (const lv of levels) {
        const price = from + span * lv;
        const y = Math.round(c.rc.priceScale.priceToY(price) * c.rc.dpr) + 0.5;
        if (c.style.fill === true && prevY !== null) {
          c.ctx.save();
          c.ctx.globalAlpha = c.style.fillOpacity ?? 0.06;
          c.ctx.fillStyle = fillStyleOf(c);
          c.ctx.fillRect(x0, Math.min(prevY, y), right - x0, Math.abs(y - prevY));
          c.ctx.restore();
        }
        prevY = y;
        c.ctx.beginPath();
        c.ctx.moveTo(x0, y);
        c.ctx.lineTo(right, y);
        c.ctx.stroke();
        if (c.style.showLabels !== false) {
          label(c, `${(lv * 100).toFixed(1)}%  ${c.formatPrice(price)}`, x0 + 4 * c.rc.dpr, y - 8 * c.rc.dpr);
        }
      }
      c.ctx.setLineDash([]);
    },
    distance: (x, y, h) => {
      const levels = h.drawing.style.levels ?? DEFAULT_FIB;
      const p = h.drawing.points;
      const from = anchors === 2 ? p[0].price : p[2].price;
      const span = p[1].price - p[0].price;
      const x0 = Math.min(h.pts[0].x, h.pts[anchors - 1].x);
      const x1 = h.drawing.style.extendRight === true
        ? h.rc.plotWidth : Math.max(h.pts[0].x, h.pts[anchors - 1].x);
      if (x < x0 - 4 || x > x1 + 4) return null;
      let best = Infinity;
      for (const lv of levels) {
        const d = Math.abs(y - h.rc.priceScale.priceToY(from + span * lv));
        if (d < best) best = d;
      }
      return best;
    },
  };
}

export const FIB_RETRACEMENT = fibTool('fib-retracement', 'Fib Retracement', 2);
export const FIB_EXTENSION = fibTool('fib-extension', 'Fib Extension', 3);

// ── measurement & positions ───────────────────────────────────────────────

export const MEASURE: DrawingTool = {
  id: 'measure', name: 'Measure', points: 2,
  defaultStyle: { fill: true, showLabels: true, fillOpacity: 0.1 },
  draw: (c) => {
    const r = rectOf(c.pts[0], c.pts[1]);
    const p = c.drawing.points;
    const chg = p[1].price - p[0].price;
    const pct = p[0].price !== 0 ? (chg / p[0].price) * 100 : 0;
    const up = chg >= 0;
    const tint = up ? '#26a69a' : '#ef5350';
    c.ctx.save();
    c.ctx.globalAlpha = c.style.fillOpacity ?? 0.1;
    c.ctx.fillStyle = tint;
    c.ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    c.ctx.restore();
    applyStroke(c);
    c.ctx.strokeStyle = tint;
    c.ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    c.ctx.setLineDash([]);
    // Bars are counted on logical indices, so the count matches what the
    // gapless axis actually shows rather than raw elapsed time.
    const i0 = c.rc.dataLayer.timeToIndexFloat(p[0].time);
    const i1 = c.rc.dataLayer.timeToIndexFloat(p[1].time);
    const bars = Math.abs(Math.round(i1 - i0));
    const sign = up ? '+' : '';
    label(
      c, `${sign}${c.formatPrice(chg)}  (${sign}${pct.toFixed(2)}%)  ${bars} bars`,
      r.x0 + 4 * c.rc.dpr, r.y0 - 10 * c.rc.dpr, tint,
    );
  },
  distance: (x, y, h) => distToRect(x, y, h.pts[0], h.pts[1], true),
};

/** Long / short position calculator — entry, target, stop. */
function positionTool(id: string, name: string, long: boolean): DrawingTool {
  return {
    id, name, points: 3,
    defaultStyle: { showLabels: true, fillOpacity: 0.13, accountSize: 100000, risk: 1 },
    draw: (c) => {
      const [entry, target, stop] = c.drawing.points;
      const d = c.rc.dpr;
      const x0 = Math.min(c.pts[0].x, c.pts[1].x, c.pts[2].x);
      const x1 = Math.max(c.pts[0].x, c.pts[1].x, c.pts[2].x);
      const yE = c.rc.priceScale.priceToY(entry.price) * d;
      const yT = c.rc.priceScale.priceToY(target.price) * d;
      const yS = c.rc.priceScale.priceToY(stop.price) * d;
      const band = (yA: number, yB: number, color: string): void => {
        c.ctx.save();
        c.ctx.globalAlpha = c.style.fillOpacity ?? 0.13;
        c.ctx.fillStyle = color;
        c.ctx.fillRect(x0, Math.min(yA, yB), x1 - x0, Math.abs(yB - yA));
        c.ctx.restore();
      };
      band(yE, yT, '#26a69a');
      band(yE, yS, '#ef5350');
      applyStroke(c);
      for (const y of [yE, yT, yS]) {
        const yy = Math.round(y) + 0.5;
        c.ctx.beginPath();
        c.ctx.moveTo(x0, yy);
        c.ctx.lineTo(x1, yy);
        c.ctx.stroke();
      }
      c.ctx.setLineDash([]);
      if (c.style.showLabels === false) return;
      const risk = Math.abs(entry.price - stop.price);
      const reward = Math.abs(target.price - entry.price);
      const rr = risk > 0 ? reward / risk : 0;
      // Position size from risk budget ÷ stop distance — the number a trader
      // actually wants off this tool.
      const account = c.style.accountSize ?? 0;
      const riskPct = c.style.risk ?? 0;
      const qty = risk > 0 && account > 0 ? Math.floor((account * riskPct / 100) / risk) : 0;
      const dir = long ? 'LONG' : 'SHORT';
      label(c, `${dir}  R:R ${rr.toFixed(2)}${qty > 0 ? `  qty ${qty}` : ''}`, x0 + 4 * d, yE - 10 * d);
    },
    distance: (x, y, h) => {
      const x0 = Math.min(h.pts[0].x, h.pts[1].x, h.pts[2].x);
      const x1 = Math.max(h.pts[0].x, h.pts[1].x, h.pts[2].x);
      if (x < x0 - 4 || x > x1 + 4) return null;
      const ys = h.drawing.points.map((p) => h.rc.priceScale.priceToY(p.price));
      const lo = Math.min(...ys);
      const hi = Math.max(...ys);
      return y >= lo && y <= hi ? 0 : Math.min(Math.abs(y - lo), Math.abs(y - hi));
    },
  };
}

export const LONG_POSITION = positionTool('long-position', 'Long Position', true);
export const SHORT_POSITION = positionTool('short-position', 'Short Position', false);

// ── annotation ────────────────────────────────────────────────────────────

const TEXT_PAD = 5;
const LINE_GAP = 1.35;
const DEFAULT_FONT = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

/** The CSS font shorthand for a text drawing's style. */
function textFont(style: DrawingStyle, sizePx: number): string {
  const weight = style.fontWeight === 'bold' ? '700 ' : '';
  const italic = style.fontStyle === 'italic' ? 'italic ' : '';
  return `${italic}${weight}${sizePx}px ${style.fontFamily ?? DEFAULT_FONT}`;
}

/**
 * Split into rendered lines: honour explicit `\n` always, and soft-wrap each
 * paragraph at `wrapWidth` when `wrap` is on. Measured with the *live* context
 * so the wrap matches the font actually being drawn.
 */
function textLines(ctx: CanvasRenderingContext2D, style: DrawingStyle, maxWidth: number): string[] {
  const paragraphs = (style.text ?? '').split('\n');
  if (style.wrap !== true) return paragraphs;
  const out: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter((w) => w !== '');
    if (words.length === 0) { out.push(''); continue; }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const next = `${line} ${words[i]}`;
      if (ctx.measureText(next).width > maxWidth) { out.push(line); line = words[i]; }
      else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Measured box of a text drawing, in media px, anchored at its top-left. */
function textBox(
  ctx: CanvasRenderingContext2D,
  style: DrawingStyle,
  dpr: number,
): { lines: string[]; width: number; height: number; lineHeight: number } {
  const size = (style.fontSize ?? 13) * dpr;
  ctx.font = textFont(style, size);
  const maxWidth = (style.wrapWidth ?? 220) * dpr;
  const lines = textLines(ctx, style, maxWidth);
  let width = 0;
  for (const l of lines) width = Math.max(width, ctx.measureText(l).width);
  const lineHeight = size * LINE_GAP;
  return {
    lines,
    width: width + TEXT_PAD * 2 * dpr,
    height: lines.length * lineHeight + TEXT_PAD * 2 * dpr,
    lineHeight,
  };
}

export const TEXT: DrawingTool = {
  id: 'text', name: 'Text', points: 1,
  defaultStyle: {
    text: 'Text', fontSize: 14, fontWeight: 'normal', fontStyle: 'normal',
    background: false, backgroundOpacity: 1, border: false, wrap: false,
    wrapWidth: 220, textAlign: 'left',
  },
  draw: (c) => {
    const { ctx, rc, style } = c;
    const d = rc.dpr;
    const box = textBox(ctx, style, d);
    const x = c.pts[0].x;
    const y = c.pts[0].y;

    ctx.save();
    ctx.setLineDash([]);
    if (style.background === true) {
      ctx.globalAlpha = style.backgroundOpacity ?? 1;
      ctx.fillStyle = style.backgroundColor ?? rc.theme.background;
      ctx.beginPath();
      ctx.roundRect(x, y, box.width, box.height, 4 * d);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (style.border === true) {
      ctx.strokeStyle = style.borderColor ?? style.color;
      ctx.lineWidth = Math.max(1, style.lineWidth * d);
      ctx.beginPath();
      ctx.roundRect(x, y, box.width, box.height, 4 * d);
      ctx.stroke();
    }

    ctx.font = textFont(style, (style.fontSize ?? 13) * d);
    ctx.fillStyle = style.color;
    ctx.textBaseline = 'top';
    const align = style.textAlign ?? 'left';
    ctx.textAlign = align;
    const inner = box.width - TEXT_PAD * 2 * d;
    const tx = align === 'center' ? x + box.width / 2
      : align === 'right' ? x + box.width - TEXT_PAD * d
      : x + TEXT_PAD * d;
    let ty = y + TEXT_PAD * d;
    for (const line of box.lines) {
      ctx.fillText(line, tx, ty);
      ty += box.lineHeight;
    }
    void inner;
    ctx.restore();
  },
  distance: (x, y, h) => {
    // Measure with a throwaway 2D context so the hit box matches what is drawn
    // (wrapping and font metrics decide the real size, not a character count).
    const style = h.drawing.style;
    const size = style.fontSize ?? 13;
    const p = h.pts[0];
    const probe = measureContext();
    const box = probe === null
      ? { width: (style.text ?? '').length * size * 0.6 + 10, height: size * LINE_GAP + 10 }
      : textBox(probe, style, 1);
    return x >= p.x - 3 && x <= p.x + box.width + 3
      && y >= p.y - 3 && y <= p.y + box.height + 3 ? 0 : null;
  },
};

/** A 1×1 offscreen context used only for text measurement. Cached. */
let _probe: CanvasRenderingContext2D | null | undefined;
function measureContext(): CanvasRenderingContext2D | null {
  if (_probe !== undefined) return _probe;
  try {
    _probe = (typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d'));
  } catch {
    _probe = null;
  }
  return _probe;
}

export const PATH: DrawingTool = {
  id: 'path', name: 'Path', points: 0,
  draw: (c) => {
    if (c.pts.length < 2) return;
    applyStroke(c);
    c.ctx.beginPath();
    c.ctx.moveTo(c.pts[0].x, c.pts[0].y);
    for (let i = 1; i < c.pts.length; i++) c.ctx.lineTo(c.pts[i].x, c.pts[i].y);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
  },
  distance: (x, y, h) => (h.pts.length < 2 ? null : distToPolyline(x, y, h.pts)),
};

/** Every built-in, in toolbar order. */
export const BUILTIN_DRAWING_TOOLS: readonly DrawingTool[] = [
  TREND_LINE, RAY, EXTENDED_LINE, ARROW,
  HORIZONTAL_LINE, HORIZONTAL_RAY, VERTICAL_LINE, CROSS_LINE,
  RECTANGLE, ELLIPSE, PARALLEL_CHANNEL,
  FIB_RETRACEMENT, FIB_EXTENSION,
  LONG_POSITION, SHORT_POSITION, MEASURE,
  TEXT, PATH,
];

let _registered = false;

/** Register every built-in tool. Idempotent; called on tier import. */
export function registerBuiltinDrawingTools(): void {
  if (_registered) return;
  _registered = true;
  for (const t of BUILTIN_DRAWING_TOOLS) registerDrawingTool(t);
}

export type { ScreenPoint };
