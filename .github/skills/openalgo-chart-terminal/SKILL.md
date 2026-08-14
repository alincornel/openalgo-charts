---
name: openalgo-chart-terminal
description: Build a full trading terminal on openalgo-charts - symbol search, interval switcher, chart-type picker, indicator menu, drawing rail, live OpenAlgo REST plus WebSocket data, on-chart order lines with drag-to-modify, market depth, and layout persistence. Use when the user asks for a trading terminal, a charting workstation, on-chart trading, or to wire orders onto a chart.
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

One payload covers viewport, grid, panes, price scales, indicator instances and drawings. Indicators whose tier is not loaded are skipped on restore rather than throwing, so restore after your tier imports. See [events-and-state](../openalgo-charts/references/events-and-state.md).

## Rules

1. **One chart instance for the terminal's life.** Symbol, interval, theme and chart-type changes all mutate it in place.
2. **Chart orchestration belongs outside the UI framework.** A plain module holding the chart, the feed and the subscriptions; the framework renders the shell and calls into it.
3. **Tear down every subscription** on symbol change and on unmount. A leaked WebSocket handler will keep pushing bars into a destroyed chart.
4. **API keys never live in committed client source.** Use the project's env mechanism.
5. **Analyzer mode by default.**
6. No emojis or icons in the UI, code, or logs.

## Verify

Typecheck, then drive the real thing: switch symbol, switch interval, pan left until history loads, add an indicator, place a drawing, reload the page and confirm the layout came back. Report which of these you actually exercised and which you could not.
