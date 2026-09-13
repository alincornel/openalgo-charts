/** Channels, pitchforks and dedicated line tools. Geometry stays in media pixels. */
import type { DrawingPoint, DrawingTool, FibLevel, HitContext, ScreenPoint } from './types';
import { composeSettings, EXTEND_FIELDS, FILL_FIELDS, FONT_FIELDS, LEVEL_FIELDS, LINE_FIELDS, SHOW_LABELS_FIELD } from './schema';
import { cloneLevels, formatRatio, levelColor } from './levels';
import {
  activeLevels, clippedLine, clipPolygon, extendedLine, geometryTool, interpolate, midpoint, numericProp,
  projectPoint, sampleArc, type DrawingGeometry, type GeometryPath,
} from './advanced-shared';

const CHANNEL_SETTINGS = composeSettings([LINE_FIELDS, FILL_FIELDS, EXTEND_FIELDS]);
const FORK_LEVELS: readonly FibLevel[] = [{ ratio: 0 }, { ratio: 0.5 }, { ratio: 1 }];
const EXTENSION_LEVELS: readonly FibLevel[] = [0, 1, 1.272, 1.618, 2, 2.618, 3.618, 4.236].map(ratio => ({ ratio }));
const FAN_LEVELS: readonly FibLevel[] = [0.382, 0.5, 0.618, 1].map(ratio => ({ ratio }));
const empty = (): DrawingGeometry => ({ paths: [] });
const line = (a: ScreenPoint, b: ScreenPoint): GeometryPath => ({ points: [a, b] });

function fillEndpoints(a: ScreenPoint, b: ScreenPoint, c: HitContext): ScreenPoint[] {
  const dx = b.x - a.x;
  if (dx === 0) return [a, b];
  const left = c.drawing.style.extendLeft === true ? 0 : Math.min(a.x, b.x);
  const right = c.drawing.style.extendRight === true ? c.rc.plotWidth : Math.max(a.x, b.x);
  const at = (x: number): ScreenPoint => ({ x, y: a.y + (b.y - a.y) * (x - a.x) / dx });
  return dx > 0 ? [at(left), at(right)] : [at(right), at(left)];
}

function channel(c: HitContext, lower: ScreenPoint[]): DrawingGeometry {
  const [a, b] = c.pts;
  const upper = extendedLine(a, b, c);
  const bottom = extendedLine(lower[0], lower[1], c);
  const paths: GeometryPath[] = [];
  if (c.drawing.style.fill === true) {
    const topFill = fillEndpoints(a, b, c), bottomFill = fillEndpoints(lower[0], lower[1], c);
    paths.push({ points: clipPolygon([topFill[0], topFill[1], bottomFill[1], bottomFill[0]], c.rc), closed: true, fill: true, stroke: false });
  }
  paths.push({ points: upper }, { points: bottom });
  return { paths };
}

const disjoint = geometryTool({
  id: 'disjoint-channel', name: 'Disjoint Channel', points: 4,
  defaultStyle: { fill: true }, settings: CHANNEL_SETTINGS,
}, c => c.pts.length < 4 ? empty() : channel(c, c.pts.slice(2, 4)));

const flat = geometryTool({
  id: 'flat-top-bottom', name: 'Flat Top/Bottom', points: 3,
  defaultStyle: { fill: true }, settings: CHANNEL_SETTINGS,
  constrain(points) {
    const out = points.map(p => ({ ...p }));
    if (out.length >= 3) out[2].time = (out[0].time + out[1].time) / 2;
    return out;
  },
}, c => c.pts.length < 3 ? empty() : channel(c, [{ x: c.pts[0].x, y: c.pts[2].y }, { x: c.pts[1].x, y: c.pts[2].y }]));

/** Inclusive time bounds avoid scanning unrelated loaded history. */
function lowerBound(bars: readonly { time: number }[], time: number, inclusive: boolean): number {
  let lo = 0, hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (bars[mid].time < time || (inclusive && bars[mid].time === time)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const regression = geometryTool({
  id: 'regression-channel', name: 'Regression Channel', points: 2,
  defaultStyle: { fill: true, showLabels: true },
  settings: composeSettings([LINE_FIELDS, FILL_FIELDS, EXTEND_FIELDS, SHOW_LABELS_FIELD, FONT_FIELDS,
    { path: 'props.deviation', label: 'Deviation multiplier', kind: 'number', min: 0.01, max: 20, step: 0.1, group: 'behavior' }]),
}, c => {
  if (c.pts.length < 2) return empty();
  const bars = c.rc.bars?.() ?? [];
  const [a, b] = c.drawing.points;
  const first = lowerBound(bars, Math.min(a.time, b.time), false);
  const last = lowerBound(bars, Math.max(a.time, b.time), true);
  let n = 0, meanX = 0, meanY = 0, xx = 0, xy = 0, yy = 0;
  let firstTime = 0, lastTime = 0, firstIndex = 0, lastIndex = 0;
  // Bars are live and even historical closes can change in place. Recompute
  // exact moments instead of treating array identity as a revision signal.
  for (let i = first; i < last; i++) {
    const bar = bars[i], y = bar.close;
    // Stored times have exact shared indices; the map avoids a binary search
    // per close and still includes timeline entries from secondary series.
    const x = c.rc.dataLayer.timeToIndex?.(bar.time) ?? c.rc.dataLayer.timeToIndexFloat(bar.time);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (n === 0) { firstTime = bar.time; firstIndex = x; }
    lastTime = bar.time; lastIndex = x;
    n++;
    const dx = x - meanX, dy = y - meanY;
    meanX += dx / n; meanY += dy / n;
    xx += dx * (x - meanX); xy += dx * (y - meanY); yy += dy * (y - meanY);
  }
  if (n === 0) return { paths: [], labels: c.drawing.style.showLabels === false ? [] : [{ at: c.pts[0], text: 'No bars in range' }] };
  const slope = xx > 0 ? xy / xx : 0;
  const value = (x: number): number => meanY + slope * (x - meanX);
  const deviation = Math.sqrt(Math.max(0, yy - slope * xy) / n) * numericProp(c.drawing, 'deviation', 2, 0.01, 20);
  const r2 = yy > 0 ? Math.max(0, Math.min(1, slope * xy / yy)) : 1;
  const endpoint = (time: number, index: number, offset: number) => projectPoint({ time, price: value(index) + offset }, c.rc);
  const paths: GeometryPath[] = [0, deviation, -deviation].map(offset => ({ points: extendedLine(endpoint(firstTime, firstIndex, offset), endpoint(lastTime, lastIndex, offset), c) }));
  if (c.drawing.style.fill === true) {
    const upper = fillEndpoints(endpoint(firstTime, firstIndex, deviation), endpoint(lastTime, lastIndex, deviation), c);
    const lower = fillEndpoints(endpoint(firstTime, firstIndex, -deviation), endpoint(lastTime, lastIndex, -deviation), c);
    paths.push({ points: clipPolygon([upper[0], upper[1], lower[1], lower[0]], c.rc), closed: true, fill: true, stroke: false });
  }
  return { paths, labels: c.drawing.style.showLabels === false ? [] : [{ at: endpoint(firstTime, firstIndex, deviation), text: `R^2 ${r2.toFixed(3)}  ${n} bars` }] };
});

function pitchfork(id: string, name: string, variant: 'standard' | 'schiff' | 'modified' | 'inside'): DrawingTool {
  return geometryTool({ id, name, points: 3,
    defaultStyle: { fill: true, showLabels: true, levels: cloneLevels(FORK_LEVELS) },
    settings: composeSettings([LINE_FIELDS, FILL_FIELDS, LEVEL_FIELDS, FONT_FIELDS]),
  }, c => {
    if (c.pts.length < 3) return empty();
    const [a, b, end] = c.pts, middle = midpoint(b, end);
    const [p0, p1] = c.drawing.points;
    // Shift in data space so logarithmic scales map the intended price.
    const shifted: DrawingPoint = {
      time: variant === 'schiff' ? p0.time : (p0.time + p1.time) / 2,
      price: (p0.price + p1.price) / 2,
    };
    const base = variant === 'standard' ? a : projectPoint(shifted, c.rc);
    const origin = variant === 'inside' ? middle : base;
    const delta = variant === 'inside' ? { x: end.x - base.x, y: end.y - base.y } : { x: middle.x - base.x, y: middle.y - base.y };
    const ray = (start: ScreenPoint): ScreenPoint[] => clippedLine(start, { x: start.x + delta.x, y: start.y + delta.y }, c.rc, 0, Infinity);
    const paths: GeometryPath[] = [];
    const labels: NonNullable<DrawingGeometry['labels']> = [];
    const levels = activeLevels(c.drawing, FORK_LEVELS);
    for (const level of levels) {
      const color = level.color;
      const starts = level.ratio === 0 ? [origin] : [interpolate(middle, b, level.ratio), interpolate(middle, end, level.ratio)];
      for (const start of starts) {
        const points = ray(start);
        paths.push({ points, color });
        if (c.drawing.style.showLabels !== false && points.length === 2) labels.push({ at: { x: points[0].x + 4, y: points[0].y - 4 }, text: level.label ?? formatRatio(level.ratio), color });
      }
    }
    // Fill only enabled bands; no hidden outer level can keep a fill hittable.
    const outer = levels.reduce((max, level) => Math.max(max, Math.abs(level.ratio)), 0);
    if (c.drawing.style.fill === true && outer > 0) {
      const upper = interpolate(middle, b, outer), lower = interpolate(middle, end, outer);
      const length = Math.hypot(delta.x, delta.y);
      if (length > 0) {
        // Put the far end beyond every pane corner before clipping the area.
        // Joining independently clipped rays would leave an unfilled triangle.
        const reach = (Math.max(Math.hypot(upper.x, upper.y), Math.hypot(lower.x, lower.y)) + Math.hypot(c.rc.plotWidth, c.rc.plotHeight)) / length + 1;
        const far = (p: ScreenPoint): ScreenPoint => ({ x: p.x + delta.x * reach, y: p.y + delta.y * reach });
        paths.unshift({ points: clipPolygon([upper, far(upper), far(lower), lower], c.rc), closed: true, fill: true, stroke: false });
      }
    }
    paths.push(line(b, end));
    if (variant === 'inside') paths.push(line(base, end), line(a, b));
    return { paths, labels };
  });
}

const info = geometryTool({ id: 'info-line', name: 'Info Line', points: 2, angleLock: true,
  defaultStyle: { showLabels: true }, settings: composeSettings([LINE_FIELDS, EXTEND_FIELDS, SHOW_LABELS_FIELD, FONT_FIELDS]),
}, c => {
  if (c.pts.length < 2) return empty();
  const [a, b] = c.pts, [p0, p1] = c.drawing.points;
  const change = p1.price - p0.price, sign = change >= 0 ? '+' : '';
  const percent = p0.price === 0 ? 'n/a' : `${sign}${(change / Math.abs(p0.price) * 100).toFixed(2)}%`;
  const bars = Math.abs(Math.round(c.rc.dataLayer.timeToIndexFloat(p1.time) - c.rc.dataLayer.timeToIndexFloat(p0.time)));
  return { paths: [{ points: extendedLine(a, b, c) }], labels: c.drawing.style.showLabels === false ? [] : [{
    at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 8 },
    text: `${sign}${c.rc.priceScale.format(change)} (${percent})  ${bars} bars`,
  }] };
});

const angle = geometryTool({ id: 'trend-angle', name: 'Trend Angle', points: 2, angleLock: true,
  defaultStyle: { showLabels: true }, settings: composeSettings([LINE_FIELDS, SHOW_LABELS_FIELD, FONT_FIELDS]),
}, c => {
  if (c.pts.length < 2) return empty();
  const [a, b] = c.pts, radians = Math.atan2(b.y - a.y, b.x - a.x);
  const radius = Math.max(12, Math.min(40, Math.hypot(b.x - a.x, b.y - a.y) / 3));
  return { paths: [line(a, b), line(a, { x: a.x + radius * 1.5, y: a.y }), { points: sampleArc(a, radius, radius, 0, radians) }],
    labels: c.drawing.style.showLabels === false ? [] : [{ at: { x: a.x + radius + 6, y: a.y - 6 }, text: `${(-radians * 180 / Math.PI).toFixed(1)} deg` }] };
});

const extension = geometryTool({ id: 'fib-extension-two-point', name: 'Fib Extension (Two Point)', points: 2,
  defaultStyle: { levels: cloneLevels(EXTENSION_LEVELS), showLabels: true },
  settings: composeSettings([LINE_FIELDS, LEVEL_FIELDS, EXTEND_FIELDS, FONT_FIELDS]),
}, c => {
  if (c.pts.length < 2) return empty();
  const [a, b] = c.pts, [p0, p1] = c.drawing.points;
  const paths: GeometryPath[] = [line(a, b)], labels: NonNullable<DrawingGeometry['labels']> = [];
  for (const lv of activeLevels(c.drawing, EXTENSION_LEVELS)) {
    const price = p0.price + (p1.price - p0.price) * lv.ratio;
    const y = c.rc.priceScale.priceToY(price), color = lv.color ?? levelColor(lv.ratio);
    paths.push({ points: extendedLine({ x: a.x, y }, { x: b.x, y }, c), color });
    if (c.drawing.style.showLabels !== false) labels.push({ at: { x: Math.min(a.x, b.x) + 4, y: y - 3 }, text: `${lv.label ?? formatRatio(lv.ratio)}  ${c.rc.priceScale.format(price)}`, color });
  }
  return { paths, labels };
});

const fan = geometryTool({ id: 'fib-speed-resistance-fan', name: 'Fib Speed Resistance Fan', points: 2,
  defaultStyle: { levels: cloneLevels(FAN_LEVELS), showLabels: true }, settings: composeSettings([LINE_FIELDS, LEVEL_FIELDS, FONT_FIELDS]),
}, c => {
  if (c.pts.length < 2) return empty();
  const [a, b] = c.pts, paths: GeometryPath[] = [], labels: NonNullable<DrawingGeometry['labels']> = [];
  for (const lv of activeLevels(c.drawing, FAN_LEVELS)) {
    const targets = [{ x: b.x, y: a.y + (b.y - a.y) * lv.ratio }];
    if (lv.ratio !== 1) targets.push({ x: a.x + (b.x - a.x) * lv.ratio, y: b.y });
    targets.forEach((target, i) => {
      const points = clippedLine(a, target, c.rc, 0, Infinity), color = lv.color ?? c.drawing.style.color ?? levelColor(lv.ratio);
      paths.push({ points, color });
      if (c.drawing.style.showLabels !== false && points.length === 2) {
        const at = interpolate(points[0], points[1], 0.7);
        labels.push({ at: { x: at.x + 4, y: at.y - 4 }, text: `${lv.label ?? formatRatio(lv.ratio)} ${i === 0 ? 'price' : 'time'}`, color });
      }
    });
  }
  return { paths, labels };
});

const STAMP_SHAPES = ['star', 'diamond', 'circle', 'arrow up', 'arrow down', 'check', 'cross'] as const;
const stamp = geometryTool({ id: 'icon-stamp', name: 'Icon Stamp', points: 1,
  defaultStyle: { fill: true, fillOpacity: 0.8 },
  settings: composeSettings([LINE_FIELDS, FILL_FIELDS,
    { path: 'props.shape', label: 'Shape', kind: 'select', group: 'behavior', options: STAMP_SHAPES.map(shape => ({ value: shape.replace(' ', '-'), label: shape[0].toUpperCase() + shape.slice(1) })) },
    { path: 'props.size', label: 'Size', kind: 'number', min: 8, max: 160, step: 2, group: 'behavior' }]),
}, c => {
  if (c.pts.length < 1) return empty();
  const a = c.pts[0], r = numericProp(c.drawing, 'size', 28, 8, 160) / 2;
  const point = (x: number, y: number) => ({ x: a.x + x * r, y: a.y + y * r });
  const shape = c.drawing.props?.shape;
  let points: ScreenPoint[];
  if (shape === 'diamond') points = [point(0, -1), point(1, 0), point(0, 1), point(-1, 0)];
  else if (shape === 'circle') points = sampleArc(a, r, r, 0, 2 * Math.PI);
  else if (shape === 'arrow-up' || shape === 'arrow-down') {
    const sign = shape === 'arrow-up' ? 1 : -1;
    points = [[0, -1], [1, 0], [0.35, 0], [0.35, 1], [-0.35, 1], [-0.35, 0], [-1, 0]].map(([x, y]) => point(x, y * sign));
  } else if (shape === 'check') {
    points = [[-1, 0], [-0.65, -0.3], [-0.2, 0.2], [0.75, -0.85], [1, -0.55], [-0.2, 0.85]].map(([x, y]) => point(x, y));
  } else if (shape === 'cross') {
    points = [[-1, -0.65], [-0.65, -1], [0, -0.35], [0.65, -1], [1, -0.65], [0.35, 0], [1, 0.65], [0.65, 1], [0, 0.35], [-0.65, 1], [-1, 0.65], [-0.35, 0]].map(([x, y]) => point(x, y));
  } else {
    points = Array.from({ length: 10 }, (_, i) => {
      const theta = -Math.PI / 2 + i * Math.PI / 5, radius = i % 2 === 0 ? 1 : 0.45;
      return point(Math.cos(theta) * radius, Math.sin(theta) * radius);
    });
  }
  return { paths: [{ points, closed: true, fill: true }] };
});

export const ADVANCED_LINE_TOOLS: readonly DrawingTool[] = [
  disjoint, flat, regression,
  pitchfork('pitchfork', 'Pitchfork', 'standard'),
  pitchfork('schiff-pitchfork', 'Schiff Pitchfork', 'schiff'),
  pitchfork('modified-schiff-pitchfork', 'Modified Schiff Pitchfork', 'modified'),
  pitchfork('inside-pitchfork', 'Inside Pitchfork', 'inside'),
  info, angle, extension, fan, stamp,
];
