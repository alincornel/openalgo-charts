import { PriceLine } from '../primitives/price-line';
import type { PrimitiveHit, PrimitiveRenderContext } from '../primitives/primitive';
import type { Alert, AlertChartHost, AlertDrawingValue } from './types';

const COLORS = { armed: '#3b82f6', triggered: '#22c55e', disabled: '#64748b', expired: '#d97706' };

/**
 * The badge on an alert's line.
 *
 * `armed` is the ordinary state and the word is the engine's, not a trader's:
 * a line on a chart saying "Armed" reads as jargon for the state every alert
 * is in almost all the time. It says what the line IS instead. The other three
 * stay, because each one tells you something the line cannot: that it has
 * already fired, that it has run out, that it is switched off.
 */
function badgeFor(state: Alert['state'], paused: boolean): string {
  if (paused) return 'Paused';
  if (state === 'armed') return 'Alert';
  return state[0].toUpperCase() + state.slice(1);
}

/**
 * The line an alert draws at its own price.
 *
 * Draggable when the price is the alert's to own, which is a price or a study
 * threshold: moving the line is the fastest way to say "not there, here", and
 * it beats opening a dialog to retype a number.
 *
 * Not draggable when the price belongs to something else. A drawing-sourced
 * alert sits ON a trend line and follows it, so a grab there has to reach the
 * drawing: the alert has no price of its own to move, and intercepting the
 * gesture would pin the label while the line it is labelling slid away.
 */
class AlertPriceLine extends PriceLine {
  public constructor(options: ConstructorParameters<typeof PriceLine>[0], private readonly _movable: boolean) {
    super(options);
  }

  public override zOrder(): 'top' { return 'top'; }

  public override hitTest(x: number, y: number, rc: PrimitiveRenderContext): PrimitiveHit | null {
    return this._movable ? super.hitTest(x, y, rc) : null;
  }
}

/** Which sources carry a price the trader may move by hand. */
function movable(alert: Alert): boolean {
  return alert.source.kind === 'price' || alert.source.kind === 'indicator';
}

/** `alert:<id>:<index>` taken apart, or null for an id that is not ours. */
export function parseAlertLineId(externalId: string): { id: string; index: number } | null {
  const match = /^alert:(.+):(\d+)$/.exec(externalId);
  if (match === null) return null;
  const index = Number(match[2]);
  return Number.isInteger(index) && index >= 0 ? { id: match[1], index } : null;
}

/** One reusable line per bound. Evaluation and host notifications never depend on drawing. */
export class AlertVisuals {
  private readonly _lines = new Map<string, { pane: number; lines: PriceLine[] }>();
  public constructor(private readonly _chart: AlertChartHost) {}

  public update(alert: Alert, value: AlertDrawingValue | undefined, paused: boolean): void {
    if (!this._chart.addPrimitive || !this._chart.removePrimitive) return;
    if (!value) { this.remove(alert.id); return; }
    const prices = value.upperPrice === undefined ? [value.price] : [value.price, value.upperPrice];
    const canMove = movable(alert) && !paused;
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
        badge: badgeFor(alert.state, paused),
        leftLabel: alert.title + (prices.length === 2 ? (i === 0 ? ' (lower)' : ' (upper)') : ''),
        // The hint is what tells anybody the line can be moved at all. A line
        // that drags with no cursor change is a feature nobody finds.
        ...(canMove ? { cursor: 'ns-resize' } : {}),
      };
      const existing = group.lines[i];
      if (existing) {
        const previous = existing.options();
        if (Object.entries(options).some(([key, value]) => previous[key as keyof typeof previous] !== value)) existing.setOptions(options);
      } else {
        const line = new AlertPriceLine({ ...options, id: `alert:${alert.id}:${i}` }, canMove);
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
