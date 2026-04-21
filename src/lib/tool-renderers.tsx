"use client";

import type { ReactElement } from "react";

import { CartPreviewCard } from "@/components/cart-preview-card";
import type { CartPreviewPayload, ToolOutput } from "@/types/chat";

/** Renders a single tool output into a React element, or returns null. */
export type ToolRenderer = (output: ToolOutput) => ReactElement | null;

interface ToolRendererEntry {
  render: ToolRenderer;
  /**
   * When true, only the last occurrence of this tool name within a single
   * assistant turn is kept (latest-wins semantics).
   */
  dedupeWithinTurn: boolean;
}

/**
 * @author mike-the-dev (Michael Camacho)
 * @editor mike-the-dev (Michael Camacho)
 * @lastUpdated 2026-04-20
 * @name parseCartPreviewPayload
 * @description Parses the raw JSON `content` string from a `preview_cart` tool
 *   output into a typed `CartPreviewPayload`. Maps snake_case wire fields to
 *   camelCase output. Returns `null` on any parse error or when the parsed
 *   value is missing required fields (`cart_id` or `lines` array).
 * @param content - Raw JSON string produced by the preview_cart tool.
 * @returns A `CartPreviewPayload` or `null` on failure.
 */
export const parseCartPreviewPayload = (
  content: string
): CartPreviewPayload | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object") return null;

  const raw = parsed as Record<string, unknown>;

  if (typeof raw["cart_id"] !== "string") return null;
  if (!Array.isArray(raw["lines"])) return null;

  const lines = (raw["lines"] as unknown[]).map((lineItem) => {
    const line = lineItem as Record<string, unknown>;
    return {
      lineId: String(line["line_id"] ?? ""),
      serviceId: String(line["service_id"] ?? ""),
      name: String(line["name"] ?? ""),
      category: String(line["category"] ?? ""),
      imageUrl: String(line["image_url"] ?? ""),
      variant:
        line["variant"] === null || line["variant"] === undefined
          ? null
          : String(line["variant"]),
      variantLabel:
        line["variant_label"] === null || line["variant_label"] === undefined
          ? null
          : String(line["variant_label"]),
      quantity: Number(line["quantity"] ?? 0),
      price: Number(line["price"] ?? 0),
      total: Number(line["total"] ?? 0),
    };
  });

  return {
    cartId: raw["cart_id"] as string,
    itemCount: Number(raw["item_count"] ?? 0),
    currency: String(raw["currency"] ?? "usd"),
    cartTotal: Number(raw["cart_total"] ?? 0),
    lines,
  };
};

const renderPreviewCart = (output: ToolOutput): ReactElement | null =>
  <CartPreviewCard output={output} />;

/** Internal registry — callers dispatch via `renderToolOutput`. */
const toolRenderers: Record<string, ToolRendererEntry> = {
  preview_cart: { render: renderPreviewCart, dedupeWithinTurn: true },
  save_user_fact: { render: () => null, dedupeWithinTurn: false },
  collect_contact_info: { render: () => null, dedupeWithinTurn: false },
  list_services: { render: () => null, dedupeWithinTurn: false },
  generate_checkout_link: { render: () => null, dedupeWithinTurn: false },
};

/**
 * @author mike-the-dev (Michael Camacho)
 * @editor mike-the-dev (Michael Camacho)
 * @lastUpdated 2026-04-20
 * @name renderToolOutput
 * @description Dispatches a single `ToolOutput` to its registered renderer.
 *   Unregistered tool names return `null`. Passes `isError` through unchanged.
 * @param output - The tool output to render.
 * @returns A `ReactElement` or `null`.
 */
export const renderToolOutput = (output: ToolOutput): ReactElement | null => {
  const entry = toolRenderers[output.toolName];
  if (!entry) return null;
  return entry.render(output);
};

/**
 * @author mike-the-dev (Michael Camacho)
 * @editor mike-the-dev (Michael Camacho)
 * @lastUpdated 2026-04-20
 * @name dedupeToolOutputsWithinTurn
 * @description For tools marked `dedupeWithinTurn: true` in the registry,
 *   keeps only the last occurrence within the array (latest-wins). For tools
 *   marked `dedupeWithinTurn: false`, all occurrences are preserved. The
 *   relative input order is maintained with duplicates collapsed to the
 *   position of their last occurrence.
 * @param outputs - Array of tool outputs for a single assistant turn.
 * @returns A new array with within-turn duplicates removed.
 */
export const dedupeToolOutputsWithinTurn = (
  outputs: ToolOutput[]
): ToolOutput[] => {
  // Collect the index of the last occurrence for each tool name that needs
  // within-turn deduplication.
  const lastIndexByName = new Map<string, number>();
  outputs.forEach((output, index) => {
    const entry = toolRenderers[output.toolName];
    if (entry?.dedupeWithinTurn) lastIndexByName.set(output.toolName, index);
  });

  return outputs.filter((output, index) => {
    const entry = toolRenderers[output.toolName];
    if (!entry?.dedupeWithinTurn) return true;
    return lastIndexByName.get(output.toolName) === index;
  });
};
