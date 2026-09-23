import type { Chart } from '../core/chart';
import { existingComparisonHandles, type ComparisonHandle } from '../compare/controller';
import { getIndicator } from './indicator-registry';

/** Options for a numeric snapshot of the chart's currently loaded data. */
export interface ChartDataCsvOptions {
  /** Include every configured study's declared plots, including hidden studies. Default true. */
  indicators?: boolean;
  /** Override the chart's registered comparisons, for example with an explicitly managed controller's list. */
  comparisons?: readonly Pick<ComparisonHandle, 'symbol' | 'barAt'>[];
}

const fields = ['time', 'open', 'high', 'low', 'close', 'volume', 'oi'] as const;
const numeric = (value: unknown): string => typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const cell = (text: string): string => /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

/**
 * CSV with UTC seconds, unrounded OHLC/volume/OI, study values and aligned comparison closes.
 * Reads only installed primary rows, so replay exposes only its revealed prefix.
 * Missing or nonfinite values are blank. Study values precede visual plot offsets;
 * comparison values retain their own price units, regardless of axis rebasing.
 * Headers have fixed prefixes so custom names cannot become spreadsheet formulas.
 * Does not fetch data, include trading state or initiate a browser download.
 */
export function exportChartDataCsv(chart: Chart, options: ChartDataCsvOptions = {}): string {
  const bars = chart.primaryBars();
  const columns = options.indicators === false ? [] : chart.indicators().flatMap(study => {
    const values = study.values();
    return getIndicator(study.indicatorId).plots.map(plot => ({
      name: `indicator:${study.id}:${plot.key}`, values: values[plot.key],
    }));
  });
  const comparisons = options.comparisons ?? existingComparisonHandles(chart);
  const headers: string[] = [...fields, ...columns.map(column => column.name),
    ...comparisons.map((item, index) => `comparison:${index + 1}:${item.symbol}:close`)];
  const rows = [headers.map(cell).join(',')];
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];
    rows.push([...fields.map(field => numeric(bar[field])),
      ...columns.map(column => numeric(column.values?.[index])),
      ...comparisons.map(item => numeric(item.barAt(bar.time)?.close))].join(','));
  }
  return rows.join('\r\n') + '\r\n';
}
