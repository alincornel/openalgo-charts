/**
 * The CBOT rules for the POC and the value area, as options.
 *
 * The defaults are what the profile always computed: the first (highest) of the
 * rows tied for the most TPOs is the POC, and the value area grows one row at a
 * time. The classic Market Profile rules differ on both, and on a real session
 * the difference is a row or two at the POC or at an edge of value:
 *
 *  - `pocTieBreak: 'center'` — of the tied rows, the one nearest the middle of
 *    the session's range.
 *  - `valueAreaMethod: 'pairs'` — compare the next TWO rows above with the next
 *    two below, and add the busier pair.
 */
import { describe, expect, it } from 'vitest';
import { computeMarketProfile } from '../src/profile/market-profile';
import { istStringToUtcSeconds } from '../src/feed/time';
import type { Bar } from '../src/model/bar';

const t0 = istStringToUtcSeconds('2024-01-15 09:15:00');

/** One 30-minute bar per range: each row inside a range gets that period's TPO. */
const periods = (ranges: readonly [number, number][]): Bar[] =>
  ranges.map(([low, high], i) => ({ time: t0 + i * 1800, open: low, high, low, close: high, volume: 100 }));

const counts = (bars: Bar[]) => {
  const result = computeMarketProfile(bars, { tickSize: 1, session: 'day', blockMinutes: 30 });
  return Object.fromEntries(result.sessions[0].levels.map((l) => [l.price, l.count]));
};

describe('pocTieBreak', () => {
  // Rows 110, 109, 103 and 102 all hold two TPOs; the range's middle is 105.
  const tied = periods([[100, 110], [109, 110], [102, 103]]);

  it('keeps the first tied row by default', () => {
    const [session] = computeMarketProfile(tied, { tickSize: 1, blockMinutes: 30 }).sessions;
    expect(session.poc).toBe(110);
  });

  it("'center' takes the tied row nearest the middle of the range", () => {
    const [session] = computeMarketProfile(tied, { tickSize: 1, blockMinutes: 30, pocTieBreak: 'center' }).sessions;
    expect(session.poc).toBe(103);
  });

  it("'center' prefers the upper row when two tied rows are equally near", () => {
    const even = periods([[100, 110], [109, 110], [100, 101]]); // 109 and 101 are both 4 from 105
    const [session] = computeMarketProfile(even, { tickSize: 1, blockMinutes: 30, pocTieBreak: 'center' }).sessions;
    expect(session.poc).toBe(109);
  });
});

describe('valueAreaMethod', () => {
  // TPOs by row: 110:1 109:1 108:5 107:1 106:6 105:3 104:1 103:1 102:1 101:1 100:1
  // — 22 in all, so 70 % is 15.4.
  const bars = periods([
    [100, 110],
    [105, 106], [105, 106],
    [106, 106], [106, 106], [106, 106],
    [108, 108], [108, 108], [108, 108], [108, 108],
  ]);

  it('builds the distribution the cases below are worked out on', () => {
    expect(counts(bars)).toEqual({
      110: 1, 109: 1, 108: 5, 107: 1, 106: 6, 105: 3, 104: 1, 103: 1, 102: 1, 101: 1, 100: 1,
    });
  });

  it('grows one row at a time by default', () => {
    // 106 (6) → 105 (+3 = 9) → 107 on the 1-1 tie (10) → 108 (15) → 109 (16).
    const [session] = computeMarketProfile(bars, { tickSize: 1, blockMinutes: 30 }).sessions;
    expect([session.vah, session.poc, session.val]).toEqual([109, 106, 105]);
  });

  it("'pairs' compares two rows either side and adds the busier pair", () => {
    // 106 (6) → 107+108 = 6 over 105+104 = 4 (12) → 105+104 = 4 over 109+110 = 2 (16).
    const [session] = computeMarketProfile(bars, { tickSize: 1, blockMinutes: 30, valueAreaMethod: 'pairs' }).sessions;
    expect([session.vah, session.poc, session.val]).toEqual([108, 106, 104]);
  });

  it("'pairs' finishes on the side that still has rows once the other runs out", () => {
    // POC at the top: only rows below remain, taken two at a time.
    const top = periods([[100, 104], [104, 104], [104, 104], [103, 104]]);
    const [session] = computeMarketProfile(top, { tickSize: 1, blockMinutes: 30, valueAreaMethod: 'pairs' }).sessions;
    expect(session.poc).toBe(104);
    expect(session.vah).toBe(104);
    expect(session.val).toBeLessThan(104);
  });

  it('applies the same rules to the developing value', () => {
    const result = computeMarketProfile(bars, {
      tickSize: 1, blockMinutes: 30, valueAreaMethod: 'pairs', pocTieBreak: 'center',
    });
    const developing = result.sessions[0].developing;
    const last = developing[developing.length - 1];
    expect([last?.vah, last?.poc, last?.val]).toEqual([108, 106, 104]);
  });
});
