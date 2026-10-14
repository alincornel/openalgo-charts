/**
 * The footprint's stacked zones and its ladder brackets read the same
 * diagonals. The ladder compares at a floor of one opposing contract
 * (`minOpposing`) in every view but `imbalance`; the signals compared at zero,
 * so three thin prints over untraded rows made a zone the ladder drew no
 * bracket for.
 */
import { describe, expect, it } from 'vitest';
import { footprintSignals } from '../src/profile/footprint-signals';
import { Footprint } from '../src/profile/footprint-primitive';
import type { FootprintBar } from '../src/profile/profile-model';

// Asks of 2 at 101..103 against untraded bids below them: 2 >= 3 x 0, but not 3 x 1.
const thin: FootprintBar = {
  time: 60, delta: 5, open: 100, high: 104, low: 100, close: 104, rowSize: 1,
  cells: [100, 101, 102, 103, 104].map(price => ({ price, bidVol: price === 104 ? 1 : 0, askVol: price >= 101 && price <= 103 ? 2 : 0 })),
};
const stacked = (zones: readonly { kind: string }[]): number => zones.filter(z => z.kind === 'stackedBuy').length;

describe('footprint signals with an opposing floor', () => {
  it('compare with zero by default, as upstream does', () => {
    expect(stacked(footprintSignals([thin]).zones)).toBe(1);
    expect(stacked(footprintSignals([thin], { minOpposing: 0 }).zones)).toBe(1);
  });

  it('compare at the floor when one is given', () => {
    expect(stacked(footprintSignals([thin], { minOpposing: 1 }).zones)).toBe(0);
  });

  it('refuse a floor that is negative or not finite', () => {
    expect(() => footprintSignals([thin], { minOpposing: -1 })).toThrow(RangeError);
    expect(() => footprintSignals([thin], { minOpposing: NaN })).toThrow(RangeError);
  });

  it('match the ladder brackets: the floor in the ladder views, zero in the imbalance view', () => {
    const fp = new Footprint({ stackedImbalances: 3 });
    fp.setBars([thin]);
    expect(stacked(fp.signals().zones)).toBe(0);
    fp.setOptions({ displayMode: 'imbalance' });
    expect(stacked(fp.signals().zones)).toBe(1);
  });
});
