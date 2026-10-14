/**
 * The chart options this fork adds for its host (a trading terminal on desktop
 * and phone): the price-axis tick density, finger-sized canvas controls, where
 * the last-price line starts and the right-axis tags on study levels.
 * Documented on `ChartOptions`.
 *
 * Resolved here, into one object the chart keeps, so the chart and its
 * collaborators read one field rather than five, and upstream's own chart.ts
 * carries as little of the fork as it can.
 */

/** The two the host may change after construction, through `applyOptions`. */
export interface ChartHostRuntimeOptions {
  touchTargets?: boolean | number | undefined;
  lastPriceLineExtent?: 'full' | 'fromLastBar' | undefined;
}

/**
 * The slice of `ChartOptions` resolved here, declared structurally so this
 * module imports nothing and stays out of the chart's type import cycles.
 */
export interface ChartHostOptionsInput extends ChartHostRuntimeOptions {
  priceTickCount?: number | undefined;
  indicatorLevelAxisLabels?: boolean | undefined;
}

export interface ChartHostOptions {
  /** Target maximum label count per price axis; undefined derives it from the plot height. */
  readonly priceTickCount: number | undefined;
  touchTargets: boolean | number;
  lastPriceLineExtent: 'full' | 'fromLastBar';
  readonly indicatorLevelAxisLabels: boolean;
}

export function resolveChartHostOptions(options: ChartHostOptionsInput): ChartHostOptions {
  return {
    // Unset means the axis picks a count from its plot height; an explicit
    // value is a hard cap for hosts that want a denser or sparser ladder.
    priceTickCount: options.priceTickCount == null ? undefined : Math.max(2, Math.round(options.priceTickCount)),
    touchTargets: options.touchTargets ?? false,
    lastPriceLineExtent: options.lastPriceLineExtent ?? 'full',
    indicatorLevelAxisLabels: options.indicatorLevelAxisLabels !== false,
  };
}

/** Apply the runtime half of `applyOptions`. */
export function applyChartHostOptions(target: ChartHostOptions, opts: ChartHostRuntimeOptions): void {
  if (opts.touchTargets !== undefined) target.touchTargets = opts.touchTargets;
  if (opts.lastPriceLineExtent !== undefined) target.lastPriceLineExtent = opts.lastPriceLineExtent;
}
