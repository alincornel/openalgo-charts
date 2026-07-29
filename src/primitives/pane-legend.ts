/**
 * Pane legend (ARCHITECTURE.md §8) — the row at the top-left
 * of a pane: a color swatch, the source's name, its parameters, the value under
 * the crosshair, and inline action buttons on the right.
 *
 * Drawn on the canvas rather than in the DOM, like `BuySellButtons` and
 * `DomLadder`, so it composites into screenshots and costs no DOM per pane.
 * Buttons hit-test as `${id}::close`, `${id}::hide`, and `${id}::settings`, so
 * the host routes them through the same `subscribeClick` path as order pills.
 *
 * Rows stack: several legends on one pane offset each other vertically, which
 * the host does by giving each a `row` index.
 */
import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext, PrimitiveHit, ZOrder } from './primitive';
import { withAlpha } from '../render/pill';

export type PaneLegendAction = 'hide' | 'settings' | 'up' | 'down' | 'maximize' | 'close';

/**
 * One reading on a legend row. Multi-plot sources show one per plot, each in
 * that plot's own color (an MA ribbon's four averages, MACD's three lines) —
 * a single string in a single color cannot say which number is which.
 */
export interface LegendValue {
  /** Dimmed prefix, e.g. `O` / `H` / `Vol`. */
  label?: string;
  text: string;
  /** Defaults to the row's `valueColor`, then `color`, then the theme text. */
  color?: string;
}

export interface PaneLegendOptions {
  /** Stable id; buttons hit-test as `${id}::close` etc. */
  id: string;
  /** Bold source name, e.g. `RSI`. */
  title: string;
  /** Dimmed parameter summary after the title, e.g. `14 close`. */
  params?: string;
  /** Swatch color; omitted draws no swatch. */
  color?: string;
  /**
   * Color for the live value. Defaults to `color`, then the theme's text — so a
   * row can tint its reading (an up/down change) without being forced to show a
   * swatch in that same color.
   */
  valueColor?: string;
  /** Vertical slot on the pane (0 = topmost). */
  row?: number;
  /**
   * Which inline action buttons to draw, left to right. Each hit-tests as
   * `${id}::<action>`:
   *  - `up` / `down` — move this pane one slot (`::up` / `::down`)
   *  - `hide`        — toggle visibility (`::hide`)
   *  - `maximize`    — expand this pane to fill the chart (`::maximize`)
   *  - `close`       — remove the source, and its pane if it empties (`::close`)
   *
   * Defaults to `['up', 'down', 'hide', 'maximize', 'close']` for pane sources
   * and `['hide', 'close']` for overlays (pass explicitly to override).
   */
  actions?: readonly PaneLegendAction[];
  /** Rendered as hidden (dimmed, eye hollow). */
  hidden?: boolean;
  /** Rendered as maximized (the maximize glyph becomes restore). */
  maximized?: boolean;
  /** Text size in media px. Default 11. */
  font?: number;
  /** Left inset from the plot edge in media px. Default 8. */
  left?: number;
  /** Top inset in media px. Default 6. */
  top?: number;
}

const ROW_H = 18;
const GAP = 6;
const BTN = 16;
/** Extra hover width past the text, so the controls can appear without a gap. */
const REVEAL_PAD = 130;

/**
 * Per-source actions, mirroring the indicator legend toolbar: show/hide,
 * settings, delete. Pane-level actions (`up`/`down`/`maximize`) are added by the
 * host to the *first* legend on a pane, so extra rows stay uncluttered.
 */
const DEFAULT_ACTIONS: readonly PaneLegendAction[] = ['hide', 'settings', 'close'];

/**
 * Action icons as vector strokes rather than text glyphs — `⛶`, `🗑`, and the
 * arrows render inconsistently (or as emoji) across platforms and font stacks,
 * and a stroked path stays crisp at any DPR.
 */
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  action: PaneLegendAction,
  cx: number,
  cy: number,
  font: number,
  dpr: number,
  o: PaneLegendOptions,
): void {
  const r = font * 0.42;                 // half-extent of the icon box
  const w = Math.max(1, Math.round(1.4 * dpr));
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (action) {
    case 'up':
      ctx.moveTo(cx, cy + r); ctx.lineTo(cx, cy - r);
      ctx.moveTo(cx - r * 0.62, cy - r * 0.35); ctx.lineTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.62, cy - r * 0.35);
      break;
    case 'down':
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
      ctx.moveTo(cx - r * 0.62, cy + r * 0.35); ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx + r * 0.62, cy + r * 0.35);
      break;
    case 'hide': {
      // Eye: two arcs forming a lens, with a pupil. Hidden state strikes it through.
      ctx.moveTo(cx - r, cy);
      ctx.quadraticCurveTo(cx, cy - r * 1.15, cx + r, cy);
      ctx.quadraticCurveTo(cx, cy + r * 1.15, cx - r, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
      if (o.hidden === true) {
        ctx.moveTo(cx - r, cy + r * 0.85); ctx.lineTo(cx + r, cy - r * 0.85);
      }
      break;
    }
    case 'maximize':
      if (o.maximized === true) {
        // restore: inward corner brackets
        ctx.moveTo(cx - r, cy - r * 0.25); ctx.lineTo(cx - r * 0.25, cy - r * 0.25); ctx.lineTo(cx - r * 0.25, cy - r);
        ctx.moveTo(cx + r, cy + r * 0.25); ctx.lineTo(cx + r * 0.25, cy + r * 0.25); ctx.lineTo(cx + r * 0.25, cy + r);
      } else {
        // maximize: four outward corner brackets
        ctx.moveTo(cx - r, cy - r * 0.4); ctx.lineTo(cx - r, cy - r); ctx.lineTo(cx - r * 0.4, cy - r);
        ctx.moveTo(cx + r * 0.4, cy - r); ctx.lineTo(cx + r, cy - r); ctx.lineTo(cx + r, cy - r * 0.4);
        ctx.moveTo(cx + r, cy + r * 0.4); ctx.lineTo(cx + r, cy + r); ctx.lineTo(cx + r * 0.4, cy + r);
        ctx.moveTo(cx - r * 0.4, cy + r); ctx.lineTo(cx - r, cy + r); ctx.lineTo(cx - r, cy + r * 0.4);
      }
      break;
    case 'settings': {
      // Gear: a ring plus eight short teeth.
      ctx.arc(cx, cy, r * 0.46, 0, Math.PI * 2);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        ctx.moveTo(cx + dx * r * 0.68, cy + dy * r * 0.68);
        ctx.lineTo(cx + dx * r, cy + dy * r);
      }
      break;
    }
    case 'close':
      // Trash: lid, can, and two tick marks.
      ctx.moveTo(cx - r * 0.8, cy - r * 0.55); ctx.lineTo(cx + r * 0.8, cy - r * 0.55);
      ctx.moveTo(cx - r * 0.3, cy - r * 0.55); ctx.lineTo(cx - r * 0.3, cy - r * 0.85);
      ctx.lineTo(cx + r * 0.3, cy - r * 0.85); ctx.lineTo(cx + r * 0.3, cy - r * 0.55);
      ctx.moveTo(cx - r * 0.6, cy - r * 0.55); ctx.lineTo(cx - r * 0.45, cy + r * 0.85);
      ctx.lineTo(cx + r * 0.45, cy + r * 0.85); ctx.lineTo(cx + r * 0.6, cy - r * 0.55);
      break;
  }
  ctx.stroke();
  ctx.restore();
}

export class PaneLegend implements IPrimitive {
  private _opts: Required<Pick<PaneLegendOptions, 'id' | 'title'>> & PaneLegendOptions;
  private _host: PrimitiveHost | null = null;
  private _values: LegendValue[] = [];
  /** Button geometry from the last draw, in media px, for hit-testing. */
  private _buttons: { id: string; x: number; y: number }[] = [];
  /** Right edge of the drawn row, in media px. */
  private _width = 0;

  public constructor(opts: PaneLegendOptions) {
    this._opts = { font: 11, left: 8, top: 6, row: 0, ...opts };
  }

  public attached(host: PrimitiveHost): void { this._host = host; }
  public detached(): void { this._host = null; }
  public zOrder(): ZOrder { return 'top'; }
  public autoscaleInfo(): null { return null; }

  /** A single live reading after the params (typically crosshair-driven). */
  public setValue(text: string, color?: string): void {
    this.setValues(text === '' ? [] : [{ text, color }]);
  }

  /** One reading per plot, each in its own color. */
  public setValues(values: readonly LegendValue[]): void {
    const same = values.length === this._values.length
      && values.every((v, i) => v.text === this._values[i].text
        && v.label === this._values[i].label && v.color === this._values[i].color);
    if (same) return;
    this._values = values.map((v) => ({ ...v }));
    this._host?.requestUpdate();
  }

  public setOptions(patch: Partial<PaneLegendOptions>): void {
    this._opts = { ...this._opts, ...patch };
    this._host?.requestUpdate();
  }

  public options(): PaneLegendOptions {
    return this._opts;
  }

  public draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext): void {
    const o = this._opts;
    const dpr = rc.dpr;
    const f = (o.font ?? 11) * dpr;
    const y = ((o.top ?? 6) + (o.row ?? 0) * ROW_H) * dpr;
    const cy = y + (ROW_H * dpr) / 2;
    let x = (o.left ?? 8) * dpr;
    const dim = o.hidden === true;

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.globalAlpha = dim ? 0.45 : 1;

    // swatch
    if (o.color !== undefined) {
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.arc(x + 3 * dpr, cy, 3 * dpr, 0, Math.PI * 2);
      ctx.fill();
      x += 11 * dpr;
    }

    ctx.font = `600 ${f}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = rc.theme.axisText;
    ctx.fillText(o.title, x, cy);
    x += ctx.measureText(o.title).width + GAP * dpr;

    ctx.font = `${f}px ui-sans-serif, system-ui, sans-serif`;
    if (o.params !== undefined && o.params !== '') {
      ctx.fillStyle = withAlpha(rc.theme.axisText, 0.55);
      ctx.fillText(o.params, x, cy);
      x += ctx.measureText(o.params).width + GAP * dpr;
    }
    // Readings: one per plot, each in its plot's color, with a dimmed label.
    for (const v of this._values) {
      if (v.label !== undefined && v.label !== '') {
        ctx.fillStyle = withAlpha(rc.theme.axisText, 0.55);
        ctx.fillText(v.label, x, cy);
        x += ctx.measureText(v.label).width + 3 * dpr;
      }
      ctx.fillStyle = v.color ?? o.valueColor ?? o.color ?? rc.theme.axisText;
      ctx.fillText(v.text, x, cy);
      x += ctx.measureText(v.text).width + GAP * dpr;
    }

    // Actions appear on hover only, so a row of legends reads as clean text
    // until you approach one. The row itself hit-tests (as `::row`), which is
    // what makes the pointer "arrive" and reveal them.
    this._buttons = [];
    const active = typeof rc.hoverId === 'string' && rc.hoverId.startsWith(`${o.id}::`);
    const actions = o.actions ?? DEFAULT_ACTIONS;
    if (active && actions.length > 0) {
      // Soft plate behind the controls, so glyphs stay legible over candles.
      const plateW = (actions.length * (BTN + 2) + 6) * dpr;
      ctx.globalAlpha = 1;
      ctx.fillStyle = withAlpha(rc.theme.background, 0.82);
      ctx.beginPath();
      ctx.roundRect(x - 3 * dpr, cy - (ROW_H / 2) * dpr, plateW, ROW_H * dpr, 5 * dpr);
      ctx.fill();
      x += 2 * dpr;
      for (const action of actions) {
        const id = `${o.id}::${action}`;
        const bx = x;
        this._buttons.push({ id, x: bx / dpr, y: y / dpr });
        const hovered = rc.hoverId === id;
        if (hovered) {
          ctx.fillStyle = withAlpha(rc.theme.axisText, 0.16);
          ctx.beginPath();
          ctx.roundRect(bx, cy - (BTN / 2) * dpr, BTN * dpr, BTN * dpr, 4 * dpr);
          ctx.fill();
        }
        ctx.globalAlpha = dim ? 0.5 : hovered ? 1 : 0.75;
        ctx.fillStyle = action === 'close' && hovered ? '#ff6b6b' : rc.theme.axisText;
        drawGlyph(ctx, action, bx + (BTN / 2) * dpr, cy, f, dpr, o);
        ctx.globalAlpha = 1;
        x += (BTN + 2) * dpr;
      }
    }

    this._width = x / dpr;
    ctx.restore();
  }

  public hitTest(x: number, y: number): PrimitiveHit | null {
    const o = this._opts;
    const top = (o.top ?? 6) + (o.row ?? 0) * ROW_H;
    if (y < top || y > top + ROW_H) return null;
    for (const b of this._buttons) {
      if (x >= b.x && x <= b.x + BTN) {
        return { externalId: b.id, zOrder: 'top', distance: 0, cursor: 'pointer' };
      }
    }
    // The row itself: reveals the controls and swallows the click so it never
    // reaches the host's click handler as a phantom id.
    const right = Math.max(this._width, (o.left ?? 8) + 40) + REVEAL_PAD;
    if (x >= (o.left ?? 8) - 4 && x <= right) {
      return { externalId: `${o.id}::row`, zOrder: 'top', distance: 0, cursor: 'default' };
    }
    return null;
  }
}
