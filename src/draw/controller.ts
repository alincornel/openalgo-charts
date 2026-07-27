/**
 * Drawing controller — the interaction and persistence layer over
 * `DrawingLayer`. It is **headless**: no DOM, no toolbar. A host sets the
 * active tool (from its own button, a shortcut, a command palette) and the
 * controller runs placement, selection, dragging, undo, and serialisation.
 *
 * It listens on the chart's event bus (`click`, `crosshair:move`, `drag`,
 * `drag:end`) rather than the single-slot `subscribeClick`/`subscribeDrag`
 * callbacks, so a host keeps using those for its own order lines.
 */
import type { Chart } from '../core/chart';
import type { Drawing, DrawingPoint, DrawingStyle, DrawingTool } from './types';
import { DrawingLayer } from './layer';
import { getDrawingTool, hasDrawingTool } from './tools';

export interface DrawingControllerOptions {
  /**
   * Snap new anchors to the nearest O/H/L/C of the bar under the cursor.
   * Default false.
   */
  magnet?: boolean;
  /** Style merged under every tool's own defaults. */
  defaultStyle?: DrawingStyle;
  /** Stay in the active tool after finishing a drawing. Default false. */
  stayInDrawingMode?: boolean;
  /** Undo depth. Default 50. */
  historyLimit?: number;
}

interface ClickPayload {
  id: string | null;
  time: number;
  price: number | null;
  paneIndex: number;
  point: { x: number; y: number };
  /** Set on the release half of a press-drag-release gesture. */
  viaDrag?: boolean;
}

interface DragPayload {
  id: string;
  price: number;
  time: number;
  paneIndex: number;
  /** Where the gesture was grabbed; deltas measure from here, not frame one. */
  fromPrice?: number;
  fromTime?: number;
}

let nextId = 1;

export class DrawingController {
  private readonly _chart: Chart;
  private _opts: Required<Omit<DrawingControllerOptions, 'defaultStyle'>> & { defaultStyle: DrawingStyle };
  private readonly _layers = new Map<number, DrawingLayer>();
  private _drawings: Drawing[] = [];
  private _tool: string | null = null;
  private _pending: DrawingPoint[] = [];
  private _pendingPane = 0;
  private _selected: string | null = null;
  /** Snapshots for undo/redo; each is a full drawing list (they are small). */
  private _undo: string[] = [];
  private _redo: string[] = [];
  private _dragStart: { id: string; handle: number | null; points: DrawingPoint[]; from: DrawingPoint } | null = null;
  private readonly _off: (() => void)[] = [];
  private _lastCursor: { time: number; price: number; paneIndex: number } | null = null;
  /** Bar under the cursor, carried by the crosshair event — used by magnet. */
  private _lastBar: { open: number; high: number; low: number; close: number } | null = null;

  public constructor(chart: Chart, options: DrawingControllerOptions = {}) {
    this._chart = chart;
    this._opts = {
      magnet: options.magnet ?? false,
      stayInDrawingMode: options.stayInDrawingMode ?? false,
      historyLimit: options.historyLimit ?? 50,
      defaultStyle: options.defaultStyle ?? {},
    };
    this._off.push(chart.on('click', (p) => this._onClick(p as ClickPayload)));
    this._off.push(chart.on('crosshair:move', (p) => this._onCrosshair(p as Record<string, unknown>)));
    this._off.push(chart.on('drag', (p) => this._onDrag(p as DragPayload)));
    this._off.push(chart.on('drag:end', () => this._onDragEnd()));
    this._off.push(chart.on('dblclick', () => { this.finish(); }));
    // Restore anything a previous session left in the chart state.
    const saved = chart.drawingState();
    if (Array.isArray(saved)) this._drawings = (saved as Drawing[]).map((d) => ({ ...d }));
    this._sync();
  }

  // ── public API ──────────────────────────────────────────────────────────

  /** Arm a tool for placement, or pass null to return to the cursor. */
  public setTool(toolId: string | null): void {
    if (toolId !== null && !hasDrawingTool(toolId)) {
      throw new Error(`openalgo-charts: unknown drawing tool "${toolId}"`);
    }
    this._tool = toolId;
    this._pending = [];
    this._setPlacementMode(toolId !== null);
    this._syncPreview();
    this._chart.emit('draw:tool', { tool: toolId });
  }

  /**
   * Ask the chart to stop panning and report gestures as anchor placement.
   * Guarded so a base bundle predating `setPlacementMode` still loads the tier.
   */
  private _setPlacementMode(active: boolean): void {
    const chart = this._chart as unknown as { setPlacementMode?: (a: boolean) => void };
    chart.setPlacementMode?.(active);
  }

  public activeTool(): string | null {
    return this._tool;
  }

  public setOptions(patch: DrawingControllerOptions): void {
    this._opts = { ...this._opts, ...patch, defaultStyle: patch.defaultStyle ?? this._opts.defaultStyle };
  }

  /** Every drawing, in creation order. */
  public drawings(): readonly Drawing[] {
    return this._drawings;
  }

  public get(id: string): Drawing | undefined {
    return this._drawings.find((d) => d.id === id);
  }

  /** Add a fully-specified drawing (import, or a host-authored one). */
  public add(drawing: Omit<Drawing, 'id'> & { id?: string }): Drawing {
    this._pushUndo();
    const tool = getDrawingTool(drawing.tool);
    const created: Drawing = {
      ...drawing,
      id: drawing.id ?? `d${nextId++}`,
      style: { ...this._opts.defaultStyle, ...tool.defaultStyle, ...drawing.style },
    };
    this._drawings.push(created);
    this._sync();
    this._chart.emit('draw:add', { drawing: created });
    return created;
  }

  public update(id: string, patch: Partial<Pick<Drawing, 'points' | 'style' | 'locked' | 'visible'>>): boolean {
    const d = this.get(id);
    if (d === undefined) return false;
    this._pushUndo();
    if (patch.points !== undefined) d.points = patch.points.map((p) => ({ ...p }));
    if (patch.style !== undefined) d.style = { ...d.style, ...patch.style };
    if (patch.locked !== undefined) d.locked = patch.locked;
    if (patch.visible !== undefined) d.visible = patch.visible;
    this._sync();
    this._chart.emit('draw:update', { drawing: d });
    return true;
  }

  public remove(id: string): boolean {
    const i = this._drawings.findIndex((d) => d.id === id);
    if (i < 0) return false;
    this._pushUndo();
    const [removed] = this._drawings.splice(i, 1);
    if (this._selected === id) this._selected = null;
    this._sync();
    this._chart.emit('draw:remove', { drawing: removed });
    return true;
  }

  public clear(): void {
    if (this._drawings.length === 0) return;
    this._pushUndo();
    this._drawings = [];
    this._selected = null;
    this._sync();
  }

  public select(id: string | null): void {
    this._selected = id;
    for (const layer of this._layers.values()) layer.setSelected(id);
    this._chart.emit('draw:select', { id });
  }

  public selected(): string | null {
    return this._selected;
  }

  public undo(): boolean {
    const snap = this._undo.pop();
    if (snap === undefined) return false;
    this._redo.push(JSON.stringify(this._drawings));
    this._drawings = JSON.parse(snap) as Drawing[];
    if (!this._drawings.some((d) => d.id === this._selected)) this._selected = null;
    this._sync();
    return true;
  }

  public redo(): boolean {
    const snap = this._redo.pop();
    if (snap === undefined) return false;
    this._undo.push(JSON.stringify(this._drawings));
    this._drawings = JSON.parse(snap) as Drawing[];
    this._sync();
    return true;
  }

  public canUndo(): boolean { return this._undo.length > 0; }
  public canRedo(): boolean { return this._redo.length > 0; }

  /** Serialisable payload — the same shape `ChartState.drawings` carries. */
  public toJSON(): Drawing[] {
    return this._drawings.map((d) => ({ ...d, points: d.points.map((p) => ({ ...p })), style: { ...d.style } }));
  }

  public fromJSON(data: unknown): void {
    this._drawings = Array.isArray(data) ? (data as Drawing[]).map((d) => ({ ...d })) : [];
    this._selected = null;
    this._undo = [];
    this._redo = [];
    this._sync();
  }

  public destroy(): void {
    this._setPlacementMode(false);   // never leave the chart unable to pan
    for (const off of this._off) off();
    this._off.length = 0;
    for (const [pane, layer] of this._layers) {
      void pane;
      this._chart.removePrimitive(layer);
    }
    this._layers.clear();
  }

  // ── interaction ─────────────────────────────────────────────────────────

  private _onCrosshair(p: Record<string, unknown>): void {
    const time = p.time as number | null;
    const price = p.price as number | null;
    const paneIndex = (p.paneIndex as number | null) ?? null;
    this._lastCursor = time === null || price === null || paneIndex === null
      ? null : { time, price, paneIndex };
    this._lastBar = (p.bar as { open: number; high: number; low: number; close: number } | null) ?? null;
    // Freehand tools ink while the pointer is held rather than on clicks.
    if (this._tool !== null && p.pressed === true && this._isFreehand()
      && time !== null && price !== null && paneIndex !== null
      && Number.isFinite(time) && Number.isFinite(price)) {
      this._inkPoint({ time, price }, paneIndex);
      return;
    }
    // A tool mid-placement previews against the live cursor.
    if (this._tool !== null && this._pending.length > 0) this._syncPreview();
  }

  /**
   * Let a tool turn the clicked anchors into its full set (the position tools
   * build a 1:1 box off one click). Identity for tools without the hook.
   */
  private _expand(tool: DrawingTool, clicked: DrawingPoint[]): DrawingPoint[] {
    if (tool.expand === undefined) return clicked;
    const dl = this._chart.dataLayer;
    const n = dl.baseIndex;
    // Bar spacing in seconds from the last gap; a one-bar chart has no gap to
    // read, so fall back to a minute rather than producing a zero-width default.
    const a = n > 0 ? dl.indexToTime(n - 1) : undefined;
    const b = n >= 0 ? dl.indexToTime(n) : undefined;
    const barSeconds = a !== undefined && b !== undefined && b > a ? b - a : 60;
    const range = this._chart.getVisibleLogicalRange();
    const visibleBars = range === null ? 60 : Math.max(1, range.to - range.from);
    return tool.expand(clicked, { barSeconds, visibleBars });
  }

  private _isFreehand(): boolean {
    return this._tool !== null && getDrawingTool(this._tool).freehand === true;
  }

  /**
   * Append one sample to the stroke in progress. Points arriving closer than a
   * bar-eighth apart in time carry no shape and would bloat the saved drawing,
   * so they collapse into the last one — a pointer can fire far faster than the
   * stroke actually changes direction.
   */
  private _inkPoint(point: DrawingPoint, paneIndex: number): void {
    if (this._pending.length === 0) {
      this._pendingPane = paneIndex;
    } else if (paneIndex !== this._pendingPane) {
      return;                       // a stroke belongs to the pane it started in
    } else {
      const last = this._pending[this._pending.length - 1];
      if (last.time === point.time && last.price === point.price) return;
    }
    this._pending.push(point);
    this._syncPreview();
  }

  /** Commit `pts` as a drawing of the armed tool and leave placement. */
  private _commit(pts: DrawingPoint[]): void {
    const tool = getDrawingTool(this._tool as string);
    const created = this.add({ tool: tool.id, points: pts, style: {}, paneIndex: this._pendingPane });
    this._pending = [];
    if (!this._opts.stayInDrawingMode) {
      this._tool = null;
      this._setPlacementMode(false);   // hand panning back to the chart
    }
    this._syncPreview();
    this.select(created.id);
    this._chart.emit('draw:tool', { tool: this._tool });
  }

  /** Commit the stroke a freehand gesture built, if it has any extent. */
  private _finishFreehand(): void {
    const pts = this._pending;
    this._pending = [];
    if (pts.length < 2) {           // a tap is not a stroke
      this._syncPreview();
      return;
    }
    this._commit(pts);
  }

  /**
   * End a variable-anchor shape (polyline, path) at the anchors placed so far.
   * Those tools declare `points: 0`, so nothing else can ever complete them —
   * without this they collected vertices forever. Bound to double-click, and
   * public so a host can offer Esc / Enter too. No-op when there is nothing
   * placeable, so a stray double-click costs nothing.
   */
  public finish(): boolean {
    if (this._tool === null || this._pending.length === 0) return false;
    const tool = getDrawingTool(this._tool);
    if (tool.points !== 0 || tool.freehand === true) return false;
    const pts = this._pending;
    if (pts.length < 2) {           // a single vertex is not a shape
      this._pending = [];
      this._syncPreview();
      return false;
    }
    this._commit(pts);
    return true;
  }

  private _onClick(p: ClickPayload): void {
    // Placement takes precedence: while a tool is armed, a click is an anchor.
    if (this._tool !== null) {
      // A freehand stroke was already collected move-by-move; the click pair a
      // drag produces is its end signal, not two more anchors.
      if (this._isFreehand()) {
        if (p.viaDrag === true) this._finishFreehand();
        return;
      }
      // The release half of a drag only means something while a shape is part
      // way through. A single-anchor tool (text, horizontal line) is already
      // finished by the press, so treating the release as another anchor would
      // drop a second drawing wherever the user let go.
      if (p.viaDrag === true && this._pending.length === 0) return;
      // Reject an unmappable click outright — a NaN anchor serialises as null
      // and produces a drawing that can never be rendered or hit-tested.
      if (p.price === null || !Number.isFinite(p.price) || !Number.isFinite(p.time)) return;
      this._placePoint({ time: p.time, price: this._snap(p.price, p.paneIndex) }, p.paneIndex);
      return;
    }
    if (p.id !== null && p.id.startsWith('draw:')) {
      this.select(p.id.slice('draw:'.length).split('#')[0]);
      return;
    }
    if (p.id === null) this.select(null); // click on empty space clears
  }

  private _placePoint(point: DrawingPoint, paneIndex: number): void {
    if (this._pending.length === 0) this._pendingPane = paneIndex;
    this._pending.push(point);
    const tool = getDrawingTool(this._tool as string);
    if (tool.points > 0 && this._pending.length >= tool.points) {
      this._commit(this._expand(tool, this._pending));
    } else {
      this._syncPreview();
    }
  }

  /** Snap to the nearest O/H/L/C of the hovered bar when magnet is on. */
  private _snap(price: number, paneIndex: number): number {
    if (!this._opts.magnet || paneIndex !== 0) return price;
    const bar = this._lastBar;
    if (bar === null) return price;
    let best = price;
    let bestD = Infinity;
    for (const v of [bar.open, bar.high, bar.low, bar.close]) {
      const d = Math.abs(v - price);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  private _onDrag(p: DragPayload): void {
    if (!p.id.startsWith('draw:')) return;
    const [rawId, handleStr] = p.id.slice('draw:'.length).split('#');
    const d = this.get(rawId);
    if (d === undefined || d.locked === true) return;
    const handle = handleStr === undefined ? null : Number(handleStr);

    if (this._dragStart === null || this._dragStart.id !== rawId || this._dragStart.handle !== handle) {
      // Snapshot once per gesture so undo restores the pre-drag position, not
      // an intermediate frame.
      this._pushUndo();
      this._dragStart = {
        id: rawId, handle,
        points: d.points.map((q) => ({ ...q })),
        from: {
          time: p.fromTime ?? p.time,
          price: p.fromPrice ?? p.price,
        },
      };
    }
    const start = this._dragStart;
    if (handle === null) {
      // Whole shape: translate every anchor by the cursor delta.
      const dt = p.time - start.from.time;
      const dp = p.price - start.from.price;
      d.points = start.points.map((q) => ({ time: q.time + dt, price: q.price + dp }));
    } else if (handle >= 0 && handle < d.points.length) {
      d.points = start.points.map((q, i) => (i === handle ? { time: p.time, price: p.price } : { ...q }));
    }
    this._sync();
  }

  private _onDragEnd(): void {
    if (this._dragStart === null) return;
    const d = this.get(this._dragStart.id);
    this._dragStart = null;
    if (d !== undefined) this._chart.emit('draw:update', { drawing: d });
  }

  // ── plumbing ────────────────────────────────────────────────────────────

  private _layerFor(paneIndex: number): DrawingLayer {
    let layer = this._layers.get(paneIndex);
    if (layer === undefined) {
      layer = new DrawingLayer();
      this._chart.addPrimitive(layer, paneIndex);
      this._layers.set(paneIndex, layer);
    }
    return layer;
  }

  /** Push the current list into each pane's layer and into the chart state. */
  private _sync(): void {
    const byPane = new Map<number, Drawing[]>();
    for (const d of this._drawings) {
      const list = byPane.get(d.paneIndex) ?? [];
      list.push(d);
      byPane.set(d.paneIndex, list);
    }
    for (const [pane, list] of byPane) this._layerFor(pane).setDrawings(list);
    // Panes that lost their last drawing must be cleared, not left stale.
    for (const [pane, layer] of this._layers) {
      if (!byPane.has(pane)) layer.setDrawings([]);
      layer.setSelected(this._selected);
    }
    this._chart.setDrawingState(this.toJSON());
  }

  /** Mirror the in-progress anchors (plus the cursor) into the preview slot. */
  private _syncPreview(): void {
    for (const layer of this._layers.values()) layer.setPreview(null);
    if (this._tool === null || this._pending.length === 0) return;
    const cursor = this._lastCursor;
    const points = cursor === null
      ? this._pending
      : [...this._pending, { time: cursor.time, price: cursor.price }];
    this._layerFor(this._pendingPane).setPreview({
      id: '__preview', tool: this._tool, points, style: this._opts.defaultStyle, paneIndex: this._pendingPane,
    });
  }

  private _pushUndo(): void {
    this._undo.push(JSON.stringify(this._drawings));
    if (this._undo.length > this._opts.historyLimit) this._undo.shift();
    this._redo = []; // a new edit invalidates the redo branch
  }
}
