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

