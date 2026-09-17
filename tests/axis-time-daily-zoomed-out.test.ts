/**
 * The time axis of a zoomed-out daily chart formats the labels it can draw.
 *
 * Every first bar of a new day is a forced label candidate, which is what keeps
 * the date on an intraday axis. On a daily series EVERY bar is the first of its
 * day, so a chart showing six thousand of them resolved six thousand labels a
 * frame — each one a host `timeFormatter` call (the BVB one makes three
 * `toLocaleDateString` calls) and a `measureText` — to draw the two dozen that
 * fit. That was a frame of 70 ms on a fast desktop and a few frames a second on
 * anything slower, with or without indicators.
 */
import { describe, expect, it } from 'vitest';
import { DataLayer } from '../src/model/data-layer';
import { TimeScale } from '../src/scale/time-scale';
import { drawTimeAxis, type PlotLayout, type TickMarkType } from '../src/render/axis';
import { RecordingContext } from './helpers/fake-ctx';
import type { Bar } from '../src/model/bar';

const LAYOUT: PlotLayout = {
  plotWidth: 1500, plotHeight: 600, priceAxisWidth: 56, timeAxisHeight: 22, plotLeft: 0,
};
const DAY = 86_400;

function frame(count: number, spacing: number, timezone?: string): { calls: number; labels: string[] } {
  const data: Bar[] = Array.from({ length: count }, (_, i) => ({
    time: 1_000_000_000 + i * DAY, open: 1, high: 1, low: 1, close: 1,
  }));
  const dl = new DataLayer();
  dl.setSeriesData(dl.createSeries(), data);
  const ts = new TimeScale({ barSpacing: spacing, minBarSpacing: 0.05 });
  ts.setWidth(LAYOUT.plotWidth);
  ts.setRightOffset(0);
  ts.setBaseIndex(dl.baseIndex);
  const rec = new RecordingContext();
  let calls = 0;
  const formatter = (t: number, tm?: TickMarkType): string => {
    calls += 1;
    return `${tm}:${new Date(t * 1000).toISOString().slice(0, 10)}`;
  };
  drawTimeAxis(rec as unknown as CanvasRenderingContext2D, ts, dl, LAYOUT, 1, undefined, formatter, timezone);
  const labels = rec.ops.filter((o) => o.type === 'fillText').map((o) => o.text ?? '');
  return { calls, labels };
}

describe('drawTimeAxis on a zoomed-out daily chart', () => {
  it.each([undefined, 'Europe/Bucharest'])('formats about as many labels as it draws (zone %s)', (zone) => {
    const { calls, labels } = frame(6_000, 0.25, zone);
    expect(labels.length).toBeGreaterThan(5);
    // A label is ~90 px here, so the axis holds a couple of dozen; formatting
    // a few times that is the budget, not a formatter call per visible bar.
    expect(calls).toBeLessThan(200);
  });

  it('costs the same for twice the bars in view', () => {
    const narrow = frame(3_000, 0.5).calls;
    const wide = frame(6_000, 0.25).calls;
    expect(wide).toBeLessThan(narrow * 1.5);
  });
});
