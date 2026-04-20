"use client";

import { Avatar, Button, Input } from "@heroui/react";
import type { ChangeEvent, FormEvent, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

import { AffirmPromo } from "@/components/affirm-promo";
import { PaymentEstimates } from "@/components/payment-estimates";
import { useDebounce } from "@/lib/use-debounce";

export const MINIMUM_BUDGET_DOLLARS = 50;
/**
 * Soft ceiling for the illustrative Affirm / example-payments block.
 * Empirically, Affirm's sandbox errors past ~$30,000 ("Amount provided is
 * greater than maximum loan amount."). Above this threshold we hide the
 * speculative math and the Affirm element and nudge the visitor toward the
 * agent. "Start chat" stays enabled — the agent can still help; we just stop
 * promising financing numbers we can't back up.
 */
export const MAX_FINANCEABLE_DOLLARS = 30_000;
const DEFAULT_BUDGET_DOLLARS = 1000;
const LIVE_UPDATE_DEBOUNCE_MS = 400;

export interface BudgetSplashProps {
  /** Called with the validated whole-dollar amount when the user submits. */
  onSubmit: (amountDollars: number) => void;
}

function parseDollarInput(raw: string): number {
  // Strip anything that's not a digit or decimal. Affirm's amount is an
  // integer (cents) but we let the visitor type whole-dollar figures.
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function BudgetSplash({ onSubmit }: BudgetSplashProps): ReactElement {
  const [raw, setRaw] = useState<string>(String(DEFAULT_BUDGET_DOLLARS));
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus + select the default on mount so the visitor can just start typing
  // to replace it without having to manually select the text first.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const amount = parseDollarInput(raw);
  const isValid = amount >= MINIMUM_BUDGET_DOLLARS;

  // Single debounce drives every live-updating child on the splash so the
  // Affirm SDK refresh and the example-payment cards update in lockstep.
  const debouncedAmount = useDebounce(amount, LIVE_UPDATE_DEBOUNCE_MS);
  const financeable = debouncedAmount <= MAX_FINANCEABLE_DOLLARS;

  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setRaw(e.target.value);
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!isValid) return;
    onSubmit(amount);
  };

  return (
    <div
      data-testid="budget-splash"
      className="flex flex-col flex-1 min-h-0 w-full bg-background overflow-hidden"
    >
      <header className="flex items-center gap-2 bg-accent px-3 py-3 shrink-0">
        <Avatar size="sm" className="shrink-0">
          <Avatar.Fallback className="bg-white text-accent">AI</Avatar.Fallback>
        </Avatar>
        <div className="leading-tight">
          <h3 className="text-sm font-medium text-accent-foreground">
            Shopping Assistant
          </h3>
          <p className="text-xs text-accent-foreground/80">
            Let&apos;s find what fits your budget
          </p>
        </div>
      </header>

      <form
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-6"
      >
        <div className="text-center">
          <h2 className="text-lg font-semibold text-foreground">
            What&apos;s your budget?
          </h2>
          <p className="mt-1 text-xs text-default-foreground opacity-70">
            Tell us a ballpark and we&apos;ll show options that fit.
          </p>
        </div>

        <div className="w-full max-w-[240px]">
          <label
            htmlFor="budget-amount"
            className="sr-only"
          >
            Budget amount in US dollars
          </label>
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-default-foreground opacity-60"
            >
              $
            </span>
            <Input
              id="budget-amount"
              ref={inputRef}
              aria-label="Budget amount in US dollars"
              inputMode="decimal"
              placeholder="500"
              value={raw}
              onChange={handleChange}
              fullWidth
              className="rounded-lg border border-default bg-background py-2 pl-7 pr-3 text-center text-base outline-none focus:border-accent"
            />
          </div>
          <p className="mt-1 text-center text-xs text-default-foreground opacity-60">
            Minimum ${MINIMUM_BUDGET_DOLLARS}
          </p>
        </div>

        {financeable ? (
          <>
            <div
              className="min-h-[20px] w-full text-center"
              data-testid="affirm-slot"
            >
              <AffirmPromo amountDollars={debouncedAmount} />
            </div>
            <PaymentEstimates amountDollars={debouncedAmount} />
          </>
        ) : (
          <p
            data-testid="large-budget-note"
            className="max-w-[260px] text-center text-xs text-default-foreground opacity-75"
          >
            Larger budget? Our shopping assistant can explore options that fit
            — start the chat and we&apos;ll take it from there.
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          isDisabled={!isValid}
          fullWidth
          className="max-w-[240px]"
        >
          Start chat
        </Button>
      </form>
    </div>
  );
}
