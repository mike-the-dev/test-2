TASK OVERVIEW
Task name: Cart preview card — wire up structured `tool_outputs` and render `preview_cart` inline with assistant turns.

Objective:
The backend has split the old checkout tool into two tools — `preview_cart` and `generate_checkout_link` — and added a generic `tool_outputs` array to the `POST /chat/web/messages` response so any agent can return structured tool payloads alongside its prose reply. Wire the frontend to:
1. Receive and type the new `tool_outputs` field on `SendMessageResponse`.
2. Route each entry through a per-tool renderer registry so adding future tools is a one-file change, not a contract change.
3. Ship one concrete renderer: a `CartPreviewCard` that renders the `preview_cart` payload (line items × qty × variant × unit price × line total, plus cart total) inline with the assistant message in the chat stream.
4. Silently skip any tool name we don't have a renderer for yet (`save_user_fact`, `collect_contact_info`, `list_services`, `generate_checkout_link` — the URL for `generate_checkout_link` continues to be extracted from the prose reply, unchanged from today).
5. Handle the error flag (`is_error: true`) on a `preview_cart` entry with a user-facing error state on the card.
6. When multiple `preview_cart` entries fire in a single turn (unusual), render the latest one only.
7. When `tool_outputs` is absent (no tool fired), preserve today's behavior exactly.

Relevant context:
- Repo: `ai-chat-session-frontend` (Next.js App Router, HeroUI v3, Tailwind, colocated `*.test.tsx` tests). This is the iframe-embedded chat widget; its backend sibling is `ai-chat-session-api`.
- Entry point: `src/app/embed/page.tsx` (Server Component, Referer-gated) → `src/app/embed/embed-client.tsx` (5-state machine: loading → splash | hydrating → chat | error). The chat itself lives in `src/components/chat-panel.tsx`, which owns the `messages: ChatMessage[]` state and calls `sendMessage()` from `src/lib/api.ts`.
- Message rendering: `src/components/chat-message.tsx` renders a single `ChatMessage`. Today it already has precedent for attaching structured UI to an assistant turn — it extracts a checkout URL from the prose via `src/lib/checkout-url.ts` and renders an "Open checkout" button under the bubble. The cart card is the same pattern, but driven by structured `tool_outputs` instead of prose scraping.
- Type source of truth: `src/types/chat.ts`. `ChatMessage`, `ChatRole`, `SendMessageResponse` live here. The card payload type (`CartPreviewPayload`) and the generic `ToolOutput` envelope belong here.
- Wire layer: `src/lib/api.ts` currently returns `Promise<SendMessageResponse>` from `sendMessage()`. That return type needs to carry optional `tool_outputs` through; the fetch/error logic itself does not change.
- Architectural constraints (per `docs/agent/architecture/feature-folder-architecture.md` + `docs/agent/engineering/global-standards.md`):
  - Arrow functions everywhere, no `function` declarations except where framework-forced.
  - Semicolons mandatory.
  - Single-line `if` statements with no braces when only one statement.
  - `async/await` with `try/catch/finally` — no Promise chaining.
  - Full descriptive parameter names (never `a`, `b`, `res`, `val`).
  - Validate/normalize at boundaries (inside `api.ts` or the renderer registry), not deep in domain logic.
  - Public / route-level functions get the standard JSDoc block with `@author`, `@editor`, `@lastUpdated`, `@name`, `@description`, `@param`, `@returns`. Author + editor signature is `mike-the-dev (Michael Camacho)`.
  - Tests colocated (`*.test.ts(x)` next to the file under test). Use `describe` / `it` (never `test`), Arrange → Act → Assert, at most two describe levels.
- Wire-level contract (new, from backend hand-off):
  ```
  POST /chat/web/messages → {
    reply: string;
    tool_outputs?: Array<{
      tool_name: string;
      content: string;            // raw JSON; parse based on tool_name
      is_error?: boolean;
    }>;
  }
  ```
  `tool_outputs` is present only when at least one tool fired during the turn. Absent array → behave exactly as before.
- `preview_cart` payload shape (parse `content` as this when `tool_name === "preview_cart"`):
  ```
  type CartPreviewPayload = {
    cart_id: string;
    item_count: number;          // sum of quantities
    currency: string;            // "usd"
    cart_total: number;          // cents
    lines: Array<{
      line_id: string;           // ephemeral; regenerated every preview
      service_id: string;        // includes the "S#" prefix
      name: string;
      category: string;
      image_url: string;
      variant: string | null;    // "<variantId>:<optionId>" or null
      variant_label: string | null;
      quantity: number;
      price: number;             // unit price, cents
      total: number;             // price * quantity, cents
    }>;
  };
  ```
- Flow the visitor experiences end-to-end:
  1. Splash → budget → chat.
  2. Visitor gathers items. Agent calls `preview_cart`. Response carries the payload; frontend renders the card. Agent's prose says something like "here's your cart — does this look right?"
  3. Visitor confirms or asks to change. Agent re-calls `preview_cart` with updated items (same `cart_id`, new `line_id`s). Frontend renders the latest card.
  4. Visitor confirms final → agent calls `generate_checkout_link` → response includes `{ tool_name: "generate_checkout_link", content: '{"checkout_url":"...","cart_id":"..."}' }` alongside prose that also contains the URL. Today's URL-from-prose extraction continues to work; pulling from `tool_outputs` is more robust but is not the scope of this task (can be a follow-up).
- History hydration (`GET /chat/web/sessions/:ulid/messages`) does NOT include `tool_outputs` today. A returning visitor mid-conversation will not see a previously-rendered cart card until the next `preview_cart` fires. Acceptable for v1; flagged for future work.
- Backend status: `master`, commit `639c31e1`, 211/211 tests passing. Ready for frontend wiring anytime.


STEP 1 — ARCHITECTURE PLANNING
Use the arch-planner agent to analyze the codebase and produce a structured implementation plan.

Task specifics for this plan:
- Extend `SendMessageResponse` in `src/types/chat.ts` to include an optional `toolOutputs?: ToolOutput[]` field. Decide on the wire-key shape: the backend sends `tool_outputs` (snake_case). Choose one of two strategies and justify: (a) keep snake_case on the TS type to mirror the wire exactly; (b) transform to camelCase at the API boundary inside `api.ts`. Global standard is "validate/normalize at boundaries," which points at (b). Document the choice.
- Introduce a `ToolOutput` envelope type (`toolName`, `content`, `isError?`) and a `CartPreviewPayload` type (all fields from the hand-off spec, camelCased if we chose (b)).
- Decide where the renderer registry lives. Candidate: `src/lib/tool-renderers.ts` (colocated with other cross-cutting lib helpers like `checkout-url.ts`) or `src/components/tool-outputs/` (a components subfolder that future renderers can share). Pick one and justify. The feature-folder architecture standard would push toward `src/features/toolOutputs/` if this were heavier, but for a thin registry + one renderer, a lib module + a single component file is proportionate. Call that tradeoff out.
- Decide how a tool output attaches to a `ChatMessage`. Options:
  (i) Add an optional `toolOutputs?: ToolOutput[]` field on `ChatMessage` itself — the outputs belong to the assistant turn they were produced in, so this is the most natural shape. `ChatPanel.submit()` populates it from the `sendMessage()` response when the pending assistant message resolves.
  (ii) Keep `ChatMessage` pure prose and store a separate `toolOutputsById: Record<string, ToolOutput[]>` map in `ChatPanel` state.
  Recommend (i) for locality — the renderer lives in `ChatMessageView`, so it can read straight off the message prop. Document the call.
- Define the renderer registry interface: `type ToolRenderer = (output: ToolOutput) => ReactElement | null;` plus `const toolRenderers: Record<string, ToolRenderer>`. Registered entries today: `preview_cart`. Unregistered names resolve to `null` and render nothing. `is_error: true` on a `preview_cart` entry: the `preview_cart` renderer handles it internally (renders an error state card) — the registry should NOT swallow errors, because an errored entry still carries a recognized `tool_name`.
- Define the "render the latest only" rule for multiple `preview_cart` entries in a single turn. Decide: dedupe in `ChatPanel.submit()` before writing to state, or dedupe in the renderer path inside `ChatMessageView`? Recommend dedupe at the boundary (`ChatPanel.submit()`) so state is canonical — the renderer trusts it received the latest. Document.
- Identify exactly which files change:
  - `src/types/chat.ts` — new types, extend `SendMessageResponse` and `ChatMessage`.
  - `src/lib/api.ts` — response normalization (snake_case → camelCase if chosen; optional `toolOutputs` carry-through).
  - `src/lib/tool-renderers.ts` (new) — registry + parsing helpers.
  - `src/components/cart-preview-card.tsx` (new) — the `preview_cart` renderer component.
  - `src/components/chat-panel.tsx` — attach `toolOutputs` to the resolved assistant message, apply "latest-preview-only" dedupe.
  - `src/components/chat-message.tsx` — iterate rendered outputs below the assistant bubble, alongside today's checkout-URL CTA (both can coexist).
  - Colocated tests for each new/modified file.
- Risks / edge cases to enumerate in the plan:
  - Malformed `content` JSON → `JSON.parse()` throws. Wrap and fail-soft (render nothing or a neutral error) — do NOT throw into the React tree.
  - Unknown currency codes — backend ships `"usd"` today. Render dollars assuming USD for v1; document the assumption.
  - Empty `lines` array (should not happen but possible) — render "Cart is empty" gracefully.
  - `variant_label` null → show name only; `variant_label` present → show "Name — variant_label".
  - Cart card should NOT render in the history hydration path because the hydration endpoint does not return `tool_outputs`. Confirm `ChatMessage`s built from `GetSessionMessagesResponse` leave `toolOutputs` undefined, and the renderer treats undefined as "nothing to render."
- Testing strategy:
  - Unit: `tool-renderers.test.ts` — parseToolOutputContent happy path + malformed JSON + unknown tool; registry lookup + miss.
  - Unit: `cart-preview-card.test.tsx` — renders lines, totals, variant label with/without; error state when `is_error: true`; empty-lines defensive state.
  - Unit: `chat-panel.test.tsx` (extend) — when `sendMessage` resolves with `toolOutputs`, the resolved assistant message carries them; when multiple `preview_cart` entries arrive, only the last is kept.
  - Unit: `chat-message.test.tsx` (extend) — renders the cart card inline with the bubble when the message has a `preview_cart` output; does not render it for user messages; renders nothing for unknown tool names.
  - Unit: `api.test.ts` (extend) — `sendMessage()` normalizes `tool_outputs` → `toolOutputs` on the response (if we pick strategy (b)); absent field resolves to `undefined` (not `[]`) to preserve the existing narrow.
  - E2E (Playwright live, in Step 4's runner context): splash → budget → chat → commit items → cart card renders with qty × name × variant × unit price × line total + total → visitor confirms → checkout URL appears and opens the correct live cart.

Requirements for the plan:
- identify affected files/modules
- outline step-by-step implementation order
- note dependencies and architectural considerations
- list risks or edge cases
- define testing strategy

Pause after producing the plan so I can review and approve it.


STEP 2 — IMPLEMENTATION
Use the code-implementer agent to implement the approved plan.

Implementation details for this task:
- Follow the file-by-file order the arch-planner locked in. Expect roughly: types → api normalization → renderers lib → cart-preview-card component → chat-panel state wiring → chat-message render hook-in.
- Keep the `preview_cart` renderer visually consistent with the existing M3 HeroUI v3 chat UI:
  - Rounded card, `bg-surface-secondary`, same rounding idiom as the assistant bubble but slightly denser horizontal padding.
  - Each line row: small thumbnail (`image_url`) if present, name in primary text, variant label in muted text, qty × unit price on the right, line total beneath.
  - Footer row: "Total" label + `cart_total` formatted as USD.
  - Currency formatting via `Intl.NumberFormat('en-US', { style: 'currency', currency: payload.currency.toUpperCase() })`, dividing cents by 100.
  - No quantity editing, no remove buttons — the card is display-only. Future interactions are out of scope.
- For the error state (`is_error: true`): render a neutral card with the copy "We hit a problem previewing your cart — try asking again." No retry button (the agent re-previews via another chat turn).
- Do not touch `src/lib/checkout-url.ts` or the existing "Open checkout" button render path in `chat-message.tsx` — the URL extraction from prose stays. `generate_checkout_link` output is silently ignored by the registry for now, per the hand-off.
- When attaching `toolOutputs` to the resolved assistant message inside `ChatPanel.submit()`, apply the "latest preview only" rule: filter the array down to the last entry whose `toolName === "preview_cart"` plus all other non-preview entries (in original order). This keeps the data structure honest for future non-preview renderers that might want to show all instances.
- Do NOT modify `src/lib/api.ts`'s public function signatures — only update the types they return. Keep normalization logic private to the module.
- Add JSDoc blocks (per global standards) on: the new exported renderer registry, the new `CartPreviewCard` component, and any new public helpers in `api.ts` or `tool-renderers.ts`.
- Tests must be colocated. Use existing test files as the style reference (`src/components/chat-message.test.tsx`, `src/lib/api.test.ts`).

Implementation requirements:
- follow the plan produced by the arch-planner agent
- modify or create only the necessary files
- respect existing architecture and coding patterns
- focus on correctness first (style will be handled later)


STEP 3 — STYLE REFACTOR
Use the style-refactor agent to refactor the implementation according to the rules defined in `.claude/instructions/style-enforcer.md`.

Style refactor specifics:
- Enforce arrow-function-only across new code. No `function` declarations, no `function` expressions, except where a framework API demands one.
- Enforce semicolons on every statement where optional.
- Enforce single-line `if` with no braces when the body is one statement. Example: `if (!content) return null;`
- Enforce `async/await` + `try/catch/finally`. Replace any `.then()` / `.catch()` / `.finally()` that may have slipped in.
- Enforce full descriptive parameter names. No `a`, `b`, `x`, `res`, `val`, `obj`, `e` (other than event handlers where the existing codebase already uses `e` — match the surrounding file's convention).
- Verify JSDoc blocks on public exports include `@author`, `@editor`, `@lastUpdated` (YYYY-MM-DD = 2026-04-20), `@name`, `@description`, `@param`, `@returns`, with author + editor set to `mike-the-dev (Michael Camacho)`.
- Check defensive-programming rule: validation sits at the API boundary (inside `api.ts` or the registry parse step), not scattered across renderer internals. If renderer internals are doing type guards that should have been handled at the boundary, push them back.
- Keep functions single-purpose. If a utility is doing both "parse content JSON" and "look up renderer," split.

Style requirements:
- apply all rules from style-enforcer.md
- improve readability, structure, and consistency
- align code with project conventions and standards
- do not change functionality or logic
- do not introduce new behavior


STEP 4 — TEST EXECUTION
Use the test-suite-runner agent to execute the project's test suite.

Testing context for this task:
- Run the repo's standard Jest / Vitest command (whatever `package.json` defines — likely `npm test` or `pnpm test`). Inspect `package.json` before running to confirm.
- Expected passing surface includes the new colocated tests:
  - `src/lib/tool-renderers.test.ts`
  - `src/components/cart-preview-card.test.tsx`
  - Extended `src/components/chat-panel.test.tsx`
  - Extended `src/components/chat-message.test.tsx`
  - Extended `src/lib/api.test.ts`
- Previously-passing suites must still pass — no regressions in `budget-splash.test.tsx`, `checkout-url.test.ts`, `referer.test.ts`, `guest-id.test.ts`, `payment-estimator.test.ts`, `use-debounce.test.ts`, `embed-client.test.tsx`.
- If the repo has an E2E (Playwright) target separate from unit tests, note its existence but do NOT run it in this step — live E2E verification happens in a manual follow-up described under "Delivery notes" below, not in the automated runner.

Testing requirements:
- run the project's standard test command
- report all failing tests clearly
- summarize results
- do not modify code or attempt fixes


STEP 5 — CODE REVIEW
Use the code-reviewer agent to review the implementation.

Review focus for this task:
- Correctness against the wire contract: `SendMessageResponse` accurately reflects the backend's shape; snake_case/camelCase normalization (if any) is consistent and applied at exactly one boundary.
- The renderer registry is a clean extension point. Adding a second renderer in the future should require editing only two files (the new renderer component + the registry map), not the chat panel or message component.
- `is_error: true` is handled where intended (inside the `preview_cart` renderer), not silently swallowed by the registry lookup path.
- Multiple-preview-in-one-turn dedupe is implemented at the `ChatPanel.submit()` boundary, and the test for it passes.
- No regression in the existing checkout URL CTA path in `chat-message.tsx` — the button still appears for `generate_checkout_link` based on prose extraction.
- History hydration path is untouched and `toolOutputs` is `undefined` on hydrated messages (not `[]` — preserve the narrow).
- JSDoc, arrow-function, semicolon, single-line-if, async/await rules hold across all new code.
- Tests cover: happy path, malformed `content` JSON, unknown `tool_name`, `is_error: true`, multi-preview dedupe, absent `tool_outputs` (no-op). No excessive mocking of internals.
- Bundle-size awareness: `CartPreviewCard` should reuse HeroUI v3 primitives (`Card`, `Avatar`, typography) already present in the bundle — no new heavy dependencies. Flag any dep additions.
- Security: `image_url` is rendered via `<img>` / HeroUI `Avatar`; confirm no `dangerouslySetInnerHTML` path was introduced. All dynamic strings from `content` go through React's default escaping.

Review requirements:
- verify correctness of the implementation
- confirm alignment with the architectural plan
- evaluate maintainability, security, and performance
- ensure style refactor did not alter functionality
- report issues using structured review feedback


DELIVERY NOTES (post-review, for the operator — not a sub-agent step)
- Live verification: run `npm run dev` (or equivalent), load the sandbox host (`public/sandbox.html`) via Playwright MCP, and walk splash → budget → chat → commit items → observe cart card → confirm → click checkout URL → land on the live ecommerce store with matching cart. Backend logs should show `Cart written` and (on edits) `Cart IDs reused from metadata`.
- Journal: append a dated entry to `docs/journal.md` describing the tool_outputs renderer split, the registry pattern, and the cart card rollout. Keep it under ~30 lines per repo convention.
- Commit message: follow `docs/agent/commit-messages.md` conventions. Conventional-commits style (`feat(chat): ...`).
- Known follow-ups (document, do not implement): (a) historic `tool_outputs` via hydration endpoint so returning visitors see their previously-previewed cart; (b) pulling the checkout URL from the `generate_checkout_link` tool output instead of prose scraping; (c) interactive cart card (edit qty, remove line) once the backend exposes cart-mutation tools.
