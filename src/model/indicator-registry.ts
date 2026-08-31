/**
 * Indicator registry (ARCHITECTURE.md §6A, §8). The sibling of the chart-type
 * registry: that one answers *"how do I paint an array of bars"*, this one
 * answers *"what do I compute, what does it plot, and what can a user tune"*.
 *
 * A descriptor is data, not code-in-the-core — the chart never switches on an
 * indicator id. Each `plot` names a registered **chart type**, so indicators
 * ride the existing Family-A renderers and add no drawing code at all.
 *
 * The built-in descriptors live in the lazy `openalgo-charts/indicators` tier;
 * only the registry and the runtime ship in the base bundle, so an app that
 * plots its own maths pays nothing for the catalog.
 */
import type { Bar } from './bar';
import type { SeriesType } from './chart-type-registry';
import type { SeriesStyle } from '../render/series-style';
import type { PriceScaleId } from './series';
import type { SeriesMarker } from '../primitives/markers';
import type { TableCell, ChartTableOptions } from '../primitives/table';
import type { IPrimitive } from '../primitives/primitive';

/** Which price a calculation reads from each bar. */
export type IndicatorSource = 'open' | 'high' | 'low' | 'close' | 'hl2' | 'hlc3' | 'ohlc4' | 'volume';

/** One tunable input. `type` is what a settings UI renders; the core only reads `key`/`default`. */
export type IndicatorInput =
  | { key: string; type: 'number'; label: string; default: number; min?: number; max?: number; step?: number; group?: string }
  | { key: string; type: 'boolean'; label: string; default: boolean; group?: string }
  | { key: string; type: 'color'; label: string; default: string; group?: string }
  | { key: string; type: 'text'; label: string; default: string; group?: string }
  | { key: string; type: 'select'; label: string; default: string; options: readonly { label: string; value: string }[]; group?: string }
  | { key: string; type: 'source'; label: string; default: IndicatorSource; group?: string };

/** Dash pattern for a level, a drawing, or a plot. */
export type IndicatorLineStyle = 'solid' | 'dashed' | 'dotted';

/** Line-style options, for a settings UI's Style tab. */
export const INDICATOR_LINE_STYLES: readonly { label: string; value: string }[] = [
  { label: 'Solid', value: 'solid' },
  { label: 'Dashed', value: 'dashed' },
  { label: 'Dotted', value: 'dotted' },
];

/** Settings keys the runtime derives for a plot's appearance. */
export function plotStyleKeys(plot: IndicatorPlot): {
  color: string; width: string; lineStyle: string; opacity: string; type: string;
} {
  return {
    // A descriptor that already declares a colour input owns that key — a
    // generated one would shadow it, and setting the declared key would
    // silently stop working.
    color: plot.colorKey ?? `${plot.key}:color`,
    width: `${plot.key}:width`,
    lineStyle: `${plot.key}:lineStyle`,
    opacity: `${plot.key}:opacity`,
    type: `${plot.key}:type`,
  };
}

/**
 * Per-plot appearance inputs, generated from the descriptor rather than
 * hand-written on each one — every indicator gets colour, opacity, thickness,
 * and line style for free, and a settings UI can render them as a "Style" tab
 * beside the descriptor's own `inputs`.
 *
 * Defaults come from the plot's declared style (and its legacy `colorKey`), so
 * an indicator that already ships colours keeps them.
 */
export function indicatorStyleInputs(descriptor: IndicatorDescriptor): IndicatorInput[] {
  const out: IndicatorInput[] = [];
  for (const plot of descriptor.plots) {
    const k = plotStyleKeys(plot);
    const declared = descriptor.inputs.find((i) => i.key === plot.colorKey);
    const color = typeof declared?.default === 'string'
      ? declared.default
      : (plot.style?.color ?? '#4f8cff');
    out.push({ key: k.color, type: 'color', label: plot.title, default: color, group: plot.title });
    out.push({
      key: k.opacity, type: 'number', label: 'Opacity', default: 100,
      min: 0, max: 100, step: 1, group: plot.title,
    });
    out.push({
      key: k.width, type: 'number', label: 'Thickness', default: plot.style?.lineWidth ?? 1.5,
      min: 0.5, max: 8, step: 0.5, group: plot.title,
    });
    out.push({
      key: k.lineStyle, type: 'select', label: 'Line style',
      default: plot.style?.lineStyle ?? 'solid',
      options: INDICATOR_LINE_STYLES, group: plot.title,
    });
    out.push({
      key: k.type, type: 'select', label: 'Plot style',
      default: plot.type,
      options: INDICATOR_PLOT_STYLES, group: plot.title,
    });
  }
  return out;
}

/**
 * Chart types a plot can be re-rendered as. A moving average is a line by
 * default, but the same column of numbers reads better as a histogram or an
 * area depending on what you are looking for — and a descriptor cannot know
 * which. Restricted to the types that make sense for a single value column.
 */
export const INDICATOR_PLOT_STYLES: readonly { label: string; value: string }[] = [
  { label: 'Line', value: 'line' },
  { label: 'Line with markers', value: 'line-markers' },
  { label: 'Step line', value: 'step' },
  { label: 'Area', value: 'area' },
  { label: 'Histogram', value: 'histogram' },
  { label: 'Columns', value: 'column' },
];

/** Canonical option list for a `type: 'source'` input, for settings UIs. */
export const INDICATOR_SOURCES: readonly { label: string; value: IndicatorSource }[] = [
  { label: 'Close', value: 'close' },
  { label: 'Open', value: 'open' },
  { label: 'High', value: 'high' },
  { label: 'Low', value: 'low' },
  { label: 'HL2', value: 'hl2' },
  { label: 'HLC3', value: 'hlc3' },
  { label: 'OHLC4', value: 'ohlc4' },
];

export type IndicatorSettings = Record<string, unknown>;

/** One plotted line/band/histogram. `type` is any registered chart type. */
/** A shaded band between two of an indicator's plots. */
export interface IndicatorFillSpec {
  /** The two plot keys to fill between. */
  between: readonly [string, string];
  /** Colour where the first plot is above the second. */
  colorUp?: string;
  /** Colour where the second is above the first. */
  colorDown?: string;
  /** Settings keys holding those colours, so the band is restyleable. */
  colorUpKey?: string;
  colorDownKey?: string;
  /** 0..1. Defaults to 0.12. */
  opacity?: number;
}

export interface IndicatorPlot {
  /** Key into the `calc` result. */
  key: string;
  /** Registered chart type used to draw it ('line', 'histogram', 'area', ...). */
  type: SeriesType;
  /** Legend title. */
  title: string;
  /** Style overrides merged onto the chart type's defaults. */
  style?: SeriesStyle;
  /** Price axis for this plot. Defaults to 'right'. */
  priceScaleId?: PriceScaleId;
  /**
   * Draw this one plot on the price pane even though the indicator owns a pane
   * of its own. An oscillator that also wants a signal
   * band or a stop line sitting on the candles is the case: the study belongs in
   * its own pane, one of its columns belongs on price, and splitting it into two
   * indicators would make the user configure the same inputs twice.
   *
   * Ignored for an `'onchart'` descriptor, which is already on the price pane.
   */
  overlay?: boolean;
  /**
   * Settings key holding this plot's color, so a settings change restyles the
   * series without a full rebuild.
   */
  colorKey?: string;
  /**
   * Four `calc` keys to draw this plot as bar-shaped elements instead of one
   * value per bar: candles, hollow candles, OHLC bars, high-low.
   *
   * A single column cannot express those at all, and the alternative (a second
   * result shape for `calc`) would fork the contract every descriptor and every
   * helper is written against. Naming four columns inside the *same*
   * `IndicatorValues` keeps one shape: a smoothed Heikin-Ashi overlay, a
   * higher-timeframe candle, a synthetic spread instrument each return four
   * ordinary columns and point at them from here.
   *
   * The named columns must all exist and be bar-aligned, or `addIndicator`
   * throws. `key` stays the series identity and the legend reading falls back to
   * the `close` column.
   */
  ohlc?: { open: string; high: string; low: string; close: string };
  /**
   * Per-bar colour, for plots whose meaning changes bar to bar — a MACD
   * histogram is four colours by sign and direction, a conditional study two.
   * Return `undefined` to fall back to the plot's own colour.
   *
   * Reaches the renderer as `Bar.color`, so every Family-A plot type honours
   * it: histogram, column, candles, OHLC bars, line, step and area.
   */
  colorBy?(ctx: {
    value: number;
    index: number;
    values: IndicatorValues;
    settings: IndicatorSettings;
  }): string | undefined;
}

/** A horizontal reference level (RSI 70/30, Stochastic 80/20, a zero line). */
export interface IndicatorLevel {
  price: number;
  color?: string;
  title?: string;
  /** Legacy two-state dash switch. `lineStyle` wins when both are given. */
  dashed?: boolean;
  lineWidth?: number;
  lineStyle?: IndicatorLineStyle;
}

/** One end of an indicator drawing: a time on the shared axis, a price on the pane's scale. */
export interface DrawAnchor {
  time: number;
  price: number;
}

/**
 * A free-standing shape an indicator paints in its own pane, anchored to time
 * and price rather than to a bar index.
 *
 * Plots, levels and markers each answer a different question and none of them
 * answers this one: a pivot-to-pivot trendline, a supply zone, an order block,
 * a measured-move projection are all geometry between two arbitrary points, and
 * a column of one value per bar cannot express any of them. Anchors are times,
 * so a shape stays put when history is paged in and every logical index shifts.
 */
export type IndicatorDrawing =
  | {
      kind: 'line';
      from: DrawAnchor;
      to: DrawAnchor;
      color?: string;
      lineWidth?: number;
      lineStyle?: IndicatorLineStyle;
      /** Continue the line past its anchor to the pane edge. */
      extendLeft?: boolean;
      extendRight?: boolean;
    }
  | {
      kind: 'box';
      from: DrawAnchor;
      to: DrawAnchor;
      /** Border colour. Omit `fillColor` to draw an outline only. */
      color?: string;
      fillColor?: string;
      /** Fill alpha, 0..1. Defaults to 0.12. */
      opacity?: number;
      lineWidth?: number;
      /** Caption drawn on a plate at the centre of the box; `\n` splits lines. */
      text?: string;
      textColor?: string;
    }
  | {
      kind: 'label';
      at: DrawAnchor;
      /** `\n` splits lines. */
      text: string;
      /** Plate fill. */
      color?: string;
      textColor?: string;
      /** Which edge of the plate sits on the anchor. Defaults to 'center'. */
      align?: 'left' | 'center' | 'right';
    }
  | {
      kind: 'polyline';
      points: readonly DrawAnchor[];
      color?: string;
      lineWidth?: number;
      /** Close the path back to the first point (a triangle, a wedge). */
      closed?: boolean;
      fillColor?: string;
      /** Fill alpha, 0..1. Defaults to 0.12. */
      opacity?: number;
    };

/** `calc` output: one array per plot key, aligned 1:1 with the input bars. */
export type IndicatorValues = Record<string, readonly (number | null)[]>;

/** Per-instance scratch owned by the descriptor (Tier-2 data lands here). */
export type IndicatorStore = Record<string, unknown>;

/**
 * The fourth, optional argument to `calc` (and the sixth to `calcTail`): what
 * the calculation cannot read off the bars themselves.
 *
 * It is optional so that every descriptor written against `calc(bars, settings,
 * store)` keeps its exact signature and its exact behaviour, which is the whole
 * point: a calculation that ignores the context computes what it always did.
 */
export interface IndicatorCalcContext {
  /**
   * Where the last bar stands, so a study can act once per bar rather than once
   * per tick, or refuse to signal off a bar that is still moving.
   */
  barState: {
    /** The most recent update appended a bar rather than replacing one. */
    isNew: boolean;
    /** The last bar has closed: its interval has elapsed on the chart clock. */
    isConfirmed: boolean;
    /** A live feed is driving updates, rather than a one-off history load. */
    isRealtime: boolean;
    /** Index of the last bar, `bars.length - 1` (-1 when there are none). */
    lastIndex: number;
  };
  /** The instrument, when the host knows one. See `IndicatorAttachContext`. */
  symbol?: string;
  /** The timeframe (`'5m'`, `'1d'`), on the same terms as `symbol`. */
  interval?: string;
  /** The chart's IANA zone, the calendar its axis is labelled in. */
  timezone: string;
  /** Chart wall clock in UTC seconds, the clock the countdown row reads. */
  now(): number;
  /**
   * The instrument's tick size, from the pane's price scale `minMove`.
   *
   * `undefined` when the host has not told the chart what it is, which is the
   * honest answer rather than a guessed 0.01: an indicator sizing a range in
   * ticks has to tell "one paisa" apart from "nobody said".
   */
  tickSize?: number;
}

/** What an alert's `when` predicate is handed, for the bar it is judging. */
export interface IndicatorAlertContext {
  bars: readonly Bar[];
  values: IndicatorValues;
  settings: Readonly<IndicatorSettings>;
  /** The bar being evaluated. */
  index: number;
}

/**
 * A condition the runtime watches, declared by the descriptor rather than wired
 * up by the host: the indicator is the only thing that knows what a crossover of
 * its own columns means.
 *
 * Evaluated once per bar, for bars that are new since the last evaluation, so
 * adding the indicator to a loaded chart fires nothing for history.
 */
export interface IndicatorAlertSpec {
  /** Stable within the descriptor, e.g. `'cross-up'`. */
  id: string;
  /** Short human label, e.g. `'MACD crossed up'`. */
  title: string;
  /** Longer text for a notification; defaults to `title`. */
  message?: string;
  when(ctx: IndicatorAlertContext): boolean;
}

/** Payload of the `'indicator:alert'` event on the chart's own bus. */
export interface IndicatorAlertPayload {
  /** Descriptor id, e.g. `'macd'`. */
  indicatorId: string;
  /** Instance id, so a host can tell three EMAs apart. */
  instanceId: string;
  alertId: string;
  title: string;
  message: string;
  /** The bar that triggered it: UTC seconds, and its index in `bars`. */
  time: number;
  index: number;
}

/** What an indicator's `attach` lifecycle can reach. */
export interface IndicatorAttachContext {
  /** Current settings (live — read at call time, not captured). */
  settings(): Readonly<IndicatorSettings>;
  /** The chart's current source bars. */
  bars(): readonly Bar[];
  /** Re-run `calc` and repaint — call when external data arrives. */
  requestRecompute(): void;
  /** Scratch this instance owns; the same object `calc` receives. */
  store: IndicatorStore;
  /**
   * The instrument the chart is showing, when the host knows it.
   *
   * The engine core has no instrument concept: it is handed bars, never a
   * symbol, so `chart.addIndicator` leaves this undefined rather than inventing
   * a name. A host that wraps the chart (a terminal that owns the symbol
   * picker) supplies it through its own `IndicatorHost`, which is how a Tier-2
   * indicator fetches the series matching what is on screen.
   */
  symbol?(): string | undefined;
  /** The chart's timeframe (`'5m'`, `'1d'`), on the same terms as `symbol`. */
  interval?(): string | undefined;
  // The rest are always supplied by `IndicatorInstance`, which falls back to the
  // shipped default when its host declares no opinion. They are optional so a
  // caller can hand-build a minimal context (a unit test exercising one
  // descriptor's lifecycle) without stubbing the whole surface.
  /** The chart's IANA zone, the one its axis is labelled in. */
  timezone?(): string;
  /** Chart wall clock in UTC seconds, the same clock the countdown row uses. */
  now?(): number;
  /** The pane this instance drew into. Moves when panes are reordered. */
  paneIndex?(): number;
  /** Attach a primitive to this indicator's pane, and detach it again. */
  addPrimitive?(p: IPrimitive): void;
  removePrimitive?(p: IPrimitive): void;
  /**
   * Emit on the chart's own event bus, the one `chart.on(name, cb)` listens to.
   *
   * The declarative `alerts` slot covers a condition read off the bars; this is
   * the imperative half, for an indicator whose signal arrives from outside the
   * calculation entirely (a subscription its `attach` opened).
   */
  emit?(event: string, payload: unknown): void;
}

/**
 * What `levels` is handed. It carries `bars` and `values` **and** spreads the
 * settings keys onto itself, so the built-ins written against the original
 * `levels(settings)` signature keep working unchanged: they read
 * `ctx.overbought` (or pass `ctx` to a `num(s, key, default)` helper) and find
 * exactly what they found before. A widened parameter is the only way a level
 * can be data-derived (yesterday's high, the session VWAP band), and that is a
 * whole class of level that could not be expressed at all before.
 *
 * The three data members are optional for the same backward-compatibility
 * reason, not because the runtime ever omits them: it always passes all three,
 * but a caller holding only a settings bag must still be able to invoke
 * `levels` directly. A descriptor that needs the data should default them
 * (`ctx.bars ?? []`).
 *
 * `settings`, `bars` and `values` are therefore reserved keys, the way
 * `timezone` already is in the settings a `calc` receives: an input declared
 * under one of those names is shadowed here.
 */
export type IndicatorLevelContext = IndicatorSettings & {
  settings?: Readonly<IndicatorSettings>;
  bars?: readonly Bar[];
  values?: IndicatorValues;
};

export interface IndicatorDescriptor {
  /** Registry key, e.g. `'macd'`. */
  id: string;
  /** Display name, e.g. `'MACD'`. */
  name: string;
  /** Grouping for a picker UI ('Trend', 'Momentum', 'Volume', 'Volatility'). */
  category?: string;
  /** `'onchart'` overlays the price pane; `'pane'` gets its own pane. */
  placement: 'onchart' | 'pane';
  inputs: readonly IndicatorInput[];
  plots: readonly IndicatorPlot[];
  /**
   * Shaded bands between pairs of plots — the Ichimoku cloud, a Bollinger
   * channel. A pair of lines is not the same picture as a filled region: the
   * fill is what makes "price is above the cloud" readable at a glance, and
   * which side leads is itself the signal, hence the two colours.
   */
  fills?: readonly IndicatorFillSpec[];
  /**
   * Full recompute over every bar. Must return arrays the same length as
   * `bars` (use `null` for warmup gaps — the line renderer breaks across them
   * and autoscale skips them).
   *
   * Tier-1 indicators are pure functions of `(bars, settings)` and ignore
   * `store`. Tier-2 indicators — the ones with their own data — read the
   * external series their `attach` lifecycle put in `store`.
   */
  calc(
    bars: readonly Bar[],
    settings: Readonly<IndicatorSettings>,
    store: IndicatorStore,
    ctx?: IndicatorCalcContext,
  ): IndicatorValues;
  /**
   * Optional per-instance lifecycle, for indicators whose data is not derived
   * from the chart's bars (open interest, CVD, an external feed). Called once
   * when the instance is created; return a teardown function.
   *
   * Fetch into `ctx.store`, then call `ctx.requestRecompute()` — `calc` runs
   * again and reads what you stored.
   */
  attach?(ctx: IndicatorAttachContext): (() => void) | void;
  /**
   * Optional incremental path, called instead of `calc` when only the tail
   * changed (a live tick). Return values for indices `[fromIndex, bars.length)`
   * — the runtime splices them onto the previous result — or `null` to fall
   * back to a full `calc`.
   *
   * Without it every tick costs a full recompute. That is a few hundred
   * microseconds for one indicator over 50k bars, but it is O(n) per tick per
   * indicator, so implement this for anything meant to run in a busy live pane.
   */
  calcTail?(
    bars: readonly Bar[],
    settings: Readonly<IndicatorSettings>,
    fromIndex: number,
    previous: IndicatorValues,
    store: IndicatorStore,
    ctx?: IndicatorCalcContext,
  ): IndicatorValues | null;
  /**
   * Optional bar-anchored signal markers — a named "Buy"/"Sell" plate, an arrow
   * at a crossover. Runs after every `calc`, so it reads the values it just
   * produced rather than recomputing anything.
   *
   * A plot cannot express this: a plot is a column of prices drawn as a line or
   * histogram, whereas a signal is a discrete event with a label. Returning `[]`
   * (when a `showLabels`-style input is off, say) clears the layer.
   */
  markers?(ctx: {
    bars: readonly Bar[];
    values: IndicatorValues;
    settings: Readonly<IndicatorSettings>;
  }): readonly SeriesMarker[];
  /**
   * Optional summary grid pinned to a corner of the pane.
   *
   * Some studies are not a value per bar at all: a seasonality heatmap is a
   * matrix of monthly returns, a scoreboard is a handful of statistics. Those
   * have no place in `calc`, whose contract is one column per plot aligned to
   * the bars, so they come back through here instead. Runs after every `calc`.
   *
   * Return `null` (or a zero-row grid) to draw nothing, which is how a
   * `showTable`-style input should switch it off.
   */
  table?(ctx: {
    bars: readonly Bar[];
    values: IndicatorValues;
    settings: Readonly<IndicatorSettings>;
  }): { rows: readonly (readonly TableCell[])[]; options?: Partial<ChartTableOptions> } | null;
  /**
   * Optional free-standing shapes drawn in the indicator's pane: trendlines
   * between pivots, supply and demand boxes, projection labels. Runs after
   * every `calc`, like `markers` and `table`, and the returned list replaces the
   * previous one wholesale, so returning `[]` clears the layer.
   */
  draws?(ctx: {
    bars: readonly Bar[];
    values: IndicatorValues;
    settings: Readonly<IndicatorSettings>;
  }): readonly IndicatorDrawing[];
  /**
   * Optional per-bar shading behind everything else in the indicator's pane: a
   * full-height column per bar, `null` where nothing should be shaded.
   *
   * A regime study answers "which state is the market in right now", and that is
   * a property of the whole bar, not a price. Drawn as a plot it would need a
   * value to sit at and would fight the pane's autoscale; as a column behind the
   * candles it reads at a glance and costs the scale nothing.
   *
   * Runs after every `calc`. Return `[]` to clear the layer.
   */
  background?(ctx: {
    bars: readonly Bar[];
    values: IndicatorValues;
    settings: Readonly<IndicatorSettings>;
  }): readonly (string | null)[];
  /**
   * Optional recolouring of the **main price candles**, one entry per bar,
   * `null` to leave that bar with its own colour.
   *
   * Distinct from a plot's `colorBy`, which paints the indicator's own series: a
   * trend filter, a volatility regime or a higher-timeframe bias is a statement
   * about the price bars themselves, and drawing it as a second series beside
   * them says something weaker.
   *
   * Only one indicator's colours can be on the candles at a time; the most
   * recent publisher wins, and publishers run in `addIndicator` order, so the
   * winner is the same one from frame to frame. Removing it, or hiding it,
   * restores the bars' own colours.
   */
  barColors?(ctx: {
    bars: readonly Bar[];
    values: IndicatorValues;
    settings: Readonly<IndicatorSettings>;
  }): readonly (string | null)[];
  /**
   * Optional conditions the runtime watches on the descriptor's behalf, emitted
   * as `'indicator:alert'` on the chart's event bus with an
   * {@link IndicatorAlertPayload}. See {@link IndicatorAlertSpec}.
   */
  alerts?: readonly IndicatorAlertSpec[];
  /**
   * Optional horizontal reference levels drawn in the indicator's pane.
   * Recomputed after every `calc`, so a level derived from the data (the
   * previous day's high) tracks it. See `IndicatorLevelContext` for why the
   * argument still reads as a settings bag.
   */
  levels?(ctx: IndicatorLevelContext): readonly IndicatorLevel[];
  /**
   * Optional fixed price range for the indicator's own pane (RSI 0..100).
   * Applied only when the indicator creates its pane — two indicators sharing a
   * pane would otherwise fight over it.
   */
  range?(settings: Readonly<IndicatorSettings>): { min: number; max: number } | null;
}

const registry = new Map<string, IndicatorDescriptor>();

/** Register an indicator descriptor. Later registrations of the same id win. */
export function registerIndicator(descriptor: IndicatorDescriptor): void {
  registry.set(descriptor.id, descriptor);
}

export function getIndicator(id: string): IndicatorDescriptor {
  const d = registry.get(id);
  if (d === undefined) {
    throw new Error(
      `openalgo-charts: unknown indicator "${id}" — did you import 'openalgo-charts/indicators'?`,
    );
  }
  return d;
}

export function hasIndicator(id: string): boolean {
  return registry.has(id);
}

export function registeredIndicators(): IndicatorDescriptor[] {
  return Array.from(registry.values());
}

/** The descriptor's declared defaults as a settings object. */
export function indicatorDefaults(descriptor: IndicatorDescriptor): IndicatorSettings {
  const out: IndicatorSettings = {};
  for (const input of descriptor.inputs) out[input.key] = input.default;
  return out;
}

/** Read one bar's value for a price source. */
export function sourceValue(bar: Bar, source: IndicatorSource): number {
  switch (source) {
    case 'open': return bar.open;
    case 'high': return bar.high;
    case 'low': return bar.low;
    case 'hl2': return (bar.high + bar.low) / 2;
    case 'hlc3': return (bar.high + bar.low + bar.close) / 3;
    case 'ohlc4': return (bar.open + bar.high + bar.low + bar.close) / 4;
    case 'volume': return bar.volume ?? 0;
    default: return bar.close;
  }
}

/** Read a whole bar array for a price source. */
export function sourceValues(bars: readonly Bar[], source: IndicatorSource): number[] {
  const out = new Array<number>(bars.length);
  for (let i = 0; i < bars.length; i++) out[i] = sourceValue(bars[i], source);
  return out;
}
