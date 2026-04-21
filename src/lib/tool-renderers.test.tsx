import { describe, expect, it } from "vitest";

import {
  dedupeToolOutputsWithinTurn,
  parseCartPreviewPayload,
} from "@/lib/tool-renderers";
import type { ToolOutput } from "@/types/chat";

const makeOutput = (toolName: string, content = "{}"): ToolOutput => ({
  toolName,
  content,
});

const validCartJson = JSON.stringify({
  cart_id: "C1",
  item_count: 2,
  currency: "usd",
  cart_total: 5000,
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
  ],
});

describe("parseCartPreviewPayload", () => {
  it("returns null for invalid JSON", () => {
    const result = parseCartPreviewPayload("not json");

    expect(result).toBeNull();
  });

  it("returns null when cart_id is missing", () => {
    const result = parseCartPreviewPayload(
      JSON.stringify({ item_count: 0, lines: [] })
    );

    expect(result).toBeNull();
  });

  it("returns null when lines is not an array", () => {
    const result = parseCartPreviewPayload(
      JSON.stringify({ cart_id: "C1", lines: "bad" })
    );

    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = parseCartPreviewPayload("");

    expect(result).toBeNull();
  });

  it("maps snake_case wire fields to camelCase CartPreviewPayload", () => {
    const result = parseCartPreviewPayload(validCartJson);

    expect(result).not.toBeNull();
    expect(result!.cartId).toBe("C1");
    expect(result!.itemCount).toBe(2);
    expect(result!.currency).toBe("usd");
    expect(result!.cartTotal).toBe(5000);
    expect(result!.lines).toHaveLength(1);
  });

  it("maps snake_case line item fields to camelCase CartLineItem", () => {
    const result = parseCartPreviewPayload(validCartJson);

    const line = result!.lines[0];
    expect(line.lineId).toBe("L1");
    expect(line.serviceId).toBe("SVC1");
    expect(line.name).toBe("Massage");
    expect(line.category).toBe("wellness");
    expect(line.imageUrl).toBe("https://example.com/img.jpg");
    expect(line.variant).toBe("60min");
    expect(line.variantLabel).toBe("60 min");
    expect(line.quantity).toBe(1);
    expect(line.price).toBe(5000);
    expect(line.total).toBe(5000);
  });

  it("coerces null variant and variant_label to null on the output type", () => {
    const json = JSON.stringify({
      cart_id: "C2",
      item_count: 1,
      currency: "usd",
      cart_total: 1000,
      lines: [
        {
          line_id: "L2",
          service_id: "SVC2",
          name: "Haircut",
          category: "beauty",
          image_url: "",
          variant: null,
          variant_label: null,
          quantity: 1,
          price: 1000,
          total: 1000,
        },
      ],
    });

    const result = parseCartPreviewPayload(json);

    expect(result!.lines[0].variant).toBeNull();
    expect(result!.lines[0].variantLabel).toBeNull();
  });

  it("handles an empty lines array", () => {
    const json = JSON.stringify({
      cart_id: "C3",
      item_count: 0,
      currency: "usd",
      cart_total: 0,
      lines: [],
    });

    const result = parseCartPreviewPayload(json);

    expect(result).not.toBeNull();
    expect(result!.lines).toHaveLength(0);
  });
});

describe("dedupeToolOutputsWithinTurn", () => {
  it("keeps only the last preview_cart when multiple are present, preserving relative order of others", () => {
    // Arrange
    const first = makeOutput("preview_cart", '{"cart_id":"C1","lines":[]}');
    const second = makeOutput("preview_cart", '{"cart_id":"C2","lines":[]}');
    const third = makeOutput("preview_cart", '{"cart_id":"C3","lines":[]}');
    const fact = makeOutput("save_user_fact");
    const inputs: ToolOutput[] = [first, fact, second, third];

    // Act
    const result = dedupeToolOutputsWithinTurn(inputs);

    // Assert: fact survives (dedupeWithinTurn: false), only the last
    // preview_cart survives, collapsed to its original position (index 3).
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(fact);
    expect(result[1]).toBe(third);
  });

  it("does not dedupe tools with dedupeWithinTurn: false", () => {
    // Arrange
    const first = makeOutput("save_user_fact", '{"fact":"a"}');
    const second = makeOutput("save_user_fact", '{"fact":"b"}');

    // Act
    const result = dedupeToolOutputsWithinTurn([first, second]);

    // Assert: both survive because save_user_fact has dedupeWithinTurn: false
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(first);
    expect(result[1]).toBe(second);
  });

  it("passes through a single preview_cart entry unchanged", () => {
    const output = makeOutput("preview_cart", validCartJson);

    const result = dedupeToolOutputsWithinTurn([output]);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(output);
  });

  it("returns an empty array when given an empty array", () => {
    expect(dedupeToolOutputsWithinTurn([])).toEqual([]);
  });

  it("passes through unregistered tool names unchanged", () => {
    const unknown = makeOutput("unknown_tool");

    const result = dedupeToolOutputsWithinTurn([unknown]);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(unknown);
  });
});
