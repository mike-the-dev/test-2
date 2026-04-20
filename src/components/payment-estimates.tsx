"use client";

import type { ReactElement } from "react";

import {
  DEFAULT_EXAMPLE_TERMS,
  estimate0AprPayments,
  formatUsd,
} from "@/lib/payment-estimator";

export interface PaymentEstimatesProps {
  /** Already-debounced dollar amount. The parent owns the debounce timer. */
  amountDollars: number;
  /** Hide the block below this dollar threshold. Matches the splash minimum. */
  minimumDollars?: number;
}

export function PaymentEstimates({
  amountDollars,
  minimumDollars = 50,
}: PaymentEstimatesProps): ReactElement | null {
  if (amountDollars < minimumDollars) return null;

  const estimates = estimate0AprPayments(amountDollars, DEFAULT_EXAMPLE_TERMS);
  if (estimates.length === 0) return null;

  return (
    <div data-testid="payment-estimates" className="w-full">
      <p className="mb-2 text-center text-xs text-default-foreground opacity-70">
        Example payments for{" "}
        <span className="font-medium text-foreground">
          {formatUsd(amountDollars)}
        </span>
      </p>
      <div className="grid grid-cols-3 gap-2">
        {estimates.map((e) => (
          <div
            key={e.months}
            data-testid={`payment-estimate-${e.months}`}
            className="rounded-lg border border-default bg-surface-secondary px-2 py-2 text-center"
          >
            <p className="text-sm font-semibold text-foreground leading-tight">
              {formatUsd(e.monthlyDollars)}
              <span className="block text-[10px] font-normal opacity-70">
                / month
              </span>
            </p>
            <p className="mt-1 text-[10px] text-default-foreground opacity-80 leading-tight">
              {e.months} months
            </p>
            <p className="mt-0.5 inline-block rounded-full bg-accent/10 px-1.5 text-[10px] font-medium text-accent">
              {e.aprPercent}% APR
            </p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-[10px] text-default-foreground opacity-60 leading-snug">
        Example payments at 0% APR. Actual terms determined at checkout based
        on qualification.
      </p>
    </div>
  );
}
