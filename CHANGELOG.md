# Changelog

All notable changes to OpenAlgo Charts.

## Unreleased

### Added

- **16 more drawing tools**, taking the built-in set from 18 to 34 (draw tier
  6.6 KB -> 8.3 KB Brotli).

  Shapes: `circle`, `triangle`. Paths: `polyline`, `arc`, `curve`. Channels:
  `fib-channel`. Fibonacci: `fib-time-zone`, `fib-fan`. Gann: `gann-fan`,
  `gann-box`. Forecasting: `forecast`. Measurers: `price-range`, `date-range`.
  Arrows: `arrow-up`, `arrow-down`. Brushes: `highlighter`.

  `circle` measures its radius in pixels, so it stays round on screen rather
  than becoming the ellipse differing axis scales would otherwise produce. `arc`
  passes *through* its middle anchor while `curve` treats that anchor as a
  control handle. The measurers all take their bar count from logical indices,
  so it matches the gapless axis rather than raw elapsed time.

- **Rail flyout menus in the yfinance demo.** Rail groups now open a sectioned
  list of their tools — the pattern TradingView uses — instead of cycling tools
  on repeat clicks, which was undiscoverable past two. The button re-activates
  the last tool picked; the caret opens the list. Icons were redrawn on a 24x24
  grid with a thinner stroke and outlined endpoint handles.

- **Right-click drawing actions in the yfinance demo** — "Delete Drawing" for
  the selected one and "Remove All Drawings (n)" for the lot. Both rows hide
  when there is nothing to act on, so the menu never offers a dead option.

- `pane.primitives()`, matching the existing `pane.series()`.

### Fixed

- **A restored layout could leave a large blank region under the chart.**
  A saved pane exists only to hold an indicator, and `restoreState` skips an
  indicator whose tier was never imported — but the pane survived anyway, still
  claiming its weight and still drawing a default 0..100 price axis. On a chart
  whose only restored indicator was an overlay, that empty pane took roughly
  two thirds of the height. `restoreState` now drops panes that end up with no
  series, the same way removing the last indicator from a pane already does.

- **The yfinance demo rendered a white chart inside dark chrome.** It never
  passed a theme, and the library default is the light palette (since
  `275ee1e`). It now asks for `darkTheme` explicitly.

- The drawing-tools doc had a blank line splitting its style table, which broke
  the last three rows out of the table in the rendered page.

## 1.0.10

Market Profile brought up to a full TPO implementation, row height became a
setting rather than a side effect of tick size, and the chart gained
TradingView-style hover-revealed zoom controls. 518 unit tests.

### Added

- **Time navigator** — the zoom / step controls that live just above the time
  axis. Invisible until the pointer nears the bottom of the chart, then faded in
  over `fadeSeconds`: `-` `+` to zoom, `‹` `›` to step exactly one bar.

  The buttons run the *same* commands the keyboard does (`_runShortcut`), so the
  two paths cannot drift apart, and each tooltip reads its combo from the live
  keymap — rebind `zoomIn` and the tooltip follows. On by default; pass
  `timeNavigator: false` to drop it, or an options object to restyle. It rides
  the bottom pane and follows when panes are added or removed, and hit-tests to
  nothing while hidden so it never steals a click from the chart underneath.

  Reveal is driven by pointer position rather than `rc.hoverId` on purpose: hover
  ids come from `bestHit`, so a drawing or an order line near the bottom of the
  chart would win the hit and silently hide the controls.

  New commands `panLeftBar` / `panRightBar` (one bar, unbound by default) and a
  public `pane.primitives()` accessor, matching the existing `pane.series()`.

- **Controllable TPO / footprint row height.** Row height is now
  `tickSize * rowTicks` instead of being pinned to the instrument tick. The
  multiplier is the one a trader already thinks in: Nifty trades in 0.1 and you
  want 2-point rows, so `rowTicks` is `2 / 0.1 = 20`. `rowTicksFor(2, 0.1)` does
  the division. Keeping the two separate matters — the tick is what imbalance and
  single-print logic count on, so widening rows must not mean lying about it.

  The same multiplier reaches order flow: `computeFootprint(t, trades, 0.1, 20)`
  and `new FootprintAggregator(tf, 0.1, 20)`, so a chart's bricks and its profile
  rows can share one grid.

- **Letters degrade to bricks automatically.** A TPO row is only as tall as the
  price scale makes it, so at some zoom a letter stops fitting. `blockDisplay:
  'auto'` (the new default) crossfades: the block is always drawn and the letter
  fades in over `letterFade` px above `minLetterHeight`, so zooming through the
  threshold reads as one continuous change instead of a jump. `'letters'`,
  `'blocks'` and `'blocks+letters'` pin the choice. The footprint fades its cell
  numbers the same way via `textFade`, replacing a hard on/off cutoff.

- **Market Profile analytics.** Per-period detail (`periodDetail`), the
  developing POC / value-area track, day type (normal / normal-variation / trend
  / double-distribution / neutral), open type (drive / test-drive /
  rejection-reverse / auction), range extension beyond the initial balance,
  buying and selling tails (`tailEdges`), volume POC, and `nakedLevels()` for
  prior POC / VAH / VAL no later session traded back through.

- **Session windows.** `window` drops bars outside a trading session and anchors
  period `A` to the window's open rather than to whatever bar arrived first —
  which otherwise shifted every letter. Windows crossing midnight are treated as
  one session instead of two halves. Built-ins in `TRADING_HOURS`: `all-hours`,
  `india`, `asia`, `london`, `new-york`, `us-regular`. `compositeSessions` merges
  N consecutive sessions into a rolling composite.

- **Renderer options** to match: `colorMode` gains `period` (one hue per TPO
  period, now the default) alongside `valueArea` / `count` / `volume` / `uniform`;
  plus `split` period columns, `showTpoCounts`, `showTails`, `showPoorHighLow`,
  `showNakedLevels`, `showDevelopingPoc` / `showDevelopingVa`, `showDayType` /
  `showOpenType` / `showSessionLabel`, `outsideVaOpacity`, `profileSpacing`,
  `volumeProfileSide` and `showVolumeValues`. `hitTest` / `hoverAt` map a pointer
  back to the session and row for a host-drawn tooltip.

### Fixed

- **The docs Market Profile example rendered a histogram, not a market profile.**
  The "Market Profile (TPO)" section used `computeTpo` + `HorizontalProfile` — a
  volume-profile-shaped bar chart with no letters at all — even though the
  `MarketProfile` letter renderer already existed. It now uses
  `computeMarketProfile` + `MarketProfile`, and `examples/market-profile` was
  rebuilt around the real primitive with a live row-size slider.

### Changed

- `MarketProfile`'s `showLetters` boolean is replaced by `blockDisplay`
  (`showLetters: false` becomes `blockDisplay: 'blocks'`).
- The profile tier's size budget moves from 8 KB to 11 KB (now 10.12 KB
  brotlied) to cover the analytics above. The base engine moves from 34 KB to
  35 KB for the time navigator (418 B).

## 1.0.9

Order-flow overhaul, drag-to-draw, shape text, and a price-axis density fix.
492 unit tests.

### Added

- **Footprint rewritten** (`src/profile/footprint-primitive.ts`). Cells now fill
  proportionally to volume instead of being outlined, so a column reads as a heat
  ladder; imbalanced cells fill *saturated* rather than gaining a border, and runs
  of consecutive same-side imbalances get a bracket down the edge.

  New options: `displayMode` (`bidask` | `delta` | `volume`), `statsRows` — a
  per-bar table of `volume` / `delta` / `deltaPct` / `cvd` / `trades`, each cell
  tinted by its own strength — plus `stackedImbalances`, `showPoc`, `showCandle`,
  `widthFactor`, `radius`, and `minTextHeight`. Column width derives from the
  chart's bar spacing unless `cellWidth` pins it, and rows shorter than
  `minTextHeight` drop their numbers and degrade to a pure heatmap, so zooming
  out never turns into unreadable overlap.

  `setOptions()` merges and repaints for live restyling; `hitTest()` and
  `hoverAt()` map a pointer back to the bar and price row so a host can build a
  tooltip without the library owning any DOM. `autoscaleInfo()` now returns a
  range, so the footprint drives the pane's scale.

- **Shape text.** `DrawingStyle` gains `fontColor`, `textVAlign`, and
  `textPosition`; rectangles, ellipses, and parallel channels now render a
  `style.text` label — one shape with two colours (`color` strokes the outline,
  `fontColor` paints the label). `textPosition: 'inside'` with
  `textVAlign` x `textAlign` gives the nine placements a TradingView shape-text
  panel exposes; `'outside'` parks the block above the shape.

- **Live order-flow demo** (`examples/orderflow/index.html`). Synthetic classified
  ticks stream into a `FootprintAggregator` and the forming bar updates in place —
  the same path a live WebSocket trade feed takes. Speed, timeframe, display mode,
  imbalance ratio, stacked toggle, and stats toggle are all wired to `setOptions`,
  with a hover inspector fed by `hoverAt`.

### Fixed

- **Drawing a rectangle by dragging placed nothing and scrolled the chart.**
  Press-drag-release is how every charting UI lays down a two-point shape, but the
  chart only emitted a `click` when the pointer had *not* moved, so the gesture
  produced no anchors — while the pan path consumed it and scrolled the view out
  from under the user. Click-click still worked, which is why it went unnoticed.

  New `chart.setPlacementMode(active)`: while a host is placing something, a press
  no longer pans, and a press-drag-release is reported as two `click` events — the
  press point, then the release point tagged `viaDrag`. `DrawingController` arms
  and releases this with the active tool, so every two-point tool (rectangle,
  ellipse, trend line, channel, fib, position) gains drag-to-draw with no API
  change. Single-anchor tools ignore the release half, so dragging with `text`
  armed no longer drops a second box where you let go.

- **The price axis produced about half the tick labels it was asked for.**
  `niceTicks` rounded the span up to a nice number and *then* divided to get the
  step — rounding twice. A 10.5-point range became 20, giving a step of 5 and
  three labels where six were requested; on a footprint autoscaled to ~15 points
  around 65000 the axis was nearly bare.

  The step now comes from the raw span. Because `niceNum(x, true)` snaps to the
  *nearest* nice value it can undershoot and overshoot `maxTicks`, so the result
  is clamped up the 1 → 2 → 2.5 → 5 → 10 ladder until it fits. The 2.5 rung —
  already promised by `niceNum`'s own docstring but missing from its
  implementation — is what keeps a 15-point range from collapsing from 8 labels
  straight to 3.

### Changed

- `Footprint.hoverAt(x, y, rc?)` — `rc` is now optional and defaults to the
  context of the last paint, so a crosshair handler can call `hoverAt(p.x, p.y)`
  instead of fabricating a `PrimitiveRenderContext` out of chart internals.

- Docs demos follow the site theme. `RunnableExample` wraps `createChart` to pass
  the resolved light/dark palette, since the library default is the light one and
  every example was rendering a white panel into a dark page.

## 1.0.8

Two new lazy tiers — **indicators** and **drawing tools** — plus the registries,
state, and pane chrome they need. Base engine ~32.7 KB Brotli, full package
~58 KB across all six tiers, 468 unit tests.

### Fixed

- **Lazy tiers could not register into the base bundle's registries.** Each tier
  is its own rollup bundle with nothing marked external, so a deep import like
  `../model/chart-type-registry` was *inlined* — giving the tier a second,
  private copy of the registry `Map`. The documented usage
  (`import 'openalgo-charts/transform'` then `chart.addSeries('point-figure')`)
  therefore threw `series type "point-figure" needs the transform tier` even
  though the tier was loaded. Only `src/all.ts` — built for the docs site —
  happened to work, because it puts everything in one module instance.

  Tiers now import shared runtime state from the package entry
  (`import { registerChartType } from 'openalgo-charts'`), which is external for
  tier builds, so every bundle references one registry instead of inlining its
  own. Duplicated *pure* helpers across tiers were only ever a size cost, and
  removing the inlined registry shrank the transform tier from 4.6 KB to
  2.7 KB Brotli.

- **A `setPointerCapture` throw aborted the rest of `pointerdown`.** Chrome
  throws `NotFoundError` when the pointer id is not currently active, and the
  call was only optional-chained — which guards against the method being
  *absent*, not against it throwing. Anything armed after it silently never
  happened: the pane-divider grab, the price/time axis-drag arm, and the
  order-line drag arm. Both capture calls are now wrapped; capture is an
  optimisation, never fatal.
- **Pane hit-testing could be offset from what was drawn.** `_relayout` gave each
  pane a flex *ratio* (`flex: w 1 0`) while sizing its canvas from the chart's
  own `this._height`, so the browser distributed the container's real height and
  the model used a possibly-stale one. Any drift between the two shifted every
  hit-test away from the pixels: pane boundaries, legend buttons, and crosshair
  mapping all landed elsewhere. Panes now get the same pixel height the canvas
  is sized to, making layout == hit-test by construction.
- **Point & Figure no longer emits a phantom first column.** When the first move
  after the anchor bar was *down*, the direction was still `0`, so the reversal
  branch fired while the column's top and bottom boxes were equal — emitting a
  zero-height column that the renderer drew as a blank slot at the start of
  every down-opening chart. Direction is now established without emitting a
  column, and `flush()` returns nothing until a real column exists.
- **P&F columns are built from the bar range, not just the close.** The new
  `method` option defaults to `'hl'` (the standard construction): a bar's high
  extends an X column and its low extends an O column. A bar that swung through
  several boxes intrabar but closed flat used to produce no boxes at all. Pass
  `method: 'close'` for the previous close-only behaviour.
- **The P&F renderer walks integer box indices** instead of accumulating
  `level += boxSize`. Thirty steps of `0.05` land on `101.49999999999991`, which
  duplicated the top glyph of tall columns. Glyph rows outside the plot are now
  culled, and a per-column glyph cap keeps a pathological box size from hanging
  a frame.

### Added

- **`openalgo-charts/draw` — a new lazy tier (6.3 KB Brotli)** with 18 drawing
  tools and a headless `DrawingController`: trend line, ray, extended line,
  arrow, horizontal line/ray, vertical line, cross line, rectangle, ellipse,
  parallel channel, fib retracement/extension, long/short position, measure,
  text, and path. The controller runs placement (with a live preview), selection,
  whole-shape and per-anchor dragging, magnet snap to O/H/L/C, undo/redo, and
  serialisation — and ships **no UI**, so a host wires its own toolbar.
  `registerDrawingTool` makes a custom tool first-class, exactly like a chart
  type or an indicator.
- **Drawing anchors live in data space** (`{ time, price }`), never pixels. The
  time axis is gapless, so a pixel anchor would slide the moment a weekend
  collapsed; anchors map through `DataLayer.timeToIndexFloat`, which also
  resolves positions *between* bars and *past the last bar*, where projections
  live. Drawings round-trip through `ChartState.drawings` with no extra plumbing.
- **Full text styling** on the `text` tool: `fontFamily`, `fontWeight`,
  `fontStyle`, `background` + `backgroundColor` + `backgroundOpacity`,
  `border` + `borderColor`, `wrap` + `wrapWidth`, and `textAlign`. Text renders
  multiline, soft-wraps against live font metrics, and hit-tests its **measured**
  box rather than a character-count estimate.
- `PrimitiveHit.draggable` — arm a two-axis drag (drawing anchors and shapes),
  alongside the existing one-axis `cursor: 'ns-resize'` price-line path.
- **`drag` / `drag:end` events**, carrying `fromTime` / `fromPrice` (the grab
  origin) so a consumer's delta measures from the press rather than the first
  move. The `click` event now also fires on empty plot, with position and a null
  `id` — what a tool that *places* something needs.
- **Pane legends with inline controls.** `PaneLegend` draws the TradingView-style
  row at a pane's top-left — swatch, name, parameters, and **one reading per
  plot in that plot's own colour** (a single number in a single colour cannot
  say which value belongs to which line of an MA ribbon or MACD), tracking the
  crosshair and falling back to the latest bar on leave — plus inline action
  buttons: show/hide, settings, move pane up/down, maximize, and delete.
  Controls stay hidden until the row is hovered, so a stack of legends reads as
  clean text; the row itself hit-tests (`::row`) to trigger that reveal, and the
  chart swallows those clicks so they never surface as phantom ids.
  Rows stack automatically per pane — a host can add its own (a symbol/OHLC
  header, a volume readout) with `chart.addPrimitive(new PaneLegend(...), pane)`
  and indicator rows flow beneath it; removing one closes the gap. Drawn on the canvas (like `BuySellButtons` and `DomLadder`) so it
  composites into screenshots and costs no DOM per pane, with icons as vector
  strokes rather than text glyphs, which render as emoji on some platforms.
  Every indicator gets one automatically; the first legend on a non-price pane
  also carries the pane-level controls, so extra rows stay uncluttered. The
  chart handles these presses itself, so a host gets them without wiring
  anything. `settings` has no built-in dialog — the engine ships no DOM — so it
  emits `indicatorSettings`; everything needed to *generate* a form is already
  on the descriptor's `inputs`.
- **Pane management:** `setPaneWeight`, `paneWeight`, `movePane`, `maximizePane`,
  `maximizedPane`, and `removePane`, plus **draggable pane dividers** — press
  within 4px of a boundary and drag to redistribute height between the two
  adjacent panes (cursor turns `row-resize`), conserving their combined weight
  so other panes are untouched and neither side can collapse. Removing a pane
  takes its series and indicators with it and re-indexes the panes below;
  pane 0 is pinned. Deleting the last indicator on a pane removes the pane too.
  New events: `paneResized`, `paneMoved`, `paneMaximized`, `paneRemoved`,
  `indicatorRemoved`, `indicatorSettings`.
- **An indicator registry, the sibling of the chart-type registry.** The
  chart-type registry answers *"how do I paint an array of bars"*; this one
  answers *"what do I compute, what does it plot, and what can a user tune"*.
  An `IndicatorDescriptor` is data, not code in the core — the chart never
  switches on an indicator id — and each `plot` names a registered **chart
  type**, so indicators ride the existing Family-A renderers and add no drawing
  code at all. `registerIndicator` / `getIndicator` / `registeredIndicators` /
  `indicatorDefaults` ship in the base bundle (~1.5 KB); the catalog does not.
- **`chart.addIndicator(id, settings?, { paneIndex? })`**, plus
  `chart.indicators()` and `chart.removeIndicator(instanceId)`. The returned
  `IndicatorApi` handle carries `settings()`, `setSettings(patch)`,
  `series(plotKey)`, `values()`, and `remove()`. The runtime creates one series
  per plot, places `'onchart'` indicators on the price pane and `'pane'`
  indicators on a new one, draws declared reference levels, applies a declared
  fixed range (RSI 0..100), recomputes on every source-data change, and tears
  everything down on `remove()` / `destroy()`. Indicator plots never claim the
  primary price series, so they can be added before any candles exist without
  hijacking the magnet crosshair and OHLC legend.
- **`openalgo-charts/indicators` — a new lazy tier (4.5 KB Brotli)** with 18
  Tier-1 built-ins: SMA, EMA, WMA, VWAP, Bollinger Bands, Supertrend, Parabolic
  SAR, Ichimoku Cloud, RSI, MACD, Stochastic, ADX/DMI, CCI, MFI, ATR, Volume,
  OBV, and A/D. Importing the tier registers all of them.
- **The Tier-2 contract** (`createTier2Indicator`) for indicators whose data is
  *not* derived from the chart's OHLCV — open interest, CVD, PCR, any external
  feed. It wraps a `fetch` / `subscribe` / `refetchOn` lifecycle into an ordinary
  descriptor, so the runtime, settings, panes, and removal all work identically;
  there is no second runtime. External points are projected onto the bar
  timeline by last-known-value — the most recent point *at or before* each bar,
  never interpolated and never forward-looking — and a failed fetch leaves the
  previous data on screen rather than blanking the pane.
- `IndicatorDescriptor.calcTail` — an optional incremental path so a live tick
  does not cost a full recompute. Return values for `[fromIndex, bars.length)`
  and the runtime splices them onto the previous result; return `null` to fall
  back to `calc`.
- **`chart.getState()` / `chart.restoreState(state)`** — a JSON-safe snapshot of
  the viewport, grid, crosshair mode, pane weights, per-pane price scales, and
  indicator instances, plus an opaque `drawings` slot the drawing tier owns and
  the base engine round-trips. The contract is that the chart serialises what
  the chart owns: series **data** is the app's, so `restoreState` never
  recreates series — it returns a `RestoreReport` listing the descriptors it saw
  so the app can rebuild them from its own feed and re-apply the saved styling.
  Restore is idempotent (indicators are replaced, not appended), a state from a
  newer `CHART_STATE_VERSION` is rejected rather than half-applied, and an
  indicator whose tier is not loaded is skipped rather than thrown.
- **`chart.subscribeDrag` now passes `time` alongside `price`**, so a two-axis
  drag (a trendline endpoint, a forward projection) has a usable time even where
  the gapless axis has no bar. Existing price-only callbacks are unaffected.
- **`chart.timeToCoordinate(time)` / `chart.coordinateToTime(x)`**, backed by
  new `DataLayer.indexToTimeFloat` / `timeToIndexFloat`. `indexToTime` only
  answers for indices that have a bar; anchoring to an arbitrary x needs a time
  *between* bars too — which the gapless axis (§5.3) makes the common case,
  since everything a weekend or session break collapsed lands there — and past
  the right edge, where projections live.
- `SeriesStyle.markersOnly` — draw a line series' markers with no connecting
  stroke (Parabolic SAR, scatter plots).
- `DataLayer.seriesBars(id)` — a series' bars with no per-call allocation, the
  read path for anything recomputing over full history.

- **P&F box-size modes.** `mode: 'fixed' | 'percent' | 'atr'` — `'percent'`
  sizes the box at `price × percent / 100` and `'atr'` at
  `ATR(atrPeriod) × atrMultiplier` (Wilder), both re-resolved each time a column
  opens, so the grid tracks price level and volatility.
- **Columns carry their own geometry.** `PointFigureColumn` extends `Bar` with
  `boxSize` and `boxes`, and the renderer reads the box size from the column.
  `style: { boxSize }` is no longer needed — which removes the footgun where the
  transform and the style could disagree and silently desync the glyph stack —
  and is the only way variable-box modes can render correctly. `style.boxSize`
  remains as a fallback for hand-built column data; failing that the renderer
  infers the box from the shortest column in view.
- A column's `high` is now the **exclusive top edge** of its highest box, so
  `[low, high)` is exactly the span the glyphs occupy and
  `boxes === (high - low) / boxSize`. The stack previously drew one glyph short.

## 1.0.7

### Fixed
- A right-click on the chart no longer replays the previous left-click. Only the
  primary button starts a gesture in `_onPointerDown` (a right-click's
  `pointerdown` is ignored so the chart never pans with no button held), but the
  matching `pointerup` was unguarded — so a right-click's `pointerup` fell through
  to the click branch and re-hit-tested at the *stale* down-position from the last
  left-click, re-firing `subscribeClick`. With `BuySellButtons` (1.0.6) that meant
  the first right-click after buying/selling silently placed a second, duplicate
  order. `pointerup` now applies the same primary-button guard as `pointerdown`
  (touch/pen unaffected; the internal drag-recovery path is preserved).

## 1.0.6

### Added
- `BuySellButtons` — an inline, TradingView-style trade panel drawn on the chart
  (a `SELL` button, a quantity chip, and a `BUY` button, docked to a corner and
  fixed while the chart pans/zooms). Clicks hit-test to `${id}:sell` /
  `${id}:buy` / `${id}:qty`, routed through `chart.subscribeClick`, so the app
  places the order. Prices update cheaply per tick via `setPrices(bid, ask)` /
  `setMark(price)`; `setQty()` and `setColors()` restyle at runtime. Configurable
  `position`, `margin`, labels, colors, and `showPrices`. Add it with
  `chart.addPrimitive(new BuySellButtons({ ... }))`. Base-tier export.
  (Base engine limit raised to 28 KB / 34.5 KB Brotli.)

## 1.0.5

### Fixed
- The browser's native right-click **"Save image as…"** now saves the visible
  chart instead of a blank image. The chart renders as stacked canvases and the
  browser captures only the topmost (transparent overlay) layer, so on
  `contextmenu` the clicked pane's base layer is composited beneath its overlay
  and overlay repaints are frozen while the menu is open (live ticks used to
  wipe the snapshot); rendering resumes on the next pointer/wheel/key input.
  Apps that present their own context menu (`preventDefault`) are unaffected.
  The native save captures the clicked pane only — `downloadScreenshot()`
  remains the full multi-pane export.

## 1.0.4

Trading-UI beautification: the order-placement surfaces (order / position /
bracket lines, DOM ladder) get a modern, theme-aware visual pass plus real
interaction feedback, and order lines go event-driven via OpenAlgo's
`subscribe_orders` WebSocket stream. 334 unit tests; base engine ~26.4 KB
Brotli (size limits raised to 27 / 33.5 KB for the visual-state rendering and
the order-update stream).

### Added
- Hover + dragging visual states for interactive price lines: hovering a
  draggable order line thickens it and brightens its pill, the cancel button
  fills solid on hover, and a dragged line gets a soft emphasis halo. The chart
  now applies primitive cursor hints (`ns-resize` over draggable lines,
  `pointer` over cancel/close/ladder rows) to the container and emits a new
  `hover` event (`chart.on('hover', ({ id }) => ...)`) on primitive enter/leave.
- Drag ghost: `PriceLine.setDragGhost(price | null)` draws a dimmed reference
  line at the pre-drag price while modifying an order. `chart.trading` wires it
  automatically; the live example wires it for the raw drag path.
- Broker-style segmented pill groups on order/position lines —
  `[badge][qty][label][✕]`: a solid colored badge (`BUY` / `SELL` / `TP` /
  `SL` / `LONG` / `SHORT`), boxed qty and info segments, and an integrated
  cancel `✕` (still routes as `<id>::close`). New `PriceLineOptions.badge` and
  `qty` fields; text auto-contrasts against fills (`contrastText`), so every
  theme stays legible.
- `WorkingOrderLine` shows fill progress (`3/10`) once partially filled, dims
  pending (un-acked) orders until the broker confirms, and gains a ✕ segment
  (`order:<id>::close`) plus a compact price-only axis tag.
- `PositionMarker` renders the segmented group with live P&L (₹ and %) colored
  by sign, a ✕ segment (`position:<symbol>::close`), and highlights on hover.
- `BracketGroup` chips now include prices (`SL 2,850.00`, `TP 3,000.00`), the
  R:R chip is theme-aware, risk/reward zones derive from `theme.loss`/`profit`,
  and SL/TP lines thicken on hover/drag.
- `DomLadder` is fully theme-aware (heat colors from `theme.buy`/`sell`, qty
  text auto-contrasts with the background), gains a docked-edge separator and a
  hovered-row outline as a click-to-trade affordance.
- New shared render helpers (`src/render/pill.ts`): `parseColor`, `luminance`,
  `contrastText`, `withAlpha`, `shade`, `roundRectPath`, `drawPill`, `drawGrip`.

- Real-time order updates: `OpenAlgoWsFeed.subscribeOrders()` /
  `onOrderUpdate(cb)` speak OpenAlgo's account-level `subscribe_orders` stream
  (fills, partial fills, rejections, cancellations — live broker or analyze
  sandbox), with automatic replay on reconnect. New pure helpers
  `formatSubscribeOrders`, `formatUnsubscribeOrders`, `parseOrderUpdate`, and
  `mapOrderStatus`. The live example updates order lines from this stream and
  keeps a slow poll only for reconciliation.
- `chart.downloadScreenshot(filename?)` — public PNG export of the full
  composited chart (all panes + overlays); the screenshot shortcut now routes
  through it. The browser's native right-click "Save image as…" only captures
  the transparent overlay layer.

### Fixed
- Right-click no longer arms the pan state: a context-menu click used to leave
  the chart "sticky-dragging" (its `pointerup` is swallowed by the menu). Only
  the primary button starts a pan / line-drag, and a missed `pointerup` is now
  recovered on the next move.
- Live example: Renko / Range / Line Break / Kagi / P&F no longer render with
  time gaps between elements — the volume pane is re-bucketed onto the
  transformed element times instead of re-adding every raw timestamp to the
  shared axis (documented in Transforms).
- `OpenAlgoTradeFeed` errors now include OpenAlgo's own message (e.g. "MIS
  orders cannot be placed after square-off time…") instead of a bare HTTP
  status code.
- The crosshair is hidden while dragging an order line — the frozen crosshair
  at the grab point used to read as a phantom second line.
- The series last-price line no longer strikes through order/position pill
  groups (it now draws beneath trading primitives).
- WS `trigger pending` (with a space) order status now maps to `working`.

### Changed
- `PrimitiveRenderContext` gains optional `hoverId` / `dragId` fields (custom
  primitives can render their own hover/active states).
- Trade-fill bubble/count markers use auto-contrast text instead of fixed white.
- Trade-tier `WorkingOrderLine` / `PositionMarker` default to a half-width line
  (`extentFromRight` constructor option), matching the partial-width order
  lines of the parity API.

## 1.0.3

Cosmetic parity to close the last visual gaps for a lightweight-charts migration.
318 unit tests; base engine ~24.8 KB Brotli.

### Added
- `SeriesStyle.priceLineVisible` and `lastValueVisible` toggle the dashed last-price
  line and the axis value tag per series; `SeriesStyle.title` carries a label for
  host-drawn legends. The last-price line/tag now follow the first right-scale price
  series (the main series) rather than whichever was added last.
- Crosshair styling via the theme: `crosshairStyle` (`solid` | `dashed` | `dotted`),
  `crosshairWidth`, `crosshairLabelBackground`, and `crosshairLabelVisible`.
- `timeFormatter` receives an optional `tickMarkType` hint
  (`year` | `month` | `day` | `time` | `timeWithSeconds`) so a host can render adaptive
  axis labels (year at year boundaries, month at month, day otherwise). New exported
  type `TickMarkType`.

## 1.0.2

Drop-in parity work so a host app can back every chart with this engine. Base
engine ~24.7 KB Brotli; 314 unit tests (40 files).

### Added
- Left / right / overlay price scales: `addSeries(type, { priceScaleId: 'right' | 'left' | '' })`.
  `'left'`/`'right'` draw independent, independently-autoscaled axes; `''` is a hidden
  overlay scale (volume-in-price-pane). `series.priceScale()` exposes the scale so
  `.setOptions({ marginTop, marginBottom })` can pin a volume histogram to the bottom.
- Mutable series handle: `series.applyOptions(partialStyle)`, `series.remove()`, and
  `SeriesStyle.visible` (hidden series are excluded from autoscale).
- Viewport preservation: `timeScale.setVisibleLogicalRange()` / `getVisibleLogicalRange()`
  and `chart.fitContent()` (no-arg) — keep the user's zoom across a full-history reload.
- Per-series `priceFormat` (`price` / `volume` / `custom`), applied to the series' scale;
  `compactVolume` helper.
- Dashed / dotted line series via `SeriesStyle.lineStyle`.
- Runtime `chart.applyOptions()` / `chart.setTheme()` (theme, grid, formatters, crosshair
  mode) without recreating the chart; theme `axisFontSize`, `gridStyle`, transparent `background`.

### Fixed
- `RenderLoop` no longer stalls after the first frame under a synchronous scheduler.

## 1.0.1

Full package ~38 KB Brotli (all tiers), base engine ~24 KB, zero runtime
dependencies, Apache-2.0.

### Added
- Unified event bus: `chart.on` / `off` / `once` (`crosshair:move`, `click`,
  `pan`, `zoom`, `resize`, `lazy-load`, `ready`), with `trading:*` mirrored through it.
- Data-driven trading visualization (`chart.trading`): position/order pills,
  TP/SL brackets, and fill markers (chevron / bubble / count).
- Custom formatting: `ChartOptions.priceFormatter` and `timeFormatter` (with
  runtime setters); per-pane `priceScale` options; the time axis is no longer IST-only.
- Flexible series input: `setData` accepts `Bar | LinePoint | Whitespace`
  (normalized via `toBar`); `series.getData()` reads the current bars.
- WebSocket auto-reconnect (backoff + re-auth + resubscribe); `OpenAlgoLiveDataFeed`
  bare `D`/`W` intervals, day-delta volume, and symbol+exchange tick filtering;
  `FakeDataFeed` streams deterministic bars through an injectable scheduler.
- Docs site: an interactive example gallery (chart type, themes, tooltips, event
  markers, live streaming, "Get this chart" code toggle) plus framework-integration,
  mobile, data-loading, events, types, constants, and glossary pages; redesigned
  yfinance and live OpenAlgo example apps.

### Fixed
- Multi-series `DataLayer.update`: a series-local append that is not the global
  newest no longer corrupts the shared time-axis order.
- Package now ships `NOTICE` (Apache-2.0); the accessible summary refreshes on
  live updates; `visibleBars` uses binary search for large datasets.
- Docs accuracy: real `SeriesApi`, `subscribeBars`, indicator return types, and
  interval/size/test-count figures.

### Quality
- 297 unit tests (39 files) + a Playwright real-browser smoke suite. GitHub
  Actions CI runs typecheck, unit, build, size budgets, a docs-site build, a
  `NOTICE` pack check, and the E2E smoke on every push/PR. Warning-free TypeDoc.

## 1.0.0

First public release. Full package ~29 KB Brotli (all tiers), zero runtime
dependencies, Apache-2.0.

### Added since 0.1.0
- Indicators: RSI, ATR, Supertrend (Wilder semantics, matching `openalgo.ta`),
  alongside EMA.
- Interaction: vertical price pan (drag the plot up/down), `chart.resetScale()`
  + double-click/Fit, `priceToCoordinate` / `coordinateToPrice` for DOM overlays,
  and `subscribeCrosshairMove` for OHLC legends/tooltips.
- Touch: pinch-to-zoom and two-finger pan (`touch-action: none`).
- Accessibility: focusable container with `role`/`aria-label`, a polite live
  summary, and keyboard navigation (arrows pan, +/- zoom, Home/0 reset).
- `chart.takeScreenshot()` (composites all panes/layers) and runtime grid toggles.
- Footprint primitive upgraded: volume-graded bid x ask cells, diagonal-imbalance
  boxes, POC marker, per-bar delta/volume footer.
- Live feed: composed REST + WebSocket + candle-builder data feed; WS adapter
  speaks the documented OpenAlgo protocol (authenticate -> numeric-mode subscribe ->
  `market_data`), with connection/control callbacks.
- Examples: yfinance, order-flow, market-profile (TPO), and a full LIVE OpenAlgo
  demo (history + WebSocket + chart trading) - validated against a live instance.

### Fixed
- `OpenAlgoDataFeed`/`OpenAlgoTradeFeed`: bind the global `fetch` (browser
  "Illegal invocation").
- WebSocket subscribe schema corrected to the documented per-symbol numeric-mode
  protocol.
- `modifyorder` sends the required `disclosed_quantity`.
- `mapOrder`: `trigger_price: 0` -> `undefined` so LIMIT order lines render at the
  price, not 0.

### Quality
- 223 unit tests + a Playwright real-browser smoke suite; GitHub Actions CI runs
  typecheck, unit, build, size budgets, and the E2E smoke on every push/PR.

## 0.1.0 (initial development build)

First end-to-end build of the engine. Dependency-free, ~22 KB Brotli for the
full package (all tiers).

### Engine (base tier)
- HiDPI canvas layout (base + top canvas per pane), render loop, per-pane
  invalidation mask, resize handling.
- Shared DataLayer (merge-by-time -> logical indices) keeping all panes aligned;
  gapless time axis (weekends/holidays/session breaks collapse).
- Time scale (index<->x, pan, cursor-anchored zoom, kinetic flick, fit-content)
  and price scale (linear, autoscale, tick-size formatting/snap).
- Internal time = UTC seconds; IST/epoch conversion at the feed edge.
- Live candle builder (session-aligned bucketing, ltq-sum vs cumulative-day
  volume, late-tick policy, history->live seam) + last-price line.
- Chart-type registry with all standard styles: bars, candles, hollow,
  volume-candle, line, line+markers, step, area, HLC-area, baseline, columns,
  histogram.
- Primitive/plugin API (views, z-order, hit-test, autoscale, lifecycle) powering
  markers (buy/sell signals + shapes, four sizes), event badges
  (earnings/dividend/split), and price lines.
- EMA indicator; OpenAlgo REST data adapter; deterministic fake feed.
- Optional OHLC-preserving conflation for very large datasets.

### Transform tier
- Heikin Ashi, Renko, Range bars, Line Break (render as candles); Point &amp;
  Figure and Kagi (custom renderers). Incremental for live updates.

### Trade tier
- Read: order/position/bracket primitives + live P&amp;L; book reconciliation with
  reconnect-stale handling.
- Write: order state machine, tick/price-band/freeze validation, arm/confirm
  gate, idempotency, rate-limited drag-modify, OCO, analyzer mode.
- Depth-of-market ladder: depth-agnostic (5 to 200 levels), virtualized,
  price-bucket aggregation, size heatmap, click-to-place, graceful degradation.

### Profile tier
- Volume Profile (POC + value area), Market Profile / TPO (+ initial balance),
  Footprint (bid/ask delta + imbalance), order flow (cumulative delta + stacked
  imbalance). Footprint/order flow require classified trade data.

### Tooling
- TypeScript, Rollup multi-entry build, `size-limit` (Brotli) budgets per tier,
  154 unit tests (incl. a recording-canvas harness for renderers).
