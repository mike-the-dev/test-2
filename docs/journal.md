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

