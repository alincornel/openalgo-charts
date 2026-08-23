/**
 * Hardening of src/trade/validation.ts.
 *
 * Every test here fails against the pre-fix module: either the assertion is on
 * behaviour that did not exist (finite/whole/lot quantity checks, the rejection
 * code, a price-free call) or on a message the old code spelled differently.
 */
import { describe, it, expect } from 'vitest';
import {
  validateOrder,
  validateQuantity,
  validatePrice,
  withinPriceBand,
  type OrderConstraints,
} from '../src/trade/validation';

/** Cash equity: tick 0.05, band 90..110, freeze 1000, whole quantities. */
const C: OrderConstraints = { tickSize: 0.05, priceBand: { lower: 90, upper: 110 }, freezeQty: 1000 };
/** A 75-lot future with a 1800 freeze limit (24 lots). */
const FO: OrderConstraints = { tickSize: 0.05, lotSize: 75, freezeQty: 1800 };

describe('quantity finiteness and positivity', () => {
  it('rejects NaN quantity', () => {
    const r = validateOrder(100, Number.NaN, C);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('QTY_INVALID');
    expect(r.reason).toBe('quantity must be a finite number');
  });

  it('rejects infinite quantity in both directions', () => {
    expect(validateOrder(100, Number.POSITIVE_INFINITY, C).ok).toBe(false);
    expect(validateOrder(100, Number.NEGATIVE_INFINITY, C).ok).toBe(false);
    expect(validateOrder(100, Number.POSITIVE_INFINITY, C).code).toBe('QTY_INVALID');
  });

  it('keeps rejecting zero and negative quantity, with the code attached', () => {
    const zero = validateOrder(100, 0, C);
    expect(zero.ok).toBe(false);
    expect(zero.reason).toBe('quantity must be positive'); // unchanged wording
    expect(zero.code).toBe('QTY_INVALID');
    expect(validateOrder(100, -10, C).ok).toBe(false);
  });
});

describe('whole-quantity and lot-size grid', () => {
  it('rejects a fractional quantity on a whole-lot instrument', () => {
    const r = validateOrder(100, 1.5, C);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('QTY_STEP');
    expect(r.reason).toContain('whole number');
  });

  it('rejects a quantity that is not a multiple of the lot size', () => {
    const r = validateOrder(100, 100, FO);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('QTY_STEP');
    expect(r.reason).toContain('lot size 75');
    expect(validateOrder(100, 150, FO).ok).toBe(true); // two lots is fine
    expect(validateOrder(100, 75 * 1000, { tickSize: 0.05, lotSize: 75 }).ok).toBe(true);
  });

  it('lets a fractional venue opt in, and still holds it to any lot grid', () => {
    const crypto: OrderConstraints = { tickSize: 0.01, allowFractionalQty: true };
    expect(validateOrder(100, 0.25, crypto).ok).toBe(true);

    const stepped: OrderConstraints = { tickSize: 0.01, allowFractionalQty: true, lotSize: 0.1 };
    // 0.3 / 0.1 is 2.9999999999999996: the grid check must be epsilon-tolerant.
    expect(validateOrder(100, 0.3, stepped).ok).toBe(true);
    expect(validateOrder(100, 0.25, stepped).ok).toBe(false);
    expect(validateOrder(100, 0.25, stepped).code).toBe('QTY_STEP');
  });
});

describe('quantity validation is independent of price', () => {
  it('exposes validateQuantity so a market order can be checked on its own', () => {
    expect(validateQuantity(10, C).ok).toBe(true);
    expect(validateQuantity(5000, C).ok).toBe(false);
    expect(validateQuantity(5000, C).code).toBe('QTY_FREEZE_LIMIT');
    expect(validateQuantity(1.5, C).code).toBe('QTY_STEP');
    expect(validateQuantity(Number.NaN, C).code).toBe('QTY_INVALID');
  });

  it('validates quantity alone when validateOrder is given no price', () => {
    expect(validateOrder(undefined, 10, C).ok).toBe(true);
    expect(validateOrder(undefined, 10, C).price).toBeUndefined();

    const frozen = validateOrder(undefined, 5000, C);
    expect(frozen.ok).toBe(false);
    expect(frozen.code).toBe('QTY_FREEZE_LIMIT');
    expect(frozen.reason).toContain('freeze limit 1000');
  });

  it('reports the quantity first when price and quantity are both wrong', () => {
    const r = validateOrder(999, 0, C);
    expect(r.code).toBe('QTY_INVALID');
  });

  it('applies the freeze limit after the grid, so 25 lots over the cap is a freeze reject', () => {
    const r = validateQuantity(75 * 25, FO); // 1875 units, whole lots, over 1800
    expect(r.ok).toBe(false);
    expect(r.code).toBe('QTY_FREEZE_LIMIT');
  });
});

describe('price validation', () => {
  it('rejects a non-finite price instead of snapping it to NaN', () => {
    const noBand: OrderConstraints = { tickSize: 0.05 };
    const r = validateOrder(Number.NaN, 10, noBand);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('PRICE_INVALID');
    expect(validateOrder(Number.POSITIVE_INFINITY, 10, noBand).ok).toBe(false);
    expect(validatePrice(Number.NaN, C).ok).toBe(false);
  });

  it('keeps tick snapping and band behaviour, with the en dash gone from the message', () => {
    expect(validateOrder(100.07, 10, C).price).toBeCloseTo(100.05);
    expect(validatePrice(100.07, C).price).toBeCloseTo(100.05);
    expect(withinPriceBand(100, C.priceBand!)).toBe(true);

    const out = validateOrder(200, 10, C);
    expect(out.ok).toBe(false);
    expect(out.code).toBe('PRICE_OUT_OF_BAND');
    expect(out.reason).toContain('outside band 90 to 110');
    expect(out.reason).not.toMatch(/[\u2013\u2014]/); // house rule: no en or em dashes
  });
});
