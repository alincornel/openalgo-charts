# Chart data download

`exportChartDataCsv(chart, options?)` from `openalgo-charts` returns a CSV string.
It reads all currently installed primary bars, including the revealed replay
prefix. It does not fetch history or limit rows to the viewport. The host owns
authentication, source selection, the download filename and browser file delivery.

```ts
import { exportChartDataCsv } from 'openalgo-charts';

const csv = exportChartDataCsv(chart);
const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
```

Rows have fixed `time,open,high,low,close,volume,oi` fields. Time is UTC seconds;
numbers retain their input precision. Missing and nonfinite observations are
empty cells; a zero reading stays `0`. OI is the bar's level and is never summed.
Transformed charts export their installed transformed OHLC values. No drawings,
orders, positions, account state or credentials are included.

Each configured study contributes its declared plots, including hidden studies.
Column names are `indicator:<instanceId>:<plotKey>`, keeping repeated studies
distinct. Warmup/missing values are blank. These are computed values at the input
row, before visual plot offsets. Set `{ indicators: false }` to omit them.

Comparisons added through `addComparison` or `comparisonController` contribute
`comparison:<ordinal>:<symbol>:close` columns. Values are eligible aligned closes
in their original price units, even when the axis displays percentages. Calendar
gaps, unavailable common baselines and unrevealed replay candles remain blank.
Export does not create a comparison controller. For an explicitly constructed
`ComparisonController`, pass `{ comparisons: controller.list() }`; pass an empty
list to omit comparisons. These fields are declared by `ChartDataCsvOptions`.

Headers have fixed prefixes and CSV quoting for commas, quotes and newlines.
Data cells contain only finite numbers or blanks, so custom names cannot inject
spreadsheet formulas. Output uses CRLF row separators and a final newline. An
empty chart returns its headers with no data rows.

Hosts should capture the selected chart and its source when opening a download
menu, then reject the action if that owner changed or history is loading/failed.
Do not substitute a full replay history or an old source's cached bars. Treat a
browser download error as a failure and show it to the user.
