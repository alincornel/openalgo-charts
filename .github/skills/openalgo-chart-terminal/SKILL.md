---
name: openalgo-chart-terminal
description: Build a full trading terminal on openalgo-charts - symbol search, interval switcher, chart-type picker, indicator menu, drawing rail, live OpenAlgo REST plus WebSocket data, on-chart order lines with drag-to-modify, market depth, a settings dialog and context menu, market replay, symbol comparison, and layout persistence. Use when the user asks for a trading terminal, a charting workstation, on-chart trading, or to wire orders onto a chart.
argument-hint: "[feature]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

Build or extend a terminal. This is the largest thing you can build with this library, so build it in the order below and get each layer working before starting the next.

Two working references exist. Read the one closer to the user's stack before writing code:

- `examples/yfinance/index.html` in the openalgo-charts repo - a complete single-file terminal shell, no framework.
- `frontend/src/components/trading/ChartPane.tsx` and `frontend/src/lib/trading/terminal.ts` in the OpenAlgo application repo - a production React terminal. Its central lesson: **keep chart orchestration in a plain TypeScript module and let React own only the DOM shell.**

## Build order

### 1. Chart and data

```ts
import { createChart, OpenAlgoLiveDataFeed } from 'openalgo-charts';

const chart = createChart(el, { theme: darkTheme, crosshairMode: 'magnet' });
const price = chart.addSeries('candlestick');
const volume = chart.addSeries('histogram', { paneIndex: 1 });
```

Load history, then subscribe, seeding the builder from the last historical bar so the live candle continues its bucket instead of starting a fresh one. See [feeds-and-live](../openalgo-charts/references/feeds-and-live.md).

### 2. Symbol and interval switching

Switching either one is a full data reload, not a chart rebuild. Tear down the old subscription first, then `setData`, then resubscribe. Do not create a second chart.

**Switch the clock with the symbol.** `chart.setTimezone(zoneForExchange(exchange))` takes an IANA name (default `Asia/Kolkata`) and moves the axis labels, the crosshair tag *and* every session-anchored study, so a US symbol stops restarting its VWAP in the middle of the afternoon. Hold the chosen zone in your own state if anything in the terminal rebuilds the chart, and offer it as a control: a user watching a US symbol from Mumbai may want either clock. The settings schema ships that control (`time.timezone`, step 10), so mirror the zone rather than building a second picker. It throws on a name the runtime does not know, so guard user input with `isValidTimezone`. See [data-and-time](../openalgo-charts/references/data-and-time.md).

### 3. History paging

`chart.setHistoryLoader(fn)` fires when the user pans past the left edge. Fetch older bars, `series.prependData(older)`, then `chart.historyLoadComplete()`. Prepending shifts logical indices but the visible window is preserved - do not re-fit.

### 4. Chart type and transforms

The picker maps a label to a `SeriesType`. Renko, Range, Line Break and Heikin Ashi transform the bars you pass to an ordinary series; Point and Figure and Kagi need `import 'openalgo-charts/transform'` for their renderers. See [transforms](../openalgo-charts/references/transforms.md).

### 5. Indicators

`import 'openalgo-charts/indicators'`, then a menu built from `registeredIndicators()`. The gear on a pane legend emits `indicatorSettings` - open your own dialog generated from the descriptor. See [indicators](../openalgo-charts/references/indicators.md).

### 6. Drawing rail

```ts
import { DrawingController } from 'openalgo-charts/draw';
const draw = new DrawingController(chart, { magnet: true });
draw.setTool('trend-line');
```

The controller is headless. Build the rail from `registeredDrawingTools()` and show the chord from `drawingShortcuts()` beside each name. The library installs no key listener - call `matchDrawingShortcut(event)` from your own handler, gated on the chart having focus and no dialog being open. See [drawing-tools](../openalgo-charts/references/drawing-tools.md).

### 7. On-chart trading

Two distinct layers. Get this right or you will build the wrong one.

| Need | Layer |
|---|---|
| Draw positions, working orders, brackets, fills; let the user drag them | `chart.trading` in the base bundle |
| Actually place, modify and cancel with a broker | `OrderEngine` from `openalgo-charts/trade` |

The loop is: push exchange state into `chart.trading`, the user drags a line, the chart emits a `trading:*` event, your handler calls the broker, the broker's response comes back as new exchange state which you push in again. The chart is never the source of truth. See [trading](../openalgo-charts/references/trading.md) and [trade-tier](../openalgo-charts/references/trade-tier.md).

**Ship analyzer/sandbox mode first and default to it.** Nothing should reach a live broker until the user explicitly arms it.

### 8. Market depth

`DomLadder` from the trade tier, fed by `subscribeDepth` on the feed. Levels range from 5 to 200 depending on what the broker streams.

### 9. Layout persistence

```ts
localStorage.setItem('layout', JSON.stringify(chart.getState()));
chart.restoreState(JSON.parse(localStorage.getItem('layout')!));
```

One payload covers viewport, grid, panes, price scales, indicator instances, drawings and the settings block (canvas, status line, trading colours, event filters). Indicators whose tier is not loaded are skipped on restore rather than throwing, so restore after your tier imports. See [events-and-state](../openalgo-charts/references/events-and-state.md).

### 10. Settings dialog and context menu

```ts
const tabs = chartSettingsSchema(chart);                        // render these
applyChartSettings(chart, { 'canvas.grid.vertLines': false });  // patch on change
chart.on('contextmenu', (e) => { (e as ContextMenuEvent).preventDefault(); showMenu(e); });
```

Render the tabs from the schema rather than hardcoding controls: the inputs are the `IndicatorInput` union your indicator settings form already handles plus one extra kind, `colorPair`, and every control maps to a real option. Five tabs: Price, Readout, Axes, Appearance, Trading. See [settings-and-menus](../openalgo-charts/references/settings-and-menus.md).

**Build the `colorPair` widget before anything else in the dialog.** It is a bullish/bearish pair on one labelled row (switch, up swatch, down swatch), and it is what keeps a dense tab fitting without a scrollbar. Its `enabled` half is optional: a candle Body has no visibility flag, so that row renders with two swatches and an empty switch slot rather than a checkbox that does nothing.

**The timezone is a schema control now**, `time.timezone` on the Axes tab. Drive it through `applyChartSettings` like every other key and let Cancel restore it with the rest; do not add a second zone row of your own.

A menu raised on a price axis is the other half of step 10. It is a branch of the same handler, not a second listener:

```ts
chart.on('contextmenu', (e) => {
  const ev = e as ContextMenuEvent;
  if (ev.target.kind !== 'price-scale') return;
  ev.preventDefault();
  renderAxisMenu(ev.point, chart.priceAxisState(ev.paneIndex, ev.target.scaleId ?? 'right'));
});
```

Every row it draws is readable back from `priceAxisState` and actionable through `setPriceAxisOptions`, `setPriceAxisAutoFit`, `setPriceAxisLockRatio` and `movePriceAxis`, so no row is drawn with a checkmark and nothing behind it. Reference levels (previous close, session high and low) belong in the same menu, driven by a `PriceLevels` primitive: each level's plot line and axis tag are two flags in one group, and a level whose `available(kind)` is false is a **disabled** row, not a missing one.

**Hold your chrome to the UI standard** in [themes-and-styling](../openalgo-charts/references/themes-and-styling.md#host-chrome-the-ui-standard): styled scrollbars on every dark surface, colour inputs as small squares, paired colours on one row, themed checkboxes and selects, tab glyphs, and no control with nothing behind it.

### 11. Replay and comparison

```ts
const replay = new ReplayController(chart, { bars, startIndex, barMs: 500 });
addComparison(chart, { symbol: 'BANKNIFTY', bars: otherBars });
```

Both are headless: draw the transport bar from `replay.state()` plus the `replay:*` events, and the symbol chips from `list()`. Detach the live feed while replaying, and pass every series on the timeline (volume included) to the replay controller. See [replay-and-compare](../openalgo-charts/references/replay-and-compare.md).

## Rules

1. **One chart instance for the terminal's life.** Symbol, interval, theme and chart-type changes all mutate it in place.
2. **Chart orchestration belongs outside the UI framework.** A plain module holding the chart, the feed and the subscriptions; the framework renders the shell and calls into it.
3. **Tear down every subscription** on symbol change and on unmount. A leaked WebSocket handler will keep pushing bars into a destroyed chart.
4. **API keys never live in committed client source.** Use the project's env mechanism.
5. **Analyzer mode by default.**
6. No emojis or icons in the UI, code, or logs.

## Verify

Typecheck, then drive the real thing: switch symbol, switch interval, pan left until history loads, add an indicator, place a drawing, reload the page and confirm the layout came back. Report which of these you actually exercised and which you could not.
