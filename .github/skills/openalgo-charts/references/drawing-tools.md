# Drawing Tools

*When to read this: you are adding chart annotations — trendlines, fibs, shapes, text — wiring a drawing toolbar, persisting drawings, or registering a custom tool.*

Source of truth: `src/draw/types.ts`, `src/draw/tools.ts`, `src/draw/controller.ts`, `src/draw/layer.ts`, `src/draw/geometry.ts`, `src/draw/index.ts`.

## Setup

```ts
import { createChart } from 'openalgo-charts';
import { DrawingController } from 'openalgo-charts/draw';

const chart = createChart(el);
chart.addSeries('candlestick').setData(bars);

const draw = new DrawingController(chart, { magnet: true });
draw.setTool('trend-line');   // the next two clicks place it
```

Importing `openalgo-charts/draw` calls `registerBuiltinDrawingTools()` as a side effect, registering all 43 tools into the base bundle's registry. No separate registration call is needed.

**The controller is headless: it ships no toolbar, no dialogs, no key listener.** It owns the model (`Drawing[]`), placement, selection, dragging, undo, and serialisation. Every button, flyout, colour picker, and text prompt is the host's.

`DrawingController` takes a structural `DrawingChartHost`, not the `Chart` class, so the chart from `createChart()` is accepted with no cast (`src/draw/controller.ts:33`).

## The model

```ts
interface Drawing {
  id: string;
  tool: string;              // a registered tool id
  points: DrawingPoint[];    // { time: UTC seconds, price: number }
  style: DrawingStyle;
  paneIndex: number;
  locked?: boolean;          // renders, but cannot be selected or dragged
  visible?: boolean;         // default true
}

interface DrawingStyle {
  color?: string; lineWidth?: number; lineStyle?: 'solid' | 'dashed' | 'dotted';
  fill?: boolean; fillColor?: string; fillOpacity?: number;      // default 0.12
  extendLeft?: boolean; extendRight?: boolean;
  showLabels?: boolean; levels?: number[];                        // fib fractions
  // text tools and shape labels
  text?: string; fontSize?: number; fontFamily?: string;
  fontWeight?: 'normal' | 'bold'; fontStyle?: 'normal' | 'italic'; fontColor?: string;
  background?: boolean; backgroundColor?: string; backgroundOpacity?: number; // default 1
  border?: boolean; borderColor?: string;
  wrap?: boolean; wrapWidth?: number;                             // default 220 media px
  textAlign?: 'left' | 'center' | 'right';
  textVAlign?: 'top' | 'middle' | 'bottom';
  textPosition?: 'inside' | 'outside';                            // shapes only
  accountSize?: number; risk?: number;                            // position tools
}
```

Unset `color` falls back to `theme.lineColor`, unset `lineWidth` to `1.5`. `color` strokes the outline; `fontColor` paints an attached label, so one shape carries two colours. `textPosition: 'outside'` parks the label above the shape and ignores `textVAlign`.

## Anchors are `{ time, price }`, never pixels

The time axis is gapless — weekends, holidays, and session breaks collapse — so a pixel anchor would slide the instant the viewport, interval, or dataset changed. Anchors resolve through `DataLayer.timeToIndexFloat`, which is *fractional*, and that has two consequences worth relying on:

- An anchor can sit **inside a collapsed gap** (a Saturday between Friday and Monday) and still map to a stable x.
- An anchor can sit **past the last bar**, which is where trend projections, `forecast`, and the position tools' targets live.

Drag deltas are computed in data space too (`p.time - start.from.time`), so translating a shape keeps it on the same bars.

## Tool catalogue

43 built-in tools. `Clicks` is what the user does; `Anchors` is what ends up in `drawing.points` (they differ only where `expand` is involved).

| Family | `id` | Clicks | Anchors | Shortcut |
|---|---|---|---|---|
| Lines | `trend-line` | 2 | 2 | `Alt+T` |
| Lines | `ray`, `extended-line`, `arrow` | 2 | 2 | |
| Lines | `horizontal-line`, `horizontal-ray`, `vertical-line`, `cross-line` | 1 | 1 | `Alt+H`, `Alt+J`, `Alt+V`, `Alt+C` |
| Shapes | `rectangle`, `ellipse`, `circle` | 2 | 2 | |
| Shapes | `triangle`, `rotated-rectangle` | 3 | 3 | |
| Paths | `path`, `polyline` | n, double-click to end | n | |
| Paths | `arc`, `curve`, `double-curve` | 3 | 3 | |
| Channels | `parallel-channel`, `fib-channel` | 3 | 3 | |
| Fibonacci | `fib-retracement`, `fib-time-zone`, `fib-fan` | 2 | 2 | |
| Fibonacci | `fib-extension` | 3 | 3 | |
| Gann | `gann-fan`, `gann-box` | 2 | 2 | |
| Cycles | `cyclic-lines`, `time-cycles`, `sine-line` | 2 | 2 | |
| Forecasting | `long-position`, `short-position` | 1 | 3 (via `expand`) | |
| Forecasting | `forecast` | 2 | 2 | |
| Measurers | `measure`, `price-range`, `date-range` | 2 | 2 | |
| Arrows | `arrow-up`, `arrow-down` | 1 | 1 | |
| Text / notes | `text`, `price-label`, `flag-mark` | 1 | 1 | |
| Text / notes | `callout` | 2 | 2 | |
| Brushes | `brush`, `highlighter` | press-drag-release | n samples | |

Those five are the only shortcuts. `registeredDrawingTools()` returns every descriptor (`id`, `name`, `points`, `shortcut`, `defaultStyle`); `BUILTIN_DRAWING_TOOLS` is the same list in toolbar order.

Tool-specific `defaultStyle` values that change behaviour, not just colour:

| Tool | `defaultStyle` |
|---|---|
| `trend-line` / `ray` / `extended-line` | `extendLeft`/`extendRight` = `false,false` / `false,true` / `true,true` |
| `rectangle` | `fill: true, fontSize: 14, textAlign: 'left', textVAlign: 'top', textPosition: 'inside'` |
| `ellipse` | `fill: true, fontSize: 14, textAlign: 'center', textVAlign: 'middle', textPosition: 'inside'` |
| `fib-retracement` / `fib-extension` / `fib-channel` | `levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]`, `showLabels: true` |
| `fib-fan` | `levels: [0.236, 0.382, 0.5, 0.618, 0.786, 1]` |
| `long-position` / `short-position` | `accountSize: 100000, risk: 1, fillOpacity: 0.13, showLabels: true` |
| `text` / `callout` | `text: 'Text'` / `'Note'`, `fontSize: 14` / `12`, `wrapWidth: 220` |
| `brush` / `highlighter` | `lineWidth: 2` / `lineWidth: 12, fillOpacity: 0.28` |
| `cyclic-lines` / `forecast` | `lineStyle: 'dashed'` |

`fib-time-zone` uses the Fibonacci **sequence** (`0,1,2,3,5,8,13,21,34,55` bar multiples), not ratios. `gann-fan` draws the fixed ratios `1x8 … 1x1 … 8x1`; `gann-box` is an 8x8 grid plus the 1x1 diagonal. `circle` measures its radius in screen px so it stays round. `arc` passes *through* its middle anchor; `curve` treats it as an off-curve control.

## DrawingController API

```ts
new DrawingController(chart, {
  magnet: false,            // snap new anchors to the hovered bar's O/H/L/C
  stayInDrawingMode: false, // stay armed after a shape completes
  historyLimit: 50,         // undo depth
  defaultStyle: {},         // merged UNDER each tool's own defaults
});
```

| Member | Behaviour |
|---|---|
| `setTool(id \| null)` | Arms a tool; throws on an unregistered id. Also calls `chart.setPlacementMode(true/false)`. |
| `activeTool()` | Armed id, or `null`. |
| `setOptions(patch)` | Live-patch the four options above. |
| `drawings()` / `get(id)` | Read the model. `drawings()` is the live array, in creation order. |
| `add(drawing)` | `add({ tool, points, style, paneIndex, id?, locked?, visible? })` returns the created `Drawing`. |
| `update(id, patch)` | Patch `points` \| `style` \| `locked` \| `visible`. `style` merges; `points` replaces. |
| `remove(id)` / `clear()` | Delete one / all. |
| `finish()` | Commit a `points: 0` tool at the anchors placed so far. Returns whether it committed. |
| `select(id \| null)` / `selected()` | Selection. |
| `undo()` / `redo()` / `canUndo()` / `canRedo()` | History. |
| `toJSON()` / `fromJSON(data)` | Deep-copied `Drawing[]` out, replace-all in (and clears history + selection). |
| `destroy()` | Unhooks listeners, removes every pane layer, releases placement mode. |

Events on the chart bus: `draw:tool`, `draw:add`, `draw:update`, `draw:remove`, `draw:select`.

**The controller listens on `chart.on(...)`, not `subscribeClick` / `subscribeDrag`.** Those two are single-slot callbacks the host needs for its own order lines; routing drawings through the bus means the two never contend.

### Placement lifecycle

1. `setTool(id)` arms the tool and puts the chart in placement mode, so a press places an anchor instead of panning.
2. Each `click` appends an anchor. Between anchors, a translucent preview (alpha 0.7) follows the live cursor.
3. When `pending.length >= tool.points`, `expand()` runs (if the tool has one) and the drawing is committed, selected, and — unless `stayInDrawingMode` — the tool disarms.
4. `points: 0` tools (`path`, `polyline`) never self-complete: double-click, or `finish()`. Fewer than 2 anchors discards the attempt.
5. `freehand` tools (`brush`, `highlighter`) ignore clicks and sample the cursor while the pointer is held; the release commits. A tap that never moved is discarded.
6. A press-drag-release also draws a two-anchor shape in one gesture: the chart emits the press point, then the release point tagged `viaDrag`.

### Selection and dragging

Hit ids are `draw:<id>` for the body and `draw:<id>#<n>` for anchor `n`. Dragging the body translates **every** anchor by the cursor delta; dragging a handle moves that one anchor to the cursor. The grab radius is 6 media px for a body, 7 for a handle; handles of the selected drawing win over its own body.

Freehand strokes expose only their first and last handle — one handle per sample would bury the ink.

### Undo, lock, visibility

**A whole drag is one undo step.** The snapshot is pushed once per gesture, on the first `drag` event, not per frame. Any new edit clears the redo branch. Snapshots are `JSON.stringify` of the full list, capped at `historyLimit`.

`update(id, { locked: true })` keeps the drawing rendered but removes it from hit-testing entirely — it cannot be selected or dragged, and it draws no handles. `update(id, { visible: false })` removes it from both rendering and hit-testing.

## Persistence

Every mutation writes `chart.setDrawingState(this.toJSON())`, so drawings ride along in `chart.getState().drawings` with no extra plumbing.

```ts
localStorage.setItem('layout', JSON.stringify(chart.getState()));   // includes drawings

chart.restoreState(JSON.parse(localStorage.getItem('layout')!));
const draw = new DrawingController(chart);   // reads the state in its constructor
```

**Restore chart state before constructing the controller.** The constructor reads `chart.drawingState()` once; a `restoreState` afterwards leaves the controller holding the old list, which the next `_sync()` writes back over the restored one.

The controller and its layers belong to the chart they were built on, so a rebuild (interval, chart type, or theme swap) needs `const saved = draw.toJSON(); draw.destroy();` before `chart.destroy()`, then `new DrawingController(newChart).fromJSON(saved)`. Anchors are data, so the shapes land on the same bars even at a different interval.

## Keyboard

```ts
import { matchDrawingShortcut, drawingShortcuts } from 'openalgo-charts/draw';

drawingShortcuts();      // { 'trend-line': 'Alt+T', 'horizontal-line': 'Alt+H', ... }
matchDrawingShortcut(e); // tool id, or null
```

**The library installs no key listener.** Only the host knows whether the chart has focus, a dialog is open, or the user is typing in a field. `matchDrawingShortcut` is pure and takes any `{ key, altKey?, ctrlKey?, metaKey?, shiftKey? }`.

Matching rules, all verified in `tests/draw-tier.test.ts`:

- Key comparison is case-insensitive (`'t'` and `'T'` both match `Alt+T`).
- **Modifiers must match exactly.** `Alt+T` does *not* fire for `Ctrl+Alt+T` or `Shift+Alt+T`, so a tool can never shadow a browser or host chord.
- `metaKey` counts as Ctrl, so a Mac Cmd chord does not arm an Alt-only tool.
- A bare letter never matches — without Alt or Ctrl the function returns `null` immediately, so ordinary typing is safe.

## Registering a custom tool

A tool is a descriptor. `draw` receives anchors in **device** px (already multiplied by `rc.dpr`); `distance` receives them in **media** px, the same space as the cursor. The hit-test field is named `distance`, not `hitTest`.

```ts
import { registerDrawingTool, distToSegment } from 'openalgo-charts/draw';

registerDrawingTool({
  id: 'vwap-band',
  name: 'VWAP Band',
  points: 2,
  shortcut: 'Alt+B',
  defaultStyle: { color: '#f5a623', lineWidth: 2, fillOpacity: 0.15 },
  draw: ({ ctx, rc, pts, style }) => {
    const band = 8 * rc.dpr;                       // pts are already device px
    ctx.globalAlpha = style.fillOpacity ?? 0.15;
    ctx.fillStyle = style.color;
    ctx.fillRect(pts[0].x, pts[0].y - band, pts[1].x - pts[0].x, band * 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = Math.max(1, style.lineWidth * rc.dpr);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.stroke();
  },
  // media px to the shape; 0 means "inside"; null means a miss.
  distance: (x, y, { pts }) => {
    const d = distToSegment(x, y, pts[0], pts[1]);
    return d <= 8 ? 0 : d;
  },
});
```

Exported geometry helpers: `distToSegment`, `distToLine`, `distToPolyline`, `distToRect`, `distToEllipse`, `rectOf`, `extendSegment`.

Two optional descriptor fields change *placement*, not rendering:

| Field | Effect |
|---|---|
| `freehand: true` | Sample the cursor while held, commit on release. Requires `points: 0`. Only the end anchors get handles. |
| `expand(clicked, { barSeconds, visibleBars })` | Turn the clicked anchors into the full anchor set, so one click can drop a complete editable default. Every returned point stays a draggable handle. |

Size an `expand` default against `visibleBars`, not a fixed bar count — a fixed count is a hairline zoomed out and pane-filling zoomed in. The position tools use `Math.max(5, round(visibleBars * 0.08))` bars and `±1%` of price.

**A non-finite `distance` must be a miss.** The layer treats `null`, `NaN`, and `Infinity` as misses; returning `NaN` from a degenerate shape would otherwise swallow every click on the pane.

## Host UI wiring

The pattern the OpenAlgo terminal uses (`D:\testing\openalgo\frontend\src\lib\trading\terminal.ts`, rail in `src/components/trading/DrawingRail.tsx`, tool catalogue in `src/lib/trading/drawTools.tsx`): the tier is dynamically imported on first use, the controller is the only stateful thing, and React only ever sees a derived stats object.

```ts
// Lazy-load the tier the first time a drawing control is touched.
const { DrawingController, drawingShortcuts, matchDrawingShortcut } =
  await import('openalgo-charts/draw');

const draw = new DrawingController(chart, { magnet, stayInDrawingMode: false });
draw.fromJSON(savedDrawings);           // survive a chart rebuild
const chords = drawingShortcuts();      // id -> 'Alt+T', rendered next to tool names

// One handler for every mutation: persist, then re-derive toolbar state.
for (const ev of ['draw:tool', 'draw:add', 'draw:update', 'draw:remove', 'draw:select']) {
  chart.on(ev, () => {
    localStorage.setItem('draw', JSON.stringify(draw.toJSON()));
    setStats({
      tool: draw.activeTool(), count: draw.drawings().length,
      canUndo: draw.canUndo(), canRedo: draw.canRedo(),
      hasSelection: draw.selected() !== null, shortcuts: chords,
    });
  });
}

// A text tool is useless empty: open the host's dialog as soon as one lands.
chart.on('draw:add', (p) => {
  const d = (p as { drawing: { id: string; tool: string; style?: { text?: string } } }).drawing;
  if (d.tool === 'text' || d.tool === 'callout') openTextDialog(d.id, d.style?.text ?? '');
});

// Keys: the host decides when the chart owns them.
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (e.key === 'Escape') return draw.setTool(null);
  if (e.key === 'Delete') { const id = draw.selected(); if (id) draw.remove(id); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.shiftKey ? draw.redo() : draw.undo(); return; }
  const id = matchDrawingShortcut(e);
  if (id !== null) { e.preventDefault(); draw.setTool(id); }
});

// A style bar patches the selection.
draw.update(draw.selected()!, { style: { color, lineWidth, lineStyle, fillOpacity } });
```

## Foot-guns

**Tool `defaultStyle` beats the controller's `defaultStyle`.** The merge order in `add()` is `{ ...controller.defaultStyle, ...tool.defaultStyle, ...drawing.style }`, so a controller-wide `{ fill: false }` will not turn off a rectangle's fill. Patch the drawing, or pass `style` on `add`.

**`drawings()` returns the live array, not a copy.** Mutating it desynchronises the pane layers and the chart state. Use `toJSON()` when you need a snapshot.

**A drawing renders only once it has `max(1, tool.points)` anchors.** A partially-placed `points: 0` shape lives in the preview slot, not the model, so it is absent from `toJSON()` until committed.

**Magnet only applies to pane 0.** `_snap` returns the raw price for any other pane index, because O/H/L/C snapping has no meaning on an indicator pane.

Related: [primitives-and-plugins](primitives-and-plugins.md) (the `IPrimitive` contract `DrawingLayer` implements), [events-and-state](events-and-state.md) (the bus and `getState`), [interactions](interactions.md) (placement mode, pan/zoom), [bundling-and-tiers](bundling-and-tiers.md) (lazy-loading the tier).
