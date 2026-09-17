/**
 * Re-setting a series that brings no new time leaves the shared axis alone.
 *
 * Every `setSeriesData` and `addBars` used to re-merge the axis from every bar
 * of every series. A page of history on a chart with a handful of indicators
 * re-sets each indicator plot once the candles have grown, so one page cost a
 * full re-merge per plot — over every bar of every series each time — for an
 * axis the candles had already extended. On a long daily chart that was the
 * hitch every history page landed with.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataLayer } from '../src/model/data-layer';
import type { Bar } from '../src/model/bar';

const bar = (time: number): Bar => ({ time, open: 1, high: 1, low: 1, close: 1 });
const range = (from: number, to: number): Bar[] => Array.from({ length: to - from }, (_, i) => bar((from + i) * 60));

/** Counts the full re-merges, which is the cost the fast path exists to skip. */
function rebuilds(): { count: () => number } {
  const spy = vi.spyOn(DataLayer.prototype as unknown as { _rebuild(): void }, '_rebuild');
  return { count: () => spy.mock.calls.length };
}

afterEach(() => vi.restoreAllMocks());

describe('DataLayer shared axis', () => {
  it('does not re-merge when a plot is re-set onto times the axis already has', () => {
    const dl = new DataLayer();
    const candles = dl.createSeries();
    const plot = dl.createSeries();
    dl.setSeriesData(candles, range(0, 100));
    dl.setSeriesData(plot, range(20, 100));
    const merges = rebuilds();

    // A page of history: the candles grow the axis, the plot follows onto it.
    dl.addBars(candles, range(-50, 0));
    dl.setSeriesData(plot, range(-30, 100));

    expect(merges.count()).toBe(1);
    expect(dl.length).toBe(150);
    expect(dl.timeToIndex(-30 * 60)).toBe(20);
    expect(dl.visibleBars(plot, 0, 149)).toHaveLength(130);
  });

  it('does not re-merge a volume series prepended onto the times the candles brought', () => {
    const dl = new DataLayer();
    const candles = dl.createSeries();
    const volume = dl.createSeries();
    dl.setSeriesData(candles, range(0, 100));
    dl.setSeriesData(volume, range(0, 100));
    const merges = rebuilds();

    dl.addBars(candles, range(-40, 0));
    dl.addBars(volume, range(-40, 0));

    expect(merges.count()).toBe(1);
    expect(dl.indexedBars(volume).map((b) => b.index)).toEqual(Array.from({ length: 140 }, (_, i) => i));
  });

  it('still grows the axis for a time only the re-set series has', () => {
    const dl = new DataLayer();
    const candles = dl.createSeries();
    const plot = dl.createSeries();
    dl.setSeriesData(candles, range(0, 10));
    dl.setSeriesData(plot, [...range(0, 10), bar(10 * 60)]);
    expect(dl.length).toBe(11);
    expect(dl.timeToIndex(10 * 60)).toBe(10);
  });

  it('still shrinks the axis when a series drops a time no other series has', () => {
    const dl = new DataLayer();
    const candles = dl.createSeries();
    const extra = dl.createSeries();
    dl.setSeriesData(candles, range(0, 10));
    dl.setSeriesData(extra, [bar(10 * 60), bar(11 * 60)]);
    expect(dl.length).toBe(12);

    dl.setSeriesData(extra, [bar(10 * 60)]);
    expect(dl.length).toBe(11);
    expect(dl.timeToIndex(11 * 60)).toBeUndefined();
  });

  it('keeps a time another series still holds when one series drops it', () => {
    const dl = new DataLayer();
    const candles = dl.createSeries();
    const plot = dl.createSeries();
    dl.setSeriesData(candles, range(0, 10));
    dl.setSeriesData(plot, range(0, 10));
    dl.setSeriesData(plot, range(5, 10));
    expect(dl.length).toBe(10);
    expect(dl.timeToIndex(0)).toBe(0);
  });
});
