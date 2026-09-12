import type { Chart } from '../core/chart';
import type { IndicatorDataStatus } from './indicator-registry';

export type ChartObjectKind = 'source' | 'indicator' | 'drawing' | 'profile';

export interface ChartObjectCapabilities {
  readonly select: boolean;
  readonly visibility: boolean;
  readonly lock: boolean;
  readonly remove: boolean;
  readonly settings: boolean;
  readonly focus: boolean;
}

/** One immutable row in a chart's object inventory. */
export interface ChartObjectSnapshot {
  readonly id: string;
  readonly sourceId: string;
  readonly kind: ChartObjectKind;
  readonly name: string;
  readonly paneIndex: number;
  readonly visible: boolean;
  readonly locked?: boolean;
  readonly selected: boolean;
  readonly dataStatus?: Readonly<IndicatorDataStatus>;
  readonly capabilities: ChartObjectCapabilities;
}

/** State supplied by a host for an explicitly managed profile or source. */
export interface ChartObjectDefinition {
  kind: ChartObjectKind;
  name: string;
  paneIndex?: number;
  visible?: boolean;
  locked?: boolean;
  selected?: boolean;
  dataStatus?: Readonly<IndicatorDataStatus>;
}

/** Actions are synchronous and offered only when their callback exists. */
export interface ChartObjectProvider {
  id: string;
  get(): ChartObjectDefinition | null;
  subscribe?(listener: () => void): () => void;
  select?(): void;
  setVisible?(visible: boolean): void;
  setLocked?(locked: boolean): void;
  remove?(): void;
  openSettings?(): void;
  focus?(): void;
}

/** Structural contract keeps the base tier independent of drawing code. */
export interface ChartObjectDrawing {
  id: string;
  tool: string;
  paneIndex: number;
  points: readonly { time: number; price: number }[];
  visible?: boolean;
  locked?: boolean;
}

export interface ChartObjectDrawingSource {
  drawings(): readonly ChartObjectDrawing[];
  get(id: string): ChartObjectDrawing | undefined;
  selection(): readonly string[];
  select(id: string | readonly string[] | null, additive?: boolean): void;
  update(id: string, patch: { visible?: boolean; locked?: boolean }): void;
  remove(id: string): boolean;
}

export interface ChartObjectsOptions {
  drawings?: ChartObjectDrawingSource;
  /** Opens the host's existing editor for a built-in object. */
  onSettings?(object: ChartObjectSnapshot): void;
}

type Actions = Pick<ChartObjectProvider, 'select' | 'setVisible' | 'setLocked' | 'remove' | 'openSettings' | 'focus'>;
interface Entry { row: ChartObjectSnapshot; actions: Actions }
interface Registration { provider: ChartObjectProvider; off?: () => void }
const EMPTY: readonly ChartObjectSnapshot[] = Object.freeze([]);
const sameRows = (a: readonly ChartObjectSnapshot[], b: readonly ChartObjectSnapshot[]): boolean =>
  a.length === b.length && a.every((x, i) => {
    const y = b[i];
    return x.id === y.id && x.name === y.name && x.kind === y.kind && x.paneIndex === y.paneIndex
      && x.visible === y.visible && x.locked === y.locked && x.selected === y.selected
      && x.dataStatus?.state === y.dataStatus?.state
      && (x.dataStatus?.state !== 'error' || (y.dataStatus?.state === 'error' && x.dataStatus.error === y.dataStatus.error))
      && (Object.keys(x.capabilities) as (keyof ChartObjectCapabilities)[])
        .every(key => x.capabilities[key] === y.capabilities[key]);
  });

/** Shared object operations for widgets and custom terminals. No DOM is created. */
export class ChartObjects {
  private readonly _chart: Chart;
  private readonly _options: ChartObjectsOptions;
  private readonly _off: (() => void)[] = [];
  private readonly _providers = new Map<string, Registration>();
  private readonly _listeners = new Set<(objects: readonly ChartObjectSnapshot[]) => void>();
  private _entries = new Map<string, Entry>();
  private _rows = EMPTY;
  private _selected: string | null = null;
  private _destroyed = false;
  private _refreshing = false;
  private _pending = false;

  public constructor(chart: Chart, options: ChartObjectsOptions = {}) {
    this._chart = chart;
    this._options = options;
    if (chart.isDestroyed) { this._destroyed = true; return; }
    for (const event of ['objects:change', 'indicatorRemoved', 'paneRemoved', 'paneMoved',
      'data:context', 'indicator:data-status', 'drawing:change', 'drawing:select']) {
      this._off.push(chart.on(event, () => this.refresh()));
    }
    let hasData = chart.dataLayer.length > 0;
    this._off.push(chart.on('data:range', () => {
      const next = chart.dataLayer.length > 0;
      if (next === hasData) return;
      hasData = next;
      this.refresh();
    }));
    this._off.push(chart.on('destroy', () => this.destroy()));
    this.refresh();
  }

  /** Current immutable inventory, also refreshed for hosts with unsignalled provider state. */
  public list(): readonly ChartObjectSnapshot[] { if (!this._refreshing) this.refresh(); return this._rows; }
  public get(id: string): ChartObjectSnapshot | undefined { if (!this._refreshing) this.refresh(); return this._entries.get(id)?.row; }

  /** Delivers current state immediately, then only inventory changes. */
  public subscribe(listener: (objects: readonly ChartObjectSnapshot[]) => void): () => void {
    this.refresh();
    if (!this._destroyed) this._listeners.add(listener);
    try { listener(this._rows); } catch { /* An observer cannot interrupt chart ownership. */ }
    return () => { this._listeners.delete(listener); };
  }

  /** Provider IDs receive a custom: prefix and cannot replace built-in objects. */
  public register(provider: ChartObjectProvider): () => void {
    if (this._destroyed) return () => {};
    if (typeof provider.id !== 'string' || provider.id.trim() === '') throw new Error('An object provider needs an id');
    const id = 'custom:' + provider.id;
    if (this._providers.has(id)) throw new Error('Object provider already registered: ' + provider.id);
    const registration: Registration = { provider };
    this._providers.set(id, registration);
    try { registration.off = provider.subscribe?.(() => this.refresh()); }
    catch (error) {
      if (this._providers.get(id) === registration) this._providers.delete(id);
      this.refresh();
      throw error;
    }
    // A synchronous provider notification may destroy this inventory while subscribing.
    if (this._destroyed || this._providers.get(id) !== registration) {
      try { registration.off?.(); } catch { /* Continue releasing the registration. */ }
      return () => {};
    }
    this.refresh();
    return () => {
      if (this._providers.get(id) !== registration) return;
      this._providers.delete(id);
      try { registration.off?.(); } catch { /* One provider cannot retain its peers. */ }
      this.refresh();
    };
  }

  /** Re-read explicitly registered host state without installing a polling timer. */
  public refresh(): void {
    if (this._destroyed) return;
    if (this._refreshing) { this._pending = true; return; }
    this._refreshing = true;
    try {
      do {
        this._pending = false;
        const entries = this._read();
        if (this._destroyed) break;
        this._entries = entries;
        if (this._selected !== null && !entries.has(this._selected)) this._selected = null;
        const rows = Object.freeze([...entries.values()].map(entry => entry.row));
        if (sameRows(rows, this._rows)) continue;
        this._rows = rows;
        for (const listener of [...this._listeners]) {
          if (this._destroyed) break;
          try { listener(rows); } catch { /* Other observers still receive the state. */ }
        }
      } while (this._pending && !this._destroyed);
    } finally { this._refreshing = false; }
  }

  public select(id: string | null, additive = false): boolean {
    if (this._destroyed) return false;
    if (id === null) {
      this._selected = null;
      this._options.drawings?.select(null);
      this.refresh();
      return true;
    }
    const row = this.get(id);
    if (!row?.capabilities.select) return false;
    try {
      this._selected = row.kind === 'drawing' ? null : id;
      if (id.startsWith('drawing:')) this._options.drawings?.select(row.sourceId, additive);
      else {
        this._options.drawings?.select(null);
        this._entries.get(id)?.actions.select?.();
      }
      this.refresh();
      return true;
    } catch { this.refresh(); return false; }
  }

  public setVisible(id: string, on: boolean): boolean { return this._act(id, 'visibility', a => a.setVisible!(on)); }
  public setLocked(id: string, on: boolean): boolean { return this._act(id, 'lock', a => a.setLocked!(on)); }
  public remove(id: string): boolean { return this._act(id, 'remove', a => a.remove!()); }
  public openSettings(id: string): boolean { return this._act(id, 'settings', a => a.openSettings!()); }
  public focus(id: string): boolean { return this._act(id, 'focus', a => a.focus!()); }

  private _act(id: string, capability: keyof ChartObjectCapabilities, run: (actions: Actions) => void): boolean {
    const row = this.get(id);
    if (this._destroyed || !row?.capabilities[capability]) return false;
    try { run(this._entries.get(id)!.actions); this.refresh(); return true; }
    catch { this.refresh(); return false; }
  }

  private _read(): Map<string, Entry> {
    const entries = new Map<string, Entry>();
    const draw = this._options.drawings;
    const selected = draw?.selection() ?? [];
    if (selected.length > 0) this._selected = null;
    const add = (id: string, sourceId: string, state: ChartObjectDefinition, actions: Actions): void => {
      const capabilities = Object.freeze({
        select: typeof actions.select === 'function', visibility: typeof actions.setVisible === 'function',
        lock: typeof actions.setLocked === 'function', remove: typeof actions.remove === 'function',
        settings: typeof actions.openSettings === 'function', focus: typeof actions.focus === 'function',
      });
      const row: ChartObjectSnapshot = Object.freeze({
        id, sourceId, kind: state.kind, name: state.name, paneIndex: state.paneIndex ?? 0,
        visible: state.visible !== false, locked: state.locked, selected: state.selected === true || this._selected === id,
        dataStatus: state.dataStatus ? Object.freeze({ ...state.dataStatus }) : undefined, capabilities,
      });
      entries.set(id, { row, actions });
    };
    const settings = (id: string): Pick<Actions, 'openSettings'> => this._options.onSettings
      ? { openSettings: () => { const row = this.get(id); if (row) this._options.onSettings!(row); } } : {};
    const chart = this._chart;
    if (chart.primarySeries() !== null) {
      const context = chart.getDataContext();
      add('source:primary', 'primary', {
        kind: 'source', name: context?.symbol || 'Price',
        visible: chart.primarySeriesInfo()?.style.visible !== false,
      }, settings('source:primary'));
    }
    for (const indicator of chart.indicators()) {
      const id = 'indicator:' + indicator.id;
      add(id, indicator.id, {
        kind: 'indicator', name: indicator.name, paneIndex: indicator.paneIndex,
        visible: indicator.visible(), dataStatus: indicator.dataStatus() ?? undefined,
      }, {
        select: () => {}, setVisible: on => indicator.setVisible(on),
        remove: () => { chart.removeIndicator(indicator.id); }, ...settings(id),
      });
    }
    if (draw) {
      for (const drawing of draw.drawings()) {
        const id = 'drawing:' + drawing.id;
        const canFocus = chart.dataLayer.length > 0 && drawing.points.length > 0
          && drawing.points.every(p => Number.isFinite(p.time) && Number.isFinite(p.price))
          && chart.panes()[drawing.paneIndex] !== undefined;
        add(id, drawing.id, {
          kind: 'drawing', name: drawing.tool.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()),
          paneIndex: drawing.paneIndex, visible: drawing.visible !== false,
          locked: drawing.locked === true, selected: selected.includes(drawing.id),
        }, {
          select: () => draw.select(drawing.id), setVisible: on => draw.update(drawing.id, { visible: on }),
          setLocked: on => draw.update(drawing.id, { locked: on }), remove: () => { draw.remove(drawing.id); },
          ...(canFocus ? { focus: () => this._focusDrawing(drawing) } : {}), ...settings(id),
        });
      }
    }
    for (const [id, { provider }] of this._providers) {
      try {
        const state = provider.get();
        if (!state || typeof state.name !== 'string'
          || !['source', 'indicator', 'drawing', 'profile'].includes(state.kind)) continue;
        add(id, provider.id, state, provider);
      } catch { /* A failing optional provider cannot hide usable chart objects. */ }
    }
    return entries;
  }

  private _focusDrawing(drawing: ChartObjectDrawing): void {
    const chart = this._chart;
    const indices = drawing.points.map(point => chart.dataLayer.timeToIndexFloat(point.time));
    if (!indices.every(Number.isFinite)) return;
    const from = Math.min(...indices);
    const to = Math.max(...indices);
    const current = chart.getVisibleLogicalRange();
    const span = Math.max(current.to - current.from, (to - from) * 1.2, 10);
    const scale = chart.panes()[drawing.paneIndex].readoutScale();
    const prices = drawing.points.map(point => point.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const pad = Math.max((max - min) * 0.15, Math.abs(max) * 0.001, scale.options.minMove);
    scale.setAutoScale(false);
    scale.setPriceRange({ min: min - pad, max: max + pad });
    const maximized = chart.maximizedPane();
    if (maximized !== null && maximized !== drawing.paneIndex) chart.maximizePane(maximized);
    chart.setVisibleLogicalRange({ from: (from + to - span) / 2, to: (from + to + span) / 2 });
  }

  /** Detach this observer and its providers, leaving chart objects in place. */
  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    for (const off of this._off.splice(0)) off();
    const providers = [...this._providers.values()];
    this._providers.clear();
    this._entries.clear();
    this._rows = EMPTY;
    this._selected = null;
    for (const { off } of providers) {
      try { off?.(); } catch { /* Continue releasing other providers. */ }
    }
    const listeners = [...this._listeners];
    this._listeners.clear();
    for (const listener of listeners) {
      try { listener(EMPTY); } catch { /* Destruction must finish for every observer. */ }
    }
  }
}
