/**
 * Extract the first checkout URL from an assistant reply.
 *
 * The agent reliably emits a single URL containing `/checkout?` when the
 * `create_guest_cart` tool runs. The URL may appear bare or inside a Markdown
 * link like `[Click here](https://.../checkout?cart=...)`.
 *
 * Returns the matched URL string, or `null` when no checkout URL is present.
 */
export function extractCheckoutUrl(content: string): string | null {
  if (!content.includes("/checkout?")) {
    return null;
  }
  const urlPattern = /https?:\/\/[^\s)<>"']+/g;
  const matches = content.match(urlPattern);
  if (!matches) {
    return null;
  }
  for (const candidate of matches) {
    if (candidate.includes("/checkout?")) {
      return candidate;
    }
  }
  return null;
}
