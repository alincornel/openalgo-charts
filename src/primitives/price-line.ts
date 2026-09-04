/**
 * Horizontal price line primitive (ARCHITECTURE.md §8). The reusable base for
 * order/SL/TP/alert/indicator-level lines: a line across the plot plus a fixed
 * right-axis price tag and an optional broker-style segmented pill group on the
 * line — [badge][qty][label][✕] — with hover / dragging states (the chart
 * passes `hoverId`/`dragId` on the render context) and a drag ghost at the
 * pre-drag price via `setDragGhost`. Interaction semantics are unchanged from
 * the classic tag: the ✕ hit-tests as `${id}::close`, everything else drags.
 */
import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext, PrimitiveHit, ZOrder } from './primitive';
import { contrastText, withAlpha, shade, drawPillGroup, type PillSegment } from '../render/pill';
import { dashPattern, type CanvasLineStyle } from '../render/grid';

export interface PriceLineOptions {
  price: number;
  color: string;
  /** Line thickness in media px. Default 1. */
  lineWidth?: number;
  /** Legacy two-state dash switch, equivalent to `lineStyle: 'dashed'`. */
  dashed?: boolean;
  /**
   * Dash style, the three-way form of `dashed`. Set, it wins over the boolean;
   * unset, the boolean still decides, so a line built before this existed draws
   * exactly as it did.
   */
  lineStyle?: CanvasLineStyle;
  /** Right-axis tag text. Defaults to the formatted price. */
  label?: string;
  /** Solid colored badge segment at the start of the pill group (e.g. 'BUY', 'TP', 'SL'). */
  badge?: string;
  /** Quantity segment rendered as a neutral box after the badge. */
  qty?: string | number;
  /** Info text segment (order type, price, P&L ...) — the classic left tag text. */
  leftLabel?: string;
  /**
   * A second info segment, drawn after `leftLabel`. Separate from it because
   * the two carry different kinds of fact and change at different rates: the
   * label says what the line IS (order type, side), the note says what it is
   * currently WORTH, which moves with the market.
   */
  note?: string;
  /**
   * Custom pill segments. When present these replace badge/qty/leftLabel/closeButton.
   * A segment with an id hit-tests independently, which lets trading tickets put
   * side, quantity, type and submit actions directly on the draggable line.
   */
  pillSegments?: readonly PriceLinePillSegment[];
  /**
   * Fraction of the plot width the line spans, measured from the right (price)
   * axis. 1 = full width (default); 0.3 = only the rightmost 30%, like a
   * partial-width order line. The right-axis tag is always drawn.
   */
  extentFromRight?: number;
  /**
   * Where the pill group sits, as a fraction of the plot width measured from
   * the right axis. Defaults to `extentFromRight`, so nothing that predates
   * this option moves.
   *
   * It is a separate knob because the two answer different questions. How far
   * the line reaches is about reading the level across the plot; where the
   * pill sits is about where the buttons are. Tying them together means a line
   * lengthened to full width drags its cancel button to the far left edge,
   * over the oldest bars on screen and as far as it can get from the price the
   * trader is actually watching.
   */
  pillInsetFromRight?: number;
  /** Draw a cancel (✕) segment at the end of the pill group; hit-tests as `${id}::close`. */
  closeButton?: boolean;
  /**
   * Whether the line widens the pane's autoscale range so it is always in
   * view. Default true, which is what every existing caller got.
   *
   * An order line wants the opposite. Placing a limit far from the market
   * would re-fit the whole price scale around it, so the act of placing an
   * order flattens the bars the trader was reading and moves the chart under
   * their hand. `PriceLevels` declines to autoscale for exactly this reason
   * and says so at the top of that file: a level that scrolls off the top is
   * the lesser harm. The axis tag still marks where the line is.
   */
  autoscale?: boolean;
  /** Stable id returned by hit-test (for click/drag routing). */
  id: string;
  /** Cursor hint when hovered (e.g. 'ns-resize' for draggable lines). */
  cursor?: string;
}

export interface PriceLinePillSegment {
  id?: string;
  text?: string;
  close?: boolean;
  fill?: string;
  textColor?: string;
  border?: string;
  /** Floor on the segment's width in media px, for a segment meant to be tapped. */
  minWidth?: number;
}

/** Clamp an optional 0..1 fraction, falling back when it was not given. */
function fraction(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Math.max(0, Math.min(1, value));
}

/** Pill/segment height in media px (shared by draw + hit-test). */
const TAG_H = 18;
/**
 * How much bigger the pill gets when the host says the pointer is a finger.
 *
 * 18 px of pill and an 11 px label are sized for a mouse, where the cursor is
 * one pixel and the eye is a foot from the glass. A thumb is closer to 9 mm
 * across and the phone is held at arm's length, so the same pill is both hard
 * to hit and hard to read. The host decides — the chart cannot reliably know
 * whether the pointer is coarse — and everything else here scales off it.
 */
const TOUCH_SCALE = 1.8;
/**
 * How far above and below the drawn pill still counts as a press on it, media
 * px. Deliberately larger than half the pill: the pill is sized to look right
 * at a glance, and an 18 px band is a comfortable mouse target and a poor
 * thumb one. Widening the hit area rather than the drawing keeps the chart
 * looking the same and still gives a finger something to land on.
 */
const PILL_HIT_H = 28;
/** Gap between segments in media px. */
const GAP = 2;

export class PriceLine implements IPrimitive {
  private _opts: PriceLineOptions;
  private _host: PrimitiveHost | null = null;
  private _ghostPrice: number | null = null;
  /** Pill-group geometry from the last draw (media px) for hit-testing. */
  private _group: {
    x0: number;
    x1: number;
    closeX0: number;
    segments: Array<{ id: string; x0: number; x1: number }>;
  } | null = null;

  public constructor(opts: PriceLineOptions) {
    this._opts = opts;
  }

  public attached(host: PrimitiveHost): void {
    this._host = host;
  }

  public detached(): void {
    this._host = null;
  }

  public get price(): number {
    return this._opts.price;
  }

  /** Move the line; schedules a repaint via the host. */
  public setPrice(price: number): void {
    this._opts.price = price;
    this._host?.requestUpdate();
  }

  /** Update the info segment text (e.g. live position P&L); repaints. */
  public setLeftLabel(text: string): void {
    this._opts.leftLabel = text;
    this._host?.requestUpdate();
  }

  /**
   * Restyle in place; repaints. `id` is the hit-test handle the chart routes
   * clicks and drags through, so it is not patchable — swapping it under a
   * live drag would strand the gesture.
   *
   * A last-price line is the case this exists for: it has to follow the tick
   * direction, and only `setPrice` was updatable, so the colour was stuck at
   * whatever it was constructed with.
   */
  public setOptions(patch: Partial<Omit<PriceLineOptions, 'id'>>): void {
    this._opts = { ...this._opts, ...patch };
    this._host?.requestUpdate();
  }

  /**
   * Show a dimmed reference line at the pre-drag price while the user drags
   * (pass the original price on drag start, null on drag end to clear).
   */
  public setDragGhost(price: number | null): void {
    this._ghostPrice = price;
    this._host?.requestUpdate();
  }

  public options(): Readonly<PriceLineOptions> {
    return this._opts;
  }

  public zOrder(): ZOrder {
    return 'normal';
  }

  public autoscaleInfo(): { min: number; max: number } | null {
    if (this._opts.autoscale === false) return null;
    return { min: this._opts.price, max: this._opts.price };
  }

  public draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext): void {
    this._group = null;
    const y = Math.round(rc.priceScale.priceToY(this._opts.price) * rc.dpr) + 0.5;
    if (y < 0 || y > rc.plotHeight * rc.dpr) return;
    const dpr = rc.dpr;
    const lineWidth = this._opts.lineWidth ?? 1;
    const xEnd = Math.round(rc.plotWidth * dpr);
    const extent = fraction(this._opts.extentFromRight, 1);
    const xStart = Math.round(rc.plotWidth * (1 - extent) * dpr);
    const pillInset = fraction(this._opts.pillInsetFromRight, extent);
    const xPill = Math.round(rc.plotWidth * (1 - pillInset) * dpr);
    const color = this._opts.color;
    // Hover/dragging visual states apply to interactive lines only (draggable
    // or cancellable); plain level lines stay static under the pointer.
    const customSegmentHovered = this._opts.pillSegments?.some((segment) => segment.id === rc.hoverId) === true;
    const interactive = this._opts.cursor !== undefined || this._opts.closeButton === true
      || this._opts.pillSegments?.some((segment) => segment.id !== undefined) === true;
    const dragging = rc.dragId === this._opts.id;
    const hovered = interactive && !dragging && (rc.hoverId === this._opts.id
      || rc.hoverId === `${this._opts.id}::close` || customSegmentHovered);
    const closeHovered = rc.hoverId === `${this._opts.id}::close`;

    ctx.save();

    // drag ghost: dimmed line at the pre-drag price (revert reference)
    if (this._ghostPrice !== null && dragging) {
      const gy = Math.round(rc.priceScale.priceToY(this._ghostPrice) * dpr) + 0.5;
      if (gy >= 0 && gy <= rc.plotHeight * dpr) {
        ctx.strokeStyle = withAlpha(color, 0.35);
        ctx.lineWidth = Math.max(1, Math.round(dpr));
        ctx.setLineDash([2 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.moveTo(xStart, gy);
        ctx.lineTo(xEnd, gy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // soft emphasis halo while dragging (no shadowBlur — cheap wide stroke)
    if (dragging) {
      ctx.strokeStyle = withAlpha(color, 0.18);
      ctx.lineWidth = Math.max(5 * dpr, Math.round(lineWidth * dpr) + 4 * dpr);
      ctx.beginPath();
      ctx.moveTo(xStart, y);
      ctx.lineTo(xEnd, y);
      ctx.stroke();
    }

    ctx.strokeStyle = hovered || dragging ? shade(color, 0.1) : color;
    const baseW = Math.max(1, Math.round(lineWidth * dpr));
    ctx.lineWidth = hovered || dragging ? baseW + Math.round(dpr) : baseW;
    // `lineStyle` wins over `dashed`, which stays the fallback so a line built
    // before the style existed still draws exactly as it did.
    ctx.setLineDash(dashPattern(this._opts.lineStyle ?? (this._opts.dashed === true ? 'dashed' : 'solid'), dpr));
    ctx.beginPath();
    ctx.moveTo(xStart, y);
    ctx.lineTo(xEnd, y);
    ctx.stroke();
    ctx.setLineDash([]);

    const touch = typeof rc.touchTargets === 'number' ? rc.touchTargets
      : rc.touchTargets === true ? TOUCH_SCALE : 1;
    ctx.font = `500 ${Math.round(11 * touch) * dpr}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const boxH = Math.round(TAG_H * touch) * dpr;
    const padX = Math.round(6 * touch) * dpr;
    const r = Math.round(3 * touch) * dpr;

    // right-axis price tag (kept rectangular like the axis/crosshair tags)
    const axisFill = dragging || hovered ? shade(color, 0.12) : color;
    const label = this._opts.label ?? rc.priceScale.format(this._opts.price);
    ctx.fillStyle = axisFill;
    ctx.fillRect(xEnd + 1, y - boxH / 2, ctx.measureText(label).width + padX * 2, boxH);
    ctx.fillStyle = contrastText(color);
    ctx.fillText(label, xEnd + 1 + padX, y);

    // segmented pill group on the line: [badge][qty][label][✕]
    const hasGroup = this._opts.pillSegments !== undefined || this._opts.badge !== undefined || this._opts.qty !== undefined ||
      (this._opts.leftLabel !== undefined && this._opts.leftLabel !== '') ||
      (this._opts.note !== undefined && this._opts.note !== '') || this._opts.closeButton === true;
    if (hasGroup) {
      // neutral "surface" segments: opaque so the line doesn't run through text
      const transparentBg = rc.theme.background === 'transparent';
      const surface = transparentBg ? withAlpha(color, 0.14) : rc.theme.background;
      const surfaceText = transparentBg ? rc.theme.axisText : contrastText(rc.theme.background);
      const border = withAlpha(rc.theme.axisText, hovered || dragging ? 0.75 : 0.5);
      const segments: PillSegment[] = [];
      if (this._opts.pillSegments !== undefined) {
        for (const segment of this._opts.pillSegments) {
          const segmentHovered = segment.id !== undefined && rc.hoverId === segment.id;
          const fill = segment.fill ?? surface;
          segments.push({
            id: segment.id,
            text: segment.text,
            close: segment.close,
            fill: segmentHovered ? shade(fill, 0.12) : fill,
            textColor: segment.textColor ?? (segment.fill === undefined ? surfaceText : contrastText(fill)),
            border: segment.border ?? (segmentHovered ? withAlpha(rc.theme.axisText, 0.85) : border),
            minWidth: segment.minWidth,
          });
        }
      } else if (this._opts.badge !== undefined) {
        segments.push({
          text: this._opts.badge,
          fill: dragging ? shade(color, 0.2) : hovered ? shade(color, 0.12) : color,
          textColor: contrastText(color),
          border: shade(color, -0.25),
        });
      }
      if (this._opts.pillSegments === undefined && this._opts.qty !== undefined) {
        segments.push({ text: String(this._opts.qty), fill: surface, textColor: surfaceText, border });
      }
      if (this._opts.pillSegments === undefined && this._opts.leftLabel !== undefined && this._opts.leftLabel !== '') {
        segments.push({ text: this._opts.leftLabel, fill: surface, textColor: surfaceText, border });
      }
      if (this._opts.pillSegments === undefined && this._opts.note !== undefined && this._opts.note !== '') {
        segments.push({ text: this._opts.note, fill: surface, textColor: surfaceText, border });
      }
      if (this._opts.pillSegments === undefined && this._opts.closeButton === true) {
        segments.push({
          close: true,
          fill: closeHovered ? color : surface,
          textColor: closeHovered ? contrastText(color) : surfaceText,
          border: closeHovered ? color : border,
        });
      }
      // A pill flush against the left edge gets a small margin; one that starts
      // further in already has the plot to its left and needs none.
      this._group = drawPillGroup(ctx, xPill + (pillInset === 1 ? 6 * dpr : 0), y, segments, {
        height: boxH,
        padX,
        radius: r,
        gap: GAP * dpr,
        backplate: transparentBg ? undefined : rc.theme.background,
        // ALWAYS clamped to the plot. This used to apply only to custom
        // segment groups, so the default working-order pill —
        // [SIDE][qty][TYPE][×] — ran straight over the price axis on a narrow
        // screen: the ✕ landed on the scale, where the axis owns the gesture,
        // and the order could not be cancelled from the chart at all. A pill
        // that cannot be reached is worse than one that is cramped.
        maxX: xEnd - 4 * dpr,
        dpr,
      });
    }
    ctx.restore();
  }

  public hitTest(x: number, y: number, rc: PrimitiveRenderContext): PrimitiveHit | null {
    if (x < 0 || x > rc.plotWidth) return null;
    const lineY = rc.priceScale.priceToY(this._opts.price);
    const distance = Math.abs(y - lineY);
    // Inside the pill group (segment boxes are taller than the 4px line zone):
    // the ✕ segment routes as a click, the rest of the group drags the line.
    const g = this._group;
    if (g !== null && distance <= PILL_HIT_H / 2 && x >= g.x0 && x <= g.x1) {
      const segment = g.segments.find((candidate) => x >= candidate.x0 && x <= candidate.x1);
      if (segment !== undefined) {
        return { externalId: segment.id, zOrder: 'normal', distance, cursor: 'pointer' };
      }
      if (this._opts.closeButton && x >= g.closeX0) {
        return { externalId: `${this._opts.id}::close`, zOrder: 'normal', distance, cursor: 'pointer' };
      }
      return { externalId: this._opts.id, zOrder: 'normal', distance, cursor: this._opts.cursor };
    }
    if (distance > 4) return null;
    return { externalId: this._opts.id, zOrder: 'normal', distance, cursor: this._opts.cursor };
  }
}
