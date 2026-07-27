# Changelog

All notable changes to OpenAlgo Charts.

## 1.0.24

### Added

- **`LogoWatermark` can be a hover-revealed, clickable brand lockup.** `label`
  shows the mark alone at rest and unrolls the wording to its right on hover,
  clipped to the revealed width so the text wipes out of the mark rather than
  fading in place.

  The mark and the label **share one colour** — whichever of `tint` or
  `labelColor` is set drives both. Left to render independently, the mark kept
  its source colour and sat beside the label in an unrelated shade.

  A rounded `background` plate sits behind the pair, drawn at full alpha so it
  does not inherit the logo's transparency: without one the wording lands
  straight on the candles and is unreadable wherever the chart is busy.

  `href` marks it clickable — the hit reports a pointer cursor and `href()`
  returns the URL with `utm_medium`, `utm_campaign` and a `utm_source` naming
  the embedding page (host and path only, never the query string). A canvas
  cannot hold an anchor, so the host does the navigating.

  A mark with neither `label` nor `href` stays out of the hit path entirely, so
  plain decoration cannot swallow clicks meant for the chart.

### Fixed

- Tinting borrowed a document from the drawing context to build its offscreen
  canvas, and threw where there was none. It now falls back to an untinted mark
  — which matters more now that a labelled mark is always tinted.

## 1.0.23

### Fixed

- **`sma` was poisoned permanently by a single non-finite value.** It kept a
  running sum, so `sum += NaN` made every later value `NaN` — and subtracting
  the NaN back out when it left the window could not restore it. Any indicator
  fed a series with a warmup gap, which is any indicator chained onto another,
  produced nothing at all for the whole series. It now sums only finite values
  and counts the rest, so it reports `NaN` while a gap is inside the window and
  recovers the moment it leaves.

### Added

- **Per-bar plot colour.** `IndicatorPlot.colorBy` returns a colour per bar, and
  histogram and column renderers honour a `color` on the data point. One colour
  for a whole series cannot express a study whose meaning changes bar to bar.

- **MACD's histogram is four states**, matching how it is normally read: above
  or below zero says which side, and rising or falling against the previous bar
  says whether that momentum is building or fading. All four are settings
  (`histUpColor`, `histUpFadeColor`, `histDownColor`, `histDownFadeColor`), and
  the MACD/signal lines default to blue and orange.

- **`William VIX FIX`** (`williams-vix-fix`) — a synthetic VIX from price alone.
  The histogram goes lime when `wvf` pierces its Bollinger upper band or the top
  percentile of its range, gray otherwise, with the range lines and upper band
  drawable via the `hp` / `sd` toggles. Those toggles hide the *plots* only: the
  colour rule reads its own columns, so hiding the band cannot silently stop the
  alert, which is the whole point of the study.

- **A hairline between stacked panes**, themed as `paneSeparator`. Drawn on the
  pane's DOM box, so it sits exactly on the boundary the user drags rather than
  drifting from it when weights change.

### Changed

- Base+trade budget 42.5 -> 43 KB for the new indicator.

## 1.0.22

### Fixed

- **A maximized indicator pane drew its legend through the host's overlay.**
  `legendOffset` was pinned to one pane index, on the assumption that the host's
  own readout always covers pane 0's corner. Maximizing a lower pane parks the
  others at a placeholder weight, so the maximized pane moves into that same
  corner — and, not being pane 0, kept the default corner and drew straight
  through the host's symbol / OHLC line.

  The offset now follows whichever pane actually renders at the chart's top,
  re-evaluated on every relayout. `legendOffset.paneIndex` is gone; it described
  a fixed answer to a question whose answer moves.

  Host-added legend rows are left alone — a host positions its own.

## 1.0.21

### Fixed

- **`legendOffset` shifted every pane, not just the overlaid one.** A host that
  offsets the price pane clear of its own OHLC readout was also pushing the
  legend on each lower indicator pane down by the same amount — and a lower pane
  is short, so its row went off the pane entirely, taking the settings, close
  and move-pane buttons with it. An RSI pane could not be configured, moved or
  removed from its own legend.

  The offset now applies to one pane, `paneIndex` (default 0), because that
  overlay is nearly always on the price pane. Every other pane keeps the
  default corner.

## 1.0.20

### Added

- **A repeated indicator gets its own colours.** Adding a second EMA gave it the
  descriptor's one default blue, so three EMAs were indistinguishable both on
  the chart and in the legend, and telling which row belonged to which meant
  opening each one's settings.

  The 2nd and later instances of the same `indicatorId` now rotate through a
  palette. Only colour keys the caller left unset are filled, so an explicit
  colour always wins; the first instance keeps exactly what the descriptor
  chose; and the count is per indicator id, so adding two EMAs does not shift
  the first RSI. Multi-plot indicators stride by their plot count, so MACD's
  three lines shift as a block instead of landing on the previous instance's
  colours.

## 1.0.19

### Fixed

- **`BuySellButtons` painted its label outside the button at any `scale` below
  1.** The price and label baselines were fixed pixel offsets (18 and 33) tuned
  for the 42px box, so they were exact at scale 1 and increasingly wrong below
  it — at 0.72 the label sat 3px past the bottom edge. They are fractions of the
  button height now, which is the same result at scale 1.

## 1.0.18

### Added

- **A plot's chart type is now a setting.** `indicatorStyleInputs` generates a
  "Plot style" select per plot (`<plot>:type`), so the same column of numbers can
  be drawn as a line, step, area, histogram or columns — a descriptor cannot know
  which reads best for a given use. Defaults to the declared type, so nothing
  moves unasked. `INDICATOR_PLOT_STYLES` is the option list.

  Switching rebuilds that plot's series rather than restyling it: the chart type
  belongs to the series, not the style bag.

## 1.0.17

### Added

- **Indicator fills — the Ichimoku cloud.** A descriptor can declare `fills`,
  shading the band between two of its plots. Two lines are not the same picture
  as a filled region: the shading is what makes "price is above the cloud" and
  "the cloud flipped" readable at a glance, and which span leads is itself the
  signal, which is why the band takes two colours.

  Ichimoku now ships one between Senkou Span A and B, restyleable through
  `cloudUpColor` / `cloudDownColor`. Runs are split at the exact crossing rather
  than the nearest bar, or the colours would bleed a bar past every flip, and a
  gap in either plot breaks the band instead of bridging it.

  `IndicatorFill` is exported for hosts that want to shade their own pair.

- **The `measure` tool reports what a measurement should.** It drew a box and
  one line of text; it now draws the price and time arrows that make it read as
  a measurement, and a chip carrying the change, percentage, bar count,
  calendar span, and — via `rc.bars()` — the volume over the span.

### Changed

- Base tier budget 35 -> 36 KB, base+trade 41.5 -> 42.5 KB, full 72 -> 73 KB.
  The fill primitive lives in the base bundle because `IndicatorInstance` does.

## 1.0.16

### Added

- **`BuySellButtons` takes a `scale`** (default 1, clamped 0.6–1.5). The panel
  was a fixed 190x42, which crowds the pane's legend rows in a dense trading
  layout and left no way to make room. Box, gaps, corner radius and type all
  scale together, and so do the hit rects — a smaller button that still took
  full-size clicks would be worse than no option at all.

## 1.0.15

### Added

- **`legendOffset` chart option** — where indicator legend rows start inside a
  pane, in media px. A host that draws its own overlay in the top-left corner
  (an OHLC readout, a symbol line) had no way to push the canvas rows clear of
  it, so adding an indicator landed its legend *underneath* the host's own text:
  unreadable, and its settings and close buttons invisible and unclickable.
  Defaults to `{ top: 6, left: 8 }`, so nothing moves unless you ask.

## 1.0.14

The lazy tiers were unusable from TypeScript. Fixed, with a build guard so it
cannot come back. 556 unit tests.

### Fixed

- **`openalgo-charts/draw`, `/trade` and `/profile` could not be used from
  TypeScript at all.** Passing the chart from `createChart()` to
  `new DrawingController(chart)` failed with

  > Types have separate declarations of a private property `_container`

  and there was no way to fix it from outside the package.

  Each tier is bundled into its own `.d.ts`. A tier that imported a shared type
  through a *relative* path had that declaration **inlined** — so `Chart`,
  `TimeScale`, `PriceScale` and `DataLayer` each existed twice. Those classes
  carry private members, which makes them nominal rather than structural, so the
  second copy was a genuinely different type to TypeScript. Plain JavaScript
  consumers never noticed, which is why it survived this long.

  Tiers now import shared types from the package entry, which tier builds
  already leave external, so there is one declaration and one identity. The tier
  declarations shrank as a side effect: draw 47 KB -> 17 KB, trade and profile
  similarly.

- `DrawingController` takes a structural `DrawingChartHost` — the seven members
  it actually uses — rather than the whole `Chart` class. The real chart
  satisfies it with nothing to cast, and the contract now states what the
  controller needs.

### Added

- **`DataLayer`, `IndexedBar` and `SeriesId` are exported types.**
  `chart.dataLayer` was public while its type was not nameable, so a consumer
  could hold one but never declare one.
- `npm run check:dts`, wired into `verify`: fails the build if any tier
  re-inlines a shared declaration.

## 1.0.13

Nine more drawing tools (34 -> 43), freehand brushes, one-click position tools,
and the fix for `path` / `polyline` being impossible to finish. 556 unit tests.

### Fixed

- **Brush and Highlighter behaved as polylines** — a vertex per click, and no
  way to end the shape. Both are `points: 0`, which the controller read as
  "collect anchors until told to stop", the same contract `polyline` wants.

  `DrawingTool` gains `freehand`. A freehand tool samples the cursor while the
  pointer is held and commits on release, so one press-drag-release is one
  stroke. `crosshair:move` now carries `pressed`, since placement mode swallows
  the pan path and there was otherwise no way to observe a drag in progress.

- **A selected brush showed a grab handle on every sampled point**, burying the
  ink under dozens of circles and leaving no way to grab the stroke itself. A
  freehand drawing now handles only its two ends; it still keeps every sample,
  which is what gives it its shape.

### Added

- **Nine more drawing tools**, taking the built-in set from 34 to 43 (draw tier
  8.3 KB -> 11.3 KB Brotli):

  Shapes: `rotated-rectangle` (anchors 0->1 lay out an edge, 2 sets the depth
  perpendicular, so it can follow a trend channel an axis-aligned rectangle
  cannot) and `double-curve` (an S through three anchors, the second control
  mirrored about the chord's midpoint). Cycles: `cyclic-lines`, `time-cycles`,
  `sine-line`. Text and notes: `price-label` (reads its value off the anchor, so
  dragging it re-reads rather than going stale), `callout`, `flag-mark`.
  Brushes: `brush`.

- **`path` and `polyline` can now be finished.** Both declare `points: 0`, and
  nothing could ever complete them -- double-click reset the view instead, so
  they collected vertices forever. Double-click now finishes the shape while a
  tool is armed, and `controller.finish()` is public for binding a key.

- `path` is a click-per-vertex shape again, with an arrowhead on its last leg --
  what separates it from `polyline`. The freehand brush moved to its own `brush`
  id, so the two are no longer one tool wearing two names.

- **`DrawingTool.expand`** — a tool can turn the anchors actually clicked into
  its full anchor set, so it can place a complete, immediately editable default
  from fewer clicks. Receives `barSeconds` and `visibleBars`.
- **Long/Short Position place from a single click at 1:1**, sized to ~8% of the
  visible range so the box is grabbable at any zoom, with all three anchors
  still draggable. Previously they needed three clicks and drew nothing until
  the third.
- **Position and Forecast readouts** are now chips rather than one terse line.
  Position: `Target: <Δ> (<%>), Amount: <cash>` outside the target line,
  the same for `Stop`, and `Qty` / `Risk/reward ratio` at the entry — each
  hugging its own line, so the layout reads the same for a long and a short.
  Forecast: the anchor price/date, the projected move with its duration and
  landing price/date, and a SUCCESS/MISSED verdict once the window has elapsed.
- **`PrimitiveRenderContext.bars()`** — the pane's primary price series, lazily,
  for a primitive that needs what price actually did rather than just the
  scales. The forecast verdict is the first caller.

### Demo

- **5m / 15m / 30m drew nothing** while 1h and 1d worked. Yahoo caps intraday
  history (~60 days for 5m–90m, ~730 for 1h) and answers an over-long request
  with an *empty* frame rather than an error, so the default 1y range silently
  produced no bars. The range is now clamped to what the interval can serve,
  the range menu only offers those, and the status line says when it clamped.
- The yfinance dev server sends `Cache-Control: no-store`. The browser keeps ES
  modules in its own module map, so rebuilding the library and reloading still
  ran the previous bundle with no sign anything was stale.

## 1.0.12

A fix for the forming candle rendering as two overlapping candles of opposite
colour during live ticks, and `version()` catching up with the package version.
534 unit tests.

### Fixed

- **The forming candle could render as two overlapping candles of opposite
  colour** — a red body with a green one painted over it, and a wick spanning
  both — while live ticks came in.

  `setData` sorted its input by time but never de-duplicated it, while the
  shared time axis collapses times through a `Set`. Two bars at the same time
  therefore resolved to the same logical index, so `visibleBars` handed the
  renderer both and they drew at the same x, the second over the first. A live
  feed produces that pair whenever its candle builder starts unseeded: it opens
  a fresh bar for the bucket the fetched history already ends in, and the host
  appends it alongside the historical one. Reconnecting mid-bar does it again.

  `setData` now collapses repeated times, keeping the last occurrence — the
  newer value when a live bar arrives alongside the historical bar it
  supersedes. `prependData` and `update` already de-duplicated.

  Seed your candle builder from the last historical bar
  (`builder.seed(bars[bars.length - 1])`) so the live bar continues it: an
  unseeded builder still opens at the first tick price it sees rather than the
  bucket's true open.

- **`VERSION` / `version()` reported `1.0.8`** — the constant is hand-maintained
  and was missed by the 1.0.9, 1.0.10 and 1.0.11 bumps. It now matches
  `package.json` again.

## 1.0.11

16 more drawing tools, TradingView-style rail flyouts, and the fix for a blank
region that could appear under the chart and persist across reloads.
532 unit tests.

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

- **A large blank region could appear under the chart, and persist across
  reloads.** Three faults compounded.

  `removeIndicator` did not prune the pane it had just emptied — that logic sat
  in the pane legend's close handler, so the on-chart X cleaned up but a host
  removing the same indicator from its own UI (a toolbar chip, a menu) left an
  empty pane behind. An empty pane still claims its weight and still draws a
  default 0..100 price axis, which is the blank region plus the second set of
  axis labels under the price ticks. The pruning now lives in
  `removeIndicator`, so every caller behaves the same.

  `getState` then persisted that orphan, and `restoreState` faithfully rebuilt
  it — so once it happened it survived every reload. `restoreState` now drops
  panes that end up with no series.

  `maximizePane` parks the other panes at a `0.001` placeholder and snapshots
  the real weights by index, but `removePane` never spliced that snapshot — so
  un-maximizing restored weights against a shifted array and could strand panes
  at the placeholder. `removePane` now keeps it aligned.

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
