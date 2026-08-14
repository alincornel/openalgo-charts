# Themes and styling

*When to read this: picking or building a palette, swapping dark/light at runtime, overriding colours on one series, or controlling how values are formatted on an axis.*

Source of truth: `src/theme.ts`, `src/render/series-style.ts`, `src/model/chart-type-registry.ts`, `src/render/gradient.ts`, `src/core/pane.ts`.

## ChartTheme

One plain object drives chrome, series defaults and the trade layer. All fields are required except the five marked optional.

**Chrome**

| Key | Type | Notes |
|---|---|---|
| `background` | `string` | Pane fill. Also written to the container's inline background. |
| `grid` | `string` | Grid line colour. |
| `axisText` | `string` | Axis tick label colour. |
| `axisLine` | `string` | Axis rule colour. |
| `paneSeparator` | `string` | 1px CSS border-top on every pane but the first. |
| `axisFontSize?` | `number` | Default `11`; renders as `${n}px system-ui, sans-serif`. |
| `gridStyle?` | `'solid' \| 'dashed' \| 'dotted'` | Default `'solid'`. Dashed is `[4,4]`, dotted `[1,3]`, scaled by dpr. |

**Crosshair**

| Key | Type | Notes |
|---|---|---|
| `crosshair` | `string` | Line colour, and the default tag background. |
| `crosshairStyle?` | `'solid' \| 'dashed' \| 'dotted'` | Default `'dashed'`. |
| `crosshairWidth?` | `number` | Device px. Default `1`. |
| `crosshairLabelBackground?` | `string` | Falls back to `crosshair`. |
| `crosshairLabelVisible?` | `boolean` | Default `true`; `false` hides both value tags. |

**Series colours**

| Key | Feeds |
|---|---|
| `upColor` / `downColor` | Candle bodies, candle borders, bar and column strokes. |
| `wickUpColor` / `wickDownColor` | Candle wicks. |
| `lineColor` | `line`, `line-markers`, `step`, `area` stroke; `hlc-area` close stroke. |
| `areaTopColor` / `areaBottomColor` | `area` vertical gradient stops. |
| `baselineTopLine` / `baselineBottomLine` | `baseline` stroke above / below the base. |
| `baselineTopFill` / `baselineBottomFill` | `baseline` fill above / below the base. |

**Last price**

| Key | Notes |
|---|---|
| `lastPriceUp` / `lastPriceDown` | Last-price tag background by direction. |
| `lastPriceText` | Tag text colour — **also the crosshair tag text colour**. |

**Trade layer**

`buy`, `sell`, `profit`, `loss` — consumed by the trading controller and its primitives, see [trading](trading.md).

## darkTheme vs lightTheme

Both are exported objects; `DEFAULT_THEME` is re-exported and **equals `lightTheme`**.

| Key | `darkTheme` | `lightTheme` |
|---|---|---|
| `background` | `#0d0e12` | `#ffffff` |
| `grid` | `#161a26` | `#eef1f6` |
| `axisText` | `#8b91a7` | `#5b6472` |
| `axisLine` | `#2a3046` | `#d4dae3` |
| `paneSeparator` | `#1e2334` | `#e6eaf0` |
| `crosshair` | `#6b7280` | `#9aa3b2` |
| `upColor` / `wickUpColor` | `#26a69a` | `#089981` |
| `downColor` / `wickDownColor` | `#ef5350` | `#e0473e` |
| `lineColor` | `#4f8cff` | `#2962ff` |
| `areaTopColor` | `rgba(79,140,255,0.40)` | `rgba(41,98,255,0.30)` |
| `areaBottomColor` | `rgba(79,140,255,0.00)` | `rgba(41,98,255,0.00)` |
| `baselineTopLine` / `baselineBottomLine` | `#26a69a` / `#ef5350` | `#089981` / `#e0473e` |
| `baselineTopFill` / `baselineBottomFill` | `rgba(38,166,154,0.20)` / `rgba(239,83,80,0.20)` | `rgba(8,153,129,0.18)` / `rgba(224,71,62,0.18)` |
| `lastPriceUp` / `lastPriceDown` | `#26a69a` / `#ef5350` | `#089981` / `#e0473e` |
| `lastPriceText` | `#0d0e12` | `#ffffff` |
| `buy` / `sell` / `profit` / `loss` | `#26a69a` / `#ef5350` (both pairs) | `#089981` / `#e0473e` (both pairs) |

Neither built-in sets the five optional keys, so the optional defaults above apply.

## Applying a theme

```ts
import { createChart, darkTheme, lightTheme } from 'openalgo-charts';

const chart = createChart(el, { theme: darkTheme });   // required: the default is light

chart.setTheme(lightTheme);                            // live swap, no recreate
chart.applyOptions({ theme: darkTheme, grid: { vertLines: false } });
```

A theme is a plain object — spread a built-in and override:

```ts
const custom = { ...darkTheme, background: '#0b0f17', upColor: '#00b386', grid: '#161b27' };
```

Renderers read the theme from the per-frame render context, so `setTheme` repaints everything and existing series pick up new defaults without being touched.

**`background: 'transparent'` skips the pane fill entirely** so the page shows through. `takeScreenshot()` fills with the same value, so screenshots then come out with a transparent backdrop.

## verticalGradient

```ts
import { verticalGradient } from 'openalgo-charts';

const fill = verticalGradient(ctx, plotHeightDevicePx, 'rgba(41,98,255,0.3)', 'rgba(41,98,255,0)');
```

Returns a top-to-bottom `CanvasGradient` for a custom renderer or primitive. Cached in a `WeakMap` keyed by the 2D context, then by rounded height plus both colour strings — a `CanvasGradient` belongs to the context that created it, so never share one across canvases.

## Series style overrides

`SeriesStyle` is one optional-field bag; each renderer reads only the keys it needs. Precedence is **series style > theme > renderer constant**, resolved at draw time.

| Style key | Theme fallback | Applies to |
|---|---|---|
| `upColor` / `downColor` | `upColor` / `downColor` | candle family, `bar`, `high-low`, `column` |
| `borderUpColor` / `borderDownColor` | `upColor` / `downColor` | candle family |
| `wickUpColor` / `wickDownColor` | `wickUpColor` / `wickDownColor` | candle family |
| `borderVisible` / `wickVisible` | — (both default `true`) | candle family |
| `color` | `lineColor` | `line`, `line-markers`, `step`, `area` |
| `closeColor` | `lineColor` | `hlc-area` |
| `areaTopColor` / `areaBottomColor` | `areaTopColor` / `areaBottomColor` | `area` |
| `topColor` / `bottomColor` | `baselineTopLine` / `baselineBottomLine` | `baseline` |
| `areaTopColor` / `areaBottomColor` | `baselineTopFill` / `baselineBottomFill` | `baseline` |
| `color` | **none** — hardcoded `#3a4666` | `histogram` |
| `lineWidth` | — (default `1.5`) | line family |
| `lineStyle` | — (default `'solid'`) | `line`, `line-markers`, `step` |
| `markers`, `markersOnly`, `markerRadius` | — (radius default `2`) | line family |
| `visible`, `title`, `priceLineVisible`, `lastValueVisible` | — (all default on/true) | every type |

```ts
const series = chart.addSeries('candlestick', {
  style: { upColor: '#16a34a', downColor: '#dc2626', borderVisible: false },
});
series.applyOptions({ downColor: '#b91c1c' });   // merge + repaint, no recreate
series.applyOptions({ visible: false });          // hides it and drops it from autoscale
```

**`histogram` is the one series colour the theme cannot reach.** Its `color` falls back to `#3a4666` regardless of palette, so a themed volume overlay must set `style.color` (or per-item `bar.color`) itself.

**`priceLineVisible: false` and `lastValueVisible: false` only take effect on the first `isPriceSeries` series mapped to the pane's right scale** — that is the only series the last-price line and tag follow.

## legendOffset

```ts
createChart(el, { legendOffset: { top: 34, left: 12 } });   // default { top: 6, left: 8 }
```

Media px where **indicator** legend rows start inside the pane currently rendering at the chart's top-left (within 12 px of the top). Every other pane keeps `{ top: 6, left: 8 }`, and host-added `PaneLegend` rows are never repositioned. Raise it when the app draws its own symbol or OHLC overlay in that corner, otherwise indicator rows render underneath it and their buttons become unclickable. The offset follows a maximized lower pane into the corner.

## priceFormat

Set on `addSeries`; it configures the series' **price scale**, so it affects that scale's axis labels and crosshair tag.

```ts
chart.addSeries('line',      { priceFormat: { type: 'price', minMove: 0.05 } });
chart.addSeries('line',      { priceFormat: { type: 'price', precision: 4 } });
chart.addSeries('histogram', { priceScaleId: '', priceFormat: { type: 'volume' } });
chart.addSeries('area',      { priceFormat: { type: 'custom', formatter: (v) => 'Rs ' + v.toFixed(2) } });
```

- `'price'` — sets `minMove` on the scale. `precision: n` is converted to `minMove = 10^-n`. With neither key the option does nothing.
- `'volume'` — installs `compactVolume` (exported): `1.20K` / `3.40M` / `5.60B`, and `Math.round` below 1000.
- `'custom'` — installs `formatter` directly. The variant accepts **only** `type` and `formatter`; to also change tick precision call `series.priceScale().setOptions({ minMove })`.

Chart-wide formatting is `ChartOptions.priceFormatter` / `chart.setPriceFormatter(fn | null)`, which overrides every pane's right-scale formatter — see [core-api](core-api.md).
