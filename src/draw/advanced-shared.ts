/** Internal drawing geometry in media pixels, shared by paint and hit testing. */
import type { PrimitiveRenderContext } from 'openalgo-charts';
import type { DrawContext, Drawing, DrawingPoint, DrawingTool, FibLevel, HitContext, ScreenPoint } from './types';
import { distToSegment } from './geometry';

export interface GeometryPath {
  points: ScreenPoint[];
  closed?: boolean;
  /** Filled paths use the drawing's fill settings. */
  fill?: boolean;
  /** False permits fill polygons without introducing visible end caps. */
  stroke?: boolean;
  color?: string;
}
export interface GeometryLabel { at: ScreenPoint; text: string; color?: string }
export interface DrawingGeometry { paths: GeometryPath[]; labels?: GeometryLabel[] }
export type GeometryBuilder = (c: HitContext) => DrawingGeometry;

export const midpoint = (a: ScreenPoint, b: ScreenPoint): ScreenPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const interpolate = (a: ScreenPoint, b: ScreenPoint, t: number): ScreenPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const finitePoint = (p: ScreenPoint): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);
export function projectPoint(p: DrawingPoint, rc: PrimitiveRenderContext): ScreenPoint {
  return { x: rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(p.time)), y: rc.priceScale.priceToY(p.price) };
}
export function numericProp(d: Drawing, key: string, fallback: number, min: number, max: number): number {
  const v = d.props?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
}
export function activeLevels(d: Drawing, fallback: readonly FibLevel[]): readonly FibLevel[] {
  return (d.style.levels ?? fallback).filter(l => l.enabled !== false && Number.isFinite(l.ratio));
}

/** Clip a parametric segment, ray or line to the plot, including vertical rays. */
export function clippedLine(
  a: ScreenPoint, b: ScreenPoint, rc: Pick<PrimitiveRenderContext, 'plotWidth' | 'plotHeight'>,
  from = 0, to = 1,
): ScreenPoint[] {
  if (!finitePoint(a) || !finitePoint(b)) return [];
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dx === 0 && dy === 0) return a.x >= 0 && a.x <= rc.plotWidth && a.y >= 0 && a.y <= rc.plotHeight ? [a, a] : [];
  for (const [p, delta, max] of [[a.x, dx, rc.plotWidth], [a.y, dy, rc.plotHeight]]) {
    if (delta === 0) { if (p < 0 || p > max) return []; continue; }
    const t0 = -p / delta, t1 = (max - p) / delta;
    from = Math.max(from, Math.min(t0, t1));
    to = Math.min(to, Math.max(t0, t1));
    if (from > to) return [];
  }
  return [interpolate(a, b, from), interpolate(a, b, to)];
}

export function extendedLine(a: ScreenPoint, b: ScreenPoint, c: HitContext): ScreenPoint[] {
  // Left/right extension changes the time span, so a vertical segment keeps
  // its anchors. Directional rays use clippedLine with explicit bounds.
  if (a.x === b.x) return clippedLine(a, b, c.rc);
  const forward = b.x >= a.x;
  return clippedLine(a, b, c.rc,
    (forward ? c.drawing.style.extendLeft : c.drawing.style.extendRight) === true ? -Infinity : 0,
    (forward ? c.drawing.style.extendRight : c.drawing.style.extendLeft) === true ? Infinity : 1);
}

/** Clip a convex fill polygon without cutting off corners between ray exits. */
export function clipPolygon(points: readonly ScreenPoint[], rc: Pick<PrimitiveRenderContext, 'plotWidth' | 'plotHeight'>): ScreenPoint[] {
  if (!points.every(finitePoint)) return [];
  let result = points.slice();
  for (const [axis, limit, sign] of [['x', 0, 1], ['x', rc.plotWidth, -1], ['y', 0, 1], ['y', rc.plotHeight, -1]] as const) {
    const input = result;
    result = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length];
      const insideA = (a[axis] - limit) * sign >= 0, insideB = (b[axis] - limit) * sign >= 0;
      if (insideA) result.push(a);
      if (insideA !== insideB) result.push(interpolate(a, b, (limit - a[axis]) / (b[axis] - a[axis])));
    }
  }
  return result;
}

/** Even-odd polygon membership follows Canvas's explicit fill rule. */
export function insidePolygon(x: number, y: number, points: readonly ScreenPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** A bounded polyline approximation used identically for stroke and distance. */
export function sampleArc(center: ScreenPoint, rx: number, ry: number, start: number, sweep: number): ScreenPoint[] {
  const count = Math.max(2, Math.min(96, Math.ceil(Math.abs(sweep) * Math.max(Math.abs(rx), Math.abs(ry)) / 4)));
  return Array.from({ length: count + 1 }, (_, i) => {
    const angle = start + sweep * i / count;
    return { x: center.x + rx * Math.cos(angle), y: center.y + ry * Math.sin(angle) };
  });
}

export function geometryDistance(x: number, y: number, geometry: DrawingGeometry, drawing: Drawing): number | null {
  let best = Infinity;
  for (const path of geometry.paths) {
    const p = path.points;
    if (p.length < 2 || !p.every(finitePoint)) continue;
    const filled = path.fill === true && drawing.style.fill === true && (drawing.style.fillOpacity ?? 0.12) > 0;
    if (filled && insidePolygon(x, y, p)) return 0;
    if (path.stroke === false) continue;
    for (let i = 1; i < p.length; i++) best = Math.min(best, distToSegment(x, y, p[i - 1], p[i]));
    if (path.closed === true) best = Math.min(best, distToSegment(x, y, p[p.length - 1], p[0]));
  }
  return Number.isFinite(best) ? best : null;
}

export function paintGeometry(c: DrawContext, geometry: DrawingGeometry): void {
  const { ctx, rc, style } = c, dpr = rc.dpr;
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = Math.max(1, style.lineWidth * dpr);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(style.lineStyle === 'dashed' ? [6 * dpr, 4 * dpr] : style.lineStyle === 'dotted' ? [dpr, 3 * dpr] : []);
  for (const path of geometry.paths) {
    if (path.points.length < 2 || !path.points.every(finitePoint)) continue;
    ctx.beginPath();
    ctx.moveTo(path.points[0].x * dpr, path.points[0].y * dpr);
    for (let i = 1; i < path.points.length; i++) ctx.lineTo(path.points[i].x * dpr, path.points[i].y * dpr);
    if (path.closed === true) ctx.closePath();
    if (path.fill === true && style.fill === true) {
      ctx.save();
      ctx.globalAlpha *= Math.max(0, Math.min(1, style.fillOpacity ?? 0.12));
      ctx.fillStyle = style.fillColor ?? style.color;
      ctx.fill('evenodd');
      ctx.restore();
    }
    if (path.stroke !== false) { ctx.strokeStyle = path.color ?? style.color; ctx.stroke(); }
  }
  const text = c.drawing.text;
  const size = (text?.fontSize ?? 11) * dpr;
  ctx.font = `${text?.italic === true ? 'italic ' : ''}${text?.bold === true ? '700 ' : ''}${size}px ${text?.fontFamily || 'ui-sans-serif, system-ui, sans-serif'}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  for (const label of geometry.labels ?? []) {
    if (!finitePoint(label.at)) continue;
    ctx.fillStyle = text?.color ?? label.color ?? style.color;
    ctx.fillText(label.text, label.at.x * dpr, label.at.y * dpr);
  }
  ctx.restore();
}

/** Wrap a pure media-pixel builder in the existing device-pixel draw contract. */
export function geometryTool(descriptor: Omit<DrawingTool, 'draw' | 'distance'>, build: GeometryBuilder): DrawingTool {
  return {
    ...descriptor,
    draw(c) {
      const pts = c.pts.map(p => ({ x: p.x / c.rc.dpr, y: p.y / c.rc.dpr }));
      paintGeometry(c, build({ pts, drawing: { ...c.drawing, style: c.style }, rc: c.rc }));
    },
    distance(x, y, c) {
      if (x < 0 || y < 0 || x > c.rc.plotWidth || y > c.rc.plotHeight) return null;
      return geometryDistance(x, y, build(c), c.drawing);
    },
  };
}
