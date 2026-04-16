import { describe, expect, it } from "vitest";

import { extractCheckoutUrl } from "@/lib/checkout-url";

describe("extractCheckoutUrl", () => {
  it("extracts a bare checkout URL", () => {
    const content =
      "Here's your cart: https://shop.example.com/checkout?cart=abc123";
    expect(extractCheckoutUrl(content)).toBe(
      "https://shop.example.com/checkout?cart=abc123"
    );
  });

  it("extracts the URL from a Markdown link", () => {
    const content =
      "All set! [Click here to checkout](https://shop.example.com/checkout?cart=xyz).";
    expect(extractCheckoutUrl(content)).toBe(
      "https://shop.example.com/checkout?cart=xyz"
    );
  });

  it("returns null when no checkout URL is present", () => {
    expect(extractCheckoutUrl("Thanks! Anything else?")).toBeNull();
    expect(
      extractCheckoutUrl("Visit https://shop.example.com/products")
    ).toBeNull();
  });
});
