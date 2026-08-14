# Scales and panes

*When to read this: configuring a price axis, pinning an overlay to part of a pane, controlling zoom or the visible bar range, or building/resizing/removing a multi-pane layout.*

Source of truth: `src/scale/price-scale.ts`, `src/scale/time-scale.ts`, `src/scale/ticks.ts`, `src/core/pane.ts`, `src/core/chart.ts`.

## PriceScaleOptions

```ts
import { DEFAULT_PRICE_SCALE_OPTIONS } from 'openalgo-charts';
// { marginTop: 0.1, marginBottom: 0.1, minMove: 0, mode: 'linear', inverted: false }
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `marginTop` | `number` | `0.1` | Fraction of **pane height** kept empty above the data band. |
| `marginBottom` | `number` | `0.1` | Fraction of **pane height** kept empty below the data band. |
| `minMove` | `number` | `0` | Instrument tick size (e.g. `0.05`). `0` infers precision from the visible range. |
| `mode` | `'linear' \| 'logarithmic'` | `'linear'` | `logarithmic` maps through `log10`, clamped at `1e-10`. |
| `inverted` | `boolean` | `false` | Price increases downward. |

`ChartOptions.priceScale` is applied to each pane's **right** scale as that pane is created; left and overlay scales always start from the defaults. Per scale at runtime:

```ts
series.priceScale().setOptions({ marginTop: 0.82, marginBottom: 0 });
chart.panes()[0].priceScale.setOptions({ minMove: 0.05, mode: 'logarithmic' });
```

**Margins are fractions of pane height, not of the data span.** Since 1.0.26 `autoscaleRange(low, high, marginTop, marginBottom)` gives the data band exactly `1 - marginTop - marginBottom` of the pane: `total = span / visible`, `min = low - total * marginBottom`, `max = high + total * marginTop`. Before 1.0.26 it padded the span, so `marginTop: 0.82` left the series 55% of the pane instead of 18%. Margins summing to 1 or more are clamped to a 0.01 sliver so the range stays finite.

**`percentage` and `indexed-to-100` modes are NOT implemented.** `PriceScaleMode` is `'linear' | 'logarithmic'` and nothing else; there is no baseline-rebasing mode in this library.

### Range control

| Member | Notes |
|---|---|
| `autoScale` (getter) | `true` while the range tracks the data. |
| `setAutoScale(on)` | `false` freezes the current range. |
| `setPriceRange({ min, max })` | Sets the range and marks the scale as scaled. |
| `priceRange()` | `{ min, max }`. |
| `autoscale(low, high)` | Applies `autoscaleRange` with the configured margins. |
| `scaleAroundCenter(factor)` | `>1` widens, `<1` narrows. Switches to manual. |
| `panByPixels(dy)` | Shifts in transformed space, honours `inverted`. Switches to manual. |
| `scaled` (getter) | `false` until a real range is applied; the placeholder is `0..1`. |

Freezing a range means both `setPriceRange` and `setAutoScale(false)`:

```ts
const ps = chart.panes()[2].priceScale;
ps.setAutoScale(false);
ps.setPriceRange({ min: 0, max: 100 });   // e.g. an RSI pane
ps.setAutoScale(true);                     // hand it back to the data
```

`chart.resetScale()` (also double-click) re-enables autoscale on every pane and fits content.

### Conversion and formatting

`priceToY(price)` / `yToPrice(y)` are pane-local media px; `chart.priceToCoordinate` / `chart.coordinateToPrice` add the pane's top offset. `precision()` derives decimals from `minMove` (or `range/100`), `snapToTick(price)` rounds to `minMove`, `format(price)` renders the axis label, `setPriceFormatter(fn | null)` overrides it, `clampY(y)` clamps to the pane. Tick values come from `niceTicks(min, max, maxTicks = 6)` on the 1 / 2 / 2.5 / 5 / 10 ladder.

### Autoscale rules

Per frame, for each active scale on a pane: skip if `autoScale` is false; scan only visible bars of series matching that scale id and not `visible: false`; take `min`/`max` from the chart type's `extents(bar, style)`. **Only the `'right'` scale also folds in primitive `autoscaleInfo()`** — a `PriceLine` widens the right axis but never the left or overlay one.

## The three scale ids

`PriceScaleId` is `'right' | 'left' | ''`.

| Id | Axis drawn | Autoscales | Typical use |
|---|---|---|---|
| `'right'` | Right strip | Independently | Default for every series. |
| `'left'` | Left strip | Independently | A second instrument or spread at a different magnitude. |
| `''` | None (hidden) | Independently | Volume pinned inside the price pane. |

A pane creates the left and overlay scales lazily, on the first `addSeries` that names them (`Pane._scaleFor`). When any pane has a live left scale, the chart reserves a chart-wide left column of `priceAxisWidth` px and shifts every plot right by it.

```ts
const vol = chart.addSeries('histogram', {
  priceScaleId: '',                    // no axis of its own
  priceFormat: { type: 'volume' },
});
vol.priceScale().setOptions({ marginTop: 0.82, marginBottom: 0 });  // bottom ~18%
```

**`pane.priceScale` is the `'right'` scale only.** The left and overlay scales are private; reach them with `series.priceScale()` or `pane.scaleOf(record)`. Consequences: the crosshair price tag, `chart.priceToCoordinate`, `PrimitiveRenderContext.priceScale` and the `getState` snapshot all read the right scale, whatever the pointer is over.

## TimeScaleOptions

```ts
import { DEFAULT_TIME_SCALE_OPTIONS } from 'openalgo-charts';
// { barSpacing: 8, minBarSpacing: 1, maxBarSpacing: 80, rightOffset: 4 }
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `barSpacing` | `number` | `8` | Media px per bar. Always clamped to `[minBarSpacing, maxBarSpacing]`. |
| `minBarSpacing` | `number` | `1` | Floor; read once in the constructor, not settable later. |
| `maxBarSpacing` | `number` | `80` | Ceiling; read once in the constructor, not settable later. |
| `rightOffset` | `number` | `4` | Empty bar slots kept right of the latest bar. Unclamped. |

The chart constructs its own `TimeScale` with defaults — **`ChartOptions` has no `timeScale` key**. Tune the live instance:

```ts
chart.timeScale.setBarSpacing(12);
chart.timeScale.setRightOffset(8);
chart.timeScale.fitContent(bars.length);
```

`chart.timeScale` is shared by every pane, which is why panes stay aligned bar-for-bar.

### The logical-index model

`x = width - (baseIndex + rightOffset - index) * barSpacing`. The x of a bar is a function of its **integer position in the series**, never of its timestamp. Bars get consecutive indices regardless of the real elapsed time between them, so weekends, holidays and session breaks have no index and therefore no blank space to draw — the axis is gapless by construction. `xToIndex` is the exact inverse and returns a fractional index.

`visibleRange()` returns `{ from, to }` as fractional logical indices, unclamped to the data (it can run negative or past the last bar). `setVisibleLogicalRange({ from, to })` picks `barSpacing = width / span`, anchors the right edge at `to`, and fires the repaint hook — it is a no-op when width or span is not positive, and an extreme span lands at the nearest clamped zoom. `zoomAtX(focusX, factor)` keeps the index under `focusX` pinned. `fitContent(barCount)` sets `baseIndex = barCount - 1`, resets `rightOffset` to `4`, and sizes bars to `width / (barCount + rightOffset)`.

## How interaction mutates the scales

Details in [interactions](interactions.md); what matters here is which gesture leaves a scale in **manual** mode.

| Gesture | Effect | Leaves manual? |
|---|---|---|
| Wheel | `timeScale.zoomAtX(x, 1.1 or 1/1.1)` | no |
| Drag inside the plot | horizontal: `setRightOffset`; vertical: `panByPixels` on the pressed pane | **yes** (price scale) |
| Drag the price axis strip (`x >= width - priceAxisWidth`) | `setPriceRange` around the centre by `exp(dy * 0.005)`, then `setAutoScale(false)` | **yes** |
| Drag the time axis strip (bottom pane, last `timeAxisHeight` px) | `setBarSpacing(start * exp(dx * 0.005))` | no |
| Two-finger pinch | zoom time, pan time, `panByPixels` on the pinched pane | **yes** (price scale) |
| Double-click | `chart.resetScale()` | no — restores autoscale everywhere |
| `panUp` / `panDown` shortcuts | `panByPixels(±20)` on **pane 0 only** | **yes** |

**Once a pane goes manual it stops tracking new data.** A live feed that keeps printing highs will run off the top of a pane whose axis the user dragged. Call `pane.priceScale.setAutoScale(true)` or `chart.resetScale()` to recover.

## Panes

A pane is one stacked drawing region with its own scales and canvases. Reference a `paneIndex` in `addSeries` (or `addIndicator`) and every missing pane up to it is created: pane 0 with weight `1`, later panes with weight `0.32`.

```ts
chart.addSeries('candlestick');                       // pane 0
chart.addSeries('histogram', { paneIndex: 1 });       // pane 1, created here
chart.addSeries('line', { paneIndex: 2 });            // pane 2
```

Heights are **relative weights**, not pixels: pane height is `chartHeight * weight / sumOfWeights`.

| Method | Returns | Notes |
|---|---|---|
| `chart.setPaneWeight(index, weight)` | `void` | Clamped to a minimum of `0.05`. Unknown index is a silent no-op. |
| `chart.paneWeight(index)` | `number` | `0` for an unknown index. |
| `chart.removePane(index)` | `boolean` | Removes its series, data rows and indicators. |
| `chart.movePane(index, -1 \| 1)` | `boolean` | Swaps with the neighbour and re-appends the DOM in order. |
| `chart.maximizePane(index)` | `boolean` | Toggle: expands one pane, parks the rest at weight `0.001`. |
| `chart.maximizedPane()` | `number \| null` | |
| `chart.panes()` | `readonly Pane[]` | Live array. |

Each call emits an event: `paneRemoved`, `paneMoved`, `paneMaximized`, and `paneResized` after a divider drag.

**Pane 0 is pinned.** `removePane(0)` and any `movePane` that would displace pane 0 return `false` — including `movePane(1, -1)`. Both also return `false` for an out-of-range index, so check the boolean rather than assuming success.

**Removing a pane re-indexes everything below it.** Indicators shift with their pane, but any `paneIndex` a host has cached is stale afterwards.

Panes with no series left are pruned automatically: `removeIndicator` drops an emptied pane above index 0, and `restoreState` sweeps every empty pane backwards.

### Divider dragging

Pressing within `4` media px of a boundary starts a resize; the cursor becomes `row-resize` on hover. The drag moves height between the two adjacent panes only, conserving their summed weight so the rest of the stack is untouched, and clamps each side to at least `min(24px, total/4)`. A pane boundary wins over a primitive hit, because legend rows sit directly below one.

`chart.getState()` persists every pane's `weight` plus its right scale's `marginTop`, `marginBottom`, `minMove`, `mode`, `inverted`, `autoScale` and (when manual) `range`. See [events-and-state](events-and-state.md).
