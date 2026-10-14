/** Footprint columns, volume profiles and cluster ladders from classified trades. */
import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext, PrimitiveHit, ZOrder } from 'openalgo-charts';
import type { Bar } from '../model/bar';
import { bucketPrice, priceBuckets, valueArea, type FootprintBar, type FootprintCell } from './profile-model';
import { MAX_EMPTY_ROWS, diagonalImbalances, stackedImbalances } from './footprint';
import { footprintTextColor, readableTextColor, type FootprintTextColorMode } from './footprint-colors';
import { footprintSignals, type FootprintSignals, type FootprintZone, type FootprintZoneEnd } from './footprint-signals';
import { drawAuctions, drawFlip, drawVisibleProfile, drawZones, type OverlayColors } from './footprint-overlays';
import { sessionOpen, tpoLetter, type SessionWindow } from './market-profile';
import { DEFAULT_TIMEZONE } from '../feed/time';
import { parseColor, withAlpha } from '../render/pill';

export type FootprintStatRow = 'volume' | 'bidVolume' | 'askVolume' | 'delta' | 'minDelta' | 'maxDelta' | 'deltaPct' | 'cvd'
  | 'trades' | 'cumVolume' | 'cvdRatio' | 'session';
/**
 * `bidask` shades both sides by volume; `imbalance` leaves cells plain and fills
 * only diagonal imbalances, shading the candle body's rows; `delta`, `deltaPct`,
 * `volume`, `volumeDelta` and `deltaShadedVolume` print one value per row.
 * `deltaShadedVolume` (since 2.6.4) prints the row's volume on a cell coloured
 * and shaded by its delta.
 */
export type FootprintDisplayMode = 'bidask' | 'imbalance' | 'delta' | 'deltaPct' | 'volume' | 'volumeDelta' | 'deltaShadedVolume';
/** The zones `showZones` extends: stacked imbalances, multiple nodes and absorption. */
export type FootprintZoneGroup = 'stacked' | 'node' | 'absorption';
/** A zone that price came back to after it became active (since 2.6.4). */
export interface FootprintZoneAlert {
  zone: FootprintZone;
  /** Time of the bar whose range came back to the zone. */
  time: number;
}
export type FootprintCellStyle = 'heatmap' | 'profile' | 'ladder';
export type { FootprintTextColorMode } from './footprint-colors';

/** What the two halves of a `bidask` row carry. */
export type FootprintCellMode = 'bidAsk' | 'deltaVolume';

/** What sets a row's background colour. */
export type FootprintColorMode = 'imbalance' | 'delta';

/**
 * Where the bar's candle goes. `'ohlc'` is the column gutter drawn from the
 * footprint bar's own open/high/low/close. `'gutter'` reserves the same strip
 * but reads the PANE's price series instead, for a host whose ladder and whose
 * candles come from different places. `'behind'` is the older delta-coloured
 * range line drawn against the column, and `'off'` draws neither.
 */
export type FootprintCandleMode = 'off' | 'behind' | 'gutter' | 'ohlc';

/**
 * Styling for the delta half of a `deltaVolume` row, independent of the volume
 * half beside it.
 *
 * The two halves carry different quantities: one is directional and one is
 * not. Painted from the one plate the ladder reads as a single block and the
 * delta is thrown away, which is what every desktop terminal avoids by giving
 * the delta half a colour of its own.
 *
 * Every field is optional and falls back to the whole-cell option of the same
 * name, so the group is inert until something in it is set.
 */
export interface FootprintDeltaCell {
  /** Plate the delta half ramps from. Falls back to `cellBaseColor`. */
  baseColor?: string;
  /**
   * `'delta'` tints the plate by the row's own delta: the sign picks the buy
   * or the sell colour, the intensity is |delta| against the bar's biggest
   * |row delta|. `'none'` (the default) leaves the half flat, which is what
   * the mode has always drawn.
   */
  colorBy?: 'delta' | 'none';
  /** Ramp off `baseColor`, as `tintFloor` / `tintGain` / `tintCurve` are. */
  tintFloor?: number;
  tintGain?: number;
  tintCurve?: 'linear' | 'sqrt';
  /**
   * Ink for the delta number. With `colorBy: 'delta'` the sign is already in
   * the plate, so the sign-coloured number is dropped. With `colorBy: 'none'`
   * the sign keeps the number.
   */
  textColor?: string;
  /** Ink once the plate saturates, i.e. on the bar's biggest |row delta|. */
  textColorHot?: string;
}

export interface FootprintOptions {
  /** Preferred full column width in media px, capped to the available bar slot. */
  cellWidth?: number;
  /** Fraction of the bar slot occupied by the column and candle. Default 0.9. */
  widthFactor: number;
  /** Effective price step (tickSize * rowTicks). Overrides bar.rowSize. */
  tickSize?: number;
  font: number;
  minTextHeight: number;
  textFade: number;
  displayMode: FootprintDisplayMode;
  /** Display quantities divided by this positive value; 1 shows raw units. Stats remain raw. */
  volumeDivisor: number;
  /** Abbreviate quantities to three significant figures (12.3K). False prints whole numbers. Default true. */
  compactNumbers: boolean;
  /** Intensity cells, volume-proportional bars, or square high-contrast cells. */
  cellStyle: FootprintCellStyle;
  /** Shade against each bar's busiest row, or against the busiest row on screen so clusters stand out. */
  intensityScope: 'bar' | 'visible';
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
  /** Text comparisons are independent of the cell background. */
  textColorMode: FootprintTextColorMode;
  textColor?: string;
  buyTextColor?: string;
  sellTextColor?: string;
  imbalanceRatio: number;
  imbalanceThreshold: number;
  /** Adjacent same-side imbalance run length. 0 disables brackets and stacked zones. */
  stackedImbalances: number;
  statsRows: readonly FootprintStatRow[];
  /** Ordered rows for a separate table below the footprints. Empty disables it (default). */
  tableRows: readonly FootprintStatRow[];
  /** Fixed table label column width in media px. Default 150. */
  tableLabelWidth: number;
  statsRowHeight: number;
  /** Fixed pane footer or labeled cards beneath each bar. */
  statsPosition: 'bottom' | 'bar';
  /** Cumulative delta preceding the supplied bars, for a rolling window. */
  cvdOffset: number;
  /** `'session'` restarts cumulative delta and cumulative volume at each session open. */
  cvdReset: 'none' | 'session';
  /** Session that letters and resets count from; omitted means local midnight. */
  sessionWindow?: SessionWindow;
  /** IANA zone for the session calendar; defaults to Asia/Kolkata. */
  timezone?: string;
  /** Length of one session-letter period in minutes. Default 30. */
  tpoMinutes: number;
  /** Draw real OHLC if supplied; legacy bars show a neutral range line. */
  showCandle: boolean;
  /**
   * Which candle the column carries. Defaults to `'ohlc'`, the bar's own
   * metadata in the gutter; `showCandle: false` still turns every mode off.
   */
  candle: FootprintCandleMode;
  /**
   * Fraction of the bar slot the `'gutter'` candle takes, clamped to 3..14
   * media px. The body fills 60% of it, so a narrow slot still reads as a
   * coloured direction strip once the wick is down to a hairline.
   */
  candleWidthFactor: number;
  showPoc: boolean;
  pocStyle: 'marker' | 'outline';
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
   * Needs a row step: without one there is no grid to fill.
   */
  zeroFill: boolean;
  /**
   * Bars needing more zero-filled rows than this fall back to their traded
   * rows. A gap bar, or a `tickSize` that does not match the instrument, would
   * otherwise ask for tens of thousands of rows on one frame.
   */
  maxZeroFillRows: number;
  /**
   * Opaque plate a cell is tinted **from**, in place of the pane background.
   *
   * A ladder tinted off a dark pane spends its low end near black, so a
   * one-lot row is a hole the pane shows through. Given a plate (a light grey,
   * say) the same row is legible at zero intensity and the tint reads as
   * pressure rather than as presence. Unset, the pane background stays the
   * base and the ramp is the legacy eased one.
   */
  cellBaseColor?: string;
  /**
   * Where the plate ramp starts, 0 being the bare plate and 1 the raw colour.
   * Ignored while `cellBaseColor` is unset. Default 0.
   */
  tintFloor: number;
  /**
   * How much of the remaining distance to the colour a full-intensity cell
   * travels. Clamped with the floor to 1. Ignored while `cellBaseColor` is
   * unset. Default 1.
   */
  tintGain: number;
  /**
   * Shape of the plate ramp. `sqrt` eases it, lifting the quiet rows; `linear`
   * is proportional. Ignored while `cellBaseColor` is unset.
   */
  tintCurve: 'linear' | 'sqrt';
  /**
   * Draw a horizontal histogram bar for each row in the strip beside the
   * ladder, its length the row's share of the bar's busiest row. Volume is
   * already in the cell numbers and in the tint, but neither is comparable
   * down a column at a glance, and a length is. Off by default: it draws
   * outside the column, so a host wants `widthFactor` (or `cellWidth`) to
   * leave it room first.
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
  /** Length of a full-volume bar as a fraction of the column width. Default 0.5. */
  volumeBarWidthFactor: number;
  /**
   * Ink for the cell numbers, used literally. Unset, `textColorMode` picks one
   * and contrast-corrects it against the plate the number sits on.
   */
  cellTextColor?: string;
  /** Ink for the numbers on a saturated (imbalanced) cell, used literally. */
  cellTextColorHot?: string;
  /**
   * Paint the delta half of a `deltaVolume` row on its own terms. Unset, both
   * halves share one plate. Ignored unless `cells` is `deltaVolume`.
   */
  deltaCell?: FootprintDeltaCell | undefined;
  /**
   * Called after a paint, and only when the values changed, with what
   * `layout()` would return. The push signal a host needs to re-derive its row
   * size when the pane resizes, which no data event announces.
   */
  onLayout?: (layout: { rowHeight: number; paneHeight: number; minTextHeight: number }) => void;
  showValueArea: boolean;
  /** Fraction of volume in the contiguous value area around the POC. */
  valueAreaPercent: number;
  valueAreaColor?: string;
  /** Highlight the POC when this many consecutive bars share it. 0 (default) disables. */
  multipleNodeBars: number;
  nodeColor: string;
  /** Outline a big limit order of at least this many average cells. 0 (default) disables. */
  bigOrderMultiple: number;
  bigOrderColor: string;
  /** Band rows where bid and ask both reach this many average cells. 0 (default) disables. */
  absorptionMultiple: number;
  absorptionColor: string;
  /** Bars the average cell is taken over. Default 10. */
  signalLookback: number;
  /** Rows from the high or low a big order or absorption must be within. Default 3. */
  nearExtremeRows: number;
  /** Mark an aggressive delta flip after this many opposite bars. 0 (default) disables. */
  flipBars: number;
  flipMinDeltaPct: number;
  /** Extend stacked imbalances, multiple nodes and absorption to the right as zones. Default false. */
  showZones: boolean;
  /** Which of them `showZones` extends and alerts on (since 2.6.4). Default all three. */
  zoneKinds: readonly FootprintZoneGroup[];
  zoneEnd: FootprintZoneEnd;
  zoneActiveAfter: number;
  /** Zones start only in the newest this many bars (since 2.6.4). 0, the default, takes every bar. */
  zoneLookback: number;
  /** Dash-dot line at a high or low that traded on both bid and ask. Default false. */
  showUnfinishedAuctions: boolean;
  auctionHighColor?: string;
  auctionLowColor?: string;
  /** Bar delta printed under each column. Default false. */
  showDeltaLabels: boolean;
  /** Box the delta label when it disagrees with the bar's direction. Default false. */
  markDivergence: boolean;
  divergenceColor: string;
  /** Volume at price of the visible bars against the left edge. Default false. */
  showVisibleProfile: boolean;
  profileWidth: number;
  /**
   * Draw a 0 x 0 row at every row step a bar's trades skipped, so each column
   * spans its whole range. Display only: imbalances, the POC, value area and
   * signals still read the traded rows. Default true.
   */
  showEmptyRows: boolean;
  /** Fill the newest bar's last-price row with this colour. Omitted draws nothing. */
  lastPriceColor?: string;
  /** The newest bar is still forming, so it cannot close a zone or set an unfinished auction. Default true. */
  formingLastBar: boolean;
  buyColor?: string;
  sellColor?: string;
  // Each colour below is optional (since 2.6.4); omitted, it keeps the colour it
  // had before: the buy or sell colour, or the chart theme's background.
  /** Imbalanced cells, stacked imbalance brackets and stacked zones. */
  imbalanceBuyColor?: string;
  imbalanceSellColor?: string;
  /** Cells in the `volume` display mode, which otherwise take the colour of the side that traded more. */
  volumeColor?: string;
  /** The candle beside each column, and the body rows the `imbalance` mode shades. */
  candleUpColor?: string;
  candleDownColor?: string;
  /** Ask and bid bars of the visible-range profile. */
  profileAskColor?: string;
  profileBidColor?: string;
  /** Session letters in the table and the statistics cards. */
  sessionColor?: string;
  /** Background of the statistics table. */
  tableBackground?: string;
  pocColor: string;
  radius: number;
}

/**
 * A patch as the primitive reads it. A key explicitly set to `undefined` means
 * "not supplied" when the option HAS a default, and a deliberate clear when it
 * does not.
 *
 * Both halves are a host's real code. `{ candle: saved?.candle }` is how a
 * saved layout is restored, and it must not turn a required mode into nothing,
 * it used to throw on the enum check, and before that check existed it left the
 * renderer reading `undefined`. `{ pocOutline: undefined }` is how the same
 * host turns the ring off, and it must keep doing exactly that.
 */
function supplied(patch: Partial<FootprintOptions>): Partial<FootprintOptions> {
  const out = { ...patch } as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_FOOTPRINT_OPTIONS)) {
    if (key in out && out[key] === undefined) delete out[key];
  }
  return out as Partial<FootprintOptions>;
}

export const DEFAULT_FOOTPRINT_OPTIONS: FootprintOptions = {
  widthFactor: 0.9, font: 10, minTextHeight: 11, textFade: 4,
  displayMode: 'bidask', volumeDivisor: 1, compactNumbers: true, cellStyle: 'heatmap', intensityScope: 'bar', textColorMode: 'contrast',
  cells: 'bidAsk', colorBy: 'imbalance',
  imbalanceRatio: 3, imbalanceThreshold: 0, stackedImbalances: 3,
  statsRows: [], tableRows: [], tableLabelWidth: 150, statsRowHeight: 15,
  statsPosition: 'bottom', cvdOffset: 0, cvdReset: 'none', tpoMinutes: 30, showCandle: true, candle: 'ohlc', candleWidthFactor: 0.22,
  showPoc: true, pocStyle: 'marker', pocOutlineWidth: 1, pocColor: '#f0a020',
  zeroFill: false, maxZeroFillRows: 400,
  tintFloor: 0, tintGain: 1, tintCurve: 'sqrt',
  showVolumeBar: false, volumeBarWidthFactor: 0.5,
  showValueArea: false, valueAreaPercent: 0.7, radius: 2,
  multipleNodeBars: 0, nodeColor: '#e8c547', bigOrderMultiple: 0, bigOrderColor: '#2ea8ff',
  absorptionMultiple: 0, absorptionColor: '#a98bf0', signalLookback: 10, nearExtremeRows: 3,
  flipBars: 0, flipMinDeltaPct: 8, showZones: false, zoneKinds: ['stacked', 'node', 'absorption'], zoneEnd: 'closeInside', zoneActiveAfter: 1, zoneLookback: 0,
  showUnfinishedAuctions: false, showDeltaLabels: false, markDivergence: false, divergenceColor: '#f2a33a',
  showVisibleProfile: false, profileWidth: 100, showEmptyRows: true, formingLastBar: true,
};

export interface FootprintBarStats {
  time: number;
  volume: number;
  bidVolume: number;
  askVolume: number;
  delta: number;
  /** Intrabar running delta extremes, including initial zero; null without trade-path metadata. */
  minDelta: number | null;
  maxDelta: number | null;
  deltaPct: number;
  cvd: number;
  /** Cumulative volume over the loaded bars, restarting with `cvdReset: 'session'`. */
  cumVolume: number;
  /** Cumulative delta divided by cumulative volume; 0 before any volume. */
  cvdRatio: number;
  /** Session letter of the period the bar opens in: A for the first `tpoMinutes`, and so on. */
  session: string;
  /** Null when a legacy input does not include an actual trade count. */
  trades: number | null;
  poc: number;
  vah: number;
  val: number;
}

export interface FootprintHover {
  time: number;
  /** The exact bucket price; null over a statistics card/table. */
  price: number | null;
  cell: FootprintCell | null;
  stats: FootprintBarStats;
}

/** Three significant figures, preserving fractional quantities and suffix rollover. */
export function compactVol(v: number): string {
  if (!Number.isFinite(v)) return '-';
  const rounded = Number(v.toPrecision(3));
  const a = Math.abs(rounded);
  const [suffix, div] = a >= 1e9 ? ['B', 1e9] : a >= 1e6 ? ['M', 1e6] : a >= 1e3 ? ['K', 1e3] : ['', 1];
  return String(Number((rounded / div).toPrecision(3))) + suffix;
}

/** `floor + gain * curve(t)`, clamped: the shape every plate ramp has. */
function ramp(t: number, floor: number, gain: number, curve: 'linear' | 'sqrt'): number {
  const s = t > 0 ? t : 0;
  const a = floor + gain * (curve === 'linear' ? s : Math.sqrt(s));
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a), cb = parseColor(b);
  if (ca === null || cb === null) return b;
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(ca.r + (cb.r - ca.r) * k)},${Math.round(ca.g + (cb.g - ca.g) * k)},${Math.round(ca.b + (cb.b - ca.b) * k)})`;
}

/**
 * The opposing quantity the ladder compares a diagonal AT. One, not zero: a
 * ratio multiplied by an empty row is zero whatever the ratio, so without a
 * floor `imbalanceRatio` cannot suppress a thing, least of all under
 * `zeroFill`, which puts an empty row under every isolated print, or since
 * 2.6.4, when an untraded row is read as a zero one. The `imbalance` view is
 * the exception: it grades a cell by the ratio it reached and fills one
 * against zero at full strength, so it compares with zero as the library does.
 */
const LADDER_MIN_OPPOSING = 1;

/** `LADDER_MIN_OPPOSING`, or zero in the `imbalance` view, for these options. */
function ladderMinOpposing(o: FootprintOptions): number {
  return o.displayMode === 'imbalance' ? 0 : LADDER_MIN_OPPOSING;
}

/** The options with their arrays copied, so a caller's array never changes them. */
function copyOptions(o: FootprintOptions): FootprintOptions {
  // `deltaCell` is a nested literal a caller keeps a reference to, so it is copied too.
  return { ...o, statsRows: [...o.statsRows], tableRows: [...o.tableRows], zoneKinds: [...o.zoneKinds],
    deltaCell: o.deltaCell === undefined ? undefined : { ...o.deltaCell } };
}

/** Midnight to midnight: the session when no window is given. */
const WHOLE_DAY: SessionWindow = { startMinute: 0, endMinute: 0 };
const TWO_SIDED = new Set<FootprintDisplayMode>(['bidask', 'imbalance']);
const ZONE_GROUP: Record<FootprintZone['kind'], FootprintZoneGroup> = { stackedBuy: 'stacked', stackedSell: 'stacked', node: 'node', absorption: 'absorption' };

/** A bar's cells, highest first, with a zero row at every row step the trades skipped. */
function withEmptyRows(cells: readonly FootprintCell[], step: number): readonly FootprintCell[] {
  if (!(step > 0) || cells.length < 2) return cells;
  const out: FootprintCell[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!, next = cells[i + 1];
    out.push(cell);
    if (next === undefined) break;
    const missing = Math.round((cell.price - next.price) / step) - 1;
    if (missing > MAX_EMPTY_ROWS) continue;
    for (let k = 1; k <= missing; k++) out.push({ price: bucketPrice(cell.price - k * step, step), bidVol: 0, askVol: 0 });
  }
  return out;
}

interface RowHit { cell: FootprintCell; top: number; bottom: number }
/** A cell's own plate and ink, overriding the ladder's. */
interface CellInk { fill?: string | undefined; text?: string | undefined; textHot?: string | undefined }
/** Per-cell overrides: a grading share the caller worked out, and a pinned plate/ink. */
interface CellPaint {
  tint?: number;
  /** A fill the caller decided outright (the `imbalance` view), drawn as a whole cell. */
  fill?: string;
  /** The text to print, when it is not the cell's quantity (`deltaPct`, `volumeDelta`). */
  label?: string;
  style?: CellInk | undefined;
  /** What the text palette should read the half as, when that is not where it sits. */
  textSide?: 'bid' | 'ask' | 'single';
}
interface Column {
  bar: FootprintBar;
  stats: FootprintBarStats;
  index: number;
  x: number;
  x0: number;
  width: number;
  rowSize: number;
  rows: RowHit[];
  card?: { top: number; bottom: number };
  table?: { left: number; right: number; top: number; bottom: number };
}
interface Palette { buy: string; sell: string; bg: string; imbBuy: string; imbSell: string }
const STAT_LABEL: Record<FootprintStatRow, string> = {
  volume: 'Volume', bidVolume: 'Bid Volume', askVolume: 'Ask Volume', delta: 'Delta',
  minDelta: 'Min Delta', maxDelta: 'Max Delta', deltaPct: 'Delta %', cvd: 'CVD', trades: 'Trades',
  cumVolume: 'Cum Volume', cvdRatio: 'CVD / Volume', session: 'Session',
};
const TABLE_LABEL = { ...STAT_LABEL, volume: 'Total Volume', bidVolume: 'Total Bid Volume', askVolume: 'Total Ask Volume',
  cvd: 'Cumulative Delta', cumVolume: 'Cumulative Volume', cvdRatio: 'Cum. Delta / Volume', session: 'Session Letter' };
const unsignedRow = (row: FootprintStatRow): boolean => row === 'volume' || row === 'trades' || row === 'bidVolume' || row === 'askVolume' || row === 'cumVolume';

export class Footprint implements IPrimitive {
  private _bars: FootprintBar[] = [];
  private _opts: FootprintOptions;
  private _host: PrimitiveHost | null = null;
  private _stats: FootprintBarStats[] = [];
  private _signals: FootprintSignals = { bars: [], zones: [], auctions: [] };
  /** Only visible painted rows/cards are interactive, in media pixels. */
  private _cols: Column[] = [];
  private _rc: PrimitiveRenderContext | null = null;
  private _inferredStep = 0;
  /** Drawn row height and pane height from the last paint, in media px. */
  private _rowH = 0;
  private _plotH = 0;
  /** What `onLayout` last saw, so an unchanged frame does not push again. */
  private _layoutKey = '';
  private _primed = false;
  /** Time of the newest bar at the last `setBars`: touches from it on are live. */
  private _liveFrom = -Infinity;
  private readonly _alertHandlers = new Set<(alert: FootprintZoneAlert) => void>();
  /** Zones already reported or already touched when first seen, by kind, origin and low. */
  private readonly _alerted = new Set<string>();

  public constructor(options: Partial<FootprintOptions> = {}) {
    this._opts = copyOptions({ ...DEFAULT_FOOTPRINT_OPTIONS, ...supplied(options) });
    this._validateOptions(this._opts);
  }
  public attached(host: PrimitiveHost): void { this._host = host; }
  public detached(): void { this._host = null; this._rc = null; this._cols = []; }
  public zOrder(): ZOrder { return 'normal'; }

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
   * Both numbers are 0 before the first paint and while there are no bars or
   * nothing on screen to draw. `onLayout` is the push half of the same fact,
   * for a pane resize, which no data event announces.
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

  private _validateOptions(o: FootprintOptions): void {
    for (const v of [o.widthFactor, o.font, o.statsRowHeight, o.tableLabelWidth, o.imbalanceRatio, o.volumeDivisor, o.tpoMinutes, o.profileWidth]) {
      if (!Number.isFinite(v) || v <= 0) throw new RangeError('Footprint dimensions and ratio must be positive and finite');
    }
    for (const v of [o.radius, o.minTextHeight, o.textFade, o.imbalanceThreshold,
      o.pocOutlineWidth, o.tintFloor, o.tintGain, o.volumeBarWidthFactor, o.candleWidthFactor, o.maxZeroFillRows]) {
      if (!Number.isFinite(v) || v < 0) throw new RangeError('Footprint thresholds and radius must be nonnegative and finite');
    }
    for (const v of [o.cellWidth, o.tickSize]) {
      if (v !== undefined && (!Number.isFinite(v) || v <= 0)) throw new RangeError('Footprint width and row step must be positive and finite');
    }
    if (!Number.isSafeInteger(o.stackedImbalances) || o.stackedImbalances < 0) throw new RangeError('Footprint stack length must be a nonnegative integer');
    if (!Number.isFinite(o.cvdOffset)) throw new RangeError('Footprint CVD offset must be finite');
    if (!Number.isFinite(o.valueAreaPercent) || o.valueAreaPercent <= 0 || o.valueAreaPercent > 1) throw new RangeError('Footprint value area must be in (0, 1]');
    for (const rows of [o.statsRows, o.tableRows]) {
      if (rows.some(row => !Object.prototype.hasOwnProperty.call(STAT_LABEL, row)) || new Set(rows).size !== rows.length) throw new RangeError('Footprint statistics rows must be known and unique');
    }
    if (o.zoneKinds.some(kind => kind !== 'stacked' && kind !== 'node' && kind !== 'absorption') || new Set(o.zoneKinds).size !== o.zoneKinds.length) {
      throw new RangeError('Footprint zone kinds must be stacked, node or absorption, each once');
    }
    // Saved layouts are untrusted input, and an unknown mode is a silently
    // different chart rather than an error the host can see.
    for (const [value, allowed, what] of [
      [o.candle, ['off', 'behind', 'gutter', 'ohlc'], 'candle mode'],
      [o.cells, ['bidAsk', 'deltaVolume'], 'cell mode'],
      [o.colorBy, ['imbalance', 'delta'], 'colour mode'],
      [o.cellStyle, ['heatmap', 'profile', 'ladder'], 'cell style'],
      [o.tintCurve, ['linear', 'sqrt'], 'tint curve'],
      [o.statsPosition, ['bottom', 'bar'], 'statistics position'],
      [o.pocStyle, ['marker', 'outline'], 'POC style'],
    ] as readonly (readonly [string, readonly string[], string])[]) {
      if (value !== undefined && !allowed.includes(value)) throw new RangeError(`Footprint ${what} must be one of ${allowed.join(', ')}`);
    }
    const dc = o.deltaCell;
    if (dc !== undefined) {
      if (dc.colorBy !== undefined && dc.colorBy !== 'delta' && dc.colorBy !== 'none') throw new RangeError('Footprint delta cell colour mode must be delta or none');
      if (dc.tintCurve !== undefined && dc.tintCurve !== 'linear' && dc.tintCurve !== 'sqrt') throw new RangeError('Footprint delta cell tint curve must be linear or sqrt');
      for (const v of [dc.tintFloor, dc.tintGain]) {
        if (v !== undefined && (!Number.isFinite(v) || v < 0)) throw new RangeError('Footprint delta cell ramp must be nonnegative and finite');
      }
    }
    // The signal options share one validator with the pure function.
    footprintSignals([], this._signalOptions(o));
  }

  private _signalOptions(o: FootprintOptions): Parameters<typeof footprintSignals>[1] {
    return {
      imbalanceRatio: o.imbalanceRatio, imbalanceThreshold: o.imbalanceThreshold, stackedImbalances: o.stackedImbalances,
      multipleNodeBars: o.multipleNodeBars, bigOrderMultiple: o.bigOrderMultiple, absorptionMultiple: o.absorptionMultiple,
      signalLookback: o.signalLookback, nearExtremeRows: o.nearExtremeRows, flipBars: o.flipBars, flipMinDeltaPct: o.flipMinDeltaPct,
      zoneEnd: o.zoneEnd, zoneActiveAfter: o.zoneActiveAfter, zoneLookback: o.zoneLookback, formingLastBar: o.formingLastBar,
      minOpposing: ladderMinOpposing(o), // zones on the diagonals the brackets mark
    };
  }

  public setBars(bars: readonly FootprintBar[]): void {
    this._bars = bars.map(bar => ({ ...bar, cells: bar.cells.map(cell => ({ ...cell })).sort((a, b) => b.price - a.price) }));
    let step = Infinity;
    for (const bar of this._bars) {
      if (bar.rowSize !== undefined && bar.rowSize > 0) step = Math.min(step, bar.rowSize);
      for (let i = 1; i < bar.cells.length; i++) {
        const gap = bar.cells[i - 1]!.price - bar.cells[i]!.price;
        if (gap > 0) step = Math.min(step, gap);
      }
    }
    this._inferredStep = Number.isFinite(step) ? step : 0;
    this._cols = [];
    this._recomputeStats();
    this._reportTouches(true);
    this._host?.requestUpdate();
  }

  public setOptions(input: Partial<FootprintOptions>): void {
    const patch = supplied(input);
    const next = { ...this._opts, ...patch };
    this._validateOptions(next);
    this._opts = copyOptions(next);
    this._cols = [];
    this._recomputeStats();
    // New options can make new zones out of old bars: nothing traded into them now.
    this._reportTouches(false);
    this._host?.requestUpdate();
  }
  public options(): FootprintOptions { return copyOptions(this._opts); }

  /**
   * Called once for each zone that `showZones` extends (so nothing is reported
   * while it is off) when a bar's range comes back to it after it became active
   * (since 2.6.4), the moment to raise an alert or play a sound. The first bars
   * a footprint is given are history and report nothing; each later `setBars`
   * is read as the live tail, so a touch in the bar that was newest at the
   * previous call, or in any bar after it, is reported. `setBars([])`, or bars
   * that start again from an older bar, begin a new history. Returns the
   * unsubscribe.
   */
  public onZoneAlert(handler: (alert: FootprintZoneAlert) => void): () => void {
    this._alertHandlers.add(handler);
    return () => { this._alertHandlers.delete(handler); };
  }

  private _reportTouches(live: boolean): void {
    const o = this._opts, newest = this._bars[this._bars.length - 1]?.time;
    // No bars, or bars ending before the last ones did, are another dataset: its touches are history.
    if (newest === undefined || newest < this._liveFrom) { this._primed = false; this._alerted.clear(); this._liveFrom = -Infinity; }
    if (newest === undefined) return;
    const report = live && this._primed, from = this._liveFrom;
    if (live) { this._primed = true; this._liveFrom = newest; }
    if (!o.showZones) return;
    for (const zone of this._signals.zones) {
      if (zone.touchTime === null || !o.zoneKinds.includes(ZONE_GROUP[zone.kind])) continue;
      const key = `${zone.kind}|${zone.time}|${zone.low}`;
      if (this._alerted.has(key)) continue;
      this._alerted.add(key);
      // A touch is news when it is in the bar that was still forming at the last call, or later.
      if (!report || zone.touchTime < from) continue;
      for (const handler of [...this._alertHandlers]) {
        try { handler({ zone: { ...zone }, time: zone.touchTime }); } catch (error) { queueMicrotask(() => { throw error; }); }
      }
    }
  }
  public stats(): readonly FootprintBarStats[] { return this._stats; }
  /**
   * Multiple nodes, big orders, absorption, flips, divergence, zones and
   * unfinished auctions for the loaded bars, under the current options. Zones
   * carry `activeTime` and `endTime`, so a host can raise its own alerts.
   */
  public signals(): FootprintSignals { return this._signals; }
  private _step(bar: FootprintBar): number { return this._opts.tickSize ?? bar.rowSize ?? this._inferredStep; }

  /**
   * The rows a column actually draws. With `zeroFill` off: the traded cells,
   * holes and all. On: every price on the grid between the bar's high and low,
   * with `0 x 0` cells materialised for the ones nothing traded at, so the
   * ladder is opaque and the diagonal is judged against the adjacent price
   * rather than the next price that happened to trade. Falls back to the cells
   * when there is no grid, nothing to bridge, or the span would need more rows
   * than the cap.
   */
  private _rows(cells: readonly FootprintCell[], step: number): { rows: readonly FootprintCell[]; gridded: boolean } {
    if (!this._opts.zeroFill || !(step > 0) || cells.length < 2) return { rows: cells, gridded: false };
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
      // The price is the GRID's, always, a lone off-grid cell kept at its own
      // price drew a row straddling the two beside it, and pointed the POC mark
      // at a price no drawn row had.
      traded.set(key, seen === undefined
        ? { price: key, bidVol: c.bidVol, askVol: c.askVol }
        : { price: key, bidVol: seen.bidVol + c.bidVol, askVol: seen.askVol + c.askVol });
    }
    if ((hi - lo) / step + 1 > this._opts.maxZeroFillRows) return { rows: cells, gridded: false };
    const grid = priceBuckets(lo, hi, step);
    const out: FootprintCell[] = [];
    for (let i = grid.length - 1; i >= 0; i--) {
      const p = grid[i]!;
      out.push(traded.get(p) ?? { price: p, bidVol: 0, askVol: 0 });
    }
    return out.length > 0 ? { rows: out, gridded: true } : { rows: cells, gridded: false };
  }

  /** The pane's OHLC row for `time`, by binary search over the series' array. */
  private _ohlcAt(bars: readonly Bar[], time: number): Bar | undefined {
    let lo = 0;
    let hi = bars.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = bars[mid]!.time;
      if (t === time) return bars[mid];
      if (t < time) lo = mid + 1; else hi = mid - 1;
    }
    return undefined;
  }

  /** Which candle a column carries, with `showCandle: false` overriding the mode. */
  private _candleMode(): FootprintCandleMode {
    return this._opts.showCandle ? this._opts.candle : 'off';
  }

  public autoscaleInfo(): { min: number; max: number } | null {
    let min = Infinity, max = -Infinity;
    for (const bar of this._bars) {
      const half = this._step(bar) / 2;
      for (const cell of bar.cells) { min = Math.min(min, cell.price - half); max = Math.max(max, cell.price + half); }
      // Only the candle drawn from the BAR's own metadata puts price on the
      // pane that the cells do not. `'behind'` is a range line over the rows,
      // and `'gutter'` reads the pane's price series, which autoscales itself;
      // `showCandle` alone said yes to all of them, so `candle: 'off'` still
      // stretched the pane to the bar's high and low.
      if (this._candleMode() === 'ohlc') {
        if (bar.low !== undefined) min = Math.min(min, bar.low);
        if (bar.high !== undefined) max = Math.max(max, bar.high);
      }
    }
    return Number.isFinite(min) ? { min, max } : null;
  }

  private _recomputeStats(): void {
    const o = this._opts;
    const window = o.sessionWindow ?? WHOLE_DAY, zone = o.timezone ?? DEFAULT_TIMEZONE;
    const sessions = o.cvdReset === 'session' || o.statsRows.includes('session') || o.tableRows.includes('session');
    let cvd = o.cvdOffset, cumVolume = 0, opened = NaN;
    this._stats = this._bars.map(bar => {
      const totals = bar.cells.map(cell => cell.bidVol + cell.askVol);
      // The ladder, its value area and delta % are about classified volume;
      // Total Volume is what the bar traded, prints with no side included.
      const classified = totals.reduce((sum, v) => sum + v, 0);
      const volume = classified + Math.max(0, bar.neutralVol ?? 0);
      const bidVolume = bar.cells.reduce((sum, cell) => sum + cell.bidVol, 0);
      const askVolume = bar.cells.reduce((sum, cell) => sum + cell.askVol, 0);
      const va = valueArea(totals, classified * o.valueAreaPercent);
      const open = sessions ? sessionOpen(bar.time, window, zone) : 0;
      if (o.cvdReset === 'session' && open !== opened && !Number.isNaN(opened)) { cvd = 0; cumVolume = 0; }
      opened = open;
      cvd += bar.delta;
      cumVolume += volume;
      return { time: bar.time, volume, bidVolume, askVolume, delta: bar.delta,
        // Delta % and the value area are over the classified volume: neutral
        // volume (`neutralVol`) has no side and sits in no row.
        minDelta: bar.minDelta ?? null, maxDelta: bar.maxDelta ?? null, deltaPct: classified > 0 ? bar.delta / classified * 100 : 0,
        cvd, cumVolume, cvdRatio: cumVolume > 0 ? cvd / cumVolume : 0,
        session: sessions ? tpoLetter(Math.floor((bar.time - open) / (o.tpoMinutes * 60))) : '-',
        trades: bar.tradeCount ?? null, poc: bar.cells[va.poc]?.price ?? 0,
        vah: bar.cells[va.upper]?.price ?? 0, val: bar.cells[va.lower]?.price ?? 0 };
    });
    this._signals = footprintSignals(this._bars, this._signalOptions(o));
  }

  /** Price boundaries, not a minimum pixel size: tiny rows must never overlap. */
  private _bounds(price: number, step: number, rc: PrimitiveRenderContext): { top: number; bottom: number } {
    const y = rc.priceScale.priceToY(price);
    if (!(step > 0)) return { top: y - 8, bottom: y + 8 };
    const a = rc.priceScale.priceToY(price - step / 2), b = rc.priceScale.priceToY(price + step / 2);
    return { top: Math.min(a, b), bottom: Math.max(a, b) };
  }

  /** Quantity text: compact by default, otherwise whole numbers with separators. */
  private _format(v: number): string {
    if (this._opts.compactNumbers || !Number.isFinite(v)) return compactVol(v);
    return (Math.sign(v) * Math.round(Math.abs(v))).toLocaleString('en-US');
  }

  /** The value a cell is shaded by in a single-value mode, and the peak it is measured against. */
  private _cellMeasure(cell: FootprintCell): number {
    const mode = this._opts.displayMode, vol = cell.bidVol + cell.askVol, d = cell.askVol - cell.bidVol;
    if (mode === 'volume') return vol;
    if (mode === 'deltaPct') return vol > 0 ? Math.abs(d) / vol : 0;
    if (mode === 'delta' || mode === 'volumeDelta' || mode === 'deltaShadedVolume') return Math.abs(d);
    return Math.max(cell.bidVol, cell.askVol);
  }

  private _peak(bar: FootprintBar): number {
    if (this._opts.displayMode === 'deltaPct') return 1;
    let peak = 0;
    for (const cell of bar.cells) peak = Math.max(peak, this._cellMeasure(cell));
    return peak;
  }

  public draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext): void {
    this._rc = rc;
    this._cols = [];
    // Reset up front: a stale row height outlives the bars it was measured
    // from otherwise, and `layout()` promises zeroes when nothing drew.
    this._rowH = 0;
    this._plotH = 0;
    if (this._bars.length === 0 || rc.plotHeight <= 0 || rc.plotWidth <= 0) { this._pushLayout(); return; }
    const o = this._opts, dpr = rc.dpr;
    const buy = o.buyColor ?? rc.theme.upColor, sell = o.sellColor ?? rc.theme.downColor;
    const palette: Palette = { buy, sell, bg: rc.theme.background, imbBuy: o.imbalanceBuyColor ?? buy, imbSell: o.imbalanceSellColor ?? sell };
    const slot = rc.timeScale.barSpacing;
    const outerWidth = Math.max(0.1, Math.min(o.cellWidth ?? slot * o.widthFactor, slot * 0.96));
    const candle = this._candleMode();
    // A gutter candle takes its strip out of the slot and the ladder shifts
    // right by it, so the column is never drawn over a candle body. `'ohlc'`
    // only reserves one once the column is wide enough to spare it.
    const gutter = candle === 'ohlc' ? (outerWidth >= 20 ? Math.min(9, outerWidth * 0.15) : 0)
      : candle === 'gutter' ? Math.max(3, Math.min(14, outerWidth * o.candleWidthFactor))
      : 0;
    const width = Math.max(0.1, outerWidth - gutter);
    const tableRows = o.tableRows.length ? o.tableRows : o.statsPosition === 'bottom' ? o.statsRows : [];
    const statsH = Math.min(rc.plotHeight, tableRows.length * o.statsRowHeight);
    const cellBottom = rc.plotHeight - statsH;
    const range = rc.timeScale.visibleRange();
    // setBars recomputes the statistics, so there is one per bar.
    for (let i = 0; i < this._bars.length; i++) {
      const bar = this._bars[i]!;
      if (!bar.cells.length) continue;
      const index = rc.dataLayer.timeToIndex(bar.time);
      if (index === undefined || index < range.from - 1 || index > range.to + 1) continue;
      const x0 = rc.timeScale.indexToX(index) - outerWidth / 2 + gutter;
      if (x0 + width < 0 || x0 > rc.plotWidth) continue;
      this._cols.push({ bar, stats: this._stats[i]!, index: i, x: x0 + width / 2, x0, width, rowSize: this._step(bar), rows: [] });
    }
    if (this._cols.length === 0) { this._pushLayout(); return; }
    this._plotH = rc.plotHeight;
    // The pane's own OHLC, only when a `'gutter'` candle is going to ask for
    // it. `bars()` is the series' own array in time order, never the shared
    // logical index, so columns are matched by time.
    const ohlc = candle === 'gutter' ? rc.bars?.() ?? [] : [];
    let screenPeak = 0;
    if (o.intensityScope === 'visible') for (const col of this._cols) screenPeak = Math.max(screenPeak, this._peak(col.bar));
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, rc.plotWidth * dpr, rc.plotHeight * dpr); ctx.clip();
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, rc.plotWidth * dpr, cellBottom * dpr); ctx.clip();
    this._drawAcross(ctx, rc, palette, cellBottom);
    for (const col of this._cols) this._drawColumn(ctx, rc, col, gutter, palette, cellBottom, screenPeak, this._ohlcAt(ohlc, col.bar.time));
    for (const col of this._cols) this._drawUnder(ctx, rc, col, palette, cellBottom);
    if (o.showVisibleProfile) {
      drawVisibleProfile(ctx, rc, this._cols.map(col => col.bar), this._cols[0]?.rowSize ?? 0, o.profileWidth, cellBottom,
        o.profileAskColor ?? palette.buy, o.profileBidColor ?? palette.sell, palette.bg, o.textColor ?? rc.theme.axisText, o.pocColor, v => this._format(v / o.volumeDivisor), Math.max(8, o.font - 1));
    }
    ctx.restore();
    if (o.statsRows.length && o.statsPosition === 'bar') {
      for (const col of this._cols) this._drawCard(ctx, rc, col, palette, cellBottom);
    }
    if (tableRows.length) this._drawFooter(ctx, rc, palette, statsH, tableRows);
    ctx.restore();
    this._pushLayout();
  }

  /** Zones and unfinished auctions sit behind the columns. */
  private _drawAcross(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, p: Palette, bottom: number): void {
    const o = this._opts;
    const colors: OverlayColors = { stackedBuy: p.imbBuy, stackedSell: p.imbSell, node: o.nodeColor, absorption: o.absorptionColor,
      auctionHigh: o.auctionHighColor ?? p.buy, auctionLow: o.auctionLowColor ?? p.sell };
    if (o.showZones) drawZones(ctx, rc, this._signals.zones.filter(zone => o.zoneKinds.includes(ZONE_GROUP[zone.kind])), colors, bottom);
    if (!o.showUnfinishedAuctions) return;
    const byTime = new Map(this._bars.map(bar => [bar.time, bar]));
    drawAuctions(ctx, rc, this._signals.auctions, colors, (auction) => {
      const bar = byTime.get(auction.time)!, step = this._step(bar);
      const cell = auction.side === 'high' ? bar.cells[0] : bar.cells[bar.cells.length - 1];
      const bounds = this._bounds(cell?.price ?? auction.price, step, rc);
      return auction.side === 'high' ? bounds.top : bounds.bottom;
    });
  }

  /** Imbalance-mode fill: stronger as the ratio passes two and three times the threshold, full against zero. */
  private _imbalanceStrength(volume: number, opposing: number): number {
    if (opposing <= 0) return 1;
    const ratio = volume / opposing, r = this._opts.imbalanceRatio;
    return ratio >= 3 * r ? 1 : ratio >= 2 * r ? 0.8 : 0.6;
  }

  private _drawColumn(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, col: Column,
    gutter: number, p: Palette, cellBottom: number, screenPeak: number, ohlc: Bar | undefined): void {
    const o = this._opts, dpr = rc.dpr;
    const { bar, stats } = col;
    const { buy, sell, bg, imbBuy, imbSell } = p;
    const width = col.width * dpr, half = width / 2, x0 = col.x0 * dpr, center = col.x * dpr;
    // Zero-filled rows are real rows: the diagonal, the hover and the histogram
    // all read them, which is the whole point of materialising them. Without
    // `zeroFill`, `showEmptyRows` still draws a display-only 0 x 0 row at each
    // step the trades skipped.
    const { rows, gridded } = this._rows(bar.cells, col.rowSize);
    // `zeroFill` owns the empty rows when it is on, its row cap included.
    const cells = !o.zeroFill && o.showEmptyRows ? withEmptyRows(rows, col.rowSize) : rows;
    // `stats.poc` is a price the SOURCE cells carried; on a filled grid the row
    // holding it may sit at the bucket that price rounds into. The mark follows
    // the row, and `stats()` keeps saying where the volume actually was.
    const pocPrice = gridded ? bucketPrice(stats.poc, col.rowSize) : stats.poc;
    const byDelta = o.colorBy === 'delta';
    const flags = byDelta ? []
      : diagonalImbalances(rows, o.imbalanceRatio, col.rowSize || undefined, o.imbalanceThreshold, this._minOpposing());
    // Without a row size every bar has one row, so nothing faces anything.
    const byPrice = new Map(col.rowSize > 0 ? rows.map(cell => [bucketPrice(cell.price, col.rowSize), cell] as const) : []);
    const buys = new Set(flags.filter(flag => flag.side === 'buy').map(flag => flag.price));
    const sells = new Set(flags.filter(flag => flag.side === 'sell').map(flag => flag.price));
    const twoSided = TWO_SIDED.has(o.displayMode);
    let rowPeak = 0, textPeak = 0, volPeak = 0, deltaPeak = 0;
    for (const cell of rows) {
      rowPeak = Math.max(rowPeak, this._cellMeasure(cell));
      textPeak = Math.max(textPeak, twoSided ? Math.max(cell.bidVol, cell.askVol) : cell.bidVol + cell.askVol);
      volPeak = Math.max(volPeak, cell.bidVol + cell.askVol);
      deltaPeak = Math.max(deltaPeak, Math.abs(cell.askVol - cell.bidVol));
    }
    const peak = o.intensityScope === 'visible' ? screenPeak : o.displayMode === 'deltaPct' ? 1 : rowPeak;
    volPeak = volPeak || 1;
    deltaPeak = deltaPeak || 1;
    const signal = this._signals.bars[col.index];
    const body = this._bodyRows(bar, cells, col.rowSize);
    const candle = bar.open !== undefined && bar.close !== undefined && bar.close < bar.open ? o.candleDownColor ?? sell : o.candleUpColor ?? buy;
    const lastRow = o.lastPriceColor !== undefined && col.index === this._bars.length - 1 && bar.close !== undefined
      ? this._rowOf(bar, bar.close, col.rowSize) : null;
    const up = o.candleUpColor ?? buy, down = o.candleDownColor ?? sell;
    const candleMode = this._candleMode();
    if (candleMode === 'ohlc' && gutter > 0) this._drawCandle(ctx, rc, col, gutter, up, down);
    else if (candleMode === 'gutter') this._gutterCandle(ctx, rc, ohlc, rows, (col.x0 - gutter / 2) * dpr, gutter * dpr, up, down);
    else if (candleMode === 'behind') this._behindBar(ctx, rc, col, rows, x0, buy, sell);
    const deltaCells = o.displayMode === 'bidask' && o.cells === 'deltaVolume';
    // The volume each imbalance was measured against: the diagonal row's, or zero across an untraded row.
    const facing = (price: number, below: boolean): number => {
      const other = byPrice.get(bucketPrice(price + (below ? -col.rowSize : col.rowSize), col.rowSize));
      return other === undefined ? 0 : below ? other.bidVol : other.askVol;
    };
    cells.forEach((cell) => {
      const bounds = this._bounds(cell.price, col.rowSize, rc);
      if (bounds.bottom <= 0 || bounds.top >= cellBottom) return;
      col.rows.push({ cell, top: Math.max(0, bounds.top), bottom: Math.min(cellBottom, bounds.bottom) });
      const top = bounds.top * dpr, rowH = (bounds.bottom - bounds.top) * dpr;
      this._rowH = bounds.bottom - bounds.top;
      const h = Math.max(0, rowH - Math.min(dpr, rowH * 0.1));
      const textAlpha = Math.max(0, Math.min(1, ((bounds.bottom - bounds.top) - o.minTextHeight) / Math.max(1, o.textFade) + 1));
      ctx.font = `${o.font * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      const delta = cell.askVol - cell.bidVol;
      const total = cell.bidVol + cell.askVol;
      // In `delta` colouring the row is one colour at one intensity; in
      // `imbalance` each half answers for its own side.
      const rowColor = delta >= 0 ? buy : sell;
      const rowTint = total / volPeak;
      if (deltaCells) {
        const gap = Math.min(dpr, half * 0.08), w = half - gap;
        // Flat by default: the sign lives in the number's colour, so the volume
        // column is the only thing carrying intensity and the ladder reads as
        // one gradient instead of two competing ones.
        const ds = this._deltaStyle(delta, deltaPeak, bg, buy, sell);
        // `'bid'`/`'ask'` describe where the halves SIT, which is what the
        // profile fill and the label alignment need. Neither half is a side, so
        // the text palette is told so: under `textColorMode: 'side'` the delta
        // half was inked in the sell colour for a positive delta.
        this._cell(ctx, rc, cell, x0, top, w, h, delta, peak, textPeak, bg, buy, sell, bg, ds.hot, textAlpha, 'bid',
          { tint: 0, style: ds.style, textSide: 'single' });
        this._cell(ctx, rc, cell, center + gap, top, w, h, total, peak, textPeak,
          byDelta ? rowColor : mix(sell, buy, 0.5), buy, sell, bg,
          // The volume half answers for the ROW, so either diagonal saturates it.
          !byDelta && (buys.has(cell.price) || sells.has(cell.price)), textAlpha, 'ask',
          { tint: rowTint, textSide: 'single' });
      } else if (twoSided) {
        const gap = Math.min(dpr, half * 0.08), w = half - gap;
        let bidFill: string | undefined, askFill: string | undefined;
        if (o.displayMode === 'imbalance') {
          // Plain cells: only imbalances are coloured, and the candle body's rows are lightly shaded.
          const plain = body.has(cell.price) ? mix(bg, candle, 0.18) : bg;
          bidFill = sells.has(cell.price) ? mix(bg, imbSell, this._imbalanceStrength(cell.bidVol, facing(cell.price, false))) : plain;
          askFill = buys.has(cell.price) ? mix(bg, imbBuy, this._imbalanceStrength(cell.askVol, facing(cell.price, true))) : plain;
        }
        const bidHot = sells.has(cell.price), askHot = buys.has(cell.price);
        this._cell(ctx, rc, cell, x0, top, w, h, cell.bidVol, peak, textPeak, byDelta ? rowColor : bidHot ? imbSell : sell, buy, sell, bg,
          bidHot, textAlpha, 'bid', byDelta ? { tint: rowTint } : bidFill === undefined ? undefined : { fill: bidFill });
        this._cell(ctx, rc, cell, center + gap, top, w, h, cell.askVol, peak, textPeak, byDelta ? rowColor : askHot ? imbBuy : buy, buy, sell, bg,
          askHot, textAlpha, 'ask', byDelta ? { tint: rowTint } : askFill === undefined ? undefined : { fill: askFill });
      } else {
        const shade = this._cellMeasure(cell) * (o.displayMode === 'volume' ? 1 : Math.sign(delta) || 1);
        const label = o.displayMode === 'deltaPct' ? `${total > 0 ? Math.round(delta / total * 100) : 0}%`
          : o.displayMode === 'volumeDelta' ? `${this._format(total / o.volumeDivisor)} x ${this._format(delta / o.volumeDivisor)}`
            : this._format((o.displayMode === 'delta' ? delta : total) / o.volumeDivisor);
        const hot = !byDelta && (delta > 0 ? buys.has(cell.price) : delta < 0 && sells.has(cell.price));
        const color = byDelta ? rowColor : hot ? (delta > 0 ? imbBuy : imbSell)
          : o.displayMode === 'volume' && o.volumeColor !== undefined ? o.volumeColor
            : delta > 0 ? buy : delta < 0 ? sell : mix(buy, sell, 0.5);
        this._cell(ctx, rc, cell, x0, top, width, h, shade, peak, textPeak, color, buy, sell, bg, hot, textAlpha, 'single',
          byDelta ? { tint: rowTint, label } : { label });
      }
      this._drawVolumeBar(ctx, rc, x0, top, width, h, total / volPeak, delta >= 0 ? buy : sell);
      if (signal?.node && cell.price === pocPrice) { ctx.fillStyle = withAlpha(o.nodeColor, 0.35); ctx.fillRect(x0, top, width, h); }
      if (lastRow === cell.price) { ctx.fillStyle = withAlpha(o.lastPriceColor!, 0.45); ctx.fillRect(x0, top, width, h); }
      if (cell.price === pocPrice) this._drawPocMarks(ctx, rc, x0, top, width, h);
      if (twoSided && !deltaCells && (signal?.bigBid === cell.price || signal?.bigAsk === cell.price)) {
        ctx.strokeStyle = o.bigOrderColor; ctx.lineWidth = 2 * dpr;
        const left = signal.bigBid === cell.price ? x0 : center;
        ctx.strokeRect(left + dpr, top + dpr, half - 2 * dpr, Math.max(0, h - 2 * dpr));
      }
    });
    if (o.displayMode === 'imbalance' && body.size > 0) this._outlineBody(ctx, rc, col, body, candle);
    for (const span of signal?.absorption ?? []) {
      const a = this._bounds(span.high, col.rowSize, rc), b = this._bounds(span.low, col.rowSize, rc);
      const top = Math.min(a.top, b.top) * dpr, h = (Math.max(a.bottom, b.bottom) * dpr) - top;
      ctx.fillStyle = withAlpha(o.absorptionColor, 0.3); ctx.fillRect(x0, top, width, h);
      ctx.strokeStyle = o.absorptionColor; ctx.lineWidth = dpr; ctx.strokeRect(x0, top, width, h);
    }
    this._drawValueArea(ctx, rc, col, x0, width);
    this._drawBrackets(ctx, rc, col, rows, imbBuy, imbSell);
  }

  /**
   * A histogram beside the ladder: the row's volume against the bar's busiest
   * row (`share`). Drawn after the cells, and clear of them, so it is neither
   * painted over nor sitting under the numbers. The buy bracket claims the
   * lane just right of the ladder, so with runs enabled the bar starts past
   * that lane rather than burying the run marks under itself.
   */
  private _drawVolumeBar(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, x0: number, top: number,
    width: number, h: number, share: number, color: string): void {
    const o = this._opts;
    if (!o.showVolumeBar || !(share > 0)) return;
    const len = width * o.volumeBarWidthFactor * share;
    if (len < 1) return;
    ctx.fillStyle = o.volumeBarColor ?? color;
    ctx.fillRect(x0 + width + (o.stackedImbalances > 0 ? 6 : 1) * rc.dpr, top, len, h);
  }

  /** The POC row's marks: upstream's `pocStyle` and the fork's `pocOutline` ring, both if asked. */
  private _drawPocMarks(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, x0: number, top: number, width: number, h: number): void {
    const o = this._opts, dpr = rc.dpr;
    if (o.showPoc) {
      if (o.pocStyle === 'outline') {
        ctx.strokeStyle = o.pocColor; ctx.lineWidth = Math.max(1, dpr);
        ctx.strokeRect(x0, top + dpr / 2, width, Math.max(0, h - dpr));
      } else { ctx.fillStyle = o.pocColor; ctx.fillRect(x0 - 2 * dpr, top, 2 * dpr, h); }
    }
    if (o.pocOutline === undefined) return;
    // A stroke straddles its path, so inset by half a line width or the ring
    // bleeds into the rows above and below. Capped by the row it is ringing: a
    // ring taller than the row would otherwise ask for a rect of negative size
    // and invert itself.
    const lw = Math.min(Math.max(1, Math.round(o.pocOutlineWidth * dpr)), h, width);
    ctx.strokeStyle = o.pocOutline;
    ctx.lineWidth = lw;
    ctx.strokeRect(x0 + lw / 2, top + lw / 2, width - lw, h - lw);
  }

  /** The floor the ladder's diagonals compare at: see `LADDER_MIN_OPPOSING`. */
  private _minOpposing(): number {
    return ladderMinOpposing(this._opts);
  }

  /** Row prices of the drawn cells between the bar's open and close rows, inclusive. */
  private _bodyRows(bar: FootprintBar, cells: readonly FootprintCell[], step: number): Set<number> {
    const rows = new Set<number>();
    if (bar.open === undefined || bar.close === undefined || !bar.cells.length) return rows;
    const hi = this._rowOf(bar, Math.max(bar.open, bar.close), step), lo = this._rowOf(bar, Math.min(bar.open, bar.close), step);
    for (const cell of cells) if (cell.price <= hi && cell.price >= lo) rows.add(cell.price);
    return rows;
  }

  /** The row price holding `price`: the nearest row, which on the row grid is the one whose span contains it. */
  private _rowOf(bar: FootprintBar, price: number, step: number): number {
    let best = bar.cells[0]!.price;
    for (const cell of bar.cells) if (Math.abs(cell.price - price) < Math.abs(best - price)) best = cell.price;
    return step > 0 ? best : price;
  }

  private _outlineBody(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, col: Column, body: Set<number>, color: string): void {
    const dpr = rc.dpr, prices = [...body];
    const a = this._bounds(Math.max(...prices), col.rowSize, rc), b = this._bounds(Math.min(...prices), col.rowSize, rc);
    const top = Math.min(a.top, b.top), bottom = Math.max(a.bottom, b.bottom);
    ctx.strokeStyle = color; ctx.lineWidth = 1.5 * dpr;
    ctx.strokeRect(col.x0 * dpr, top * dpr, col.width * dpr, (bottom - top) * dpr);
  }

  private _drawValueArea(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, col: Column, x0: number, width: number): void {
    const o = this._opts, stats = col.stats;
    if (!o.showValueArea || stats.volume <= 0) return;
    const hi = this._bounds(stats.vah, col.rowSize, rc), lo = this._bounds(stats.val, col.rowSize, rc);
    ctx.strokeStyle = o.valueAreaColor ?? rc.theme.axisText; ctx.lineWidth = rc.dpr;
    ctx.beginPath();
    for (const y of [Math.min(hi.top, lo.top), Math.max(hi.bottom, lo.bottom)]) {
      ctx.moveTo(x0, y * rc.dpr); ctx.lineTo(x0 + width, y * rc.dpr);
    }
    ctx.stroke();
  }

  private _drawBrackets(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, col: Column,
    rows: readonly FootprintCell[], buy: string, sell: string): void {
    const o = this._opts, dpr = rc.dpr;
    if (o.stackedImbalances <= 0 || col.width < 16) return;
    // On the drawn rows and with the ladder's floor, so a bracket marks the
    // same diagonals the cells do.
    const runs = stackedImbalances(rows, o.imbalanceRatio, o.stackedImbalances, col.rowSize || undefined,
      o.imbalanceThreshold, this._minOpposing());
    for (const run of runs) {
      const a = this._bounds(run.startPrice, col.rowSize, rc), b = this._bounds(run.endPrice, col.rowSize, rc);
      const top = Math.min(a.top, b.top) * dpr, bottom = Math.max(a.bottom, b.bottom) * dpr;
      const bx = (run.side === 'buy' ? col.x0 + col.width - 1 : col.x0 + 1) * dpr;
      const dx = (run.side === 'buy' ? -3 : 3) * dpr;
      ctx.strokeStyle = run.side === 'buy' ? buy : sell; ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.moveTo(bx + dx, top); ctx.lineTo(bx, top); ctx.lineTo(bx, bottom); ctx.lineTo(bx + dx, bottom); ctx.stroke();
    }
  }

  /** Lowest painted edge of a column: its bottom row or its candle's low. */
  private _columnBottom(rc: PrimitiveRenderContext, col: Column): number {
    let bottom = -Infinity;
    for (const cell of col.bar.cells) bottom = Math.max(bottom, this._bounds(cell.price, col.rowSize, rc).bottom);
    // Only the `'ohlc'` candle is drawn from the bar's own high and low.
    if (this._candleMode() === 'ohlc') for (const price of [col.bar.high, col.bar.low]) if (price !== undefined) bottom = Math.max(bottom, rc.priceScale.priceToY(price));
    return bottom;
  }

  /** Delta label and flip marker under (or, for a selling flip, over) the column. */
  private _drawUnder(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, col: Column, p: Palette, cellBottom: number): void {
    const o = this._opts, dpr = rc.dpr, signal = this._signals.bars[col.index];
    let y = this._columnBottom(rc, col) + 3;
    if (o.showDeltaLabels && col.width >= 24) {
      const delta = col.bar.delta, h = o.font + 5;
      if (y + h <= cellBottom) {
        ctx.font = `bold ${o.font * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = readableTextColor(delta > 0 ? p.buy : delta < 0 ? p.sell : rc.theme.axisText, p.bg);
        ctx.fillText((delta > 0 ? '+' : '') + this._format(delta / o.volumeDivisor), col.x * dpr, (y + h / 2) * dpr);
        if (o.markDivergence && signal?.divergence) {
          ctx.strokeStyle = o.divergenceColor; ctx.lineWidth = 1.5 * dpr;
          ctx.strokeRect((col.x0 + 1) * dpr, y * dpr, (col.width - 2) * dpr, h * dpr);
        }
      }
      y += h + 2;
    }
    if (!signal?.flip) return;
    const size = Math.min(12, Math.max(6, col.width / 5));
    if (signal.flip > 0) drawFlip(ctx, rc, col.x, y + 1, size, true, p.buy);
    else {
      let top = Infinity;
      for (const cell of col.bar.cells) top = Math.min(top, this._bounds(cell.price, col.rowSize, rc).top);
      if (this._candleMode() === 'ohlc' && col.bar.high !== undefined) top = Math.min(top, rc.priceScale.priceToY(col.bar.high));
      drawFlip(ctx, rc, col.x, top - 3, size, false, p.sell);
    }
  }

  /**
   * The older delta-coloured range line drawn against the column, for a host
   * that leaves its own candlestick series visible and wants only the bar's
   * extent restated beside the ladder.
   */
  private _behindBar(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, col: Column,
    rows: readonly FootprintCell[], x0: number, buy: string, sell: string): void {
    if (rows.length === 0) return;
    const dpr = rc.dpr;
    const top = this._bounds(rows[0]!.price, col.rowSize, rc).top * dpr;
    const bottom = this._bounds(rows[rows.length - 1]!.price, col.rowSize, rc).bottom * dpr;
    ctx.fillStyle = withAlpha(col.stats.delta >= 0 ? buy : sell, 0.5);
    ctx.fillRect(x0 - 5 * dpr, top, 3 * dpr, bottom - top);
  }

  /**
   * A real OHLC candle in the reserved strip, read from the PANE's price
   * series: a hairline wick high to low and a body open to close, coloured by
   * direction. The body is what carries the colour, so once the slot narrows
   * the whole thing degrades to a readable direction strip rather than to
   * nothing. The forming bar the price series has not published yet gets a
   * neutral wick over the cells' own extremes: the ladder knows its range, it
   * does not yet know its open and close.
   */
  private _gutterCandle(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, ohlc: Bar | undefined,
    rows: readonly FootprintCell[], cx: number, gutter: number, buy: string, sell: string): void {
    if (rows.length === 0) return;
    const dpr = rc.dpr;
    const y = (p: number): number => rc.priceScale.priceToY(p) * dpr;
    const wickW = Math.max(1, Math.round(dpr));
    if (ohlc === undefined) {
      ctx.fillStyle = withAlpha(rc.theme.axisText, 0.5);
      const yTop = y(rows[0]!.price);
      ctx.fillRect(cx - wickW / 2, yTop, wickW, Math.max(1, y(rows[rows.length - 1]!.price) - yTop));
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
   * The delta half's plate and ink, or the flat default when nothing asked for
   * more. Graded on |delta| against the bar's biggest row delta rather than on
   * volume, so a row that traded little but one-sided still reads.
   */
  private _deltaStyle(d: number, deltaPeak: number, base: string, buy: string, sell: string,
  ): { hot: boolean; style?: CellInk | undefined } {
    const o = this._opts;
    const dc = o.deltaCell;
    const plate = o.cellBaseColor ?? base;
    // A negative delta has always been written in the sell colour: with a flat
    // plate the number is the only place the sign can live.
    const sign = d < 0 ? sell : undefined;
    if (dc === undefined) {
      return { hot: false, style: sign === undefined ? undefined : { text: sign } };
    }
    if (dc.colorBy !== 'delta') {
      return { hot: false, style: { fill: dc.baseColor, text: dc.textColor ?? sign, textHot: dc.textColorHot } };
    }
    const amount = ramp(
      Math.abs(d) / deltaPeak,
      dc.tintFloor ?? o.tintFloor, dc.tintGain ?? o.tintGain, dc.tintCurve ?? o.tintCurve,
    );
    return {
      // Saturated is the same idea it is for an imbalanced cell: the plate has
      // reached the raw colour, and the ink has to change to stay readable.
      hot: amount >= 1,
      // The plate carries the sign now, so the number stops repeating it.
      style: { fill: mix(dc.baseColor ?? plate, d >= 0 ? buy : sell, amount), text: dc.textColor, textHot: dc.textColorHot },
    };
  }

  /**
   * How far a cell's ramp has travelled from its base towards its colour.
   *
   * Off the pane background the ramp is the eased legacy one: it starts above
   * zero so a one-lot row is still visible against a dark pane, and stops
   * short of the raw colour so the saturated imbalance fill stays a step above
   * everything else. Neither constraint holds off a `cellBaseColor` plate,
   * which is opaque at zero and usually light, so there the ramp is the
   * caller's: `tintFloor` to `tintFloor + tintGain`, eased or linear.
   */
  private _ramp(strength: number): number {
    const o = this._opts;
    if (o.cellBaseColor === undefined) {
      return o.cellStyle === 'ladder' ? 0.18 + 0.82 * Math.sqrt(strength) : 0.08 + 0.62 * Math.sqrt(strength);
    }
    return ramp(strength, o.tintFloor, o.tintGain, o.tintCurve);
  }

  private _drawCandle(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, col: Column, gutter: number, buy: string, sell: string): void {
    const b = col.bar, dpr = rc.dpr;
    const x = (col.x0 - gutter / 2) * dpr;
    const bodyWidth = Math.min(4, gutter * 0.45) * dpr;
    // A column is only made for a bar with cells.
    const high = b.high ?? b.cells[0]!.price, low = b.low ?? b.cells[b.cells.length - 1]!.price;
    const y1 = rc.priceScale.priceToY(high) * dpr, y2 = rc.priceScale.priceToY(low) * dpr;
    const hasBody = b.open !== undefined && b.close !== undefined;
    const color = hasBody ? ((b.close as number) >= (b.open as number) ? buy : sell) : rc.theme.axisText;
    ctx.fillStyle = color;
    ctx.fillRect(x, Math.min(y1, y2), dpr, Math.max(dpr, Math.abs(y2 - y1)));
    if (hasBody) {
      const open = rc.priceScale.priceToY(b.open as number) * dpr, close = rc.priceScale.priceToY(b.close as number) * dpr;
      ctx.fillRect(x - bodyWidth / 2, Math.min(open, close), bodyWidth, Math.max(dpr, Math.abs(close - open)));
    }
  }

  private _cell(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, cell: FootprintCell,
    x: number, y: number, w: number, h: number, value: number, peak: number, textPeak: number, color: string,
    buy: string, sell: string, bg: string, hot: boolean, alpha: number, side: 'bid' | 'ask' | 'single',
    paint?: CellPaint): void {
    if (w <= 0 || h <= 0) return;
    // A fixed fill (the `imbalance` view's plain and imbalanced cells) is a
    // whole cell, never a profile bar.
    const o = this._opts, dpr = rc.dpr, profile = o.cellStyle === 'profile' && paint?.fill === undefined;
    // A caller grading on something other than the cell's own share, a row
    // coloured by its delta, or the flat half of a `deltaVolume` pair, hands
    // the share over rather than having it inferred from the number shown.
    const strength = Math.max(0, Math.min(1, paint?.tint ?? (peak > 0 ? Math.abs(value) / peak : 0)));
    // An opaque plate replaces the pane background as the colour a cell ramps
    // from, so a one-lot row is legible instead of being a hole in the ladder.
    const base = o.cellBaseColor ?? bg;
    const fill = paint?.fill ?? paint?.style?.fill ?? (hot ? color : mix(base, color, this._ramp(strength)));
    const fillW = profile ? w * strength : w;
    const fillX = profile && side === 'bid' ? x + w - fillW : x;
    if (fillW > 0) {
      ctx.fillStyle = fill;
      // A heatmap cell is drawn as a path only when it has a corner to draw. A
      // row squeezed below a device pixel of radius shows no arc at any zoom,
      // and a path-and-fill per cell is the expensive way to paint one: a
      // zero-filled ladder at three pixels of bar spacing asks for six figures
      // of them in a frame. The cluster and profile styles are square by
      // design and keep their own path. Nothing here reads the text threshold,
      // hiding the numbers by configuration must not round off a tall row.
      const rounded = o.cellStyle === 'heatmap' || (o.cellStyle === 'profile' && !profile);
      const radius = rounded ? Math.min(o.radius * dpr, h / 2, fillW / 2) : 0;
      if (!rounded || radius >= 1) {
        ctx.beginPath();
        ctx.roundRect(fillX, y, fillW, h, radius);
        ctx.fill();
      } else {
        ctx.fillRect(fillX, y, fillW, h);
      }
    }
    if (alpha <= 0 || h < o.font * dpr * 0.6) return;
    const label = paint?.label ?? this._format(value / o.volumeDivisor), textW = ctx.measureText(label).width;
    if (textW + 4 * dpr > w) return;
    ctx.textAlign = profile && side !== 'single' ? (side === 'bid' ? 'right' : 'left') : 'center';
    const tx = profile && side !== 'single' ? (side === 'bid' ? x + w - 2 * dpr : x + 2 * dpr) : x + w / 2;
    const left = ctx.textAlign === 'right' ? tx - textW : ctx.textAlign === 'left' ? tx : tx - textW / 2;
    const right = left + textW;
    let background = fill;
    if (profile) {
      if (fillW === 0 || right <= fillX || left >= fillX + fillW) background = bg;
      else if (left < fillX || right > fillX + fillW) {
        // A number crossing a bright profile edge cannot contrast with both
        // surfaces. Give the glyphs one opaque backplate on that row.
        background = bg; ctx.fillStyle = bg;
        ctx.fillRect(left - dpr, y, textW + 2 * dpr, h);
      }
    }
    const neutral = o.textColor ?? readableTextColor(rc.theme.axisText, bg);
    // A pinned ink is used as given: a host that chose an exact colour for its
    // ladder means it, and a contrast correction would quietly move it. The
    // signed half of a `deltaVolume` row pins its own, so the sign survives
    // whatever the theme says.
    const pinned = hot ? paint?.style?.textHot ?? o.cellTextColorHot : paint?.style?.text ?? o.cellTextColor;
    const text = pinned ?? footprintTextColor({ mode: o.textColorMode, side: paint?.textSide ?? side, bidVol: cell.bidVol, askVol: cell.askVol,
      peak: textPeak, hot, neutral, buy: o.buyTextColor ?? buy, sell: o.sellTextColor ?? sell, background });
    // Zero-filled rows are context, not content: dimmer so the traded ladder
    // still reads at a glance.
    ctx.fillStyle = withAlpha(text, value === 0 ? alpha * 0.45 : alpha);
    ctx.fillText(label, tx, y + h / 2);
  }

  private _drawCard(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, col: Column, p: Palette, cellBottom: number): void {
    const o = this._opts, dpr = rc.dpr;
    if (col.width < 68 || col.rows.length === 0) return;
    const labels = o.showDeltaLabels && col.width >= 24 ? o.font + 7 : 0;
    const flip = this._signals.bars[col.index]?.flip === 1 ? Math.min(12, Math.max(6, col.width / 5)) + 2 : 0;
    const top = this._columnBottom(rc, col) + 8 + labels + flip, height = o.statsRows.length * o.statsRowHeight + 8;
    if (top < 0 || top + height > cellBottom) return;
    col.card = { top, bottom: top + height };
    const fill = mix(p.bg, rc.theme.axisText, 0.13);
    ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(col.x0 * dpr, top * dpr, col.width * dpr, height * dpr, 2 * dpr); ctx.fill();
    ctx.font = `${Math.max(8, o.font - 1) * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    o.statsRows.forEach((row, i) => {
      const value = this._metric(col.stats, row), text = this._statText(col.stats, row);
      const y = (top + 4 + (i + 0.5) * o.statsRowHeight) * dpr;
      const label = STAT_LABEL[row];
      if (ctx.measureText(label).width + ctx.measureText(text).width + 12 * dpr > col.width * dpr) return;
      ctx.textAlign = 'left'; ctx.fillStyle = readableTextColor(o.textColor ?? rc.theme.axisText, fill);
      ctx.fillText(label, (col.x0 + 4) * dpr, y);
      ctx.textAlign = 'right';
      const neutral = row === 'session' ? o.sessionColor ?? o.textColor ?? rc.theme.axisText : o.textColor ?? rc.theme.axisText;
      ctx.fillStyle = readableTextColor(this._statColor(row, value, neutral, o.buyTextColor ?? p.buy, o.sellTextColor ?? p.sell), fill);
      ctx.fillText(text, (col.x0 + col.width - 4) * dpr, y);
    });
  }

  private _drawFooter(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, p: Palette, height: number, rows: readonly FootprintStatRow[]): void {
    const o = this._opts, dpr = rc.dpr, top = rc.plotHeight - height, { buy, sell } = p, bg = o.tableBackground ?? p.bg;
    const labelWidth = Math.min(o.tableLabelWidth, rc.plotWidth);
    ctx.fillStyle = bg; ctx.fillRect(0, top * dpr, rc.plotWidth * dpr, height * dpr);
    ctx.font = `${Math.max(8, o.font - 0.5) * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'center';
    const slot = rc.timeScale.barSpacing;
    for (const col of this._cols) {
      const x = rc.timeScale.indexToX(rc.dataLayer.timeToIndex(col.bar.time)!);
      const left = Math.max(labelWidth, x - slot / 2), right = Math.min(rc.plotWidth, x + slot / 2);
      if (left < right) col.table = { left, right, top, bottom: rc.plotHeight };
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(labelWidth * dpr, top * dpr, (rc.plotWidth - labelWidth) * dpr, height * dpr); ctx.clip();
    rows.forEach((row, i) => {
      // A ratio lives below one, so it alone is shaded against its own peak.
      let peak = row === 'cvdRatio' ? 0 : 1;
      for (const col of this._cols) if (col.table) peak = Math.max(peak, Math.abs(this._metric(col.stats, row) ?? 0));
      for (const col of this._cols) {
        if (!col.table) continue;
        const value = this._metric(col.stats, row), v = value ?? 0;
        // Session letters alternate shade per period, so a new letter stands out.
        const weight = row === 'session' ? (col.stats.session.charCodeAt(0) % 2 ? 0.3 : 0.15) : 0.1 + 0.4 * (peak > 0 ? Math.abs(v) / peak : 0);
        const fill = mix(bg, this._statColor(row, value, rc.theme.axisText, buy, sell), weight);
        const x = rc.timeScale.indexToX(rc.dataLayer.timeToIndex(col.bar.time)!);
        const y = (top + i * o.statsRowHeight) * dpr;
        ctx.fillStyle = fill;
        ctx.fillRect((x - slot / 2) * dpr, y + dpr, Math.max(0, slot * dpr - dpr), Math.max(0, o.statsRowHeight * dpr - dpr));
        const text = this._statText(col.stats, row);
        const halfText = ctx.measureText(text).width / (2 * dpr) + 2;
        if (x - halfText < col.table.left || x + halfText > col.table.right) continue;
        ctx.fillStyle = readableTextColor(row === 'session' ? o.sessionColor ?? o.textColor ?? rc.theme.axisText : o.textColor ?? rc.theme.axisText, fill);
        ctx.fillText(text, x * dpr, y + o.statsRowHeight * dpr / 2);
      }
    });
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(0, top * dpr, labelWidth * dpr, height * dpr); ctx.clip();
    const labelFill = mix(bg, rc.theme.axisText, 0.09);
    ctx.fillStyle = labelFill; ctx.fillRect(0, top * dpr, labelWidth * dpr, height * dpr);
    ctx.fillStyle = readableTextColor(o.textColor ?? rc.theme.axisText, labelFill); ctx.textAlign = 'left';
    rows.forEach((row, i) => ctx.fillText(TABLE_LABEL[row], 6 * dpr, (top + (i + 0.5) * o.statsRowHeight) * dpr));
    ctx.restore();
    ctx.strokeStyle = mix(bg, rc.theme.axisText, 0.25); ctx.lineWidth = dpr; ctx.beginPath();
    for (let i = 0; i <= rows.length; i++) {
      const y = (top + i * o.statsRowHeight) * dpr;
      ctx.moveTo(0, y); ctx.lineTo(rc.plotWidth * dpr, y);
    }
    ctx.moveTo(labelWidth * dpr, top * dpr); ctx.lineTo(labelWidth * dpr, rc.plotHeight * dpr); ctx.stroke();
  }
  private _statColor(row: FootprintStatRow, value: number | null, neutral: string, buy: string, sell: string): string {
    if (row === 'session') return neutral;
    if (value === null || value === 0 || row === 'volume' || row === 'trades' || row === 'cumVolume') return neutral;
    if (row === 'askVolume') return buy;
    if (row === 'bidVolume') return sell;
    return value > 0 ? buy : sell;
  }
  private _metric(s: FootprintBarStats, row: FootprintStatRow): number | null { return row === 'session' ? null : s[row]; }
  private _statText(s: FootprintBarStats, row: FootprintStatRow): string {
    if (row === 'session') return s.session;
    const value = this._metric(s, row);
    if (value === null) return '-';
    if (row === 'deltaPct') return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
    if (row === 'cvdRatio') return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
    const displayed = row === 'trades' ? value : value / this._opts.volumeDivisor;
    const text = row === 'trades' ? compactVol(displayed) : this._format(displayed);
    return unsignedRow(row) || displayed < 0 ? text : '+' + text;
  }

  public hitTest(x: number, y: number): PrimitiveHit | null {
    const hover = this.hoverAt(x, y);
    return hover ? { externalId: `footprint:${hover.time}`, zOrder: 'normal', distance: 0, cursor: 'crosshair' } : null;
  }
  public hoverAt(x: number, y: number, rc?: PrimitiveRenderContext): FootprintHover | null {
    const context = rc ?? this._rc;
    if (!context || x < 0 || x > context.plotWidth || y < 0 || y > context.plotHeight) return null;
    const table = this._cols.find(c => c.table && x >= c.table.left && x < c.table.right && y >= c.table.top && y <= c.table.bottom);
    if (table) return { time: table.bar.time, price: null, cell: null, stats: table.stats };
    const col = this._cols.find(c => x >= c.x0 && x <= c.x0 + c.width);
    if (!col) return null;
    const row = col.rows.find(r => y >= r.top && y < r.bottom);
    if (row) return { time: col.bar.time, price: row.cell.price, cell: row.cell, stats: col.stats };
    if (col.card && y >= col.card.top && y <= col.card.bottom) return { time: col.bar.time, price: null, cell: null, stats: col.stats };
    return null;
  }
}
