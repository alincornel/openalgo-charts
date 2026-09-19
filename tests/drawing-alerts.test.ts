import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertController, Chart, PriceLine, registerIndicator } from '../src/index';
import { DrawingController, type DrawingInput } from '../src/draw/index';
import type { AlertTriggeredPayload, Bar } from '../src/index';
import { fakeDocument } from './helpers/fake-dom';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const destroy of cleanup.splice(0).reverse()) destroy(); });
const bar = (time: number, close: number): Bar => ({ time, open: close, high: close + 1, low: close - 1, close });
const point = (time: number, price: number) => ({ time, price });

function setup(times = [60, 120, 180, 240, 300]) {
  const doc = fakeDocument();
  const chart = new Chart(doc.createElement('div'), {
    document: doc, pixelRatio: () => 1, shortcuts: false,
    raf: { schedule: callback => { callback(); return 1; }, cancel: () => {} },
  });
  cleanup.push(() => chart.destroy());
  chart.applySize(800, 600);
  const series = chart.addSeries('candlestick');
  series.setData(times.map(time => bar(time, 100)));
  const draw = new DrawingController(chart);
  cleanup.push(() => draw.destroy());
  return { chart, series, draw };
}

function add(draw: DrawingController, input: Omit<DrawingInput, 'style' | 'paneIndex'> & Partial<Pick<DrawingInput, 'style' | 'paneIndex'>>) {
  return draw.add({ style: {}, paneIndex: 0, ...input });
}

describe('drawing alert values', () => {
  it('resolves a finite trend segment and returns no value beyond its endpoints', () => {
    const { draw } = setup();
    const drawing = add(draw, { tool: 'trend-line', points: [point(120, 100), point(240, 200)] });
    expect(draw.valueAt(drawing.id, 180)?.price).toBeCloseTo(150);
    expect(draw.valueAt(drawing.id, 120)?.price).toBeCloseTo(100);
    expect(draw.valueAt(drawing.id, 240)?.price).toBeCloseTo(200);
    expect(draw.valueAt(drawing.id, 60)).toBeUndefined();
    expect(draw.valueAt(drawing.id, 300)).toBeUndefined();
    expect(draw.alertInfo(drawing.id)).toMatchObject({ available: true, paneIndex: 0 });
  });

  it('uses logical spacing across a collapsed session gap', () => {
    const { draw, chart } = setup([60, 120, 90000]);
    const drawing = add(draw, { tool: 'trend-line', points: [point(60, 100), point(90000, 200)] });
    expect(draw.valueAt(drawing.id, 120)?.price).toBeCloseTo(150);
    chart.setVisibleLogicalRange({ from: -10, to: 10 });
    expect(draw.valueAt(drawing.id, 120)?.price).toBeCloseTo(150);
  });

  it('uses the same logarithmic projection as the drawn line', () => {
    const { draw, chart } = setup();
    chart.panes()[0].priceScale.setOptions({ mode: 'logarithmic' });
    const drawing = add(draw, { tool: 'trend-line', points: [point(120, 100), point(240, 400)] });
    const renderedMid = (chart.priceToCoordinate(100)! + chart.priceToCoordinate(400)!) / 2;
    const expected = chart.coordinateToPrice(renderedMid)!;
    expect(draw.valueAt(drawing.id, 180)?.price).toBeCloseTo(expected, 6);
    expect(expected).not.toBeCloseTo(250);
    chart.panes()[0].priceScale.setOptions({ inverted: true });
    expect(draw.valueAt(drawing.id, 180)?.price).toBeCloseTo(expected, 6);
  });

  it.each([
    ['ray', {}, 300, 250, 60],
    ['ray', { extendLeft: true, extendRight: false }, 60, 50, 300],
    ['extended-line', {}, 300, 250, undefined],
    ['extended-line', {}, 60, 50, undefined],
  ] as const)('honors %s extensions %j', (tool, style, time, value, absent) => {
    const { draw } = setup();
    const drawing = add(draw, { tool, style, points: [point(120, 100), point(240, 200)] });
    expect(draw.valueAt(drawing.id, time)?.price).toBeCloseTo(value);
    if (absent !== undefined) expect(draw.valueAt(drawing.id, absent)).toBeUndefined();
  });

  it('keeps reversed anchors and explicit extensions consistent with the rendered segment', () => {
    const { draw } = setup();
    const drawing = add(draw, { tool: 'trend-line', points: [point(240, 200), point(120, 100)] });
    expect(draw.valueAt(drawing.id, 180)?.price).toBeCloseTo(150);
    draw.update(drawing.id, { style: { extendLeft: true } });
    expect(draw.valueAt(drawing.id, 60)?.price).toBeCloseTo(50);
    expect(draw.valueAt(drawing.id, 180)).toBeUndefined();
  });

  it('resolves horizontal levels and the finite start of a horizontal ray', () => {
    const { draw } = setup();
    const line = add(draw, { tool: 'horizontal-line', points: [point(180, 0)] });
    const ray = add(draw, { tool: 'horizontal-ray', points: [point(180, 105)] });
    expect(draw.valueAt(line.id, 60)?.price).toBe(0);
    expect(draw.valueAt(ray.id, 120)).toBeUndefined();
    expect(draw.valueAt(ray.id, 240)?.price).toBe(105);
  });

  it('resolves both channel boundaries, the middle and a sorted band', () => {
    const { draw } = setup();
    const drawing = add(draw, { tool: 'parallel-channel', points: [point(120, 100), point(240, 120), point(180, 130)] });
    expect(draw.valueAt(drawing.id, 180)).toMatchObject({ price: 110, upperPrice: 130, paneIndex: 0 });
    expect(draw.valueAt(drawing.id, 180, 'base')?.price).toBeCloseTo(110);
    expect(draw.valueAt(drawing.id, 180, 'boundary')?.price).toBeCloseTo(130);
    expect(draw.valueAt(drawing.id, 180, 'middle')?.price).toBeCloseTo(120);
    expect(draw.valueAt(drawing.id, 300)).toBeUndefined();
    draw.update(drawing.id, { points: [point(120, 100), point(240, 120), point(180, 90)] });
    const band = draw.valueAt(drawing.id, 180)!;
    expect(band.price).toBeCloseTo(90);
    expect(band.upperPrice).toBeCloseTo(110);
  });

  it.each([
    ['disjoint-channel', [point(120, 100), point(240, 120), point(120, 90), point(240, 100)], 95, 110],
    ['flat-top-bottom', [point(120, 100), point(240, 120), point(180, 90)], 90, 110],
  ] as const)('resolves %s against its actual boundaries', (tool, points, lower, upper) => {
    const { draw } = setup();
    const drawing = add(draw, { tool, points: [...points] });
    const value = draw.valueAt(drawing.id, 180)!;
    expect(value.price).toBeCloseTo(lower);
    expect(value.upperPrice).toBeCloseTo(upper);
  });

  it('uses screen-edge extension for reversed advanced channel anchors', () => {
    const { draw } = setup();
    const drawing = add(draw, { tool: 'disjoint-channel', style: { extendLeft: true },
      points: [point(240, 120), point(120, 100), point(240, 100), point(120, 90)] });
    const value = draw.valueAt(drawing.id, 180)!;
    expect(value.price).toBeCloseTo(95);
    expect(value.upperPrice).toBeCloseTo(110);
    expect(draw.valueAt(drawing.id, 60)).toBeDefined();
    expect(draw.valueAt(drawing.id, 300)).toBeUndefined();
  });

  it.each([
    ['fib-retracement', [point(120, 100), point(240, 200)], 150],
    ['fib-extension', [point(120, 100), point(180, 200), point(240, 120)], 170],
    ['fib-extension-two-point', [point(120, 100), point(240, 200)], 150],
  ] as const)('requires a specific active rung for %s', (tool, points, value) => {
    const { draw, chart } = setup();
    const drawing = add(draw, { tool, points: [...points], style: { levels: [{ ratio: 0.5, label: 'Half' }, { ratio: 0.8, enabled: false }] } });
    expect(draw.valueAt(drawing.id, 180)).toBeUndefined();
    expect(draw.alertInfo(drawing.id).levels).toEqual([{ id: 'ratio:0.5', title: 'Half' }]);
    expect(draw.valueAt(drawing.id, 180, 'ratio:0.5')?.price).toBe(value);
    expect(draw.valueAt(drawing.id, 180, 'ratio:0.8')).toBeUndefined();
    expect(draw.valueAt(drawing.id, 300, 'ratio:0.5')).toBeUndefined();
    draw.update(drawing.id, { style: { extendRight: true } });
    chart.panes()[0].priceScale.setOptions({ mode: 'logarithmic' });
    expect(draw.valueAt(drawing.id, 300, 'ratio:0.5')?.price).toBe(value);
  });

  it('uses the actual shifted anchors of each fib channel rung', () => {
    const { draw } = setup();
    const drawing = add(draw, { tool: 'fib-channel', points: [point(120, 100), point(240, 120), point(300, 160)],
      style: { levels: [{ ratio: 0.5 }] } });
    expect(draw.valueAt(drawing.id, 120, 'ratio:0.5')).toBeUndefined();
    expect(draw.valueAt(drawing.id, 180, 'ratio:0.5')?.price).toBeCloseTo(125);
  });

  it('reports unsupported tools and degenerate geometry without inventing a level', () => {
    const { draw } = setup();
    const shape = add(draw, { tool: 'ellipse', points: [point(120, 100), point(240, 200)] });
    const vertical = add(draw, { tool: 'trend-line', points: [point(120, 100), point(120, 200)] });
    expect(draw.alertInfo(shape.id)).toMatchObject({ available: false, reason: expect.stringMatching(/numeric|value/i) });
    expect(draw.valueAt(shape.id, 180)).toBeUndefined();
    expect(draw.valueAt(vertical.id, 120)).toBeUndefined();
    expect(draw.alertInfo('missing')).toMatchObject({ available: false, reason: expect.stringMatching(/missing|unavailable/i) });
  });
});

function alertSetup(times?: number[]) {
  const rig = setup(times);
  const alerts = new AlertController(rig.chart, { drawings: rig.draw });
  cleanup.push(() => alerts.destroy());
  const fired: AlertTriggeredPayload[] = [];
  rig.chart.on('alert:triggered', event => fired.push(event as AlertTriggeredPayload));
  return { ...rig, alerts, fired };
}

describe('drawing alert evaluation and lifecycle', () => {
  it('follows a moved level, using fresh market observations after the edit', () => {
    const { draw, series, alerts, fired } = alertSetup([60, 120]);
    const drawing = add(draw, { tool: 'horizontal-line', points: [point(120, 110)] });
    alerts.add({ source: { kind: 'drawing', drawingId: drawing.id }, condition: 'crossingUp', policy: 'onTouch' });
    draw.update(drawing.id, { points: [point(120, 105)] });
    series.update({ ...bar(120, 100), high: 104 });
    expect(fired).toEqual([]);
    series.update({ ...bar(120, 100), high: 106 });
    expect(fired.map(event => event.price)).toEqual([105]);
  });

  it('compares each closed bar with the line value at that bar, rather than one fixed threshold', () => {
    const { draw, series, alerts, fired } = alertSetup([60, 120]);
    const drawing = add(draw, { tool: 'extended-line', points: [point(60, 105), point(120, 95)] });
    alerts.add({ source: { kind: 'drawing', drawingId: drawing.id }, condition: 'crossingUp' });
    series.update(bar(180, 100));
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ time: 120, price: 100 });
  });

  it('distinguishes a touched drawing from an unconfirmed erased wick', () => {
    const { draw, series, alerts, fired } = alertSetup([60, 120]);
    const drawing = add(draw, { tool: 'horizontal-line', points: [point(120, 105)] });
    const close = alerts.add({ source: { kind: 'drawing', drawingId: drawing.id }, condition: 'crossingUp' });
    const touch = alerts.add({ source: { kind: 'drawing', drawingId: drawing.id }, condition: 'crossingUp', policy: 'onTouch' });
    series.update({ ...bar(120, 100), high: 106 });
    series.update(bar(120, 100));
    series.update(bar(180, 100));
    expect(fired.map(event => event.alertId)).toEqual([touch.id]);
    expect(alerts.list().find(item => item.id === close.id)?.state).toBe('armed');
  });

  it('evaluates entering and leaving a channel band with moving boundaries', () => {
    const { draw, series, alerts, fired } = alertSetup([60, 120]);
    const drawing = add(draw, { tool: 'parallel-channel', points: [point(60, 105), point(180, 105), point(120, 115)] });
    alerts.add({ source: { kind: 'drawing', drawingId: drawing.id, level: 'band' }, condition: 'enteringRange' });
    series.update(bar(120, 110));
    series.update(bar(180, 120));
    expect(fired.map(event => event.time)).toEqual([120]);
    alerts.add({ source: { kind: 'drawing', drawingId: drawing.id, level: 'band' }, condition: 'leavingRange' });
    series.update(bar(240, 120));
    expect(fired.map(event => event.time)).toEqual([120, 180]);
  });

  it.each(['remove', 'undo', 'replace'] as const)('removes anchored alerts when drawings disappear through %s', method => {
    const { chart, draw, alerts } = alertSetup();
    const removed: unknown[] = [];
    chart.on('alert:removed', value => removed.push(value));
    const drawing = add(draw, { tool: 'horizontal-line', points: [point(120, 105)] });
    const alert = alerts.add({ source: { kind: 'drawing', drawingId: drawing.id } });
    if (method === 'remove') draw.remove(drawing.id);
    if (method === 'undo') draw.undo();
    if (method === 'replace') draw.fromJSON({ version: 2, drawings: [] });
    expect(alerts.list()).toEqual([]);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ alert: { id: alert.id }, reason: 'drawing-removed' });
    if (method === 'undo') { draw.redo(); expect(alerts.list()).toEqual([]); }
  });

  it('does not compare a non-price drawing against the primary price', () => {
    registerIndicator({ id: 'drawing-alert-reading', name: 'Reading', placement: 'pane', inputs: [],
      plots: [{ key: 'v', title: 'Value', type: 'line' }], calc: bars => ({ v: bars.map(item => item.volume ?? null) }) });
    const { chart, draw, series, alerts, fired } = alertSetup([60, 120]);
    series.setData([{ ...bar(60, 100), volume: 20 }, { ...bar(120, 100), volume: 20 }]);
    const study = chart.addIndicator('drawing-alert-reading');
    const drawing = add(draw, { tool: 'horizontal-line', points: [point(120, 25)], paneIndex: study.paneIndex });
    const missing = alerts.add({ source: { kind: 'drawing', drawingId: drawing.id }, policy: 'onTouch', condition: 'greaterThan' });
    expect(alerts.availability(missing.id)).toMatchObject({ available: false, reason: expect.stringMatching(/input|plot/i) });
    const alert = alerts.add({ source: { kind: 'drawing', drawingId: drawing.id, input: { instanceId: study.id, plotKey: 'v' } },
      policy: 'onTouch', condition: 'crossingUp' });
    series.update({ ...bar(120, 200), volume: 20 });
    expect(fired).toEqual([]);
    series.update({ ...bar(120, 200), volume: 30 });
    expect(fired.map(event => event.alertId)).toEqual([alert.id]);
    expect(fired[0].price).toBe(30);
  });

  it('reports unsupported tools and missing selected rungs as unavailable', () => {
    const { draw, alerts, series, fired } = alertSetup([60, 120]);
    const shape = add(draw, { tool: 'ellipse', points: [point(60, 90), point(120, 110)] });
    const shapeAlert = alerts.add({ source: { kind: 'drawing', drawingId: shape.id } });
    expect(alerts.availability(shapeAlert.id).available).toBe(false);
    const fib = add(draw, { tool: 'fib-retracement', points: [point(60, 100), point(120, 120)], style: { extendRight: true } });
    const alert = alerts.add({ source: { kind: 'drawing', drawingId: fib.id, level: 'ratio:0.5' }, condition: 'crossingUp', policy: 'onTouch' });
    draw.update(fib.id, { style: { levels: [{ ratio: 0.5, enabled: false }] } });
    expect(alerts.availability(alert.id).available).toBe(false);
    series.update(bar(120, 130));
    expect(fired).toEqual([]);
  });
});

describe('alert line visuals', () => {
  it('uses PriceLine and visibly distinguishes every lifecycle state', () => {
    const { chart, alerts, series } = alertSetup([60, 120]);
    const attach = vi.spyOn(chart, 'addPrimitive');
    const alert = alerts.add({ source: { kind: 'price', price: 105 }, title: 'Breakout', policy: 'onTouch', condition: 'crossingUp' });
    const line = attach.mock.calls.map(([primitive]) => primitive).find(primitive => primitive instanceof PriceLine) as PriceLine;
    expect(line).toBeInstanceOf(PriceLine);
    const colors = [line.options().color];
    expect(line.options().badge?.toLowerCase()).toContain('armed');
    series.update({ ...bar(120, 100), high: 106 });
    colors.push(line.options().color);
    expect(line.options().badge?.toLowerCase()).toContain('triggered');
    alerts.disable(alert.id);
    colors.push(line.options().color);
    expect(line.options().badge?.toLowerCase()).toContain('disabled');
    alerts.update(alert.id, { state: 'armed', expiresAt: 1 });
    colors.push(line.options().color);
    expect(line.options().badge?.toLowerCase()).toContain('expired');
    expect(new Set(colors).size).toBe(4);
    expect(chart.exportSVG()).toContain('Breakout');
  });

  it('moves a drawing level in place and removes its visual with its alert', () => {
    const { chart, draw, alerts } = alertSetup();
    const drawing = add(draw, { tool: 'horizontal-line', points: [point(120, 105)] });
    const attach = vi.spyOn(chart, 'addPrimitive');
    const detach = vi.spyOn(chart, 'removePrimitive');
    alerts.add({ source: { kind: 'drawing', drawingId: drawing.id } });
    const lines = attach.mock.calls.map(([primitive]) => primitive).filter(primitive => primitive instanceof PriceLine) as PriceLine[];
    expect(lines).toHaveLength(1);
    draw.update(drawing.id, { points: [point(120, 115)] });
    expect(lines[0].price).toBe(115);
    expect(attach.mock.calls.filter(([primitive]) => primitive instanceof PriceLine)).toHaveLength(1);
    draw.remove(drawing.id);
    expect(detach).toHaveBeenCalledWith(lines[0]);
  });

  it('hides an instrument level during a context mismatch and cleans it on destroy', () => {
    const { chart, alerts } = alertSetup();
    chart.setDataContext({ symbol: 'ONE' });
    alerts.add({ source: { kind: 'price', price: 105 }, title: 'Owned level' });
    expect(chart.exportSVG()).toContain('Owned level');
    chart.setDataContext({ symbol: 'TWO' });
    expect(chart.exportSVG()).not.toContain('Owned level');
    chart.setDataContext({ symbol: 'ONE' });
    expect(chart.exportSVG()).toContain('Owned level');
    alerts.destroy();
    expect(chart.exportSVG()).not.toContain('Owned level');
  });
});
