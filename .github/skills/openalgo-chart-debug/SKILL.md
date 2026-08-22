---
name: openalgo-chart-debug
description: Diagnose an openalgo-charts problem - blank or invisible chart, bars in the wrong place, unknown series type or indicator errors, misaligned indicators, drawings that drift, a chart that will not repaint or resize, live ticks not appearing, or a broken bundle import. Use when a chart is not behaving as expected.
argument-hint: "[symptom]"
allowed-tools: Read, Bash, Glob, Grep
---

Diagnose before changing anything. Most openalgo-charts bugs are one of a small set of known causes, and guessing at a fix usually adds a second bug on top of the first.

## Step 1 - ground yourself in the actual install

```sh
node -p "require('./node_modules/openalgo-charts/package.json').version" 2>/dev/null || echo "not a consumer app"
rg -n "from 'openalgo-charts" src app --glob '!node_modules'
```

You need the version and the exact set of tier imports before you can reason about anything. Never diagnose from memory of the API.

## Step 2 - match the symptom

| Symptom | First suspect | Confirm |
|---|---|---|
| Nothing renders, no error | container has zero height | inspect the element's computed height |
| Nothing renders after `setData` | data is empty, or times are not numbers | log `series.getData().length` and the first item |
| Bars bunched at the far left or right | `time` is in milliseconds | a value above 1e12 is milliseconds |
| Bars overlap or a candle draws twice | two bars share a time | times must be unique and ascending per series |
| Axis and crosshair show the wrong hours | the chart is on its default zone, `Asia/Kolkata` | `chart.timezone()`; set `timezone` or call `setTimezone` |
| VWAP restarts mid-afternoon, or a pivot frame spans two sessions | the chart's zone is not the instrument's | `chart.timezone()`; a `timeFormatter` relabels but does not move the calendar |
| `unknown series type "kagi"` | transform tier not imported | `rg "openalgo-charts/transform"` |
| `addIndicator` throws | indicators tier not imported | `rg "openalgo-charts/indicators"` |
| A tier is imported but its feature is missing | deep import created a second registry | check for any path containing `/dist/` or `/src/` in an import |
| Indicator plots misaligned with price | indicator on a different data set, or bar times differ | compare the first and last bar times |
| Series fills or is squashed into part of the pane | price-scale margins | margins are fractions of pane height, not data span |
| A volume overlay swallows the price series | overlay scale margins | `priceScaleId: ''` plus `marginTop` |
| Drawings drift after zoom or a session gap | anchors stored in pixels | anchors must be `{ time, price }` |
| A drawing shortcut does nothing | the library installs no key listener | the host must call `matchDrawingShortcut` |
| Chart does not resize | no `ResizeObserver`, or container is not measurable | call `chart.applySize(w, h)` manually |
| Custom primitive is blurry or offset | media px not multiplied by `dpr` | inspect the `draw` implementation |
| Live ticks never appear | subscription filter, or the builder was never seeded | log inside the tick handler before the builder |
| Live candle duplicates the last history bar | builder started unseeded | pass `seedFrom: lastHistoryBar` |
| Chart snaps to the right edge on every update | `setData` called per tick | use `series.update(bar)` |
| Viewport jumps when older history loads | re-fitting after prepend | `prependData` preserves the window; do not `fitContent` |
| Orders do not reach the broker | wrong layer | `chart.trading` is visualization only |
| Blank page in Next.js or SSR | chart created during server render | client-only component, create in an effect |
| Bare specifier fails in the browser | no bundler resolution | standalone build or an import map |

[pitfalls](../openalgo-charts/references/pitfalls.md) has the full verified list with the reason behind each.

## Step 3 - read the console

The library throws named errors that identify the cause precisely rather than failing silently. Quote the exact message back to the user; it usually names the missing tier or the unknown id. Do not paraphrase it.

## Step 4 - narrow with the smallest possible repro

Strip to a chart, one series, and static bars. If that renders, add back one thing at a time. This resolves ambiguous cases faster than reading more of the host's code.

```ts
import { createChart, generateBars } from 'openalgo-charts';
const chart = createChart(el);
chart.addSeries('candlestick').setData(generateBars(1700000000, 200, 3600));
chart.fitContent();
```

If `generateBars` renders and the user's data does not, the bug is in the data, not the chart.

## Step 5 - report

State the cause, the evidence you have for it, and the one-line fix. If you could not reproduce or could not confirm the cause, say so rather than offering a speculative fix - a wrong fix to a charting bug is expensive to unwind.

Do not apply changes unless the user asked you to fix it, not just diagnose it.
