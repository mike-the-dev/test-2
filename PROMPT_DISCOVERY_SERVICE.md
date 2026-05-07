TASK OVERVIEW
Task name: Per-agent onboarding splash — consume the new server-driven `splash` config and `onboardingData` payload on the embed.

Objective:
The backend (`ai-chat-session-api`) just shipped per-agent onboarding configuration. The session-creation response now includes a `splash: SplashConfig | null` field (drives whether and how the splash renders) and an `onboardingData: Record<string, unknown> | null` field (replaces the old top-level `budgetCents`). The onboarding submission endpoint now accepts `{ onboardingData: Record<string, unknown> }` instead of `{ budgetCents: number }`. Backend has no production data, so this is a clean cut — no transition shape, no compatibility window. Wire the embed to:
1. Replace `budgetCents: number | null` on `SessionInfo` with `splash: SplashConfig | null` and `onboardingData: Record<string, unknown> | null`.
2. Replace `OnboardingRequest = { budgetCents: number }` with `OnboardingRequest = { onboardingData: Record<string, unknown> }`.
3. Add the discriminated `SplashConfigOnboardingField` union with all three kinds defined by the backend (`budget`, `industry`, `shortText`). Today only `budget` is used by any agent, so only `budget` gets a frontend renderer. Other kinds are type-system reserved.
4. Update the `EmbedClient` state machine's post-`createSession` branching to the new tri-state decision: skip splash when `splash === null`; skip splash when an existing session already has `onboardingCompletedAt`; otherwise render the splash. The embed must NOT call `POST /onboarding` on `splash: null` agents.
5. Update `BudgetSplash` to accept the budget field config (`SplashConfigOnboardingFieldBudget`) as a prop, render `field.label` as the question text (the per-agent customization hook), build the submission payload as `{ [field.key]: cents }`, and call its `onSubmit` with the full `onboardingData` map (not just a number).
6. Surface 400 Zod errors from `completeOnboarding` inline on the splash so the visitor can correct the field, instead of routing them to the full-screen error card.
7. Preserve all current visual/UX behavior of the splash: hardcoded header ("Shopping Assistant"), hardcoded subtitle ("Let's find what fits your budget"), `MINIMUM_BUDGET_DOLLARS` floor, `MAX_FINANCEABLE_DOLLARS` Affirm cap, `AffirmPromo`, `PaymentEstimates`. None of those become dynamic in this change.
8. Fail loud (clear runtime error) if the backend ever sends a `splash` with no budget field for an agent the embed knows about. That's the signal that a future splash component (e.g. `IndustrySplash`) needs to be added — it's not this task's scope.

Relevant context:
- Repo: `ai-chat-session-frontend` (Next.js 16 App Router, React 19, HeroUI v3, Tailwind, Vitest with colocated `*.test.tsx` tests). This is the iframe-embedded chat widget; its backend sibling is `ai-chat-session-api`.
- Entry point: `src/app/embed/page.tsx` (Server Component, Referer-gated) → `src/app/embed/embed-client.tsx` (5-state machine: `loading → splash | hydrating → kickoff → chat | error`). The post-onboarding chat lives in `src/components/chat-panel.tsx`.
- Splash component today: `src/components/budget-splash.tsx`. Hardcoded budget input with Affirm promo and payment estimates. Calls `onSubmit(budgetCents: number)` with the parsed cents value on form submit.
- Type source of truth: `src/types/chat.ts`. `SessionInfo` carries `budgetCents: number | null` today (line 67). `OnboardingRequest` is `{ budgetCents: number }` today (lines 84–87). Both must be replaced.
- Wire layer: `src/lib/api.ts` exposes `createSession()` (with a 400-retry that strips a malformed stored `sessionId` and re-posts) and `completeOnboarding()`. Public function signatures stay the same shape; only the inner request/response types change.
- Architectural constraints (per `docs/agent/architecture/feature-folder-architecture.md` + `docs/agent/engineering/global-standards.md`):
  - Arrow functions everywhere, no `function` declarations except where framework-forced.
  - Semicolons mandatory.
  - Single-line `if` statements with no braces when only one statement.
  - `async/await` with `try/catch/finally` — no Promise chaining.
  - Full descriptive parameter names (never `a`, `b`, `res`, `val`).
  - Validate/normalize at boundaries (inside `api.ts`), not deep in domain logic.
  - Public / route-level functions get the standard JSDoc block with `@author`, `@editor`, `@lastUpdated`, `@name`, `@description`, `@param`, `@returns`. Author + editor signature is `mike-the-dev (Michael Camacho)`.
  - Tests colocated (`*.test.ts(x)` next to the file under test). Use `describe` / `it` (never `test`), Arrange → Act → Assert, at most two describe levels.
- Wire-level contract (new, from backend hand-off):
  ```
  POST /chat/web/sessions → {
    sessionId: string;
    displayName: string;
    onboardingCompletedAt: string | null;
    kickoffCompletedAt: string | null;
    splash: SplashConfig | null;
    onboardingData: Record<string, unknown> | null;
  }

  POST /chat/web/sessions/:sessionId/onboarding (request) → {
    onboardingData: Record<string, unknown>;
  }

  POST /chat/web/sessions/:sessionId/onboarding (response) → {
    sessionId: string;
    onboardingCompletedAt: string;
    kickoffCompletedAt: string | null;
    onboardingData: Record<string, unknown>;
  }
  ```
- `SplashConfig` shape (per backend hand-off):
  ```
  interface SplashConfigOnboardingFieldBudget {
    kind: "budget";
    key: "budgetCents";
    label: string;
    required: boolean;
  }

  interface SplashConfigOnboardingFieldIndustry {
    kind: "industry";
    key: "industry";
    label: string;
    options: string[];
    required: boolean;
  }

  interface SplashConfigOnboardingFieldShortText {
    kind: "shortText";
    key: string;
    label: string;
    required: boolean;
    maxLength: number;
  }

  type SplashConfigOnboardingField =
    | SplashConfigOnboardingFieldBudget
    | SplashConfigOnboardingFieldIndustry
    | SplashConfigOnboardingFieldShortText;

  interface SplashConfig {
    fields: SplashConfigOnboardingField[];
  }
  ```
- Onboarding error responses from backend (NestJS standard `BadRequestException` JSON shape — confirmed by backend on 2026-05-07):
  - `404 Not Found` — session ULID does not exist. Treat as session-expired; start a fresh session (same as today's session-create error path).
  - `400 Bad Request` — body is JSON `{ message: string; error: "Bad Request"; statusCode: 400 }`. The `message` field carries the human-readable reason (Zod v4 default text for validation failures, or the literal string `"this agent has no onboarding"` for the bug-indicator case). Sub-cases:
    - `message === "this agent has no onboarding"` — embed bug indicator. Should never happen if the state machine respects `splash === null`. Log + fall through to full-screen error card with a generic user message.
    - Any other message (Zod v4 default text — e.g. `"Invalid input: expected number, received undefined"`, `"Too small: expected number to be >0"`) — submitted `onboardingData` failed validation. Surface `message` inline on the splash, do NOT route to the full-screen error card.
  - Frontend extractor: `api.ts`'s `parseBody` already JSON-parses the body, so `ChatApiError.body` arrives as a parsed object. Read `(err.body as { message?: unknown } | null)?.message` and narrow with `typeof === "string"`. If the narrow fails (defensive), fall back to a generic `"Invalid submission. Please check your input."` string.
  - UX caveat (out-of-scope follow-up flagged by backend): Zod v4's default messages are technically accurate but not user-friendly ("Too small: expected number to be >0" reads strangely for a budget). The frontend renders them as-is for now; the backend may override per-issue messages in a future task.
- Decisions locked in during discovery (assistant + user, in chat):
  1. Component name stays `BudgetSplash`. Future splash variants (e.g. industry-only) will land as new components (e.g. `IndustrySplash`), not as branches inside one generic component.
  2. Header copy ("Shopping Assistant") and subtitle ("Let's find what fits your budget") stay hardcoded inside `BudgetSplash`. The backend's `SplashConfig` does not define a header today, and the user has confirmed there's no current need to make those dynamic.
  3. The budget question text ("What's your budget?" today) becomes driven from `field.label`. That's the per-agent phrasing hook the backend defined; honoring it costs nothing and keeps the contract intact.
  4. `AffirmPromo` and `PaymentEstimates` stay rendered as today, scoped to the budget field's value. Their show/hide rules (financeable below `MAX_FINANCEABLE_DOLLARS`) are unchanged.
  5. `industry` and `shortText` field kinds get type-union representation but no frontend renderer in this task. If a `splash` arrives with no `kind: "budget"` field, the embed throws a clear error.
  6. No backwards compatibility — `budgetCents` is fully removed from the embed; no shape-detection, no fallback path.
- History hydration (`GET /chat/web/sessions/:ulid/messages`) is unaffected by this change. The session response feeding the splash decision is `POST /chat/web/sessions` only.
- Backend status: per-agent onboarding feature deployed. Two agents declared today: `shopping_assistant` (splash with one budget field) and `lead_capture` (no splash). Embed must work for both.


STEP 1 — ARCHITECTURE PLANNING
Use the arch-planner agent to analyze the codebase and produce a structured implementation plan.

Task specifics for this plan:
- Confirm exact line-level changes to `src/types/chat.ts`:
  - Add the `SplashConfigOnboardingFieldBudget`, `SplashConfigOnboardingFieldIndustry`, `SplashConfigOnboardingFieldShortText`, `SplashConfigOnboardingField`, and `SplashConfig` interfaces. All three field kinds must be in the union — backend ships them; type system must mirror.
  - Replace `budgetCents: number | null` on `SessionInfo` with `splash: SplashConfig | null` and `onboardingData: Record<string, unknown> | null`.
  - Replace `OnboardingRequest = { budgetCents: number }` with `OnboardingRequest = { onboardingData: Record<string, unknown> }`.
  - `OnboardingResponse` = `SessionInfo` continues to alias the session shape (which now carries the new fields).
- Decide the wire-key shape: backend already speaks camelCase (`splash`, `onboardingData`, `sessionId`, etc.) on this surface, so no snake_case → camelCase normalization is needed in `api.ts`. Document that explicitly so a reviewer doesn't expect a transform.
- Decide the splash routing decision in `embed-client.tsx`. The recommended logic, post-`createSession`:
  ```
  if (session.splash === null || session.onboardingCompletedAt !== null) {
    // hydrate → kickoff (if needed) → chat — same path as today's "onboarded" branch
  } else {
    setState({ status: "splash", session });
  }
  ```
  Note that the `splash === null` branch hits the same hydrate-and-kickoff codepath as the resumed-onboarded branch — confirm this is consistent and doesn't duplicate logic. Recommend extracting the shared post-onboarded sequence into a small inner helper if duplication appears.
- Decide how `BudgetSplash` receives the budget field config. Recommended prop shape:
  ```
  interface BudgetSplashProps {
    field: SplashConfigOnboardingFieldBudget;
    onSubmit: (onboardingData: Record<string, unknown>) => void;
    submitError?: string | null;
  }
  ```
  - `field.label` drives the question text (today's hardcoded "What's your budget?").
  - `field.key` is `"budgetCents"` per the type union; the component builds `{ [field.key]: cents }` on submit.
  - `field.required` controls submit-button enabled state in addition to the existing `MINIMUM_BUDGET_DOLLARS` guard.
  - `submitError` is rendered inline above the submit button when the backend returns a 400 Zod error.
- Decide where to extract the budget field from `splash.fields` for `BudgetSplash`. Two candidate sites:
  (i) Extract in `EmbedClient` and pass the single field down — keeps `BudgetSplash` simple.
  (ii) Pass the whole `SplashConfig` down and let the splash find its own field — more flexible if the splash later renders multiple fields.
  Recommend (i) for now: today the budget field is the only one and the splash is budget-specific. Future agents with non-budget splashes get their own component, not a generalization of this one. Document the call.
- Decide what happens if `EmbedClient` receives a `splash !== null` whose `fields` array contains no `kind: "budget"` entry. Per the locked-in decision, this is a hard error. Recommend transitioning to `state.status === "error"` with a developer-facing console error and a generic user-facing message ("We couldn't load this experience"). Do NOT silently fall through to chat — that masks a backend/embed mismatch.
- Decide how `handleSplashSubmit` evolves. Today's signature is `(budgetCents: number) => void`. New signature: `(onboardingData: Record<string, unknown>) => void`. The function body posts `{ onboardingData }` to `completeOnboarding`. On 400 Zod error, set local state to surface the error back to the splash via the new `submitError` prop instead of transitioning to `error`. On 404 / 5xx / network, keep today's behavior (full-screen error card).
- Identify exactly which files change:
  - `src/types/chat.ts` — new types, replace `budgetCents` on `SessionInfo`, replace `OnboardingRequest`.
  - `src/lib/api.ts` — no logic changes; only the types flowing through change. Confirm the existing 400-retry logic in `createSession` still triggers correctly (it keys on `request.sessionId !== undefined`, which is independent of the response shape).
  - `src/app/embed/embed-client.tsx` — splash routing decision, hard-error path for missing budget field, new `handleSplashSubmit` shape, new `submitError` state for inline-error surfacing.
  - `src/components/budget-splash.tsx` — new prop signature (`field`, `onSubmit(onboardingData)`, `submitError`), `field.label` rendered, error slot above submit button. All other UI unchanged.
  - Colocated tests for each modified file.
- Risks / edge cases to enumerate in the plan:
  - Resumed `lead_capture` session (`splash === null`, `onboardingCompletedAt === null`, `onboardingData === null`) must skip the splash and go to hydrate/kickoff/chat. Easy to mishandle if the routing checks `onboardingCompletedAt` first.
  - Resumed `shopping_assistant` session that has completed onboarding (`splash !== null`, `onboardingCompletedAt !== null`, `onboardingData !== null`) must skip the splash. The visitor has already filled it out.
  - 400 Zod error handling — must NOT route through `messageFromApiError`; that function maps everything to a generic message and loses the field-specific error. Add a new branch that pulls the body string off `ChatApiError.body`.
  - `BudgetSplash` rendering with `field.required === false` — submit-button enabled even when input is empty; payload omits the key entirely (don't send `null` or `""`).
  - `AffirmPromo` / `PaymentEstimates` rely on the live debounced `amount`, not `field`. They stay unchanged. Confirm they don't break when the rest of the surrounding component is refactored.
  - Future agents may declare a budget field with a non-`"budgetCents"` key (the type pins it to `"budgetCents"` today, so this is currently impossible — but the test should assert against `field.key` as the source of truth, not a hardcoded `"budgetCents"` constant).
- Testing strategy:
  - Unit: `src/lib/api.test.ts` — update the existing onboarding test to assert the request body is `{ onboardingData: { budgetCents: 150_000 } }` instead of `{ budgetCents: 150_000 }`. No new behavior.
  - Unit: `src/app/embed/embed-client.test.tsx` — extend with:
    - `splash: null` agent → splash never renders, hydrate/kickoff fires.
    - `splash !== null` + `onboardingCompletedAt !== null` → splash never renders, hydrate/kickoff fires.
    - `splash !== null` + `onboardingCompletedAt === null` → splash renders.
    - 400 Zod error from `completeOnboarding` → splash stays mounted with error message; does NOT transition to `error` state.
    - 404 from `completeOnboarding` → transitions to `error` state (today's behavior).
    - `splash` with no budget field → transitions to `error` state.
  - Unit: `src/components/budget-splash.test.tsx` — update existing tests for the new prop signature; assert that `field.label` is rendered as the question, that `onSubmit` is called with `{ [field.key]: cents }`, that `submitError` is rendered when provided, that `field.required === false` lets the submit button enable on empty input.
- E2E (Playwright live, manual follow-up): splash → budget → chat for `shopping_assistant`; no-splash straight-to-chat for `lead_capture`; resume of an onboarded `shopping_assistant` session skips splash.

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
- Follow the file-by-file order the arch-planner locked in. Expect: types → api (types only) → embed-client state machine → budget-splash component → tests.
- `src/types/chat.ts`: add the discriminated field-kind union and `SplashConfig` first, then update `SessionInfo` and `OnboardingRequest`. Keep JSDoc comments on the new fields explaining what `splash === null` means and what `onboardingData` carries.
- `src/lib/api.ts`: no signature changes. Just verify the new types thread through correctly. The 400-retry in `createSession` keys on the request shape, not the response, so it's unaffected.
- `src/app/embed/embed-client.tsx`:
  - Update the splash decision to the documented tri-state form.
  - Add a `submitError: string | null` piece of state so the splash can surface inline onboarding errors.
  - Update `handleSplashSubmit` to take `onboardingData: Record<string, unknown>` and post `{ onboardingData }` to the API. On `ChatApiError` with `status === 400`, extract `(err.body as { message?: unknown } | null)?.message` (narrow with `typeof === "string"`, fallback to a generic message on miss). If the extracted message is the literal `"this agent has no onboarding"`, log + transition to full-screen error (it's a frontend-bug indicator). Otherwise set `submitError` to the message and stay on the splash. On any other error status, fall through to today's full-screen error card.
  - On `splash !== null && fields` not containing a budget field, transition directly to `state.status === "error"` with a developer-facing console error.
- `src/components/budget-splash.tsx`:
  - New props: `{ field: SplashConfigOnboardingFieldBudget; onSubmit: (onboardingData: Record<string, unknown>) => void; submitError?: string | null }`.
  - Replace the hardcoded "What's your budget?" header with `{field.label}`.
  - Compute submission payload as `{ [field.key]: Math.round(amount * 100) }`.
  - Submit-enabled rule: `field.required ? amount >= MINIMUM_BUDGET_DOLLARS : true`. Keep the `MINIMUM_BUDGET_DOLLARS` guard for required budgets (defense in depth + UX feedback).
  - Render the `submitError` inline (above the submit button, e.g. `<p role="alert" className="...">{submitError}</p>`) when truthy.
  - Header ("Shopping Assistant"), subtitle ("Let's find what fits your budget"), placeholder, min copy, Affirm promo, payment estimates — all unchanged.
- Tests must be colocated. Use existing test files as the style reference (`src/components/budget-splash.test.tsx`, `src/app/embed/embed-client.test.tsx`, `src/lib/api.test.ts`).
- Add JSDoc blocks (per global standards) on the updated `BudgetSplash` (since its public prop contract changed) and the updated `handleSplashSubmit` if its semantics warrant.
- Update `journal.md` last? No — journal entry is post-review (see DELIVERY NOTES). Implementation step does not write the journal.

Implementation requirements:
- follow the plan produced by the arch-planner agent
- modify or create only the necessary files
- respect existing architecture and coding patterns
- focus on correctness first (style will be handled later)


STEP 3 — STYLE REFACTOR
Use the style-refactor agent to refactor the implementation according to the rules defined in `.claude/instructions/style-enforcer.md`.

Style refactor specifics:
- Enforce arrow-function-only across new code. The current `BudgetSplash` is declared with `function BudgetSplash(...)` (line 41 of `src/components/budget-splash.tsx`) — this is pre-existing technical debt, not introduced by this task; leave it unless the surrounding edits make a rewrite trivial. The same applies to `parseDollarInput` (line 33).
- Enforce semicolons on every statement where optional.
- Enforce single-line `if` with no braces when the body is one statement. Example: `if (!isValid) return;`
- Enforce `async/await` + `try/catch/finally`. Replace any `.then()` / `.catch()` / `.finally()` that may have slipped in.
- Enforce full descriptive parameter names. No `a`, `b`, `x`, `res`, `val`, `obj`. The existing event-handler convention uses single-char `e` for `ChangeEvent` / `FormEvent` — match that.
- Verify JSDoc blocks on touched public exports include `@author`, `@editor`, `@lastUpdated` (YYYY-MM-DD = today), `@name`, `@description`, `@param`, `@returns`, with author + editor set to `mike-the-dev (Michael Camacho)`.
- Check defensive-programming rule: validation sits at the API boundary (inside `api.ts` or `EmbedClient`'s onboarding-error branch), not scattered across `BudgetSplash`. The component's only enforcement is required-ness via the disabled submit button.
- Keep functions single-purpose. `handleSplashSubmit` should not also be parsing budget cents — that math stays inside the splash component, where the dollars-to-cents knowledge already lives.

Style requirements:
- apply all rules from style-enforcer.md
- improve readability, structure, and consistency
- align code with project conventions and standards
- do not change functionality or logic
- do not introduce new behavior


STEP 4 — TEST EXECUTION
Use the test-suite-runner agent to execute the project's test suite.

Testing context for this task:
- Run `npm test` (resolves to `vitest run` per `package.json`). Also run `npm run typecheck` (`tsc --noEmit`) — type changes ripple through this task and a passing typecheck is part of the "green" definition.
- Expected passing surface includes the updated colocated tests:
  - `src/lib/api.test.ts` (extended onboarding-payload assertion)
  - `src/app/embed/embed-client.test.tsx` (extended state-machine cases)
  - `src/components/budget-splash.test.tsx` (updated for new prop signature)
- Previously-passing suites must still pass — no regressions in `chat-panel.test.tsx`, `chat-message.test.tsx`, `cart-preview-card.test.tsx`, `tool-renderers.test.ts`, `checkout-url.test.ts`, `referer.test.ts`, `payment-estimator.test.ts`, `use-debounce.test.ts`, etc.
- If the repo has an E2E (Playwright) target separate from unit tests, note its existence but do NOT run it in this step — live E2E verification happens in a manual follow-up described under "Delivery notes" below, not in the automated runner.

Testing requirements:
- run the project's standard test command
- report all failing tests clearly
- summarize results
- do not modify code or attempt fixes


STEP 5 — CODE REVIEW
Use the code-reviewer agent to review the implementation.

Review focus for this task:
- Correctness against the wire contract: `SessionInfo` carries `splash` and `onboardingData` (not `budgetCents`). `OnboardingRequest` is `{ onboardingData }`. The discriminated `SplashConfigOnboardingField` union includes all three kinds. No `budgetCents` references remain anywhere in `src/` (search-and-confirm).
- Splash routing decision: skips when `splash === null` OR when `onboardingCompletedAt !== null`. Renders only when both gates fail. The `splash === null` branch reaches hydrate/kickoff via the same path as the resumed-onboarded branch — no duplicate logic.
- Onboarding error handling:
  - 400 Zod errors surface inline on the splash via `submitError`. The splash stays mounted and the visitor can correct.
  - 404 / 5xx / network errors transition to the full-screen error card (today's behavior).
  - The `"this agent has no onboarding"` 400 case is covered (it should never happen if state machine respects `splash === null`, but must not crash if it does).
- `BudgetSplash` renders `field.label` (not the hardcoded string). Submission payload uses `field.key`, not a hardcoded `"budgetCents"`. Required-ness gating on the submit button matches `field.required` (in addition to `MINIMUM_BUDGET_DOLLARS`).
- Affirm promo + payment estimates unchanged in behavior. `MINIMUM_BUDGET_DOLLARS` and `MAX_FINANCEABLE_DOLLARS` constants unchanged.
- Hard-error path: a `splash !== null` with no `kind: "budget"` field transitions to error, does not silently fall through. Console.error fired for developer visibility.
- No backwards compatibility hacks: no `budgetCents` shim, no shape-detection, no fallback path.
- JSDoc, arrow-function, semicolon, single-line-if, async/await rules hold across all touched code.
- Tests cover: `splash: null` path, resumed-onboarded path, splash-render path, 400 Zod inline error, 404 full-screen error, missing-budget-field hard error, `field.required === false` submit-enabled-on-empty.
- No excessive mocking. Network mocks at the `fetch` boundary as today; no mocking of internal helpers.
- Bundle-size / dependency check: no new deps. HeroUI primitives already in the bundle remain the only UI library.
- Security: no `dangerouslySetInnerHTML`, no untrusted HTML rendered. The 400 Zod error message rendered inline should be rendered as plain text via React's default escaping.

Review requirements:
- verify correctness of the implementation
- confirm alignment with the architectural plan
- evaluate maintainability, security, and performance
- ensure style refactor did not alter functionality
- report issues using structured review feedback


DELIVERY NOTES (post-review, for the operator — not a sub-agent step)
- Live verification: run `npm run dev`, load the sandbox host (`public/sandbox.html`) via Playwright MCP, and walk these flows:
  1. `?agent=shopping_assistant` → splash renders with the budget question driven by `field.label` → submit a budget → chat opens with the kickoff greeting.
  2. `?agent=lead_capture` → splash never renders → chat opens directly with the kickoff greeting.
  3. Reload `?agent=shopping_assistant` after step 1 with the persisted session ID → splash skipped (resume) → chat opens with hydrated history.
- Journal: append a dated entry to `docs/journal.md` describing the per-agent onboarding cutover, the `budgetCents` → `splash` / `onboardingData` rename on `SessionInfo`, the splash-skip behavior for `splash: null` agents, and the inline 400 Zod error surfacing. Keep it under ~30 lines per repo convention.
- Commit message: follow `docs/agent/commit-messages.md` conventions. Conventional-commits style (`feat(embed): consume per-agent onboarding splash config`).
- Known follow-ups (document, do not implement): (a) `IndustrySplash` and/or `ShortTextSplash` components when a future agent declares those field kinds; (b) generalized splash-routing if multiple splash-bearing agents share UI elements; (c) translation/i18n hook for `field.label` if multilingual splashes ever ship.
