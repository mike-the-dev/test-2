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

