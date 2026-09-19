import type { Bar } from '../model/bar';
import { CONDITIONS, numericMatch, touchMatch } from './conditions';
import type {
  Alert, AlertChartHost, AlertControllerOptions, AlertInput, AlertPatch, AlertScope,
  AlertTriggeredPayload, ChartDataUpdate,
} from './types';

interface RecordState {
  alert: Alert;
  tail?: Bar;
  closedTime?: number;
  touchedTime?: number;
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
  if (!alert.source || alert.source.kind !== 'price' || !Number.isFinite(alert.source.price)) {
    throw new Error('Alert price must be finite');
  }
  if (alert.source.upperPrice !== undefined && !Number.isFinite(alert.source.upperPrice)) {
    throw new Error('Alert upper bound must be finite');
  }
  if (!CONDITIONS.includes(alert.condition)) throw new Error('Unknown alert condition');
  if ((alert.condition === 'enteringRange' || alert.condition === 'leavingRange')
    && (alert.source.upperPrice === undefined || alert.source.upperPrice < alert.source.price)) {
    throw new Error('Alert range requires ordered finite bounds');
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
      ...input, id, source: { ...input.source }, condition: input.condition ?? 'crossing',
      policy: input.policy ?? 'onBarClose', repeat: input.repeat ?? 'once', state: input.state ?? 'armed',
      title: input.title ?? 'Price alert', cooldownSeconds: input.cooldownSeconds ?? 0, scope: scopeOf(this._chart),
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
    if (update.kind !== 'update' || this._paused || this._replay) { this._seedAll(); return; }
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
        if (numericMatch(alert.condition, bars[index - 1]?.close, closed.close, alert.source.price, alert.source.upperPrice)) {
          this._trigger(record, closed, index, closed.close);
        }
      } else {
        if (tail.time < previous.time || (record.touchedTime !== undefined && tail.time <= record.touchedTime)) continue;
        const isNew = tail.time > previous.time;
        const changed = isNew || tail.close !== previous.close || tail.high > previous.high || tail.low < previous.low;
        if (!changed) continue;
        const high = Math.max(previous.close, tail.close, isNew || tail.high > previous.high ? tail.high : -Infinity);
        const low = Math.min(previous.close, tail.close, isNew || tail.low < previous.low ? tail.low : Infinity);
        const price = touchMatch(alert.condition, previous.close, low, high, alert.source.price, alert.source.upperPrice);
        if (price !== undefined) {
          // A suppressed match is consumed too: an old wick cannot wake after cooldown.
          record.touchedTime = tail.time;
          this._trigger(record, tail, bars.length - 1, price);
        }
      }
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
