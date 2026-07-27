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
import { roundRectPath, contrastText } from '../render/pill';

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

/**
 * A solid rounded chip with contrasting text, one row per line — the readout
 * style the position and forecast tools share. `align` positions the box
 * horizontally about `x`, `place` vertically about `y`. Returns its height so a
 * caller can stack chips.
 */
function chip(
  c: DrawContext,
  lines: readonly string[],
  x: number,
  y: number,
  bg: string,
  opts: { align?: 'left' | 'center' | 'right'; place?: 'above' | 'below' | 'middle' } = {},
): number {
  const { ctx, rc } = c;
  const d = rc.dpr;
  const size = (c.style.fontSize ?? 11) * d;
  ctx.save();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.font = `${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const padX = 5 * d;
  const padY = 3 * d;
  const lh = size * 1.35;
  let textW = 0;
  for (const t of lines) textW = Math.max(textW, ctx.measureText(t).width);
  const w = textW + padX * 2;
  const h = lh * lines.length + padY * 2;
  const align = opts.align ?? 'left';
  const bx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const place = opts.place ?? 'above';
  const by = place === 'above' ? y - h - 4 * d : place === 'below' ? y + 4 * d : y - h / 2;
  ctx.beginPath();
  roundRectPath(ctx, bx, by, w, h, 3 * d);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = contrastText(bg);
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], bx + padX, by + padY + lh * (i + 0.5));
  ctx.restore();
  return h;
}

/** Thousands-separated fixed-point, locale-independent so output is stable. */
function grouped(n: number, dp = 0): string {
  const [i, f] = Math.abs(n).toFixed(dp).split('.');
  const sign = n < 0 ? '-' : '';
  return sign + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f === undefined ? '' : '.' + f);
}

/** `YYYY-MM-DD` in UTC — enough to anchor a label to its bar. */
function isoDate(sec: number): string {
  const dt = new Date(sec * 1000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** Coarse elapsed span: `76d 23h`, `5h 12m`, `12m`. */
function humanSpan(sec: number): string {
  const s = Math.max(0, Math.round(Math.abs(sec)));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

const UP_TINT = '#26a69a';
const DOWN_TINT = '#ef5350';

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
  defaultStyle: { fill: true, fontSize: 14, textAlign: 'left', textVAlign: 'top', textPosition: 'inside' },
  draw: (c) => {
    const r = rectOf(c.pts[0], c.pts[1]);
    withFill(c, () => c.ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0));
    applyStroke(c);
    c.ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    c.ctx.setLineDash([]);
    shapeLabel(c, r.x0, r.y0, r.x1, r.y1);
  },
  distance: (x, y, h) => distToRect(x, y, h.pts[0], h.pts[1], h.drawing.style.fill === true),
};

export const ELLIPSE: DrawingTool = {
  id: 'ellipse', name: 'Ellipse', points: 2,
  defaultStyle: { fill: true, fontSize: 14, textAlign: 'center', textVAlign: 'middle', textPosition: 'inside' },
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
    shapeLabel(c, r.x0, r.y0, r.x1, r.y1);
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
    shapeLabel(c, Math.min(a.x, b.x), Math.min(a.y, b.y, a2.y, b2.y),
      Math.max(a.x, b.x), Math.max(a.y, b.y, a2.y, b2.y));
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

/**
 * Long / short position calculator — entry, target, stop.
 *
 * One click places the whole thing at a 1:1 reward:risk and every anchor stays
 * draggable, so the tool opens with something to adjust rather than asking for
 * three clicks before it shows anything.
 */
function positionTool(id: string, name: string, long: boolean): DrawingTool {
  return {
    id, name, points: 1,
    defaultStyle: { showLabels: true, fillOpacity: 0.13, accountSize: 100000, risk: 1 },
    expand: (clicked, ctx) => {
      const p = clicked[0];
      // 1% of price gives a 1:1 box that reads sensibly on any instrument; the
      // fallback covers a zero/near-zero price where a ratio has no meaning.
      const off = Math.abs(p.price) * 0.01 || 1;
      // ~8% of what is on screen, so the box is grabbable at any zoom instead
      // of a hairline when zoomed out or pane-filling when zoomed in.
      const bars = Math.max(5, Math.round(ctx.visibleBars * 0.08));
      const far = p.time + Math.max(1, ctx.barSeconds) * bars;
      return long
        ? [p, { time: far, price: p.price + off }, { time: far, price: p.price - off }]
        : [p, { time: far, price: p.price - off }, { time: far, price: p.price + off }];
    },
    draw: (c) => {
      // A single-anchor preview exists between the click and `expand`.
      if (c.drawing.points.length < 3 || c.pts.length < 3) return;
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
      band(yE, yT, UP_TINT);
      band(yE, yS, DOWN_TINT);
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
      const pctOf = (delta: number): string =>
        (entry.price !== 0 ? (delta / entry.price) * 100 : 0).toFixed(3);
      const cash = (delta: number): string => (qty > 0 ? `, Amount: ${grouped(qty * delta)}` : '');
      const cx = (x0 + x1) / 2;
      // Each readout hugs its own line, on the outside of the box — the target
      // chip sits past the target line whichever side of entry it landed on, so
      // it reads the same for a long and an inverted-drag short.
      chip(c, [`Target: ${c.formatPrice(reward)} (${pctOf(reward)}%)${cash(reward)}`],
        cx, yT, UP_TINT, { align: 'center', place: yT <= yE ? 'above' : 'below' });
      chip(c, [`Stop: ${c.formatPrice(risk)} (${pctOf(risk)}%)${cash(risk)}`],
        cx, yS, DOWN_TINT, { align: 'center', place: yS >= yE ? 'below' : 'above' });
      chip(c, [
        `${long ? 'Long' : 'Short'} · Qty: ${qty > 0 ? grouped(qty) : '—'}`,
        `Risk/reward ratio: ${rr.toFixed(2)}`,
      ], cx, yE, c.rc.theme.background, { align: 'center', place: 'middle' });
    },
    distance: (x, y, h) => {
      if (h.pts.length < 3) return null;
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


/**
 * Draw a shape's attached label. Shapes carry an optional `text` that renders
 * inside (or just above) their bounds, with its own colour, font, and
 * alignment — the outline colour and the label colour are different decisions.
 */
function shapeLabel(c: DrawContext, x0: number, y0: number, x1: number, y1: number): void {
  const { ctx, rc, style } = c;
  const text = style.text;
  if (text === undefined || text === '') return;
  const d = rc.dpr;
  const size = (style.fontSize ?? 14) * d;
  const pad = 6 * d;
  ctx.save();
  ctx.setLineDash([]);
  ctx.font = textFont(style, size);
  ctx.fillStyle = style.fontColor ?? style.color;
  ctx.textBaseline = 'top';

  const lines = style.wrap === true
    ? textLines(ctx, style, Math.max(20 * d, x1 - x0 - pad * 2))
    : text.split('\n');
  const lineHeight = size * LINE_GAP;
  const blockH = lines.length * lineHeight;

  const align = style.textAlign ?? 'left';
  ctx.textAlign = align;
  const tx = align === 'center' ? (x0 + x1) / 2 : align === 'right' ? x1 - pad : x0 + pad;

  // `outside` lifts the block clear of the shape so it never sits on the outline.
  let ty: number;
  if (style.textPosition === 'outside') {
    ty = y0 - blockH - pad;
  } else {
    const v = style.textVAlign ?? 'top';
    ty = v === 'middle' ? (y0 + y1 - blockH) / 2
      : v === 'bottom' ? y1 - blockH - pad
      : y0 + pad;
  }
  for (const line of lines) {
    ctx.fillText(line, tx, ty);
    ty += lineHeight;
  }
  ctx.restore();
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

/** Brush — freehand ink: press, drag, release. */
export const PATH: DrawingTool = {
  id: 'path', name: 'Path', points: 0, freehand: true,
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
/**
 * Measurers. `measure` reports price *and* time together; these two constrain it
 * to one axis, which is what you want when the other one is noise — sizing a
 * retracement without caring how long it took, or counting bars to an event
 * without caring where price went.
 */
export const PRICE_RANGE: DrawingTool = {
  id: 'price-range', name: 'Price Range', points: 2,
  defaultStyle: { fill: true, showLabels: true, fillOpacity: 0.1 },
  draw: (c) => {
    const d = c.rc.dpr;
    const p = c.drawing.points;
    const chg = p[1].price - p[0].price;
    const pct = p[0].price !== 0 ? (chg / p[0].price) * 100 : 0;
    const up = chg >= 0;
    const tint = up ? '#26a69a' : '#ef5350';
    // Span the drawn x-range so the band reads as a price zone, not a bare line.
    const x0 = Math.min(c.pts[0].x, c.pts[1].x);
    const x1 = Math.max(c.pts[0].x, c.pts[1].x) + (c.pts[0].x === c.pts[1].x ? 60 * d : 0);
    const y0 = c.pts[0].y;
    const y1 = c.pts[1].y;
    c.ctx.save();
    c.ctx.globalAlpha = c.style.fillOpacity ?? 0.1;
    c.ctx.fillStyle = tint;
    c.ctx.fillRect(x0, Math.min(y0, y1), x1 - x0, Math.abs(y1 - y0));
    c.ctx.restore();
    applyStroke(c);
    c.ctx.strokeStyle = tint;
    c.ctx.beginPath();
    for (const y of [y0, y1]) { c.ctx.moveTo(x0, Math.round(y) + 0.5); c.ctx.lineTo(x1, Math.round(y) + 0.5); }
    // The measured leg, with arrow heads at both ends.
    const mx = (x0 + x1) / 2;
    c.ctx.moveTo(mx, y0); c.ctx.lineTo(mx, y1);
    const dir = y1 > y0 ? 1 : -1;
    c.ctx.moveTo(mx - 4 * d, y1 - 5 * d * dir); c.ctx.lineTo(mx, y1); c.ctx.lineTo(mx + 4 * d, y1 - 5 * d * dir);
    c.ctx.moveTo(mx - 4 * d, y0 + 5 * d * dir); c.ctx.lineTo(mx, y0); c.ctx.lineTo(mx + 4 * d, y0 + 5 * d * dir);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
    const sign = up ? '+' : '';
    label(c, `${sign}${c.formatPrice(chg)}  (${sign}${pct.toFixed(2)}%)`, mx + 6 * d, (y0 + y1) / 2, tint);
  },
  distance: (x, y, h) => distToRect(x, y, h.pts[0], h.pts[1], true),
};

export const DATE_RANGE: DrawingTool = {
  id: 'date-range', name: 'Date Range', points: 2,
  defaultStyle: { fill: true, showLabels: true, fillOpacity: 0.1 },
  draw: (c) => {
    const d = c.rc.dpr;
    const p = c.drawing.points;
    const tint = c.style.color;
    const x0 = c.pts[0].x;
    const x1 = c.pts[1].x;
    const y0 = Math.min(c.pts[0].y, c.pts[1].y);
    const y1 = Math.max(c.pts[0].y, c.pts[1].y) + (c.pts[0].y === c.pts[1].y ? 40 * d : 0);
    c.ctx.save();
    c.ctx.globalAlpha = c.style.fillOpacity ?? 0.1;
    c.ctx.fillStyle = tint;
    c.ctx.fillRect(Math.min(x0, x1), y0, Math.abs(x1 - x0), y1 - y0);
    c.ctx.restore();
    applyStroke(c);
    c.ctx.beginPath();
    for (const x of [x0, x1]) { c.ctx.moveTo(Math.round(x) + 0.5, y0); c.ctx.lineTo(Math.round(x) + 0.5, y1); }
    const my = (y0 + y1) / 2;
    c.ctx.moveTo(x0, my); c.ctx.lineTo(x1, my);
    const dir = x1 > x0 ? 1 : -1;
    c.ctx.moveTo(x1 - 5 * d * dir, my - 4 * d); c.ctx.lineTo(x1, my); c.ctx.lineTo(x1 - 5 * d * dir, my + 4 * d);
    c.ctx.moveTo(x0 + 5 * d * dir, my - 4 * d); c.ctx.lineTo(x0, my); c.ctx.lineTo(x0 + 5 * d * dir, my + 4 * d);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
    // Counted on logical indices, so it matches the gapless axis rather than
    // raw elapsed time (a weekend is not 48 bars).
    const i0 = c.rc.dataLayer.timeToIndexFloat(p[0].time);
    const i1 = c.rc.dataLayer.timeToIndexFloat(p[1].time);
    const bars = Math.abs(Math.round(i1 - i0));
    label(c, `${bars} bars`, (x0 + x1) / 2, y0 - 10 * d, tint);
  },
  distance: (x, y, h) => distToRect(x, y, h.pts[0], h.pts[1], true),
};

/**
 * Position forecast — project a move from an anchor. Two anchors give the
 * projected leg; the shape extends the same slope past the target as a dashed
 * cone, so the drawing says "if this continues" rather than just marking a line.
 */
export const FORECAST: DrawingTool = {
  id: 'forecast', name: 'Forecast', points: 2,
  defaultStyle: { fill: true, showLabels: true, fillOpacity: 0.12, lineStyle: 'dashed' },
  draw: (c) => {
    const d = c.rc.dpr;
    const p = c.drawing.points;
    const [a, b] = c.pts;
    const chg = p[1].price - p[0].price;
    const pct = p[0].price !== 0 ? (chg / p[0].price) * 100 : 0;
    const up = chg >= 0;
    const tint = up ? '#26a69a' : '#ef5350';
    // The cone widens with the projected distance — a forecast is less certain
    // the further out it runs, and the shape should say so.
    const spread = Math.abs(b.y - a.y) * 0.35 + 6 * d;
    c.ctx.save();
    c.ctx.globalAlpha = c.style.fillOpacity ?? 0.12;
    c.ctx.fillStyle = tint;
    c.ctx.beginPath();
    c.ctx.moveTo(a.x, a.y);
    c.ctx.lineTo(b.x, b.y - spread);
    c.ctx.lineTo(b.x, b.y + spread);
    c.ctx.closePath();
    c.ctx.fill();
    c.ctx.restore();
    applyStroke(c);
    c.ctx.strokeStyle = tint;
    c.ctx.beginPath();
    c.ctx.moveTo(a.x, a.y);
    c.ctx.lineTo(b.x, b.y);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
    c.ctx.beginPath();
    c.ctx.arc(a.x, a.y, 3 * d, 0, Math.PI * 2);
    c.ctx.fillStyle = tint;
    c.ctx.fill();
    if (c.style.showLabels === false) return;
    const sign = up ? '+' : '';
    // Anchor chip: where the projection was struck from.
    chip(c, [c.formatPrice(p[0].price), isoDate(p[0].time)], a.x, a.y, tint, { align: 'center' });
    // Projection chip: the move, and what it lands on when.
    chip(c, [
      `${sign}${c.formatPrice(chg)} (${sign}${pct.toFixed(2)}%) in ${humanSpan(p[1].time - p[0].time)}`,
      `${c.formatPrice(p[1].price)} · ${isoDate(p[1].time)}`,
    ], b.x, b.y, tint, { align: 'center', place: 'below' });
    // Verdict, once the window has actually elapsed: did price get there? A
    // forecast nobody scores is just a line.
    const bars = c.rc.bars?.();
    if (bars !== undefined && bars.length > 0 && bars[bars.length - 1].time >= p[1].time) {
      let hit = false;
      for (const bar of bars) {
        if (bar.time < p[0].time) continue;
        if (bar.time > p[1].time) break;
        if (up ? bar.high >= p[1].price : bar.low <= p[1].price) { hit = true; break; }
      }
      chip(c, [hit ? 'SUCCESS' : 'MISSED'], b.x, b.y + 36 * d,
        hit ? '#4a934a' : '#8a4a4a', { align: 'center', place: 'below' });
    }
  },
  distance: (x, y, h) => distToSegment(x, y, h.pts[0], h.pts[1]),
};

// ── shapes ────────────────────────────────────────────────────────────────

/**
 * Circle from centre + a radius handle. The radius is measured in *pixels*, so
 * it stays a circle on screen instead of the ellipse the two axes' differing
 * scales would otherwise produce.
 */
export const CIRCLE: DrawingTool = {
  id: 'circle', name: 'Circle', points: 2,
  defaultStyle: { fill: true },
  draw: (c) => {
    const [a, b] = c.pts;
    const r = Math.hypot(b.x - a.x, b.y - a.y);
    c.ctx.beginPath();
    c.ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
    withFill(c, () => c.ctx.fill());
    applyStroke(c);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
  },
  distance: (x, y, h) => {
    const [a, b] = h.pts;
    const r = Math.hypot(b.x - a.x, b.y - a.y);
    const d = Math.hypot(x - a.x, y - a.y);
    if (h.drawing.style.fill === true && d <= r) return 0;
    return Math.abs(d - r);
  },
};

export const TRIANGLE: DrawingTool = {
  id: 'triangle', name: 'Triangle', points: 3,
  defaultStyle: { fill: true },
  draw: (c) => {
    c.ctx.beginPath();
    c.ctx.moveTo(c.pts[0].x, c.pts[0].y);
    c.ctx.lineTo(c.pts[1].x, c.pts[1].y);
    c.ctx.lineTo(c.pts[2].x, c.pts[2].y);
    c.ctx.closePath();
    withFill(c, () => c.ctx.fill());
    applyStroke(c);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
  },
  distance: (x, y, h) => distToPolyline(x, y, [...h.pts, h.pts[0]]),
};

/** Free-form polyline: click each vertex, double-click to finish. */
export const POLYLINE: DrawingTool = {
  id: 'polyline', name: 'Polyline', points: 0,
  defaultStyle: { fill: false },
  draw: (c) => {
    if (c.pts.length < 2) return;
    c.ctx.beginPath();
    c.ctx.moveTo(c.pts[0].x, c.pts[0].y);
    for (let i = 1; i < c.pts.length; i++) c.ctx.lineTo(c.pts[i].x, c.pts[i].y);
    if (c.style.fill === true) { c.ctx.closePath(); withFill(c, () => c.ctx.fill()); }
    applyStroke(c);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
  },
  distance: (x, y, h) => distToPolyline(x, y, h.pts),
};

/** Sample a quadratic whose control is derived so the curve passes through `m`. */
function quadPoints(a: ScreenPoint, m: ScreenPoint, b: ScreenPoint): ScreenPoint[] {
  const cx = 2 * m.x - (a.x + b.x) / 2;
  const cy = 2 * m.y - (a.y + b.y) / 2;
  const out: ScreenPoint[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const u = 1 - t;
    out.push({ x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y });
  }
  return out;
}

/** Arc through three anchors — the middle one is on the curve, not a handle. */
export const ARC: DrawingTool = {
  id: 'arc', name: 'Arc', points: 3,
  draw: (c) => {
    const [a, m, b] = c.pts;
    applyStroke(c);
    c.ctx.beginPath();
    c.ctx.moveTo(a.x, a.y);
    // Lift the control point so the curve passes *through* the middle anchor
    // rather than merely leaning toward it.
    c.ctx.quadraticCurveTo(2 * m.x - (a.x + b.x) / 2, 2 * m.y - (a.y + b.y) / 2, b.x, b.y);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
  },
  distance: (x, y, h) => distToPolyline(x, y, quadPoints(h.pts[0], h.pts[1], h.pts[2])),
};

/** Quadratic curve — the middle anchor is a control handle, off the curve. */
export const CURVE: DrawingTool = {
  id: 'curve', name: 'Curve', points: 3,
  draw: (c) => {
    const [a, m, b] = c.pts;
    applyStroke(c);
    c.ctx.beginPath();
    c.ctx.moveTo(a.x, a.y);
    c.ctx.quadraticCurveTo(m.x, m.y, b.x, b.y);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
  },
  distance: (x, y, h) => {
    const [a, m, b] = h.pts;
    const pts: ScreenPoint[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const u = 1 - t;
      pts.push({ x: u * u * a.x + 2 * u * t * m.x + t * t * b.x, y: u * u * a.y + 2 * u * t * m.y + t * t * b.y });
    }
    return distToPolyline(x, y, pts);
  },
};

// ── arrows & brushes ──────────────────────────────────────────────────────

/** A single-anchor marker that points at a bar. `up` sits below, pointing up. */
function arrowMarker(id: string, name: string, up: boolean): DrawingTool {
  return {
    id, name, points: 1,
    defaultStyle: { fill: true, fillOpacity: 0.9 },
    draw: (c) => {
      const d = c.rc.dpr;
      const { x, y } = c.pts[0];
      const len = 16 * d;
      const w = 6 * d;
      const dir = up ? 1 : -1;
      // Offset off the anchor so the marker sits beside the bar, not on top of it.
      const tipY = y + dir * 2 * d;
      c.ctx.beginPath();
      c.ctx.moveTo(x, tipY);
      c.ctx.lineTo(x - w, tipY + dir * w);
      c.ctx.lineTo(x - w / 2.4, tipY + dir * w);
      c.ctx.lineTo(x - w / 2.4, tipY + dir * len);
      c.ctx.lineTo(x + w / 2.4, tipY + dir * len);
      c.ctx.lineTo(x + w / 2.4, tipY + dir * w);
      c.ctx.lineTo(x + w, tipY + dir * w);
      c.ctx.closePath();
      c.ctx.save();
      c.ctx.globalAlpha = c.style.fillOpacity ?? 0.9;
      c.ctx.fillStyle = fillStyleOf(c);
      c.ctx.fill();
      c.ctx.restore();
      applyStroke(c);
      c.ctx.stroke();
      c.ctx.setLineDash([]);
    },
    distance: (x, y, hc) => {
      const a = hc.pts[0];
      const dy = up ? y - a.y : a.y - y;
      return Math.abs(x - a.x) <= 8 && dy >= -4 && dy <= 20 ? 0 : null;
    },
  };
}
export const ARROW_UP = arrowMarker('arrow-up', 'Arrow Up', true);
export const ARROW_DOWN = arrowMarker('arrow-down', 'Arrow Down', false);

/** Highlighter — the brush with a fat, translucent stroke. */
export const HIGHLIGHTER: DrawingTool = {
  id: 'highlighter', name: 'Highlighter', points: 0, freehand: true,
  defaultStyle: { lineWidth: 12, fillOpacity: 0.28 },
  draw: (c) => {
    if (c.pts.length < 2) return;
    const d = c.rc.dpr;
    c.ctx.save();
    c.ctx.globalAlpha = c.style.fillOpacity ?? 0.28;
    c.ctx.strokeStyle = c.style.color;
    c.ctx.lineWidth = Math.max(2, (c.style.lineWidth || 12) * d);
    c.ctx.lineCap = 'round';
    c.ctx.lineJoin = 'round';
    c.ctx.beginPath();
    c.ctx.moveTo(c.pts[0].x, c.pts[0].y);
    for (let i = 1; i < c.pts.length; i++) c.ctx.lineTo(c.pts[i].x, c.pts[i].y);
    c.ctx.stroke();
    c.ctx.restore();
  },
  distance: (x, y, h) => {
    const d = distToPolyline(x, y, h.pts);
    return d <= Math.max(6, (h.drawing.style.lineWidth ?? 12) / 2) ? 0 : d;
  },
};

// ── fibonacci & gann ──────────────────────────────────────────────────────

/** Fib channel — fib levels spread across a trend leg, parallel to it. */
export const FIB_CHANNEL: DrawingTool = {
  id: 'fib-channel', name: 'Fib Channel', points: 3,
  defaultStyle: { showLabels: true, levels: [...DEFAULT_FIB] },
  draw: (c) => {
    const levels = c.style.levels ?? DEFAULT_FIB;
    const [a, b, w] = c.pts;
    // The third anchor sets the channel width; each level is a fraction of it.
    const offX = w.x - b.x;
    const offY = w.y - b.y;
    applyStroke(c);
    for (const lv of levels) {
      c.ctx.beginPath();
      c.ctx.moveTo(a.x + offX * lv, a.y + offY * lv);
      c.ctx.lineTo(b.x + offX * lv, b.y + offY * lv);
      c.ctx.stroke();
      if (c.style.showLabels !== false) {
        label(c, `${(lv * 100).toFixed(1)}%`, b.x + offX * lv + 4 * c.rc.dpr, b.y + offY * lv);
      }
    }
    c.ctx.setLineDash([]);
  },
  distance: (x, y, h) => {
    const levels = h.drawing.style.levels ?? DEFAULT_FIB;
    const [a, b, w] = h.pts;
    let best = Infinity;
    for (const lv of levels) {
      const d = distToSegment(x, y,
        { x: a.x + (w.x - b.x) * lv, y: a.y + (w.y - b.y) * lv },
        { x: b.x + (w.x - b.x) * lv, y: b.y + (w.y - b.y) * lv });
      if (d < best) best = d;
    }
    return best;
  },
};

/** The Fibonacci sequence itself — time zones count bars, not ratios. */
const FIB_SEQUENCE: readonly number[] = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55];

/** Fib time zone — vertical lines at fib multiples of the base leg's width. */
export const FIB_TIME_ZONE: DrawingTool = {
  id: 'fib-time-zone', name: 'Fib Time Zone', points: 2,
  defaultStyle: { showLabels: true },
  draw: (c) => {
    const [a, b] = c.pts;
    const unit = b.x - a.x;
    if (Math.abs(unit) < 0.5) return;
    const d = c.rc.dpr;
    const maxX = c.rc.plotWidth * d;
    applyStroke(c);
    for (const n of FIB_SEQUENCE) {
      const x = a.x + unit * n;
      if (x < -10 || x > maxX + 10) continue;
      c.ctx.beginPath();
      c.ctx.moveTo(Math.round(x) + 0.5, 0);
      c.ctx.lineTo(Math.round(x) + 0.5, c.rc.plotHeight * d);
      c.ctx.stroke();
      if (c.style.showLabels !== false) label(c, String(n), x + 3 * d, 12 * d);
    }
    c.ctx.setLineDash([]);
  },
  distance: (x, y, h) => {
    void y;
    const [a, b] = h.pts;
    const unit = b.x - a.x;
    if (Math.abs(unit) < 0.5) return null;
    let best = Infinity;
    for (const n of FIB_SEQUENCE) best = Math.min(best, Math.abs(x - (a.x + unit * n)));
    return best;
  },
};

const FAN_LEVELS: readonly number[] = [0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Rays from the anchor at fib fractions of the leg — speed resistance fan. */
export const FIB_FAN: DrawingTool = {
  id: 'fib-fan', name: 'Fib Speed Fan', points: 2,
  defaultStyle: { showLabels: true, levels: [...FAN_LEVELS] },
  draw: (c) => {
    const levels = c.style.levels ?? FAN_LEVELS;
    const [a, b] = c.pts;
    const d = c.rc.dpr;
    const maxX = c.rc.plotWidth * d;
    applyStroke(c);
    for (const lv of levels) {
      // Each ray takes the full run but a fraction of the rise.
      const end = extendSegment(a, { x: b.x, y: a.y + (b.y - a.y) * lv }, maxX, false, true)[1];
      c.ctx.beginPath();
      c.ctx.moveTo(a.x, a.y);
      c.ctx.lineTo(end.x, end.y);
      c.ctx.stroke();
      if (c.style.showLabels !== false) label(c, `${(lv * 100).toFixed(1)}%`, b.x + 4 * d, a.y + (b.y - a.y) * lv);
    }
    c.ctx.setLineDash([]);
  },
  distance: (x, y, h) => {
    const levels = h.drawing.style.levels ?? FAN_LEVELS;
    const [a, b] = h.pts;
    let best = Infinity;
    for (const lv of levels) {
      best = Math.min(best, distToSegment(x, y, a,
        extendSegment(a, { x: b.x, y: a.y + (b.y - a.y) * lv }, h.rc.plotWidth, false, true)[1]));
    }
    return best;
  },
};

/** Gann price/time ratios: 1x8 … 1x1 … 8x1. */
const GANN_RATIOS: readonly (readonly [number, number])[] = [
  [1, 0.125], [1, 0.25], [1, 0.5], [1, 1], [0.5, 1], [0.25, 1], [0.125, 1],
];

/** Gann fan — rays at the classic price/time ratios from one anchor. */
export const GANN_FAN: DrawingTool = {
  id: 'gann-fan', name: 'Gann Fan', points: 2,
  defaultStyle: { showLabels: true },
  draw: (c) => {
    const [a, b] = c.pts;
    const d = c.rc.dpr;
    const maxX = c.rc.plotWidth * d;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) < 0.5) return;
    applyStroke(c);
    for (const [rx, ry] of GANN_RATIOS) {
      const end = extendSegment(a, { x: a.x + dx * rx, y: a.y + dy * ry }, maxX, false, true)[1];
      c.ctx.beginPath();
      c.ctx.moveTo(a.x, a.y);
      c.ctx.lineTo(end.x, end.y);
      c.ctx.stroke();
    }
    // Only the 1x1 gets a label — the rest are read off it.
    if (c.style.showLabels !== false) label(c, '1x1', b.x + 4 * d, b.y);
    c.ctx.setLineDash([]);
  },
  distance: (x, y, h) => {
    const [a, b] = h.pts;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let best = Infinity;
    for (const [rx, ry] of GANN_RATIOS) {
      best = Math.min(best, distToSegment(x, y, a,
        extendSegment(a, { x: a.x + dx * rx, y: a.y + dy * ry }, h.rc.plotWidth, false, true)[1]));
    }
    return best;
  },
};

/** Gann box — an 8x8 grid over the drawn rectangle, plus the 1x1 diagonal. */
export const GANN_BOX: DrawingTool = {
  id: 'gann-box', name: 'Gann Box', points: 2,
  defaultStyle: { fill: true, fillOpacity: 0.05 },
  draw: (c) => {
    const r = rectOf(c.pts[0], c.pts[1]);
    withFill(c, () => c.ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0));
    applyStroke(c);
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    c.ctx.beginPath();
    for (let i = 0; i <= 8; i++) {
      const x = Math.round(r.x0 + (w * i) / 8) + 0.5;
      const y = Math.round(r.y0 + (h * i) / 8) + 0.5;
      c.ctx.moveTo(x, r.y0); c.ctx.lineTo(x, r.y1);
      c.ctx.moveTo(r.x0, y); c.ctx.lineTo(r.x1, y);
    }
    c.ctx.moveTo(r.x0, r.y1); c.ctx.lineTo(r.x1, r.y0);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
  },
  distance: (x, y, h) => distToRect(x, y, h.pts[0], h.pts[1], h.drawing.style.fill === true),
};

export const BUILTIN_DRAWING_TOOLS: readonly DrawingTool[] = [
  TREND_LINE, RAY, EXTENDED_LINE, ARROW,
  HORIZONTAL_LINE, HORIZONTAL_RAY, VERTICAL_LINE, CROSS_LINE,
  RECTANGLE, ELLIPSE, PARALLEL_CHANNEL,
  FIB_RETRACEMENT, FIB_EXTENSION,
  LONG_POSITION, SHORT_POSITION, FORECAST,
  MEASURE, PRICE_RANGE, DATE_RANGE,
  CIRCLE, TRIANGLE, POLYLINE, ARC, CURVE,
  ARROW_UP, ARROW_DOWN, HIGHLIGHTER,
  FIB_CHANNEL, FIB_TIME_ZONE, FIB_FAN, GANN_FAN, GANN_BOX,
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
