import { describe, expect, it, vi } from 'vitest';
import { getDrawingTool, registerBuiltinDrawingTools } from '../src/draw/tools';
import { fixedRangeVolumeProfileFromLevels } from '../src/draw/analysis';
import type { Bar, PrimitiveRenderContext } from '../src';
import type { Drawing, VolumeAtPriceSource } from '../src/draw/types';
import { RecordingContext } from './helpers/fake-ctx';

// Fork: the Fixed Range Volume Profile accepts a host's REAL volume at price
// (traded volume per price from its own tick data) instead of spreading each
// candle's volume evenly over its range.

registerBuiltinDrawingTools();
const bar = (time: number, close: number, volume: number): Bar => ({ time, open: close, high: close + 2, low: close - 2, close, volume });
function context(bars: Bar[]): PrimitiveRenderContext {
  return {
    plotWidth: 500, plotHeight: 400, dpr: 1, bars: () => bars,
    dataLayer: { timeToIndexFloat: (time: number) => time / 60 },
    timeScale: { indexToX: (index: number) => 50 + index * 100 },
    priceScale: { priceToY: (price: number) => 400 - price * 10, format: (price: number) => price.toFixed(2) },
  } as unknown as PrimitiveRenderContext;
}
const frvp = (): Drawing => ({
  id: 'frvp', tool: 'fixed-range-volume-profile', paneIndex: 0, zIndex: 0,
  points: [{ time: 0, price: 12 }, { time: 120, price: 25 }],
  style: { ...getDrawingTool('fixed-range-volume-profile').defaultStyle }, props: {},
});
function paint(d: Drawing, rc: PrimitiveRenderContext, volumeAtPrice?: VolumeAtPriceSource): RecordingContext {
  const rec = new RecordingContext();
  getDrawingTool(d.tool).draw({
    drawing: d, rc, ctx: rec as unknown as CanvasRenderingContext2D,
    pts: d.points.map(p => ({ x: rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(p.time)), y: rc.priceScale.priceToY(p.price) })),
    style: { color: '#123456', lineWidth: 1.5, ...d.style }, selected: false, formatPrice: p => p.toFixed(2), volumeAtPrice,
  });
  return rec;
}
const texts = (rec: RecordingContext): string[] => rec.ops.filter(o => o.type === 'fillText').map(o => String(o.text ?? ''));

describe('fixed range volume profile from real volume at price', () => {
  it('builds one row per price when there are fewer prices than rows, POC on the busiest', () => {
    const result = fixedRangeVolumeProfileFromLevels(
      [{ price: 10, volume: 5 }, { price: 10.25, volume: 40 }, { price: 10.5, volume: 15 }], { rows: 48, valueArea: 70 });
    expect(result.status).toBe('ready');
    expect(result.rows.map(r => r.volume)).toEqual([5, 40, 15]);
    expect(result.totalVolume).toBe(60);
    expect(result.poc).toBe(10.25);
    expect(result.rows[1]).toMatchObject({ low: 10.125, high: 10.375, valueArea: true });
  });
  it('groups many prices into the requested rows and conserves volume', () => {
    const levels = Array.from({ length: 100 }, (_, i) => ({ price: 100 + i * 0.25, volume: i === 50 ? 500 : 1 }));
    const result = fixedRangeVolumeProfileFromLevels(levels, { rows: 10 });
    expect(result.rows).toHaveLength(10);
    expect(result.rows.reduce((s, r) => s + r.volume, 0)).toBe(599);
    const pocRow = result.rows.find(r => r.low <= 112.5 && 112.5 < r.high)!;
    expect(result.poc).toBe((pocRow.low + pocRow.high) / 2);
  });
  it('drops invalid levels and reports empty / zero volume like the estimate does', () => {
    expect(fixedRangeVolumeProfileFromLevels([]).status).toBe('empty');
    expect(fixedRangeVolumeProfileFromLevels([{ price: 10, volume: 0 }]).status).toBe('zero-volume');
    const r = fixedRangeVolumeProfileFromLevels([{ price: Number.NaN, volume: 3 }, { price: 10, volume: 2 }]);
    expect(r.totalVolume).toBe(2);
    expect(r.invalidPriceBars).toBe(1);
  });
  it('the tool asks the host for the drawing’s time range and drops "(estimated)" when it answers', () => {
    const bars = [bar(0, 15, 10), bar(60, 18, 20), bar(120, 21, 30)];
    const source = vi.fn<VolumeAtPriceSource>(() => [{ price: 15, volume: 3 }, { price: 18, volume: 9 }, { price: 21, volume: 1 }]);
    const labels = texts(paint(frvp(), context(bars), source));
    expect(source).toHaveBeenCalledWith(expect.objectContaining({ fromTime: 0, toTime: 120 }));
    expect(labels.some(t => t.startsWith('Volume profile') && !t.includes('(estimated)'))).toBe(true);
  });
  it('falls back to the candle estimate while the host has nothing (null)', () => {
    const bars = [bar(0, 15, 10), bar(60, 18, 20), bar(120, 21, 30)];
    const labels = texts(paint(frvp(), context(bars), () => null));
    expect(labels.some(t => t.includes('(estimated)'))).toBe(true);
    expect(texts(paint(frvp(), context(bars))).some(t => t.includes('(estimated)'))).toBe(true);
  });
});
