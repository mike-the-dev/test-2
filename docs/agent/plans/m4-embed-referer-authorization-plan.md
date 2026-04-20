# M4 — Server-side Referer Authorization for `/embed`

## 1. Current State Audit

### File: `src/app/embed/page.tsx`

**Directives and shape:**
- `"use client"` at line 1 — the entire module is a client component.
- Default export `EmbedPage` is a thin Suspense wrapper that renders `<EmbedBody />`.
- `EmbedBody` is an inner function component (not exported) that calls `useSearchParams()`.

**5-state machine (`EmbedState` union):**
```
loading    — waiting on POST /chat/web/sessions
splash     — session created, onboardingCompletedAt is null; shows BudgetSplash
hydrating  — onboarded session found; fetching prior turns
chat       — fully resolved; ChatPanel renders with hydrated history
error      — any network/server failure; ChatErrorCard with retry button
```

**Search-param reads (all inside `EmbedBody`):**
- `agent` — falls back to `"shopping_assistant"` if absent
- `guestId` — passed through to `ensureGuestId()` or used verbatim
- `accountUlid` — passed to `createSession`; falls back to `""`

**Effects and handlers:**
- One `useEffect` keyed on `[agent, queryGuestId, accountUlid, attempt]` — creates the session, branches on `onboardingCompletedAt`, hydrates history.
- `useCallback` retry handler increments `attempt`.
- `useCallback` `handleSplashSubmit` calls `completeOnboarding`.
- `abortRef` (`useRef<AbortController>`) ensures in-flight fetches are cancelled on re-run or unmount.

**Suspense wrapper (default export):**
```tsx
export default function EmbedPage(): ReactElement {
  return (
    <Suspense fallback={<Spinner …/>}>
      <EmbedBody />
    </Suspense>
  );
}
```
The wrapper exists solely because `useSearchParams()` requires a Suspense boundary in the App Router. Once `EmbedBody` is promoted to a client component that receives props instead of calling `useSearchParams`, this Suspense boundary is no longer required.

**What must stay client-bound:**
- All `useState` / `useEffect` / `useRef` / `useCallback` in `EmbedBody`.
- `ensureGuestId()` (touches `localStorage`).
- `createSession`, `completeOnboarding`, `fetchSessionMessages` calls (async side effects driven by user interaction).
- `BudgetSplash`, `ChatPanel`, `ChatErrorCard` renders.

**What moves server-side:**
- Reading `accountUlid` from `searchParams`.
- Calling `POST /chat/web/embed/authorize`.
- Reading `Referer` via `headers()`.
- The hard fail-closed branch (renders static error card instead of the widget).

### File: `src/app/embed/page.test.tsx`

Four `it` blocks, all testing the 5-state machine through the `EmbedPage` default export:
1. Renders `BudgetSplash` for non-onboarded sessions.
2. `handleSplashSubmit` calls `completeOnboarding` and flips to `ChatPanel`.
3. Hydrates prior messages for onboarded sessions.
4. Falls back to empty chat when hydration fails.
5. Renders error card and retries on session-create failure.

The test module imports `EmbedPage` from `@/app/embed/page` and mocks `next/navigation` with an in-memory `URLSearchParams` store. After the split, `EmbedPage` is a Server Component — the tests must migrate to `embed-client.test.tsx` and target `EmbedClient` directly (passing props instead of relying on the navigation mock).

### File: `src/app/widget.js/route.ts`

`export const dynamic = "force-static"`. The GET handler returns the widget JS bundle. The widget source sets `iframe.referrerpolicy = "origin"` on the generated iframe. This file is **read-only** for this milestone.

---

## 2. Proposed File Split

### `src/app/embed/page.tsx` — async Server Component (rewritten)
- No `"use client"` directive.
- `export const dynamic = "force-dynamic"` at module scope.
- Awaits `headers()` from `next/headers` to read `Referer`.
- Awaits `props.searchParams` (Promise in Next.js 16 App Router) to read `accountUlid`, `agent`, `guestId`.
- Calls `parseRefererHostname(referer)` from `src/lib/referer.ts`.
- Calls `authorizeEmbed({ accountUlid, parentDomain })` from `src/lib/api.ts` with a 3 s `AbortSignal.timeout`.
- Branches on the result: renders `<EmbedAuthorizationError />` for every fail-closed case, or `<EmbedClient agent={…} guestId={…} accountUlid={…} />` on success.
- All imports are server-compatible (no browser APIs, no `"use client"` modules imported directly).

### `src/app/embed/embed-client.tsx` — new client component
- `"use client"` at top.
- Receives `{ agent: string; guestId: string | null; accountUlid: string }` as props.
- Contains the full `EmbedState` union, `EmbedBody` logic, `messageFromApiError`, and all hooks/handlers verbatim from the current `page.tsx`.
- Drops `useSearchParams` — values come from props.
- Drops the default-export `Suspense` wrapper — the Server Component renders this directly, no Suspense needed.
- Named export: `export function EmbedClient(…)`.

### `src/app/embed/embed-authorization-error.tsx` — new, server-renderable
- No `"use client"` directive.
- Pure JSX using HeroUI `Card`, `Card.Header`, `Card.Title`, `Card.Content` to match the visual weight of `ChatErrorCard` (same primitives; no `Card.Footer`, no button).
- `data-testid="embed-authorization-error"` on the root `Card`.
- Verbatim copy strings: primary "This site isn't authorized to embed this widget." in `Card.Title`, secondary "Contact the site owner if you believe this is a mistake." as a `<p>` in `Card.Content`.
- Named export: `export function EmbedAuthorizationError()`.
- Wrapped in a centering div matching the error branch in the current client component: `flex flex-1 w-full items-center justify-center p-6`.

### `src/lib/referer.ts` — new pure utility
- Named export: `export const parseRefererHostname = (referer: string | null): string | null`.
- Arrow function, single-purpose.
- Try/catch around `new URL(referer)`. Returns `url.hostname.toLowerCase()`. Returns `null` on any exception or on null/empty input.
- Never throws.
- `new URL` natively strips port from `hostname` (`localhost:3000` → `localhost`; `example.com:443` → `example.com`).

### `src/lib/api.ts` — additive change
- Add `export function authorizeEmbed(request: EmbedAuthorizeRequest, init?: { signal?: AbortSignal }): Promise<EmbedAuthorizeResponse>`.
- Uses the existing `postJson` helper internally (`postJson<EmbedAuthorizeResponse>("/chat/web/embed/authorize", request, init)`).
- After `postJson` resolves, validate `typeof result.authorized === "boolean"`; if not, throw `new ChatApiError("malformed authorize response", 200, result)`.
- Callers (the Server Component) catch `ChatApiError` and treat it as fail-closed.
- No changes to existing exports.

### `src/types/chat.ts` — additive change
- Add `EmbedAuthorizeRequest`: `{ accountUlid: string; parentDomain: string }`.
- Add `EmbedAuthorizeResponse`: `{ authorized: boolean }`.
- No changes to existing types.

---

## 3. Server Component Control Flow

```
async function Page(props) {
  // --- Read inputs ---
  const headerMap   = await headers();
  const searchParams = await props.searchParams;

  const referer      = headerMap.get("referer") ?? null;   // lowercase key per spec
  const accountUlid  = (searchParams["accountUlid"] ?? "").trim();
  const agent        = (searchParams["agent"] ?? DEFAULT_AGENT).trim();
  const guestId      = searchParams["guestId"] ?? null;

  // Helper: log + return error element
  const denyAuthorization = (reason, details = {}) => {
    console.error("[instapaytient] embed authorization denied", { reason, ...details });
    return <EmbedAuthorizationError />;
  };

  // --- Fail-closed: missing accountUlid ---
  if (!accountUlid)
    return denyAuthorization("missing accountUlid");

  // --- Fail-closed: unparseable or missing Referer ---
  const parentDomain = parseRefererHostname(referer);
  if (!parentDomain)
    return denyAuthorization("unparseable or missing Referer", { accountUlid });

  // --- Call authorize endpoint (3 s timeout) ---
  let authorized: boolean;
  try {
    const result = await authorizeEmbed(
      { accountUlid, parentDomain },
      { signal: AbortSignal.timeout(3000) }
    );
    authorized = result.authorized;
  } catch (err) {
    const status = err instanceof ChatApiError ? err.status : "unknown";
    return denyAuthorization("authorize fetch failed", { accountUlid, parentDomain, status });
  }

  // --- Fail-closed: explicit deny ---
  if (!authorized)
    return denyAuthorization("authorized: false", { accountUlid, parentDomain });

  // --- Authorized: render widget ---
  return (
    <EmbedClient agent={agent} guestId={guestId} accountUlid={accountUlid} />
  );
}

export default Page;
```

**All fail-closed branches:**

| Branch | Reason logged |
|--------|---------------|
| `accountUlid` is empty/absent | `"missing accountUlid"` |
| `referer` is null | `"unparseable or missing Referer"` |
| `referer` is `about:blank`, `data:`, non-URL | `"unparseable or missing Referer"` |
| `referer` present but `parseRefererHostname` returns null | `"unparseable or missing Referer"` |
| Network error calling authorize | `"authorize fetch failed"` + status |
| Non-2xx from authorize endpoint | `"authorize fetch failed"` + status |
| Malformed body (no `authorized` boolean) | `"authorize fetch failed"` + status 200 |
| Timeout (AbortError from `AbortSignal.timeout`) | `"authorize fetch failed"` + status 0 |
| `authorized === false` | `"authorized: false"` |
| Any uncaught SSR exception (Next.js error boundary) | error.tsx catches; widget is never shown |

The `denyAuthorization` helper is a local arrow function inside the Server Component (not exported). It ensures the log call and the return value are always paired.

---

## 4. Client Component Adjustments

`embed-client.tsx` is a near-verbatim extraction of `EmbedBody` from the current `page.tsx`. The changes are:

1. Add `"use client"` directive.
2. Change from an internal function component to a named export: `export function EmbedClient(...)`.
3. Replace the three `useSearchParams()` reads with destructured props:
   ```ts
   // Before (inside EmbedBody):
   const searchParams = useSearchParams();
   const agent = searchParams.get("agent") ?? DEFAULT_AGENT;
   const queryGuestId = searchParams.get("guestId");
   const accountUlid = searchParams.get("accountUlid") ?? "";

   // After (EmbedClient props):
   interface EmbedClientProps {
     agent: string;
     guestId: string | null;
     accountUlid: string;
   }
   export function EmbedClient({ agent, guestId, accountUlid }: EmbedClientProps) { … }
   ```
   Inside the component body, rename `queryGuestId` → `guestId` to match the prop name. The `useEffect` dependency array changes from `[agent, queryGuestId, accountUlid, attempt]` to `[agent, guestId, accountUlid, attempt]`.
4. Remove the `import { useSearchParams } from "next/navigation"` line.
5. Remove the `Suspense` import and the `EmbedPage` default export wrapper entirely.
6. All state machine logic, handlers, `abortRef`, render branches — **byte-identical**.
7. The `import` for `Suspense` from React is removed; all other React imports stay.

The `EmbedClient` component does not need a Suspense boundary — the parent Server Component renders it directly, and no call to `useSearchParams` remains inside it.

---

## 5. Route Segment Config

Add to the top of `src/app/embed/page.tsx` (after imports):

```ts
export const dynamic = "force-dynamic";
```

**Why belt-and-braces even though `headers()` already opts in:**
- `headers()` from `next/headers` does opt the route into dynamic rendering by itself per Next.js semantics. However, explicit `force-dynamic` makes the intent unambiguous to future readers, prevents accidental static pre-rendering if a refactor ever removes the `headers()` call first, and mirrors defensive conventions already used elsewhere in the App Router ecosystem.
- It also prevents partial prerendering (PPR) from caching the shell of this route if PPR is ever enabled globally — the authorization gate must run fresh on every request.
- `src/app/widget.js/route.ts` uses `force-static` and is **not touched** by this milestone.

---

## 6. Package Additions

None. `AbortSignal.timeout` is part of the WHATWG Streams specification and is available in Node.js 17.3+ and all modern browsers — no polyfill needed in a Next.js 16 server environment. All other APIs used (`headers`, async `searchParams`, `new URL`) are available in the existing dependency set.

---

## 7. Test Plan

### `src/lib/referer.test.ts` — new, colocated with `referer.ts`

8+ cases for `parseRefererHostname`:

| Input | Expected output |
|-------|----------------|
| `"https://shop.example.com/page"` | `"shop.example.com"` |
| `"http://shop.example.com"` | `"shop.example.com"` |
| `"http://localhost:3000"` | `"localhost"` |
| `"https://192.168.1.1/path"` | `"192.168.1.1"` |
| `"https://SHOP.EXAMPLE.COM/"` | `"shop.example.com"` (lowercase) |
| `"about:blank"` | `null` |
| `"not a url"` | `null` |
| `""` (empty string) | `null` |
| `null` | `null` |

Structure: single `describe("parseRefererHostname")` block, one `it` per row, no mocks needed (pure function).

### `src/lib/api.test.ts` — additive (3 new `it` blocks inside existing `describe("api client")`)

1. `"authorizeEmbed posts to /chat/web/embed/authorize with correct URL, body, and Content-Type header on authorized: true"` — mock fetch returning `{ authorized: true }`, assert URL, method, headers, body, and that the function resolves to `{ authorized: true }`.
2. `"authorizeEmbed throws ChatApiError on non-2xx response"` — mock fetch returning status 403, assert rejects with `ChatApiError` at status 403.
3. `"authorizeEmbed throws ChatApiError when response body lacks the authorized boolean"` — mock fetch returning `{ ok: true, status: 200, body: { something: "else" } }`, assert rejects with `ChatApiError`.

Use `mockFetchOnce` helper already present in the file. Follow existing `it` naming conventions (behavior-first, plain English).

### `src/app/embed/embed-client.test.tsx` — renamed from `page.test.tsx`

- Rename file: `page.test.tsx` → `embed-client.test.tsx`.
- Change import from `@/app/embed/page` → `@/app/embed/embed-client`, import `EmbedClient` (named export).
- Change `render(<EmbedPage />)` → `render(<EmbedClient agent="shopping_assistant" guestId={GUEST} accountUlid={ACCOUNT} />)` in all `it` blocks.
- Remove the `vi.mock("next/navigation", ...)` block and the `currentParams` in-memory store — no longer needed.
- Remove the `beforeEach` lines that set `currentParams` values — props are passed directly.
- All 5 existing test assertions remain identical. No new test logic required.
- The `vi.mock("@/lib/affirm", ...)` block stays unchanged.

### Integration / Server Component — not unit-tested

The Server Component control flow (`page.tsx`) is not tested at the unit level. Reasons:
- `headers()` and `searchParams` as a Promise are Next.js runtime internals that are impractical to mock faithfully in jsdom.
- The authorization logic is fully covered by `referer.test.ts` and `api.test.ts` for their respective units.
- End-to-end coverage is provided by Playwright live verification (step 7 of implementation sequence).

### Playwright live verification (manual gate)

After `npm run dev`:
1. Load `/embed?accountUlid=A#...&agent=shopping_assistant` in an iframe from an allowed origin → widget renders.
2. Load same URL from `evil.com` (or modify `Referer` header in DevTools) → authorization error card with `data-testid="embed-authorization-error"` renders.
3. Load with no `accountUlid` param → error card.
4. Load with no `Referer` header (direct browser navigation) → error card.
5. Check server logs for `[instapaytient] embed authorization denied` on every deny case.

---

## 8. Risks and Edge Cases

### High

**Corporate proxies / browser extensions stripping the Referer header.**
Some enterprise proxies and privacy extensions strip or replace the `Referer` header before it reaches the server. A legitimate customer behind such infrastructure would see the error card with no way to recover.
- Mitigation: This is an accepted trade-off (spec says fail-closed). Document in the operator guide that `Referrer-Policy` on the embedding page must be at least `"origin"` and that the widget script already sets `iframe.referrerpolicy="origin"` on the iframe element, which controls the iframe's outbound header — not the parent document's policy. Proxy stripping is outside the operator's control but is an edge case in practice for the embed use-case.

**AbortSignal.timeout availability in the Node runtime version.**
`AbortSignal.timeout` was added in Node 17.3. If the deployment target runs an older Node, the Server Component will throw on every request.
- Mitigation: Verify `node --version` in the deployment environment before merging. Vercel's default runtime for Next.js 16 uses Node 20+, which is safe.

### Medium

**`about:blank` or `data:` Referer from same-origin navigations.**
Certain browser behaviors (e.g., clicking a link with `target="_blank"`, or an extension injecting the iframe) send `about:blank` or `data:` as the Referer.
- Mitigation: `new URL("about:blank")` does not throw — it parses successfully but `hostname` is `""`. The `parseRefererHostname` function must return `null` for an empty hostname, not an empty string. This is a case the test suite must explicitly cover (see test table row for `about:blank`).

**Next.js fetch deduplication / memoization.**
Next.js 15+ memoizes `fetch` calls with the same URL and options within a single render tree. The authorize call could theoretically be deduplicated with another in-flight request.
- Mitigation: Pass `cache: "no-store"` in the fetch init inside `sendJson` when called from the Server Component path, OR ensure `authorizeEmbed` passes a distinct `signal` (an `AbortSignal` with a unique identity) which breaks deduplication. The simpler fix: add `cache: "no-store"` to the `fetch` call in `sendJson` only when running server-side. Since `sendJson` is used client-side too, the cleanest approach is to have `authorizeEmbed` call `fetch` directly (bypassing `postJson`) with an explicit `cache: "no-store"`. **This is an open question to confirm with the implementer** — see section 9, note on `authorizeEmbed` implementation approach.

**Hostname case-sensitivity against the DynamoDB allowlist.**
The backend may or may not normalize the stored `allowed_embed_origins` entries. If the DynamoDB entry is `"Shop.Example.Com"` and we send `"shop.example.com"`, the backend comparison may fail.
- Mitigation: `parseRefererHostname` already lowercases. The backend (already shipped) should also normalize. No frontend action beyond what is already specified.

**Build output flip from `○` to `ƒ`.**
`/embed` will change from a statically pre-rendered route (circle) to a dynamic server-rendered route (lambda) in `npm run build` output. This increases cold-start exposure on Vercel's serverless infrastructure.
- Mitigation: Expected and acceptable — the route cannot be static without a Referer. Confirm that the Vercel function region is the same region as the backend to minimize authorize round-trip latency.

### Low

**The server-side `fetch` from the Server Component itself carries a `Referer` header.**
The outgoing `authorizeEmbed` fetch from the Next.js server to the backend will carry the internal server URL as `Referer`, not the end-user's origin. The backend must trust the `parentDomain` field in the POST body, not the request's own `Referer`. This is already correct per the backend's contract, but worth noting explicitly so the implementer does not accidentally pass or rely on any header from the outbound fetch.

**Port normalization for non-standard HTTPS/HTTP ports.**
`new URL("https://example.com:8443/path").hostname` returns `"example.com"` — port is in `.port`, not `.hostname`. This is correct behavior. The test suite should include one case with a non-standard port on a non-localhost host to document this.

---

## 9. Strictly Sequential Implementation Order

### Step 1 — Types
**File:** `src/types/chat.ts`
- Append `EmbedAuthorizeRequest` and `EmbedAuthorizeResponse` interfaces.
- Why first: `authorizeEmbed` in `api.ts` and the Server Component both depend on these types.
- Done when: `npx tsc --noEmit` passes with the new interfaces present and no other changes.

### Step 2 — `parseRefererHostname` + its test
**Files:** `src/lib/referer.ts` (create), `src/lib/referer.test.ts` (create)
- Implement the pure `parseRefererHostname` function.
- Write all 9 test cases.
- Why here: The Server Component depends on this utility; testing it in isolation before wiring it in reduces debugging surface.
- Done when: `npm test -- referer` passes (all test cases green).

### Step 3 — `authorizeEmbed` in `api.ts` + its test
**Files:** `src/lib/api.ts` (modify), `src/lib/api.test.ts` (modify)
- Add the `authorizeEmbed` export to `api.ts`. Decide at this step whether to call `postJson` (and add `cache: "no-store"` to the fetch init inside `sendJson`) or call `fetch` directly to ensure `cache: "no-store"` is set only for this call.

  **Recommended approach:** Add an optional `cache` field to `sendJson`'s `init` parameter (`init?: { signal?: AbortSignal; cache?: RequestCache }`) and thread it into the `fetch` call. Pass `cache: "no-store"` from `authorizeEmbed`. This preserves the existing helper without forking to a direct `fetch` call.

- Add `typeof result.authorized === "boolean"` guard inside `authorizeEmbed`; throw `ChatApiError` on malformed body.
- Add 3 new `it` blocks to `api.test.ts`.
- Why here: The Server Component depends on this; isolated tests prove correctness before integration.
- Done when: `npm test -- api` passes with all existing + new tests green.

### Step 4 — `EmbedAuthorizationError` component
**File:** `src/app/embed/embed-authorization-error.tsx` (create)
- Server-renderable JSX, no `"use client"`.
- HeroUI `Card` / `Card.Header` / `Card.Title` / `Card.Content` primitives, matching `ChatErrorCard` visual weight.
- `data-testid="embed-authorization-error"` on the root `Card`.
- Verbatim copy strings as specified.
- No test file for this step — it is a pure presentational component with no logic. Playwright verifies it visually.
- Done when: `npx tsc --noEmit` passes; component renders in Storybook or local browser without runtime errors.

### Step 5 — Extract `EmbedClient` + rename test
**Files:** `src/app/embed/embed-client.tsx` (create), `src/app/embed/embed-client.test.tsx` (create by renaming `page.test.tsx`)
- Create `embed-client.tsx` with `"use client"`, `EmbedClientProps` interface, `EmbedClient` named export, and all state machine logic from the current `page.tsx`.
- Rename `page.test.tsx` → `embed-client.test.tsx`.
- Update imports and `render(...)` calls in the test as described in section 7.
- **Do not delete or modify `page.tsx` yet** — the existing default export still works so the build stays green throughout this step.
- Done when: `npm test -- embed-client` passes with all 5 (now 4, see note) existing scenarios green. (Note: the retry test is scenario 5 in the test file; all 5 `it` blocks must pass.)

### Step 6 — Rewrite `page.tsx` as async Server Component
**File:** `src/app/embed/page.tsx` (rewrite)
- Replace the entire file content:
  - Remove `"use client"`.
  - Add `export const dynamic = "force-dynamic"`.
  - Import `headers` from `next/headers`.
  - Import `parseRefererHostname`, `authorizeEmbed`, `ChatApiError`.
  - Import `EmbedClient` from `./embed-client`.
  - Import `EmbedAuthorizationError` from `./embed-authorization-error`.
  - Implement the `Page` async Server Component with the control flow from section 3.
  - Export `Page` as default.
- Done when: `npx tsc --noEmit` passes, `npm test` passes (no regressions), `npm run build` succeeds with `/embed` showing as `ƒ` (dynamic) in build output.

### Step 7 — Gates
Run in order:
1. `npx tsc --noEmit` — zero type errors.
2. `npm test` — all test suites green, including migrated `embed-client.test.tsx` and new `referer.test.ts` and updated `api.test.ts`.
3. `npm run build` — build succeeds; confirm `/embed` is `ƒ`, `/widget.js` remains `○`.

### Step 8 — Playwright live verification
Start `npm run dev` with dev backend running.
1. Open an allowed-origin page that embeds the widget in an iframe — chat widget renders.
2. Test deny cases enumerated in section 7 (Playwright verification subsection).
3. Check server stdout for expected `console.error` log lines on deny paths.
4. Confirm no `console.error` on the happy path.
