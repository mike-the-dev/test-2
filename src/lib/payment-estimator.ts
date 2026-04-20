/**
 * Client-side payment estimator for the budget splash. Purely illustrative —
 * the numbers shown are 0% APR arithmetic to give visitors a sense of what
 * monthly payments could look like; actual approval, term, and APR are
 * determined by the lender (Affirm) at checkout.
 *
 * Keep this file pure — no React, no DOM, no side effects.
 */

/** Default term options surfaced on the splash. Tweakable without touching UI. */
export const DEFAULT_EXAMPLE_TERMS = [6, 12, 24] as const;

export interface PaymentEstimate {
  months: number;
  monthlyDollars: number;
  aprPercent: number;
}

/**
 * Compute illustrative 0% APR example payments for a given principal across
 * one or more term lengths. Pure `amount / months`, rounded to cents.
 */
export function estimate0AprPayments(
  amountDollars: number,
  months: readonly number[] = DEFAULT_EXAMPLE_TERMS
): PaymentEstimate[] {
  if (!Number.isFinite(amountDollars) || amountDollars <= 0) return [];
  return months.map((m) => ({
    months: m,
    monthlyDollars: Math.round((amountDollars / m) * 100) / 100,
    aprPercent: 0,
  }));
}

/**
 * Format a dollar amount with two-decimal precision and thousands grouping.
 * Uses the platform's Intl formatter so the locale is honored server-side
 * at build time and matches the client renderer at runtime.
 */
export function formatUsd(dollars: number): string {
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
