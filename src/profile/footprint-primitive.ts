/**
 * Footprint / order-flow renderer (ARCHITECTURE.md §6A, Family C).
 *
 * Each bar is a column of price rows; each row shows bid volume against ask
 * volume as two filled cells whose colour intensity tracks their share of the
 * bar's peak. Diagonal imbalances fill saturated rather than getting an outline
 * — at the sizes a footprint actually renders, a 1px box is invisible while a
 * colour step reads instantly. Runs of stacked imbalances get a bracket.
 *
 * Beneath the cells sits a stats table: one column per bar, one row per metric
 * (volume, delta, delta %, cumulative delta, trade count), each cell tinted by
 * sign and strength.
 *
 * Everything is theme-driven and reconfigurable at runtime via `setOptions` —
 * the previous version hardcoded twelve colours and could only be restyled by
 * rebuilding the chart.
 */
import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext, PrimitiveHit, ZOrder } from 'openalgo-charts';
import type { Bar } from '../model/bar';
import type { FootprintBar, FootprintCell } from './profile-model';
import { bucketPrice, priceBuckets } from './profile-model';
import { parseColor, withAlpha } from '../render/pill';

/** Which metric a stats row shows. */
export type FootprintStatRow = 'volume' | 'delta' | 'deltaPct' | 'cvd' | 'trades';

export type FootprintDisplayMode = 'bidask' | 'delta' | 'volume';

/** What the two halves of a `bidask` row carry. */
export type FootprintCellMode = 'bidAsk' | 'deltaVolume';

/** What sets a row's background colour. */
export type FootprintColorMode = 'imbalance' | 'delta';

export interface FootprintOptions {
  /**
   * Full column width (both halves) in media px. Omit to derive it from the
   * chart's bar spacing, so cells stop colliding when you zoom out.
   */
  cellWidth?: number;
  /** Fraction of the bar slot a column may occupy when auto-sizing. Default 0.9. */
  widthFactor: number;
  /**
   * Price step → row height. Inferred from the cell spacing when omitted.
   *
   * With `zeroFill` this is also the grid the rows are filled onto, and it is a
   * precondition that it matches the step the cells were **aggregated** at. Set
   * it coarser and several cells land on one row; they are summed rather than
   * dropped, but the ladder then disagrees with `stats()` about where the
   * volume sat.
   */
  tickSize?: number;
  /** Cell text size in media px. Default 10. */
  font: number;
  /** Below this row height, numbers are dropped and cells render as a heatmap. */
  minTextHeight: number;
  /** Height (px) over which the cell numbers fade in around `minTextHeight`. */
  textFade: number;
  /** `bidask` two columns; `delta` or `volume` a single column. */
  displayMode: FootprintDisplayMode;
  /**
   * Which numbers a two-column row shows. `bidAsk` is bid against ask.
   * `deltaVolume` is the row's own delta on the left (signed, in the sell
   * colour when negative) against its total volume on the right, which is how
   * the desktop order-flow terminals read a ladder. Ignored unless
   * `displayMode` is `bidask`.
   */
  cells: FootprintCellMode;
  /**
   * What colours a row. `imbalance` grades each half against the bar's peak
   * one-sided volume and saturates the diagonal imbalances. `delta` gives the
   * whole row one colour, the sign of its own delta, at an alpha set by how
   * much of the bar's busiest row it carries, and drops the saturated
   * highlight: the ladder then reads as a heat map of who won each price.
   */
  colorBy: FootprintColorMode;
  /** Diagonal-imbalance ratio. */
  imbalanceRatio: number;
  /** Ignore cells below this volume when flagging imbalances. */
  imbalanceThreshold: number;
  /** Bracket runs of ≥ N consecutive same-side imbalances. 0 disables. */
  stackedImbalances: number;
  /** Stats rows under the columns, in order. Empty hides the table. */
  statsRows: readonly FootprintStatRow[];
  /** Row height of the stats table in media px. */
  statsRowHeight: number;
  /**
   * Where the bar's candle goes. `'gutter'` reserves a strip on the left of the
   * bar slot and draws a real OHLC candle there, read from the pane's price
   * series, so the ladder is never painted over a body. `'behind'` is the older
   * delta-coloured range line drawn against the column. `'off'` draws neither,
   * for a host that leaves its own candlestick series visible.
   */
  candle: 'off' | 'behind' | 'gutter';
  /**
   * Fraction of the bar slot the gutter candle takes, clamped to 3..14 media
   * px. The body fills 60% of it, so a narrow slot still reads as a coloured
   * direction strip once the wick is down to a hairline.
   */
  candleWidthFactor: number;
  /** Mark the highest-volume row of each bar. */
  showPoc: boolean;
  /**
   * Outline the bar's highest-volume row in this colour. Off when unset: the
   * `showPoc` tick is a mark in the margin, this rings the row itself, and a
   * ladder wants at most one of the two shouting.
   *
   * The ring is one closed rectangle around the whole row, both halves, and
   * not a set of corner marks: the row is the unit the eye is being pointed
   * at, and a bracket reads as the edges of a range instead.
   */
  pocOutline?: string;
  /**
   * Weight of that ring in media px, so it holds on a retina pane. Default 1.
   * The rectangle is inset by half of it, so a fat ring stays inside its own
   * row rather than bleeding over the ones above and below, and it is capped
   * by the row's own height and width: a short row takes a thinner ring.
   */
  pocOutlineWidth: number;
  /**
   * Draw a row for every price between the bar's highest and lowest traded
   * level, including the ones nothing traded at (`0 x 0`). Off, the column is
   * a sparse ladder and whatever is painted behind it shows through the gaps.
   * Needs `tickSize`: without a row step there is no grid to fill.
   */
  zeroFill: boolean;
  /**
   * Bars needing more zero-filled rows than this fall back to their traded
   * rows. A gap bar, or a `tickSize` that does not match the instrument, would
   * otherwise ask for tens of thousands of rows on one frame.
   */
  maxZeroFillRows: number;
  /** Colours. All default to the chart theme. */
  buyColor?: string;
  sellColor?: string;
  pocColor: string;
  /**
   * Opaque plate a cell is tinted **from**, in place of the pane background.
   *
   * A ladder tinted off a dark pane spends its low end near black, so a
   * one-lot row is a hole the pane shows through. Given a plate (a light grey,
   * say) the same row is legible at zero intensity and the tint reads as
   * pressure rather than as presence. Unset, the pane background stays the
   * base and the ramp below is the legacy eased one.
   *
   * Opaque colours only: the ramp blends channels and drops alpha, so an
   * `rgba()` plate is painted at full opacity rather than letting the pane
   * show through it.
   */
  cellBaseColor?: string;
  /**
   * Where the plate ramp starts, 0 being the bare plate and 1 the raw colour.
   * Ignored while `cellBaseColor` is unset. Default 0.
   */
  tintFloor: number;
  /**
   * How much of the remaining distance to the colour a full-intensity cell
   * travels. Clamped with the floor to 1, so `0.5 + 1` still lands on the
   * colour rather than past it. Ignored while `cellBaseColor` is unset.
   * Default 1.
   */
  tintGain: number;
  /**
   * Shape of the plate ramp. `sqrt` eases it, lifting the quiet rows; `linear`
   * is proportional, which is how the desktop terminals grade a plate. Ignored
   * while `cellBaseColor` is unset.
   */
  tintCurve: 'linear' | 'sqrt';
  /**
   * Draw a horizontal histogram bar for each row in the strip beside the
   * ladder, its length the row's share of the bar's busiest row. Volume is
   * already in the cell numbers and in the tint, but neither is comparable
   * down a column at a glance, and a length is. Off by default: it draws
   * outside the column, so a host wants `widthFactor` (or `cellWidth`) to
   * leave it room first, and `widthFactor * (1 + volumeBarWidthFactor) <= 1`
   * is the arithmetic that keeps a full-volume bar inside its own bar slot.
   * A column is floored at 24 media px, so at that floor the slot has to be
   * wide enough for the bar on top of it.
   *
   * With `stackedImbalances` on, the bar starts past the bracket lane rather
   * than over it.
   */
  showVolumeBar: boolean;
  /**
   * Colour of that bar. Unset, each row takes its own direction, the buy
   * colour when its delta is positive and the sell colour when it is not.
   */
  volumeBarColor?: string;
  /**
   * Length of a full-volume bar as a fraction of the column width. Default
   * 0.5.
   */
  volumeBarWidthFactor: number;
  /**
   * Ink for the cell numbers. Unset, the renderer picks: white for a graded
   * cell, dimmed on a zero row, and near-black on a saturated one, which is
   * the right pair over a dark pane and the wrong one over a light plate. A
   * signed `deltaVolume` delta keeps its own colour ahead of this, since
   * there the colour is the number's meaning rather than its theme.
   */
  cellTextColor?: string;
  /** Ink for the numbers on a saturated (imbalanced) cell. */
  cellTextColorHot?: string;
  /** Cell corner radius in media px. */
  radius: number;
  /**
   * Called after a paint, and only when the values changed, with what
   * `layout()` would return. The push signal a host needs to re-derive its row
   * size when the pane resizes, which no data event announces.
   */
  onLayout?: (layout: { rowHeight: number; paneHeight: number; minTextHeight: number }) => void;
}

export const DEFAULT_FOOTPRINT_OPTIONS: FootprintOptions = {
  widthFactor: 0.9,
  font: 10,
  minTextHeight: 11,
  textFade: 4,
  displayMode: 'bidask',
  cells: 'bidAsk',
  colorBy: 'imbalance',
  imbalanceRatio: 3,
  imbalanceThreshold: 0,
  stackedImbalances: 3,
  statsRows: ['volume', 'delta', 'deltaPct', 'cvd'],
  statsRowHeight: 15,
  candle: 'behind',
  candleWidthFactor: 0.22,
  showPoc: true,
  pocOutlineWidth: 1,
  zeroFill: false,
  maxZeroFillRows: 400,
  pocColor: '#f0a020',
  tintFloor: 0,
  tintGain: 1,
  tintCurve: 'sqrt',
  showVolumeBar: false,
  volumeBarWidthFactor: 0.5,
  radius: 2,
};

/** Per-bar aggregates the stats table and the tooltip both read. */
export interface FootprintBarStats {
  time: number;
  volume: number;
  delta: number;
  deltaPct: number;
  cvd: number;
  trades: number;
  poc: number;
}

/** What the pointer is over, for a host-drawn tooltip. */
export interface FootprintHover {
  time: number;
  /** Null when the pointer is over the stats table rather than a cell. */
  price: number | null;
  cell: FootprintCell | null;
  stats: FootprintBarStats;
}

/** 3 significant figures with a K/M/B suffix — 4.53M, 47.1K, 128K, 3K. */
export function compactVol(v: number): string {
  const a = Math.abs(v);
  const [suffix, div] = a >= 1e9 ? ['B', 1e9] : a >= 1e6 ? ['M', 1e6] : a >= 1e3 ? ['K', 1e3] : ['', 1];
  const n = v / div;
  const abs = Math.abs(n);
  const s = abs >= 100 || div === 1 ? n.toFixed(0) : abs >= 10 ? n.toFixed(1) : n.toFixed(2);
  return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') + suffix;
}

const signed = (v: number): string => (v >= 0 ? '+' : '') + compactVol(v);

/** Blend two colours; `t` 0 → a, 1 → b. */
function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (ca === null || cb === null) return b;
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return `rgb(${Math.round(ca.r + (cb.r - ca.r) * k)},${Math.round(ca.g + (cb.g - ca.g) * k)},${Math.round(ca.b + (cb.b - ca.b) * k)})`;
}

interface Column {
  bar: FootprintBar;
  x: number;
  stats: FootprintBarStats;
}

export class Footprint implements IPrimitive {
  private _bars: FootprintBar[] = [];
  private _opts: FootprintOptions;
  private _host: PrimitiveHost | null = null;
  /** Per-bar aggregates, recomputed when the bars change (CVD needs order). */
  private _stats: FootprintBarStats[] = [];
  /** Column geometry from the last draw, in media px, for hit-testing. */
  private _cols: { time: number; x0: number; x1: number }[] = [];
  private _rowH = 0;
  /** Last context the primitive drew with; see `draw`. */
  private _rc: PrimitiveRenderContext | null = null;
  private _plotH = 0;
  /** What `onLayout` last saw, so an unchanged frame does not push again. */
  private _layoutKey = '';

  public constructor(opts: Partial<FootprintOptions> = {}) {
    this._opts = { ...DEFAULT_FOOTPRINT_OPTIONS, ...opts };
  }

  public attached(host: PrimitiveHost): void { this._host = host; }
  public detached(): void { this._host = null; }
  public zOrder(): ZOrder { return 'normal'; }

  /**
   * Footprint rows span the bar's traded range, so unlike the profile overlays
   * this one *does* drive autoscale — otherwise the top and bottom rows clip.
   */
  public autoscaleInfo(): { min: number; max: number } | null {
    let min = Infinity;
    let max = -Infinity;
    for (const b of this._bars) {
      if (b.cells.length === 0) continue;
      max = Math.max(max, b.cells[0].price);
      min = Math.min(min, b.cells[b.cells.length - 1].price);
    }
    return Number.isFinite(min) ? { min, max } : null;
  }

  public setBars(bars: FootprintBar[]): void {
    this._bars = bars;
    this._recomputeStats();
    this._host?.requestUpdate();
  }

  public setOptions(patch: Partial<FootprintOptions>): void {
    this._opts = { ...this._opts, ...patch };
    this._host?.requestUpdate();
  }

  public options(): FootprintOptions {
    return this._opts;
  }

  /** Per-bar aggregates, in bar order. */
  public stats(): readonly FootprintBarStats[] {
    return this._stats;
  }

  /**
   * Row and pane geometry from the last paint, in media px, plus the threshold
   * the numbers fade out under.
   *
   * This is the hook for a host that sizes its rows by LEGIBILITY rather than
   * by a fixed row count: `paneHeight / rowsPerBar` is the height a row would
   * get, and anything under `minTextHeight` renders as a heatmap however few
   * rows there are. A host that fetches its ladder at a chosen row size (a
   * `rowTicks` multiplier, say) can pick the finest one whose implied row
   * height still clears the threshold, instead of guessing a row count.
   *
   * `rowHeight` is the **clamped draw height** of the last column painted, not
   * the raw price step: `_rowHeight` floors it at 6 media px (and falls back to
   * 16 when there is no tick size to work from), so a row reported as 6 may be
   * a much finer grid drawn at the floor. Both numbers are 0 before the first
   * paint and while there are no bars or nothing on screen to draw.
   *
   * `onLayout` is the push half of the same fact, for a pane resize, which no
   * data event announces.
   */
  public layout(): { rowHeight: number; paneHeight: number; minTextHeight: number } {
    return { rowHeight: this._rowH, paneHeight: this._plotH, minTextHeight: this._opts.minTextHeight };
  }

  /** Hand the host the geometry, once per change rather than once per frame. */
  private _pushLayout(): void {
    const key = `${this._rowH}|${this._plotH}|${this._opts.minTextHeight}`;
    if (key === this._layoutKey) return;
    this._layoutKey = key;
    this._opts.onLayout?.(this.layout());
  }

  private _recomputeStats(): void {
    let cvd = 0;
    this._stats = this._bars.map((bar) => {
      let volume = 0;
      let trades = 0;
      let pocVol = -1;
      let poc = bar.cells.length > 0 ? bar.cells[0].price : 0;
      for (const c of bar.cells) {
        const total = c.bidVol + c.askVol;
        volume += total;
        trades += 1;
        if (total > pocVol) { pocVol = total; poc = c.price; }
      }
      cvd += bar.delta;
      return {
        time: bar.time,
        volume,
        delta: bar.delta,
        deltaPct: volume > 0 ? (bar.delta / volume) * 100 : 0,
        cvd,
        trades,
        poc,
      };
    });
  }

  /**
   * The rows a column actually draws. Plain `zeroFill` off: the traded cells,
   * holes and all. On: every price on the grid between the bar's high and low,
   * with `0 x 0` cells materialised for the ones nothing traded at, so the
   * ladder is opaque and the diagonal is judged against the adjacent price
   * rather than the next price that happened to trade. Falls back to the cells
   * when there is no grid (`step <= 0`), nothing to bridge, or the span would
   * need more rows than the cap.
   */
  private _rows(cells: readonly FootprintCell[], step: number): readonly FootprintCell[] {
    if (!this._opts.zeroFill || step <= 0 || cells.length < 2) return cells;
    // The extremes are scanned rather than read off the ends: `cells` is
    // documented high to low and nothing enforces it, and an ascending array
    // would otherwise ask for an empty grid.
    let hi = -Infinity;
    let lo = Infinity;
    const traded = new Map<number, FootprintCell>();
    for (const c of cells) {
      if (c.price > hi) hi = c.price;
      if (c.price < lo) lo = c.price;
      const key = bucketPrice(c.price, step);
      const seen = traded.get(key);
      // Cells colliding on the grid are summed, never last-wins: a `tickSize`
      // coarser than the aggregation step would otherwise lose volume silently.
      traded.set(key, seen === undefined ? c : {
        price: key, bidVol: seen.bidVol + c.bidVol, askVol: seen.askVol + c.askVol,
      });
    }
    if ((hi - lo) / step + 1 > this._opts.maxZeroFillRows) return cells;
    const grid = priceBuckets(lo, hi, step);
    const out: FootprintCell[] = [];
    for (let i = grid.length - 1; i >= 0; i--) {
      const p = grid[i];
      out.push(traded.get(p) ?? { price: p, bidVol: 0, askVol: 0 });
    }
    return out.length > 0 ? out : cells;
  }

  /** Row height in device px from the tick size (option, else the min cell gap). */
  private _rowHeight(cells: readonly FootprintCell[], rc: PrimitiveRenderContext): number {
    let tick = this._opts.tickSize ?? 0;
    if (tick <= 0) {
      let min = Infinity;
      for (let i = 1; i < cells.length; i++) {
        const g = Math.abs(cells[i - 1].price - cells[i].price);
        if (g > 0) min = Math.min(min, g);
      }
      tick = Number.isFinite(min) ? min : 0;
    }
    const p0 = cells[0].price;
    const rh = tick > 0
      ? Math.abs(rc.priceScale.priceToY(p0) - rc.priceScale.priceToY(p0 + tick)) * rc.dpr
      : 0;
    return Math.max(rh > 1 ? rh : 16 * rc.dpr, 6 * rc.dpr);
  }

  /** Column width in device px — explicit, else derived from the bar spacing. */
  private _columnWidth(rc: PrimitiveRenderContext): number {
    const o = this._opts;
    if (o.cellWidth !== undefined && o.cellWidth > 0) return o.cellWidth * rc.dpr;
    return Math.max(24 * rc.dpr, rc.timeScale.barSpacing * o.widthFactor * rc.dpr);
  }

  public draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext): void {
    // Kept so `hoverAt` can map a pointer back to a cell without the host having
    // to fabricate a render context out of internals it should not need.
    this._rc = rc;
    // Reset up front: a stale row height or hit window outlives the bars it was
    // measured from otherwise, and `layout()` promises zeroes when nothing drew.
    this._rowH = 0;
    this._plotH = 0;
    this._cols = [];
    if (this._bars.length === 0) { this._pushLayout(); return; }
    const o = this._opts;
    const dpr = rc.dpr;
    const buy = o.buyColor ?? rc.theme.upColor;
    const sell = o.sellColor ?? rc.theme.downColor;
    const bg = rc.theme.background;
    const plate = o.cellBaseColor ?? bg;
    const range = rc.timeScale.visibleRange();
    const width = this._columnWidth(rc);
    const plotH = rc.plotHeight * dpr;
    const statsH = o.statsRows.length * o.statsRowHeight * dpr;
    this._plotH = rc.plotHeight;

    const cols: Column[] = [];
    for (let i = 0; i < this._bars.length; i++) {
      const bar = this._bars[i];
      if (bar.cells.length === 0) continue;
      const index = rc.dataLayer.timeToIndex(bar.time);
      if (index === undefined || index < range.from - 1 || index > range.to + 1) continue;
      cols.push({ bar, x: Math.round(rc.timeScale.indexToX(index) * dpr), stats: this._stats[i] });
    }
    if (cols.length === 0) { this._pushLayout(); return; }

    // The pane's own OHLC, only when a gutter candle is going to ask for it.
    // `bars()` is the series' own array in time order, never the shared logical
    // index, so columns are matched by time.
    const ohlc = o.candle === 'gutter' ? rc.bars?.() ?? [] : [];

    ctx.save();
    ctx.textBaseline = 'middle';
    // The cells stop above the stats table so the two never overlap.
    const cellBottom = plotH - statsH;
    for (const col of cols) {
      this._drawColumn(ctx, rc, col, width, buy, sell, plate, cellBottom, this._ohlcAt(ohlc, col.bar.time));
    }
    if (o.statsRows.length > 0) this._drawStats(ctx, rc, cols, width, buy, sell, bg, plotH, statsH);
    ctx.restore();
    this._pushLayout();
  }

  private _drawColumn(
    ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, col: Column,
    width: number, buy: string, sell: string, base: string, cellBottom: number,
    ohlc: Bar | undefined,
  ): void {
    const o = this._opts;
    const dpr = rc.dpr;
    const { bar, stats } = col;
    const rows = this._rows(bar.cells, o.tickSize ?? 0);
    const rowH = this._rowHeight(rows, rc);
    this._rowH = rowH / dpr;
    // A gutter candle takes its strip out of the slot and the ladder shifts
    // right by it, so the column is never drawn over a candle body.
    const gutter = o.candle === 'gutter'
      ? Math.max(3 * dpr, Math.min(14 * dpr, width * o.candleWidthFactor))
      : 0;
    const colW = Math.max(width - gutter, 12 * dpr);
    const half = colW / 2;
    const x0 = col.x - half + gutter / 2;
    this._cols.push({ time: bar.time, x0: x0 / dpr, x1: (x0 + colW) / dpr });

    let peak = 1;
    let volPeak = 1;
    for (const c of rows) {
      peak = Math.max(peak, c.bidVol, c.askVol);
      volPeak = Math.max(volPeak, c.bidVol + c.askVol);
    }

    // Range line + body behind the cells: the bar is still a bar.
    if (o.candle === 'behind') {
      const yHi = rc.priceScale.priceToY(rows[0].price) * dpr - rowH / 2;
      const yLo = rc.priceScale.priceToY(rows[rows.length - 1].price) * dpr + rowH / 2;
      const up = stats.delta >= 0;
      ctx.fillStyle = withAlpha(up ? buy : sell, 0.5);
      ctx.fillRect(x0 - 5 * dpr, yHi, 3 * dpr, yLo - yHi);
    } else if (o.candle === 'gutter') {
      this._gutterCandle(ctx, rc, ohlc, rows, x0 - gutter / 2, gutter, buy, sell);
    }

    const byDelta = o.colorBy === 'delta';
    const imbalanced = this._imbalances(rows);
    // 0 below the threshold, 1 a few px above it, linear between.
    const textAlpha = Math.max(0, Math.min(1,
      (rowH / dpr - o.minTextHeight) / Math.max(1, o.textFade) + 1));
    const showText = textAlpha > 0;
    if (showText) {
      ctx.font = `${o.font * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = 'center';
    }

    for (let i = 0; i < rows.length; i++) {
      const c = rows[i];
      const y = rc.priceScale.priceToY(c.price) * dpr;
      const top = Math.round(y - rowH / 2);
      const h = Math.max(1, Math.round(rowH) - 1);
      if (top + h < 0 || top > cellBottom) continue; // cull off-pane rows

      const flag = byDelta ? undefined : imbalanced.get(c.price);
      const d = c.askVol - c.bidVol;
      const total = c.bidVol + c.askVol;
      // In `delta` mode the row is one colour at one intensity; in `imbalance`
      // each half answers for its own side.
      const rowColor = d >= 0 ? buy : sell;
      const rowTint = total / volPeak;
      if (o.displayMode !== 'bidask') {
        const v = o.displayMode === 'delta' ? d : total;
        const color = byDelta ? rowColor
          : o.displayMode === 'delta' ? (v >= 0 ? buy : sell) : mix(sell, buy, 0.5);
        this._cell(ctx, x0, top, colW - dpr, h, v, byDelta ? rowTint : Math.abs(v) / peak,
          color, base, false, textAlpha, dpr);
      } else if (o.cells === 'deltaVolume') {
        // The delta column stays flat: the sign is in the number's colour, so
        // the volume column is the only thing carrying intensity and the ladder
        // reads as one gradient instead of two competing ones.
        this._cell(ctx, x0, top, half - dpr, h, d, 0, base, base, false, textAlpha, dpr, d < 0 ? sell : undefined);
        this._cell(ctx, x0 + half + dpr, top, half - dpr, h, total, rowTint,
          byDelta ? rowColor : mix(sell, buy, 0.5), base, flag !== undefined, textAlpha, dpr);
      } else {
        this._cell(ctx, x0, top, half - dpr, h, c.bidVol, byDelta ? rowTint : c.bidVol / peak,
          byDelta ? rowColor : sell, base, flag === 'sell', textAlpha, dpr);
        this._cell(ctx, x0 + half + dpr, top, half - dpr, h, c.askVol, byDelta ? rowTint : c.askVol / peak,
          byDelta ? rowColor : buy, base, flag === 'buy', textAlpha, dpr);
      }

      // A histogram beside the ladder: the row's volume against the bar's
      // busiest row. Drawn after the cells, and clear of them, so it is
      // neither painted over nor sitting under the numbers. The buy bracket
      // claims x0 + colW + 2..5 dpr, so with runs enabled the bar starts past
      // that lane rather than burying the run marks under itself.
      if (o.showVolumeBar && total > 0) {
        const len = colW * o.volumeBarWidthFactor * (total / volPeak);
        if (len >= 1) {
          ctx.fillStyle = o.volumeBarColor ?? (d >= 0 ? buy : sell);
          ctx.fillRect(x0 + colW + (o.stackedImbalances > 0 ? 6 : 1) * dpr, top, len, h);
        }
      }

      if (c.price === stats.poc) {
        if (o.showPoc) {
          ctx.fillStyle = o.pocColor;
          ctx.fillRect(x0 - 2 * dpr, top, 2 * dpr, h);
        }
        if (o.pocOutline !== undefined) {
          // A stroke straddles its path, so inset by half a line width or the
          // outline bleeds into the rows above and below. Capped by the row it
          // is ringing: a ring wider than a 6 px row would otherwise ask for a
          // rect of negative size and invert itself.
          const lw = Math.min(Math.max(1, Math.round(o.pocOutlineWidth * dpr)), h, colW);
          ctx.strokeStyle = o.pocOutline;
          ctx.lineWidth = lw;
          ctx.strokeRect(x0 + lw / 2, top + lw / 2, colW - lw, h - lw);
        }
      }
    }

    // Stacked-imbalance brackets: the run is the signal, not the single cell.
    if (o.stackedImbalances > 0) {
      for (const run of this._runs(rows, imbalanced, o.stackedImbalances)) {
        const yTop = rc.priceScale.priceToY(run.from) * dpr - rowH / 2;
        const yBot = rc.priceScale.priceToY(run.to) * dpr + rowH / 2;
        const bx = run.side === 'buy' ? x0 + colW + 2 * dpr : x0 - 8 * dpr;
        ctx.strokeStyle = run.side === 'buy' ? buy : sell;
        ctx.lineWidth = Math.max(1, Math.round(1.5 * dpr));
        ctx.beginPath();
        ctx.moveTo(bx, yTop); ctx.lineTo(bx, yBot);
        ctx.moveTo(bx, yTop); ctx.lineTo(bx + (run.side === 'buy' ? 3 : -3) * dpr, yTop);
        ctx.moveTo(bx, yBot); ctx.lineTo(bx + (run.side === 'buy' ? 3 : -3) * dpr, yBot);
        ctx.stroke();
      }
    }
  }

  /** The pane's OHLC row for `time`, by binary search over the series' array. */
  private _ohlcAt(bars: readonly Bar[], time: number): Bar | undefined {
    let lo = 0;
    let hi = bars.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = bars[mid].time;
      if (t === time) return bars[mid];
      if (t < time) lo = mid + 1; else hi = mid - 1;
    }
    return undefined;
  }

  /**
   * A real OHLC candle in the reserved strip: a hairline wick high to low and a
   * body open to close, coloured by direction. The body is what carries the
   * colour, so once the slot narrows the whole thing degrades to a readable
   * direction strip rather than to nothing. The forming bar the price series
   * has not published yet gets a neutral wick over the cells' own extremes:
   * the ladder knows its range, it does not yet know its open and close.
   */
  private _gutterCandle(
    ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, ohlc: Bar | undefined,
    rows: readonly FootprintCell[], cx: number, gutter: number, buy: string, sell: string,
  ): void {
    const dpr = rc.dpr;
    const y = (p: number): number => rc.priceScale.priceToY(p) * dpr;
    const wickW = Math.max(1, Math.round(dpr));
    if (ohlc === undefined) {
      ctx.fillStyle = withAlpha(rc.theme.axisText, 0.5);
      const yTop = y(rows[0].price);
      ctx.fillRect(cx - wickW / 2, yTop, wickW, Math.max(1, y(rows[rows.length - 1].price) - yTop));
      return;
    }
    ctx.fillStyle = ohlc.close >= ohlc.open ? buy : sell;
    const yHi = y(ohlc.high);
    const yLo = y(ohlc.low);
    ctx.fillRect(cx - wickW / 2, yHi, wickW, Math.max(1, yLo - yHi));
    const bodyW = Math.max(2 * dpr, gutter * 0.6);
    // Under about 4 px a body over open-close is a stub that reads as noise, so
    // the strip takes the whole range instead and says only what it can: which
    // way the bar went.
    const strip = bodyW < 4 * dpr;
    const yo = strip ? yHi : y(ohlc.open);
    const yc = strip ? yLo : y(ohlc.close);
    ctx.fillRect(cx - bodyW / 2, Math.min(yo, yc), bodyW, Math.max(1, Math.abs(yc - yo)));
  }

  /**
   * One filled, intensity-graded cell with its number. `tint` is the 0..1 share
   * of whatever the caller is grading against, kept out of here because a row
   * can be graded by its own side, by its total volume, or not at all.
   */
  private _cell(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
    value: number, tint: number, color: string, base: string,
    hot: boolean, textAlpha: number, dpr: number, textColor?: string,
  ): void {
    if (w <= 0) return;
    const o = this._opts;
    // Saturated when imbalanced, otherwise a base→colour ramp.
    ctx.fillStyle = hot ? color : mix(base, color, this._tint(tint));
    const r = Math.min(o.radius * dpr, h / 2, w / 2);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
    if (textAlpha <= 0) return;
    // Fade rather than switch: zooming through the threshold reads as one
    // continuous change instead of numbers blinking on and off.
    // Zero-filled rows are context, not content: dimmer so the traded ladder
    // still reads at a glance.
    ctx.fillStyle = hot
      ? withAlpha(o.cellTextColorHot ?? '#0d0f14', textAlpha)
      : withAlpha(textColor ?? o.cellTextColor ?? '#ffffff', (value === 0 ? 0.45 : 0.9) * textAlpha);
    ctx.fillText(compactVol(value), x + w / 2, y + h / 2);
  }

  /**
   * How far a cell's ramp has travelled from its base towards its colour.
   *
   * Off the pane background the ramp is the eased legacy one: it starts at
   * 0.08 so a one-lot row is still visible against a dark pane, and stops
   * short of the raw colour so the saturated imbalance fill stays a step
   * above everything else. Neither constraint holds off a `cellBaseColor`
   * plate, which is opaque at zero and usually light, so there the ramp is
   * the caller's: `tintFloor` to `tintFloor + tintGain`, eased or linear.
   */
  private _tint(t: number): number {
    const o = this._opts;
    const s = t > 0 ? t : 0;
    if (o.cellBaseColor === undefined) return 0.08 + 0.62 * Math.sqrt(s);
    const a = o.tintFloor + o.tintGain * (o.tintCurve === 'linear' ? s : Math.sqrt(s));
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  /** Price → imbalance side, using the diagonal (ask vs the bid one tick below). */
  private _imbalances(cells: readonly FootprintCell[]): Map<number, 'buy' | 'sell'> {
    const o = this._opts;
    const out = new Map<number, 'buy' | 'sell'>();
    for (let i = 0; i < cells.length; i++) {
      const here = cells[i];
      const below = cells[i + 1];
      const above = cells[i - 1];
      if (below && here.askVol >= o.imbalanceThreshold
        && here.askVol >= o.imbalanceRatio * Math.max(1, below.bidVol)) out.set(here.price, 'buy');
      if (above && here.bidVol >= o.imbalanceThreshold
        && here.bidVol >= o.imbalanceRatio * Math.max(1, above.askVol)) out.set(here.price, 'sell');
    }
    return out;
  }

  /** Consecutive same-side imbalance runs of at least `min` rows. */
  private _runs(
    cells: readonly FootprintCell[], flags: Map<number, 'buy' | 'sell'>, min: number,
  ): { from: number; to: number; side: 'buy' | 'sell' }[] {
    const out: { from: number; to: number; side: 'buy' | 'sell' }[] = [];
    let run: { side: 'buy' | 'sell'; prices: number[] } | null = null;
    const flush = (): void => {
      if (run && run.prices.length >= min) {
        out.push({ from: run.prices[0], to: run.prices[run.prices.length - 1], side: run.side });
      }
    };
    for (const c of cells) {
      const side = flags.get(c.price);
      if (side !== undefined && (run === null || run.side === side)) {
        run = run ?? { side, prices: [] };
        run.prices.push(c.price);
      } else {
        flush();
        run = side !== undefined ? { side, prices: [c.price] } : null;
      }
    }
    flush();
    return out;
  }

  /** The stats table: one column per bar, one row per metric. */
  private _drawStats(
    ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, cols: readonly Column[],
    width: number, buy: string, sell: string, bg: string, plotH: number, statsH: number,
  ): void {
    const o = this._opts;
    const dpr = rc.dpr;
    const rowH = o.statsRowHeight * dpr;
    const top = plotH - statsH;

    // Per-metric extremes, so a cell can be tinted by strength relative to what
    // is actually on screen rather than an arbitrary constant.
    const peak = new Map<FootprintStatRow, number>();
    for (const row of o.statsRows) {
      let m = 0;
      for (const c of cols) m = Math.max(m, Math.abs(this._metric(c.stats, row)));
      peak.set(row, m || 1);
    }

    ctx.save();
    ctx.fillStyle = withAlpha(bg, 0.92);
    ctx.fillRect(0, top, rc.plotWidth * dpr, statsH);
    ctx.font = `${(o.font - 0.5) * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    o.statsRows.forEach((row, r) => {
      const y = top + r * rowH;
      for (const col of cols) {
        const v = this._metric(col.stats, row);
        const strength = Math.abs(v) / (peak.get(row) as number);
        const x = col.x - width / 2;
        const w = width - dpr;
        // Volume has no sign, so it reads neutral; the rest tint by direction.
        const tint = row === 'volume' || row === 'trades'
          ? mix(bg, rc.theme.axisText, 0.10 + 0.16 * strength)
          : row === 'cvd'
            ? mix(bg, '#4f8cff', 0.10 + 0.5 * strength)
            : mix(bg, v >= 0 ? buy : sell, 0.10 + 0.55 * strength);
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.roundRect(x, y + dpr, w, rowH - 2 * dpr, 2 * dpr);
        ctx.fill();
        ctx.fillStyle = withAlpha('#ffffff', 0.92);
        ctx.fillText(this._statText(v, row), col.x, y + rowH / 2);
      }
    });
    ctx.restore();
  }

  private _metric(s: FootprintBarStats, row: FootprintStatRow): number {
    switch (row) {
      case 'volume': return s.volume;
      case 'delta': return s.delta;
      case 'deltaPct': return s.deltaPct;
      case 'cvd': return s.cvd;
      default: return s.trades;
    }
  }

  private _statText(v: number, row: FootprintStatRow): string {
    if (row === 'deltaPct') return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
    if (row === 'volume' || row === 'trades') return compactVol(v);
    return signed(v);
  }

  /**
   * Report the column (and row) under the pointer so a host can show a tooltip.
   * Returns a hit id of `footprint:<time>` — the payload is on `hoverAt`.
   */
  public hitTest(x: number, y: number): PrimitiveHit | null {
    const col = this._cols.find((c) => x >= c.x0 && x <= c.x1);
    if (col === undefined) return null;
    if (y < 0 || y > this._plotH) return null;
    return { externalId: `footprint:${col.time}`, zOrder: 'normal', distance: 0, cursor: 'crosshair' };
  }

  /**
   * Full hover payload for `(x, y)` in media px, for a host-drawn tooltip.
   * `rc` defaults to the context of the last paint, so a crosshair handler can
   * just call `hoverAt(p.x, p.y)`.
   */
  public hoverAt(x: number, y: number, rc?: PrimitiveRenderContext): FootprintHover | null {
    const ctx = rc ?? this._rc;
    if (ctx === null) return null;
    const col = this._cols.find((c) => x >= c.x0 && x <= c.x1);
    if (col === undefined) return null;
    const i = this._bars.findIndex((b) => b.time === col.time);
    if (i < 0) return null;
    const bar = this._bars[i];
    const price = ctx.priceScale.yToPrice(y);
    let cell: FootprintCell | null = null;
    let best = Infinity;
    // The rows the painter drew, not the traded cells: with `zeroFill` the
    // pointer is over a `0 x 0` row as often as not, and snapping it to the
    // nearest print reports a row the user is not looking at.
    for (const c of this._rows(bar.cells, this._opts.tickSize ?? 0)) {
      const d = Math.abs(ctx.priceScale.priceToY(c.price) - y);
      if (d < best && d <= Math.max(4, this._rowH)) { best = d; cell = c; }
    }
    return { time: bar.time, price: cell === null ? null : price, cell, stats: this._stats[i] };
  }
}
