/**
 * Trading visualization API (ARCHITECTURE.md §9). A data-driven layer on top of
 * the chart: your app pushes exchange state (positions, orders, trades) and the
 * chart renders labelled price-line "pills" (with a cancel/close button and
 * drag-to-modify) plus trade-fill markers; user interaction is relayed back as
 * `trading:*` events for the app to send to the exchange. Original,
 * framework-free API.
 */
import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext, ZOrder } from '../primitives/primitive';
import { PriceLine, type PriceLineOptions, type PriceLinePillSegment } from '../primitives/price-line';
import { contrastText, roundRectPath } from '../render/pill';

export type PositionSide = 'long' | 'short';
export type TradingOrderSide = 'buy' | 'sell';
export type TradingOrderType = 'limit' | 'stop' | 'stop_limit';
export type TradeMarkerVariant = 'chevron' | 'bubble' | 'count';
export type TradingLineVariant = 'standard' | 'line-only';
export type TradingLineStyle = 'solid' | 'dashed' | 'dotted';

export interface TradingPosition {
  id: string;
  side: PositionSide;
  entryPrice: number;
  size: number;
  pnlText?: string;
  pnlPercent?: string;
  color?: string;
  readOnly?: boolean;
  variant?: TradingLineVariant;
  /**
   * How far the line reaches, as a fraction of the plot width measured from
   * the price axis. Defaults to `DEFAULT_LINE_EXTENT`. Pass 1 for a line that
   * runs the whole width, which is what a trader reading a level across the
   * chart expects and what the line was already hit-testable across.
   */
  extentFromRight?: number;
  /**
   * Let this line widen the pane's autoscale range. Off by default for every
   * line the overlay draws: see `DEFAULT_LINE_AUTOSCALE`.
   */
  autoscale?: boolean;
  /**
   * Offer a take-profit / stop-loss button on the pill, emitting
   * `trading:position_tp` / `trading:position_sl` when tapped.
   *
   * The host decides when to show each one, because only the host knows
   * whether this position already has that leg working at the broker. They are
   * independent for the same reason: a position with a stop and no target
   * should offer the target alone.
   */
  tpButton?: boolean;
  slButton?: boolean;
}

export interface TradingOrder {
  id: string;
  type: TradingOrderType;
  side: TradingOrderSide;
  price: number;
  size: number;
  parentId?: string;
  bracketRole?: 'tp' | 'sl';
  color?: string;
  lineStyle?: TradingLineStyle;
  lineWidth?: number;
  readOnly?: boolean;
  draggable?: boolean;
  variant?: TradingLineVariant;
  /** Render an editable, unsubmitted order ticket directly on the price line. */
  draft?: boolean;
  /** Label for the draft submit action. Default `CONFIRM`. */
  confirmLabel?: string;
  /** See `TradingPosition.extentFromRight`. */
  extentFromRight?: number;
  /** See `TradingPosition.autoscale`. */
  autoscale?: boolean;
  /**
   * Free text on the pill after the type label, for what the line is worth
   * rather than what it is: the money a bracket makes or loses if it fills.
   * Pre-formatted, like `pnlText`, because currency and precision are the
   * host's business and this engine has no opinion on either.
   */
  note?: string;
}

export interface TradingTrade {
  id: string;
  side: TradingOrderSide;
  price: number;
  size: number;
  /** Execution time in milliseconds. */
  timestamp: number;
  variant?: TradeMarkerVariant;
  color?: string;
  label?: string;
}

export interface TradingSyncPayload {
  positions?: TradingPosition[];
  orders?: TradingOrder[];
  trades?: TradingTrade[];
}

export interface TradingColors {
  long: string;
  short: string;
  order: string;
  tp: string;
  sl: string;
  buy: string;
  sell: string;
}

export interface TradingSettings {
  longColor?: string;
  shortColor?: string;
  orderColor?: string;
  tpColor?: string;
  slColor?: string;
  buyColor?: string;
  sellColor?: string;
}

/** What the controller needs from the chart (the Chart implements this). */
export interface TradingHost {
  addPrimitive(p: IPrimitive): void;
  removePrimitive(p: IPrimitive): void;
  subscribeClick(cb: (externalId: string) => void): void;
  subscribeDrag(
    onDrag: (externalId: string, price: number) => void,
    onDragEnd?: (externalId: string, price: number) => void,
    /** The drag was taken away (a pinch began), not released. No price: nothing was chosen. */
    onDragCancel?: (externalId: string) => void,
  ): void;
  /** Optional: route trading events onto the chart's unified `chart.on(...)` bus. */
  emit?(event: string, payload: unknown): void;
}

export const DEFAULT_TRADING_COLORS: TradingColors = {
  long: '#2f6df6',
  short: '#ef5350',
  order: '#3b82f6',
  tp: '#26a69a',
  sl: '#ef5350',
  buy: '#26a69a',
  sell: '#ef5350',
};

const CLOSE_SUFFIX = '::close';
/**
 * How long a flatten stays armed after the first tap, in ms.
 *
 * Closing a position is irreversible and the ✕ sits a thumb's width from the
 * one that merely cancels a stop. Long enough to mean it, short enough that an
 * arming tap you walked away from cannot fire later.
 */
const CLOSE_CONFIRM_MS = 5_000;

/**
 * How far an overlay line reaches when the caller says nothing, and where its
 * pill sits in every case.
 *
 * Short by default because that is what this overlay has always drawn, and an
 * upgrade must not silently redraw an existing host's chart. The pill anchor
 * stays here whatever the line does: lengthening the line is about reading the
 * level, not about moving the buttons away from the price axis.
 */
const DEFAULT_LINE_EXTENT = 0.3;

/**
 * Whether an overlay line pulls the price scale open far enough to show
 * itself. It does not, and that is a deliberate reversal of what this overlay
 * used to do.
 *
 * Every line here is a `PriceLine`, and a `PriceLine` reported its price to
 * autoscale, so placing a stop a hundred points away re-fitted the whole scale
 * around it: the candles the trader was reading flattened into a band and the
 * chart jumped, from the act of placing an order. No terminal behaves that way.
 * The line keeps its axis tag, so an off-screen order is still marked at the
 * edge, and a host that genuinely wants a line to drag the view into range can
 * ask for it per entity.
 */
const DEFAULT_LINE_AUTOSCALE = false;

/**
 * Width floor, media px, for a pill segment that exists to be tapped. `TP`
 * measures about 27 px sized to its own glyphs, which is a fine mouse target
 * and a poor thumb one, and these buttons place real orders. The box grows;
 * the text stays where it is and centres inside it.
 */
// Minimum width of a tappable pill segment, in media px.
//
// 40 was a mouse's idea of a button; 56 was mine and the user's verdict on it
// was that nothing had changed. 64 is close to the width of a thumb pad, which
// is the actual constraint, and five segments at that width still fit inside
// the 380 px viewport he is testing on.
const TOUCH_SEGMENT_W = 64;

/** Nearest bar index to a UTC-seconds time (binary search over the sorted times). */
function snapToIndex(dl: { length: number; indexToTime(i: number): number | undefined }, timeSec: number): number | undefined {
  const n = dl.length;
  if (n === 0) return undefined;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const tm = dl.indexToTime(mid);
    if (tm !== undefined && tm <= timeSec) lo = mid; else hi = mid - 1;
  }
  const t0 = dl.indexToTime(lo);
  if (t0 === undefined) return undefined;
  if (lo + 1 < n) {
    const t1 = dl.indexToTime(lo + 1);
    if (t1 !== undefined && Math.abs(t1 - timeSec) < Math.abs(t0 - timeSec)) return lo + 1;
  }
  return lo;
}

function drawChevron(ctx: CanvasRenderingContext2D, x: number, y: number, side: TradingOrderSide, color: string, dpr: number): void {
  const s = 5 * dpr;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (side === 'buy') { ctx.moveTo(x, y - s * 1.5); ctx.lineTo(x - s, y); ctx.lineTo(x + s, y); }
  else { ctx.moveTo(x, y + s * 1.5); ctx.lineTo(x - s, y); ctx.lineTo(x + s, y); }
  ctx.closePath();
  ctx.fill();
}

function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, text: string, dpr: number): void {
  const r = 9 * dpr;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (text !== '') {
    ctx.fillStyle = contrastText(color);
    ctx.font = `500 ${9 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5 * dpr);
  }
}

function drawCount(ctx: CanvasRenderingContext2D, x: number, y: number, count: number, color: string, dpr: number): void {
  const text = String(count);
  ctx.font = `500 ${9 * dpr}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 10 * dpr;
  const h = 15 * dpr;
  ctx.fillStyle = color;
  ctx.beginPath();
  roundRectPath(ctx, Math.round(x - w / 2), Math.round(y - h / 2), Math.round(w), Math.round(h), 3 * dpr);
  ctx.fill();
  ctx.fillStyle = contrastText(color);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5 * dpr);
}

/** Self-contained trade-fill markers (chevron / bubble / count) over the plot. */
export class TradeMarkersPrimitive implements IPrimitive {
  private _trades: TradingTrade[] = [];
  private _colors: TradingColors;
  private _host: PrimitiveHost | null = null;

  public constructor(colors: TradingColors) { this._colors = colors; }
  public attached(host: PrimitiveHost): void { this._host = host; }
  public detached(): void { this._host = null; }
  public zOrder(): ZOrder { return 'top'; }
  public autoscaleInfo(): null { return null; }

  public setTrades(trades: TradingTrade[]): void { this._trades = trades; this._host?.requestUpdate(); }
  public setColors(colors: TradingColors): void { this._colors = colors; this._host?.requestUpdate(); }

  public draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext): void {
    if (this._trades.length === 0) return;
    const dpr = rc.dpr;
    const groups = new Map<string, { index: number; sumPS: number; sumS: number; n: number; color: string }>();
    ctx.save();
    for (const t of this._trades) {
      const idx = snapToIndex(rc.dataLayer, Math.floor(t.timestamp / 1000));
      if (idx === undefined) continue;
      const x = Math.round(rc.timeScale.indexToX(idx) * dpr);
      const color = t.color ?? (t.side === 'buy' ? this._colors.buy : this._colors.sell);
      const variant = t.variant ?? 'chevron';
      if (variant === 'count') {
        const key = `${idx}:${t.side}`;
        let g = groups.get(key);
        if (g === undefined) { g = { index: idx, sumPS: 0, sumS: 0, n: 0, color }; groups.set(key, g); }
        g.sumPS += t.price * t.size; g.sumS += t.size; g.n += 1;
        continue;
      }
      const y = Math.round(rc.priceScale.priceToY(t.price) * dpr);
      if (variant === 'bubble') drawBubble(ctx, x, y, color, t.label ?? (t.side === 'buy' ? 'B' : 'S'), dpr);
      else drawChevron(ctx, x, y, t.side, color, dpr);
    }
    for (const g of groups.values()) {
      const vwap = g.sumS > 0 ? g.sumPS / g.sumS : 0;
      const x = Math.round(rc.timeScale.indexToX(g.index) * dpr);
      const y = Math.round(rc.priceScale.priceToY(vwap) * dpr);
      drawCount(ctx, x, y, g.n, g.color, dpr);
    }
    ctx.restore();
  }
}

interface Tracked<E> { entity: E; line: PriceLine; sig: string; }

export class TradingController {
  private readonly _host: TradingHost;
  private readonly _positions = new Map<string, Tracked<TradingPosition>>();
  private readonly _orders = new Map<string, Tracked<TradingOrder>>();
  private readonly _trades = new Map<string, TradingTrade>();
  private readonly _listeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly _dragPrev = new Map<string, number>();
  private _colors: TradingColors = { ...DEFAULT_TRADING_COLORS };
  private _markers: TradeMarkersPrimitive | null = null;
  /** Position id → when its close was armed, for the two-tap flatten. */
  private readonly _closeArmed = new Map<string, number>();

  public constructor(host: TradingHost) {
    this._host = host;
    host.subscribeClick((externalId) => this._onClick(externalId));
    host.subscribeDrag(
      (externalId, price) => this._onDrag(externalId, price),
      (externalId, price) => this._onDragEnd(externalId, price),
      (externalId) => this._onDragCancel(externalId),
    );
  }

  // ── events ────────────────────────────────────────────────────────────────
  public on(event: string, cb: (payload: unknown) => void): () => void {
    let set = this._listeners.get(event);
    if (set === undefined) { set = new Set(); this._listeners.set(event, set); }
    set.add(cb);
    return () => { this._listeners.get(event)?.delete(cb); };
  }

  public off(event: string, cb: (payload: unknown) => void): void {
    this._listeners.get(event)?.delete(cb);
  }

  private _emit(event: string, payload: unknown): void {
    const set = this._listeners.get(event);
    if (set !== undefined) for (const cb of set) cb(payload);
    // Mirror onto the chart's unified bus so `chart.on('trading:...')` works too.
    this._host.emit?.(event, payload);
  }

  // ── settings ────────────────────────────────────────────────────────────────
  public setSettings(settings: TradingSettings): void {
    if (settings.longColor !== undefined) this._colors.long = settings.longColor;
    if (settings.shortColor !== undefined) this._colors.short = settings.shortColor;
    if (settings.orderColor !== undefined) this._colors.order = settings.orderColor;
    if (settings.tpColor !== undefined) this._colors.tp = settings.tpColor;
    if (settings.slColor !== undefined) this._colors.sl = settings.slColor;
    if (settings.buyColor !== undefined) this._colors.buy = settings.buyColor;
    if (settings.sellColor !== undefined) this._colors.sell = settings.sellColor;
    // re-render existing entities with the new colors
    this.setPositions(this.getPositions());
    this.setOrders(this.getOrders());
    this._markers?.setColors(this._colors);
  }

  public getSettings(): TradingColors { return { ...this._colors }; }

  // ── data ──────────────────────────────────────────────────────────────────
  public setPositions(positions: readonly TradingPosition[]): void { this._sync(this._positions, positions, 'pos'); }
  public setOrders(orders: readonly TradingOrder[]): void { this._sync(this._orders, orders, 'ord'); }

  public setTrades(trades: readonly TradingTrade[]): void {
    this._trades.clear();
    for (const t of trades) this._trades.set(t.id, t);
    this._renderTrades();
  }

  public addTrade(trade: TradingTrade): void {
    this._trades.set(trade.id, trade);
    this._renderTrades();
  }

  public upsertOrder(order: TradingOrder): void {
    const next = this.getOrders().filter((o) => o.id !== order.id);
    next.push(order);
    this.setOrders(next);
  }

  public removeOrder(id: string): void {
    const next = this.getOrders().filter((o) => o.id !== id && o.parentId !== id);
    this.setOrders(next);
  }

  public syncState(payload: TradingSyncPayload): void {
    if (payload.positions !== undefined) this.setPositions(payload.positions);
    if (payload.orders !== undefined) this.setOrders(payload.orders);
    if (payload.trades !== undefined) this.setTrades(payload.trades);
  }

  /**
   * The money on a position pill, patched onto the live line.
   *
   * This is the path P&L is meant to take: it moves on every print, and a host
   * that pushed it through `syncState` instead re-asserted every stored price
   * at that rate — which fights a drag in progress. See `_sig`.
   *
   * A position draws its money in one of two places, so this writes to
   * whichever one it is using: the left label on the classic pill, and a
   * segment on the pill that carries TP/SL/✕ buttons. Patching only the label
   * left the number frozen on exactly the pills a trader watches, since the
   * host asks for those buttons whenever a leg is missing.
   */
  public updatePositionPnl(
    id: string,
    unrealizedPnl: number | null,
    pnlText?: string | null,
    pnlPercent?: string | null,
  ): void {
    const cur = this._positions.get(id);
    if (cur === undefined) return;
    // `undefined` means "leave it alone", `null` means "take it off". Without
    // the second, a pill kept its last number forever once the host stopped
    // being able to price one — no last trade, an unknown contract — and a
    // stale P&L is read as a live one.
    const entity = { ...cur.entity };
    if (pnlText !== undefined) entity.pnlText = pnlText ?? undefined;
    if (pnlPercent !== undefined) entity.pnlPercent = pnlPercent ?? undefined;
    void unrealizedPnl;
    // A copy, not a mutation: the entity is the host's own object, and a
    // controller that writes into it makes the host's state disagree with the
    // broker's without the host ever being told.
    cur.entity = entity;
    const opts = this._positionOpts(entity);
    // The pill's first money also changes the segment COUNT, and the signature
    // counts segments: recorded here, the next sync patches the line instead
    // of tearing it down over a change already applied.
    cur.sig = this._sig(opts);
    if (opts.pillSegments !== undefined) cur.line.setOptions({ pillSegments: opts.pillSegments });
    else if (opts.leftLabel !== undefined) cur.line.setLeftLabel(opts.leftLabel);
  }

  public getPositions(): TradingPosition[] { return [...this._positions.values()].map((t) => t.entity); }
  public getOrders(): TradingOrder[] { return [...this._orders.values()].map((t) => t.entity); }
  public getTrades(): TradingTrade[] { return [...this._trades.values()]; }

  public clear(): void {
    for (const t of this._positions.values()) this._host.removePrimitive(t.line);
    for (const t of this._orders.values()) this._host.removePrimitive(t.line);
    this._positions.clear();
    this._orders.clear();
    this._trades.clear();
    if (this._markers !== null) { this._host.removePrimitive(this._markers); this._markers = null; }
  }

  // ── rendering ───────────────────────────────────────────────────────────────
  private _renderTrades(): void {
    if (this._markers === null) {
      this._markers = new TradeMarkersPrimitive(this._colors);
      this._host.addPrimitive(this._markers);
    }
    this._markers.setTrades(this.getTrades());
  }

  private _sync<E extends { id: string }>(map: Map<string, Tracked<E>>, list: readonly E[], kind: 'pos' | 'ord'): void {
    const seen = new Set<string>();
    for (const entity of list) {
      seen.add(entity.id);
      const opts = kind === 'pos'
        ? this._positionOpts(entity as unknown as TradingPosition)
        : this._orderOpts(entity as unknown as TradingOrder);
      const sig = this._sig(opts);
      const cur = map.get(entity.id);
      /**
       * A line under the finger keeps the price under the finger.
       *
       * The broker's price is still taken onto the entity — it is what the
       * next sync after the release draws — but writing it to the primitive
       * mid-drag is the whole of the "dragging jumps" bug: a host re-syncs
       * whenever anything in its payload moves (a position's P&L moves on
       * every tick), the line snapped back to the stored price, and the next
       * pointermove threw it forward again.
       */
      const held = kind === 'ord' && this._dragPrev.has(entity.id);
      if (cur !== undefined && cur.sig === sig) {
        cur.entity = entity;
        if (!held) cur.line.setPrice(opts.price);
        // Everything the signature left out, patched in place: same primitive,
        // same drag, new numbers.
        cur.line.setOptions({ leftLabel: opts.leftLabel, note: opts.note, pillSegments: opts.pillSegments });
      } else {
        if (cur !== undefined) this._host.removePrimitive(cur.line);
        // A rebuild while the line is held (its pill changed shape under the
        // finger) is the one place the held price has to be carried across by
        // hand: a fresh primitive would open at the broker's price and lose
        // the ghost marking where the drag began.
        const line = new PriceLine(held && cur !== undefined ? { ...opts, price: cur.line.price } : opts);
        if (held) {
          const from = this._dragPrev.get(entity.id);
          if (from !== undefined) line.setDragGhost(from);
        }
        this._host.addPrimitive(line);
        map.set(entity.id, { entity, line, sig });
      }
    }
    for (const [id, cur] of map) {
      if (!seen.has(id)) {
        this._host.removePrimitive(cur.line);
        map.delete(id);
        // Filled or cancelled while the finger was still down: the drag goes
        // with the line. Left behind, the entry would freeze the price of the
        // next order to carry this id, and hand `_onDragEnd` a `previousPrice`
        // from a gesture that ended on a different order.
        if (kind === 'ord') this._dragPrev.delete(id);
      }
    }
  }

  /**
   * What makes a line a DIFFERENT line: its colour, its interactions, the
   * shape of its pill. Text that moves with the market is deliberately absent
   * (a position's P&L, the money on a bracket, a draft's quantity): those are
   * patched onto the live primitive in `_sync`, and putting them here would
   * tear the line down and rebuild it on every tick, flickering it and
   * stranding any drag in progress.
   */
  private _sig(o: PriceLineOptions): string {
    const segments = o.pillSegments?.map((segment) =>
      `${segment.id ?? ''}:${segment.close === true}:${segment.fill ?? ''}`).join('|') ?? '';
    return `${o.color}|${o.dashed}|${o.closeButton === true}|${o.cursor ?? ''}|${o.leftLabel !== undefined}|${o.note !== undefined}|${o.badge ?? ''}|${o.qty ?? ''}|${o.extentFromRight ?? ''}|${o.autoscale === true}|${segments}`;
  }

  /** Info segment for a position: live P&L text (side/size live in badge/qty). */
  private _positionPill(p: TradingPosition): string {
    if (p.pnlText === undefined) return '';
    return `${p.pnlText}${p.pnlPercent !== undefined ? ` (${p.pnlPercent})` : ''}`;
  }

  /**
   * The pill as individually hit-testable segments, which is what it takes to
   * put buttons on it. Built only when the host asked for one, so a position
   * with no buttons keeps the classic badge/qty/label path and draws exactly
   * as it did.
   */
  private _positionSegments(p: TradingPosition, color: string): PriceLinePillSegment[] | undefined {
    // An ARMED close forces the segmented pill even when the host asked for no
    // buttons. The classic pill draws its ✕ through `closeButton`, which has no
    // armed state, so the first tap would arm in silence and the finger would
    // get no sign that anything had happened — the worst possible confirmation.
    // Once disarmed the pill returns to exactly what it was.
    if (p.tpButton !== true && p.slButton !== true && !this._closeIsArmed(p.id)) return undefined;
    const id = `pos:${p.id}`;
    const segments: PriceLinePillSegment[] = [
      { text: p.side.toUpperCase(), fill: color },
      { text: String(p.size) },
    ];
    const pnl = this._positionPill(p);
    if (pnl !== '') segments.push({ text: pnl });
    if (p.tpButton === true) segments.push({ id: `${id}::tp`, text: 'TP', fill: this._colors.tp, minWidth: TOUCH_SEGMENT_W });
    if (p.slButton === true) segments.push({ id: `${id}::sl`, text: 'SL', fill: this._colors.sl, minWidth: TOUCH_SEGMENT_W });
    if (p.readOnly !== true) {
      // Armed: the ✕ becomes a legible question rather than a symbol, because
      // a second ✕ would look identical to the first and give the finger no
      // sign that anything changed.
      const armed = this._closeIsArmed(p.id);
      segments.push(armed
        ? { id: `${id}${CLOSE_SUFFIX}`, text: 'SIGUR?', fill: this._colors.sl, minWidth: TOUCH_SEGMENT_W }
        : { id: `${id}${CLOSE_SUFFIX}`, close: true, minWidth: TOUCH_SEGMENT_W });
    }
    return segments;
  }

  /**
   * Put any armed flatten away.
   *
   * The controller sees taps that HIT something; a tap on empty chart is
   * delivered to the host as a `click` with a null id, so the host calls this
   * — which is also the natural place to call it from a symbol change or a
   * panel closing. Safe to call when nothing is armed.
   */
  public disarmClose(positionId?: string): void {
    if (this._closeArmed.size === 0) return;
    if (positionId === undefined) this._closeArmed.clear();
    else this._closeArmed.delete(positionId);
    this._sync(this._positions, [...this._positions.values()].map((t) => t.entity), 'pos');
  }

  /** Is this position's close waiting for its confirming second tap? */
  private _closeIsArmed(id: string): boolean {
    const armedAt = this._closeArmed.get(id);
    return armedAt !== undefined && Date.now() - armedAt < CLOSE_CONFIRM_MS;
  }

  private _positionOpts(p: TradingPosition): PriceLineOptions {
    const lineOnly = p.variant === 'line-only';
    const color = p.color ?? (p.side === 'long' ? this._colors.long : this._colors.short);
    const pillSegments = lineOnly ? undefined : this._positionSegments(p, color);
    return {
      price: p.entryPrice,
      color,
      lineWidth: 2,
      dashed: false,
      id: `pos:${p.id}`,
      badge: lineOnly || pillSegments !== undefined ? undefined : p.side.toUpperCase(),
      qty: lineOnly || pillSegments !== undefined ? undefined : p.size,
      leftLabel: lineOnly || pillSegments !== undefined ? undefined : this._positionPill(p),
      pillSegments,
      closeButton: !lineOnly && pillSegments === undefined && p.readOnly !== true,
      extentFromRight: p.extentFromRight ?? DEFAULT_LINE_EXTENT,
      pillInsetFromRight: DEFAULT_LINE_EXTENT,
      autoscale: p.autoscale ?? DEFAULT_LINE_AUTOSCALE,
    };
  }

  private _orderOpts(o: TradingOrder): PriceLineOptions {
    const lineOnly = o.variant === 'line-only';
    const draggable = !lineOnly && (o.draggable ?? o.readOnly !== true);
    const color = o.color ?? (o.draft === true ? (o.side === 'buy' ? this._colors.buy : this._colors.sell)
      : o.bracketRole === 'tp' ? this._colors.tp
      : o.bracketRole === 'sl' ? this._colors.sl
        : this._colors.order);
    const id = `ord:${o.id}`;
    const pillSegments = !lineOnly && o.draft === true ? [
      { id: `${id}::side`, text: o.side.toUpperCase(), fill: color },
      { id: `${id}::qty_dec`, text: '-' },
      { id: `${id}::qty`, text: String(o.size) },
      { id: `${id}::qty_inc`, text: '+' },
      { id: `${id}::type`, text: o.type.replace('_', ' ').toUpperCase() },
      { id: `${id}::confirm`, text: o.confirmLabel ?? 'CONFIRM', fill: this._colors.order },
      { id: `${id}::close`, close: true },
    ] : undefined;
    return {
      price: o.price,
      color,
      lineWidth: o.lineWidth ?? 1,
      dashed: (o.lineStyle ?? 'solid') !== 'solid',
      id,
      badge: lineOnly || o.draft === true ? undefined : (o.bracketRole ?? o.side).toUpperCase(),
      qty: lineOnly || o.draft === true ? undefined : o.size,
      leftLabel: lineOnly || o.bracketRole !== undefined || o.draft === true ? undefined : o.type.replace('_', ' ').toUpperCase(),
      note: lineOnly || o.draft === true ? undefined : o.note,
      pillSegments,
      closeButton: !lineOnly && o.draft !== true && o.readOnly !== true,
      extentFromRight: o.extentFromRight ?? DEFAULT_LINE_EXTENT,
      pillInsetFromRight: DEFAULT_LINE_EXTENT,
      autoscale: o.autoscale ?? DEFAULT_LINE_AUTOSCALE,
      cursor: draggable ? 'ns-resize' : undefined,
    };
  }

  // ── interaction ─────────────────────────────────────────────────────────────
  private _onClick(externalId: string): void {
    // Anything that is not the armed ✕ itself puts the confirmation away. An
    // armed control the user has moved on from is a trap left on the chart:
    // the next tap in that spot flattens a position he stopped thinking about
    // several actions ago.
    if (this._closeArmed.size > 0 && !externalId.endsWith(CLOSE_SUFFIX)) this.disarmClose();
    if (externalId.endsWith(CLOSE_SUFFIX)) {
      const base = externalId.slice(0, -CLOSE_SUFFIX.length);
      if (base.startsWith('ord:')) {
        const id = base.slice(4);
        if (this._orders.has(id)) this._emit('trading:order_cancel', { orderId: id });
      } else if (base.startsWith('pos:')) {
        const id = base.slice(4);
        if (!this._positions.has(id)) return;
        // Two taps to flatten. The first arms and repaints the segment as a
        // question; the second, inside the window, closes. A confirm dialog was
        // the obvious alternative and is the wrong one on a phone: it covers
        // the chart you are deciding from, and two quick taps are faster than
        // reading and dismissing it.
        const armedAt = this._closeArmed.get(id);
        if (armedAt !== undefined && Date.now() - armedAt < CLOSE_CONFIRM_MS) {
          this._closeArmed.delete(id);
          this._emit('trading:position_close', { positionId: id });
        } else {
          this._closeArmed.set(id, Date.now());
          this._emit('trading:position_close_armed', { positionId: id });
        }
        // Repaint so the segment shows its new state. The positions are
        // already in hand, so this is a re-sync of what we hold, not a
        // round trip to the host.
        this._sync(this._positions, [...this._positions.values()].map((t) => t.entity), 'pos');
      }
      return;
    }
    if (externalId.startsWith('pos:') && externalId.includes('::')) {
      const separator = externalId.indexOf('::');
      const id = externalId.slice(4, separator);
      const action = externalId.slice(separator + 2);
      if (!this._positions.has(id)) return;
      if (action === 'tp') this._emit('trading:position_tp', { positionId: id });
      else if (action === 'sl') this._emit('trading:position_sl', { positionId: id });
      return;
    }
    if (externalId.startsWith('ord:') && externalId.includes('::')) {
      const separator = externalId.indexOf('::');
      const id = externalId.slice(4, separator);
      const action = externalId.slice(separator + 2);
      const cur = this._orders.get(id);
      if (cur === undefined || cur.entity.draft !== true) return;
      if (action === 'confirm') {
        this._emit('trading:order_submit', { order: { ...cur.entity } });
        return;
      }
      const patch: Partial<TradingOrder> = action === 'side'
        ? { side: cur.entity.side === 'buy' ? 'sell' : 'buy' }
        : action === 'qty_dec'
          ? { size: Math.max(1, cur.entity.size - 1) }
          : action === 'qty_inc'
            ? { size: cur.entity.size + 1 }
            : action === 'type'
              ? { type: cur.entity.type === 'limit' ? 'stop' : 'limit' }
              : {};
      if (Object.keys(patch).length === 0) return;
      const order = { ...cur.entity, ...patch };
      this.upsertOrder(order);
      this._emit('trading:order_draft_change', { order: { ...order } });
      return;
    }
    // pill-body click
    if (externalId.startsWith('ord:')) {
      const cur = this._orders.get(externalId.slice(4));
      if (cur !== undefined) this._emit('trading:order_click', { order: cur.entity });
    } else if (externalId.startsWith('pos:')) {
      const cur = this._positions.get(externalId.slice(4));
      if (cur !== undefined) this._emit('trading:position_click', { position: cur.entity });
    }
  }

  private _onDrag(externalId: string, price: number): void {
    if (!externalId.startsWith('ord:')) return;
    const cur = this._orders.get(externalId.slice(4));
    if (cur === undefined) return;
    const id = externalId.slice(4);
    if (!this._dragPrev.has(id)) {
      this._dragPrev.set(id, cur.entity.price);
      cur.line.setDragGhost(cur.entity.price); // dimmed pre-drag reference line
    }
    cur.line.setPrice(price);
  }

  private _onDragEnd(externalId: string, price: number): void {
    if (!externalId.startsWith('ord:')) return;
    const id = externalId.slice(4);
    const cur = this._orders.get(id);
    // Where the line stood when the finger landed, which a sync arriving
    // mid-drag cannot move: it replaces the tracked entity, not this.
    const from = this._dragPrev.get(id);
    // The gesture is over whether or not the order survived it.
    this._dragPrev.delete(id);
    // Filled or cancelled mid-drag: there is no line left to move and nothing
    // at the broker to modify. End quietly rather than emit against a dead id.
    if (cur === undefined) return;
    const previousPrice = from ?? cur.entity.price;
    cur.line.setDragGhost(null);
    // The optimistic price goes on a COPY. The entity is the host's own object
    // — often an element of a memoised array it re-sends — and writing the
    // dragged price into it meant a broker that REFUSED the modification had
    // nothing to revert to: the host pushed the same array back and the line
    // stayed where the finger left it, describing an order that does not exist.
    cur.entity = { ...cur.entity, price };
    cur.line.setPrice(price);
    if (cur.entity.bracketRole !== undefined) {
      this._emit('trading:bracket_modify', { parentId: cur.entity.parentId, bracketRole: cur.entity.bracketRole, newPrice: price });
    } else {
      this._emit('trading:order_modify', { orderId: id, newPrice: price, previousPrice });
    }
  }

  /**
   * The drag was taken away rather than finished: a second finger landed and
   * the chart turned the gesture into a pinch.
   *
   * The line goes back to the price the broker has for it and NOTHING is
   * emitted. A pinch is a zoom, and a zoom must never move an order. Without
   * this the line stayed where the finger left it for the rest of its life —
   * the releases that end a pinch never reach `_onDragEnd`, so the id would sit
   * in `_dragPrev` forever and every sync would keep declining to correct it.
   */
  private _onDragCancel(externalId: string): void {
    if (!externalId.startsWith('ord:')) return;
    const id = externalId.slice(4);
    if (!this._dragPrev.delete(id)) return; // not a drag this controller was holding
    const cur = this._orders.get(id);
    if (cur === undefined) return;
    cur.line.setDragGhost(null);
    // The entity's price rather than the one remembered at the press: they are
    // the same number unless a sync arrived mid-drag, and in that case the
    // broker's newer price is the one a cancelled gesture should leave behind.
    cur.line.setPrice(cur.entity.price);
  }
}
