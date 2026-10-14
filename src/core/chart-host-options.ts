/**
 * The chart options this fork adds for its host (a trading terminal on desktop
 * and phone): the price-axis tick density, finger-sized canvas controls, where
 * the last-price line starts, the right-axis tags on study levels and the
 * wheel zoom sensitivity. Documented on `ChartOptions`.
 *
 * Resolved here, into one object the chart keeps, so the chart and its
 * collaborators read one field rather than five, and upstream's own chart.ts
 * carries as little of the fork as it can.
 */
import type { ChartOptions } from './chart-types';

/** The two the host may change after construction, through `applyOptions`. */
export interface ChartHostRuntimeOptions {
  touchTargets?: boolean | number;
  lastPriceLineExtent?: 'full' | 'fromLastBar';
}

export interface ChartHostOptions {
  /** Target maximum label count per price axis; undefined derives it from the plot height. */
  readonly priceTickCount: number | undefined;
  touchTargets: boolean | number;
  lastPriceLineExtent: 'full' | 'fromLastBar';
  readonly indicatorLevelAxisLabels: boolean;
  /** Multiplier on every wheel zoom step, `>= 0`; 0 turns wheel zoom off. */
  readonly wheelZoomSensitivity: number;
}

export function resolveChartHostOptions(options: ChartOptions): ChartHostOptions {
  return {
    // Unset means the axis picks a count from its plot height; an explicit
    // value is a hard cap for hosts that want a denser or sparser ladder.
    priceTickCount: options.priceTickCount == null ? undefined : Math.max(2, Math.round(options.priceTickCount)),
    touchTargets: options.touchTargets ?? false,
    lastPriceLineExtent: options.lastPriceLineExtent ?? 'full',
    indicatorLevelAxisLabels: options.indicatorLevelAxisLabels !== false,
    wheelZoomSensitivity: Number.isFinite(options.wheelZoomSensitivity) ? Math.max(0, options.wheelZoomSensitivity as number) : 1,
  };
}

/** Apply the runtime half of `applyOptions`. */
export function applyChartHostOptions(target: ChartHostOptions, opts: ChartHostRuntimeOptions): void {
  if (opts.touchTargets !== undefined) target.touchTargets = opts.touchTargets;
  if (opts.lastPriceLineExtent !== undefined) target.lastPriceLineExtent = opts.lastPriceLineExtent;
}
