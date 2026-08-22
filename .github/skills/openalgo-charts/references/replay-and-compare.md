# Replay and comparison

*When to read this: building a market-replay transport bar, or putting a second instrument on the chart to read against the primary one.*

Source of truth: `src/replay/controller.ts`, `src/compare/controller.ts`, `src/compare/align.ts`. Both ship in the **base** bundle, so neither needs a tier import.

Both are headless in the same sense as `DrawingController`: they own state and transitions and draw no DOM. The transport bar and the symbol chips are the host's UI.

## Market replay

```ts
import { ReplayController, type ReplayState } from 'openalgo-charts';

const replay = new ReplayController(chart, { bars: session, startIndex: 200, barMs: 500 });
chart.on('replay:frame', (p) => renderTransport(p as ReplayState));
replay.play({ speed: 2 });
```

**Constructing the controller enters replay.** It snapshots each driven series' data plus `barSpacing` and `rightOffset`, then shows `startIndex` immediately. The snapshot is taken before anything moves, which is what lets `stop()` put the user back exactly where they were.

### ReplayOptions

| Key | Type | Default | Notes |
|---|---|---|---|
| `series` | `SeriesApi \| readonly SeriesApi[]` | `chart.primarySeries()` | The **first** owns the timeline. Omitting it throws when the chart has no primary series. |
| `bars` | `readonly Bar[]` | the primary series' current data | The full session. Never mutated; each frame gets its own slice. |
| `startIndex` | `number` | `0` | Clamped into the session. |
| `barMs` | `number` | `1000` | Wall-clock ms per bar at speed 1. |
| `speed` | `number` | `1` | Multiplier over `barMs`. |
| `onFrame` | `(state: ReplayState) => void` | none | Called after the chart is updated, alongside the event. |
| `now` | `() => number` | `performance.now` | Injectable clock. |
| `scheduler` | `(cb, ms) => () => void` | `setInterval` | Injectable timer; returns its canceller. |

### Transport

| Member | Signature | Notes |
|---|---|---|
| `seek` | `(index: number) => void` | Clamps to the session. |
| `step` | `(n = 1) => void` | Stops dead at the last bar. |
| `stepBack` | `(n = 1) => void` | Stops dead at the first bar. |
| `play` | `({ speed? }) => void` | Re-speeds a running replay. On the last bar it emits `replay:end` and arms no timer. |
| `pause` | `() => void` | Leaves the playhead where it is. |
| `stop` | `() => void` | Restores data **and** viewport. Safe twice; a later `seek`/`step`/`play` re-enters from `startIndex`. |
| `state` | `() => ReplayState` | `{ index, total, playing, speed, bar }`: everything a transport bar and a clock need. |

Events on the chart bus, all carrying a `ReplayState`: `replay:start` (first frame only), `replay:frame`, `replay:play`, `replay:pause`, `replay:end`, `replay:stop`.

### Why indicators come free

Every transition funnels through one private `_apply(index)` that hands the driven series a **prefix** of `bars` through the public `series.setData`. That is already the path that calls `_recomputeIndicators`, and `IndicatorInstance.recompute` re-reads the whole history from `sourceBars()`, so each plot, level, fill, marker and legend row rebuilds itself as it stood at that bar. There is no replay-aware code in the indicator tier, and none is needed.

`dataLayer.length` shrinks with the prefix, so an indicator's own plot series cannot hold the shared time axis open at future bars.

### Gotchas

- **Pass every series that shares the timeline** (volume histogram, a comparison line) in `options.series`. The DataLayer merges all series onto one axis, so one left at full length drags future timestamps back onto it. The extras are cut by **time**, not by count.
- **Replay drives series, not the feed.** A live feed still calling `series.update()` fights the playhead. Detach it for the duration.
- **Speed is derived from the clock, not the tick count**, so a throttled timer still plays at the requested rate. One tick consumes at most 10 bars, so a backgrounded tab does not fast-forward the session when it wakes.
- `stop()` restores `barSpacing` and `rightOffset` together with the data. Those two plus the restored `baseIndex` *are* the visible logical range, which is why the view returns to the pixel.

## Symbol comparison

```ts
import { addComparison, comparisonController } from 'openalgo-charts';

const bn = addComparison(chart, { symbol: 'BANKNIFTY', bars, color: '#f0a020' });
bn.alignment();                                   // { bars, matched, gaps, dropped }
comparisonController(chart).setMode('indexed-to-100');
bn.remove();
```

`addComparison(chart, options)` is the free-function front door; `comparisonController(chart, options?)` returns the one controller per chart (held in a `WeakMap`) for chart-wide operations. **A primary series must exist first** or `add` throws.

### ComparisonOptions and the handle

| Key | Type | Default | Notes |
|---|---|---|---|
| `symbol` | `string` | required | Label only; carried on the handle for the host's UI. |
| `bars` | `readonly SeriesDataItem[]` | required | The instrument's own prices, aligned on the way in. |
| `color` | `string` | none | Shorthand; `style.color` wins if both are given. |
| `style` | `SeriesStyle` | `{}` | Merged over the chart type's defaults. |
| `type` | `SeriesType` | `'line'` | Any registered series type. |
| `paneIndex` | `number` | `0` | The price pane by default. |

`ComparisonHandle`: `symbol`, `series`, `paneIndex`, `priceScale()`, `alignment()`, `setBars(bars)`, `remove()`, `list()`.

`ComparisonController`: `add(options)`, `remove(handle)`, `list()`, `clear()`, `setMode(mode)`, `mode`, `realign()`, `sync()`, `destroy()`. `ComparisonMode` is `'percentage'` (default), `'indexed-to-100'` or `'none'`.

### How the two lines become comparable

1. **The comparison never touches the primary's axis.** It goes on the pane's hidden overlay scale (`priceScaleId: ''`), which autoscales alone and draws no ticks, so a 46,000 instrument cannot compress a 22,000 one's candles.
2. **Comparability comes from the scale, not the data.** Bars stay the instrument's real prices, so the legend and crosshair still read in prices; the pane switches to `percentage` or `indexed-to-100` while a comparison is on it.
3. **A per-frame pass mirrors the range**, giving the overlay the primary's range scaled by `baselineOverlay / baselinePrimary`, so equal ratios land on equal pixels. Without it each scale autoscales to its own data and a 1% mover looks exactly like a 10% mover.

The hook is a `bottom` z-order primitive that paints nothing, because that is the only window between the pane's autoscale pass (where a rebasing scale gets its baseline) and the series draw. It also does an O(1) `dataLayer.length` check and re-aligns when the shared axis moves underneath (live bars, history paging, replay).

### Alignment (`alignToPrimary`)

Matching is on the **exact** timestamp; two instruments on the same interval agree to the second, and anything that does not agree is a different interval that no tolerance window could rescue.

| Direction of mismatch | Answer | Why |
|---|---|---|
| Comparison print with no primary bar | **dropped**, counted in `alignment().dropped` | The DataLayer merges every series' times into one index space, so a foreign time would mint a logical index and shift the primary's own bars. |
| Primary bar with no comparison print | **whitespace** (a NaN bar), counted in `gaps` | The line renderer breaks across it, so a holiday reads as a gap instead of a flat carry-forward or a straight line drawn through it. |

`ComparisonAlignment` is `{ bars, matched, gaps, dropped }`, enough for a host to report coverage.

### Gotchas

- **A pane has exactly one hidden overlay scale**, so every comparison on a pane shares one baseline. Right for the common single comparison; a second one is quoted against the first instrument's price. Put further instruments on their own pane with `paneIndex`.
- **The volume histogram usually owns that overlay already.** When `priceScaleId: ''` is taken the comparison falls back to the **left** axis rather than autoscaling price and volume together.
- **Use the handle, not the series, for data and teardown.** `series.setData` skips alignment; `series.remove()` leaves the pane rebased with nothing on it.
- **A user's own mode change is respected.** The pane's saved mode is only restored if it is still the one the controller applied, so switching the pane to log while comparing keeps that choice.
- `realign()` is only needed by hand after replacing the primary's data with a *different* set of the same length, which the O(1) length check cannot see.

## Related

- [scales-and-panes](scales-and-panes.md): `percentage` / `indexed-to-100`, baselines, overlay scales.
- [events-and-state](events-and-state.md): the `replay:*` payloads on the bus.
- [data-and-time](data-and-time.md): the shared logical index the alignment rules protect.
- [indicators](indicators.md): the recompute path replay leans on.
