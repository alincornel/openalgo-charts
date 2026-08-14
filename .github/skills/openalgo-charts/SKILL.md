---
name: openalgo-charts
description: >-
  Use when working with openalgo-charts - creating canvas charts, adding series
  (candlestick/bar/line/area/baseline/histogram and 13 more), configuring price
  and time scales, panes, indicators, drawing tools, primitives and custom
  renderers, volume/market profile and footprint, on-chart trading and order
  lines, DOM ladder, OpenAlgo REST history and WebSocket live ticks, chart state
  persistence, themes, keyboard shortcuts, or React/Next.js integration. Covers
  the six-tier bundle model and the time, scale, registry, indicator, drawing,
  trading, and bundling foot-guns.
---

# OpenAlgo Charts skill

`openalgo-charts` is a from-scratch, dependency-free HTML5-canvas charting engine: one canvas pipeline, no SVG, no DOM per bar, six lazy-loaded bundle tiers, zero runtime dependencies.

Works the same whether the project is a downstream npm consumer app or an upstream `openalgo-charts` source checkout. Detect which one you are in and resolve every API name from whatever typings are locally available.

## Source lookup order

Do not assume you are inside the upstream source repository.

1. In a consumer app, inspect the installed package first:
   - `node_modules/openalgo-charts/package.json` for the actual version.
   - `node_modules/openalgo-charts/dist/index.d.ts` for the base API surface, and `dist/{trade,draw,indicators,transform,profile}/index.d.ts` for each tier.
2. In the upstream repo, inspect `dist/index.d.ts` first, then `src/` if generated output is unavailable.
3. `ARCHITECTURE.md` and `website/pages/docs/*.mdx` are supporting evidence, but local typings win when they disagree.

Verify before answering (copy-paste):

```sh
node -p "require('./node_modules/openalgo-charts/package.json').version"
rg -n "createChart|addSeries|addIndicator|DrawingController|OrderEngine" node_modules/openalgo-charts/dist/index.d.ts
# upstream checkout instead of a consumer app:
rg -n "createChart|addSeries|addIndicator" dist/index.d.ts src/index.ts
# which tiers does this project actually load?
rg -n "from 'openalgo-charts" src app
```

If the relevant file is unavailable, say what could not be verified. Do not invent option names, methods, exports, event names, or indicator ids.

## Mental model

Eight layers, in dependency order. Most bugs come from confusing one for another.

1. **Chart** - `createChart(container, options)` returns a `Chart`. One chart per container element. It owns everything below.
2. **DataLayer** - one per chart. Merges every series by time onto a single shared **logical index** space `0..N-1`. This is the load-bearing idea; see rule 2 below.
3. **Scales** - `chart.timeScale` maps logical index to x; each pane's `PriceScale` maps price to y. Panes autoscale independently.
4. **Panes** - vertically stacked drawing regions, each with two canvases (base + overlay) and up to three price scales (`'right'`, `'left'`, `''` overlay).
5. **Series** - `chart.addSeries(type, options)` returns a `SeriesApi`. The type names an entry in the chart-type **registry**; the core never switches on type.
6. **Registries** - chart types, indicators, and drawing tools are all descriptors in a Map. Adding one is a registration, never a core change.
7. **Primitives** - the extension point. Anything that draws but is not a series: price lines, markers, legends, profiles, trading pills, drawings.
8. **Tiers** - `indicators`, `draw`, `transform`, `profile`, `trade` are separate bundles that register into the base engine's registries on import.

## Install and tiers

```bash
npm install openalgo-charts
```

Import only what you use. Each tier is a separate entry point that registers into the base engine, so a feature you do not load costs zero bytes.

| Import | Contents | Brotli limit |
|---|---|---|
| `openalgo-charts` | Engine, 13 chart types, panes and scales, primitives, registries, chart state, trading visualization, OpenAlgo feeds, EMA/RSI/ATR/Supertrend calculators | 37 KB |
| `openalgo-charts/indicators` | 19 built-in indicators + the Tier-2 external-data contract | 9 KB |
| `openalgo-charts/draw` | 43 drawing tools + a headless `DrawingController` | 14 KB |
| `openalgo-charts/transform` | Heikin Ashi, Renko, Range bars, Line Break, Point and Figure, Kagi | 5 KB |
| `openalgo-charts/profile` | Volume Profile, Market Profile (TPO), Footprint, order flow | 11 KB |
| `openalgo-charts/trade` | Order engine, state machine, order/position/bracket lines, DOM ladder | +7 KB over base |

Limits are the CI-enforced budgets in `.size-limit.json`. Nothing is excluded from them because there are no runtime dependencies to exclude.

## The 60-second chart

```ts
import { createChart } from 'openalgo-charts';

const chart = createChart(document.getElementById('chart')!);
const series = chart.addSeries('candlestick');

series.setData([
  { time: 1705286700, open: 100, high: 101, low: 99.5, close: 100.6, volume: 1200 },
  { time: 1705286760, open: 100.6, high: 101.4, low: 100.2, close: 101.1, volume: 900 },
]);

chart.fitContent();
```

`time` is **UTC seconds**. The container must have a non-zero size before the chart can lay out.

## Non-negotiable rules

1. **Time is UTC seconds everywhere, never milliseconds.** `Math.floor(Date.now() / 1000)`, not `Date.now()`. Feed adapters convert broker formats at the edge.
2. **The time axis is gapless and index-based, not timestamp-proportional.** x is `logicalIndex * barSpacing`, so weekends, holidays and session breaks have no index and collapse to nothing. Never compute an x from a timestamp difference; use `chart.timeToCoordinate(t)` or `chart.timeScale`.
3. **One bar per time per series, ascending.** Duplicate times collapse to the last one written.
4. **Never deep-import.** `import { X } from 'openalgo-charts'` or a published tier specifier only. A deep path into `dist/` internals inlines a second copy of the registry Map, and `createChart` will never see what your tier registered. See `rollup.config.js`.
5. **A tier must be imported before its features resolve.** `chart.addIndicator('macd')` needs `import 'openalgo-charts/indicators'`; `addSeries('kagi')` needs `import 'openalgo-charts/transform'` and throws a specific tier-naming error without it.
6. **Price-scale margins are fractions of the pane height, not padding on the data span.** The data band occupies `1 - marginTop - marginBottom` of the pane.
7. **Drawing anchors are `{ time, price }`, never pixels.** Pixel anchors slide the moment a gap collapses or the user zooms.
8. **Canvas drawing happens in bitmap pixels.** Multiply media px by `dpr` in any custom primitive, or it blurs and misaligns on HiDPI.
9. **`chart.trading` renders trade state; it does not place orders.** The host pushes exchange state in and turns the emitted `trading:*` events into broker calls. The transactional path is `openalgo-charts/trade`.
10. **The library ships no DOM chrome.** No toolbar, no dialogs, no settings forms, no command palette. Drawing tools, indicator settings and order menus are the host's UI, driven by descriptors and events. Do not look for a built-in one.
11. **Never use emojis or icons in code, comments, logs, or generated UI text.** Project rule.

## References

Detailed reference for each topic is in `references/`. Read the one that matches the task before writing code.

| Reference | Topic |
|---|---|
| [core-api](references/core-api.md) | `createChart`, `ChartOptions`, `SeriesApi`, lifecycle, coordinate conversion, the render/invalidation model |
| [chart-types](references/chart-types.md) | All 13 base series types, their styles and autoscale rules, runtime type switching |
| [scales-and-panes](references/scales-and-panes.md) | Price/time scale options, log and inverted modes, left/right/overlay scales, pane weights and layout |
| [themes-and-styling](references/themes-and-styling.md) | `ChartTheme` keys, dark/light, gradients, `SeriesStyle` precedence, price formatting |
| [data-and-time](references/data-and-time.md) | `Bar` shape, UTC seconds, setData/update/prependData, the logical-index model, history paging, tick and volume bars |
| [feeds-and-live](references/feeds-and-live.md) | `DataFeed` contract, OpenAlgo REST/WS/live feeds, `CandleBuilder`, writing a custom feed |
| [events-and-state](references/events-and-state.md) | The full event catalogue with payloads, `getState`/`restoreState`, saved layouts |
| [indicators](references/indicators.md) | The 19 built-ins with ids and defaults, the settings model, `registerIndicator`, the Tier-2 external-data contract |
| [transforms](references/transforms.md) | Heikin Ashi, Renko, Range, Line Break, Point and Figure, Kagi |
| [drawing-tools](references/drawing-tools.md) | The 43 tools, `DrawingController`, anchors, magnet, undo, persistence, shortcuts, custom tools |
| [primitives-and-plugins](references/primitives-and-plugins.md) | `IPrimitive`, z-order, hit-testing, the dpr contract, built-in primitives, `registerChartType` |
| [trading](references/trading.md) | The data-driven on-chart trading layer, `trading:*` events, order/position/bracket lines |
| [trade-tier](references/trade-tier.md) | `OrderEngine`, order state machine, validation, analyzer mode, DOM ladder, broker adapters |
| [profiles-and-orderflow](references/profiles-and-orderflow.md) | Volume Profile, Market Profile (TPO), Footprint, cumulative delta, the trade-data dependency |
| [react-integration](references/react-integration.md) | React and Next.js lifecycle, keeping orchestration out of React, SSR, resize |
| [bundling-and-tiers](references/bundling-and-tiers.md) | Entry points, registry identity, tree-shaking, script/ESM/import-map loading, size budget |
| [interactions](references/interactions.md) | Pan/zoom/pinch, crosshair modes, the keyboard system, touch, accessibility |
| [pitfalls](references/pitfalls.md) | The verified foot-gun list. Read this when something behaves unexpectedly |

## Triage

| User asks about | First check | Answer with | Avoid |
|---|---|---|---|
| First chart / blank chart | container size, `dist` present | `createChart` + `addSeries` + `setData` | assuming a CSS import or web component |
| Bars in the wrong place | units of `time` | UTC seconds | `Date.now()` milliseconds |
| Gaps for weekends | the gapless-axis rule | it is intended; whitespace points if you want a gap | shifting timestamps |
| Realtime ticks | last-bar vs full replace | `series.update(bar)` | `setData` on every tick |
| Loading older history | `setHistoryLoader` | `prependData` + `historyLoadComplete` | rebuilding and re-fitting |
| Indicator not found | is the tier imported | `import 'openalgo-charts/indicators'` | registering it by hand |
| Indicator settings UI | descriptor `inputs` + generated style keys | build the form from the descriptor, apply with `setSettings` | expecting a built-in dialog |
| Drawing tools | `DrawingController` | headless controller + host toolbar | expecting a built-in toolbar |
| Volume in its own pane | `paneIndex` and `priceScaleId` | `addSeries('histogram', { paneIndex: 1 })` | a second chart |
| Volume inside the price pane | overlay scale | `priceScaleId: ''` plus scale margins | manual y math |
| Placing real orders | which layer | `openalgo-charts/trade` `OrderEngine` | `chart.trading` (visualization only) |
| Order lines on the chart | which layer | `chart.trading` sync + `trading:*` events | drawing your own price lines |
| Custom overlay | primitive vs chart type | `IPrimitive` + `addPrimitive` | a custom chart type for decoration |
| Saved layouts | `getState` / `restoreState` | one JSON payload | hand-rolled serialisation |
| React lifecycle | where the chart instance lives | create in an effect, hold in a ref, `chart.destroy()` on cleanup | chart instance in state |
| Bundle size | which tiers are imported | drop the unused tier import | code-splitting the base |

## Core API cheat sheet

Verified names. Get these wrong and nothing works.

```ts
// chart
const chart = createChart(el, options);
chart.addSeries(type, { paneIndex, style, priceScaleId, priceFormat });
chart.addIndicator(id, settings, { paneIndex });   // needs the indicators tier
chart.addPriceLine(opts, paneIndex);
chart.addPrimitive(primitive, paneIndex);
chart.fitContent();
chart.applyOptions({ theme, grid, priceFormatter, timeFormatter, crosshairMode });
chart.setTheme(theme);
chart.panes();                          // readonly Pane[]
chart.getState() / chart.restoreState(state);
chart.on(event, cb);                    // returns an unsubscribe function
chart.subscribeCrosshairMove(cb);
chart.timeToCoordinate(t) / chart.coordinateToTime(x);
chart.priceToCoordinate(p, paneIndex) / chart.coordinateToPrice(y, paneIndex);
chart.destroy();

// getters, not methods
chart.timeScale;   // TimeScale
chart.dataLayer;   // DataLayer
chart.trading;     // TradingController, created on first access
chart.shortcuts;   // ShortcutManager | null

// series handle
series.setData(items);
series.update(item);
series.prependData(items);
series.getData();
series.applyOptions({ visible: false });   // not setStyle
series.priceScale();
series.createMarkers();
series.remove();
```

`chart.fitContent()` takes no arguments; `chart.timeScale.fitContent(barCount)` does.

## Code-generation rules

- **Verify option names against local typings before writing them.** Many similarly named options exist at chart, series, pane and scale level. Confirm which level owns the option.
- **Minimal snippets.** One feature per code block. Combining an indicator, a drawing tool and a trading line in one snippet hides which API does what.
- **Import from the package entry or a published tier specifier.** Never a deep path.
- **Match the user's host.** A React user wants the effect lifecycle; a vanilla user does not; a no-bundler user needs the standalone build.
- **State which tier a feature needs** whenever the answer uses one.
- **Do not invent.** If a name does not appear in the installed typings or upstream source, it does not exist.

## Answer contract

When answering an openalgo-charts question:

1. Name the API and the tier it lives in.
2. Show one minimal snippet, not a mega-demo.
3. Call out the main foot-gun for that task, from [pitfalls](references/pitfalls.md).
4. Say what local source was checked (version, typings), or state that it could not be verified.
