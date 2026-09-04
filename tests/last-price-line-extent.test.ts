/**
 * Where the dashed last-price line starts.
 *
 * Full width is the classic reading and stays the default. `fromLastBar` is
 * for a trader watching the right-hand edge: the line marks where price IS,
 * instead of ruling a dashed line back across every candle behind it.
 */
import { describe, it, expect } from 'vitest';
import { drawLastPriceLabel } from '../src/render/axis';
import { PriceScale } from '../src/scale/price-scale';
import type { PlotLayout } from '../src/render/axis';

function lineStart(lineFromX?: number): number {
  const moves: number[] = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, stroke() {}, fill() {}, fillRect() {},
    setLineDash() {}, measureText: () => ({ width: 40 }), fillText() {},
    moveTo(x: number) { moves.push(x); }, lineTo() {},
    strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
  } as unknown as CanvasRenderingContext2D;
  const scale = new PriceScale();
  scale.setHeight(400);
  scale.setPriceRange({ min: 90, max: 110 });
  const layout = { plotWidth: 600, plotHeight: 400 } as PlotLayout;
  drawLastPriceLabel(ctx, scale, 100, true, layout, 1, undefined, undefined, true, false, undefined, lineFromX);
  return moves[0];
}

describe('last-price line extent', () => {
  it('spans the whole plot by default', () => {
    expect(lineStart()).toBe(0);
  });

  it('starts where the host says the last bar is', () => {
    expect(lineStart(420)).toBe(420);
  });

  it('clamps a bar scrolled off the left back onto the canvas', () => {
    expect(lineStart(-200)).toBe(0);
  });

  it('never starts past the right edge, which would stroke backwards', () => {
    expect(lineStart(5000)).toBe(600);
  });
});
