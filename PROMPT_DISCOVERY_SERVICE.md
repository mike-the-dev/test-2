TASK OVERVIEW
Task name: M4 — Server-side Referer authorization for `/embed`

Objective:
Close the embed-snippet-theft attack vector where someone can view-source on a legit customer site, copy the `<script data-account-ulid="A#...">` tag to a hostile domain (`evil.com`), and have a fully functional chat widget billed to and impersonating the legitimate customer. Today nothing on the frontend stops this — the iframe loads, the session creates, conversations flow, every message is written to the legitimate customer's session history and counts against their LLM budget.

The backend has already shipped the server-side defense: a `POST /chat/web/embed/authorize` endpoint that takes `{ accountUlid, parentDomain }` and returns `{ authorized: boolean }` against the account's `allowed_embed_origins` DynamoDB list (208/208 tests passing, three commits on master). This milestone wires up the frontend half — `/embed` must become a Server Component that reads the browser-set `Referer` header on the iframe's initial load, extracts the parent-page hostname, calls the authorize endpoint, and renders an error card instead of the widget when authorization fails or cannot be determined.

This is **frontend only**. Zero backend changes. The authorize endpoint is production-ready and live.

Relevant context:
- **Stack:** Next.js 16 App Router, TypeScript strict, Tailwind v4, HeroUI v3. Vitest + RTL + jsdom for unit tests. Playwright MCP available for live verification. Scaffold + M3 splash + session contract upgrade are all landed on master (see `docs/journal.md`).
- **Current `/embed/page.tsx` is a client component** (`"use client"` at the top) because it uses `useSearchParams` and drives a 5-state machine (`loading | splash | hydrating | chat | error`). HTTP request headers including `Referer` are only visible server-side via `import { headers } from "next/headers"`. This mandates a restructure: the entry page becomes a Server Component that handles authorization; the existing state-machine logic moves into a child client component that receives the search-param data as props.
- **The widget script already sets `iframe.referrerpolicy = "origin"`** (shipped earlier). The browser-set `Referer` on the iframe's initial load will reliably carry the parent page's origin even if the host page has restrictive `Referrer-Policy` meta tags. JS on the parent page cannot override it. Server-side Referer reading is the ground-truth check we've been preparing for.
- **Authorize endpoint — backend contract (locked):**
  - `POST https://<backend>/chat/web/embed/authorize`
  - Body: `{ accountUlid: string, parentDomain: string }` — `accountUlid` is the full `A#`-prefixed form (same shape flowing through `POST /chat/web/sessions` today); `parentDomain` is the bare hostname, no scheme, no port, no path (e.g. `"customer-blog.com"`, `"localhost"`).
  - Response: always `200 { authorized: boolean }`. A `false` value is a deliberate deny, not an error. The frontend branches on the boolean; the HTTP status is only used for the usual fail-closed handling of non-2xx or network errors.
- **Fail-closed semantics everywhere** (every case converges on the error card):
  - `Referer` header missing or empty
  - `Referer` present but not parseable by `new URL(...)` (including `about:blank`-style inputs)
  - `accountUlid` missing from the incoming URL's search params
  - Authorize fetch errors out (network failure, non-2xx, 3-second timeout)
  - Response body missing or malformed (`typeof body.authorized !== "boolean"`)
  - Authorize returns `{ authorized: false }`
  - Any other unexpected exception during SSR
- **Dev flow:** the operator will manually add `"localhost"` to the account's `allowed_embed_origins` DynamoDB list for local testing. The Referer parser must strip the port (`localhost:3000` → `localhost`) so entries match the allowlist. `new URL(referer).hostname` does this natively (hostname excludes port; host includes it).
- **Timeout posture:** Server Components inherit no default fetch timeout. If the backend hangs, the iframe hangs. Cap the authorize call at 3 seconds via `AbortSignal.timeout(3000)`; a timeout is a fail-closed event.
- **Denial logging:** every fail-closed branch emits a `console.error` in a structured shape so Next.js server logs are auditable. Shape: `{ reason, parentDomain?, accountUlid? }`. Do not log full URLs or PII. `accountUlid` is safe (it's the public key shipped in the integrator snippet).
- **Error card copy:** primary *"This site isn't authorized to embed this widget."*; secondary *"Contact the site owner if you believe this is a mistake."* Deliberately neutral, no technical language. No retry button — authorization denial is not end-user-retryable. Product can tune copy later.
- **Assumption on endpoint auth:** the authorize endpoint is assumed open (no shared secret, no HMAC) — consistent with `POST /chat/web/sessions` which relies on origin-based CORS. If the backend later adds signing, it's additive; no redesign needed on our side.
- **Out of scope for this milestone:**
  - CSP `frame-ancestors` header — scheduled as a separate backend commit
  - Admin UI for `allowed_embed_origins` — populated manually in DynamoDB for now
  - Client-side localStorage hint to skip the SSR check — server is authoritative; no optimistic bypass
  - Any change to chat-flow behavior (session, messages, onboarding, splash) — the authorization gate runs *before* any of that


STEP 1 — ARCHITECTURE PLANNING
Use the arch-planner agent to analyze the current `/embed` structure and produce a structured implementation plan.

Task specifics for this plan:

1. **Current state audit** — confirm what `src/app/embed/page.tsx` looks like today: the `"use client"` directive, the 5-state machine (`loading | splash | hydrating | chat | error`), the `useSearchParams` usage, the `Suspense` wrapper at the default export, the session-create / onboarding / hydration calls. Identify everything that must remain client-bound (state, effects, event handlers) vs. everything that can move server-side (search-param reads can happen in either layer; server is simpler once the page becomes async).

2. **Proposed file split:**
   - `src/app/embed/page.tsx` — becomes an `async` Server Component default export. No `"use client"`. Reads `headers()` and awaits `props.searchParams` (Next.js 16 makes searchParams a Promise). Performs Referer parsing + authorize call. Branches: error card or passes props to the client widget.
   - `src/app/embed/embed-client.tsx` — new file. Hosts the existing client state machine with `"use client"` at the top. Accepts `{ agent, guestId, accountUlid }` as props instead of reading `useSearchParams`. Keeps the existing state machine, API calls, splash/hydration/chat rendering. Drops the `Suspense` wrapper (no longer needed — the server has params synchronously).
   - `src/app/embed/embed-authorization-error.tsx` — new file, simple JSX-returning component. Renders the neutral deny card. No retry button. Uses HeroUI `Card` primitives to match `ChatErrorCard`'s visual weight. Carries `data-testid="embed-authorization-error"`.
   - `src/lib/referer.ts` — new file. Exports `parseRefererHostname(referer: string | null): string | null`. Pure function, wrapped in try/catch around `new URL()`. Strips port. Returns `null` on any parse failure or empty input. Unit-testable without DOM or network.
   - `src/lib/api.ts` — add `authorizeEmbed(request, init?): Promise<EmbedAuthorizeResponse>`. Honors `init.signal`. POST + JSON + `Content-Type`.
   - `src/types/chat.ts` — add `EmbedAuthorizeRequest` and `EmbedAuthorizeResponse` types.

3. **Server Component flow:**
   ```
   page.tsx (async, Server Component)
     ↓ const hdrs = await headers(); const referer = hdrs.get("referer");
     ↓ const params = await props.searchParams;
     ↓ const parentDomain = parseRefererHostname(referer);
     ↓ if (!parentDomain || !params.accountUlid) → deny("missing_*") → <EmbedAuthorizationError />
     ↓ try {
     ↓   const { authorized } = await authorizeEmbed(
     ↓     { accountUlid, parentDomain },
     ↓     { signal: AbortSignal.timeout(3000) }
     ↓   );
     ↓ } catch (err) → deny("authorize_failed", { …err }) → <EmbedAuthorizationError />
     ↓ if (!authorized) → deny("authorize_denied", { parentDomain, accountUlid }) → <EmbedAuthorizationError />
     ↓ return <EmbedClient agent={...} guestId={...} accountUlid={...} />
   ```

4. **Client component adjustments:**
   - `embed-client.tsx` accepts props `{ agent: string; guestId: string | null; accountUlid: string }` — all pre-validated by the server layer.
   - Drops `useSearchParams`; drops the default-export `Suspense` wrapper.
   - All state-machine logic, effects, session calls, splash/hydration/chat rendering stay byte-identical except for the prop-vs-param input swap.

5. **Route segment config:**
   - `export const dynamic = "force-dynamic"` on `page.tsx`. The `headers()` call already opts in to dynamic rendering, but the explicit directive prevents a future refactor from accidentally re-staticizing the route.
   - `src/app/widget.js/route.ts` unchanged — separate route.

6. **Package additions:** none. No new runtime or dev deps.

7. **Test plan (~8 new tests):**
   - `src/lib/referer.test.ts` — `parseRefererHostname`: 6 cases (https URL, http URL, localhost with port, invalid string, empty, null, `about:blank`, IP address).
   - `src/lib/api.test.ts` — `authorizeEmbed`: 3 cases (correct URL + body + headers on 200 with `authorized: true`, throws `ChatApiError` on non-2xx, throws on malformed body shape).
   - `src/app/embed/embed-client.test.tsx` — renamed from `page.test.tsx`; all existing state-machine tests (5 tests) still pass with props in place of query-param mocks.
   - Server component integration — skipped at unit level. Covered by helper unit tests + a Playwright live-verification pass.

8. **Risks / edge cases:**
   - Corporate proxies or privacy extensions strip Referer → error card. Documented behavior; no workaround on our side.
   - Referer is `about:blank` or `data:` in sandboxed contexts → `parseRefererHostname` returns empty-ish hostnames; treat consistently as unauthorized.
   - Next.js fetch memoization — `cache: "no-store"` on the authorize call prevents any dedup/caching across requests.
   - Build output flips `/embed` from `○` (static) to `ƒ` (dynamic). Expected.
   - Server-side fetch to the backend doesn't carry the browser's Referer — the backend consumes `parentDomain` from the body (trusts the Next.js server that derived it). That's intentional and safe.
   - Hostname canonicalization: browsers lowercase hostnames; add a defensive `.toLowerCase()` anyway to eliminate future edge cases if the backend's allowlist is case-sensitive.

9. **Implementation order (strictly sequential):**
   1. Types (`types/chat.ts`) + referer helper + test
   2. `authorizeEmbed` in `api.ts` + test
   3. `EmbedAuthorizationError` component
   4. Extract existing `/embed/page.tsx` client logic into `embed-client.tsx`; rename test
   5. Rewrite `/embed/page.tsx` as async Server Component
   6. Run all gates (`tsc`, `npm test`, `npm run build`)
   7. Live-verify via Playwright against dev backend

Output: a written plan (no code yet). Pause for user review/approval before Step 2.


STEP 2 — IMPLEMENTATION
Use the code-implementer agent to execute the approved plan.

Implementation details:

- **Server Component must be `async`** and use `await headers()` + `await props.searchParams` — Next.js 16 makes `searchParams` a Promise. Do not regress to Next 14/15 patterns.
- **Authorize fetch must include `cache: "no-store"` AND `signal: AbortSignal.timeout(3000)`.** Both non-negotiable. Without `cache: "no-store"`, decisions can be dedup'd across requests. Without the timeout, a slow backend hangs the iframe.
- **Fail-closed helper** — extract a single `denyAuthorization(reason: string, details?: Record<string, unknown>): ReactElement` function at the top of `page.tsx`. Every deny branch calls it. The helper logs the structured deny event (`console.error("[instapaytient] embed authorization denied", { reason, ...details })`) and returns the `<EmbedAuthorizationError />` element. Consistent logging, trivial auditing.
- **`parseRefererHostname` contract:**
  - Input `null` or empty string → return `null`.
  - Input not parseable by `new URL(input)` → return `null` (try/catch).
  - Otherwise return `url.hostname.toLowerCase()` (defensive lowercase).
  - Never throws.
- **`authorizeEmbed` contract:**
  - POSTs to `${chatApiUrl}/chat/web/embed/authorize` with JSON body `{ accountUlid, parentDomain }` and `Content-Type: application/json`.
  - Honors `init.signal` (propagates `AbortSignal.timeout(3000)`).
  - On non-2xx → throw existing `ChatApiError` with `{ status, body }`.
  - On 2xx but malformed body (`typeof body.authorized !== "boolean"`) → throw `ChatApiError("malformed authorize response", 200, body)`.
  - Returns `{ authorized: boolean }` on clean success.
- **Error card** — HeroUI `Card` + `Card.Header` + `Card.Content`. Layout matches existing `ChatErrorCard`. Copy verbatim:
  - Primary line: *"This site isn't authorized to embed this widget."*
  - Secondary line: *"Contact the site owner if you believe this is a mistake."*
  - `data-testid="embed-authorization-error"` on the root Card element.
  - No retry button.
- **Logging shape** — every deny-path `console.error` emits an object:
  ```ts
  {
    reason: "missing_referer" | "missing_account" | "parse_failed" |
            "authorize_failed" | "authorize_denied" | "malformed_response",
    parentDomain?: string,
    accountUlid?: string,
    status?: number,
  }
  ```
  Do not log full URLs. Do not log headers. Do not log response bodies beyond status code.
- **Route config** — `export const dynamic = "force-dynamic"` at the top of `page.tsx`.

Hard constraints:
- NO changes to chat flow (sessions, onboarding, messages, splash, widget.js) — the gate runs before any of that.
- NO `any`, NO `@ts-ignore`, NO `as unknown as X` without justification.
- NO `"use client"` in `page.tsx`, `embed-authorization-error.tsx`, `referer.ts`, or `api.ts`.
- NO caching, memoization, or revalidation on the authorize fetch.
- NO swallowed errors — every fail path must log before returning the error card.

Output: final working code, list of files created/modified, and self-verification results (`npx tsc --noEmit`, `npm test`, `npm run build`).


STEP 3 — STYLE REFACTOR
Use the style-refactor agent to align the implementation with project conventions.

Style rules:
- HeroUI v3 for every visual primitive in the error card (`Card`, `Card.Header`, `Card.Content`). Tailwind utilities only for layout (flex, gap, padding, text alignment).
- TypeScript strict throughout. No `any`. No `@ts-ignore`. Use `unknown` + narrow on the authorize response body.
- Named function exports for the Server Component (`async function EmbedPage(...)`) — match the existing `HomePage`/`EmbedBody` convention.
- Explicit `ReactElement` / `Promise<ReactElement>` return types on exported components.
- Imports grouped: React/Next → third-party (`@heroui/react`) → local (`@/lib/*`, `@/components/*`, `@/types/*`). Blank line between groups.
- No unused imports.
- `"use client"` directive lives only on `embed-client.tsx`.
- Preserve every existing `data-testid` attribute used by tests.
- Match the project's `const SOMETHING = "literal" as const;` convention for small inline string unions (used for `reason` codes).

Do NOT:
- Change functionality or behavior
- Rename files the plan specified
- Collapse the helper split (`parseRefererHostname` and `authorizeEmbed` stay separate from `page.tsx`)
- Remove any `data-testid` attributes

After refactor, `tsc`, `npm test`, and `npm run build` must all still be green.


STEP 4 — TEST EXECUTION
Use the test-suite-runner agent to run the full gate.

Commands:
1. `npm test` — expect 43 existing tests + ~8 new ones = ~51 total.
2. `npx tsc --noEmit` — zero errors.
3. `npm run build` — green. Route output should now show `/embed` as `ƒ` (dynamic) instead of `○` (static). Other routes (`/`, `/_not-found`, `/widget.js`) stay as-is.

Report:
- Pass/fail per gate
- Any failing tests with assertion error text
- Any TypeScript errors verbatim
- Route summary (confirm `/embed` is dynamic; other routes unchanged)

Do NOT modify any files. Report only.


STEP 5 — CODE REVIEW
Use the code-reviewer agent to review against the plan and these focus areas.

1. **Server Component correctness** — `page.tsx` is async, uses `await headers()`, awaits `searchParams`, has no `"use client"` directive, renders no client-only APIs directly. `export const dynamic = "force-dynamic"` present.

2. **Referer parsing security** — `parseRefererHostname` never throws on any input. Port is stripped (test `localhost:3000` → `"localhost"`). Returns `null` on empty, `null`, non-URL strings, and edge cases like `about:blank`. Hostname is lowercased for consistency with the allowlist.

3. **Fail-closed coverage** — every failure mode converges on the error card:
   - Missing Referer, missing accountUlid
   - Unparseable Referer
   - Fetch network error
   - Fetch non-2xx
   - Fetch 3-second timeout
   - Malformed response body (`authorized` not a boolean)
   - `authorized: false`
   
   Each branch emits a structured `console.error` before returning the card. No silent swallows.

4. **Authorize fetch hygiene** — `cache: "no-store"` present. `AbortSignal.timeout(3000)` propagated via `init.signal`. Correct URL path (`/chat/web/embed/authorize`). Correct body field names (`accountUlid`, `parentDomain`). `Content-Type: application/json` header.

5. **No behavioral regression** — the 5-state machine in `embed-client.tsx` is preserved byte-for-byte except for the prop-vs-searchParam input swap. Splash submit → onboarding POST → ChatPanel still works. Returning-visitor hydration still works. All existing test-ids still present.

6. **Deny-path logging** — every deny branch logs `{ reason, parentDomain?, accountUlid? }`. No PII, no full URLs, no response bodies. Reason codes match the enumerated list.

7. **Type safety** — no `any`, no `@ts-ignore`, no unsafe casts. `EmbedAuthorizeRequest` and `EmbedAuthorizeResponse` are properly typed. Response narrowing rejects malformed shapes.

8. **Test coverage** — `parseRefererHostname` has 6+ cases covering happy path + all edge cases. `authorizeEmbed` has 3+ cases (happy, non-2xx, malformed body). `embed-client.test.tsx` covers the state machine (renamed from `page.test.tsx`). No E2E attempted at the unit layer; that's Playwright's job.

9. **File layout / naming** — matches the plan: `page.tsx`, `embed-client.tsx`, `embed-authorization-error.tsx`, `referer.ts`, tests colocated. `"use client"` only on `embed-client.tsx`. No cross-boundary imports from server → client that break the RSC rules.

10. **Build output** — `/embed` is `ƒ` (dynamic). Other routes (`/`, `/_not-found`, `/widget.js`) stay `○` (static).

Output: structured markdown report with PASS / WARN / FAIL per focus area. Overall verdict: **APPROVED** / **APPROVED WITH NOTES** / **CHANGES REQUESTED**. Must-fix items listed separately from non-blocking observations.
