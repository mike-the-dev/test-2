import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CartPreviewCard } from "@/components/cart-preview-card";
import type { ToolOutput } from "@/types/chat";

const makeOutput = (
  overrides: Partial<ToolOutput> & Pick<ToolOutput, "content">
): ToolOutput => ({
  toolName: "preview_cart",
  isError: undefined,
  ...overrides,
});

const validCart = JSON.stringify({
  cart_id: "C1",
  item_count: 2,
  currency: "usd",
  cart_total: 10000,
  lines: [
    {
      line_id: "L1",
      service_id: "SVC1",
      name: "Massage",
      category: "wellness",
      image_url: "https://example.com/img.jpg",
      variant: "60min",
      variant_label: "60 min",
      quantity: 1,
      price: 5000,
      total: 5000,
    },
    {
      line_id: "L2",
      service_id: "SVC2",
      name: "Haircut",
      category: "beauty",
      image_url: "",
      variant: null,
      variant_label: null,
      quantity: 2,
      price: 2500,
      total: 5000,
    },
  ],
});

describe("CartPreviewCard", () => {
  it("renders the error fallback when output.isError is true", () => {
    render(<CartPreviewCard output={makeOutput({ content: "{}", isError: true })} />);

    const card = screen.getByTestId("cart-preview-card");
    expect(card).toHaveTextContent(/problem previewing your cart/i);
  });

  it("renders the error fallback when content is invalid JSON", () => {
    render(<CartPreviewCard output={makeOutput({ content: "not json" })} />);

    const card = screen.getByTestId("cart-preview-card");
    expect(card).toHaveTextContent(/problem previewing your cart/i);
  });

  it("renders the empty-cart state when lines array is empty", () => {
    const emptyCart = JSON.stringify({
      cart_id: "C0",
      item_count: 0,
      currency: "usd",
      cart_total: 0,
      lines: [],
    });

    render(<CartPreviewCard output={makeOutput({ content: emptyCart })} />);

    const card = screen.getByTestId("cart-preview-card");
    expect(card).toHaveTextContent(/cart is empty/i);
  });

  it("renders a cart-line-item row for each line", () => {
    render(<CartPreviewCard output={makeOutput({ content: validCart })} />);

    const rows = screen.getAllByTestId("cart-line-item");
    expect(rows).toHaveLength(2);
  });

  it("shows the line name alone when variantLabel is null", () => {
    render(<CartPreviewCard output={makeOutput({ content: validCart })} />);

    // Haircut has no variant label
    expect(screen.getByText("Haircut")).toBeInTheDocument();
    expect(screen.queryByText(/Haircut —/)).toBeNull();
  });

  it("appends variantLabel to the name when present", () => {
    render(<CartPreviewCard output={makeOutput({ content: validCart })} />);

    // Massage has variant label "60 min"
    expect(screen.getByText("Massage — 60 min")).toBeInTheDocument();
  });

  it("formats amounts as USD currency dividing cents by 100", () => {
    render(<CartPreviewCard output={makeOutput({ content: validCart })} />);

    // cartTotal is 10000 cents = $100.00
    expect(screen.getAllByText("$50.00")).toHaveLength(2); // two line totals both $50
    expect(screen.getByText("$100.00")).toBeInTheDocument();
  });

  it("renders the cart-preview-card root testid", () => {
    render(<CartPreviewCard output={makeOutput({ content: validCart })} />);

    expect(screen.getByTestId("cart-preview-card")).toBeInTheDocument();
  });

  it("shows a placeholder when image_url is empty", () => {
    render(<CartPreviewCard output={makeOutput({ content: validCart })} />);

    // Haircut line has empty imageUrl — should render the category initial "B"
    // The placeholder renders the first char of category ("beauty" → "B")
    const placeholders = screen.getAllByText("B");
    expect(placeholders.length).toBeGreaterThan(0);
  });
});
