# Feeds and live data

*When to read this: you are connecting the chart to a broker or backend — REST history, a WebSocket tick stream, live candle assembly, or a custom `DataFeed`.*

## The DataFeed contract

`src/feed/types.ts`. The chart core never imports a broker SDK; it depends only on this.

```ts
interface DataFeed {
  getBars(req: BarsRequest): Promise<Bar[]>;
  subscribeBars?(req: BarsRequest, onBar: (bar: Bar) => void): UnsubscribeFn;
  subscribeDepth?(req: BarsRequest, onDepth: (depth: MarketDepth) => void): UnsubscribeFn;
}

interface BarsRequest {
  symbol: string;
  exchange: string;
  interval: string;   // '1m' | '5m' | '1h' | 'D' | ...
  from?: UTCSeconds;
  to?: UTCSeconds;
}
```

**`subscribeBars` and `subscribeDepth` are optional.** A history-only feed omits them so callers can feature-detect (`if (feed.subscribeBars)`). `OpenAlgoDataFeed` deliberately does not implement `subscribeBars`; `OpenAlgoLiveDataFeed` implements both.

Supporting types: `MarketDepth { bids: DepthLevel[]; asks: DepthLevel[]; ltp: number; ltq?: number }`, `DepthLevel { price, qty, orders? }` — variable depth, whatever the broker streams. `UnsubscribeFn = () => void`.

`TradeFeed` is the separate, higher-level broker abstraction (`placeOrder` / `modifyOrder` / `cancelOrder` / `subscribeOrders` / `subscribePositions`, taking `PlaceOrder`). The trade tier's `OrderEngine` does **not** use it — it uses the smaller `OrderFeed` (`place` / `modify` / `cancel`) from `openalgo-charts/trade`, which is what `OpenAlgoTradeFeed` implements. See [trading](trading.md).

**Verify every OpenAlgo wire field against your running OpenAlgo build.** The adapters below encode the documented REST paths and WS message shapes, and the parsers are deliberately tolerant, but field names have moved between OpenAlgo releases. Pin them for your deployment before production.

## OpenAlgoDataFeed — REST history

```ts
import { OpenAlgoDataFeed } from 'openalgo-charts';

const feed = new OpenAlgoDataFeed({
  baseUrl: 'http://127.0.0.1:5000',
  apiKey: 'YOUR_KEY',
  fetchImpl: undefined,   // optional; defaults to a bound global fetch
});

const bars = await feed.getBars({
  symbol: 'RELIANCE', exchange: 'NSE', interval: '1m',
  from: nowSec - 7 * 86400, to: nowSec,
});
```

- `POST ${baseUrl}/api/v1/history` with `{ apikey, symbol, exchange, interval, start_date, end_date }`.
- **`from` and `to` are mandatory.** `getBars` throws without them: OpenAlgo history requires a date range. They are UTC seconds; the adapter converts to IST `YYYY-MM-DD` via `utcSecondsToIstDateString`. That is the OpenAlgo server's own convention, not the chart's display zone: `chart.setTimezone(...)` does not change what date this adapter asks for, so widen the range by a day rather than assuming the two agree.
- A non-OK response throws `history request failed (<status>)`.
- `fetchImpl` is injectable so the adapter is unit-testable offline. The default binds global `fetch` to `globalThis` (an unbound `window.fetch` throws "Illegal invocation").

Two pure helpers are exported for reuse and testing:

- `mapHistoryResponse(json)` — reads `json.data[]`, accepts either `timestamp` or `time` on each row, skips rows with neither, returns bars sorted ascending.
- `rowTimeToUtcSeconds(value)` — tolerant timestamp coercion:

| Input | Result |
|---|---|
| `number > 1e12` | treated as epoch **ms** |
| other `number` | `Math.floor(value)` (epoch seconds) |
| numeric-looking string with no `-`, `T`, `:` or space | same numeric rules |
| anything else | `istStringToUtcSeconds(value)` — IST wall-clock parse |

## OpenAlgoWsFeed — realtime

```ts
import { OpenAlgoWsFeed } from 'openalgo-charts';

const ws = new OpenAlgoWsFeed({
  url: 'ws://127.0.0.1:8765',
  apiKey: 'YOUR_KEY',
  reconnect: { enabled: true, baseDelayMs: 1000, maxDelayMs: 30000, maxAttempts: Infinity },
  socketFactory: undefined,   // optional
});

ws.connect();
const off = ws.onLtp((e) => { /* e: { symbol, exchange, ltp, ltq?, volume?, timeSec } */ });
ws.subscribe('LTP', 'RELIANCE', 'NSE');
```

Modes: `WsMode = 'LTP' | 'Quote' | 'Depth'`, sent as numeric `1 | 2 | 3`.

Wire format (pure formatters, exported where noted):

| Step | Frame |
|---|---|
| auth (sent automatically on open, before anything else) | `{ action: 'authenticate', api_key }` |
| subscribe (`formatSubscribe`) | `{ action: 'subscribe', symbol, exchange, mode }`, plus `depth_level` for `Depth` |
| unsubscribe (`formatUnsubscribe`) | `{ action: 'unsubscribe', symbol, exchange, mode }` |
| order stream | `{ action: 'subscribe_orders' }` / `{ action: 'unsubscribe_orders' }` |
| heartbeat | inbound `'ping'` or `{ type: 'ping' }` -> replies `{ action: 'pong' }` |
| inbound data | `{ type: 'market_data', mode, topic, data: { ... } }` |

`parseMessage(raw)` (exported) normalizes inbound frames. It reads payload fields from `data` but tolerates a flat shape, accepts `ltp` or `last_price`, `ltq` or `last_trade_quantity`, maps `depth.buy`/`depth.sell` (`{ price, quantity, orders? }`) into `MarketDepth.bids`/`asks`, and coerces `timestamp` from epoch s, epoch ms, or ISO-8601. Anything it cannot classify returns `null` and is surfaced to `onControl` instead.

Callbacks, each returning its own unsubscribe: `onLtp`, `onDepth((symbol, exchange, depth) => {})`, `onState((s: WsState) => {})` with `'connecting' | 'open' | 'closed' | 'error' | 'reconnecting'`, `onControl` for auth/subscribe acks and server errors, `onOrderUpdate` for the account-level order stream.

Reconnect and resubscribe:

- Enabled by default. On an unexpected close the feed backs off `min(maxDelayMs, baseDelayMs * 2^attempt)`, reconnects, re-authenticates, then replays **every** active subscription plus the order stream if it was on.
- A successful open resets the attempt counter.
- `close()` sets an intentional-close flag and never reconnects; it also clears the pending send queue.
- Sends before the socket is open are queued and flushed after authentication, so `subscribe()` immediately after `connect()` is safe.
- `socketFactory: (url) => SocketLike` injects a socket for tests, React Native, or any non-browser runtime. `SocketLike` needs `send`, `close`, `onopen`, `onclose`, `onmessage`, optionally `onerror` and `readyState` (`1` means open; a factory that connects synchronously is handled).

## OpenAlgoLiveDataFeed — REST + WS + CandleBuilder

The composed feed that actually satisfies the full `DataFeed` contract.

```ts
import { OpenAlgoLiveDataFeed } from 'openalgo-charts';

const live = new OpenAlgoLiveDataFeed({
  baseUrl: 'http://127.0.0.1:5000',
  wsUrl: 'ws://127.0.0.1:8765',
  apiKey: 'YOUR_KEY',
  volumeMode: 'ltq-sum',   // default
});

const req = { symbol: 'RELIANCE', exchange: 'NSE', interval: '1m', from, to };
const bars = await live.getBars(req);
series.setData(bars);

const off = live.subscribeBars(req, (bar) => series.update(bar), {
  seedFrom: bars[bars.length - 1],
  cumDayVolumeSoFar: undefined,   // only meaningful for volumeMode: 'day-delta'
});
// later: off(); live.close();
```

- The constructor connects the socket immediately.
- `subscribeBars` creates a **per-subscription** `CandleBuilder` sized by `intervalToSeconds(req.interval)`, filters WS ticks by symbol **and** exchange, and forwards `builder.onTick(...).bar` to `onBar`. Unsubscribing detaches the callback and sends the WS unsubscribe.
- `opts.seedFrom` seeds the builder with the last history bar so the first tick continues that bucket. `opts.cumDayVolumeSoFar` gives a `day-delta` builder the right baseline.
- A tick with no usable timestamp (`timeSec` absent or `<= 0`) is bucketed at `Date.now()`, never at the epoch.
- `subscribeDepth` subscribes `Depth` and filters the same way.

`intervalToSeconds(interval)` matches `/^(\d*)\s*([smhdw])$/i`, so both `D` and `1D` give `86400`, `W`/`1W` give `604800`, `1s`->1, `5m`->300, `4h`->14400.

**`intervalToSeconds` falls back to 60 for anything it cannot parse — including `'M'` (monthly).** A monthly chart wired through this feed buckets live ticks into 1-minute bars. Build the bucket size yourself for intervals outside `s/m/h/d/w`.

## CandleBuilder

`src/feed/candle-builder.ts`. Pure and deterministic (no `Date`, no rAF), so it unit-tests exactly.

| Option | Default | Meaning |
|---|---|---|
| `intervalSec` | `60` | Bucket size. |
| `volumeMode` | `'ltq-sum'` | `'ltq-sum'` accumulates `tick.ltq`; `'day-delta'` diffs `tick.cumDayVolume`. |
| `lateTickPolicy` | `'foldIntoBar'` | `'foldIntoBar'` merges a tick older than the current bar into it; `'dropOlderThanPrevBar'` returns `null`. |
| `sessionAnchorSec` | `0` | Bucket alignment origin, in UTC seconds. |

`onTick(tick)` returns `{ bar, isNew } | null` — `null` only under `'dropOlderThanPrevBar'`. `isNew` is true on the first tick of a bucket, so a host can append rather than replace. `bucketStart(t) = anchor + floor((t - anchor) / intervalSec) * intervalSec`. `current()` returns a copy of the forming bar.

`'day-delta'` handles the daily reset: when the incoming cumulative drops below the last one, the new bar starts from 0; otherwise it carries from the previous bar's closing cumulative.

**Seed the builder from the last history bar, and seed it again after every reconnect.** History normally ends *inside* the forming bucket. An unseeded builder opens a fresh bar for that same bucket at whatever tick arrived first — wrong open, volume restarted at zero, and (if you also keep your own array) a duplicate entry for that time. `seed(lastBar, cumDayVolumeSoFar?)` is the fix; the optional second argument sets the `day-delta` baseline to `cumDayVolumeSoFar - (lastBar.volume ?? 0)`.

**Set `sessionAnchorSec` for any interval that does not divide the trading day evenly.** The default anchors buckets to the epoch, so 5-minute bars start at :00/:05 rather than at the session open: 09:15 in Mumbai, 09:30 in New York. The anchor is UTC seconds and knows nothing about the chart's `timezone`, so compute it from the session open you actually want. `zonedWallClockToUtcSeconds(y, m, d, 9, 30, 0, 'America/New_York')` resolves one on a changeover day without an offset table.

```ts
import { CandleBuilder } from 'openalgo-charts';

const builder = new CandleBuilder({ intervalSec: 300, volumeMode: 'ltq-sum', sessionAnchorSec: sessionOpenUtc });
builder.seed(bars[bars.length - 1]);

ws.onLtp((e) => {
  const u = builder.onTick({ time: e.timeSec, price: e.ltp, ltq: e.ltq, cumDayVolume: e.volume });
  if (u !== null) series.update(u.bar);
});
ws.subscribe('LTP', 'RELIANCE', 'NSE');
```

## OpenAlgoTradeFeed

`src/feed/openalgo-trade.ts` implements the trade tier's `OrderFeed` over OpenAlgo REST.

```ts
import { OpenAlgoTradeFeed } from 'openalgo-charts';

const trade = new OpenAlgoTradeFeed({
  baseUrl: 'http://127.0.0.1:5000',
  apiKey: 'YOUR_KEY',
  strategy: 'openalgo-charts',   // default
  defaultProduct: 'MIS',         // default; 'CNC' | 'NRML' | 'MIS'
});
```

| Method | Endpoint |
|---|---|
| `place(req)` | `POST /api/v1/placeorder` -> `{ orderId }` (reads `orderid` or `order_id`) |
| `modify(orderId, patch)` | `POST /api/v1/modifyorder` |
| `cancel(orderId)` | `POST /api/v1/cancelorder` |
| `getOrders()` | `POST /api/v1/orderbook` -> `Order[]` |
| `getPositions()` | `POST /api/v1/positionbook` -> `Position[]` |

Every request sends `apikey` in the body. Non-OK responses surface OpenAlgo's own `message` text (RMS rules, square-off windows) rather than a bare status code.

**`modify` requires the full order context, so it throws for an order this feed has never seen.** OpenAlgo's `modifyorder` needs symbol/action/exchange/pricetype/product/quantity, not just the delta. The feed caches that context on `place` and on `getOrders`; modifying an order placed elsewhere means calling `getOrders()` first.

`mapOrder` / `mapPosition` (exported) coerce OpenAlgo's string-or-number fields and map `order_status` into the chart's vocabulary (`open`/`trigger pending` -> `working`, `pending` -> `pending`, `complete` -> `filled`, `cancelled`, `rejected`, default `working`). A `trigger_price` of 0 is normalized to `undefined` so an order line does not render at zero.

## Writing a custom DataFeed

Complete and sufficient — history plus live bars, no library internals:

```ts
import type { Bar, BarsRequest, DataFeed, UnsubscribeFn } from 'openalgo-charts';

export class MyFeed implements DataFeed {
  async getBars(req: BarsRequest): Promise<Bar[]> {
    const rows = await myApi.candles(req.symbol, req.interval, req.from, req.to);
    return rows
      .map((r) => ({ time: Math.floor(r.epochMs / 1000), open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v }))
      .sort((a, b) => a.time - b.time);
  }

  subscribeBars(req: BarsRequest, onBar: (bar: Bar) => void): UnsubscribeFn {
    const sub = myApi.stream(req.symbol, (msg) => {
      onBar({ time: Math.floor(msg.bucketMs / 1000), open: msg.o, high: msg.h, low: msg.l, close: msg.c, volume: msg.v });
    });
    return () => sub.cancel();
  }
}
```

Rules for any adapter: convert to UTC seconds at the edge, sort ascending, keep one bar per time, and omit `subscribeBars` entirely rather than shipping a no-op — callers feature-detect it. If your source pushes ticks rather than bars, compose a `CandleBuilder` inside `subscribeBars` the way `OpenAlgoLiveDataFeed` does.

## FakeDataFeed and generateBars

Deterministic, network-free, seeded xorshift32 — safe for pixel-diff tests.

```ts
import { FakeDataFeed, generateBars } from 'openalgo-charts';

const bars = generateBars(1700000000, 500, 3600);   // startTime, count, intervalSec
series.setData(bars);

const feed = new FakeDataFeed(60);                  // intervalSec, optional scheduler
const off = feed.subscribeBars({ symbol: 'X', exchange: 'NSE', interval: '1m' }, onBar, { tickMs: 500 });
```

- `getBars` returns 500 bars from `req.from ?? 1_700_000_000`.
- `subscribeBars` genuinely streams (default a 1s `setInterval`), so feature detection stays honest. Pass a `FeedScheduler` `(cb, ms) => UnsubscribeFn` to drive it by hand in tests.
- `generateBars` uses no global randomness and no `Date.now()`, so output is identical across runs.

## Related

- [data-and-time](data-and-time.md): `Bar`, UTC seconds, `update` vs `prependData`, tick bars, the chart timezone and the time helpers.
- [events-and-state](events-and-state.md) — `lazy-load` and the rest of the event bus.
- [trading](trading.md) / [trade-tier](trade-tier.md) — `OrderFeed`, `OrderEngine`, on-chart order lines.
- [pitfalls](pitfalls.md).
