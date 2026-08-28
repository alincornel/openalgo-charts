# OpenAlgo Charts architecture diagram: update brief

Written 2026-08-28 against openalgo-charts 1.8.2.

> **Status: implemented in `d0eb679`.** The diagram was redrawn and now ships as
> `docs/architecture-diagram.svg`; the PNG is gone. This document is kept as the
> record of what was wrong, what the measured figures were, and why each change
> was made, so the next redraw starts from evidence rather than memory.

Build brief for the replacement of `docs/architecture-diagram.png` in
`openalgo-charts`, shown in `README.md` at 920 px wide.

Every number below is measured, not quoted. Sizes come from `npx size-limit` on
the current build; the indicator and tool counts come from the registry at
runtime (`registeredIndicators()`, `registeredDrawingTools()`). Where a figure is a budget rather than a measurement it says so.

---

## 1. The good news

**Keep the diagram.** The layered form is right, the dark treatment suits the
subject, and the left-hand rail plus the bundle-tier legend are both good ideas.
This is not a redraw from nothing. It is the same picture with the contents
brought up to 1.8.2, one row added, and three numbers corrected.

What follows is scoped accordingly: what is wrong, what is missing, and the
exact replacement text.

---

## 2. What is factually wrong

| The diagram says | Measured reality |
| --- | --- |
| `Dependency-free HTML5 Canvas Charting Engine - under 50 KB` | Base engine is **59.05 kB** Brotli against a 60 kB budget. The full package is **118.14 kB**. The under-50 claim has not been true for several releases |
| Bundle tiers: `base`, `/trade`, `/transform`, `/profile` | **Six** tiers. `/indicators` and `/draw` are missing, and they are the two largest after base |
| `Indicators: EMA / RSI / ATR / Supertrend` | **91 built-in indicators**, and they are their own loadable tier, not four names inside a drawables row |
| `Transforms: Renko / Heikin-Ashi / P&F` | Six: Renko, Range, Point and Figure, Kagi, Line-break, Heikin-Ashi |
| `Profiles: Volume / Market / Footprint` | Five: Volume Profile, TPO, Market Profile, Footprint, Orderflow |
| `IST to UTC time` | Full IANA timezone support. IST is the default, not the extent of it |

The size claim is the one that matters most. It is the headline, it is the first
thing a reader evaluates the library on, and it is wrong by 18 percent.

Note also that `ARCHITECTURE.md` section 2 still says *three loadable tiers* and
repeats the *under 50 KB* promise. The diagram inherited both. Worth fixing in
the same pass so the two do not disagree again.

### Measured sizes, all Brotli

| Tier | Measured | Budget |
| --- | --: | --: |
| Base engine | 59.05 kB | 60 kB |
| Base + trade | 66.66 kB | 68 kB |
| Indicator tier | 25.04 kB | 27 kB |
| Draw tier | 13.13 kB | 14 kB |
| Transform tier | 2.66 kB | 5 kB |
| Profile tier | 10.66 kB | 11 kB |
| Everything | 118.14 kB | 120 kB |

---

## 3. What is missing

**The draw tier.** Forty-three drawing tools with their own controller,
clipboard, hit-testing and persistence layer, at 13.13 kB. An entire product
surface with no representation on the page at all.

**The indicator descriptor system.** The diagram shows indicators as four
formula names. What actually ships is an extension contract: a descriptor
declares inputs, plots and a `calc`, and may additionally supply `markers`,
`draws`, `levels`, `background`, `barColors`, `fills`, `alerts`, `table`,
`calcTail` and an `attach` lifecycle. Third parties register their own through
`registerIndicator`, and `createTier2Indicator` covers indicators needing data
the chart does not hold. This is the library's main extension point and it is
invisible.

**The session controllers.** Replay, comparison, multi-chart link groups, the
draw controller and the shortcut manager. Five real subsystems, none shown.

**Tick-size awareness.** `PriceScaleOptions.minMove` carries the instrument tick
through to rounding and to indicator `calc` via the context. Added in 1.8.2 and
worth a mention in the model row.

---

## 4. The updated diagram

Keep the existing structure: title, subtitle, left rail, stacked layer rows with
a coloured label chip, bundle-tier legend bottom right. Change the contents as
below.

### Subtitle

Replace `Dependency-free HTML5 Canvas Charting Engine - under 50 KB` with:

```
Dependency-free HTML5 Canvas charting engine - 59 KB base, 118 KB everything
```

Two honest numbers read better than one round wrong one, and the gap between
them is itself the argument for the tier system.

### Rows, top to bottom

**PUBLIC API** (unchanged treatment, one addition)

```
createChart    addSeries    registerIndicator    subscribeCrosshairMove    takeScreenshot
```

`registerIndicator` earns its place next to `createChart`: it is how the library
gets extended, and the current row implies read-only consumption.

**RENDERING** (unchanged, it is still accurate)

```
Render loop (invalidation)    Panes: base + overlay canvas    Crosshair / Axes / Grid    Themes: light / dark
```

**DRAWABLES** (recomposed; the old row conflated four different things)

```
Chart types: candles / bars / line / area    91 built-in + custom indicators    43 drawing tools    Primitives: price lines / markers / events
```

**Custom indicators must be legible as a feature on the page**, not inferred
from an API name. Say `91 built-in + custom indicators` in the drawables row and
carry the point into the caption below the stack:

```
Custom indicators: any host can register its own with the same descriptor
contract the 91 built-ins use. No fork, no build step.
```

That last sentence is the differentiator against every charting library that
ships a fixed indicator list, and the current diagram gives it nothing.

**SHARED MODEL** (one addition)

```
DataLayer (gapless logical index)    Time scale (shared)    Price scale (per pane, tick-aware)    Transforms: Renko / Range / P&F / Kagi / Line-break / HA
```

**SESSION** (new row)

```
Replay    Compare    Link groups (multi-chart sync)    Shortcuts    Draw controller
```

Place it between SHARED MODEL and TRADE LAYER. Give it its own accent, distinct
from the teal used for rendering and model and from the red used for trade.

**TRADE LAYER** (unchanged, still accurate)

```
Order engine (state machine / OCO)    DOM ladder    Drag-to-modify chart trading
```

**FEEDS AND DATA** (one correction)

```
REST history    WebSocket live    Trade API    CandleBuilder: tick to OHLC    Timezone-aware (IANA, IST default)
```

**PROFILES**, currently squeezed into DRAWABLES, moves to its own short row or
joins the transform entry, listing all five: Volume Profile, TPO, Market
Profile, Footprint, Orderflow.

### Bundle tiers legend

The single highest-value fix on the page. Six chips, each with its measured
size, so a reader can price their own build:

```
base 59 KB    /indicators 25 KB    /draw 13 KB    /profile 11 KB    /trade 8 KB    /transform 3 KB
```

The `/trade` figure is the delta: 66.66 minus 59.05, rounded. Ordering by size
rather than alphabetically lets someone read down and stop when the budget runs
out, which is the actual question a reader brings to a tier legend.

### Left rail

Currently reads `OpenAlgo Platform`. That undersells a zero-dependency package
published to npm and usable in any host. Suggested: `Host application` as the
rail label, with `OpenAlgo Platform` as a named example beneath it. If the rail
stays single-purpose, at least note that the platform is one consumer rather
than the only one.

---

## 5. Style

The existing visual direction is working and should carry over: near-black
ground, rounded pill boxes, a single accent per layer, generous row spacing, no
icons. Keep it.

Three constraints for the update:

- **The new row must not crowd the stack.** Seven rows at 920 px is close to the
  limit. If it feels dense, drop PROFILES into the transform entry rather than
  giving it a row of its own.
- **Colour must stay meaningful.** Today teal marks rendering and model, red
  marks trade. The new session row needs its own hue, and the tier legend chips
  should match their tier colours rather than introducing a fourth scheme.
- **Keep the editable source.** The current PNG cannot be corrected without a
  redraw, which is part of why it drifted this far. Commit the source next to
  the export.

---

## 6. Checklist

- [ ] Subtitle reads 59 KB base, 118 KB everything. No "under 50 KB" anywhere.
- [ ] Six tier chips, each with its measured size.
- [ ] `/indicators` and `/draw` both present.
- [ ] Indicator count reads 91, stated as built-in **plus custom**.
- [ ] Custom-indicator caption present below the stack.
- [ ] Drawing tool count reads 43.
- [ ] Transforms list all six; profiles list all five.
- [ ] Session row present with replay, compare, link, shortcuts, draw.
- [ ] Timezone entry no longer says IST only.
- [ ] `registerIndicator` appears in the public API row.
- [ ] No icons, no emoji.
- [ ] Readable at 920 px.
- [ ] Editable source committed alongside the export.
- [ ] `ARCHITECTURE.md` section 2 corrected to six tiers, and its "under 50 KB"
      promise updated, so the prose and the picture agree.
- [ ] README size badge updated: it currently reads 53 KB / 111 KB, also stale.
- [ ] `.size-limit.json` draw-tier label corrected: it says 34 drawing tools, the
      registry reports 43.
