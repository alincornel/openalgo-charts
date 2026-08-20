# Indicators

*When to read this: you are adding a built-in indicator to a chart, generating a settings UI from a descriptor, writing a custom indicator, or wiring an indicator whose data does not come from the chart's OHLCV.*

## The one-line import rule

```ts
import { createChart } from 'openalgo-charts';
import 'openalgo-charts/indicators'; // side effect: registers all 91 built-ins
```

- The base bundle ships **only** the registry (`registerIndicator`, `getIndicator`, ...) and the runtime (`IndicatorInstance`). The catalog lives in the lazy `openalgo-charts/indicators` tier.
- The import is a side effect. `src/indicators/index.ts` calls `registerBuiltinIndicators()` at module scope; it is also exported and idempotent, so a bundler that tree-shakes a bare side-effect import can call it explicitly.
- `getIndicator(id)` throws ``unknown indicator "<id>" — did you import 'openalgo-charts/indicators'?`` for an unregistered id. `chart.addIndicator` calls it, so guard user-supplied ids with `hasIndicator(id)`.
- `registeredIndicators()` reflects what has been registered *so far*. Read it after the tier import.

**A tier must import the registry from the package entry (`'openalgo-charts'`), never a deep path.** Each tier is its own rollup bundle with `openalgo-charts` marked external (`rollup.config.js`, `tierExternal`). A deep import is *inlined* instead — a second, private `Map` — so the tier registers into a registry `createChart` never reads. This applies to any tier bundle you build yourself.

## The 91 built-ins

`onchart` overlays the price pane (pane 0); `pane` claims a fresh pane. Defaults shown are the descriptor's declared `input.default`.

**Colour inputs are omitted from these tables on purpose.** Every descriptor declares its own colour keys (`color`, `upColor`, `macdColor`, `bandColor`, ...), and the only safe way to read one is `plotStyleKeys(plot).color`. Hand-composing `` `${plotKey}:color` `` is the single most common way to write an indicator patch that is silently ignored. See the settings model below.

`category` is one of exactly four strings, used only to group a picker UI: Trend (28), Momentum (28), Volatility (16), Volume (14).

### Trend (31)

| id | Name | Placement | Plot keys | Inputs (defaults) |
|---|---|---|---|---|
| `seasonality` | Seasonality | pane | `seasonality` (all-null; the output is a table) | `startYear` 2015, `cutoffPercent` 10, `tablePosition` `'Center'`, `tableWidth` 100, `tableHeight` 95 |
| `sma` | SMA | onchart | `ma` | `length` 20, `source` `'close'` |
| `ema` | EMA | onchart | `ma` | `length` 20, `source` `'close'` |
| `wma` | WMA | onchart | `ma` | `length` 20, `source` `'close'` |
| `supertrend` | Supertrend | onchart | `up`, `down` | `period` 10, `multiplier` 3 |
| `halftrend` | HalfTrend | onchart | `up`, `down`, `atrHigh`, `atrLow`, `buySignal`, `sellSignal` | `amplitude` 2, `channelDeviation` 2, `atrPeriod` 100, `showChannels` `true`, `showSignals` `true`, `showLabels` `true` |
| `parabolic-sar` | Parabolic SAR | onchart | `sar` | `start` 0.02, `increment` 0.02, `maximum` 0.2 |
| `ichimoku` | Ichimoku Cloud | onchart | `conversion`, `base`, `spanA`, `spanB`, `lagging` | `conversionPeriod` 9, `basePeriod` 26, `laggingSpanPeriod` 52, `displacement` 26 |
| `adx` | ADX / DMI | pane | `plusDi`, `minusDi`, `adx` | `period` 14, `adxPeriod` 14 |
| `alphatrend` | AlphaTrend | onchart | `alphatrend`, `lagged` | `coeff` 1, `AP` 14, `source` `'close'`, `showsignalsk` `true`, `novolumedata` `false` |
| `alma` | Arnaud Legoux Moving Average | onchart | `alma` | `length` 9, `offset` 0.85, `sigma` 6 |
| `dema` | Double EMA | onchart | `dema` | `length` 9, `source` `'close'` |
| `hma` | Hull Moving Average | onchart | `hma` | `length` 9, `source` `'close'` |
| `chande-kroll-stop` | Chande Kroll Stop | onchart | `stopLong`, `stopShort` | `p` 10, `x` 1, `q` 9 |
| `chandelier-exit` | Chandelier Exit | onchart | `longExit`, `shortExit` | `length` 22, `atrLength` 22, `atrMultiplier` 3 |
| `aroon` | Aroon | pane | `up`, `down` | `length` 14 |
| `aroon-oscillator` | Aroon Oscillator | pane | `osc` | `length` 14 |
| `kama` | Kaufman's Adaptive Moving Average | onchart | `kama` | `erLength` 10, `fastLength` 2, `slowLength` 30, `source` `'close'` |
| `lsma` | Least Squares Moving Average | onchart | `lsma` | `length` 25, `offset` 0, `source` `'close'` |
| `ma-cross` | MA Cross | onchart | `short`, `long`, `cross` | `shortLength` 9, `longLength` 21 |
| `cpr` | CPR with Floor Pivot | onchart | 27: `{d,w,m}` x `Pivot`, `S1`-`S3`, `R1`-`R3`, `Bc`, `Tc` | `pivotMode` `'auto'`, `showDaily` `true`, `showWeekly` `false`, `showMonthly` `false`, `displayS1R1` `false` |
| `mcginley-dynamic` | McGinley Dynamic | onchart | `mg` | `length` 14 |
| `median` | Median | onchart | `median`, `upper`, `lower`, `medianEma` | `source` `'hl2'`, `length` 3, `atrLength` 14, `atrMult` 2 |
| `ma-ribbon` | Moving Average Ribbon | onchart | `ma1`, `ma2`, `ma3`, `ma4` | `showMa1` `true`, `ma1Type` `'SMA'`, `ma1Source` `'close'`, `ma1Length` 20, `showMa2` `true`, `ma2Type` `'SMA'`, `ma2Source` `'close'`, `ma2Length` 50, `showMa3` `true`, `ma3Type` `'SMA'`, `ma3Source` `'close'`, `ma3Length` 100, `showMa4` `true`, `ma4Type` `'SMA'`, `ma4Source` `'close'`, `ma4Length` 200 |
| `tema` | Triple EMA | onchart | `tema` | `length` 9 |
| `twap` | Time Weighted Average Price | onchart | `twap` | `anchor` `'session'`, `source` `'ohlc4'`, `offset` 0 |
| `alligator` | Williams Alligator | onchart | `jaw`, `teeth`, `lips` | `jawLength` 13, `teethLength` 8, `lipsLength` 5, `jawOffset` 8, `teethOffset` 5, `lipsOffset` 3 |
| `vortex` | Vortex Indicator | pane | `vip`, `vim` | `length` 14 |
| `volatility-stop` | Volatility Stop | onchart | `up`, `down` | `length` 20, `source` `'close'`, `factor` 2 |
| `trend-strength-index` | Trend Strength Index | pane | `tsi` | `length` 14 |
| `williams-fractals` | Williams Fractals | onchart | `fractals` | `periods` 2, `showUp` `true`, `showDown` `true` |

### Momentum (29)

| id | Name | Placement | Plot keys | Inputs (defaults) |
|---|---|---|---|---|
| `rsi` | RSI | pane | `rsi` | `length` 14, `source` `'close'`, `overbought` 70, `oversold` 30 |
| `macd` | MACD | pane | `histogram`, `macd`, `signal` | `fastPeriod` 12, `slowPeriod` 26, `signalPeriod` 9, `source` `'close'` |
| `stochastic` | Stochastic | pane | `k`, `d` | `kPeriod` 14, `kSmoothing` 3, `dPeriod` 3 |
| `cci` | CCI | pane | `cci`, `ma`, `bbUpper`, `bbLower` | `period` 20, `constant` 0.015, `maType` `'SMA'`, `maLength` 14, `bbMult` 2 |
| `mfi` | Money Flow Index | pane | `mfi` | `period` 14 |
| `awesome-oscillator` | Awesome Oscillator | pane | `ao` | (none) |
| `balance-of-power` | Balance of Power | pane | `bop` | (none) |
| `chande-momentum` | Chande Momentum Oscillator | pane | `cmo` | `length` 9, `source` `'close'` |
| `coppock-curve` | Coppock Curve | pane | `curve` | `wmaLength` 10, `longRoCLength` 14, `shortRoCLength` 11 |
| `dpo` | Detrended Price Oscillator | pane | `dpo` | `period` 21, `isCentered` `false` |
| `fisher-transform` | Fisher Transform | pane | `fisher`, `trigger` | `length` 9 |
| `connors-rsi` | Connors RSI | pane | `crsi` | `lenrsi` 3, `lenupdown` 2, `lenroc` 100 |
| `know-sure-thing` | Know Sure Thing | pane | `kst`, `signal` | `roclen1` 10, `roclen2` 15, `roclen3` 20, `roclen4` 30, `smalen1` 10, `smalen2` 10, `smalen3` 10, `smalen4` 15, `siglen` 9 |
| `momentum` | Momentum | pane | `mom` | `len` 10, `source` `'close'` |
| `roc` | Rate Of Change | pane | `roc` | `length` 9, `source` `'close'` |
| `ppo` | Percentage Price Oscillator | pane | `hist`, `ppo`, `signal` | `source` `'close'`, `fastLength` 12, `slowLength` 26, `signalLength` 9, `oscType` `'EMA'`, `sigType` `'EMA'` |
| `trix` | TRIX | pane | `trix` | `length` 18 |
| `tsi` | True Strength Index | pane | `tsi`, `signal` | `long` 25, `short` 13, `signal` 13 |
| `smi-ergodic-indicator` | SMI Ergodic Indicator | pane | `erg`, `sig` | `longlen` 20, `shortlen` 5, `siglen` 5 |
| `smi-ergodic-oscillator` | SMI Ergodic Oscillator | pane | `osc` | `longlen` 20, `shortlen` 5, `siglen` 5 |
| `smi` | Stochastic Momentum Index | pane | `smi`, `ema` | `lengthK` 10, `lengthD` 3, `lengthEMA` 3 |
| `stochastic-rsi` | Stochastic RSI | pane | `k`, `d` | `smoothK` 3, `smoothD` 3, `lengthRSI` 14, `lengthStoch` 14, `source` `'close'` |
| `wavetrend` | WaveTrend Pro | pane | `mom`, `wt1`, `wt2` | `source` `'hlc3'`, `n1` 10, `n2` 21, `sigLen` 4, `obLevel1` 60, `osLevel1` -60, `showMom` `true`, `showRegDiv` `true`, `showHidDiv` `false` |
| `williams-percent-r` | Williams Percent Range | pane | `percentR` | `length` 14, `source` `'close'` |
| `ultimate-oscillator` | Ultimate Oscillator | pane | `uo` | `length1` 7, `length2` 14, `length3` 28 |
| `relative-vigor-index` | Relative Vigor Index | pane | `rvgi`, `signal` | `length` 10, `offset` 0 |
| `woodies-cci` | Woodies CCI | pane | `hist`, `turbo`, `cci14` | `cciTurboLength` 6, `cci14Length` 14 |
| `special-k` | Pring's Special K | pane | `specialK`, `signal` | `source` `'close'`, `length1` 100, `length2` 100 |
| `rsi-divergence` | RSI Divergence Indicator | pane | `rsi` | `length` 14, `source` `'close'`, `lbR` 5, `lbL` 5, `rangeUpper` 60, `rangeLower` 5, `plotBull` `true`, `plotHiddenBull` `false`, `plotBear` `true`, `plotHiddenBear` `false` |

### Volatility (17)

| id | Name | Placement | Plot keys | Inputs (defaults) |
|---|---|---|---|---|
| `bollinger` | Bollinger Bands | onchart | `upper`, `basis`, `lower` | `length` 20, `stdDev` 2, `source` `'close'` |
| `atr` | ATR | pane | `atr` | `period` 14 |
| `williams-vix-fix` | William VIX FIX | pane | `wvf`, `rangeHigh`, `rangeLow`, `upperBand` | `pd` 22, `bbl` 20, `mult` 2, `lb` 50, `ph` 0.85, `pl` 1.01, `hp` `false`, `sd` `false` |
| `envelope` | Envelope | onchart | `upper`, `basis`, `lower` | `length` 20, `percent` 10, `source` `'close'`, `exponential` `false` |
| `donchian` | Donchian Channels | onchart | `upper`, `basis`, `lower` | `length` 20, `offset` 0 |
| `bollinger-percent-b` | Bollinger Bands %b | pane | `percentB` | `length` 20, `source` `'close'`, `mult` 2 |
| `bollinger-bandwidth` | Bollinger BandWidth | pane | `bandwidth`, `expansion`, `contraction` | `length` 20, `source` `'close'`, `mult` 2, `expansionLength` 125, `contractionLength` 125 |
| `bb-trend` | BBTrend | pane | `bbtrend` | `shortLength` 20, `longLength` 50, `stdDevMult` 2 |
| `choppiness-index` | Choppiness Index | pane | `chop` | `length` 14, `offset` 0 |
| `historical-volatility` | Historical Volatility | pane | `hv` | `length` 10, `per` 1 |
| `average-daily-range` | Average Daily Range | pane | `adr` | `length` 14 |
| `chop-zone` | Chop Zone | pane | `chopZone` | (none) |
| `keltner-channel` | Keltner Channels | onchart | `upper`, `basis`, `lower` | `length` 20, `mult` 2, `source` `'close'`, `exp` `true`, `bandsStyle` `'Average True Range'`, `atrlength` 10 |
| `mass-index` | Mass Index | pane | `mi` | `length` 10 |
| `ulcer-index` | Ulcer Index | pane | `ui` | `source` `'close'`, `length` 14 |
| `range-analysis` | Range Analysis | pane | `range`, `avgRange` | `showAverage` `false`, `avgLength` 3 |
| `relative-volatility-index` | Relative Volatility Index | pane | `rvi`, `ma`, `bbUpper`, `bbLower` | `length` 10, `offset` 0, `maType` `'SMA'`, `maLength` 14, `bbMult` 2 |

### Volume (14)

| id | Name | Placement | Plot keys | Inputs (defaults) |
|---|---|---|---|---|
| `vwap` | VWAP | onchart | `vwap`, `upper1`, `lower1`, `upper2`, `lower2`, `upper3`, `lower3` | `anchor` `'session'`, `source` `'hlc3'`, `offset` 0, `calcMode` `'stdev'`, `showBand1` `true`, `bandMult1` 1, `showBand2` `false`, `bandMult2` 2, `showBand3` `false`, `bandMult3` 3 |
| `volume` | Volume | pane | `volume` | (none) |
| `obv` | On-Balance Volume | pane | `obv`, `ma`, `bbUpper`, `bbLower` | `maType` `'None'`, `maLength` 14, `bbMult` 2 |
| `adl` | Accumulation/Distribution | pane | `adl` | (none) |
| `chaikin-money-flow` | Chaikin Money Flow | pane | `cmf` | `length` 20 |
| `chaikin-oscillator` | Chaikin Oscillator | pane | `osc` | `short` 3, `long` 10 |
| `ease-of-movement` | Ease of Movement | pane | `eom` | `length` 14, `divisor` 10000 |
| `elder-force-index` | Elder Force Index | pane | `efi` | `length` 13 |
| `klinger-oscillator` | Klinger Oscillator | pane | `kvo`, `signal` | (none) |
| `vwma` | Volume Weighted Moving Average | onchart | `vwma` | `length` 20, `source` `'close'`, `offset` 0 |
| `nvi` | Negative Volume Index | pane | `nvi`, `ema` | `maLength` 255 |
| `pvi` | Positive Volume Index | pane | `pvi`, `ema` | `maLength` 255 |
| `pvt` | Price Volume Trend | pane | `pvt` | (none) |
| `pvo` | Percentage Volume Oscillator | pane | `hist`, `pvo`, `signal` | `fastLength` 12, `slowLength` 26, `signalLength` 9, `oscType` `'EMA'`, `sigType` `'EMA'` |

Notes that bite:

- **Ids are hyphenated lowercase and are not derivable from the display name.** `williams-percent-r`, not `willr`. `bollinger-percent-b`, not `bbpercentb`. `special-k` is named `Pring's Special K`. `momentum` takes `len`, not `length`. Resolve an id with `hasIndicator(id)` before calling `addIndicator`.
- Plot keys are namespaced per instance, not globally. `ma` is a plot key on `sma`, `ema`, `wma`, `cci`, `obv` and `relative-volatility-index`; `up`/`down` on `supertrend`, `halftrend`, `aroon` and `volatility-stop`; `signal` on `macd`, `ppo`, `pvo`, `tsi`, `klinger-oscillator`, `know-sure-thing`, `relative-vigor-index` and `special-k`. Style patches are per-instance, so this is not a collision, but do not key host state on the plot key alone.
- `select` inputs carry their own `options`. The recurring ones: `maType` on `cci`/`obv`/`relative-volatility-index` is `None | SMA | SMA + Bollinger Bands | EMA | SMMA (RMA) | WMA | VWMA`; `ma1Type`..`ma4Type` on `ma-ribbon` drop the first two; `oscType`/`sigType` on `ppo`/`pvo` are `EMA | SMA`; `bandsStyle` on `keltner-channel` is `Average True Range | True Range | Range`; `calcMode` on `vwap` is `stdev | percent`.
- `vwap` defaults to `source: 'hlc3'`, not `'close'`, and its session anchor is the **IST trading day** (`isNewIstDay`). `anchor` accepts `session | week | month | quarter | year | continuous`. It also declares six band plots (`upper1`/`lower1` .. `upper3`/`lower3`) with only band 1 shown by default. `twap` has the shorter `session | continuous`.
- `supertrend` splits one band into two plots. Each carries `null` while the other is active so the line renderer breaks at flips. Direction convention: `-1` = uptrend (`up` plot), `+1` = downtrend (`down` plot). `halftrend` and `volatility-stop` use the same two-plot split.
- **A `calc` result may carry columns that no plot names.** `williams-vix-fix` returns `alertUpper`/`alertHigh` so `colorBy` keeps working when `sd`/`hp` hide the bands; `supertrend` returns `bodyMid`; the shaded-band indicators return constant `upperLevel`/`lowerLevel`/`bandHigh`/`bandLow`/`zero` columns purely so a fill has something to reference. They appear in `values()` and are never drawn.
- Eight plots use `colorBy` for per-bar colour: `macd:histogram`, `williams-vix-fix:wvf`, `awesome-oscillator:ao`, `bb-trend:bbtrend`, `chop-zone:chopZone`, `ppo:hist`, `pvo:hist`, `woodies-cci:hist`. Only the `histogram` and `column` renderers honour it; everything else is a `line`.
- No built-in implements `calcTail`. Every one of them is a full O(n) recompute per data change, so a live pane with a dozen indicators is a dozen full passes per tick.
- Source values: `'open' | 'high' | 'low' | 'close' | 'hl2' | 'hlc3' | 'ohlc4' | 'volume'`. `INDICATOR_SOURCES` is the option list for a UI and deliberately omits `'volume'`.
- The descriptors are ports of well-known published formulas, faithful down to the warmup gap, so the numbers match a reference implementation bar for bar. They live in `src/indicators/` split by family: `trend.ts`, `momentum.ts`, `volume.ts`, `overlay.ts`, `oscillators.ts`, `volatility.ts`, `flow.ts`, `adaptive.ts`, `averages.ts`, `strength.ts`, `indices.ts`, `ranges.ts`, `signals.ts`, plus `external.ts` for the Tier-2 contract and `calc.ts` for the shared math. `index.ts` is a manifest that concatenates them into `BUILTIN_INDICATORS`.

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

`indicatorStyleInputs`, `plotStyleKeys`, `indicatorDefaults`, `INDICATOR_SOURCES`, `INDICATOR_LINE_STYLES` and `INDICATOR_PLOT_STYLES` are all exported from the package entry (`src/model/indicator-registry.ts`). `INDICATOR_PLOT_STYLES` is the `{ label, value }[]` behind the generated `<plotKey>:type` input, so a settings UI can render the plot-style dropdown without reading the input's `options`.

## Levels, fixed ranges, fills

`levels(settings)` returns horizontal reference lines drawn as `PriceLine`s in the indicator's pane (`{ price, color?, title?, dashed? }`, defaults `#8892a6` and dashed). `range(settings)` pins the pane's price scale. 36 built-ins declare `levels`, 12 declare `range`, and levels are computed from the live settings, so `rsi`'s are `overbought` / 50 / `oversold`, not the literals below.

| id | Levels (at default settings) | Fixed range |
|---|---|---|
| `rsi` | 70, 50, 30 | 0..100 |
| `macd` | 0 | none |
| `stochastic` | 80, 20 | 0..100 |
| `adx` | 25 | none |
| `cci` | 100, 0, -100 | none |
| `mfi` | 80, 20 | 0..100 |
| `aroon` | 50 | 0..100 |
| `aroon-oscillator` | 90, 0, -90 | -100..100 |
| `awesome-oscillator` | 0 | none |
| `balance-of-power` | 0 | none |
| `chande-momentum` | 0 | none |
| `dpo` | 0 | none |
| `fisher-transform` | 1.5, 0.75, 0, -0.75, -1.5 | none |
| `connors-rsi` | 70, 50, 30 | 0..100 |
| `bollinger-percent-b` | 1, 0.5, 0 | none |
| `bb-trend` | 0 | none |
| `choppiness-index` | 61.8, 50, 38.2 | 0..100 |
| `chop-zone` | none | 0..1 |
| `chaikin-money-flow` | 0 | none |
| `chaikin-oscillator` | 0 | none |
| `elder-force-index` | 0 | none |
| `klinger-oscillator` | 0 | none |
| `know-sure-thing` | 0 | none |
| `roc` | 0 | none |
| `ppo` | 0 | none |
| `trix` | 0 | none |
| `tsi` | 0 | none |
| `smi` | 40, 0, -40 | none |
| `pvo` | 0 | none |
| `ulcer-index` | 0 | none |
| `stochastic-rsi` | 80, 50, 20 | 0..100 |
| `williams-percent-r` | -20, -50, -80 | -100..0 |
| `relative-volatility-index` | 80, 50, 20 | none |
| `woodies-cci` | 100, 0, -100 | none |
| `special-k` | 0 | none |
| `trend-strength-index` | 1, 0, -1 | -1..1 |
| `rsi-divergence` | 70, 50, 30 | 0..100 |

**`range()` is applied only when the instance created its own pane.** Two indicators sharing a pane would otherwise fight over it, so an RSI added with `{ paneIndex: 1 }` onto someone else's pane will not pin 0..100.

### Fills

`fills` shade a band between two columns. 22 built-ins declare one, 28 fills in total. The band draws at `zOrder: 'bottom'`, returns `null` from `autoscaleInfo` (the plots already drive the scale), splits at the exact crossing rather than the nearest bar, and breaks across a gap in either column instead of bridging it. Default opacity when unset is `0.12`; default colours `#26a69a` / `#ef5350`. See `src/primitives/indicator-fill.ts`.

**`IndicatorFillSpec.between` resolves against `calc` output columns, not against declared plots.** That is the idiom behind every shaded overbought/oversold band in the catalogue: the descriptor returns two constant columns that no plot names, and fills between them.

```ts
// RSI: a shaded 70..30 band, drawn without plotting either edge.
plots: [{ key: 'rsi', type: 'line', title: 'RSI', colorKey: 'color' }],
fills: [{ between: ['upperLevel', 'lowerLevel'], colorUpKey: 'bandColor', colorDownKey: 'bandColor', opacity: 0.1 }],
calc: (bars, s) => ({
  rsi: /* ... */,
  upperLevel: bars.map(() => num(s, 'overbought', 70)),  // never plotted
  lowerLevel: bars.map(() => num(s, 'oversold', 30)),    // never plotted
}),
```

The three shapes actually used by the built-ins:

| Shape | Between | Used by |
|---|---|---|
| Background band between two constant columns | `upperLevel`/`lowerLevel`, `bandHigh`/`bandLow`, or a series against a constant `zero` | `rsi`, `stochastic`, `cci`, `mfi`, `connors-rsi`, `bollinger-percent-b`, `choppiness-index`, `smi`, `stochastic-rsi`, `williams-percent-r`, `relative-volatility-index`, `aroon-oscillator`, `ulcer-index` |
| Channel between two plotted edges | `upper`/`lower`, `spanA`/`spanB`, `bbUpper`/`bbLower`, `median`/`medianEma` | `ichimoku`, `envelope`, `donchian`, `keltner-channel`, `median`, `cci`, `obv`, `relative-volatility-index`, `vwap` (three band pairs) |
| Trend ribbon between a stop line and a reference column | `bodyMid`/`up`, `bodyMid`/`down`, `up`/`atrLow`, `down`/`atrHigh` | `supertrend`, `halftrend` |

`colorUpKey` and `colorDownKey` are settings keys, so a fill is restyleable like anything else. Setting them to the same key (which most of these do) gives a single-colour band rather than a two-tone one.

## Signal markers

`IndicatorDescriptor.markers` is an optional hook returning bar-anchored `SeriesMarker[]`. It runs after every `calc` and reads the values `calc` just produced, so it recomputes nothing.

```ts
markers?(ctx: {
  bars: readonly Bar[];
  values: IndicatorValues;
  settings: Readonly<IndicatorSettings>;
}): readonly SeriesMarker[];
```

A plot cannot express this: a plot is a column of prices drawn as a line or a histogram, whereas a signal is a discrete named event at one bar.

- Three built-ins use it: `halftrend` (Buy/Sell plates at flips, suppressed by `showLabels: false`), `williams-fractals` (up/down triangles at pivots), `rsi-divergence` (Bull / H Bull / Bear / H Bear plates at pivots).
- Returning `[]` clears the layer. That is how a `showLabels`-style boolean input turns markers off without a rebuild.
- The layer comes from `series.createMarkers()` on the **first plot's** series and is created lazily, only once the descriptor actually returns a marker, so a no-marker indicator costs no extra primitive.
- **Markers are a separate primitive from the plots.** `setVisible(false)` hides both because the runtime re-runs the hook with an empty result, but a plot-level style patch does not touch them.

`MarkerShape` includes two label shapes for named signals: `labelUp` and `labelDown` are rounded text plates with a tail that points **at** the anchor price, so the body sits clear of the bar. `labelUp`'s tail is on the top edge and its body hangs below the anchor; `labelDown` is the mirror. Both require `text`. The renderer is exported as `drawLabel(ctx, up, cx, anchorY, text, color, fontPx)` alongside `drawShape`, `markerSizePx` and `effectiveMarkerPx`, all in bitmap px with dpr already applied by the caller.

```ts
{ time: bar.time, position: 'atPrice', price, shape: 'labelUp', size: 'small', color: '#2962ff', text: 'Buy' }
```

## Tables

`table` is an optional hook beside `markers`, for an indicator whose output is a matrix
rather than a column of prices: a plot is one price per bar, and a monthly return heatmap
is neither. It runs after every `calc`, so it reads the values it just produced. Return
`null` to draw nothing.

```ts
registerIndicator({
  id: 'my-scoreboard',
  name: 'My Scoreboard',
  placement: 'pane',
  inputs: [],
  // A pane needs a plot to exist. An all-null column draws nothing and
  // contributes nothing to autoscale, so the pane gets no price axis at all.
  plots: [{ key: 'placeholder', type: 'line', title: 'Scoreboard' }],
  calc: (bars) => ({ placeholder: new Array(bars.length).fill(null) }),
  table: ({ bars, values, settings }) => ({
    rows: [
      [{ text: 'Metric', bold: true }, { text: 'Value', bold: true }],
      [{ text: 'Bars' }, { text: String(bars.length) }],
    ],
    options: { position: 'top-right', cellWidth: [80, 60], cellHeight: 18 },
  }),
});
```

Cells take `text`, `bgColor`, `textColor`, `align`, `fontSize` and `bold`; `textColor` is
derived from `bgColor` for contrast when omitted. Options take `position` (nine keywords),
`margin`, `cellWidth` (number or per-column array), `cellHeight`, `widthPercent`,
`heightPercent`, `rowWeights`, `fontSize`, `borderColor`, `borderWidth`, `background` and
`id`. The percentage sizes stretch the grid to a share of the plot while preserving the
column proportions; `rowWeights` keeps a separator row thin when it does.

One built-in uses the hook: `seasonality`, whose entire output is the grid.

## Trading sessions

Anything that accumulates within a trading day (VWAP, TWAP, daily pivots) has to know
where the day ends, and a calendar midnight is the wrong answer for every exchange but
the one whose timezone you picked. 00:00 IST is 18:30 UTC, which is the middle of a New
York session: anchoring there restarts a VWAP every afternoon and builds a "daily" range
out of one session's tail plus the next session's head across the overnight gap.

Read the session out of the bar gaps instead:

```ts
import { sessionStartFlags, calendarPeriodFlags } from 'openalgo-charts';

const newSession = sessionStartFlags(bars.map((b) => b.time));  // boolean per bar
```

| Export | Returns |
|---|---|
| `sessionStartIndices(times)` | Bar indices that open a session, or `null` when unreadable. |
| `sessionStartFlags(times)` | One flag per bar; falls back to IST calendar days when unreadable. |
| `calendarPeriodFlags(times, isNew)` | A week/month/year boundary tested on session opens, so a session is never cut in half. |

Unreadable means bars already a day or coarser, a market that never closes, or a feed
whose only gaps are weekends. An intraday lunch break is under the four-hour floor, so it
is not mistaken for a close.

## Writing a custom indicator

An indicator is data, not code in the core: the chart never switches on an id, and each plot names a registered chart type, so you add no drawing code. `calc` must return one array per plot key, exactly `bars.length` long, with `null` in warmup slots (the line renderer breaks across them and autoscale skips them).

```ts
import { registerIndicator, sourceValues, type IndicatorSource } from 'openalgo-charts';

registerIndicator({
  id: 'my-momentum',                 // `momentum` is taken: registering it would replace the built-in
  name: 'My Momentum',
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

chart.addIndicator('my-momentum', { length: 14 });
```

Optional descriptor members: `fills`, `markers`, `levels`, `range`, `attach`, `calcTail`, plus `colorBy` (per-bar colour; histogram and column renderers honour it, return `undefined` to fall back) and `priceScaleId` on an individual plot.

**Implement `calcTail` for anything running in a live pane.** Without it every tick costs a full `calc` — O(n) per tick *per indicator*. Return values for `[fromIndex, bars.length)` and the runtime splices them onto the previous result; return `null` to fall back. The runtime only takes the tail path when the bar count is unchanged or grew by exactly one, and `fromIndex` is `previousCount - 1` because the previously-last bar may have been replaced. Any settings change or external-data arrival resets the tail state to force a full recompute.

`registerIndicator` overwrites an existing id, later registration wins. With 91 built-ins the id space is crowded, so namespace a custom id (`my-momentum`, `acme-vwap`) unless you intend to replace a built-in. Register before `addIndicator`.

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

The tier additionally exports pure helpers used by the descriptors: `sma`, `wma`, `rma`, `stdev`, `highest`, `lowest`, `nulls` and `connorsStreak` from `openalgo-charts/indicators` (`src/indicators/calc.ts`). All return arrays the same length as their input with `NaN` in warmup slots; `nulls` converts `NaN` to `null` for a plot column. `sma` never lets a non-finite value poison its running sum, so chaining it onto another indicator's output works. `src/indicators/calc.ts` holds more (`rollingSum`, `correlation`, `pivotHigh`, `pivotLow`, `barsSince`, `valueWhen`, ...) but the tier index re-exports only the list above, so anything else is internal.

The tier also exports every descriptor by name in SCREAMING_SNAKE form (`RSI`, `MACD`, `HALFTREND`, ...), the per-family arrays (`OVERLAY_INDICATORS`, `OSCILLATOR_INDICATORS`, `VOLATILITY_INDICATORS`, `FLOW_INDICATORS`, `ADAPTIVE_INDICATORS`, `AVERAGE_INDICATORS`, `STRENGTH_INDICATORS`, `INDEX_INDICATORS`, `RANGE_INDICATORS`, `SIGNAL_INDICATORS`), and the flat `BUILTIN_INDICATORS`. Read `BUILTIN_INDICATORS` rather than hard-coding a list of ids.

Related: [core-api](./core-api.md), [chart-types](./chart-types.md), [scales-and-panes](./scales-and-panes.md), [events-and-state](./events-and-state.md), [bundling-and-tiers](./bundling-and-tiers.md), [transforms](./transforms.md), [pitfalls](./pitfalls.md).
