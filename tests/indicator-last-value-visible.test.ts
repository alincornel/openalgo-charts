/**
 * Turning an indicator's axis tag off, for the whole instance.
 *
 * A study on the price pane writes its current value onto the price axis, and
 * that is usually what you want. A chart carrying half a dozen overlays is the
 * case where it is not: the strip fills with tags, they displace the ticks that
 * make the axis readable, and the only escape was reaching past the handle for
 * each plot's own series and styling it by hand.
 *
 * `chart.addIndicator(id, { lastValueVisible: false })` is a reserved setting,
 * not a declared input: it reaches every plot the instance owns, including the
 * ones a settings change rebuilds, and leaves the lines exactly as they were.
 */
import { describe, it, expect } from 'vitest';
import { Chart } from '../src/core/chart';
import { registerIndicator } from '../src/model/indicator-registry';
import { fakeDocument, type FakeElement } from './helpers/fake-dom';
import type { RecordingContext } from './helpers/fake-ctx';
import type { Bar } from '../src/model/bar';

const BARS: Bar[] = Array.from({ length: 12 }, (_, i) => ({
  time: 1700000000 + i * 60,
  open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 10,
}));

/** An overlay that plots a flat line well inside the instrument's range. */
registerIndicator({
  id: 'lvv-overlay', name: 'Overlay (test)', placement: 'onchart', inputs: [],
  plots: [{ key: 'v', type: 'line', title: 'OVL', style: { color: '#ff9800' } }],
  calc: (b) => ({ v: b.map(() => 105.5) }),
});

/** Two plots, to prove one instance-level switch answers for both. */
registerIndicator({
  id: 'lvv-two-plots', name: 'Two Plots (test)', placement: 'onchart', inputs: [],
  plots: [
    { key: 'a', type: 'line', title: 'A', style: { color: '#ff9800' } },
    { key: 'b', type: 'line', title: 'B', style: { color: '#2196f3' } },
  ],
  calc: (b) => ({ a: b.map(() => 105.5), b: b.map(() => 106.5) }),
});

function mount(): Chart {
  const doc = fakeDocument();
  const el = doc.createElement('div') as unknown as FakeElement;
  Object.assign(el, { clientWidth: 800, clientHeight: 600 });
  const chart = new Chart(el, {
    document: doc,
    pixelRatio: () => 1,
    // Synchronous scheduler, so a frame is on the recording context by the time
    // the call that invalidated it returns.
    raf: { schedule: (cb: () => void) => { cb(); return 1; }, cancel: () => {} },
    shortcuts: false,
    timeNavigator: false,
  });
  chart.applySize(800, 600);
  chart.addSeries('candlestick').setData(BARS);
  return chart;
}

// `applySize` returns early on a size it already has, so a forced repaint has
// to ask for a height nobody has asked for yet. A pixel of pane either way
// moves no tag on or off the axis.
let height = 600;

/**
 * One fresh frame, with the ops buffer emptied first. The context accumulates
 * across paints, so reading it without this answers about some earlier frame:
 * an assertion that a tag is GONE would pass on the paint that still had it.
 */
function frame(chart: Chart): RecordingContext {
  const rec = chart.panes()[0].base.ctx as unknown as RecordingContext;
  rec.ops.length = 0;
  chart.applySize(800, ++height);
  return rec;
}

const labels = (rec: RecordingContext): string[] =>
  rec.ops.filter((o) => o.type === 'fillText').map((o) => o.text ?? '');

const tagged = (rec: RecordingContext, value: string): boolean =>
  labels(rec).some((t) => t.startsWith(value));

/** Line segments drawn, as a proxy for "the plot itself is still there". */
const strokes = (rec: RecordingContext): number =>
  rec.ops.filter((o) => o.type === 'stroke').length;

describe('per-indicator last-value axis label', () => {
  it('tags the axis by default, the way a study always has', () => {
    const chart = mount();
    chart.addIndicator('lvv-overlay');
    expect(tagged(frame(chart), '105.5')).toBe(true);
  });

  it('drops the tag when the option says so, and keeps the line', () => {
    const off = mount();
    off.addIndicator('lvv-overlay', { lastValueVisible: false });
    const on = mount();
    on.addIndicator('lvv-overlay');
    const offFrame = frame(off);
    const onFrame = frame(on);
    expect(tagged(offFrame, '105.5')).toBe(false);
    expect(tagged(onFrame, '105.5')).toBe(true);
    // the plot itself is untouched: the same strokes, minus none
    expect(strokes(offFrame)).toBe(strokes(onFrame));
  });

  it('answers for every plot of a multi-plot indicator at once', () => {
    const chart = mount();
    chart.addIndicator('lvv-two-plots', { lastValueVisible: false });
    const rec = frame(chart);
    expect(tagged(rec, '105.5')).toBe(false);
    expect(tagged(rec, '106.5')).toBe(false);
  });

  it('is live: setSettings restyles the plots already on the chart', () => {
    const chart = mount();
    const inst = chart.addIndicator('lvv-overlay');
    expect(tagged(frame(chart), '105.5')).toBe(true);

    inst.setSettings({ lastValueVisible: false });
    expect(tagged(frame(chart), '105.5')).toBe(false);

    inst.setSettings({ lastValueVisible: true });
    expect(tagged(frame(chart), '105.5')).toBe(true);
  });

  it('leaves the instrument own last-price tag alone', () => {
    const chart = mount();
    chart.addIndicator('lvv-overlay', { lastValueVisible: false });
    // 111 is the last close, and it still gets the dedicated up/down tag
    expect(tagged(frame(chart), '111')).toBe(true);
  });

  it('is carried in settings, so a saved layout restores it', () => {
    const chart = mount();
    const inst = chart.addIndicator('lvv-overlay', { lastValueVisible: false });
    expect(inst.settings().lastValueVisible).toBe(false);
  });
});
