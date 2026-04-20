import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXAMPLE_TERMS,
  estimate0AprPayments,
  formatUsd,
} from "@/lib/payment-estimator";

describe("estimate0AprPayments", () => {
  it("returns a 0% APR row per requested term with the amount divided across months", () => {
    const rows = estimate0AprPayments(2000, [6, 12, 24]);
    expect(rows).toEqual([
      { months: 6, monthlyDollars: 333.33, aprPercent: 0 },
      { months: 12, monthlyDollars: 166.67, aprPercent: 0 },
      { months: 24, monthlyDollars: 83.33, aprPercent: 0 },
    ]);
  });

  it("defaults to the DEFAULT_EXAMPLE_TERMS when no terms are passed", () => {
    const rows = estimate0AprPayments(1200);
    expect(rows.map((r) => r.months)).toEqual([...DEFAULT_EXAMPLE_TERMS]);
  });

  it("returns an empty array for non-positive or non-finite amounts", () => {
    expect(estimate0AprPayments(0)).toEqual([]);
    expect(estimate0AprPayments(-50)).toEqual([]);
    expect(estimate0AprPayments(Number.NaN)).toEqual([]);
  });

  it("rounds each monthly payment to two decimals", () => {
    const [row] = estimate0AprPayments(100, [3]);
    expect(row.monthlyDollars).toBe(33.33);
  });
});

describe("formatUsd", () => {
  it("formats whole dollars with two decimals and thousands grouping", () => {
    expect(formatUsd(2000)).toBe("$2,000.00");
  });
  it("formats cents correctly", () => {
    expect(formatUsd(166.67)).toBe("$166.67");
  });
});
