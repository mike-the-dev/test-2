/**
 * @author mike-the-dev (Michael Camacho)
 * @editor mike-the-dev (Michael Camacho)
 * @lastUpdated 2026-04-20
 * @name parseRefererHostname
 * @description Parses the `Referer` HTTP header value and returns the
 *   lowercased hostname, or `null` when the value is absent, empty,
 *   non-parseable as a URL, or produces an empty hostname (e.g.
 *   `about:blank`, `data:text/html,...`, `file:///path`).
 *   This function never throws.
 * @param referer - The raw `Referer` header string, or `null` when absent.
 * @returns The lowercased hostname extracted from the URL, or `null`.
 */
export const parseRefererHostname = (referer: string | null): string | null => {
  if (referer === null || referer.length === 0) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(referer);
  } catch {
    return null;
  }

  if (parsedUrl.hostname.length === 0) return null;

  return parsedUrl.hostname.toLowerCase();
};
