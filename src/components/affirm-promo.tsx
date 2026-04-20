"use client";

import { useEffect } from "react";
import type { ReactElement } from "react";

import { loadAffirmSdk, refreshAffirmUi } from "@/lib/affirm";

export interface AffirmPromoProps {
  /**
   * Already-debounced dollar amount. The parent owns the debounce timer so
   * every live-updating child on the splash ticks together off a single
   * clock.
   */
  amountDollars: number;
  /** Hide the promo below this dollar threshold (matches splash min). */
  minimumDollars?: number;
}

export function AffirmPromo({
  amountDollars,
  minimumDollars = 50,
}: AffirmPromoProps): ReactElement | null {
  useEffect(() => {
    loadAffirmSdk();
  }, []);

  useEffect(() => {
    if (amountDollars < minimumDollars) return;
    // rAF so the <p data-amount=…> has the new amount painted before refresh.
    const id = requestAnimationFrame(() => refreshAffirmUi());
    return () => cancelAnimationFrame(id);
  }, [amountDollars, minimumDollars]);

  if (amountDollars < minimumDollars) return null;

  const cents = Math.round(amountDollars * 100);

  return (
    <p
      data-testid="affirm-promo"
      className="affirm-as-low-as text-sm text-default-foreground"
      data-page-type="product"
      data-amount={cents}
      data-affirm-color="blue"
    />
  );
}
