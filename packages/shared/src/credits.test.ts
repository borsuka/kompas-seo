import { describe, expect, it } from 'vitest';
import { computeCreditCost, DEFAULT_CREDIT_COSTS, resolveCreditCosts } from './credits.js';

describe('credit costs', () => {
  it('computes base + per-unit cost rounded up', () => {
    const cost = { base: 2, perUnit: 1, unitSize: 10 };
    expect(computeCreditCost(cost, 0)).toBe(2);
    expect(computeCreditCost(cost, 1)).toBe(3);
    expect(computeCreditCost(cost, 10)).toBe(3);
    expect(computeCreditCost(cost, 11)).toBe(4);
  });

  it('returns defaults without overrides', () => {
    expect(resolveCreditCosts(undefined)).toEqual(DEFAULT_CREDIT_COSTS);
    expect(resolveCreditCosts('  ')).toEqual(DEFAULT_CREDIT_COSTS);
  });

  it('applies flat and partial overrides without mutating defaults', () => {
    const costs = resolveCreditCosts('{"serp.get": 3, "keyword.metrics": {"perUnit": 2}}');
    expect(costs['serp.get']).toEqual({ base: 3, perUnit: 0, unitSize: 1 });
    expect(costs['keyword.metrics']).toEqual({ base: 0, perUnit: 2, unitSize: 10 });
    expect(DEFAULT_CREDIT_COSTS['serp.get'].perUnit).toBe(5);
  });

  it('rejects unknown operations and negative costs', () => {
    expect(() => resolveCreditCosts('{"nope": 1}')).toThrow();
    expect(() => resolveCreditCosts('{"serp.get": -1}')).toThrow();
  });
});
