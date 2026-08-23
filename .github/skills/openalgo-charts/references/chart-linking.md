# Chart linking

*When to read this: driving a grid of charts as one workspace, so hovering, panning or changing the symbol on one moves the others.*

Source of truth: `src/link/group.ts`, `src/link/align.ts`, `src/link/crosshair.ts`. Ships in the **base** bundle, so there is no tier import: `import { createLinkGroup } from 'openalgo-charts'`.

Headless in the same sense as `ReplayController` and `DrawingController`. The group owns the sync; the link badge, the colour chips and the menu of switches are the host's UI.

```ts
import { createLinkGroup } from 'openalgo-charts';

const group = createLinkGroup({ crosshair: true, viewport: true, symbol: false });
group.add(daily);
group.add(hourly, { symbol: 'RELIANCE', onSymbol: (s, chart) => loadBars(s, chart) });
```

## The rule that matters: sync by instant, never by index

**Never copy a logical index or a logical range from one chart to another.** This is the single thing an agent implements wrong here, and the wrong version passes every hand test.

The x axis is a **gapless logical index over that chart's own bars** (`0..N-1`, one index per distinct bar time), not a timestamp axis. Two linked charts almost never hold the same bars: different symbols, different intervals, different history depth, different holidays, different halts. So logical index 300 is a different instant on every chart in the grid.

Copying the index across looks perfect on two charts of the same symbol and the same interval, which is exactly how the broken version ships. The correct conversion is always three steps:

```
index  --indexToTimeFloat-->  UTC seconds  --timeToIndex(Float)-->  index
        (on the SENDER's DataLayer)          (on the RECEIVER's DataLayer)
```

`LinkGroup` does this for you. If you are writing your own sync (a chart in a grid the group does not own, a linked drawing, a shared bar highlight), do the same two conversions or the daily chart will mark a bar three weeks away from the hourly chart's cursor.

The two conversions are pure and exported, so you can use them directly:

| Function | Signature | Returns |
|---|---|---|
| `followerIndex` | `(follower: LinkDataLayer, time: number, whenMissing?: LinkMissingPolicy) => number \| null` | An **integer** index on the follower, or `null` for "draw nothing". |
| `followerRange` | `(leader: LinkDataLayer, follower: LinkDataLayer, range: LogicalRange) => LogicalRange \| null` | The follower range showing the same wall-clock window, fractional at both ends. |

`LinkDataLayer` is the structural slice they read (`length`, `indexToTime`, `timeToIndex`, `indexToTimeFloat`, `timeToIndexFloat`). `chart.dataLayer` satisfies it, and so does a literal in a test.

### Coverage is an absence, not a gap

`followerIndex` answers `null` for any instant **before the follower's first bar or after its last one**, under both policies. That period is not a hole in its data, it is a period the chart does not cover at all, and snapping the crosshair to the first or last bar would assert an alignment that does not exist.

Inside the covered range with no bar at exactly that second, `whenMissing` decides:

| `whenMissing` | Behaviour |
|---|---|
| `'nearest'` (default) | Snap to the closest bar **in time**. Not the closest in index: the bars either side of a session break can be hours apart, so index distance is the wrong metric. |
| `'hide'` | Draw nothing unless there is a bar at exactly that time. For a workspace where a linked crosshair is a data claim. |

`followerRange` returns `null` rather than guessing when the answer would be meaningless: either layer empty, a follower with fewer than 2 bars (every time maps to index 0 and the span collapses), or a non-finite or inverted endpoint. A follower whose history does not overlap the window at all is **not** refused: `timeToIndexFloat` extrapolates at the edge bar spacing, so it scrolls into its own empty margin and shows nothing, which is the truth. Clamping it back onto its last bars would show a different period than the leader.

## `createLinkGroup(options)`

| Option | Type | Default | Notes |
|---|---|---|---|
| `crosshair` | `boolean` | `true` | Hovering one member marks the same instant on the others. |
| `viewport` | `boolean` | `true` | Panning or zooming one moves the others to the same wall-clock window. |
| `symbol` | `boolean` | `false` | Off by default: symbol sync needs host cooperation (see below). |
| `whenMissing` | `'nearest' \| 'hide'` | `'nearest'` | What a follower does with an instant it has no bar for. |

Each channel switches on its own because a user routinely wants one without the others: mirror the cursor across four timeframes but keep each zoom, or slave every chart's instrument but let each keep its own window.

## `LinkGroup`

| Member | Signature | Notes |
|---|---|---|
| `add` | `(chart: LinkChart, member?: LinkMemberOptions) => void` | Adding the same chart twice updates its member options instead of double-subscribing. A member joining a group that already has a symbol adopts it when symbol sync is on. |
| `remove` | `(chart: LinkChart) => void` | Unsubscribes and detaches that member's linked crosshairs. Safe twice, and after `destroy`. |
| `setOptions` | `(patch: LinkOptions) => void` | See the convergence note below. |
| `options` | `() => ResolvedLinkOptions` | Every option resolved, as a copy. |
| `members` | `() => readonly LinkChart[]` | Prunes destroyed members first, so the list is live. |
| `has` | `(chart: LinkChart) => boolean` | |
| `setSymbol` | `(chart: LinkChart, symbol: string) => void` | The imperative twin of emitting `'symbol'` on that chart's bus. |
| `symbol` | `() => string \| null` | The instrument the group has agreed on, `null` if nobody declared one. |
| `crosshairIndex` | `(chart: LinkChart) => number \| null` | That member's **own** logical index its linked crosshair is marking, or `null`. |
| `destroy` | `() => void` | No listeners, no linked crosshairs, no references. |

`crosshairIndex` is how a host builds a linked OHLC readout: take the index, then `chart.dataLayer.indexToTime(i)` and read that bar, exactly as a native crosshair readout does. Do not read the leader's bar and print it on the follower.

`setOptions` convergence, which is deliberate and asymmetric:

- Turning `crosshair` **off** clears the linked lines immediately, rather than leaving the last one frozen on every follower.
- Turning `symbol` **on** makes the group agree on the instrument it already knows, because a switch that only took effect on the *next* change would leave a linked grid visibly unlinked.
- Turning `viewport` on does nothing until the next pan or zoom. Nothing in the group says whose window the others should have adopted.

## Symbol sync is a partnership

**The engine has no instrument concept and linking does not invent one.** A `Chart` knows about bars, not about RELIANCE. So the host does two things:

1. **Reports a change**, by emitting `'symbol'` on that chart's own bus (`chart.emit('symbol', { symbol: 'INFY' })`, or a bare string) or by calling `group.setSymbol(chart, 'INFY')`.
2. **Performs a change**, through the per-member `onSymbol(symbol, chart)` callback, which fetches the bars and calls `series.setData`.

```ts
group.add(chart, {
  symbol: 'RELIANCE',                       // what it is showing right now
  onSymbol: async (sym, c) => {             // how to make it show something else
    const bars = await feed.getBars({ symbol: sym, exchange: 'NSE', interval: '5m' });
    seriesOf(c).setData(bars);
  },
});
```

A member with **no `onSymbol`** broadcasts its own changes but never follows anyone else's. That is the supported way to pin one chart of a grid, not a limitation to work around.

The change is recorded even with the switch off, so turning `symbol` on later converges on something current instead of a stale instrument.

## The linked crosshair

A follower's crosshair is a `LinkCrosshair` primitive, one **per pane** so it spans price, volume and indicator panes the way the native global crosshair does. Two deliberate differences from the native one:

- **Vertical line only.** The horizontal line marks a price, and the price under a cursor on another instrument is not a price on this one. On a grid of four symbols a mirrored price line is a straight lie four times over. The vertical line marks an instant, and an instant is shared.
- **Reduced opacity** (`LINK_CROSSHAIR_ALPHA`, 0.55) in the follower's own crosshair colour, so it reads as a reflection of a cursor somewhere else rather than a second cursor in this chart.

It sits on the `'top'` z-order, which is the layer `Pane.paintTop` repaints for a cursor move, so it costs the same overlay repaint the native crosshair does. The leader never draws one: it already has a real crosshair under the user's pointer, and a second line there would double it.

## Feedback loops and dead charts

**One group-wide re-entrancy guard**, not one per channel. Any member event arriving while the group is broadcasting is an echo of that broadcast by definition, since a human cannot pan two charts in one call stack. It is group-wide because a symbol change that reloads data can move a viewport, and that second-order echo is the same bug wearing a different hat.

Members are dropped the moment their chart dies. `chart.destroy()` sets `isDestroyed`, emits `'destroy'` and the group prunes on the spot; a `LinkChart` that is not a `Chart` and reports neither is probed by pane count instead (pane 0 can never be removed by any other route). This matters beyond tidiness: `addPrimitive` on a destroyed chart would resurrect a pane.

## What the group listens to

Everything comes off the chart's own event bus, so a host can drive it from anywhere:

| Event | Channel |
|---|---|
| `crosshair:move` | crosshair (reads `payload.time`; `null` clears) |
| `pan`, `zoom` | viewport |
| `symbol` | symbol (host-emitted; the core never emits it) |
| `destroy` | pruning |

Since 1.4.0 the programmatic viewport paths (`setVisibleLogicalRange`, `fitContent`, `resetScale`, and the keyboard pan/zoom shortcuts) also emit `'pan'` or `'zoom'`, so a linked grid follows an arrow key or a restored zoom and not only a gesture. They emit nothing when the window did not actually move, which is what keeps a clamped zoom or an already-fitted `fitContent` from re-broadcasting.

## Gotchas

- **Do not copy `getVisibleLogicalRange()` from one chart to another.** It is the exact bug this module exists to prevent. Use the group, or `followerRange`.
- **A fresh follower should not broadcast its own `fitContent`.** Loading bars into a newly opened chart and fitting them throws the leader off the window the user was on. Suspend viewport sync for the load (`setOptions({ viewport: false })`, load, restore) and let the two converge on the first pan.
- **`LinkChart` is structural, not `Chart`.** A stub with `on`, `getVisibleLogicalRange`, `setVisibleLogicalRange`, `dataLayer`, `panes`, `addPrimitive` and `removePrimitive` is a valid member, which is how the group is tested. `isDestroyed` is optional for that reason.
- **A linked crosshair is not the chart's crosshair.** `chart.subscribeCrosshairMove` still reports only the local pointer. Read `group.crosshairIndex(chart)` for the linked one.
- **Symbol sync does nothing on its own.** With no `onSymbol` on any member, turning the switch on changes nothing visible, because there is no code anywhere that loads bars.
