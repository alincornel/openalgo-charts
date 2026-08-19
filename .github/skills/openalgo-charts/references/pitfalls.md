# openalgo-charts pitfalls

*When to read this: before writing or reviewing any openalgo-charts code, and whenever a chart "renders nothing", "ignores my setting", "scrolls when it shouldn't", or "works in the demo but not in my app". Every entry below is a verified failure mode in the current source, not a hypothetical.*

## Time and data

**`Bar.time` is UTC seconds, never milliseconds.** The internal axis is integer UTC seconds (`src/model/bar.ts`); a ms value lands ~50,000 years past the data and every derived time (crosshair, drawing anchors, markers) is garbage. Feed adapters convert at the edge (`epochMsToUtcSeconds`, `istStringToUtcSeconds` in `src/feed/time.ts`).

```ts
series.setData([{ time: Date.now(), value: 1 }]);                  // wrong
series.setData([{ time: Math.floor(Date.now() / 1000), value: 1 }]); // right
```

**Two bars at the same time do not throw and do not both draw — the last one in your array silently wins.** `sortedUniqueByTime` (`src/model/data-layer.ts:23`) collapses repeats because the shared axis maps times through a `Set`; the sort is stable, so *input order* decides the survivor. This is why an unseeded candle builder used to paint a red candle under a live green one: call `builder.seed(bars[bars.length - 1])` before the first live tick.

**`setData` accepts unsorted input and sorts it, but a stored `Bar` reference can be mutated under you.** `DataLayer.update` with a matching time replaces the last bar in place (`'replace'`). Treat `dataLayer.seriesBars(id)` as read-only (it is the live array); `SeriesApi.getData()` returns a copy.

**A whitespace item `{ time }` is kept as a NaN OHLC bar, not dropped.** `toBar` gives it `close: NaN` so the line renderer breaks and autoscale skips it — but `getData().length` still counts it. Any length- or reduce-based logic over `getData()` must tolerate `NaN`.

**Default axis and crosshair labels are IST (UTC+5:30), not UTC and not the host locale.** `IST_OFFSET_SECONDS = 19800` is hardcoded in `src/feed/time.ts`. Pass `timeFormatter` to change it — the formatter receives **raw UTC seconds**, so do not offset again inside it, and it takes a second `tickMarkType` argument (`year|month|day|time|timeWithSeconds`) that a one-arg formatter silently discards along with year/month boundary labelling.

**`intervalToSeconds` returns 60 for any token it does not recognise — it never throws.** A typo'd interval (`'5min'`, `'1H'`) silently produces 1-minute bucketing. Validate interval strings yourself before handing them to the feed.

**Candle buckets align to `sessionAnchorSec`, which defaults to 0 (epoch), not to the session open.** For a 09:15 session, pass the anchor or your 5m bars start on the wrong minute (`src/feed/candle-builder.ts`). `lateTickPolicy` defaults to `'foldIntoBar'`; `'dropOlderThanPrevBar'` makes `onTick` return `null`, so null-check it.

See [data-and-time](./data-and-time.md), [feeds-and-live](./feeds-and-live.md).

## setData vs update vs prependData, and the viewport

**`chart.fitContent()` runs automatically exactly once, on the first non-empty `setData`.** After that latch (`_hasFitContent`), later `setData` calls deliberately preserve the current zoom. If a symbol switch should re-frame the chart, call `chart.fitContent()` explicitly.

**`update()` returns `'append' | 'replace' | 'insert'`, and only a *global* right-edge append auto-scrolls.** A bar newer than this series' last bar but older than the newest time on the shared axis is an `'insert'` — the chart deliberately does not treat it as a new right-edge bar, so do not infer "new bar" from `update()` being called. An out-of-order `update()` is also O(n): it falls through to a linear `findIndex` plus a full rebuild of the shared axis, so batch late corrections rather than streaming them.

**`prependData` shifts every logical index, so any logical index you cached is now wrong.** The viewport survives because `baseIndex` is re-read and `rightEdge − index` is invariant — a saved `{ from, to }` logical range is not automatically re-based. This is also why drawing anchors are `{ time, price }` and never pixels or indices.

**`setVisibleLogicalRange` is a silent no-op before layout and for a non-positive span.** It returns early when `width <= 0` or `to <= from`, and bar spacing is clamped to `[1, 80]`, so an extreme span lands at the nearest legal zoom rather than erroring. Restore viewports *after* data lands.

**`setHistoryLoader` fires once and then latches until you call `chart.historyLoadComplete()`.** Forget the completion call and lazy paging stops after the first page, with no error.

**`chart.restoreState()` never recreates series — it returns a `RestoreReport` for you to rebuild them.** Series *data* belongs to the app. It also never throws: a malformed or newer-versioned state returns `{ applied: false, reason }`, and an indicator whose tier is not imported is skipped, not thrown.

See [events-and-state](./events-and-state.md).

## Imports, tiers, and registries

**Never deep-import into `dist/` or `src/` — a deep path inlines a second copy of the registry and your registration disappears.** Each tier is its own bundle with the package entry marked external; a relative or deep import gives the tier a private registry `Map` that `createChart` never reads. This is documented as a correctness bug in `rollup.config.js` and in every tier index.

```ts
import { registerIndicator } from 'openalgo-charts/dist/index.mjs'; // wrong: second registry
import { registerIndicator } from 'openalgo-charts';                // right
```

For the same reason `dist/openalgo-charts.all.mjs` is a docs-site bundle, excluded from `files` and `exports` — importing it in an app defeats the tiering and can reintroduce the duplicate registry.

**A missing tier throws a specific, greppable message — read it instead of guessing.** `openalgo-charts: unknown indicator "<id>" — did you import 'openalgo-charts/indicators'?`; `openalgo-charts: series type "point-figure" needs the transform tier — import 'openalgo-charts/transform' first`; `openalgo-charts: unknown series type "<type>"`; `openalgo-charts: unknown drawing tool "<id>"`. Only `point-figure` and `kagi` get the friendly transform message — Heikin Ashi, Renko, Range and Line Break render as `candlestick` and need no new type.

**Tier imports are side effects; an over-aggressive bundler can drop them.** `package.json` `sideEffects` whitelists the tier paths. If a bare `import 'openalgo-charts/indicators'` gets shaken out, call the explicit registrar instead: `registerBuiltinIndicators()`, `registerTransformChartTypes()`, `registerBuiltinDrawingTools()` — all idempotent.

**Registering an id that already exists overwrites it silently — no warning, last write wins.** True for `registerChartType`, `registerIndicator` and `registerDrawingTool`. Namespace custom ids.

See [bundling-and-tiers](./bundling-and-tiers.md).

## Scales and panes

**Price-scale margins are fractions of the *pane height*, not padding on the data span.** The data band occupies `1 - marginTop - marginBottom` of the pane (`autoscaleRange`, `src/scale/price-scale.ts:41`). Margins summing to ≥ 1 do not throw; they clamp to a 1% sliver. The option names are `marginTop`/`marginBottom`, not `scaleMargins.top/bottom`.

**`series.priceScale().setOptions({...})` merges options but schedules no repaint.** `PriceScale.setOptions` is a plain merge; the change appears on the next invalidation from something else. Follow it with a repaint trigger such as `series.applyOptions({})` or `chart.applyOptions({})`.

**Any manual price-axis gesture disables autoscale for that scale permanently.** `panByPixels`, `scaleAroundCenter` and the axis drag all set `autoScale = false`, and `Pane.autoscale` then skips the scale entirely. Recover with `chart.resetScale()` (also bound to double-click) or `scale.setAutoScale(true)`. While autoscale *is* on, it reads only the **visible** bars (`dataLayer.visibleBars(from, to)`), so the range moves as you pan.

**`priceScaleId: ''` is a real hidden overlay scale with its own autoscale; `percentage` and `indexed-to-100` modes genuinely do not exist.** `PriceScaleMode` is `'linear' | 'logarithmic'` only, and log mode clamps non-positive prices to `1e-10` rather than producing NaN. Note that only the **right** scale expands for primitives — a price line or custom primitive on a left or overlay scale can be clipped out of view (`src/core/pane.ts:199`).

**Adding any series with `priceScaleId: 'left'` shrinks `chart.timeScale.width` for the whole chart.** A left-axis column is reserved chart-wide and released when the series is removed. Never cache pixel math across `addSeries`/`remove`.

**`addSeries(type, { paneIndex: 3 })` silently creates panes 1..3 — it does not throw.** A typo'd pane index produces blank panes that also get persisted by `getState()`. In the other direction, `removePane(0)` and a `movePane` that would displace pane 0 return `false` rather than throwing, `maximizePane` parks the other panes at weight `0.001` (not 0), and `setPaneWeight` clamps to a 0.05 floor.

**A `SeriesApi` captures its pane index at creation, and `removePane`/`movePane` re-index panes.** Indicators are re-pointed automatically; host-added series are not. Call `series.remove()` before restructuring panes, or re-add the series afterwards.

**With the default `minMove: 0`, price precision is inferred from the visible range, so label decimals change as you zoom, and `snapToTick` is a no-op.** Set `priceFormat: { type: 'price', minMove: 0.05 }` (or `precision`) per series for a stable instrument tick.

See [scales-and-panes](./scales-and-panes.md).

## Indicators

**A plot's colour setting key is the descriptor's declared `colorKey`, not `<plotKey>:color`.** Only `width`, `lineStyle`, `opacity` and `type` are generated as `<plotKey>:...`. Setting `'macd:color'` on MACD is silently ignored because its declared key is `macdColor`. Read the real keys from `plotStyleKeys(plot)` / `indicatorStyleInputs(descriptor)`.

```ts
macd.setSettings({ 'macd:color': '#f00' });   // wrong: silently ignored
macd.setSettings({ macdColor: '#f00', 'macd:width': 2 }); // right
```

**Indicators recompute only when the *primary* price series changes.** The primary series is the first `addSeries` of a price type; indicator plots never claim it. Updating a secondary series will not retrigger any indicator.

**`calc` must return arrays the same length as `bars`, using `null` for warmup slots.** Shorter arrays misalign the whole plot. `null`/`undefined` become `NaN`, which the renderer breaks across and autoscale skips. `calcTail` is optional; without it every live tick costs a full O(n) recompute per indicator, and returning `null` from it falls back to `calc` silently.

**`descriptor.range()` (e.g. RSI 0..100) applies only when the indicator created its own pane.** Two indicators sharing a pane would otherwise fight over the fixed range, so an indicator added onto an existing pane silently autoscales instead.

**There are 86 built-ins, and their ids are not derivable from the display names.** `williams-percent-r`, `bollinger-percent-b`, `smi-ergodic-oscillator`, `special-k`. Read `BUILTIN_INDICATORS` or the table in [indicators](./indicators.md) and probe with `hasIndicator(id)` rather than catching the throw from `getIndicator`. The second and later instances of the same indicator id get auto-rotated colours: only keys you left unset are filled, an explicit colour always wins, and the first instance keeps the descriptor's own choice.

**`registerIndicator` overwrites by id, and 86 ids are already taken.** Registering `momentum`, `median`, `volume` or `atr` for a custom study silently replaces the built-in for the whole page. Namespace custom ids.

**`IndicatorFillSpec.between` names `calc` output columns, not declared plots.** A fill whose `between` references a plot key that `calc` happens not to return draws nothing, with no error. The shaded overbought/oversold bands in the catalogue rely on this the other way round: they fill between two constant columns that no plot names.

**Signal markers are a separate primitive from the plots.** `descriptor.markers` attaches through `series.createMarkers()` on the *first* plot's series, lazily, and only once the hook returns a non-empty array. A plot-level style patch does not touch them, and there is no `addIndicatorMarkers` on the host: the layer is created by the plot's own series and removed by `removeIndicatorMarkers`.

See [indicators](./indicators.md).

## Transforms

**Transform output timestamps are synthetic: colliding times are bumped `+1s` so each element gets its own logical index.** You therefore cannot join a Renko/P&F/Kagi series to a raw-timestamped series (a volume pane) by time — re-bucket the companion series onto the transformed element times. Relatedly, `runTransform` calls `reset()` and is batch-only: for live ticks keep the instance and call `transform.push(bar)`.

**Point & Figure reads `column.boxSize` from the data, not `style.boxSize`, and defaults to `method: 'hl'`.** A `style.boxSize` that disagrees with the column is ignored (this footgun was removed deliberately). `method: 'close'` can legitimately produce zero columns on flat closes with wide intrabar range.

See [transforms](./transforms.md), [chart-types](./chart-types.md).

## Profiles and order flow

**Footprint and cumulative delta need trade-by-trade data already classified bid/ask — OHLCV cannot be reconstructed into it.** OpenAlgo does not store classified historical trades by default, so footprint is a live-session feature unless you add a tick recorder (`src/profile/footprint.ts`, `ARCHITECTURE.md` §6A). Volume Profile and Market Profile need only bars and work on history.

**`rowTicks` is a multiplier on `tickSize`, not a row height in price.** `computeFootprint(time, trades, 0.1, 20)` and `rowTicksFor(2, 0.1) === 20` both mean "2-point rows on a 0.1 tick". The two stay separate deliberately: imbalance and single-print logic still count in real ticks, so widening rows must not change the reported tick size.

See [profiles-and-orderflow](./profiles-and-orderflow.md).

## Drawing tools

**Anchors are `{ time, price }` in data space, and a non-finite anchor is rejected outright.** A NaN anchor would serialise to `null` and produce a drawing that can never be rendered or hit-tested. Note that `coordinateToPrice`/`priceToCoordinate` are safe before the first frame — the chart scales on demand.

**The library installs no keyboard listener for drawing tools.** `Alt+T/H/J/V/C` etc. exist as declared `shortcut` metadata only; the host must wire a listener and call `matchDrawingShortcut(event)`. Modifiers must match exactly and a bare letter never matches, so ordinary typing is unaffected.

**Tools declaring `points: 0` never self-terminate.** `path` and `polyline` collect vertices until `controller.finish()` (double-click, or your own key binding). Freehand tools (`brush`, `highlighter`) declare `freehand: true` and commit on pointer release instead — a freehand tap that never moved is dropped.

**Drag-to-draw only works because the controller arms `chart.setPlacementMode(true)`.** Without placement mode a press-drag-release pans the chart and emits zero clicks. If you drive placement yourself, arm and release the mode or the chart stays un-pannable — which is also why `DrawingController.destroy()` is mandatory: `chart.destroy()` does not tear down the controller, and a leaked one can strand placement mode on. (A whole drag is a single undo step, not one per frame.)

See [drawing-tools](./drawing-tools.md).

## Primitives and custom rendering

**`draw(ctx, rc)` receives a context in *bitmap* (device) pixels while `hitTest(x, y)` receives *media* (CSS) pixels.** `rc.timeScale.indexToX()` and `rc.priceScale.priceToY()` also return media px, so drawing code must multiply by `rc.dpr`. Forgetting it renders at half size on a retina display while hit-testing stays correct — the classic "clicks work but it looks wrong" bug.

```ts
ctx.fillRect(rc.timeScale.indexToX(i), y, 4, 4);                       // wrong on dpr > 1
ctx.fillRect(rc.timeScale.indexToX(i) * rc.dpr, y * rc.dpr, 4 * rc.dpr, 4 * rc.dpr); // right
```

**`autoscaleInfo()` is called once per primitive on every autoscale pass — that is every pan, zoom, tick and resize.** Keep it O(1) or precompute. Return `null` to opt out entirely (drawings do), and return `null` rather than `{min: 0, max: 0}` when you hold no data.

**Hit-testing is nearest-distance-first; `zOrder` only breaks exact ties.** A `'bottom'` primitive 1px from the cursor beats a `'top'` one 3px away. Two further overrides sit above all primitives: a pane divider within 4px, and pane-legend button ids the chart consumes before `subscribeClick`.

**`zOrder: 'top'` moves the primitive to a different canvas, not just later in the paint order.** Top-layer primitives repaint on every crosshair move and are frozen while the native context menu is open. `bottom`/`normal` share the base canvas with the series.

See [primitives-and-plugins](./primitives-and-plugins.md).

## Events and state

**`chart.emit` swallows exceptions thrown by listeners — silently, with no console output.** One bad listener must not break the render loop, so a bug inside your handler leaves no trace. Wrap handler bodies in your own try/catch while debugging.

**`subscribeClick`/`subscribeCrosshairMove`/`subscribeDrag` are single slots — a second call replaces the first — and they are hit-only.** Use `chart.on('click', ...)`, which also fires on empty plot with `id: null` plus `price`, `time` and `point`. Event names are plain strings, so a typo silently never fires; the crosshair-leave payload is all-null and must be handled.

**`chart.off('click')` with no callback removes *every* listener for that event, including the drawing tier's and the trade layer's.** Always pass the callback, or keep the unsubscribe function `on()` returns.

See [events-and-state](./events-and-state.md), [interactions](./interactions.md).

## Trading

**`chart.trading` is a visualization layer: it draws lines and markers and emits `trading:*` events. It places no orders.** Your app owns the broker call. The order *write* path is `OrderEngine` in the trade tier.

**`TradingTrade.timestamp` is in milliseconds — the only ms-based time in the public API.** Everything else is UTC seconds. A seconds value here snaps every fill marker to the first bar.

**`OrderEngine` defaults to `armed: false` with no gate, so `placeOrder` silently resolves `{ ok: false, reason: 'not confirmed' }`.** Nothing throws and nothing reaches the broker. Supply `gate` (a confirm dialog) or `armed: true`. Separately, `mode` defaults to `'live'` — pass `mode: 'analyzer'` for the sandbox; arming and mode are independent switches.

**`requestModify` drops an invalid price instead of sending it, and reports only through `onValidationError`.** It is fire-and-forget: no throw, no rejected promise. Wire `onValidationError` or a rejected drag looks like a frozen line.

**`OpenAlgoTradeFeed.modify(orderId, ...)` rejects for any order it has not seen this session.** It reconstructs the full OpenAlgo payload from a cached context: `openalgo-charts: cannot modify <id> — unknown order context (place it or load the order book first)`. Also note `product` defaults to `'MIS'` and the wire renames `side->action`, `type->pricetype`, `qty->quantity` — and verify these field names against your running OpenAlgo build, because the adapters are tested offline against injectable transports, not against a pinned schema (README and `ARCHITECTURE.md` §13a are still accurate on this).

See [trading](./trading.md), [trade-tier](./trade-tier.md).

## Lifecycle and hosting

**`createChart` mutates your container.** It sets `display:flex`, `flexDirection:column`, `background`, `touchAction:none`, `role="application"`, `aria-label`, `tabindex`, forces `position:relative` when the computed position is `static`, and appends a hidden live region. Give the chart its own element rather than a shared layout node.

**`destroy()` removes listeners, panes, indicators and the live region — but does not undo those container style and ARIA mutations.** Under React StrictMode's double mount, or any remount into the same node, create the chart in an effect keyed to a dedicated `<div>` you own.

**The keyboard listener is attached to `document`, not the container, so a chart you forget to destroy keeps intercepting keys page-wide.** Scope defaults to `'hover'` (keys act when the pointer is over the chart or focus is inside it); `ShortcutManager.shouldIgnore` skips `INPUT`/`TEXTAREA`/`SELECT`/`contenteditable`.

**There is no SSR path, and the degradations are silent.** No `window` means no input handlers at all; no `ResizeObserver` means the chart never auto-resizes and you must call `chart.applySize(w, h)`. A missing 2D context throws `openalgo-charts: 2D canvas context is not available`. Construct the chart only in a client-side effect, and give the container explicit dimensions — the initial size is read from `container.clientWidth/clientHeight`, so a height-`auto` flex child renders at height 0 until the observer fires.

**The library default theme is `lightTheme`, despite the `ChartOptions.theme` JSDoc saying "pass `darkTheme` (default)".** `DEFAULT_THEME = lightTheme` in `src/theme.ts`; the doc comment is stale. Always pass a theme explicitly in a dark UI. A `background` of exactly `'transparent'` skips the fill entirely, which is what layered hosts want.

**The browser's native right-click "Save image as…" captures the clicked pane only.** Use `chart.takeScreenshot()` / `chart.downloadScreenshot()` for the full multi-pane composite; `downloadScreenshot` swallows failures (tainted canvas, no DOM) silently.

See [react-integration](./react-integration.md), [core-api](./core-api.md), [themes-and-styling](./themes-and-styling.md).

## Verify before answering

Never assume the version, an API name, or which tiers are loaded. Run these first; each pair covers a consumer app and an upstream checkout of this repo.

```bash
# 1. Which version is actually present
grep -m1 '"version"' node_modules/openalgo-charts/package.json   # consumer app
grep -m1 '"version"' package.json                                 # upstream checkout
# The exported VERSION / version() constant is hand-maintained and has drifted before; trust package.json.

# 2. Does the symbol exist in THIS build? Typings are ground truth.
grep -n "setPlacementMode\|legendOffset\|matchDrawingShortcut" node_modules/openalgo-charts/dist/index.d.ts
grep -n "setPlacementMode\|legendOffset\|matchDrawingShortcut" dist/index.d.ts

# 3. Which tier owns it (each tier has its own .d.ts)
ls node_modules/openalgo-charts/dist/*.d.ts node_modules/openalgo-charts/dist/*/index.d.ts
ls dist/*.d.ts dist/*/index.d.ts

# 4. Which tiers the user's source actually imports, and any illegal deep imports
grep -rn "openalgo-charts" src/ app/ components/ 2>/dev/null | grep -i "import\|require" | sort -u
# Anything matching openalgo-charts/dist/ or openalgo-charts/src/ is the duplicate-registry bug.

# 5. Enumerate what is registered at runtime, rather than trusting a docs list
#    registeredChartTypes(), registeredIndicators(), BUILTIN_DRAWING_TOOLS
grep -n "BUILTIN_INDICATORS\|BUILTIN_DRAWING_TOOLS" node_modules/openalgo-charts/dist/*/index.d.ts
```

On Windows PowerShell substitute `Select-String -Pattern` for `grep` and `Get-ChildItem` for `ls`.

If a symbol is absent from the local `.d.ts`, it does not exist in the installed version — say so and check `CHANGELOG.md` for the release that added it rather than writing code against it.
