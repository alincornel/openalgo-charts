/**
 * PriceLine lineWidth / lineStyle options (1.7.0). The legacy `dashed` boolean
 * has to keep producing exactly the pattern it always did, so its expectations
 * are pinned alongside the three-way style that supersedes it.
 */
import { describe, it, expect } from 'vitest';
import { PriceLine, type PriceLineOptions } from '../src/primitives/price-line';
import type { PrimitiveRenderContext } from '../src/primitives/primitive';
import { darkTheme } from '../src/theme';
import { DataLayer } from '../src/model/data-layer';
import { PriceScale } from '../src/scale/price-scale';
import { TimeScale } from '../src/scale/time-scale';
import { RecordingContext } from './helpers/fake-ctx';

function makeRc(dpr = 1): PrimitiveRenderContext {
  const dl = new DataLayer();
  const id = dl.createSeries();
  dl.setSeriesData(id, [{ time: 100, open: 50, high: 52, low: 48, close: 50 }]);
  const priceScale = new PriceScale();
  priceScale.setHeight(400);
  priceScale.setPriceRange({ min: 40, max: 60 });
  const timeScale = new TimeScale({ barSpacing: 20, rightOffset: 0 });
  timeScale.setWidth(600);
  timeScale.setBaseIndex(dl.baseIndex);
  return { timeScale, priceScale, dataLayer: dl, plotWidth: 600, plotHeight: 400, priceAxisWidth: 56, dpr, theme: darkTheme };
}

/** Dash pattern and stroke width in force for the line itself (the first stroke). */
function lineOps(opts: Partial<PriceLineOptions>, dpr = 1): { dash: number[]; width: number } {
  const ctx = new RecordingContext();
  new PriceLine({ price: 50, color: '#fff', id: 'x', ...opts }).draw(ctx as unknown as CanvasRenderingContext2D, makeRc(dpr));
  const at = ctx.ops.findIndex((o) => o.type === 'stroke');
  const dashOp = ctx.ops.slice(0, at).reverse().find((o) => o.type === 'setLineDash');
  return { dash: dashOp?.args ?? [], width: ctx.ops[at]!.lineWidth ?? 0 };
}

describe('PriceLine line style', () => {
  it('is solid and 1px when nothing is set', () => {
    expect(lineOps({})).toEqual({ dash: [], width: 1 });
  });

  it('keeps the legacy dashed boolean byte-identical', () => {
    expect(lineOps({ dashed: true, lineWidth: 1 }).dash).toEqual([4, 4]);
    expect(lineOps({ dashed: false, lineWidth: 1 }).dash).toEqual([]);
    expect(lineOps({ dashed: true, lineWidth: 1 }, 2).dash).toEqual([8, 8]);
  });

  it('honours the three-way lineStyle', () => {
    expect(lineOps({ lineStyle: 'solid' }).dash).toEqual([]);
    expect(lineOps({ lineStyle: 'dashed' }).dash).toEqual([4, 4]);
    expect(lineOps({ lineStyle: 'dotted' }).dash).toEqual([1, 3]);
    expect(lineOps({ lineStyle: 'dotted' }, 2).dash).toEqual([2, 6]);
  });

  it('lets lineStyle win over dashed when both are given', () => {
    expect(lineOps({ dashed: true, lineStyle: 'solid' }).dash).toEqual([]);
    expect(lineOps({ dashed: false, lineStyle: 'dotted' }).dash).toEqual([1, 3]);
  });

  it('scales lineWidth by dpr and never drops below a hairline', () => {
    expect(lineOps({ lineWidth: 3 }).width).toBe(3);
    expect(lineOps({ lineWidth: 3 }, 2).width).toBe(6);
    expect(lineOps({ lineWidth: 0.2 }).width).toBe(1);
  });
});
