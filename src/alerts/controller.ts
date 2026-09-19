import type { Bar } from '../model/bar';
import { CONDITIONS, numericMatch, touchMatch } from './conditions';
import { getBarCondition } from './bar-conditions';
import type {
  Alert, AlertChartHost, AlertControllerOptions, AlertInput, AlertPatch, AlertScope,
  AlertTriggeredPayload, ChartDataUpdate, AlertAvailability, IndicatorAlertSource,
} from './types';

interface RecordState {
  alert: Alert;
  tail?: Bar;
  closedTime?: number;
  touchedTime?: number;
  value?: number;
  errorTime?: number;
}

const owners = new WeakSet<AlertChartHost>();
let nextId = 1;
const copy = (alert: Alert): Alert => ({ ...alert, source: { ...alert.source }, scope: { ...alert.scope } });
const scopeOf = (chart: AlertChartHost): AlertScope => {
  const context = chart.getDataContext();
  return { symbol: context?.symbol, exchange: context?.exchange, interval: context?.interval };
};
const sameScope = (a: AlertScope, b: AlertScope): boolean =>
  a.symbol === b.symbol && a.exchange === b.exchange && a.interval === b.interval;

function validate(alert: Alert): void {
  if (typeof alert.id !== 'string' || !alert.id.trim()) throw new Error('Alert id must be nonempty');
  const source = alert.source;
  const named = source?.kind === 'barCondition';
  if (!source || !['price', 'indicator', 'barCondition'].includes(source.kind)) throw new Error('Unknown alert source');
  const text = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;
  if (source.kind === 'barCondition' && !text(source.id)) throw new Error('Invalid bar condition id');
  if (source.kind === 'indicator' && (!text(source.instanceId) || !text(source.plotKey))) throw new Error('Invalid indicator source');
  if (named ? alert.condition !== 'matches' : !CONDITIONS.includes(alert.condition)) throw new Error('Invalid source condition');
  if (source.kind !== 'barCondition') {
    const lower = source.kind === 'price' ? source.price : source.value;
    const upper = source.kind === 'price' ? source.upperPrice : source.upperValue;
    if (!Number.isFinite(lower) || (upper !== undefined && !Number.isFinite(upper))) throw new Error('Alert bounds must be finite');
    if ((alert.condition === 'enteringRange' || alert.condition === 'leavingRange') && (upper === undefined || upper < lower)) {
      throw new Error('Alert range requires ordered finite bounds');
    }
  }
  if (alert.policy !== 'onBarClose' && alert.policy !== 'onTouch') throw new Error('Unknown alert policy');
  if (alert.repeat !== 'once' && alert.repeat !== 'everyTime') throw new Error('Unknown alert repeat');
  if (!['armed', 'triggered', 'disabled', 'expired'].includes(alert.state)) throw new Error('Unknown alert state');
  if (!Number.isFinite(alert.cooldownSeconds) || alert.cooldownSeconds < 0) throw new Error('Invalid alert cooldown');
  if (alert.expiresAt !== undefined && !Number.isFinite(alert.expiresAt)) throw new Error('Invalid alert expiry');
  if (typeof alert.title !== 'string' || (alert.message !== undefined && typeof alert.message !== 'string')) {
    throw new Error('Alert title and message must be text');
  }
}

/** Headless, chart-owned trader alerts. Hosts subscribe to alert:triggered for delivery. */
export class AlertController {
  private readonly _records = new Map<string, RecordState>();
  private readonly _off: (() => void)[];
  private readonly _now: () => number;
  private _timer: ReturnType<typeof setTimeout> | undefined;
  private _timerAt: number | undefined;
  private _paused = false;
  private _replay = false;
  private _destroyed = false;
  private _revision = 0;

  public constructor(private readonly _chart: AlertChartHost, options: AlertControllerOptions = {}) {
    if (owners.has(_chart)) throw new Error('An alert controller already owns this chart');
    this._now = options.now ?? (() => Date.now() / 1000);
    owners.add(_chart);
    this._off = [
      _chart.on('data:update', payload => this._onData(payload as ChartDataUpdate)),
      _chart.on('data:context', () => this._seedAll()),
      _chart.on('objects:change', () => {
        for (const record of this._records.values()) {
          if (record.alert.source.kind === 'indicator') { this._revision++; this._seed(record); }
        }
      }),
      _chart.on('replay:start', () => { this._replay = true; this._seedAll(); }),
      _chart.on('replay:stop', () => { this._replay = false; this._seedAll(); }),
      _chart.on('destroy', () => this.destroy()),
    ];
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
    if (alert.state === 'armed' && alert.expiresAt !== undefined && this._now() >= alert.expiresAt) alert.state = 'expired';
    const record: RecordState = { alert };
    this._seed(record);
    this._records.set(id, record);
    this._scheduleExpiry();
    this._chart.emit('alert:created', { alert: copy(alert) });
    return copy(alert);
  }

  public update(id: string, patch: AlertPatch): Alert | undefined {
    this._assertAlive();
    const previous = this._records.get(id);
    if (!previous) return undefined;
    const alert: Alert = { ...previous.alert, ...patch, id, source: { ...(patch.source ?? previous.alert.source) } };
    validate(alert);
    if (alert.state === 'armed' && alert.expiresAt !== undefined && this._now() >= alert.expiresAt) alert.state = 'expired';
    const record: RecordState = { ...previous, alert };
    this._seed(record);
    this._records.set(id, record);
    this._scheduleExpiry();
    this._chart.emit('alert:updated', { alert: copy(alert) });
    return copy(alert);
  }

  public remove(id: string): boolean {
    const record = this._records.get(id);
    if (!record) return false;
    this._records.delete(id);
    this._scheduleExpiry();
    this._chart.emit('alert:removed', { alert: copy(record.alert), reason: 'removed' });
    return true;
  }

  public list(): Alert[] { return [...this._records.values()].map(record => copy(record.alert)); }

  /** Availability is independent of lifecycle state; disabled records can still have valid anchors. */
  public availability(id: string): AlertAvailability {
    const record = this._records.get(id);
    if (!record) return { available: false, reason: 'Alert is unavailable' };
    if (this._paused || this._replay) return { available: false, reason: 'Alerts are paused' };
    if (!sameScope(record.alert.scope, scopeOf(this._chart))) return { available: false, reason: 'Instrument context differs' };
    const { source } = record.alert;
    const bars = this._chart.primaryBars();
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
      record.value = this._reading(this._plot(record.alert.source).values, bars.length - 1);
    }
    const closed = bars[bars.length - 2]?.time;
    // A history reload can move backwards; it cannot make a judged bar new again.
    if (closed !== undefined) record.closedTime = Math.max(record.closedTime ?? -Infinity, closed);
  }

  private _seedAll(): void {
    this._revision++;
    for (const record of this._records.values()) this._seed(record);
  }

  private _onData(update: ChartDataUpdate): void {
    if (this._destroyed) return;
    const revision = ++this._revision;
    this._expireDue();
    if (this._destroyed || revision !== this._revision) return;
    if (this._paused || this._replay) return;
    if (update.kind !== 'update') { this._seedAll(); return; }
    const bars = this._chart.primaryBars();
    const tail = bars[bars.length - 1];
    if (!tail || update.time !== tail.time) return;
    const scope = scopeOf(this._chart);
    for (const record of [...this._records.values()]) {
      if (this._destroyed || revision !== this._revision) break;
      if (this._records.get(record.alert.id) !== record) continue;
      const previous = record.tail;
      record.tail = { ...tail };
      if (record.alert.state !== 'armed' || !sameScope(record.alert.scope, scope) || !previous) continue;
      const { alert } = record;
      if (alert.policy === 'onBarClose') {
        const index = bars.length - 2;
        const closed = bars[index];
        if (tail.time <= previous.time || !closed || closed.time !== previous.time
          || (record.closedTime !== undefined && closed.time <= record.closedTime)) continue;
        record.closedTime = closed.time;
        const price = this._closedMatch(record, bars, index);
        if (price !== undefined && revision === this._revision && this._records.get(alert.id) === record) {
          this._trigger(record, closed, index, price);
        }
      } else {
        if (tail.time < previous.time || (record.touchedTime !== undefined && tail.time <= record.touchedTime)) continue;
        const price = this._touchMatch(record, bars, previous);
        if (price !== undefined && revision === this._revision && this._records.get(alert.id) === record) {
          // A suppressed match is consumed too: an old wick cannot wake after cooldown.
          record.touchedTime = tail.time;
          this._trigger(record, tail, bars.length - 1, price);
        }
      }
    }
  }

  private _plot(source: IndicatorAlertSource): { values?: readonly (number | null)[]; paneIndex?: number; reason?: string } {
    const instance = this._chart.indicators?.().find(item => item.id === source.instanceId);
    if (!instance) return { reason: 'Indicator instance is unavailable' };
    if (!instance.series(source.plotKey)) return { reason: 'Indicator plot is unavailable' };
    const values = instance.values()[source.plotKey];
    return values ? { values, paneIndex: instance.paneIndex } : { reason: 'Indicator plot is unavailable' };
  }

  private _reading(values: readonly (number | null)[] | undefined, index: number): number | undefined {
    const value = values?.[index];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private _closedMatch(record: RecordState, bars: readonly Bar[], index: number): number | undefined {
    const { source, condition } = record.alert;
    if (source.kind === 'barCondition') return this._barMatch(record, bars, index) ? bars[index].close : undefined;
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

  private _trigger(record: RecordState, bar: Bar, index: number, price: number): void {
    const { alert } = record;
    const now = this._now();
    if (alert.expiresAt !== undefined && now >= alert.expiresAt) { this._expireDue(); return; }
    if (alert.lastTriggeredAt !== undefined && now - alert.lastTriggeredAt < alert.cooldownSeconds) return;
    alert.lastTriggeredAt = now;
    alert.lastTriggeredTime = bar.time;
    if (alert.repeat === 'once') alert.state = 'triggered';
    this._scheduleExpiry();
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
        expired.push(record);
      }
    }
    this._scheduleExpiry();
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
