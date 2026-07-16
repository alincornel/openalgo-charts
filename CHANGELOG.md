# Changelog

All notable changes to OpenAlgo Charts.

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
