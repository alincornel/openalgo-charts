/**
 * A last-price tag that holds one colour.
 *
 * The instrument's axis tag and its dashed price line borrow the last bar's
 * own colour, so on a live feed they flip green to red and back with every
 * tick that crosses the open. A reader watching the right-hand edge for where
 * price IS then has to re-find a label that keeps changing what it looks like.
 *
 * `lastValueLabelColor` fixes both to one colour, whichever way the bar closed,
 * and picks the tag's text for contrast against it. Unset, nothing moves.
 */
import { describe, it, expect } from 'vitest';
import { Pane, type PaneRenderContext } from '../src/core/pane';
import { DataLayer } from '../src/model/data-layer';
import { TimeScale } from '../src/scale/time-scale';
import { createSeriesRecord } from '../src/model/series';
import { darkTheme } from '../src/theme';
import { fakeDocument } from './helpers/fake-dom';
import type { RecordingContext } from './helpers/fake-ctx';
import type { Bar } from '../src/model/bar';

const FIXED = '#8892a6';
const WIDTH = 600;
const AXIS_WIDTH = 56;
/** Where the price-axis strip begins, and so where a tag box can start. */
const PLOT_W = WIDTH - AXIS_WIDTH;

const flat = (time: number, v: number): Bar => ({ time, open: v, high: v, low: v, close: v });

/** An up or a down last bar, closing on the same price either way. */
function bars(up: boolean): Bar[] {
  return [
    { time: 1000, open: 1330, high: 1336, low: 1328, close: 1335 },
    { time: 1060, open: 1335, high: 1341, low: 1333, close: 1338 },
    up
      ? { time: 1120, open: 1336, high: 1342, low: 1335, close: 1340 }
      : { time: 1120, open: 1344, high: 1345, low: 1338, close: 1340 },
  ];
}

/** A pane carrying the instrument, plus whatever overlay the case needs. */
function paint(
  up: boolean,
  style?: Record<string, unknown>,
  overlay?: { values: number[]; style: Record<string, unknown> },
): RecordingContext {
  const dl = new DataLayer();
  const ts = new TimeScale({ barSpacing: 30 });
  ts.setWidth(WIDTH);
  const id = dl.createSeries();
  dl.setSeriesData(id, bars(up));
  const pane = new Pane(fakeDocument());
  pane.addSeries(createSeriesRecord(id, 'candlestick', style));
  if (overlay !== undefined) {
    const oid = dl.createSeries();
    dl.setSeriesData(oid, overlay.values.map((v, i) => flat(1000 + i * 60, v)));
    pane.addSeries(createSeriesRecord(oid, 'line', overlay.style));
  }
  pane.resize(WIDTH, 400, 1);
  ts.setBaseIndex(dl.baseIndex);
  const ctx: PaneRenderContext = {
    timeScale: ts, dataLayer: dl, dpr: 1, priceAxisWidth: AXIS_WIDTH, timeAxisHeight: 22,
    showTimeAxis: true, conflate: false, conflationFactor: 1, theme: darkTheme,
    showVertGrid: false, showHorzGrid: false,
  };
  // Without this the scale sits on its 0..1 placeholder and every tag bails as
  // out of plot, which is a green suite proving nothing.
  pane.autoscale(ctx);
  pane.paintBase(ctx);
  return pane.base.ctx as unknown as RecordingContext;
}

interface Tag { fill: string; label: string; text: string; }

/** Every filled tag drawn into the axis strip, in paint order. */
function axisTags(rec: RecordingContext): Tag[] {
  const out: Tag[] = [];
  for (let i = 0; i < rec.ops.length; i++) {
    const box = rec.ops[i];
    if (box.type !== 'fillRect' || box.args[0] < PLOT_W) continue;
    const label = rec.ops.slice(i + 1).find((o) => o.type === 'fillText');
    if (label === undefined) continue;
    out.push({ fill: box.fillStyle ?? '', label: label.text ?? '', text: label.fillStyle ?? '' });
  }
  return out;
}

/** The instrument's own tag: the only one on a pane carrying no overlay. */
const lastTag = (rec: RecordingContext): Tag | undefined => axisTags(rec)[0];

/** The dashed price line: the first stroke drawn with a dash set. */
function lineColor(rec: RecordingContext): string | undefined {
  let dashed = false;
  for (const op of rec.ops) {
    if (op.type === 'setLineDash') dashed = op.args.length > 0;
    if (op.type === 'stroke' && dashed) return op.strokeStyle;
  }
  return undefined;
}

describe('lastValueLabelColor', () => {
  it('is unset by default, so the tag still takes the bar direction', () => {
    const up = lastTag(paint(true));
    const down = lastTag(paint(false));
    expect(up?.fill).toBe(darkTheme.lastPriceUp);
    expect(down?.fill).toBe(darkTheme.lastPriceDown);
    expect(up?.fill).not.toBe(down?.fill);
    expect(up?.text).toBe(darkTheme.lastPriceText);
    // both bars close at the same price, so only the colour is under test
    expect(up?.label).toBe(down?.label);
  });

  it('holds one colour whichever way the last bar closed', () => {
    expect(lastTag(paint(true, { lastValueLabelColor: FIXED }))?.fill).toBe(FIXED);
    expect(lastTag(paint(false, { lastValueLabelColor: FIXED }))?.fill).toBe(FIXED);
  });

  it('colours the dashed price line to match, not only the tag', () => {
    expect(lineColor(paint(false))).toBe(darkTheme.lastPriceDown);
    expect(lineColor(paint(true))).toBe(darkTheme.lastPriceUp);
    expect(lineColor(paint(false, { lastValueLabelColor: FIXED }))).toBe(FIXED);
    expect(lineColor(paint(true, { lastValueLabelColor: FIXED }))).toBe(FIXED);
  });

  it('picks tag text that stays legible on the colour it was given', () => {
    // The theme text is chosen for the up/down pair and can vanish on a colour
    // it never expected, so the pill renderer's contrast helper decides here.
    expect(lastTag(paint(true, { lastValueLabelColor: '#f7e08a' }))?.text).toBe('#10131a');
    expect(lastTag(paint(true, { lastValueLabelColor: '#1a237e' }))?.text).toBe('#ffffff');
  });

  it('leaves lastValueVisible and priceLineVisible in charge of what is drawn', () => {
    const noTag = paint(true, { lastValueLabelColor: FIXED, lastValueVisible: false });
    expect(axisTags(noTag)).toEqual([]);
    expect(lineColor(noTag)).toBe(FIXED); // the line is a separate switch
    const noLine = paint(true, { lastValueLabelColor: FIXED, priceLineVisible: false });
    expect(lineColor(noLine)).toBeUndefined();
    expect(lastTag(noLine)?.fill).toBe(FIXED);
  });

  it('fixes an overlay own axis tag too, not just the instrument', () => {
    const rec = paint(true, undefined, {
      values: [1332, 1333, 1333.5],
      style: { color: '#ff9800', lastValueLabelColor: FIXED },
    });
    const tags = axisTags(rec);
    // the overlay draws its line in its own colour and its tag in the fixed one
    const overlay = tags.find((t) => t.label.startsWith('1333'));
    expect(overlay?.fill).toBe(FIXED);
    // the instrument's own tag is untouched by the overlay's setting
    expect(tags.find((t) => t.label.startsWith('1340'))?.fill).toBe(darkTheme.lastPriceUp);
  });
});
