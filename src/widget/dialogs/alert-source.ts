import { getIndicator, registeredBarConditions, type AlertSource, type IndicatorApi } from 'openalgo-charts';
import type { WidgetContext } from '../context';
import { toolName } from '../rail';
import type { FormControl } from '../form';

type Choice = { value: string; label: string };
const kinds: Choice[] = [
  { value: 'price', label: 'Price' }, { value: 'indicator', label: 'Study plot' },
  { value: 'drawing', label: 'Drawing level' }, { value: 'barCondition', label: 'Candle condition' },
];
const select = (key: string, label: string, options: Choice[]): FormControl => ({ key, label, kind: 'select', options });
const plots = (instance: IndicatorApi | undefined, pane?: number): Choice[] => instance
  ? getIndicator(instance.indicatorId).plots.filter(plot => pane === undefined || (plot.overlay ? 0 : instance.paneIndex) === pane)
    .map(plot => ({ value: plot.key, label: plot.title })) : [];

/** Resolve stable identities without replacing a removed selection with another object. */
export function alertSourceFields(ctx: WidgetContext, draft: Record<string, unknown>): {
  source: AlertSource; controls: FormControl[]; reason?: string; hint?: string;
} {
  const controls = [select('kind', 'Source', kinds)];
  const instances = ctx.chart.indicators();
  const bars = ctx.chart.primaryBars();
  const at = bars.length - 1;
  const choose = (key: string, options: Choice[]): string => {
    if (draft[key] === undefined) draft[key] = options[0]?.value ?? '';
    return String(draft[key]);
  };
  const studies = (items: readonly IndicatorApi[]): Choice[] => items.map(instance => ({
    value: instance.id, label: `${instances.indexOf(instance) + 1}: ${instance.name}`,
  }));
  const kind = draft.kind;
  if (kind === 'barCondition') {
    const conditions = registeredBarConditions().map(item => ({ value: item.id, label: item.title }));
    const id = choose('barConditionId', conditions);
    controls.push(select('barConditionId', 'Candle condition', conditions));
    return { source: { kind, id }, controls, reason: conditions.some(item => item.value === id) ? undefined : 'Candle condition is unavailable' };
  }
  if (kind === 'indicator') {
    const instanceId = choose('instanceId', studies(instances));
    const instance = instances.find(item => item.id === instanceId);
    const choices = plots(instance);
    const plotKey = choose('plotKey', choices);
    controls.push(select('instanceId', 'Study', studies(instances)), select('plotKey', 'Plot', choices));
    const value = instance?.values()[plotKey]?.[at];
    if (!('value' in draft)) draft.value = value ?? undefined;
    return {
      source: { kind, instanceId, plotKey, value: draft.value as number, upperValue: draft.upperValue as number | undefined }, controls,
      reason: !instance ? 'Study instance is unavailable' : !instance.series(plotKey) ? 'Study plot is unavailable' : undefined,
      hint: Number.isFinite(value) ? undefined : 'The current plot value is unavailable. The alert waits for observed values.',
    };
  }
  if (kind === 'drawing') {
    const drawings = ctx.draw.drawings();
    const choices = drawings.map((item, index) => ({ value: item.id, label: `${toolName(item.tool)} (${index + 1})` }));
    const drawingId = choose('drawingId', choices);
    const info = ctx.draw.alertInfo(drawingId);
    const levels = info.levels.map(item => ({ value: item.id, label: item.title }));
    const level = choose('level', levels);
    controls.push(select('drawingId', 'Drawing', choices), select('level', 'Level', levels));
    const compatible = instances.filter(item => plots(item, info.paneIndex).length > 0);
    const inputs = studies(compatible);
    if (info.paneIndex === 0) inputs.unshift({ value: '', label: 'Price' });
    const inputInstanceId = choose('inputInstanceId', inputs);
    controls.push(select('inputInstanceId', 'Compare with', inputs));
    const instance = compatible.find(item => item.id === inputInstanceId);
    let input: { instanceId: string; plotKey: string } | undefined;
    if (inputInstanceId) {
      const choices = plots(instance, info.paneIndex);
      const plotKey = choose('inputPlotKey', choices);
      input = { instanceId: inputInstanceId, plotKey };
      controls.push(select('inputPlotKey', 'Input plot', choices));
    }
    const reason = !info.available ? info.reason
      : !levels.some(item => item.value === level) ? 'Drawing level is unavailable'
        : input ? !plots(instance, info.paneIndex).some(plot => plot.value === input.plotKey) ? 'Select an input plot on the drawing pane' : undefined
          : info.paneIndex !== 0 ? 'Select an input plot on the drawing pane' : undefined;
    return { source: { kind, drawingId, level, ...(input ? { input } : {}) }, controls, reason };
  }
  if (!('price' in draft)) draft.price = bars[at]?.close;
  return { source: { kind: 'price', price: draft.price as number, upperPrice: draft.upperPrice as number | undefined }, controls };
}
