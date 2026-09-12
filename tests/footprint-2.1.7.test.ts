/**
 * Regressions found reviewing the 2.1.7 merge, where the fork's ladder was
 * rebuilt on upstream's footprint renderer. Four of them are places the two
 * models disagreed about what a row IS: whether an empty neighbour can be
 * out-ratioed, which price a filled row sits at, which candle puts price on the
 * pane, and which half of a `deltaVolume` row a diagonal belongs to.
 */
import { describe, expect, it } from 'vitest';
import { Footprint, type FootprintCandleMode } from '../src/profile/footprint-primitive';
import { diagonalImbalances } from '../src/profile/footprint';
import type { FootprintBar } from '../src/profile/profile-model';
import { DataLayer } from '../src/model/data-layer';
import { PriceScale } from '../src/scale/price-scale';
import { TimeScale } from '../src/scale/time-scale';
import { darkTheme } from '../src/theme';
import type { PrimitiveRenderContext } from '../src/primitives/primitive';
import { makeCtx, type RecordingContext } from './helpers/fake-ctx';

const BUY = '#00ff00';
const SELL = '#ff0000';

function context(range = { min: 99.8, max: 100.3 }, spacing = 80): PrimitiveRenderContext {
  const dataLayer = new DataLayer();
  const id = dataLayer.createSeries();
  dataLayer.setSeriesData(id, [1, 2].map(time => ({ time, open: 100, high: 101, low: 99, close: 100 })));
  const timeScale = new TimeScale({ barSpacing: spacing });
  timeScale.setWidth(600);
  timeScale.setBaseIndex(dataLayer.baseIndex);
  const priceScale = new PriceScale();
  priceScale.setHeight(400);
  priceScale.setPriceRange(range);
  return { dataLayer, timeScale, priceScale, dpr: 1, plotWidth: 600, plotHeight: 400, priceAxisWidth: 56, theme: darkTheme };
}

const LADDER = {
  tickSize: 0.05, statsRows: [] as [], stackedImbalances: 0, showPoc: false,
  candle: 'off' as const, minTextHeight: 1, buyColor: BUY, sellColor: SELL,
};
const fills = (rec: RecordingContext): string[] =>
  rec.ops.filter(op => op.type === 'fill' || op.type === 'fillRect').map(op => op.fillStyle as string);

describe('the diagonal an empty neighbour cannot win', () => {
  it('lets imbalanceRatio suppress a print against an untraded row again', () => {
    // Zero-fill manufactures the empty rows, and `ratio * 0` is zero at every
    // ratio, so the ladder saturated the same four cells at 3, at 50 and at a
    // billion alike. `imbalanceRatio` had stopped being a knob.
    const bar: FootprintBar = { time: 1, delta: 60, cells: [
      { price: 100.10, bidVol: 0, askVol: 30 },
      { price: 100.00, bidVol: 0, askVol: 30 },
    ] };
    const hot = (ratio: number): number => {
      const fp = new Footprint({ ...LADDER, zeroFill: true, imbalanceRatio: ratio });
      fp.setBars([bar]);
      const { ctx, rec } = makeCtx();
      fp.draw(ctx, context());
      return fills(rec).filter(fill => fill === BUY || fill === SELL).length;
    };
    expect(hot(3)).toBeGreaterThan(0);
    expect(hot(50)).toBe(0);
    expect(hot(1e9)).toBe(0);
  });

  it('grades a quiet row against the bar peak rather than saturating it', () => {
    // The tint-ramp test used `imbalanceRatio: 1e9` to mean "no imbalances" and
    // was passing for the wrong reason: the peak cell was saturating on a
    // diagonal against an empty row, not reaching the top of the ramp.
    const fp = new Footprint({ ...LADDER, imbalanceRatio: 1e9 });
    fp.setBars([{ time: 1, delta: 101, cells: [
      { price: 100.05, bidVol: 0, askVol: 100 },
      { price: 100.00, bidVol: 0, askVol: 1 },
    ] }]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, context());
    const painted = fills(rec);
    expect(painted).not.toContain(BUY);
    expect(new Set(painted).size).toBeGreaterThan(1);   // still graded, just not hot
  });

  it('keeps the analytics call honest about fractional quantities by default', () => {
    const cells = [{ price: 2, bidVol: 0, askVol: 0.1 }, { price: 1, bidVol: 0, askVol: 0 }];
    // Upstream's reading: a positive quantity against nothing is an imbalance.
    expect(diagonalImbalances(cells, 3, 1)).toEqual([{ price: 2, side: 'buy' }]);
    // The ladder's reading, which is what `minOpposing` names.
    expect(diagonalImbalances(cells, 3, 1, 0, 1)).toEqual([]);
    expect(diagonalImbalances([{ price: 2, bidVol: 0, askVol: 5 }, cells[1]], 3, 1, 0, 1))
      .toEqual([{ price: 2, side: 'buy' }]);
    expect(() => diagonalImbalances(cells, 3, 1, 0, -1)).toThrow(/minOpposing/i);
  });
});

describe('zero-fill puts every row on the grid', () => {
  const OFF_GRID: FootprintBar = { time: 1, delta: 45, cells: [
    { price: 100.01, bidVol: 0, askVol: 50 },   // the POC, and off the 0.05 grid
    { price: 100.00, bidVol: 0, askVol: 5 },    // shares 100.01's bucket
    { price: 99.90, bidVol: 10, askVol: 0 },
  ] };

  it('hovers a filled row at the grid price, not the price a lone cell arrived with', () => {
    const fp = new Footprint({ ...LADDER, zeroFill: true });
    fp.setBars([OFF_GRID]);
    const rc = context();
    fp.draw(makeCtx().ctx, rc);
    const x = rc.timeScale.indexToX(0);
    for (const price of [99.9, 99.95, 100]) {
      expect(fp.hoverAt(x, rc.priceScale.priceToY(price))?.cell?.price).toBe(price);
    }
  });

  it('still marks and rings the row the POC price falls in', () => {
    // `stats()` keeps saying where the volume was; the mark follows the row
    // that holds it. Before, the compare was against a price no drawn row had
    // and both the tick and the ring simply vanished.
    const plain = new Footprint({ ...LADDER, showPoc: true, pocOutline: '#f0a020' });
    plain.setBars([OFF_GRID]);
    const a = makeCtx(); plain.draw(a.ctx, context());

    const filled = new Footprint({ ...LADDER, showPoc: true, pocOutline: '#f0a020', zeroFill: true });
    filled.setBars([OFF_GRID]);
    const b = makeCtx(); filled.draw(b.ctx, context());

    expect(filled.stats()[0].poc).toBe(100.01);               // unchanged by drawing
    expect(a.rec.count('strokeRect')).toBe(1);
    expect(b.rec.count('strokeRect')).toBe(1);
    const marks = (rec: RecordingContext): number =>
      rec.ops.filter(op => op.type === 'fillRect' && op.fillStyle === '#f0a020').length;
    expect(marks(a.rec)).toBe(1);
    expect(marks(b.rec)).toBe(1);
  });

  it('sums two source cells that land in one bucket, at that bucket price', () => {
    const fp = new Footprint({ ...LADDER, zeroFill: true });
    fp.setBars([{ time: 1, delta: 7, cells: [
      { price: 100.01, bidVol: 0, askVol: 3 }, { price: 100.0, bidVol: 0, askVol: 4 },
      { price: 99.95, bidVol: 0, askVol: 0 },
    ] }]);
    const rc = context();
    fp.draw(makeCtx().ctx, rc);
    expect(fp.hoverAt(rc.timeScale.indexToX(0), rc.priceScale.priceToY(100))?.cell)
      .toEqual({ price: 100, bidVol: 0, askVol: 7 });
  });
});

describe('autoscale follows the candle that is actually drawn', () => {
  const WIDE: FootprintBar = { time: 1, delta: 0, rowSize: 0.05,
    open: 50, high: 200, low: 50, close: 200,
    cells: [{ price: 100.05, bidVol: 1, askVol: 1 }, { price: 100.0, bidVol: 1, askVol: 1 }] };
  const info = (candle: FootprintCandleMode): { min: number; max: number } | null => {
    const fp = new Footprint({ ...LADDER, candle });
    fp.setBars([WIDE]);
    return fp.autoscaleInfo();
  };

  it('ignores bar OHLC for every mode that does not draw from it', () => {
    // `showCandle` said yes to all of them, so `candle: 'off'` still stretched
    // the pane from 50 to 200 for a candle nobody asked for.
    const rows = { min: 99.975, max: 100.075 };
    expect(info('off')).toEqual(rows);
    expect(info('behind')).toEqual(rows);   // a range line over the rows it already has
    expect(info('gutter')).toEqual(rows);   // the pane's own series autoscales itself
    expect(info('ohlc')).toEqual({ min: 50, max: 200 });
  });

  it('still lets showCandle:false silence the bar-metadata candle', () => {
    const fp = new Footprint({ ...LADDER, candle: 'ohlc', showCandle: false });
    fp.setBars([WIDE]);
    expect(fp.autoscaleInfo()).toEqual({ min: 99.975, max: 100.075 });
  });
});

describe('a deltaVolume row answers for both diagonals', () => {
  it('saturates the volume half on a sell imbalance, not only a buy one', () => {
    const fp = new Footprint({ ...LADDER, cells: 'deltaVolume', imbalanceRatio: 3 });
    // bid 30 at 100.00 against ask 1 one row above: a sell diagonal.
    fp.setBars([{ time: 1, delta: -29, cells: [
      { price: 100.05, bidVol: 0, askVol: 1 },
      { price: 100.00, bidVol: 30, askVol: 0 },
    ] }]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, context());
    // The volume half takes the neutral blend of the two side colours when it
    // saturates, which is the one colour the graded ramp can never reach.
    expect(fills(rec)).toContain('rgb(128,128,0)');
  });

  it('inks a positive delta by its own direction under textColorMode side', () => {
    // The halves are labelled `bid`/`ask` for where they SIT. Handing that to
    // the text palette inked a positive delta in the sell colour.
    const fp = new Footprint({ ...LADDER, cells: 'deltaVolume', textColorMode: 'side',
      buyTextColor: '#aaffaa', sellTextColor: '#ffaaaa' });
    fp.setBars([{ time: 1, delta: 5, cells: [{ price: 100.0, bidVol: 1, askVol: 6 }] }]);
    const { ctx, rec } = makeCtx();
    fp.draw(ctx, context());
    const label = rec.ops.find(op => op.type === 'fillText' && op.text === '5');
    expect(label?.fillStyle).toBe('rgba(170,255,170,1)');
  });
});

describe('Footprint options are the primitive\'s own', () => {
  it('copies the deltaCell group a caller handed in', () => {
    const deltaCell = { colorBy: 'delta' as const, tintFloor: 0.2 };
    const fp = new Footprint({ ...LADDER, cells: 'deltaVolume', deltaCell });
    deltaCell.tintFloor = 0.9;
    expect(fp.options().deltaCell).toEqual({ colorBy: 'delta', tintFloor: 0.2 });
    const handed = fp.options().deltaCell!;
    handed.tintFloor = 0.5;
    expect(fp.options().deltaCell!.tintFloor).toBe(0.2);
  });

  it.each([
    ['candle', { candle: 'sideways' }],
    ['cell mode', { cells: 'both' }],
    ['colour mode', { colorBy: 'volume' }],
    ['cell style', { cellStyle: 'bars' }],
    ['tint curve', { tintCurve: 'log' }],
    ['delta ramp', { cells: 'deltaVolume', deltaCell: { tintGain: Number.NaN } }],
  ])('rejects an unknown %s rather than drawing something else', (_label, patch) => {
    expect(() => new Footprint({ ...LADDER, ...patch } as never)).toThrow(RangeError);
    const fp = new Footprint(LADDER);
    expect(() => fp.setOptions(patch as never)).toThrow(RangeError);
    expect(fp.options().candle).toBe('off');
  });
});
