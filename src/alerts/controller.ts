import type { Bar } from '../model/bar';
import { getIndicator, hasIndicator } from '../model/indicator-registry';
import { numericMatch, touchMatch } from './conditions';
import { getBarCondition } from './bar-conditions';
import { AlertVisuals, parseAlertLineId } from './visuals';
import { copyAlert as copy, parseAlertsDocument, validateAlert as validate } from './document';
import type {
  Alert, AlertChartHost, AlertControllerOptions, AlertInput, AlertPatch, AlertScope,
  AlertTriggeredPayload, ChartDataUpdate, AlertAvailability, IndicatorAlertSource,
  AlertDrawingProvider, AlertDrawingValue, DrawingAlertSource, AlertsDocument,
} from './types';

interface RecordState {
  alert: Alert;
  tail?: Bar;
  value?: number;
  errorTime?: number;
  plotPane?: number;
}

const owners = new WeakSet<AlertChartHost>();
let nextId = 1;
const scopeOf = (chart: AlertChartHost): AlertScope => {
  const context = chart.getDataContext();
  return { symbol: context?.symbol, exchange: context?.exchange, interval: context?.interval };
};
const sameScope = (a: AlertScope, b: AlertScope): boolean =>
  a.symbol === b.symbol && a.exchange === b.exchange && a.interval === b.interval;

/** Headless, chart-owned trader alerts. Hosts subscribe to alert:triggered for delivery. */
export class AlertController {
  private readonly _records = new Map<string, RecordState>();
  private readonly _off: (() => void)[];
  private readonly _now: () => number;
  private readonly _drawings: AlertDrawingProvider | undefined;
  private readonly _visuals: AlertVisuals | undefined;
  private _timer: ReturnType<typeof setTimeout> | undefined;
  private _timerAt: number | undefined;
  private _paused = false;
  private _restoring = false;
  private _replay = false;
  private _destroyed = false;
  private _revision = 0;

  public constructor(private readonly _chart: AlertChartHost, options: AlertControllerOptions = {}) {
    if (owners.has(_chart)) throw new Error('An alert controller already owns this chart');
    this._now = options.now ?? (() => Date.now() / 1000);
    this._drawings = options.drawings;
    this._visuals = options.visuals === false ? undefined : new AlertVisuals(_chart);
    owners.add(_chart);
    this._off = [
      _chart.on('data:update', payload => this._onData(payload as ChartDataUpdate)),
      _chart.on('data:context', () => this._seedAll()),
      _chart.on('objects:change', () => this._onObjects()),
      _chart.on('paneMoved', () => this._onObjects()),
      _chart.on('state:restore:start', () => { this._restoring = true; this._revision++; }),
      _chart.on('state:restore:end', () => { this._restoring = false; this._seedAll(); }),
      _chart.on('alerts:restore', document => this.fromJSON(document)),
      _chart.on('replay:start', () => { this._replay = true; this._seedAll(); }),
      _chart.on('replay:stop', () => { this._replay = false; this._seedAll(); }),
      _chart.on('destroy', () => this.destroy()),
      // Dragging an alert's line moves its price. Live while the pointer is
      // down so the number under the label keeps up with the cursor, and
      // committed on release: writing on every frame would restart the
      // evaluation state dozens of times across one gesture.
      _chart.on('drag', payload => this._onDrag(payload as { id?: unknown; price?: unknown }, false)),
      _chart.on('drag:end', payload => this._onDrag(payload as { id?: unknown; price?: unknown }, true)),
    ];
    try {
      const saved = _chart.alertState?.();
      if (saved !== undefined) this.fromJSON(saved);
    } catch (error) { this.destroy(); throw error; }
  }

  /**
   * Move an alert's price because its line was dragged.
   *
   * Only a source whose price is the alert's own: a drawing-sourced alert is
   * anchored to a drawing and has no price to move, and its line does not
   * hit-test in the first place. An id that is not one of ours, or a drag on
   * some other primitive, falls straight through.
   */
  private _onDrag(payload: { id?: unknown; price?: unknown }, done: boolean): void {
    if (this._destroyed) return;
    const externalId = typeof payload.id === 'string' ? payload.id : '';
    const price = typeof payload.price === 'number' ? payload.price : Number.NaN;
    const parsed = parseAlertLineId(externalId);
    if (parsed === null || !Number.isFinite(price)) return;
    const record = this._records.get(parsed.id);
    if (record === undefined) return;
    const source = record.alert.source;
    if (source.kind !== 'price' && source.kind !== 'indicator') return;

    // Which of the two the gesture has hold of. A range alert draws a line per
    // bound, and index 1 is the upper one.
    const lower = parsed.index === 0;
    const next = source.kind === 'price'
      ? { ...source, ...(lower ? { price } : { upperPrice: price }) }
      : { ...source, ...(lower ? { value: price } : { upperValue: price }) };
    this.update(parsed.id, { source: next });
    if (done) this._chart.emit('alerts:changed', { id: parsed.id, reason: 'dragged' });
  }

  public add(input: AlertInput): Alert {
    this._assertAlive();
    let id = input.id;
    if (id === undefined) do { id = `alert-${nextId++}`; } while (this._records.has(id));
    if (this._records.has(id)) throw new Error(`Duplicate alert id: ${id}`);
    const alert: Alert = {
      ...input, id, source: { ...input.source }, condition: input.condition ?? (input.source.kind === 'barCondition' ? 'matches' : 'crossing'),
      policy: input.policy ?? 'onBarClose', repeat: input.repeat ?? 'once', state: input.state ?? 'armed',
      title: input.title ?? 'Chart alert', cooldownSeconds: input.cooldownSeconds ?? 0, scope: scopeOf(this._chart),
    };
    validate(alert);
    alert.source = copy(alert).source;
    if (alert.state === 'armed' && alert.expiresAt !== undefined && this._now() >= alert.expiresAt) alert.state = 'expired';
    const record: RecordState = { alert };
    this._seed(record);
    this._records.set(id, record);
    this._syncVisual(record);
    this._scheduleExpiry();
    this._saveState();
    this._chart.emit('alert:created', { alert: copy(alert) });
    return copy(alert);
  }

  public update(id: string, patch: AlertPatch): Alert | undefined {
    this._assertAlive();
    const previous = this._records.get(id);
    if (!previous) return undefined;
    const alert: Alert = { ...previous.alert, ...patch, id, source: { ...(patch.source ?? previous.alert.source) } };
    validate(alert);
    alert.source = copy(alert).source;
    if (alert.state === 'armed' && alert.expiresAt !== undefined && this._now() >= alert.expiresAt) alert.state = 'expired';
    const record: RecordState = { ...previous, alert };
    this._seed(record);
    this._records.set(id, record);
    this._syncVisual(record);
    this._scheduleExpiry();
    this._saveState();
    this._chart.emit('alert:updated', { alert: copy(alert) });
    return copy(alert);
  }

  public remove(id: string): boolean {
    return this._remove(id, 'removed');
  }

  private _remove(id: string, reason: string): boolean {
    const record = this._records.get(id);
    if (!record) return false;
    this._records.delete(id);
    this._visuals?.remove(id);
    this._scheduleExpiry();
    this._saveState();
    this._chart.emit('alert:removed', { alert: copy(record.alert), reason });
    return true;
  }

  public list(): Alert[] { return [...this._records.values()].map(record => copy(record.alert)); }

  public toJSON(): AlertsDocument { return parseAlertsDocument({ version: 1, alerts: this.list() }); }

  /** Validate the complete replacement before touching current alerts or their visuals. */
  public fromJSON(input: unknown): void {
    this._assertAlive();
    const document = parseAlertsDocument(input);
    const next = new Map<string, RecordState>();
    const removed: { alert: Alert; reason: string }[] = [];
    for (const alert of document.alerts) {
      const source = alert.source;
      let reason: string | undefined;
      if (source.kind === 'drawing' && this._drawings && this._drawings.get(source.drawingId) == null) reason = 'drawing-missing';
      const plot = source.kind === 'indicator' ? source : source.kind === 'drawing' ? source.input : undefined;
      if (!reason && plot && this._chart.indicators) {
        const instance = this._chart.indicators().find(item => item.id === plot.instanceId);
        if (!instance) reason = 'indicator-missing';
        else if (!instance.series(plot.plotKey)) reason = 'plot-missing';
      }
      if (reason) { removed.push({ alert, reason }); continue; }
      if (alert.state === 'armed' && alert.expiresAt !== undefined && this._now() >= alert.expiresAt) alert.state = 'expired';
      if (alert.lastTriggeredTime !== undefined) {
        const key = alert.policy === 'onTouch' ? 'lastTouchedTime' : 'lastClosedTime';
        alert[key] = Math.max(alert[key] ?? -Infinity, alert.lastTriggeredTime);
      }
      const record = { alert };
      this._seed(record);
      next.set(alert.id, record);
    }
    this._revision++;
    this._visuals?.destroy();
    this._records.clear();
    for (const [id, record] of next) { this._records.set(id, record); this._syncVisual(record); }
    this._scheduleExpiry();
    this._saveState();
    for (const event of removed) {
      if (this._destroyed) break;
      this._chart.emit('alert:removed', { ...event, alert: copy(event.alert) });
    }
    if (!this._destroyed) this._chart.emit('alerts:restored', { alerts: this.list() });
  }

  private _saveState(): void {
    if (!this._destroyed) this._chart.setAlertState?.({ version: 1, alerts: this.list() });
  }

  /** Availability is independent of lifecycle state; disabled records can still have valid anchors. */
  public availability(id: string): AlertAvailability {
    const record = this._records.get(id);
    if (!record) return { available: false, reason: 'Alert is unavailable' };
    if (this._paused || this._replay) return { available: false, reason: 'Alerts are paused' };
    if (!sameScope(record.alert.scope, scopeOf(this._chart))) return { available: false, reason: 'Instrument context differs' };
    const { source } = record.alert;
    const bars = this._chart.primaryBars();
    if (source.kind === 'drawing') {
      const info = this._drawings?.alertInfo(source.drawingId);
      if (!info?.available) return { available: false, reason: info?.reason ?? 'Drawing provider is unavailable' };
      if (info.paneIndex !== 0 && !source.input) return { available: false, reason: 'Select an input plot for this drawing pane' };
      const bounds = this._drawingValue(record.alert, bars[bars.length - 1]?.time);
      return bounds ? { available: true, paneIndex: bounds.paneIndex }
        : { available: false, reason: 'Drawing level, time, input plot or condition is unavailable', paneIndex: info.paneIndex };
    }
    if (source.kind === 'indicator') {
      const resolved = this._plot(source);
      if (!resolved.values) return { available: false, reason: resolved.reason };
      return Number.isFinite(resolved.values[bars.length - 1])
        ? { available: true, paneIndex: resolved.paneIndex }
        : { available: false, reason: 'Plot value is unavailable', paneIndex: resolved.paneIndex };
    }
    if (source.kind === 'barCondition' && !getBarCondition(source.id)) return { available: false, reason: 'Bar condition is unavailable' };
    return bars.length ? { available: true, paneIndex: 0 } : { available: false, reason: 'Source data is unavailable' };
  }
  public enable(id: string): Alert | undefined { return this.update(id, { state: 'armed' }); }
  public disable(id: string): Alert | undefined { return this.update(id, { state: 'disabled' }); }

  /** Explicit host pause is independent of replay and never delivers a backlog. */
  public setPaused(paused: boolean): void {
    this._assertAlive();
    if (this._paused === paused) return;
    this._paused = paused;
    this._seedAll();
  }

  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._revision++;
    for (const off of this._off) off();
    this._clearTimer();
    this._visuals?.destroy();
    this._records.clear();
    owners.delete(this._chart);
  }

  private _assertAlive(): void {
    if (this._destroyed) throw new Error('Alert controller is destroyed');
  }

  private _seed(record: RecordState): void {
    const bars = this._chart.primaryBars();
    const tail = bars[bars.length - 1];
    record.tail = tail ? { ...tail } : undefined;
    if (record.alert.source.kind === 'indicator') {
      const plot = this._plot(record.alert.source);
      record.value = this._reading(plot.values, bars.length - 1);
      record.plotPane = plot.paneIndex;
    } else if (record.alert.source.kind === 'drawing' && record.alert.source.input) {
      record.value = this._reading(this._plot(record.alert.source.input).values, bars.length - 1);
    }
    const closed = bars[bars.length - 2]?.time;
    // A history reload can move backwards; it cannot make a judged bar new again.
    if (closed !== undefined) record.alert.lastClosedTime = Math.max(record.alert.lastClosedTime ?? -Infinity, closed);
  }

  private _seedAll(): void {
    this._revision++;
    for (const record of this._records.values()) { this._seed(record); this._syncVisual(record); }
    if (!this._restoring) {
      this._saveState();
      if (!this._destroyed && this._records.size) this._chart.emit('alerts:checkpoint', {});
    }
  }

  private _onObjects(): void {
    if (this._destroyed || this._restoring) return;
    const revision = ++this._revision;
    for (const record of [...this._records.values()]) {
      if (this._destroyed || this._revision !== revision) break;
      const source = record.alert.source;
      if (source.kind === 'drawing' && this._drawings && this._drawings.get(source.drawingId) == null) {
        this._remove(record.alert.id, 'drawing-removed');
      } else if (source.kind === 'indicator' || source.kind === 'drawing') {
        this._seed(record);
        this._syncVisual(record);
      }
    }
  }

  private _syncVisual(record: RecordState): void {
    if (!this._visuals) return;
    const { alert } = record;
    const { source } = alert;
    let value: AlertDrawingValue | undefined;
    if (sameScope(alert.scope, scopeOf(this._chart))) {
      if (source.kind === 'price') value = { price: source.price, upperPrice: source.upperPrice, paneIndex: 0 };
      if (source.kind === 'indicator') {
        if (record.plotPane !== undefined) value = { price: source.value, upperPrice: source.upperValue, paneIndex: record.plotPane };
      }
      if (source.kind === 'drawing') {
        const bars = this._chart.primaryBars();
        value = this._drawingValue(alert, bars[bars.length - 1]?.time);
      }
    }
    this._visuals.update(alert, value, this._paused || this._replay);
  }

  private _onData(update: ChartDataUpdate): void {
    if (this._destroyed || this._restoring) return;
    const revision = ++this._revision;
    this._expireDue();
    if (this._destroyed || revision !== this._revision) return;
    if (this._paused || this._replay) return;
    if (update.kind !== 'update') { this._seedAll(); return; }
    const bars = this._chart.primaryBars();
    const tail = bars[bars.length - 1];
    if (!tail || update.time !== tail.time) return;
    const scope = scopeOf(this._chart);
    let changed = false;
    for (const record of [...this._records.values()]) {
      if (this._destroyed || revision !== this._revision) break;
      if (this._records.get(record.alert.id) !== record) continue;
      const previous = record.tail;
      record.tail = { ...tail };
      if (record.alert.source.kind === 'drawing' && previous?.time !== tail.time) this._syncVisual(record);
      if (this._destroyed || revision !== this._revision) break;
      if (record.alert.state !== 'armed' || !sameScope(record.alert.scope, scope) || !previous) continue;
      const { alert } = record;
      if (alert.policy === 'onBarClose') {
        const index = bars.length - 2;
        const closed = bars[index];
        if (tail.time <= previous.time || !closed || closed.time !== previous.time
          || (alert.lastClosedTime !== undefined && closed.time <= alert.lastClosedTime)) continue;
        alert.lastClosedTime = closed.time;
        changed = true;
        const price = this._closedMatch(record, bars, index);
        if (price !== undefined && revision === this._revision && this._records.get(alert.id) === record) {
          this._trigger(record, closed, index, price);
        }
      } else {
        if (tail.time < previous.time || (alert.lastTouchedTime !== undefined && tail.time <= alert.lastTouchedTime)) continue;
        const price = this._touchMatch(record, bars, previous);
        if (price !== undefined && revision === this._revision && this._records.get(alert.id) === record) {
          // A suppressed match is consumed too: an old wick cannot wake after cooldown.
          alert.lastTouchedTime = tail.time;
          changed = true;
          this._trigger(record, tail, bars.length - 1, price);
        }
      }
    }
    if (changed) {
      this._saveState();
      if (!this._destroyed) this._chart.emit('alerts:checkpoint', {});
    }
  }

  private _plot(source: Pick<IndicatorAlertSource, 'instanceId' | 'plotKey'>): { values?: readonly (number | null)[]; paneIndex?: number; reason?: string } {
    const instance = this._chart.indicators?.().find(item => item.id === source.instanceId);
    if (!instance) return { reason: 'Indicator instance is unavailable' };
    if (!instance.series(source.plotKey)) return { reason: 'Indicator plot is unavailable' };
    const values = instance.values()[source.plotKey];
    const overlay = instance.indicatorId && hasIndicator(instance.indicatorId)
      && getIndicator(instance.indicatorId).plots.some(plot => plot.key === source.plotKey && plot.overlay);
    return values ? { values, paneIndex: overlay ? 0 : instance.paneIndex } : { reason: 'Indicator plot is unavailable' };
  }

  private _reading(values: readonly (number | null)[] | undefined, index: number): number | undefined {
    const value = values?.[index];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private _closedMatch(record: RecordState, bars: readonly Bar[], index: number): number | undefined {
    const { source, condition } = record.alert;
    if (source.kind === 'barCondition') return this._barMatch(record, bars, index) ? bars[index].close : undefined;
    if (source.kind === 'drawing') {
      const bounds = this._drawingValue(record.alert, bars[index].time);
      const beforeBounds = this._drawingValue(record.alert, bars[index - 1]?.time);
      const values = source.input ? this._plot(source.input).values : undefined;
      const current = source.input ? this._reading(values, index) : bars[index].close;
      const previous = source.input ? this._reading(values, index - 1) : bars[index - 1]?.close;
      if (!bounds || current === undefined) return undefined;
      return numericMatch(condition, beforeBounds ? previous : undefined, current, bounds.price, bounds.upperPrice,
        beforeBounds?.price, beforeBounds?.upperPrice) ? current : undefined;
    }
    if (source.kind === 'price') return numericMatch(condition, bars[index - 1]?.close, bars[index].close, source.price, source.upperPrice)
      ? bars[index].close : undefined;
    const values = this._plot(source).values;
    const current = this._reading(values, index);
    return current !== undefined && numericMatch(condition, this._reading(values, index - 1), current, source.value, source.upperValue)
      ? current : undefined;
  }

  private _touchMatch(record: RecordState, bars: readonly Bar[], previous: Bar): number | undefined {
    const { source, condition } = record.alert;
    const index = bars.length - 1;
    const tail = bars[index];
    if (source.kind === 'barCondition') return this._barMatch(record, bars, index) ? tail.close : undefined;
    if (source.kind === 'drawing') return this._drawingTouch(record, source, bars, previous);
    if (source.kind === 'indicator') {
      const values = this._plot(source).values;
      const current = this._reading(values, index);
      // A consumed touch stops delivery, not updates to the preceding bar's close.
      const before = tail.time > previous.time ? this._reading(values, index - 1) : record.value;
      record.value = current;
      if (current === undefined || (current === before && tail.time === previous.time)) return undefined;
      return numericMatch(condition, before, current, source.value, source.upperValue) ? current : undefined;
    }
    const isNew = tail.time > previous.time;
    const changed = isNew || tail.close !== previous.close || tail.high > previous.high || tail.low < previous.low;
    if (!changed) return undefined;
    const high = Math.max(previous.close, tail.close, isNew || tail.high > previous.high ? tail.high : -Infinity);
    const low = Math.min(previous.close, tail.close, isNew || tail.low < previous.low ? tail.low : Infinity);
    return touchMatch(condition, previous.close, low, high, source.price, source.upperPrice);
  }

  private _barMatch(record: RecordState, bars: readonly Bar[], index: number): boolean {
    const source = record.alert.source;
    if (source.kind !== 'barCondition' || record.errorTime === bars[index].time) return false;
    const condition = getBarCondition(source.id);
    if (!condition) return false;
    try {
      return condition.when({ bars: bars.slice(0, index + 1), index }) === true;
    } catch (error) {
      record.errorTime = bars[index].time;
      this._chart.emit('alert:error', { alert: copy(record.alert), error });
      return false;
    }
  }

  private _drawingValue(alert: Alert, time: number | undefined): AlertDrawingValue | undefined {
    const source = alert.source;
    if (source.kind !== 'drawing' || time === undefined) return undefined;
    const value = this._drawings?.valueAt(source.drawingId, time, source.level);
    if (!value || (value.paneIndex !== 0 && !source.input)) return undefined;
    if (source.input && this._plot(source.input).paneIndex !== value.paneIndex) return undefined;
    const band = alert.condition === 'enteringRange' || alert.condition === 'leavingRange';
    // A band has two boundaries: a crossing needs the trader to choose one explicitly.
    if (band !== (value.upperPrice !== undefined)) return undefined;
    return value;
  }

  private _drawingTouch(record: RecordState, source: DrawingAlertSource, bars: readonly Bar[], previous: Bar): number | undefined {
    const tail = bars[bars.length - 1];
    const bounds = this._drawingValue(record.alert, tail.time);
    const beforeBounds = this._drawingValue(record.alert, previous.time);
    if (source.input) {
      const values = this._plot(source.input).values;
      const current = this._reading(values, bars.length - 1);
      const before = tail.time > previous.time ? this._reading(values, bars.length - 2) : record.value;
      record.value = current;
      if (!bounds || current === undefined || (current === before && tail.time === previous.time)) return undefined;
      return numericMatch(record.alert.condition, beforeBounds ? before : undefined, current, bounds.price, bounds.upperPrice,
        beforeBounds?.price, beforeBounds?.upperPrice) ? current : undefined;
    }
    if (!bounds || !beforeBounds) return undefined;
    const isNew = tail.time > previous.time;
    if (!isNew && tail.close === previous.close && tail.high <= previous.high && tail.low >= previous.low) return undefined;
    const high = Math.max(previous.close, tail.close, isNew || tail.high > previous.high ? tail.high : -Infinity);
    const low = Math.min(previous.close, tail.close, isNew || tail.low < previous.low ? tail.low : Infinity);
    return touchMatch(record.alert.condition, previous.close, low, high, bounds.price, bounds.upperPrice,
      beforeBounds.price, beforeBounds.upperPrice);
  }

  private _trigger(record: RecordState, bar: Bar, index: number, price: number): void {
    const { alert } = record;
    const now = this._now();
    if (alert.expiresAt !== undefined && now >= alert.expiresAt) { this._expireDue(); return; }
    if (alert.lastTriggeredAt !== undefined && now - alert.lastTriggeredAt < alert.cooldownSeconds) return;
    alert.lastTriggeredAt = now;
    alert.lastTriggeredTime = bar.time;
    if (alert.repeat === 'once') alert.state = 'triggered';
    this._syncVisual(record);
    this._scheduleExpiry();
    this._saveState();
    const payload: AlertTriggeredPayload = {
      alertId: alert.id, title: alert.title, message: alert.message, time: bar.time, index, price, alert: copy(alert),
    };
    this._chart.emit('alert:triggered', payload);
  }

  private _expireDue(): void {
    const now = this._now();
    const expired: RecordState[] = [];
    for (const record of this._records.values()) {
      const { alert } = record;
      if (alert.state === 'armed' && alert.expiresAt !== undefined && now >= alert.expiresAt) {
        alert.state = 'expired';
        this._syncVisual(record);
        expired.push(record);
      }
    }
    this._scheduleExpiry();
    if (expired.length) this._saveState();
    for (const record of expired) {
      if (this._destroyed) break;
      if (this._records.get(record.alert.id) === record) this._chart.emit('alert:expired', { alert: copy(record.alert) });
    }
  }

  private _clearTimer(): void {
    if (this._timer !== undefined) clearTimeout(this._timer);
    this._timer = undefined;
    this._timerAt = undefined;
  }

  private _scheduleExpiry(): void {
    if (this._destroyed) return;
    let next: number | undefined;
    for (const { alert } of this._records.values()) {
      if (alert.state === 'armed' && alert.expiresAt !== undefined) next = Math.min(next ?? Infinity, alert.expiresAt);
    }
    if (next === this._timerAt) return;
    this._clearTimer();
    if (next === undefined) return;
    this._timerAt = next;
    this._timer = setTimeout(() => {
      this._timer = undefined;
      this._timerAt = undefined;
      if (!this._destroyed) this._expireDue();
    }, Math.max(1, Math.min(2_147_483_647, (next - this._now()) * 1000)));
    (this._timer as unknown as { unref?: () => void }).unref?.();
  }
}
