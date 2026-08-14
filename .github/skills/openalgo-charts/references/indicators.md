# Indicators

*When to read this: you are adding a built-in indicator to a chart, generating a settings UI from a descriptor, writing a custom indicator, or wiring an indicator whose data does not come from the chart's OHLCV.*

## The one-line import rule

```ts
import { createChart } from 'openalgo-charts';
import 'openalgo-charts/indicators'; // side effect: registers all 19 built-ins
```

- The base bundle ships **only** the registry (`registerIndicator`, `getIndicator`, ...) and the runtime (`IndicatorInstance`). The catalog lives in the lazy `openalgo-charts/indicators` tier.
- The import is a side effect. `src/indicators/index.ts` calls `registerBuiltinIndicators()` at module scope; it is also exported and idempotent, so a bundler that tree-shakes a bare side-effect import can call it explicitly.
- `getIndicator(id)` throws ``unknown indicator "<id>" — did you import 'openalgo-charts/indicators'?`` for an unregistered id. `chart.addIndicator` calls it, so guard user-supplied ids with `hasIndicator(id)`.
- `registeredIndicators()` reflects what has been registered *so far*. Read it after the tier import.

**A tier must import the registry from the package entry (`'openalgo-charts'`), never a deep path.** Each tier is its own rollup bundle with `openalgo-charts` marked external (`rollup.config.js`, `tierExternal`). A deep import is *inlined* instead — a second, private `Map` — so the tier registers into a registry `createChart` never reads. This applies to any tier bundle you build yourself.

## The 19 built-ins

`onchart` overlays the price pane (pane 0); `pane` claims a fresh pane. Defaults shown are the descriptor's declared `input.default`.

| id | Name | Category | Placement | Inputs (defaults) | Plot keys |
|---|---|---|---|---|---|
| `sma` | SMA | Trend | onchart | `length` 20, `source` `'close'`, `color` `'#4f8cff'` | `ma` |
| `ema` | EMA | Trend | onchart | `length` 20, `source` `'close'`, `color` `'#f5a623'` | `ma` |
| `wma` | WMA | Trend | onchart | `length` 20, `source` `'close'`, `color` `'#ab47bc'` | `ma` |
| `vwap` | VWAP | Volume | onchart | `anchor` `'session'` (or `'continuous'`), `source` `'hlc3'`, `color` `'#26c6da'` | `vwap` |
| `bollinger` | Bollinger Bands | Volatility | onchart | `length` 20, `stdDev` 2, `source` `'close'`, `basisColor` `'#f5a623'`, `bandColor` `'#4f8cff'` | `upper`, `basis`, `lower` |
| `supertrend` | Supertrend | Trend | onchart | `period` 10, `multiplier` 3, `upColor` `'#26a69a'`, `downColor` `'#ef5350'` | `up`, `down` |
| `parabolic-sar` | Parabolic SAR | Trend | onchart | `start` 0.02, `increment` 0.02, `maximum` 0.2, `color` `'#e0b020'` | `sar` |
| `ichimoku` | Ichimoku Cloud | Trend | onchart | `conversionPeriod` 9, `basePeriod` 26, `laggingSpanPeriod` 52, `displacement` 26, `conversionColor`, `baseColor`, `spanAColor`, `spanBColor`, `laggingColor`, `cloudUpColor`, `cloudDownColor` | `conversion`, `base`, `spanA`, `spanB`, `lagging` |
| `rsi` | RSI | Momentum | pane | `length` 14, `source` `'close'`, `color` `'#e0b020'`, `overbought` 70, `oversold` 30 | `rsi` |
| `macd` | MACD | Momentum | pane | `fastPeriod` 12, `slowPeriod` 26, `signalPeriod` 9, `source` `'close'`, `macdColor`, `signalColor`, `histUpColor`, `histUpFadeColor`, `histDownColor`, `histDownFadeColor` | `histogram`, `macd`, `signal` |
| `stochastic` | Stochastic | Momentum | pane | `kPeriod` 14, `kSmoothing` 3, `dPeriod` 3, `kColor`, `dColor` | `k`, `d` |
| `adx` | ADX / DMI | Trend | pane | `period` 14, `adxPeriod` 14, `adxColor`, `plusColor`, `minusColor` | `plusDi`, `minusDi`, `adx` |
| `cci` | CCI | Momentum | pane | `period` 20, `constant` 0.015, `color` `'#26c6da'` | `cci` |
| `mfi` | Money Flow Index | Momentum | pane | `period` 14, `color` `'#ab47bc'` | `mfi` |
| `atr` | ATR | Volatility | pane | `period` 14, `color` `'#f5a623'` | `atr` |
| `williams-vix-fix` | William VIX FIX | Volatility | pane | `pd` 22, `bbl` 20, `mult` 2, `lb` 50, `ph` 0.85, `pl` 1.01, `hp` `false`, `sd` `false`, `highColor`, `normalColor`, `rangeColor`, `bandColor` | `wvf`, `rangeHigh`, `rangeLow`, `upperBand` |
| `volume` | Volume | Volume | pane | `color` `'#3a4666'` | `volume` |
| `obv` | On-Balance Volume | Volume | pane | `color` `'#26c6da'` | `obv` |
| `adl` | Accumulation/Distribution | Volume | pane | `color` `'#4f8cff'` | `adl` |

Notes that bite:

- The three moving averages share the plot key `ma`. Style patches are per-instance, so this is not a collision, but do not key host state on the plot key alone.
- `vwap` defaults to `source: 'hlc3'`, not `'close'`, and anchors on the **IST trading day** (`isNewIstDay`). Pass `{ anchor: 'continuous' }` for a running VWAP.
- `supertrend` splits one band into two plots. Each carries `null` while the other is active so the line renderer breaks at flips. Direction convention: `-1` = uptrend (`up` plot), `+1` = downtrend (`down` plot).
- `williams-vix-fix` also returns `alertUpper` and `alertHigh` columns that no plot names. They exist so `colorBy` keeps working when `sd`/`hp` hide the bands. They appear in `values()` but are never drawn.
- Source values: `'open' | 'high' | 'low' | 'close' | 'hl2' | 'hlc3' | 'ohlc4' | 'volume'`. `INDICATOR_SOURCES` is the option list for a UI and deliberately omits `'volume'`.

## `chart.addIndicator`

```ts
addIndicator(
  indicatorId: string,
  settings?: Readonly<IndicatorSettings>,
  options?: { paneIndex?: number },
): IndicatorApi
```

`options.paneIndex` overrides placement entirely — a `pane` indicator can be dropped onto pane 0, or a second indicator onto an existing pane. An instance that did **not** create its own pane never applies `range()`; a shared pane belongs to whoever created it.

```ts
const macd = chart.addIndicator('macd', { fastPeriod: 8 });
const rsi = chart.addIndicator('rsi', {}, { paneIndex: macd.paneIndex }); // share the pane
```

`IndicatorApi` (`src/model/indicator-instance.ts`):

| Member | Type | Notes |
|---|---|---|
| `id` | `string` | Instance id, `` `${descriptorId}-${n}` ``. Pass this to `chart.removeIndicator`. |
| `indicatorId` | `string` | Descriptor id, e.g. `'macd'`. |
| `name` | `string` | Display name. |
| `paneIndex` | `number` | Mutable — the chart re-indexes it when panes move or are removed. |
| `settings()` | `IndicatorSettings` | A **copy**. Mutating it does nothing. |
| `setSettings(patch)` | `void` | Merge, restyle, recompute, re-run `attach`. |
| `series(plotKey)` | `SeriesApi \| undefined` | Backing series, for direct styling. |
| `values()` | `IndicatorValues` | Live **reference** into the last `calc` result. Do not mutate. |
| `visible()` / `setVisible(on)` | `boolean` / `void` | The legend eye toggle; hides plots and fills without removing. |
| `legend()` | `PaneLegend \| null` | This indicator's legend row. |
| `updateLegendValues(index?)` | `void` | Refresh readings for a bar index; omit for the latest bar. |
| `remove()` | `void` | Tears down series, levels, fills, legend. Idempotent. |

`recompute()` exists on `IndicatorInstance` but is **not** on the `IndicatorApi` type — the runtime calls it on data change. `chart.indicators()` lists live instances in add order; `chart.removeIndicator(instanceId)` returns `boolean` and prunes the pane if it emptied.

**Repeated instances get rotated colours.** The 2nd and later instances of the same descriptor id fill any *unset* plot colour key from `INSTANCE_PALETTE` (`#f5a623`, `#26a69a`, `#ab47bc`, `#ef5350`, `#26c6da`, `#8bc34a`, `#ff7043`, `#5c6bc0`), strided by plot count. An explicit colour in `settings` always wins, and the first instance is never touched. Three EMAs in one blue are indistinguishable on the chart and in the legend alike.

## The settings model

Two families of keys live in one flat `IndicatorSettings` bag:

1. **Declared inputs** — `descriptor.inputs`, keyed however the descriptor chose (`length`, `fastPeriod`, `anchor`, `color`).
2. **Generated per-plot style keys** — produced by `plotStyleKeys(plot)` for every plot, with no per-descriptor boilerplate:

| Key | Type | Default |
|---|---|---|
| `plot.colorKey ?? '<plotKey>:color'` | color | declared colour input's default, else `plot.style.color`, else `#4f8cff` |
| `'<plotKey>:opacity'` | number 0..100 | `100` |
| `'<plotKey>:width'` | number 0.5..8 step 0.5 | `plot.style.lineWidth ?? 1.5` |
| `'<plotKey>:lineStyle'` | select | `plot.style.lineStyle ?? 'solid'` (`INDICATOR_LINE_STYLES`: solid / dashed / dotted) |
| `'<plotKey>:type'` | select | `plot.type` (line, line-markers, step, area, histogram, column) |

**A descriptor that declares `colorKey` owns the colour key.** `plotStyleKeys` returns `plot.colorKey` in the `color` slot rather than `<plotKey>:color`, so a generated key would shadow the declared one and setting the declared key would silently stop working. Always read the key from `plotStyleKeys(plot).color` — never hand-build `` `${plot.key}:color` ``.

Opacity folds into the colour as alpha (a canvas stroke has no opacity channel). Changing `:type` **rebuilds the series** — a chart type belongs to the series, not the style bag.

Generating a dialog from a descriptor:

```ts
import { indicatorStyleInputs, plotStyleKeys } from 'openalgo-charts';

const descriptor = getIndicator(instance.indicatorId);
const current = instance.settings();
for (const input of [...descriptor.inputs, ...indicatorStyleInputs(descriptor)]) {
  // input.type: 'number' | 'boolean' | 'color' | 'text' | 'select' | 'source'
  // 'select' carries input.options; 'source' should render INDICATOR_SOURCES
  renderField(input, current[input.key] ?? input.default);
}
instance.setSettings(collectedPatch); // partial patch; untouched keys keep their value
```

The engine is canvas-only and ships no DOM, so the form is the host's. The legend's gear button emits an event instead of opening anything:

```ts
chart.on('indicatorSettings', (p) => {
  const { instanceId, indicatorId, paneIndex } = p as {
    instanceId: string; indicatorId: string; paneIndex: number;
  };
  openMyDialog(chart.indicators().find((i) => i.id === instanceId)!);
});
```

`chart.on` returns an unsubscribe function and payloads are `unknown` — cast at the boundary. Legend actions `close`, `hide`, `up`, `down`, `maximize` are handled **inside** the chart; only `settings` is delegated. `removeIndicator` also emits `indicatorRemoved` with the same payload shape. See [events-and-state](./events-and-state.md).

**`indicatorStyleInputs` is exported from the package entry; `INDICATOR_PLOT_STYLES` is not.** It is declared in `src/model/indicator-registry.ts` but absent from `src/index.ts`, so import it nowhere — read the plot-style option list off the generated `<plotKey>:type` input's `options` instead.

## Levels, fixed ranges, fills

`levels(settings)` returns horizontal reference lines drawn as `PriceLine`s in the indicator's pane (`{ price, color?, title?, dashed? }`, defaults `#8892a6` and dashed). `range(settings)` pins the pane's price scale.

| id | Levels | Fixed range |
|---|---|---|
| `rsi` | `overbought` (70), 50, `oversold` (30) | 0..100 |
| `stochastic` | 80, 20 | 0..100 |
| `mfi` | 80, 20 | 0..100 |
| `macd` | 0 | none |
| `adx` | 25 | none |
| `cci` | 100, 0, -100 | none |

**`range()` is applied only when the instance created its own pane.** Two indicators sharing a pane would otherwise fight over it, so an RSI added with `{ paneIndex: 1 }` onto someone else's pane will not pin 0..100.

`fills` shade a band between two plot keys — `ichimoku` is the only built-in that declares one (`between: ['spanA', 'spanB']`, `colorUpKey: 'cloudUpColor'`, `colorDownKey: 'cloudDownColor'`, `opacity: 0.14`). The band draws at `zOrder: 'bottom'`, returns `null` from `autoscaleInfo` (the plots already drive the scale), splits at the exact crossing rather than the nearest bar, and breaks across a gap in either plot instead of bridging it. Default opacity when unset is `0.12`; default colours `#26a69a` / `#ef5350`. See `src/primitives/indicator-fill.ts`.

## Writing a custom indicator

An indicator is data, not code in the core: the chart never switches on an id, and each plot names a registered chart type, so you add no drawing code. `calc` must return one array per plot key, exactly `bars.length` long, with `null` in warmup slots (the line renderer breaks across them and autoscale skips them).

```ts
import { registerIndicator, sourceValues, type IndicatorSource } from 'openalgo-charts';

registerIndicator({
  id: 'momentum',
  name: 'Momentum',
  category: 'Momentum',
  placement: 'pane',
  inputs: [
    { key: 'length', type: 'number', label: 'Length', default: 10, min: 1, max: 500, step: 1 },
    { key: 'source', type: 'source', label: 'Source', default: 'close' },
    { key: 'color', type: 'color', label: 'Color', default: '#4f8cff' },
  ],
  plots: [{ key: 'mom', type: 'line', title: 'Momentum', colorKey: 'color', style: { lineWidth: 1.5 } }],
  calc: (bars, s) => {
    const v = sourceValues(bars, (s.source as IndicatorSource) ?? 'close');
    const n = typeof s.length === 'number' ? s.length : 10;
    return { mom: v.map((x, i) => (i >= n ? x - v[i - n] : null)) };
  },
  levels: () => [{ price: 0, color: '#5a6b8c', dashed: true }],
});

chart.addIndicator('momentum', { length: 14 });
```

Optional descriptor members: `fills`, `colorBy` on a plot (per-bar colour; histogram and column renderers honour it, return `undefined` to fall back), `priceScaleId` on a plot, `range`, `attach`, and `calcTail`.

**Implement `calcTail` for anything running in a live pane.** Without it every tick costs a full `calc` — O(n) per tick *per indicator*. Return values for `[fromIndex, bars.length)` and the runtime splices them onto the previous result; return `null` to fall back. The runtime only takes the tail path when the bar count is unchanged or grew by exactly one, and `fromIndex` is `previousCount - 1` because the previously-last bar may have been replaced. Any settings change or external-data arrival resets the tail state to force a full recompute.

`registerIndicator` overwrites an existing id — later registration wins. Register before `addIndicator`.

## Tier 2: indicators with their own data

Use Tier 2 when the series is **not** derived from the chart's OHLCV: open interest, cumulative volume delta, PCR, an external analytics feed. `createTier2Indicator` (exported from `openalgo-charts/indicators`) wraps a fetch/subscribe lifecycle into an ordinary `IndicatorDescriptor` — the runtime, settings model, panes, levels, and removal are identical, and there is no second runtime.

```ts
import { registerIndicator } from 'openalgo-charts';
import { createTier2Indicator } from 'openalgo-charts/indicators';

registerIndicator(createTier2Indicator({
  id: 'open-interest',
  name: 'Open Interest',
  category: 'Volume',
  placement: 'pane',
  inputs: [{ key: 'symbol', type: 'text', label: 'Symbol', default: 'NIFTY' }],
  plots: [{ key: 'oi', type: 'line', title: 'OI', style: { lineWidth: 1.5 } }],
  refetchOn: ['symbol'],                       // only these keys invalidate the data
  fetch: async ({ settings, from, to }) => {   // from/to are UTC seconds of first/last bar
    const rows = await loadOpenInterest(String(settings.symbol), from, to);
    return rows.map((r) => ({ time: r.time, values: { oi: r.oi } }));
  },
  subscribe: (ctx, push) =>                    // returns an unsubscribe function
    streamOi(String(ctx.settings.symbol), (r) => push({ time: r.time, values: { oi: r.oi } })),
}));
```

`Tier2Point` is `{ time: UTCSeconds, values: Record<plotKey, number | null> }`. `Tier2Context` carries `{ settings, bars, from, to }`; `from`/`to` are `0` when there are no bars.

**Alignment rule, stated exactly.** Each bar takes the most recent external point whose time is **at or before** that bar's time. Values are last-known-value: never interpolated between points, never forward-looking. Bars before the first point are `null`, and so is any value that is not a finite number. Both arrays are time-sorted, so alignment is one linear merge.

Lifecycle facts:

- `attach` re-runs on **every** `setSettings`. The `store` survives, so `refetchOn` is what decides between a refetch and a pure re-alignment. Omitting `refetchOn` means the cache key is `''` and data is fetched once.
- Live points arriving out of order are upserted into time order; a point with an existing time replaces it.
- A rejected `fetch` leaves the previous points on screen rather than blanking the pane, and clears the cache key so the next settings change retries.
- Teardown marks the state dead, so a late `fetch` resolution is ignored and the subscription is closed.

## Standalone calculators in the base bundle

`ema`, `rsi`, `atr`/`trueRange`, and `supertrend` ship in the **base** bundle — the tier imports them rather than reimplementing them. Use these when you want to compute a value and plot it yourself, and skip the managed runtime (no legend row, no auto-recompute, no settings dialog, no pane management).

```ts
import { ema, emaSeries, rsi, rsiSeries, atr, trueRange, supertrend, supertrendSeries } from 'openalgo-charts';
```

| Function | Signature | Warmup |
|---|---|---|
| `ema` | `(values, period) => number[]` | none; seeds from `values[0]`, `k = 2/(period+1)`. Throws if `period <= 0`. |
| `emaSeries` | `(bars, period) => Bar[]` | O/H/L/C all set to the EMA — feed a `line` series. |
| `rsi` | `(values, period = 14) => number[]` | Wilder. `NaN` for indices `< period`. |
| `rsiSeries` | `(bars, period = 14) => Bar[]` | as above, plottable. |
| `trueRange` | `(high, low, close) => number[]` | none; `tr[0] = high[0] - low[0]`. |
| `atr` | `(high, low, close, period = 14) => number[]` | Wilder. First value at index `period - 1`. |
| `supertrend` | `(bars, period = 10, multiplier = 3) => SupertrendPoint[]` | `{ value, direction }`; `value` is `NaN` during ATR warmup. `direction` `-1` = uptrend, `+1` = downtrend. |
| `supertrendSeries` | `(bars, period, multiplier) => { up: Bar[]; down: Bar[] }` | inactive leg carries `NaN` so the line breaks at flips. |

The tier additionally exports pure helpers used by the descriptors: `sma`, `wma`, `rma`, `stdev`, `highest`, `lowest`, `nulls` from `openalgo-charts/indicators` (`src/indicators/calc.ts`). All return arrays the same length as their input with `NaN` in warmup slots; `nulls` converts `NaN` to `null` for a plot column. `sma` never lets a non-finite value poison its running sum, so chaining it onto another indicator's output works.

Related: [core-api](./core-api.md), [chart-types](./chart-types.md), [scales-and-panes](./scales-and-panes.md), [events-and-state](./events-and-state.md), [bundling-and-tiers](./bundling-and-tiers.md), [transforms](./transforms.md), [pitfalls](./pitfalls.md).
