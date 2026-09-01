/**
 * Drawing tier (opt-in: "openalgo-charts/draw").
 *
 * 43 built-in tools plus a headless controller. Importing this module registers
 * every built-in tool as a side effect. The named descriptor re-exports below
 * cover the most-customised subset; `BUILTIN_DRAWING_TOOLS` is the full list and
 * `registeredDrawingTools()` reads the live registry.
 *
 * ```ts
 * import { createChart } from 'openalgo-charts';
 * import { DrawingController } from 'openalgo-charts/draw';
 *
 * const chart = createChart(el);
 * chart.addSeries('candlestick').setData(bars);
 *
 * const draw = new DrawingController(chart, { magnet: true });
 * draw.setTool('trend-line');   // next two clicks place it
 * ```
 *
 * The controller ships **no UI** — no toolbar, no dialogs. It exposes the model
 * and the interactions; a host wires its own buttons (or the future
 * `openalgo-charts-ui` package) to `setTool` / `undo` / `remove`.
 *
 * Tools register into the base bundle's registry through the package entry, not
 * a deep path, so `createChart` and this tier share one registry — see
 * rollup.config.js.
 */
import { registerBuiltinDrawingTools } from './tools';

export const DRAW_TIER = 'draw' as const;

registerBuiltinDrawingTools(); // side effect on tier import

export {
  registerDrawingTool,
  getDrawingTool,
  hasDrawingTool,
  registeredDrawingTools,
  matchDrawingShortcut,
  drawingShortcuts,
  registerBuiltinDrawingTools,
  BUILTIN_DRAWING_TOOLS,
  TREND_LINE, RAY, EXTENDED_LINE, ARROW,
  HORIZONTAL_LINE, HORIZONTAL_RAY, VERTICAL_LINE, CROSS_LINE,
  RECTANGLE, ELLIPSE, PARALLEL_CHANNEL,
  FIB_RETRACEMENT, FIB_EXTENSION,
  LONG_POSITION, SHORT_POSITION, MEASURE,
  TEXT, PATH,
  // Annotations: the marks whose job is a human sentence on the chart.
  NOTE, BALLOON, COMMENT, SIGNPOST, PRICE_NOTE, TABLE,
  ARROW_UP, ARROW_DOWN, ARROW_LEFT, ARROW_RIGHT,
  PRICE_LABEL, CALLOUT, FLAG_MARK,
} from './tools';

export {
  DRAWING_TOOL_ICONS, drawingToolIcon, drawingToolIconIds,
  ICON_VIEWBOX, ICON_STROKE, ICON_ATTRS,
} from './icons';

export { DrawingLayer } from './layer';
export { DrawingController, type DrawingControllerOptions } from './controller';

// Clipboard transfer. `DrawingControllerOptions.clipboard` is typed as
// `ClipboardPort` and `DrawingController.clipboard()` returns a
// `DrawingClipboard`, so both have to be nameable from the tier entry or a
// TypeScript host can use neither. The encode / decode / sanitize trio is
// exported for a host moving drawings over its own transport (a websocket, a
// saved template) with the same validation a paste gets.
export {
  DrawingClipboard,
  clearMemoryClipboard,
  systemClipboard,
  encodeClipboardPayload,
  decodeClipboardPayload,
  sanitizeDrawing,
  DRAWING_CLIPBOARD_KEY,
  DRAWING_CLIPBOARD_VERSION,
  type ClipboardPort,
  type DrawingClipboardOptions,
} from './clipboard';

export type {
  Drawing,
  DrawingPoint,
  DrawingStyle,
  DrawingTool,
  DrawContext,
  HitContext,
  ScreenPoint,
  // `DrawingTool.expand` receives this; a custom tool cannot type its own
  // implementation without it.
  ExpandContext,
} from './types';

// What `new DrawingController(chart)` accepts. Exported so a host wiring the
// controller to something other than a Chart can state what it must provide.
export type { DrawingChartHost } from './controller';

export type { ShortcutEvent } from './tools';

export {
  distToSegment, distToLine, distToPolyline,
  distToRect, distToEllipse, rectOf, extendSegment,
} from './geometry';
