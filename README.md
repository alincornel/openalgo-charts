<div align="center">

# OpenAlgo Charts

**A from-scratch, dependency-free HTML5-canvas charting engine for OpenAlgo.**

Professional interactive charts, indicators, drawing tools, order flow, and on-chart trading — six lazy-loaded tiers, zero runtime dependencies, ~37 KB Brotli for the base engine.

[![npm version](https://img.shields.io/npm/v/openalgo-charts.svg?color=cb3837&label=npm)](https://www.npmjs.com/package/openalgo-charts)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![bundle](https://img.shields.io/badge/brotli-37%20KB%20base%20%C2%B7%2088%20KB%20all%20tiers-brightgreen.svg)](#size-budget)
[![tests](https://img.shields.io/badge/tests-1001%20passing-brightgreen.svg)](#develop)
[![dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)](#principles)

[**Documentation**](https://marketcalls.github.io/openalgo-charts/) &nbsp;·&nbsp; [**Live examples**](https://marketcalls.github.io/openalgo-charts/examples) &nbsp;·&nbsp; [**Getting started**](./docs/getting-started.md) &nbsp;·&nbsp; [**Architecture**](./ARCHITECTURE.md)

<img src="docs/architecture-diagram.png" alt="OpenAlgo Charts - layered architecture from public API down to feeds and data, with loadable bundle tiers" width="920" />

</div>

---

## Live OpenAlgo trading terminal

Right-click the chart to place market / limit / stop orders, drag the order and TP/SL bracket lines to modify, and watch live P&amp;L on the position line - all on real OpenAlgo history + WebSocket tick data, with an analyzer (sandbox) mode so nothing goes live until you arm it.

<p align="center">
  <img src="docs/trading.png" alt="OpenAlgo Charts live trading terminal: RELIANCE 5m candles with order lines, a right-click order menu, a long position with live P&L, and volume" width="920" />
</p>

## Examples gallery

Every chart in the [live gallery](https://marketcalls.github.io/openalgo-charts/examples) is the real library running in your browser - switch tabs, hover the crosshair, drag the order lines, place a drawing. What you see is the code that ran.

<p align="center">
  <img src="docs/demo1.png" alt="Chart-type switcher, custom themes, data tooltips, and event markers" width="49%" />
  <img src="docs/demo2.png" alt="Range switcher, legend, series compare, and indicators and markers" width="49%" />
</p>
<p align="center">
  <img src="docs/demo3.png" alt="More live OpenAlgo Charts examples" width="49%" />
  <img src="docs/demo4.png" alt="More live OpenAlgo Charts examples" width="49%" />
</p>

## Install

```bash
npm install openalgo-charts
```

```ts
import { createChart, generateBars } from 'openalgo-charts';

const chart = createChart(document.getElementById('chart'));
chart.addSeries('candlestick').setData(generateBars(1700000000, 200, 3600));
```

## Tiers

Import only what you use. Each tier is a separate bundle that registers into the base engine's registries, so the cost of a feature you don't load is zero.

| Import | Contents | Brotli |
|---|---|---|
| `openalgo-charts` | Engine, 13 chart types, panes &amp; scales, primitives, registries, chart state, trading overlay, OpenAlgo feeds | 37.0 KB |
| `openalgo-charts/indicators` | 86 built-in indicators + the Tier-2 (external-data) contract | 20.1 KB |
| `openalgo-charts/draw` | 43 drawing tools + a headless drawing controller | 11.7 KB |
| `openalgo-charts/transform` | Heikin Ashi, Renko, Range bars, Line Break, Point &amp; Figure, Kagi | 2.7 KB |
| `openalgo-charts/profile` | Volume Profile, Market Profile (TPO), Footprint, order flow | 10.1 KB |
| `openalgo-charts/trade` | Order / position / bracket tools + DOM ladder | 6.6 KB |

Everything together is **88.2 KB Brotli**. Figures are the measured `size-limit` output; the trade tier is a delta over the base, which is why base + trade (43.6 KB) is less than their listed sum.

## What's built

### Chart types &amp; transforms
Candles, hollow and volume candles, OHLC bars, high-low, line, line+markers, step, area, HLC-area, baseline, columns, histogram — plus Heikin Ashi, Renko, Range bars, Line Break, **Point &amp; Figure** (fixed / percent / ATR box sizing, high-low or close construction), and Kagi.

### Indicators

```ts
import 'openalgo-charts/indicators';

chart.addIndicator('bollinger');                      // overlays the price pane
const macd = chart.addIndicator('macd', { fastPeriod: 8 });   // gets its own pane
macd.setSettings({ 'macd:width': 2, 'macd:lineStyle': 'dashed' });
```

86 built-ins across Trend, Momentum, Volatility and Volume, from the everyday (SMA, EMA, WMA, VWAP, Bollinger Bands, RSI, MACD, Stochastic, ADX/DMI, ATR) through Supertrend, HalfTrend, Ichimoku, Keltner, Donchian and Chandelier Exit to Connors RSI, Fisher Transform, Woodies CCI, Klinger, Vortex, Chop Zone and Williams Fractals. Twenty-two of them draw shaded bands, and three emit named buy/sell markers. The full catalogue with ids and defaults is in the docs.

The chart owns the whole lifecycle — series, pane placement, reference levels, fixed ranges (RSI 0..100), recompute on data change, teardown. Every plot gets colour, opacity, thickness, and line style for free, generated from the descriptor. Write your own with `registerIndicator`, or use the **Tier-2 contract** for indicators whose data isn't derived from OHLCV (open interest, CVD, any external feed).

### Drawing tools

```ts
import { DrawingController } from 'openalgo-charts/draw';

const draw = new DrawingController(chart, { magnet: true });
draw.setTool('trend-line');   // the next two clicks place it
```

43 tools. Lines: trend line, ray, extended line, arrow, horizontal line/ray, vertical line, cross line. Shapes: rectangle, rotated rectangle, ellipse, circle, triangle. Paths: path, polyline, arc, curve, double curve. Channels: parallel channel, fib channel. Fibonacci: retracement, extension, time zone, speed fan. Gann: fan, box. Cycles: cyclic lines, time cycles, sine line. Forecasting: long/short position (1:1 from one click, with risk/reward and risk-based sizing), forecast. Measurers: price range, date range, measure. Arrows: mark up, mark down. Text and notes: text, price label, callout, flag mark. Brushes: brush, highlighter (freehand).

Headless by design — no toolbar, no dialogs. Placement with live preview, selection, whole-shape and per-anchor dragging, magnet snap to O/H/L/C, undo/redo (a drag is one step), and persistence. Anchors are `{ time, price }`, never pixels, so they survive zoom and resolve inside collapsed session gaps and past the last bar.

### Panes &amp; legends
Draggable pane dividers, move / maximize / remove, and pane legends showing one reading per plot in that plot's own colour, with inline show-hide / settings / move / delete controls revealed on hover.

### Trading
Order, position, and bracket lines with live P&amp;L, one-click and drag-to-modify, OCO, validation, an order state machine, analyzer (sandbox) mode, and a depth-of-market ladder (5 to 200 levels).

### Profiles &amp; order flow
Volume Profile, Market Profile (TPO), Footprint, and cumulative delta.

### State
`chart.getState()` / `chart.restoreState()` capture the viewport, grid, panes, price scales, indicator instances, and drawings as one JSON payload — saved layouts and templates with no extra storage plumbing.

### Data
OpenAlgo REST history + WebSocket ticks with auto-reconnect and resubscribe, live candle aggregation, tick/volume bars, a unified `chart.on(...)` event bus, markers and signals, earnings/dividend/expiry event markers, and custom price/time formatters.

## Size budget

Enforced in CI by [`size-limit`](./.size-limit.json) — nothing is excluded, because there are no runtime dependencies to exclude.

| Bundle | Limit | Actual |
|---|---|---|
| Base engine | 40 KB | 37.04 KB |
| Base + trade | 47 KB | 43.62 KB |
| Indicators tier | 21 KB | 20.09 KB |
| Draw tier | 14 KB | 11.73 KB |
| Transform tier | 5 KB | 2.66 KB |
| Profile tier | 11 KB | 10.12 KB |
| **Everything** | **90 KB** | **88.21 KB** |

## Documentation

Full docs, the interactive example gallery, and the generated API reference live at:

**https://marketcalls.github.io/openalgo-charts/**

The site is built with Nextra (in [`website/`](./website)) and statically exported to GitHub Pages on every push. Every code sample on a docs page is a *live* chart running the real library, so what you read is what runs. To run the site locally:

```bash
npm run build                               # build the library (dist/) the live demos import
cd website && npm install && npm run dev    # http://localhost:3000/openalgo-charts
```

## Agent skills

Teach your AI coding assistant this library:

```bash
npx skills add https://github.com/marketcalls/openalgo-charts
```

Installs six skills from [`.github/skills/`](./.github/skills) - a reference hub with 18 deep-dive files covering the whole API surface and its foot-guns, plus task skills for scaffolding a chart, adding indicators, building a terminal, writing a plugin, and debugging. Works with Claude Code, Cursor, Codex, Copilot, Gemini CLI and the rest of the `skills` CLI's supported agents.

## Examples

Runnable demos in [`examples/`](./examples), including a full **yfinance terminal** ([`examples/yfinance`](./examples/yfinance)) with a full terminal shell: symbol search, interval pills, chart-type picker, indicator menu, a vertical drawing rail, a floating properties bar, generated indicator settings, and layout persistence.

```bash
npm run build
cd examples/yfinance && pip install -r requirements.txt && python server.py
# → http://127.0.0.1:8000/examples/yfinance/index.html
```

## Develop

```bash
npm install        # install dev toolchain
npm run typecheck  # strict TypeScript check
npm test           # unit tests (vitest) - 1001 across 61 files
npm run build      # Rollup -> dist/ (minified ESM per tier + types)
npm run size       # size-limit (Brotli) against the budget
npm run e2e        # Playwright Chromium smoke tests
npm run verify     # typecheck + test + build + size
```

## Principles

- **Single canvas pipeline** (no SVG, no DOM-per-bar) — small and fast.
- **Gapless time axis by default** — weekends, holidays, and session breaks collapse.
- **Registries, not switches** — chart types, indicators, and drawing tools are all descriptors. Adding one is a registration, never a core change.
- **Zero runtime dependencies** — nothing is excluded from the size budget.
- **Apache-2.0**, original code.

## Status &amp; limitations

Version **1.1.0**. All engine build phases are implemented with 1001 unit tests across 61 files.

Known gaps, stated plainly:

- **Footprint and order flow need trade-by-trade data classified bid/ask.** OpenAlgo does not store this by default, so it is live-session-only unless you add a tick recorder — `FootprintAggregator` is the live path. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §6A.
- **Only `Footprint` is theme-aware among the profile primitives.** `VolumeProfile`, `MarketProfile` and `HorizontalProfile` never read `rc.theme`; their defaults are dark-tuned, so a light theme needs explicit colours. `HorizontalProfile` also hardcodes its POC / value-area line colours and has no `setOptions`.
- The OpenAlgo **WS/trade adapter wire schemas** ship with injectable transports and offline tests, but the exact field names should be verified against your running OpenAlgo build.
- Price-scale **`percentage`** and **`indexed-to-100`** modes are not implemented. (Hidden overlay scales *are* — add a series with `priceScaleId: ''`.)
- An optional **DOM chrome package** (toolbar, dialogs, command palette, objects panel) is the next planned piece; today that UI lives in the examples.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §13a for the full deferred list.

## License

[Apache-2.0](./LICENSE). See [`NOTICE`](./NOTICE).
