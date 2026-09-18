import { describe, expect, it } from 'vitest';
import { bucketPrice } from '../src/profile/profile-model';

describe('bucketPrice', () => {
  // GC at 2 ticks per row: 4435.7 / 0.2 lands a hair either side of .5, so
  // plain Math.round made rows 1, 2 or 3 ticks tall. Halfway ticks now go up,
  // the same rule as the rithmic backend's `footprint::row_index`.
  it('puts the same number of ticks in every row', () => {
    for (const [tick, rowTicks, base] of [[0.1, 2, 4400], [0.1, 4, 4400], [0.01, 10, 95], [0.25, 4, 7700]]) {
      const counts = new Map<number, number>();
      const first = Math.round(base / tick);
      for (let i = 0; i < 1000; i += 1) {
        const row = bucketPrice((first + i) * tick, tick * rowTicks);
        counts.set(row, (counts.get(row) ?? 0) + 1);
      }
      const inner = [...counts.values()].slice(1, -1);
      expect(new Set(inner), `tick ${tick} x ${rowTicks}`).toEqual(new Set([rowTicks]));
    }
  });

  it('leaves a price already on the row grid where it is', () => {
    expect(bucketPrice(4435.6, 0.2)).toBe(4435.6);
    expect(bucketPrice(7700.25, 0.25)).toBe(7700.25);
    expect(bucketPrice(96.34, 0.01)).toBe(96.34);
  });
});
