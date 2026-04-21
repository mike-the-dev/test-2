# Project journal

Narrative log of meaningful milestones on `ai-chat-session-api`. Newest entries on top.

This file is the **story** of the project — what we set out to do, what we decided, what's next. It is intentionally different from the reference docs under [`docs/reference/`](./README.md), which describe the system as it exists right now. Reference docs answer *"what is this?"*; the journal answers *"how did we get here and where are we going?"*.

---

## How to add an entry

At the end of a working session — or after shipping a meaningful milestone — append a dated section at the **top** of the entries below. Keep it tight.

**Format:**

```
## YYYY-MM-DD — short title

**Goal:** one sentence on what we set out to do.

**What changed:**
- 3–6 bullets of the meaningful outcomes (not every file touched).

**Decisions worth remembering:**
- 0–3 bullets of non-obvious calls and *why* we made them.

**Next:**
- 0–3 bullets of what a future session would pick up.
```

**Rules of thumb:**

- One entry per meaningful milestone, not per session. Building the email reply loop deserves an entry. Renaming a variable does not.
- Favor *why* over *what*. The diff shows what changed. The journal should capture the reasoning that doesn't survive in the code.
- Keep each entry under ~30 lines. If it's longer than that, it's trying to be a spec — put it in `docs/reference/` instead.
- When this file crosses ~500 lines, cut the oldest third into `docs/journal-archive-<year>.md` and link it from the bottom of this file.

---

## 2026-04-21 — Kickoff guard goes server-authoritative

**Goal:** replace the client-side localStorage kickoff guard with a server-authoritative `kickoffCompletedAt: string | null` field so the backend is the single source of truth for whether a session has been greeted. Backend shipped the field on both session-create and onboarding responses; this milestone is the frontend cutover.

**What changed:**
- `SessionInfo` in `src/types/chat.ts` gained `kickoffCompletedAt: string | null` alongside `onboardingCompletedAt` and `budgetCents`. Both `POST /chat/web/sessions` and `POST /chat/web/sessions/:ulid/onboarding` return it. Backend stamps only after the welcome PutCommand commits (stamp UpdateCommand comes after by construction), so retry-on-failure semantics remain natural without any client-side bookkeeping.
- Ripped out `kickoffStorageKey`, `hasKickoffFired`, and `markKickoffFired` from `embed-client.tsx` along with every reference to the `instapaytient_kickoff_<sessionUlid>` localStorage key. First-time-visitor path now guards on `updated.kickoffCompletedAt !== null`.
- Returning-visitor path gained a new conditional dispatch block for the onboarded-but-never-kicked-off edge case. Without it, any kickoff that failed before the backend stamped would leave the session permanently ungreeted on subsequent loads — the whole retry argument for moving authority server-side collapses if the frontend only dispatches on the first-time path.
- Defense-in-depth sentinel filters kept verbatim — the hydration-side `__SESSION_KICKOFF__` filter in `src/lib/api.ts` and the render-side suppression in `src/components/chat-message.tsx` both still fire regardless of which side owns the dispatch guard. Cheap and they catch drift.
- Tests migrated to a `makeSession({ overrides })` fixture helper. Four new scenarios: idempotent skip on first-time path (onboarding response already stamped), idempotent skip on returning-visitor path (session-create already stamped), dispatch on returning-visitor path when null, and hydrated-history fallback when returning-visitor kickoff fails. All localStorage assertions gone.

**Decisions worth remembering:**
- **Hard-required, not optional.** Typed the new field as `string | null`, not `string | null | undefined`. Backend is live and guarantees the field on both endpoints. Accepting `undefined` would silently coerce to "dispatch always" on a backend regression and produce duplicate greetings. Loud runtime failure on schema drift beats silent behavioral failure — we learned this the hard way on the `budgetCents`-vs-`budgetDollars` dance.
- **Two parallel dispatch blocks, not a shared helper.** The first-time path and the returning-visitor path each have their own kickoff try/catch. Extracting looked tempting in review but the differences are load-bearing (different session variables, different `initialMessages` composition, different closure scopes for the abort signal) and the two blocks together are under 40 lines. Trigger for extraction: a third dispatch site.
- **Abort-guard asymmetry is intentional.** The useEffect closure has a `cancelled` flag it checks alongside `controller.signal.aborted`; the `handleSplashSubmit` callback has only the controller signal because `cancelled` lives in the useEffect scope. A one-line comment at the top of `submitOnboarding` documents why the next reader shouldn't assume it was an oversight.
- **The returning-visitor dispatch block was not in the original brief.** The backend memo described a two-site predicate swap; the arch-planner caught the gap during review. Adding it in-scope is the correct call: without it, the server-authoritative model's retry story is only half true. A separate PR "for correctness" would have left the codebase in a temporarily-wrong state for no reason.

**Next:**
- Playwright live verification against the four scenarios in `PROMPT_DISCOVERY_SERVICE.md` — fresh visitor kickoff, hard-refresh mid-session, devtools race probe (send a second `__SESSION_KICKOFF__` manually to confirm backend idempotency returns the stored welcome rather than regenerating), regression sweep over budget greeting, contact gate, catalog gate, checkout URL, post-link cart edits.
- Historic `tool_outputs` through the hydration endpoint remain unsolved — reopening a previously-previewed cart still shows no card until a new `preview_cart` fires. Same gap as before this milestone.
- Interactive cart card (edit qty, remove line) still waiting on backend cart-mutation tools.

---

## 2026-04-20 (late night) — Auto-greeting on splash submit replaces the stateless empty-state

**Goal:** eliminate the hardcoded "What are you shopping for today?" placeholder that appeared between splash submit and the visitor's first message. Shopping intent is already captured by the time they submit the budget; the agent should greet them proactively instead of waiting.

**What changed:**
- Frontend sends a sentinel turn `POST /chat/web/messages { message: "__SESSION_KICKOFF__" }` immediately after `POST /onboarding` returns success. Backend recognizes the sentinel, generates the opening greeting (including the budget acknowledgment), and also filters the sentinel out of `GET /messages` hydration so it never reappears as a user bubble on reload.
- `embed-client.tsx` gained a new `kickoff` state between `splash` and `chat`. It renders the same spinner as `hydrating` so the transition visually matches the returning-visitor path (~3-6s while the agent composes). On success the assistant reply becomes `initialMessages[0]` of `ChatPanel`, so the chat log lands already populated — no placeholder flash.
- `SESSION_KICKOFF_CONTENT = "__SESSION_KICKOFF__"` is exported from `src/lib/api.ts` as the shared wire contract. Any drift requires backend coordination; the constant is referenced from both the dispatch site and the two filter sites.
- Defense-in-depth filtering: the hydration mapper drops user messages matching the sentinel (belt for when backend filtering somehow slips), and `ChatMessageView` returns `null` on the same match (suspenders against any state path we forgot about).
- localStorage guard `instapaytient_kickoff_<sessionUlid>` prevents a double-fire. Crucially set **after** the `sendMessage` response resolves, not before — a failed kickoff leaves no trace, so the next page load can retry instead of being stuck in empty-chat forever. The state-machine spinner already prevents concurrent dispatches during the in-flight window.
- Kickoff failure is not fatal: drop to empty chat, log, move on. The visitor can still type.

**Decisions worth remembering:**
- **Set-after-success guard.** Initial plan was set-before to prevent double-fire, but that traps a failed kickoff permanently (guard set, but no greeting ever rendered). Set-after means the tradeoff is a tiny double-fire window during the in-flight request, which is covered by the state machine's spinner. Backend confirmed they don't enforce single-fire server-side, so a leaked double-greet would produce an extra welcome bubble in scrollback — not catastrophic and vanishingly unlikely in practice.
- **Kickoff lives in `embed-client.tsx`, not `ChatPanel`.** It's session-lifecycle work, not user-driven chat. `ChatPanel` stays pure — only renders state and owns user submits. Adding a new state to the existing machine beats threading a "fireKickoff" prop through component boundaries.
- **Shared constant, not duplicated strings.** Exported `SESSION_KICKOFF_CONTENT` rather than inlining `"__SESSION_KICKOFF__"` at three sites. If the backend ever needs to rotate the sentinel (they won't, but), it's a one-line frontend change.
- **Defense-in-depth filters don't need to be smart — just cheap.** One equality check at hydration, one equality check at render. Both would be invisible code if they were written as one-liners. We could lean on the backend alone, but the cost of the extra guards is effectively zero and the cost of a leaked sentinel bubble is "visible debug string in production chat."

**Next:**
- Watch for the new backend double-confirmation gate at checkout ("Just to confirm — the cart looks good and you're ready to proceed?") — observed in live E2E but unrelated to kickoff. If it's not desired, push back to backend; if it is, consider a UI affordance (a "Yes, proceed" quick-reply chip) to lower friction.
- Surface a "welcome back" variant of the kickoff for returning visitors whose GET `/messages` returns zero turns (onboarded but never chatted). Today they get the empty chat pane. Small polish.

---

## 2026-04-20 (night) — Cart preview card + generic `tool_outputs` renderer registry

**Goal:** wire the backend's new generic `tool_outputs` channel into the chat UI and ship the first concrete renderer — a structured cart preview card that appears inline with the assistant turn that produced it, replacing the prose-only cart summary with a qty × variant × unit price × line-total view plus a cart total footer.

**What changed:**
- Extended `SendMessageResponse` with optional `toolOutputs?: ToolOutput[]`. Added a per-turn `ToolOutput` envelope (`toolName`, `content`, `isError?`) and a typed `CartPreviewPayload` (line items with ULID `lineId`, `serviceId`, `imageUrl`, `variant`/`variantLabel`, `quantity`, `price`, `total`, plus `cartTotal` in cents).
- New `src/lib/tool-renderers.tsx` — a renderer registry (`tool_name → React component`) with a single public `renderToolOutput(output)` dispatch. `preview_cart` is registered; `save_user_fact`, `collect_contact_info`, `list_services`, `generate_checkout_link` are registered as explicit no-op stubs so adding future renderers is a two-file change (new component + one registry entry) with no churn in `ChatPanel` or `ChatMessageView`.
- New `src/components/cart-preview-card.tsx` — HeroUI-palette-consistent card with `bg-surface-secondary` rounded-2xl, line-item rows (thumbnail + name + optional variant label + qty/unit/line total), a cart total footer, and fail-soft branches for parse failure, `is_error: true`, and empty `lines[]`. Amounts formatted via a module-scoped `Intl.NumberFormat('en-US', { currency: 'USD' })` — hard-coded USD for v1.
- `ChatPanel.submit()` now applies a within-turn dedupe (`dedupeToolOutputsWithinTurn`, per-tool `dedupeWithinTurn: true` flag for `preview_cart`) and a cross-turn strip (when a new `preview_cart` arrives, `preview_cart` entries on prior assistant messages are filtered out; if the resulting `toolOutputs` is empty, it becomes `undefined`, never `[]`).
- Backend normalization (snake_case → camelCase) is private to `src/lib/api.ts` via an internal `SendMessageWireResponse` type. Absent `tool_outputs` → `toolOutputs` is `undefined`, not `[]`, so the render guard stays a cheap truthy check. Public signature of `sendMessage` is unchanged.

**Decisions worth remembering:**
- **Two-file extension point.** Registry lives at `src/lib/tool-renderers.tsx`, not `src/features/toolOutputs/`. A feature folder would have been four stub files and a hollow `index.ts` for a cross-cutting concern that isn't a product feature. Trigger for migration: five or more distinct renderers.
- **Dedupe at the state boundary, not the view.** Within-turn + cross-turn dedupe both happen inside `ChatPanel.submit()` so `messages` is the canonical source of truth. `ChatMessageView` trusts what it receives and renders without a full-array scan. When the backend shipped server-side within-turn dedupe two hours after this landed (commit 395bc357), the frontend logic became redundant-but-correct — planned as a separate cleanup PR rather than a hot-fix, since "works as-is" trumps "fewest lines" for a security-adjacent surface.
- **`preview_cart` renderer owns its error state; registry never swallows `is_error`.** The registry is a pure dispatch table; each renderer decides how to present its own error. A cart error card and a (future) contact-form error card shouldn't share copy.
- **Prose-based "Open checkout" CTA stays.** `generate_checkout_link` is registered as a stub for now; the button continues to come from `extractCheckoutUrl()` scraping the prose. The robust-long-term move is pulling the URL from the tool output — deferred to a follow-up, no behavior change today.
- **Live E2E caught only one gap.** Cross-turn strip couldn't be exercised because the shopper agent refuses to edit the cart after `generate_checkout_link` fires. Unit tests cover it; the gap is a backend-policy artifact, not a frontend concern.

**Next:**
- Cleanup PR: (a) delete `dedupeToolOutputsWithinTurn` + the `dedupeWithinTurn` flag now that the backend enforces it server-side; (b) migrate the `<Fragment key>` from `${index}-${output.toolName}` to `output.callId` (new wire field, stable per tool call). Both purely redundant-surface reduction.
- Surface historic `tool_outputs` through the hydration endpoint so returning visitors see their previously-previewed cart. Today the GET `/messages` response is prose-only; a reopened widget shows no card until the next `preview_cart` fires. Acceptable for v1.
- Interactive cart card (edit qty, remove line) once the backend exposes cart-mutation tools.

---

## 2026-04-20 (late) — M4: server-side Referer authorization closes the snippet-theft vector

**Goal:** stop an attacker from copying a legit customer's `<script data-account-ulid>` tag onto a hostile domain and mounting a fully-functional widget that bills to the legitimate customer. Until this landed, the only authentication flowing with the embed was a public ULID shipped in the snippet — trivially copyable.

**What changed:**
- `/embed` became an `async` Server Component. Reads `headers()` to get the browser-set `Referer`, parses the hostname (port stripped, lowercased), calls the backend's new `POST /chat/web/embed/authorize` with `{ accountUlid, parentDomain }`, and renders an `EmbedAuthorizationError` card unless the response says `authorized: true`.
- Existing 5-state client machine moved unchanged into `embed-client.tsx`, now receiving `agent` / `guestId` / `accountUlid` as props instead of reading them via `useSearchParams`. The `Suspense` wrapper disappeared — server has the params synchronously.
- New helpers: pure `parseRefererHostname` that never throws (guards `new URL()` + empty-string hostname for `about:blank` / `data:` / `file:` inputs), and a typed `authorizeEmbed` in `api.ts` that inherits the shared `ChatApiError` semantics via an extended `sendJson` that now accepts an optional `cache: "no-store"`.
- Fail-closed discipline across seven failure modes (missing header, missing param, parse fail, fetch throw, non-2xx, 3s timeout via `AbortSignal.timeout(3000)`, malformed response, deny). Every path emits a structured `console.error` with `{ reason, parentDomain?, accountUlid? }` so denials are auditable in Next.js server logs without leaking URLs or bodies.
- Error card copy is deliberately neutral — *"This site isn't authorized to embed this widget. Contact the site owner if you believe this is a mistake."* No retry button; denial is not end-user-retryable.

**Decisions worth remembering:**
- **Server-authoritative with no client bypass.** We discussed a localStorage "already-authorized" hint; said no. The server check is cheap (backend caches tuples in-memory) and the flash is sub-second. Every iframe load gets a fresh gate call.
- **Frontend short-circuits obviously-invalid requests before touching the backend.** Missing Referer and missing `accountUlid` fail-closed client-side without calling the authorize endpoint. Confirmed by the backend logs: the only requests hitting `/embed/authorize` are ones that passed the two frontend guards, saving the backend the noise.
- **`cache: "no-store"` is non-negotiable.** Without it, Next.js's fetch dedup/caching can sticky an authorize decision across requests. The happy-path test now asserts `expect(init.cache).toBe("no-store")` to pin the wire behavior against silent regression.
- **Hostname normalization is a shared contract.** Frontend lowercases + port-strips via `new URL().hostname`; backend compares against the allowlist as-stored. The dev flow is "add `localhost` (no port, no scheme) to the `allowed_embed_origins` array on the account record." Cache-hit on the repeat call proves both sides produce identical tuples.
- **Dead reason codes got pruned after review.** `DenyReason` was initially a 6-member union; two members (`parse_failed`, `malformed_response`) turned out to be subsumed by `authorize_failed` in practice. Removed — dead code in a security path is worse than no code; it invites future maintainers to assume deterministic behavior that doesn't exist.

**Next:**
- CSP `frame-ancestors` is still the second half of the defense-in-depth pair — a browser-level render gate that fires even if somehow the Next.js SSR authorize call leaks a false positive. Scheduled as a separate backend commit; frontend piece is a one-line middleware header write once the backend ships the allowlist-to-header logic.
- Admin UI for `allowed_embed_origins` — populated manually in DynamoDB today; needs a real dashboard before onboarding the first production customer.
- Playwright MCP hit a process-kill glitch mid-session; live-verify was done via `curl` (SSR HTML inspection) + backend log review + manual browser smoke test. All three agreed. MCP reload + a canonical Playwright E2E of the M4 flow is a low-priority polish for next session.

---

## 2026-04-20 — Session contract goes server-authoritative: accountUlid validation + structured onboarding + history hydration

**Goal:** close two gaps exposed during Playwright testing of the splash milestone — (a) the embed's account identity was a spoofable body field, and (b) every reopen of the widget re-ran the splash and re-sent the budget intro, bloating the conversation with redundant turns.

**What changed:**
- Embed snippet now carries `data-account-ulid="A#…"` on the `<script>` tag. `widget.js` reads it via `document.currentScript.dataset`, passes it to the iframe URL, and sets `referrerpolicy="origin"` on the iframe so the browser-set Referer carries the parent page hostname to the backend unspoofed.
- Backend + frontend agreed on a locked session contract: `POST /sessions` response gains `onboardingCompletedAt: string | null` and `budgetCents: number | null`; new `POST /sessions/:ulid/onboarding` takes `{ budgetCents }` and atomically records onboarding; new `GET /sessions/:ulid/messages` returns prior user + assistant turns filtered server-side from the raw message record (tool-use and tool-result blocks never cross the wire).
- `/embed` gained a five-state machine — `loading | splash | hydrating | chat | error` — branching on `onboardingCompletedAt`. First-time visitors get the splash; returning visitors skip it, hydrate history, and land back in their conversation.
- `ChatPanel` dropped the `initialUserMessage` auto-send in favor of an `initialMessages` hydration prop. Budget now flows to the agent as a structured system note appended by the backend *uncached*, not as a user message, so the prompt cache stays warm (Anthropic logs confirmed ~1 extra input token per turn vs. baseline — the budget block itself).
- Budget is integer cents end-to-end: splash → wire → DynamoDB. UI formats to dollars only at render time.

**Decisions worth remembering:**
- **Server-authoritative over client-only onboarding flag.** We debated a localStorage-only `splash_done_<guest>` flag. Went the longer way (backend fields + endpoints) because it buys us structured budget data (not buried in prose), free analytics via timestamp, natural extension points for future onboarding steps, and resilience to client bugs. The localStorage idea now reads as "optional optimistic render hint" — deferred; server answer is ground truth.
- **Timestamp over boolean for `onboardingCompletedAt`.** Same coerce-to-boolean at the edge (`!!session.onboardingCompletedAt`), but adds free analytics on *when* visitors splashed and lets us expire/refresh onboarding later with zero schema churn.
- **Cents on the wire, not just in the DB.** Backend initially proposed `budgetDollars: number` on the wire with `budget_cents` in storage. Pushed back — integer math end-to-end removes one whole class of float bugs, matches Affirm's `data-amount` convention, and costs nothing at the UI boundary (`Math.round(dollars * 100)`).
- **Budget as system context, not user message.** The agent receives the budget via a synthetic "User context: shopping budget is approximately $X" prepended uncached to the system prompt, not by the frontend auto-sending a "my budget is $X" user message. This keeps the conversation stream clean of onboarding artifacts and lets the prompt cache stay warm.
- **Graceful degrade on hydration failure.** If `GET /messages` fails for an onboarded session, we drop to an empty ChatPanel instead of erroring out. Visitor can still talk; backend context is intact; worst case they see a blank canvas.

**Next:**
- Fetch-history endpoint is live but not yet paired with a proper "welcome back" empty state when hydration returns zero turns. Small polish.
- Optimistic render hint from localStorage to skip the initial spinner flash for returning visitors. Deferred — the flash is sub-second and the server answer is authoritative anyway.
- Cross-device continuity is still gated by the guest ULID identity. If/when we add real auth, the server-authoritative onboarding flag carries over for free.

---

## 2026-04-19 — Budget-first splash + Sonnet caching savings validated

**Goal:** put a pre-chat screen in front of the agent that captures a visitor budget, shows live Affirm messaging plus client-side 0% APR example payments, and forwards the amount to the agent as an opening message. Also: verify the backend caching work on Sonnet produces real cost savings under a representative three-turn conversation.

**What changed:**
- New `/embed` state machine: splash first, then chat. Submitting the splash flips state and fires an auto-send of `"Hi! My budget is about $X. Can you help me find options that fit?"` so the agent's first reply is tailored to the budget.
- Budget splash UI (`src/components/budget-splash.tsx`) built on HeroUI v3: branded header, `$`-prefixed input defaulted to `$1,000`, `$50` minimum validation, and a disabled Start chat until valid.
- Live Affirm promotional messaging wired through the official SDK bootstrap (`src/lib/affirm.ts` + `src/types/affirm.d.ts`). The `<p class="affirm-as-low-as">` element rerenders on every debounced amount change via `refreshAffirmUi()`.
- Client-side example payments (`src/components/payment-estimates.tsx` + `src/lib/payment-estimator.ts`): three term cards at 6 / 12 / 24 months, pure `amount / months` math, rendered with `0% APR` chips and an honest "example payments" disclaimer.
- Soft ceiling at `$30,000`: above it, the Affirm element and payment cards hide and the splash shows a short note pointing the visitor into chat for larger amounts. Start chat stays enabled — the agent can still help.
- A single 400ms `useDebounce` clock lifted to `BudgetSplash` drives both the Affirm refresh and the payment-card math in lockstep; sub-components consume an already-debounced amount.
- Backend Sonnet caching validated end-to-end via Playwright MCP: fresh guest + three back-and-forths, compared head-to-head against the uncached run. Anthropic provider dashboard reported **~54% cost reduction** with no frontend changes required.

**Decisions worth remembering:**
- **Keep the Affirm promo line AND our own payment math side-by-side** instead of picking one: Affirm's element satisfies the disclosure requirement and shows "As low as $X/mo" when the merchant has configured APR tiers; our client-side cards give honest, concrete numbers today and will keep working regardless of Affirm's server-side state.
- **Hardcode the $30k ceiling as a plain constant** (`MAX_FINANCEABLE_DOLLARS` in `budget-splash.tsx`) instead of an env var. Tuning later is a one-line change, and wiring env plumbing now invites premature configuration. Value is empirical: Affirm's sandbox returns `"Amount provided is greater than maximum loan amount"` past $30,000.
- **Use Next.js literal `process.env.NEXT_PUBLIC_X` reads, never dynamic indexing.** Lost 20 minutes to a refactor that routed env reads through a `readRequired(name)` helper; Next's client-side substitution only inlines the literal pattern, so the "refactored" version crashed the browser with `NEXT_PUBLIC_CHAT_API_URL is not set` despite the env being defined. Reverted and documented at the top of `env.ts`.
- **Optional-call (`?.()`) the Affirm `refresh` method**, not just the lookup. The bootstrap IIFE installs a proxy on `window.affirm.ui` that exposes `ready` but not `refresh` until the CDN script finishes. `window.affirm?.ui?.refresh()` throws during that gap; `refresh?.()` silently no-ops, and the SDK auto-renders the initial state once it loads.
- **Forward budget as an opening user message rather than via session metadata or a hidden prompt.** Keeps the backend contract untouched, makes the context transparent to the visitor, and lets the agent respond organically.

**Next:**
- Production Affirm public key + merchant-configured APR tiers will change the rendered promo line from "Pay over time with Affirm" to the real "As low as $X/mo" copy. No code change required — plug new key into env at deploy time.
- Bundle-size sweep for `/embed` first-load JS (still ~181 KB gzipped vs <100 KB target) — potential wins in swapping `react-markdown` + `rehype-sanitize` for a narrower link-only renderer.
- Widen end-to-end integration testing once the backend is stable; Playwright MCP flows against the sandbox host page proved their worth twice this milestone (off-screen iframe, splash states, cache-savings audit).

---

## 2026-04-16 — M3 widget UI lands on HeroUI v3 reference design

**Goal:** replace the placeholder ChatPanel visuals with the HeroUI-built reference UI the user shipped in `.hero-project-chat-ui/`, and fix the popup appearing off-screen when the bubble was clicked.

**What changed:**
- Ported the reference layout onto the real backend-wired components — primary-accent header with Avatar + Online status, rounded-tl-none / rounded-tr-none bubbles with side avatars, round primary send button — while preserving the API wiring, Markdown sanitization, and checkout-URL CTA from M3.
- Fixed the off-screen iframe bug: `sizeIframe()` was setting `iframe.style.inset = ""` *after* `right:16px` / `bottom:88px`, and because `inset` is the shorthand for all four sides, the empty-string assignment was wiping both longhands. The iframe then fell back to its parent container's flow and rendered at the bubble's bottom-left. Reordered so `inset = ""` runs first.
- Translated HeroUI v2 color tokens from the reference (`primary`, `content1`, `default-100`) into the v3 token names actually shipped in `@heroui/styles` (`accent`, `background`, `surface-secondary`). Header now renders solid brand blue; chat bubbles render with the correct surfaces.
- Dropped the scaffold's `@media (prefers-color-scheme: dark)` block from `globals.css`: on a dark-mode OS the welcome text was white-on-white and invisible. Dark mode is deferred until we do dedicated design work across avatars, bubbles, and primary surfaces.
- Moved the input-focus call into a `useEffect([isSending])` so it runs *after* React drops the `disabled` attribute — focusing a disabled input is a silent no-op, which was forcing visitors to re-click the input after every assistant reply.
- Restyled the widget's floating bubble to HeroUI accent blue with a Lucide `message-circle` icon and a hover scale, and hid Next.js's Turbopack dev badge inside the iframe via `devIndicators: false`.

**Decisions worth remembering:**
- **Skipped framer-motion and iconify** from the reference stack. The `/embed` first-load is already ~181 KB gzipped against a <100 KB target, so adding another ~35 KB + CDN icon loader was the wrong trade. Used CSS transitions and inline Lucide SVGs instead.
- **Swapped HeroUI's `CloseButton` for a plain `<button>` + inline X SVG** in the header. `CloseButton` ships with a baked-in white background that renders invisible on the blue header and isn't overridable via `className`.
- **`Button` in v3 cannot render as `<a>`** (its `render` prop is pinned to `JSX.IntrinsicElements['button']`), so the checkout CTA continues to use HeroUI `Link` with button-like Tailwind classes.
- **Did not migrate quick-reply `Chip`s from the reference.** v3 `Chip` is display-only (no `onPress`) and the backend doesn't emit suggestions — functional quick-replies are a separate feature.
- **Live verification via Playwright MCP** against `public/sandbox.html` (a test host-page simulator) proved far faster than guessing at the iframe positioning math. Keeping the sandbox file in the repo for future widget debugging.

**Next:**
- Bundle-size sweep to close the <100 KB gap for `/embed` first-load — either a tiny link-only Markdown renderer in place of `react-markdown` + `rehype-sanitize`, or a narrower HeroUI import surface.
- Dark-mode pass when we take one — needs coordinated design for accent, surface-secondary, bubble text, and the vanilla-JS bubble on the host page.
- Widen integration testing by running the real backend with `WEB_CHAT_WIDGET_ORIGINS=http://localhost:3000` and walking a full cart + checkout flow end-to-end.

---

