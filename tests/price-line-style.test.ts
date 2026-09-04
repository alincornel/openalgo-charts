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

function makeRc(dpr = 1, touchTargets = false): PrimitiveRenderContext {
  const dl = new DataLayer();
  const id = dl.createSeries();
  dl.setSeriesData(id, [{ time: 100, open: 50, high: 52, low: 48, close: 50 }]);
  const priceScale = new PriceScale();
  priceScale.setHeight(400);
  priceScale.setPriceRange({ min: 40, max: 60 });
  const timeScale = new TimeScale({ barSpacing: 20, rightOffset: 0 });
  timeScale.setWidth(600);
  timeScale.setBaseIndex(dl.baseIndex);
  return { timeScale, priceScale, dataLayer: dl, plotWidth: 600, plotHeight: 400, priceAxisWidth: 56, dpr, theme: darkTheme, touchTargets };
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

/** Where the line starts, and where the pill group starts, in media px. */
function geometry(opts: Partial<PriceLineOptions>): { lineX0: number; pillX0: number } {
  const ctx = new RecordingContext();
  new PriceLine({ price: 50, color: '#fff', id: 'x', badge: 'LONG', ...opts })
    .draw(ctx as unknown as CanvasRenderingContext2D, makeRc(1));
  const lineX0 = ctx.ops.filter((o) => o.type === 'moveTo').map((o) => o.args[0])[0] ?? -1;
  // The pill group's backplate is the first roundRect drawn after the axis tag.
  const pillX0 = ctx.ops.filter((o) => o.type === 'roundRect').map((o) => o.args[0])[0] ?? -1;
  return { lineX0, pillX0 };
}

describe('PriceLine autoscale', () => {
  it('reports its price by default, and nothing when asked not to', () => {
    const line = (autoscale?: boolean): PriceLine =>
      new PriceLine({ price: 50, color: '#fff', id: 'x', autoscale });
    expect(line().autoscaleInfo()).toEqual({ min: 50, max: 50 });
    expect(line(true).autoscaleInfo()).toEqual({ min: 50, max: 50 });
    expect(line(false).autoscaleInfo()).toBeNull();
  });
});

describe('PriceLine extent and pill anchor', () => {
  it('spans the whole plot by default, pill at the left edge', () => {
    // The 6px inset is the margin a pill flush against the edge gets.
    expect(geometry({})).toEqual({ lineX0: 0, pillX0: 6 });
  });

  it('starts a partial line where its extent says, and anchors the pill there', () => {
    expect(geometry({ extentFromRight: 0.3 })).toEqual({ lineX0: 420, pillX0: 420 });
  });

  it('lets the pill stay put while the line runs full width', () => {
    // The combination the trading overlay uses: a level readable all the way
    // across, with its buttons still near the price axis where the eye is.
    expect(geometry({ extentFromRight: 1, pillInsetFromRight: 0.3 }))
      .toEqual({ lineX0: 0, pillX0: 420 });
  });

  it('clamps both fractions into 0..1', () => {
    // `pillX0` is 560 rather than the plot's 600 because the group is also kept
    // INSIDE the plot: an inset of 0 asks for the far right edge, and honouring
    // that literally would push the pill's width out over the price axis. It
    // used to do exactly that, which is how an order's ✕ ended up on the scale,
    // unreachable, and the order uncancellable from the chart.
    expect(geometry({ extentFromRight: 5, pillInsetFromRight: -2 }))
      .toEqual({ lineX0: 0, pillX0: 560 });
  });

  it('never lets a pill spill over the price axis', () => {
    // The regression that prompted the clamp: a default order pill
    // ([SIDE][qty][TYPE][×]) on a phone-width plot.
    const { pillX0 } = geometry({ extentFromRight: 1, pillInsetFromRight: 0 });
    expect(pillX0).toBeLessThan(600);
    expect(pillX0).toBeGreaterThanOrEqual(0);
  });
});

describe('PriceLine touch targets', () => {
  /** Pill box height and left edge, in media px — the tap target's geometry. */
  function pillBox(touch: boolean): { height: number; x0: number } {
    const ctx = new RecordingContext();
    new PriceLine({ price: 50, color: '#fff', id: 'x', badge: 'LONG', qty: '1', closeButton: true })
      .draw(ctx as unknown as CanvasRenderingContext2D, makeRc(1, touch));
    const rects = ctx.ops.filter((o) => o.type === 'roundRect');
    return { height: rects[0]?.args[3] ?? 0, x0: rects[0]?.args[0] ?? -1 };
  }

  it('draws a taller pill when the host says the pointer is a finger', () => {
    // 18 px of box is sized for a cursor a foot from the glass. A thumb is
    // about 9 mm across and the phone is held at arm's length, so the same
    // pill is both hard to hit and hard to read. Height is what a tap target
    // is judged on, so it is what this asserts.
    const mouse = pillBox(false);
    const finger = pillBox(true);
    expect(finger.height).toBeGreaterThan(mouse.height);
    // and it still starts inside the plot, which is the constraint a bigger
    // pill threatens first
    expect(finger.x0).toBeGreaterThanOrEqual(0);
  });
});
