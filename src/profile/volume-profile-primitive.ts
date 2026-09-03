/**
 * Volume Profile renderer (ARCHITECTURE.md §8, §6A). Draws the output of
 * `computeVolumeProfileSessions` as a horizontal volume histogram per session,
 * anchored at the session's left or right edge. Display modes: `total` (one bar),
 * `buySell` (buy vs sell split), and `delta` (net, colored by sign). POC and
 * Value Area are drawn as lines with labels, with an optional value-area fill and
 * dimming of rows outside the value area. A pane primitive that overlays the
 * price range (its `autoscaleInfo` reports its extent so a profile-only chart
 * still frames correctly).
 */
import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext, ZOrder } from 'openalgo-charts';
import type { VolumeProfileFamilyResult, VolumeProfileSessionResult } from './volume-profile-family';

export type VolumeDisplayMode = 'total' | 'buySell' | 'delta';
export type VolumeProfileSide = 'left' | 'right';
/**
 * What the bars grow out of.
 *
 * `session` measures from the session's own edge on the TIME axis, so the
 * profile travels with its bars: pan, and it moves. That is what a session or
 * fixed-range profile wants, and it stays the default.
 *
 * `pane` measures from the pane's edge in PIXELS, ignoring time entirely, so
 * the profile sits flush against the price axis and holds still. That is what a
 * visible-range profile wants — its "session" is the viewport, and anchoring it
 * to the last bar leaves a gap wherever the chart carries a right-hand offset.
 */
export type VolumeProfileAnchor = 'session' | 'pane';

export interface VolumeProfilePrimitiveOptions {
  displayMode: VolumeDisplayMode;
  /** Which edge the bars grow out of — see `anchorTo` for WHICH edge that is. */
  side: VolumeProfileSide;
  /** Measure `side` from the session's time span (default) or the pane. */
  anchorTo: VolumeProfileAnchor;
  /** Maximum bar length in media px. */
  width: number;
  opacity: number;
  barColor: string;
  buyColor: string;
  sellColor: string;
  showPoc: boolean;
  pocColor: string;
  showPocLabel: boolean;
  showValueArea: boolean;
  vahColor: string;
  valColor: string;
  showValueAreaLabels: boolean;
  highlightValueArea: boolean;
  valueAreaFillColor: string;
  valueAreaFillOpacity: number;
  /** Opacity multiplier for rows outside the value area (1 = no dimming). */
  valueAreaOpacityDim: number;
  /** Show a price label at the session edge for the POC/value area. */
  labelSide: VolumeProfileSide;
  zOrder: ZOrder;
}

export const DEFAULT_VOLUME_PROFILE_PRIMITIVE_OPTIONS: VolumeProfilePrimitiveOptions = {
  displayMode: 'total',
  side: 'right',
  anchorTo: 'session',
  width: 90,
  opacity: 0.85,
  barColor: '#3b5168',
  buyColor: '#26a69a',
  sellColor: '#ef5350',
  showPoc: true,
  pocColor: '#f0a020',
  showPocLabel: true,
  showValueArea: true,
  vahColor: '#8892a6',
  valColor: '#8892a6',
  showValueAreaLabels: true,
  highlightValueArea: true,
  valueAreaFillColor: '#4a6fa5',
  valueAreaFillOpacity: 0.08,
  valueAreaOpacityDim: 0.4,
  labelSide: 'right',
  zOrder: 'bottom',
};

interface Segment { color: string; len: number; }

export class VolumeProfile implements IPrimitive {
  private _result: VolumeProfileFamilyResult | null;
  private _opts: VolumeProfilePrimitiveOptions;
  private _host: PrimitiveHost | null = null;

  public constructor(result: VolumeProfileFamilyResult | null = null, opts: Partial<VolumeProfilePrimitiveOptions> = {}) {
    this._result = result;
    this._opts = { ...DEFAULT_VOLUME_PROFILE_PRIMITIVE_OPTIONS, ...opts };
  }

  public attached(host: PrimitiveHost): void { this._host = host; }
  public detached(): void { this._host = null; }
  public zOrder(): ZOrder { return this._opts.zOrder; }

  public autoscaleInfo(): { min: number; max: number } | null {
    if (this._result === null) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const s of this._result.sessions) {
      if (s.levels.length === 0) continue;
      max = Math.max(max, s.levels[0].price);
      min = Math.min(min, s.levels[s.levels.length - 1].price);
    }
    return Number.isFinite(min) ? { min, max } : null;
  }

  public setData(result: VolumeProfileFamilyResult): void {
    this._result = result;
    this._host?.requestUpdate();
  }

  public setOptions(patch: Partial<VolumeProfilePrimitiveOptions>): void {
    this._opts = { ...this._opts, ...patch };
    this._host?.requestUpdate();
  }

  public draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext): void {
    if (this._result === null || this._result.sessions.length === 0) return;
    const tick = this._result.options.tickSize;
    for (const s of this._result.sessions) this._drawSession(ctx, rc, s, tick);
  }

  private _segments(l: VolumeProfileSessionResult['levels'][number], maxMetric: number, widthDev: number): Segment[] {
    const o = this._opts;
    if (o.displayMode === 'delta') {
      const len = (Math.abs(l.delta) / maxMetric) * widthDev;
      return [{ color: l.delta >= 0 ? o.buyColor : o.sellColor, len }];
    }
    const len = (l.volume / maxMetric) * widthDev;
    if (o.displayMode === 'buySell' && l.volume > 0) {
      const buyLen = len * (l.buyVolume / l.volume);
      return [{ color: o.buyColor, len: buyLen }, { color: o.sellColor, len: len - buyLen }];
    }
    return [{ color: o.barColor, len }];
  }

  private _drawSession(
    ctx: CanvasRenderingContext2D,
    rc: PrimitiveRenderContext,
    s: VolumeProfileSessionResult,
    tick: number,
  ): void {
    const o = this._opts;
    const dpr = rc.dpr;
    const i0 = rc.dataLayer.timeToIndex(s.startTime);
    const i1 = rc.dataLayer.timeToIndex(s.endTime);
    if (i0 === undefined || i1 === undefined) return;
    const x0 = Math.round(rc.timeScale.indexToX(i0) * dpr);
    const x1 = Math.max(x0 + 1, Math.round(rc.timeScale.indexToX(i1) * dpr));
    const yOf = (p: number): number => rc.priceScale.priceToY(p) * dpr;
    const rowH = Math.max(1, Math.abs(rc.priceScale.priceToY(s.poc) - rc.priceScale.priceToY(s.poc + tick)) * dpr);
    const widthDev = o.width * dpr;
    // The baseline the bars grow out of, and the tip they grow towards. With
    // `anchorTo: 'pane'` the baseline is the pane's own edge in device px, so
    // the band ignores where the session's bars happen to fall and stays put
    // under a pan — the price axis starts at `plotWidth`, so that IS the right
    // edge of the drawable area and nothing is clipped by or drawn over it.
    const right = o.side === 'right';
    const pane = o.anchorTo === 'pane';
    const base = pane ? (right ? rc.plotWidth * dpr : 0) : right ? x1 : x0;
    const tip = right ? base - widthDev : base + widthDev;
    const bandLeft = Math.min(base, tip);

    let maxMetric = 0;
    for (const l of s.levels) {
      const m = o.displayMode === 'delta' ? Math.abs(l.delta) : l.volume;
      if (m > maxMetric) maxMetric = m;
    }
    if (maxMetric <= 0) maxMetric = 1;

    ctx.save();

    // value-area highlight fill
    if (o.highlightValueArea) {
      const yTop = yOf(s.vah) - rowH / 2;
      const yBot = yOf(s.val) + rowH / 2;
      const fx = bandLeft;
      ctx.globalAlpha = o.valueAreaFillOpacity;
      ctx.fillStyle = o.valueAreaFillColor;
      ctx.fillRect(fx, yTop, widthDev, yBot - yTop);
      ctx.globalAlpha = 1;
    }

    // bars
    for (const l of s.levels) {
      const inVa = l.price <= s.vah && l.price >= s.val;
      const alpha = o.opacity * (inVa ? 1 : o.valueAreaOpacityDim);
      const y = yOf(l.price);
      const top = y - rowH / 2;
      const h = Math.max(1, rowH - 1);
      let cursor = base;
      ctx.globalAlpha = alpha;
      for (const seg of this._segments(l, maxMetric, widthDev)) {
        if (seg.len <= 0) continue;
        const x = right ? cursor - seg.len : cursor;
        ctx.fillStyle = seg.color;
        ctx.fillRect(x, top, seg.len, h);
        cursor = right ? cursor - seg.len : cursor + seg.len;
      }
    }
    ctx.globalAlpha = 1;

    // POC / VAH / VAL lines + labels across the session. None of this depends
    // on price, so it is computed once here rather than per line.
    //
    // A pane-anchored band can sit outside the session's own time span, so the
    // line is stretched to reach it: a POC line that stops short of the row it
    // marks reads as a different level. And `labelSide` is meaningless under a
    // pane anchor — one side of the band IS the price axis — so the label hangs
    // off the bars' tip, the only side with room. Session anchoring keeps
    // honouring the option, unchanged.
    const lineFrom = pane ? Math.min(x0, bandLeft) : x0;
    const lineTo = pane ? Math.max(x1, bandLeft + widthDev) : x1;
    const labelAlign = (pane ? right : o.labelSide !== 'right') ? 'right' : 'left';
    const pad = 3 * dpr;
    const labelX = pane
      ? (right ? tip - pad : tip + pad)
      : (o.labelSide === 'right' ? x1 + pad : x0 - pad);
    const hline = (price: number, color: string, label: string): void => {
      const y = Math.round(yOf(price)) + 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, Math.round(dpr));
      ctx.beginPath();
      ctx.moveTo(lineFrom, y);
      ctx.lineTo(lineTo, y);
      ctx.stroke();
      if (label !== '') {
        ctx.font = `${9 * dpr}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.textAlign = labelAlign;
        ctx.fillText(label, labelX, y);
      }
    };
    if (o.showValueArea) {
      hline(s.vah, o.vahColor, o.showValueAreaLabels ? `VAH ${rc.priceScale.format(s.vah)}` : '');
      hline(s.val, o.valColor, o.showValueAreaLabels ? `VAL ${rc.priceScale.format(s.val)}` : '');
    }
    if (o.showPoc) hline(s.poc, o.pocColor, o.showPocLabel ? `POC ${rc.priceScale.format(s.poc)}` : '');

    ctx.restore();
  }
}
