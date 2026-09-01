# yfinance historical demo

Loads historical OHLCV from [yfinance](https://pypi.org/project/yfinance/) and
renders it with OpenAlgo Charts (candles + volume pane), showing how to wire any
OHLCV source through a custom `DataFeed`.

## Run

```bash
# 1. Build the library bundles (from the package root) — the demo imports /dist
npm run build

# 2. Install the one Python dep and start the demo server
cd examples/yfinance
pip install -r requirements.txt
python server.py            # → http://127.0.0.1:8000   (or: python server.py 8123)
```

Open **http://127.0.0.1:8000/examples/yfinance/index.html**, type a Yahoo Finance
symbol, pick an interval/range, and click **Load**.

Symbol examples: `AAPL`, `MSFT`, `RELIANCE.NS` (NSE), `^NSEI` (Nifty 50),
`BTC-USD` (crypto).

## How it connects

```
yfinance (Python)  ──►  server.py /api/history  ──►  YFinanceDataFeed.getBars()  ──►  series.setData()
```

- `server.py` serves the package root statically **and** answers
  `GET /api/history?symbol=&interval=&period=`, mapping the yfinance DataFrame to
  the chart's `Bar` shape (`{ time: <UTC seconds>, open, high, low, close, volume }`).
- `index.html` defines a tiny `YFinanceDataFeed` implementing `getBars()` — the
  same broker-agnostic `DataFeed` interface the OpenAlgo adapter uses. Swapping
  data sources is just a different `getBars()`.

## What the demo shows

| Feature | Where |
|---|---|
| **102 built-in indicators** | The picker is built from `registeredIndicators()`, not a hardcoded list, so anything registered shows up, grouped by category. Add/remove live, no refetch. The count is the tier's, not the demo's: it went 91 to 102 in 1.8.3 and the picker needed no change. |
| **Pane legends** | Every source gets a row: swatch, name, params, and one reading per plot in its own colour. Hover a row for inline controls — show/hide, settings, move pane, maximize, delete. |
| **Generated settings** | The gear opens a form built from the descriptor's `inputs`. The same code renders MACD, Bollinger, or your own indicator — nothing is indicator-specific. |
| **Draggable panes** | Drag the boundary between panes (cursor turns `row-resize`) to redistribute height. |
| **Transforms** | The chart-type dropdown has a *Transforms* group: Heikin Ashi, Renko, Range Bars, Line Break, Point & Figure, Kagi. P&F reveals its box-sizing mode (ATR / percent / fixed). |
| **Layout save/restore** | `chart.getState()` → `localStorage` → `chart.restoreState()`, reporting how many indicators and series descriptors round-tripped. |
| **Volume overlay** | Volume rides an overlay price scale (`priceScaleId: ''`) inside the price pane, pinned to the bottom fifth — so the right-hand axis stays a clean price ladder instead of stacking a second numeric scale. |
| **Chart trading** | Right-click for single orders; Buy/Sell Bracket for entry + OCO target/stop. Drag any line to re-price it. |
| **Market replay** | Press Replay and pick the bar to start from: everything to its right greys out across every pane while you choose, because picking a start with the next twenty bars readable is picking on hindsight. Then walk it. On an interval with a finer one below it the displayed bar *forms* rather than landing complete, and the transport counts the steps (a 1d bar over 60m data takes 7). A "Replay" mark sits on the plot the whole time, since a chart replaying August looks exactly like one showing today. Leaving asks first. |
| **Chart snapshot** | The camera saves the chart as a PNG or copies it to the clipboard, ready to paste. Built on `chart.takeScreenshot()`, so anything drawn on the canvas, watermark and replay mark included, is in the image. |

## Notes

- Intraday intervals (`1m`–`90m`, `1h`) are limited by Yahoo to recent history
  (≈7–60 days); daily/weekly go back years. Pick a compatible interval + range.
- Times are converted to **UTC seconds** internally; the chart renders a gapless
  axis (weekends/holidays collapse) and formats labels in IST by default.
- yfinance is unofficial and rate-limited — for production use OpenAlgo's own
  `/api/v1/history` via `OpenAlgoDataFeed`.
