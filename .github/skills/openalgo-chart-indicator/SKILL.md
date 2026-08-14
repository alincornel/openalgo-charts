---
name: openalgo-chart-indicator
description: Add a built-in openalgo-charts indicator, restyle it, build a settings UI from its descriptor, or author a custom indicator with registerIndicator or the Tier-2 external-data contract. Use when the user asks to add RSI/MACD/Bollinger/Supertrend or any indicator, change indicator colors or periods, or write their own indicator.
argument-hint: "[indicator-id] [pane]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

Add or author an indicator. Read [indicators](../openalgo-charts/references/indicators.md) for the full built-in catalogue with exact ids, inputs and defaults before writing code - do not guess an id.

## Arguments

- `$0` = indicator id, or a plain-language name to resolve to an id.
- `$1` = target pane. Default: whatever the descriptor's `placement` says.

## Step 0 - the tier must be imported

```ts
import 'openalgo-charts/indicators';   // side effect: registers the 18 built-ins
```

Without it `chart.addIndicator` throws. Add this import once, at the app entry, not in every module. Verify it is present before adding an indicator:

```sh
rg -n "openalgo-charts/indicators" src app
```

## Path A - add a built-in

```ts
chart.addIndicator('bollinger');                            // overlays the price pane
const macd = chart.addIndicator('macd', { fastPeriod: 8 }); // gets its own pane
```

Resolve the id against the source, not from memory:

```sh
rg -n "id: '" node_modules/openalgo-charts/dist/indicators/index.d.ts src/indicators/*.ts
```

If the user names an indicator that has no built-in descriptor, say so plainly and go to Path C rather than substituting a different indicator.

## Path B - restyle an existing instance

Every plot gets colour, opacity, thickness, line style and plot style for free, generated from the descriptor. The keys are `<plotKey>:opacity`, `:width`, `:lineStyle`, `:type`.

**Colour is the exception.** The colour key is `plot.colorKey` when the descriptor declares one, and `<plotKey>:color` only when it does not. **Every built-in declares one**, so `'macd:color'` is silently ignored while `'macdColor'` works. Resolve the real key with `plotStyleKeys(plot)` rather than composing it by hand.

```ts
macd.setSettings({ 'macd:width': 2, 'macd:lineStyle': 'dashed', macdColor: '#26a69a' });
```

To build a settings dialog, generate it from the descriptor rather than hand-writing a form. The descriptor's own `inputs` are the parameters tab; `indicatorStyleInputs(descriptor)` gives the style tab. The chart emits `indicatorSettings` when the user clicks the gear on a pane legend - that event is the hook to open your dialog. The library ships no dialog.

## Path C - author a custom indicator

Use `registerIndicator` when the value is computed from the chart's own OHLCV. A descriptor is data: id, name, placement, inputs, plots, optional levels, and a pure `calc`. Each plot names a registered **chart type**, so you write no drawing code.

```ts
import { registerIndicator, sourceValues } from 'openalgo-charts';

registerIndicator({
  id: 'my-ma',
  name: 'My MA',
  placement: 'onchart',
  inputs: [{ key: 'length', type: 'number', label: 'Length', default: 20 }],
  plots: [{ key: 'ma', title: 'MA', type: 'line', style: { lineWidth: 1.5 } }],
  calc(bars, settings) { /* return { ma: (number | null)[] } aligned to bars */ },
});
```

Confirm the exact `IndicatorDescriptor` field names and the `calc` return shape against `dist/index.d.ts` before writing - the reference file documents them, but the typings are authoritative.

## Path D - Tier-2, data not derived from OHLCV

Open interest, cumulative volume delta, PCR, any external analytics feed. Use `createTier2Indicator`, which wraps a fetch/subscribe lifecycle into an ordinary descriptor so panes, settings, levels and removal all work identically.

```ts
import { createTier2Indicator } from 'openalgo-charts/indicators';
```

The alignment rule matters and is not negotiable: each bar takes the most recent external point **at or before** that bar's time. Never interpolated, never forward-looking. Bars before the first point are `null`.

## Rules

1. **Never invent an indicator id or input key.** Resolve both from source.
2. **Placement is the descriptor's decision.** Only override `paneIndex` when the user explicitly wants it elsewhere.
3. **`calc` runs on every data change.** Keep it O(n) and allocation-light; do not fetch inside it.
4. **Removing an indicator prunes its pane** if that leaves the pane empty. Do not also remove the pane yourself.
5. **Indicator plots are not the price series.** They never drive the magnet crosshair or the last-price line.
6. No emojis or icons in code, labels, or log output.

## Verify

```sh
npx tsc --noEmit
```

Then confirm on a live chart that the plot appears in the expected pane, the legend shows a reading, and changing a setting repaints. Report the id used, the pane it landed in, and the settings keys you exposed.
