import type { AlertCondition } from './types';

export const CONDITIONS: readonly AlertCondition[] = [
  'crossing', 'crossingUp', 'crossingDown', 'greaterThan', 'lessThan', 'enteringRange', 'leavingRange',
];

export function numericMatch(condition: AlertCondition, previous: number | undefined, current: number,
  lower: number, upper: number | undefined): boolean {
  if (!Number.isFinite(current)) return false;
  if (condition === 'greaterThan') return current > lower;
  if (condition === 'lessThan') return current < lower;
  if (previous === undefined || !Number.isFinite(previous)) return false;
  const up = previous <= lower && current > lower;
  const down = previous >= lower && current < lower;
  if (condition === 'crossing') return up || down;
  if (condition === 'crossingUp') return up;
  if (condition === 'crossingDown') return down;
  const wasInside = previous >= lower && previous <= upper!;
  const isInside = current >= lower && current <= upper!;
  return condition === 'enteringRange' ? !wasInside && isInside : wasInside && !isInside;
}

/** Newly observed extrema prove contact without inventing an intrabar path order. */
export function touchMatch(condition: AlertCondition, previous: number, low: number, high: number,
  lower: number, upper: number | undefined): number | undefined {
  if (![previous, low, high].every(Number.isFinite)) return undefined;
  const up = previous <= lower && high > lower;
  const down = previous >= lower && low < lower;
  switch (condition) {
    case 'crossing': return up || down ? lower : undefined;
    case 'crossingUp': return up ? lower : undefined;
    case 'crossingDown': return down ? lower : undefined;
    case 'greaterThan': return high > lower ? high : undefined;
    case 'lessThan': return low < lower ? low : undefined;
    case 'enteringRange':
      if (previous < lower && high >= lower) return lower;
      if (previous > upper! && low <= upper!) return upper;
      return undefined;
    case 'leavingRange':
      if (previous < lower || previous > upper!) return undefined;
      if (low < lower) return lower;
      return high > upper! ? upper : undefined;
  }
}
