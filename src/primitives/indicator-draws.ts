/**
 * Free-standing shapes an indicator paints in its pane (ARCHITECTURE.md §8):
 * lines, boxes, labels and polylines anchored to time and price.
 *
 * One primitive holds the whole list rather than one primitive per shape. A
 * descriptor rebuilds its shapes on every recompute, so per-shape primitives
 * would mean attaching and detaching a dozen objects on every live tick, and
 * the pane would re-sort its z-order for each of them.
 *
 * Anchors are **times**, never logical indices: paging history in at the left
 * edge shifts every index, and a trendline pinned to an index would slide off
 * its pivots the moment it did.
 */
import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext, ZOrder } from './primitive';
import type { IndicatorDrawing, IndicatorLineStyle, DrawAnchor } from '../model/indicator-registry';
import { roundRectPath, contrastText } from '../render/pill';

/** Dash pattern in device px, matching the drawing tier's vocabulary. */
function dashOf(style: IndicatorLineStyle | undefined, d: number): number[] {
  return style === 'dashed' ? [6 * d, 4 * d] : style === 'dotted' ? [1 * d, 3 * d] : [];
}

/**
 * A rounded plate with one row per `\n`-separated line, sized to the widest.
 * `x` is the plate's left, centre or right edge per `align`; `y` its middle.
 */
function drawPlate(
  ctx: CanvasRenderingContext2D,
  d: number,
  x: number,
  y: number,
  text: string,
  bg: string,
  textColor: string | undefined,
  align: 'left' | 'center' | 'right',
): void {
  const size = 11 * d;
  ctx.font = `${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const lines = text.split('\n');
  let textW = 0;
  for (const line of lines) textW = Math.max(textW, ctx.measureText(line).width);
  const padX = 5 * d;
  const padY = 3 * d;
  const lh = size * 1.35;
  const w = textW + padX * 2;
  const h = lh * lines.length + padY * 2;
  const bx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const by = y - h / 2;
  ctx.beginPath();
  roundRectPath(ctx, bx, by, w, h, 3 * d);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = textColor ?? contrastText(bg);
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], bx + padX, by + padY + lh * (i + 0.5));
}

export class IndicatorDrawings implements IPrimitive {
  private _items: readonly IndicatorDrawing[] = [];
  private _host: PrimitiveHost | null = null;
  private _visible = true;

  public attached(host: PrimitiveHost): void { this._host = host; }
  public detached(): void { this._host = null; }
  /** Over the series, under the crosshair: these are annotations on the data. */
  public zOrder(): ZOrder { return 'normal'; }
  /**
   * A shape is drawn where the descriptor put it and never argues with the
   * scale. A projection reaching far above the data would otherwise squash the
   * study it annotates into a band a few pixels tall.
   */
  public autoscaleInfo(): null { return null; }

  public setItems(items: readonly IndicatorDrawing[]): void {
    this._items = items;
    this._host?.requestUpdate();
  }

  public setVisible(on: boolean): void {
    this._visible = on;
    this._host?.requestUpdate();
  }

  public draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext): void {
    if (!this._visible || this._items.length === 0) return;
    const d = rc.dpr;
    const w = rc.plotWidth * d;
    const h = rc.plotHeight * d;
    const ink = rc.theme.axisText;
    // Plates are not measured until they are drawn, so they cull on their
    // anchor with a margin wide enough to cover any label anyone will write.
    const m = 200 * d;
    const x = (a: DrawAnchor): number => rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(a.time)) * d;
    const y = (a: DrawAnchor): number => rc.priceScale.priceToY(a.price) * d;
    // A shape entirely off-pane costs a path and a fill for nothing, and a
    // descriptor that marks every pivot in 50k bars leaves most of them there.
    const offPane = (x0: number, y0: number, x1: number, y1: number): boolean =>
      Math.max(x0, x1) < 0 || Math.min(x0, x1) > w || Math.max(y0, y1) < 0 || Math.min(y0, y1) > h;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (const item of this._items) {
      if (item.kind === 'label') {
        const px = x(item.at);
        const py = y(item.at);
        if (px < -m || px > w + m || py < -m || py > h + m) continue;
        drawPlate(ctx, d, px, py, item.text, item.color ?? ink, item.textColor, item.align ?? 'center');
        continue;
      }

      const color = item.color ?? ink;
      ctx.lineWidth = Math.max(1, Math.round((item.lineWidth ?? 1) * d));

      if (item.kind === 'polyline') {
        const pts = item.points;
        if (pts.length < 2) continue;
        const xs = new Array<number>(pts.length);
        const ys = new Array<number>(pts.length);
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < pts.length; i++) {
          const px = x(pts[i]);
          const py = y(pts[i]);
          xs[i] = px; ys[i] = py;
          if (px < x0) x0 = px;
          if (px > x1) x1 = px;
          if (py < y0) y0 = py;
          if (py > y1) y1 = py;
        }
        if (offPane(x0, y0, x1, y1)) continue;
        ctx.beginPath();
        ctx.moveTo(xs[0], ys[0]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(xs[i], ys[i]);
        if (item.closed === true) ctx.closePath();
        if (item.fillColor !== undefined) {
          ctx.globalAlpha = item.opacity ?? 0.12;
          ctx.fillStyle = item.fillColor;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.setLineDash([]);
        ctx.strokeStyle = color;
        ctx.stroke();
        continue;
      }

      let ax = x(item.from);
      let ay = y(item.from);
      let bx = x(item.to);
      let by = y(item.to);

      if (item.kind === 'box') {
        if (offPane(ax, ay, bx, by)) continue;
        const rx = Math.min(ax, bx);
        const ry = Math.min(ay, by);
        const rw = Math.abs(bx - ax);
        const rh = Math.abs(by - ay);
        if (item.fillColor !== undefined) {
          ctx.globalAlpha = item.opacity ?? 0.12;
          ctx.fillStyle = item.fillColor;
          ctx.fillRect(rx, ry, rw, rh);
          ctx.globalAlpha = 1;
        }
        ctx.setLineDash([]);
        ctx.strokeStyle = color;
        ctx.strokeRect(rx, ry, rw, rh);
        if (item.text !== undefined && item.text !== '') {
          drawPlate(ctx, d, rx + rw / 2, ry + rh / 2, item.text, color, item.textColor, 'center');
        }
        continue;
      }

      if (item.extendLeft === true || item.extendRight === true) {
        // A ray keeps its own slope out to the pane edge, so each end is solved
        // for x rather than clamped: clamping would flatten every sloped line
        // into the horizontal one nobody asked for.
        const dx = bx - ax;
        if (dx === 0) {
          ay = 0; // a vertical line has no left or right end; either flag spans the pane
          by = h;
        } else {
          const slope = (by - ay) / dx;
          const aIsLeft = ax <= bx;
          if (item.extendLeft === true) {
            if (aIsLeft) { ay -= slope * ax; ax = 0; } else { by -= slope * bx; bx = 0; }
          }
          if (item.extendRight === true) {
            if (aIsLeft) { by += slope * (w - bx); bx = w; } else { ay += slope * (w - ax); ax = w; }
          }
        }
      }
      if (offPane(ax, ay, bx, by)) continue;
      ctx.setLineDash(dashOf(item.lineStyle, d));
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
  }
}
