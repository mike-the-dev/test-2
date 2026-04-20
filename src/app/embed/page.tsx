import { headers } from "next/headers";
import type { ReactElement } from "react";

import { ChatApiError, authorizeEmbed } from "@/lib/api";
import { parseRefererHostname } from "@/lib/referer";

import { EmbedAuthorizationError } from "./embed-authorization-error";
import { EmbedClient } from "./embed-client";

export const dynamic = "force-dynamic";

const DEFAULT_AGENT = "shopping_assistant";

type DenyReason =
  | "missing_referer"
  | "missing_account"
  | "authorize_failed"
  | "authorize_denied";

const denyAuthorization = (
  reason: DenyReason,
  details?: Record<string, unknown>
): ReactElement => {
  console.error("[instapaytient] embed authorization denied", {
    reason,
    ...details,
  });
  return <EmbedAuthorizationError />;
};

/**
 * @author mike-the-dev (Michael Camacho)
 * @editor mike-the-dev (Michael Camacho)
 * @lastUpdated 2026-04-20
 * @name EmbedPage
 * @description Async Server Component for the `/embed` route. Reads the
 *   incoming `Referer` header and `accountUlid` search param, then calls the
 *   embed authorization endpoint before rendering the client widget. All
 *   failure paths are fail-closed — the widget is never shown to unauthorized
 *   origins.
 * @param props - Next.js page props; `searchParams` is a Promise in Next.js 16.
 * @returns `<EmbedClient>` on success, `<EmbedAuthorizationError>` on any deny.
 */
async function EmbedPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<ReactElement> {
  const headerMap = await headers();
  const resolvedSearchParams = await props.searchParams;

  const referer = headerMap.get("referer") ?? null;
  const rawAccountUlid = resolvedSearchParams["accountUlid"];
  const rawAgent = resolvedSearchParams["agent"];
  const rawGuestId = resolvedSearchParams["guestId"];

  const accountUlid =
    (Array.isArray(rawAccountUlid) ? rawAccountUlid[0] : rawAccountUlid ?? "").trim();
  const agent =
    (Array.isArray(rawAgent) ? rawAgent[0] : rawAgent ?? DEFAULT_AGENT).trim();
  const guestId = Array.isArray(rawGuestId)
    ? rawGuestId[0] ?? null
    : rawGuestId ?? null;

  const parentDomain = parseRefererHostname(referer);

  if (!parentDomain) return denyAuthorization("missing_referer");

  if (!accountUlid) return denyAuthorization("missing_account");

  let authorized: boolean;
  try {
    const result = await authorizeEmbed(
      { accountUlid, parentDomain },
      { signal: AbortSignal.timeout(3000), cache: "no-store" }
    );
    authorized = result.authorized;
  } catch (err) {
    if (err instanceof ChatApiError)
      return denyAuthorization("authorize_failed", {
        parentDomain,
        accountUlid,
        status: err.status,
      });
    return denyAuthorization("authorize_failed", { parentDomain, accountUlid });
  }

  if (!authorized)
    return denyAuthorization("authorize_denied", { parentDomain, accountUlid });

  return <EmbedClient agent={agent} guestId={guestId} accountUlid={accountUlid} />;
}

export default EmbedPage;
