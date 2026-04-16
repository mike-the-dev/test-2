TASK OVERVIEW
Task name: M3 — Chat widget frontend (iframe + embed script) for the Instapaytient shopping_assistant agent

Objective:
Build the browser-side half of the Instapaytient chat system: a Next.js 15+ App Router application that ships TWO artifacts, both served from the same codebase, both deployed to `chat.instapaytient.com`:

1. **An embed script** (`/widget.js`) that customer practice websites include via a single `<script>` tag. The script mints/reads a client-side guest ULID, injects a floating chat-bubble launcher at the bottom-right of the host page, and — on click — opens an iframe pointing at the chat UI route.

2. **An iframe chat UI** (`/embed` route) that renders the full shopping-assistant conversation: welcome state, message list, input box with send action, loading states, structured rendering of the final checkout-link message, and a "Open checkout" affordance that navigates the visitor to the URL returned by the `create_guest_cart` tool.

The widget consumes an existing backend API (the NestJS `ai-chat-session-api`) at two endpoints under `/chat/web`. The API, the agent prompts, the account binding via the `Origin` header, the session pointer records, the tool loop, and the checkout URL shape are ALL already built and production-tested. This milestone is **frontend only** — no backend changes whatsoever. The backend's contract is documented in full below and must be consumed verbatim.

Relevant context:
- **Stack:** Next.js 15+ (App Router), TypeScript (strict), Tailwind CSS, **HeroUI v3** as the UI component library. The scaffold has already been created by `create-next-app` and HeroUI v3 is already installed as a dependency. The project lives in its own directory separate from the backend API and is intended to become one app in a future monorepo alongside the admin dashboard. For this milestone, treat it as a standalone Next.js project.
- **Important HeroUI caveat:** HeroUI v3 is recent (released 2025). The implementer MUST verify component names, import paths, and props against the official HeroUI v3 documentation (https://heroui.com/docs/ or via the `context7` MCP tool if available) BEFORE writing any component code. Do NOT guess HeroUI APIs from training data. Specific components likely needed (but verify exact names/APIs): a popover/drawer for the chat panel, input field, button, spinner/loading indicator, avatar, card/chat-bubble-surface, link. Use HeroUI components for every visible UI element — styling via Tailwind utility classes is fine for layout, but visual primitives (buttons, inputs, bubbles, loaders) should all be HeroUI.
- **Deployment target:** `chat.instapaytient.com`. The embed script is served at the root as `widget.js`. The iframe UI is served at the route `/embed`. Production and dev domains both serve the same routes; the backend API URL is switched via an env var (see below).
- **Backend API base URL:**
  - Dev: `http://localhost:8081` (the NestJS app listens on port 8081 locally per its `.env.local`).
  - Prod: TBD — the user will configure in deployment. The widget reads the base URL from a public Next.js env var.
- **ULID library:** Use the `ulid` npm package (same one the backend uses) for generating the client-side guest ULID. Standard Crockford base32 ULIDs — 26 chars, uppercase.
- **Widget behavior on the host page:**
  - Script reads `localStorage.getItem("instapaytient_guest_id")`. If absent, generates a new ULID via `ulid()` and persists to `localStorage`.
  - Script injects a single DOM element at the bottom-right of the host page: a floating chat bubble with the Instapaytient brand. Z-index high enough to sit over typical site chrome.
  - Click on the bubble inserts an `<iframe>` into the DOM pointing at `https://chat.instapaytient.com/embed?guestId=<ulid>&agent=shopping_assistant`. The iframe is ~380px wide, ~620px tall, pinned to the bottom-right with a small margin, above the bubble. Smooth open/close transitions.
  - A second click on the bubble (or a close button inside the iframe) collapses the iframe back to just the bubble. localStorage state is preserved across open/close.
  - Script must be self-contained, minimal dependencies (ideally vanilla JS or a tiny bundled output). The script itself is NOT a React app — it creates plain DOM. The iframe is the React app.
  - Script handles CSP gracefully — if the host page has a restrictive CSP that blocks the iframe, the script should log a one-line console warning and do nothing further (no crashes, no errors visible to the end user).

- **Iframe UI behavior:**
  - Landing on `/embed` extracts `guestId` from the URL query params and `agent` (defaulting to `"shopping_assistant"`).
  - On mount: calls `POST /chat/web/sessions` with `{ agentName: "<agent>", guestUlid: "<guestId>" }`. Receives `{ sessionUlid, displayName }`. Displays a small header with the `displayName` (e.g. "Shopping Assistant"). Stores `sessionUlid` in component state; no need to persist it across reloads — the identity/session is recoverable on reload because `(source="web", externalId=<guestId>, agentName)` is the lookup key and the backend re-uses the existing session.
  - After session create: shows the initial empty state — no messages yet. An input box at the bottom with a send button. Optionally a placeholder "Start by saying hi…" or similar HeroUI input placeholder.
  - User sends a message → POST to `/chat/web/messages` with `{ sessionUlid, message }`. While waiting, show a typing-indicator / spinner message in the message list ("Assistant is thinking…"). On response, render the `reply` string as a new assistant message bubble.
  - Markdown rendering: the agent returns replies that may contain Markdown-style links like `[Click here to checkout](https://...)`. The UI should render these as actual clickable links, not raw markdown text. Use a tiny markdown renderer (`react-markdown` with `rehype-sanitize` — both small and well-maintained). XSS defense is required since the reply comes from an LLM.
  - When the agent's final message contains a checkout link (from `create_guest_cart`), render the link prominently — e.g. as a HeroUI button styled to look like a primary CTA ("Open checkout"), in addition to rendering it inline in the message. Clicking it opens the URL in a new browser tab (`target="_blank" rel="noopener noreferrer"`). No extra intelligence needed — the backend already handed us a ready-to-open URL.
  - Error handling: API 4xx/5xx, network errors, CORS rejections → show a polite error bubble ("Something went wrong — please try again in a moment.") with a retry button. Log details to `console.error` only — never surface stack traces to the visitor.
  - Loading states: initial session creation, each message send — HeroUI spinner for each.
  - Close button (X icon, top-right of the iframe chrome) — sends a `postMessage` to the parent window instructing the embed script to collapse the iframe back to the bubble.
  - Keyboard: Enter to send (Shift+Enter for newline if a Textarea component is used; otherwise single-line Enter to send), Esc to close.
  - Accessibility: ARIA `role="log"` on the message list with `aria-live="polite"`; labeled input; focus the input on open.
  - Mobile responsiveness: on viewports below ~480px wide, the iframe should take the full viewport (or close to it). The embed script handles this by detecting the host-page viewport and adjusting iframe dimensions. Alternatively, a CSS media query inside the iframe app makes the content adapt.

- **API contract (consume verbatim, do not modify):**

  **1. Create session — `POST /chat/web/sessions`**
  - Request body: `{ agentName: string, guestUlid: string }`
  - Request headers: `Content-Type: application/json`, `Origin: <the embedded host page's origin>` (auto-set by browser).
  - Response 200: `{ sessionUlid: string, displayName: string }`
  - Response 400: unknown agentName, malformed body → show a fatal error state, cannot proceed.
  - Response 500: defensive failure → show retry affordance.
  - Auth: none (origin-based CORS allowlist enforced server-side — the browser handles this transparently, but if CORS rejects, the fetch fails with a generic network error).

  **2. Send message — `POST /chat/web/messages`**
  - Request body: `{ sessionUlid: string, message: string }`
  - Request headers: same as above.
  - Response 200: `{ reply: string }` — the full assistant reply as a single string, potentially containing Markdown.
  - Response 400: validation failure (empty message, malformed body) → show retry.
  - Response 500: backend error → show retry.
  - **Latency:** 1–8 seconds typical (LLM round-trip + tool calls). The UI must handle this patiently. No polling, no streaming — one fetch call, one response.

  **3. Environment variable — `NEXT_PUBLIC_CHAT_API_URL`**
  - The base URL for the API, WITHOUT trailing slash. Dev default: `http://localhost:8081`. The widget prepends this to `/chat/web/sessions` and `/chat/web/messages` for all fetch calls.
  - Must be `NEXT_PUBLIC_` prefixed so it's available client-side.

- **What M3 does NOT include** (defer to later milestones):
  - Streaming responses (the API does not stream).
  - Conversation history view (user cannot browse past sessions).
  - Voice input / speech-to-text.
  - Rich media in the chat (images, videos, file uploads).
  - Multi-agent switching from the UI (the agent is determined by the URL query param).
  - Session persistence across browsers (localStorage only; no cross-device sync).
  - Internationalization (English-only for M3).
  - Analytics instrumentation (separate milestone).
  - Admin dashboard features (out of scope — different app).
  - Any backend changes (zero — the backend is frozen for this milestone).

- **Logging and privacy in the widget code:**
  - `console.log` only at debug level for session create, message send, and tool-result rendering. Include sessionUlid and message length — NOT the message content itself. No PII in console logs.
  - No third-party analytics / tracking scripts. The widget should not beacon out to anywhere except the configured `NEXT_PUBLIC_CHAT_API_URL`.
  - The embed script must not read anything from the host page's DOM other than what's necessary to inject the bubble/iframe. No scraping.


STEP 1 — ARCHITECTURE PLANNING
Use the arch-planner agent to analyze the scaffolded Next.js project and produce a structured implementation plan.

Task specifics for this plan:
Produce a plan that delivers, in this order:

1. **Project configuration and HeroUI provider wiring**
   - Confirm Tailwind is configured (HeroUI v3 requires it).
   - Verify / add the HeroUI v3 `Providers` wrapper in `src/app/providers.tsx` (or equivalent) and import it in the root layout.
   - Verify Tailwind `content` globs include HeroUI's package paths.
   - Read HeroUI v3 docs via context7 or the official site to confirm the exact provider setup — this is version-specific and the implementer MUST NOT guess.

2. **Env var handling**
   - Add `NEXT_PUBLIC_CHAT_API_URL=http://localhost:8081` to `.env.local` (create if missing).
   - Create `src/lib/env.ts` that exports a typed `chatApiUrl` constant with a clear error if the env var is missing at build time.

3. **API client**
   - `src/lib/api.ts` with two functions:
     - `createSession({ agentName, guestUlid }): Promise<{ sessionUlid, displayName }>`
     - `sendMessage({ sessionUlid, message }): Promise<{ reply }>`
   - Both use `fetch` with `Content-Type: application/json`, handle non-2xx responses by throwing a typed `ChatApiError` with status + parsed error body.
   - No client-side auth headers — the browser sends the Origin automatically.

4. **Guest ID utility**
   - `src/lib/guest-id.ts` with one exported function: `ensureGuestId(): string`.
   - Reads `localStorage.getItem("instapaytient_guest_id")`. If present, returns it. Otherwise generates a new ULID via `import { ulid } from "ulid"`, writes it to localStorage, returns it.
   - Guards for SSR: must only touch `localStorage` inside a client component or an explicit `typeof window !== "undefined"` check.

5. **Iframe chat page — `/embed` route**
   - `src/app/embed/page.tsx` — a client component (top of file: `"use client"`).
   - Extracts `guestId` and `agent` from URL query params via `useSearchParams`. Defaults `agent` to `"shopping_assistant"`. If `guestId` is missing from URL, falls back to `ensureGuestId()`.
   - On mount: calls `createSession` and stores the resulting `{ sessionUlid, displayName }` in component state. Shows a HeroUI `Spinner` during the call.
   - On error: shows a HeroUI error card with a retry button.
   - Once session is ready: renders the main `ChatPanel` component.

6. **ChatPanel component** — `src/components/chat-panel.tsx`
   - Receives `{ sessionUlid, displayName }` as props.
   - Owns the messages state (array of `{ role: "user" | "assistant", content: string, id: string }`).
   - Header: `displayName` on the left, close button (HeroUI `Button` with an X icon, variant=light) on the right. Close button sends `window.parent.postMessage({ type: "instapaytient:close" }, "*")`.
   - Body: scrollable message list with `role="log" aria-live="polite"`. Renders `ChatMessage` per entry.
   - Footer: HeroUI `Input` (or `Textarea` if v3 ships one) + HeroUI `Button` (primary) as send. Send action POSTs to `/chat/web/messages` via the API client, appends the user message immediately, shows a "thinking" placeholder, then replaces it with the assistant reply when the response lands.
   - Enter to send. Shift+Enter for newline (only if `Textarea` is used).
   - Esc key listener → sends the same close postMessage.

7. **ChatMessage component** — `src/components/chat-message.tsx`
   - Props: `{ role, content }`.
   - User messages: right-aligned bubble with HeroUI brand color.
   - Assistant messages: left-aligned bubble, neutral color, content rendered through the Markdown renderer (plus sanitization). Links open in new tab with `rel="noopener noreferrer"`.
   - If the assistant message contains a checkout URL (contains `/checkout?` substring), additionally render a prominent HeroUI `Button` labeled "Open checkout" below the message — clicking opens the URL in a new tab.

8. **Markdown renderer**
   - Use `react-markdown` with the `rehype-sanitize` plugin for safe rendering. Both are small, well-maintained, and work cleanly with App Router client components.
   - Configure to only allow: paragraphs, strong, em, links, code, inline code. No raw HTML.
   - All links forced to `target="_blank" rel="noopener noreferrer"`.

9. **Embed script — `/widget.js`**
   - Approach: a Next.js App Router route handler at `src/app/widget.js/route.ts` (or equivalent path that Next.js accepts for a non-HTML route) that returns a pre-computed JS string with `Content-Type: application/javascript` and long-lived caching headers.
   - Alternatively: a pre-built JS file in `public/widget.js` generated by a separate build step. The implementer picks the simpler option — likely the route handler.
   - The script's responsibilities (plain DOM, no React):
     - On load: check `localStorage` for `instapaytient_guest_id`; create one if missing via an inline ULID implementation. A 26-char Crockford base32 generator using `crypto.getRandomValues` is ~30 lines of vanilla JS.
     - Create a `<div>` at the bottom-right with a chat bubble icon (inline SVG). Z-index 2147483000 (high enough to sit over most page content).
     - Click handler: creates an `<iframe src="https://chat.instapaytient.com/embed?guestId=...&agent=shopping_assistant">` positioned above the bubble. Width 380px, height 620px, border-radius 16px, box-shadow for elevation. On mobile (viewport < 480px), the iframe is full-screen.
     - `window.addEventListener("message")` handler: listens for `{ type: "instapaytient:close" }` messages from the iframe and collapses it (removes from DOM or sets `display:none`).
     - Handle double-clicks on the bubble: toggles the iframe open/close.
     - Graceful CSP failure: wrap everything in try/catch; on error, log one line to console and stop.
     - Entire script must be <10KB minified.

10. **Landing page** — `src/app/page.tsx`
    - For the root of `chat.instapaytient.com` — a minimal landing page describing what the service is (one paragraph) and instructions for integrators ("Add `<script src='https://chat.instapaytient.com/widget.js' async></script>` to your site").
    - This is NOT a public marketing page, but it should exist so the root domain doesn't 404. Uses HeroUI components for any visual elements.

11. **Tests**
    - Use whatever test runner ships with Next.js 15+ out of the box (likely Vitest or Jest with React Testing Library — implementer verifies what `create-next-app` scaffolded and uses that). If no test runner is in the scaffold, add Vitest + React Testing Library + jsdom — it's the modern Next.js-friendly choice.
    - **API client spec** (`src/lib/api.test.ts`): mocks `fetch`; asserts correct URL, method, headers, body shape for both calls; asserts error handling on 4xx/5xx.
    - **Guest ID spec** (`src/lib/guest-id.test.ts`): mocks `localStorage`; asserts new ULID on empty storage, existing ULID returned on populated storage, SSR safety (function does not crash when called server-side).
    - **ChatMessage spec** (`src/components/chat-message.test.tsx`): user message renders right-aligned, assistant message renders with Markdown, checkout URL renders the "Open checkout" button, external links have correct `rel` and `target`.
    - **ChatPanel spec** (`src/components/chat-panel.test.tsx`): sending a message appends to the list, shows thinking state during the network call, replaces thinking with the reply on success, shows error UI on failure. Mock the API client.
    - **/embed page spec** (`src/app/embed/page.test.tsx`): on mount calls `createSession` with the URL query params, renders `ChatPanel` on success, renders error UI on failure. Mock the API client.
    - Skip the widget.js end-to-end test for M3 — it's a DOM-manipulation script and testing it inside Jest/Vitest is more trouble than it's worth. Live-test it manually in step 5 by opening a sandbox HTML page that includes the script tag.
    - Aim for **20–30 tests total**, not 100. Focus on business logic (API client, guest ID, message rendering) more than HeroUI components (which are already tested upstream).

12. **Module registration / structural wiring**
    - Root layout imports the HeroUI provider.
    - `next.config.js` set to transpile HeroUI if needed (verify per HeroUI v3 docs).
    - Tailwind `tailwind.config.ts` content globs include HeroUI paths.
    - `public/favicon.ico` exists (Next.js scaffold default).

Requirements for the plan:
- identify affected files/modules
- outline step-by-step implementation order (env → api client → guest-id → chat message → chat panel → /embed page → /widget.js route → landing page → tests)
- note dependencies and architectural considerations (HeroUI v3 API verification via context7 / official docs is mandatory; `react-markdown` + `rehype-sanitize` for safe rendering; plain-DOM script for the embed — no React in widget.js)
- list risks and edge cases (CORS rejection when the host page's origin is not allowlisted on the backend, CSP restrictions that block the iframe, localStorage disabled in private browsing, Markdown with malicious URLs, iframe sizing on very small mobile viewports, double-click rapid toggling of the bubble)
- define testing strategy (unit tests for business logic, live manual test for the widget.js behavior on a sandbox HTML page)

Pause after producing the plan so I can review and approve it.


STEP 2 — IMPLEMENTATION
Use the code-implementer agent to implement the approved plan.

Implementation details for this task:

- **HeroUI v3 API verification is non-negotiable.** Before writing ANY component that uses HeroUI, the implementer MUST use the `context7` MCP tool (if available) or `WebFetch` on `https://heroui.com/docs/` to confirm the exact component names, import paths, and props for HeroUI v3. The library was rebranded from NextUI → HeroUI around mid-2024 and v3 was released in 2025. Training-data API assumptions WILL be wrong. Verify first, code second.
- **Client components:** every file that uses `useState`, `useEffect`, `useSearchParams`, or touches `localStorage` must start with `"use client"` at the top. The `/embed` page and all components it renders are client components.
- **API client:**
  - Throw a typed `ChatApiError` on non-2xx responses with `{ status, body }`.
  - Use `AbortController` if a message send is cancelled by a page close — not strictly required for M3 but a small hygiene win.
- **Guest ID:**
  - Storage key MUST be `"instapaytient_guest_id"` exactly.
  - On SSR or when `window` is undefined, return empty string or throw — caller handles. Recommend: throw a clear error like "guest ID can only be generated in the browser".
- **ChatMessage checkout detection:** use a simple regex like `/\/checkout\?/` on the raw content. When matched, extract the first URL via a URL regex and render the button. Don't over-engineer — the backend always returns exactly one checkout URL per reply.
- **ChatPanel thinking indicator:** append a temporary `{ role: "assistant", content: "…", pending: true }` entry to the messages state, show a HeroUI spinner inline with the bubble, replace it with the real reply on success or an error bubble on failure.
- **postMessage contract:** the iframe sends `window.parent.postMessage({ type: "instapaytient:close" }, "*")`. The embed script listens for `event.data?.type === "instapaytient:close"`. `"*"` as the target origin is acceptable because the message carries no sensitive data; tightening the origin to the host page's URL is a future hardening concern.
- **Embed script:**
  - Self-contained. No React. No framework. Vanilla JS / TypeScript compiled down.
  - ULID generation inline using `crypto.getRandomValues` + Crockford base32 encoding. ~30 lines.
  - All CSS applied inline via `element.style.xxx` assignments — no external stylesheet, no `<style>` tag injection unless absolutely necessary (to keep the host page's global CSS untouched).
  - Use a `data-instapaytient-widget="true"` attribute on the root injected element so it's identifiable in DevTools and removable idempotently on re-injection.
  - Exit early if `document.querySelector('[data-instapaytient-widget]')` already exists — prevents double-injection if the script tag appears twice on a page.
- **Bundle size sanity:** the iframe app's first-load JS should be <100KB gzipped. Lean on HeroUI's tree-shaking. Avoid importing entire component libraries; import only the specific components used.
- **Accessibility:**
  - The chat bubble button (in the embed script) has `aria-label="Open chat"` when collapsed, `aria-label="Close chat"` when expanded.
  - The message list container has `role="log" aria-live="polite"`.
  - The input has a visible label or an `aria-label`.
  - Focus management: when the iframe opens, focus moves to the input.
- **DO NOT:**
  - Fetch third-party analytics.
  - Embed or import any tracking library.
  - Use `dangerouslySetInnerHTML` without sanitization.
  - Inline the backend API URL — it MUST come from `NEXT_PUBLIC_CHAT_API_URL`.
  - Commit secrets or local env var values to the repo — `.env.local` is in `.gitignore` by Next.js default; verify this.
  - Modify any backend code — this milestone is frontend-only.

Implementation requirements:
- follow the plan produced by the arch-planner agent
- modify or create only the necessary files
- respect existing Next.js App Router patterns
- focus on correctness first (style will be handled later)


STEP 3 — STYLE REFACTOR
Use the style-refactor agent to align the implementation with Next.js + HeroUI + TypeScript strict best practices.

Style refactor specifics:
- Components use HeroUI v3 for every visual primitive; Tailwind utilities only for layout (flex, gap, padding, positioning).
- No inline styles in React components (other than dynamic values that genuinely need it). Use Tailwind classes.
- All files use TypeScript strict mode. No `any`. No `@ts-ignore`. Use `unknown` + narrow where needed.
- Type exports live in `src/types/` or colocated with the module that defines them — whichever is consistent with the scaffold's convention.
- Components are pure functions unless they genuinely need state. State lives as high as it needs to (not higher).
- Colocate `.test.tsx` files next to their implementation files — standard Next.js convention.
- Imports ordered: React / Next → third-party → local (`src/lib`, `src/components`, `src/types`). No unused imports.
- Client components are minimal — server components by default, client components only where interactivity is required. The `/embed` page is the primary client-component entry; everything rendered inside it is also a client component.

Style requirements:
- apply standard Next.js 15 App Router conventions and TypeScript strict rules
- improve readability, structure, and consistency
- align code with HeroUI v3 documented patterns (re-verify any component APIs changed during refactor)
- do not change functionality or logic
- do not introduce new behavior


STEP 4 — TEST EXECUTION
Use the test-suite-runner agent to execute the project's test suite.

Testing context for this task:
- Run `npm test` (or `pnpm test` / `yarn test` depending on what the scaffold used — check `package.json`).
- Run `npx tsc --noEmit` separately to catch type errors that Vitest/Jest might miss (strict TypeScript).
- **All new specs listed in Step 1 item 11 must exist and pass.**
- No pre-existing tests to worry about (fresh scaffold).
- Report TypeScript compile errors as test failures.
- Run `npm run build` as a final gate — the Next.js production build catches entire classes of App Router issues (invalid client/server boundaries, missing metadata, etc.) that `tsc` alone won't. If `npm run build` fails, treat it as a test failure.
- DO NOT modify source or spec files. Only report.

Testing requirements:
- run the project's standard test command
- run `npx tsc --noEmit`
- run `npm run build` and treat failures as test failures
- report all failing tests clearly
- summarize results
- do not modify code or attempt fixes


STEP 5 — CODE REVIEW
Use the code-reviewer agent to review the implementation.

Review focus for this task:

- **HeroUI v3 API fidelity.** Every HeroUI component import and prop usage must match the current v3 documented API. Flag any use of NextUI v2 APIs that snuck in from training-data memory — they would compile against v3 but could break at runtime or be deprecated.
- **API contract compliance.**
  - `createSession` POSTs to `${NEXT_PUBLIC_CHAT_API_URL}/chat/web/sessions` with exactly `{ agentName, guestUlid }` in the body.
  - `sendMessage` POSTs to `${NEXT_PUBLIC_CHAT_API_URL}/chat/web/messages` with exactly `{ sessionUlid, message }`.
  - No extra headers added that aren't needed (the browser handles Origin/CORS transparently).
  - Error responses are handled structurally — 4xx shows a fatal or retry state, 5xx shows a retry, network errors show a retry.
- **Guest ID persistence.** The localStorage key is literally `"instapaytient_guest_id"`. On first call: generates a ULID, writes it, returns it. On subsequent calls: reads and returns. On SSR: does not crash the build.
- **Embed script correctness.**
  - Vanilla JS, no React dependency, no external fetches.
  - Inline ULID generator produces valid 26-char Crockford base32 (no `I`, `L`, `O`, `U`).
  - Idempotent: second injection is a no-op.
  - CSP-safe: wraps logic in try/catch; failure logs one line and exits cleanly.
  - postMessage listener correctly handles `{ type: "instapaytient:close" }` and collapses the iframe.
- **Markdown rendering security.**
  - `react-markdown` with `rehype-sanitize` or equivalent sanitizer is in use.
  - No `dangerouslySetInnerHTML` without a sanitization pass.
  - All rendered links force `target="_blank" rel="noopener noreferrer"`.
  - Raw HTML in the reply string is not executed.
- **Checkout URL detection.** The "Open checkout" button appears exactly when the assistant's reply contains a `/checkout?` URL. The button's `href` is the URL. The button opens in a new tab.
- **Accessibility baseline.**
  - Chat bubble has accessible labels.
  - Message list has `role="log" aria-live="polite"`.
  - Input has a label or `aria-label`.
  - Keyboard navigation works (Enter to send, Esc to close, Tab to move focus).
- **Env var safety.** `NEXT_PUBLIC_CHAT_API_URL` is required; the build should fail cleanly if missing. No defaulting to a production URL in code.
- **Privacy and logging.**
  - No `console.log` statements that include message content, full URLs with query params carrying PII, or the visitor's email.
  - No third-party analytics or tracking.
  - No beaconing to any domain other than the configured API URL.
- **Bundle size.** The iframe app's first-load JS should be <100KB gzipped. The `widget.js` script should be <10KB minified. Note any regressions.
- **Type safety.** No `any`, no `@ts-ignore`, no `as unknown as X` without a clear reason. `ChatApiError` is a proper class or branded type.
- **Scope discipline.** No backend changes. No monorepo tooling added prematurely. No features deferred to later milestones (streaming, history, voice, etc.) sneaking in.
- **File layout and naming** match Next.js 15 App Router conventions exactly.

Review requirements:
- verify correctness of the implementation
- confirm alignment with the architectural plan
- evaluate maintainability, security, and performance
- ensure style refactor did not alter functionality
- report issues using structured review feedback
