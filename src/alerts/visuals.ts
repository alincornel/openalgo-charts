import { PriceLine } from '../primitives/price-line';
import type { Alert, AlertChartHost, AlertDrawingValue } from './types';

const COLORS = { armed: '#3b82f6', triggered: '#22c55e', disabled: '#64748b', expired: '#d97706' };

/** Labels cover drawing strokes without intercepting a drag of the underlying drawing. */
class AlertPriceLine extends PriceLine {
  public override zOrder(): 'top' { return 'top'; }
  public override hitTest(): null { return null; }
}

/** One reusable line per bound. Evaluation and host notifications never depend on drawing. */
export class AlertVisuals {
  private readonly _lines = new Map<string, { pane: number; lines: PriceLine[] }>();
  public constructor(private readonly _chart: AlertChartHost) {}

  public update(alert: Alert, value: AlertDrawingValue | undefined, paused: boolean): void {
    if (!this._chart.addPrimitive || !this._chart.removePrimitive) return;
    if (!value) { this.remove(alert.id); return; }
    const prices = value.upperPrice === undefined ? [value.price] : [value.price, value.upperPrice];
    let group = this._lines.get(alert.id);
    if (group && (group.pane !== value.paneIndex || group.lines.length !== prices.length)) {
      this.remove(alert.id);
      group = undefined;
    }
    if (!group) {
      group = { pane: value.paneIndex, lines: [] };
      this._lines.set(alert.id, group);
    }
    for (let i = 0; i < prices.length; i++) {
      const options = {
        price: prices[i], color: COLORS[alert.state], lineStyle: alert.state === 'armed' ? 'dashed' as const : 'dotted' as const,
        badge: paused ? 'Paused' : alert.state[0].toUpperCase() + alert.state.slice(1),
        leftLabel: alert.title + (prices.length === 2 ? (i === 0 ? ' (lower)' : ' (upper)') : ''),
      };
      const existing = group.lines[i];
      if (existing) {
        const previous = existing.options();
        if (Object.entries(options).some(([key, value]) => previous[key as keyof typeof previous] !== value)) existing.setOptions(options);
      } else {
        const line = new AlertPriceLine({ ...options, id: `alert:${alert.id}:${i}` });
        group.lines.push(line);
        this._chart.addPrimitive(line, value.paneIndex);
      }
    }
  }

  public remove(id: string): void {
    const group = this._lines.get(id);
    if (!group) return;
    this._lines.delete(id);
    for (const line of group.lines) this._chart.removePrimitive?.(line);
  }

  public destroy(): void { for (const id of this._lines.keys()) this.remove(id); }
}
