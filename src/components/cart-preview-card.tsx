"use client";

import type { ReactElement } from "react";
import { useState } from "react";

import { parseCartPreviewPayload } from "@/lib/tool-renderers";
import type { CartLineItem, ToolOutput } from "@/types/chat";

// v1 assumption: all amounts are in USD cents. The currency field from the
// payload is not passed to the formatter — hard-coded to avoid locale/currency
// mismatch edge cases until multi-currency support is added.
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const formatCents = (cents: number): string => usdFormatter.format(cents / 100);

export interface CartPreviewCardProps {
  output: ToolOutput;
}

interface PlaceholderImageProps {
  category: string;
}

interface LineItemRowProps {
  line: CartLineItem;
}

const PlaceholderImage = ({ category }: PlaceholderImageProps): ReactElement => (
  <div
    aria-hidden="true"
    className="w-10 h-10 rounded bg-default-200 flex items-center justify-center text-default-500 text-xs font-medium shrink-0 uppercase"
  >
    {category.charAt(0).toUpperCase() || "?"}
  </div>
);

const LineItemRow = ({ line }: LineItemRowProps): ReactElement => {
  const [imageErrored, setImageErrored] = useState(false);

  const displayName =
    line.variantLabel !== null ? `${line.name} — ${line.variantLabel}` : line.name;

  return (
    <div data-testid="cart-line-item" className="flex items-center gap-2 py-1">
      {!imageErrored && line.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- intentional: avoids next/image remote-pattern config churn for an iframe-embedded widget
        <img
          src={line.imageUrl}
          alt={line.name}
          width={40}
          height={40}
          className="w-10 h-10 rounded object-cover shrink-0"
          onError={() => setImageErrored(true)}
        />
      ) : (
        <PlaceholderImage category={line.category} />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">{displayName}</p>
        <p className="text-xs text-default-500">
          {line.quantity} × {formatCents(line.price)}
        </p>
      </div>
      <span className="text-xs font-medium text-foreground shrink-0">
        {formatCents(line.total)}
      </span>
    </div>
  );
};

/**
 * @author mike-the-dev (Michael Camacho)
 * @editor mike-the-dev (Michael Camacho)
 * @lastUpdated 2026-04-20
 * @name CartPreviewCard
 * @description Renders a preview of a shopping cart from a `preview_cart` tool
 *   output. Handles error state, parse failure, empty cart, and populated cart.
 *   Amounts are formatted as USD cents / 100. Uses HeroUI palette tokens and
 *   Tailwind for styling to match the existing chat-message.tsx aesthetic.
 * @param output - The raw `ToolOutput` from the `preview_cart` tool call.
 * @returns A `ReactElement` representing the cart preview card.
 */
export const CartPreviewCard = ({
  output,
}: CartPreviewCardProps): ReactElement => {
  if (output.isError === true) {
    return (
      <div
        data-testid="cart-preview-card"
        className="rounded-2xl bg-surface-secondary px-3 py-2 text-xs text-default-500"
      >
        We hit a problem previewing your cart — try asking again.
      </div>
    );
  }

  const payload = parseCartPreviewPayload(output.content);

  if (payload === null) {
    return (
      <div
        data-testid="cart-preview-card"
        className="rounded-2xl bg-surface-secondary px-3 py-2 text-xs text-default-500"
      >
        We hit a problem previewing your cart — try asking again.
      </div>
    );
  }

  if (payload.lines.length === 0) {
    return (
      <div
        data-testid="cart-preview-card"
        className="rounded-2xl bg-surface-secondary px-3 py-2 text-xs text-default-500"
      >
        Cart is empty.
      </div>
    );
  }

  return (
    <div
      data-testid="cart-preview-card"
      className="rounded-2xl bg-surface-secondary px-3 py-2 w-full"
    >
      <p className="text-xs font-semibold text-foreground mb-1">Cart preview</p>
      <div className="divide-y divide-default-100">
        {payload.lines.map((line) => (
          <LineItemRow key={line.lineId} line={line} />
        ))}
      </div>
      <div className="flex justify-between items-center pt-2 mt-1 border-t border-default-100">
        <span className="text-xs font-semibold text-foreground">Total</span>
        <span className="text-xs font-semibold text-foreground">
          {formatCents(payload.cartTotal)}
        </span>
      </div>
    </div>
  );
};
