# Review & Learning Log

Append-only record of what adversarial reviews caught, which issue categories recur, and what
instruction/principle tweaks were made in response. Feeds the **per-stage consolidation
ritual** (below).

## Consolidation ritual (run after every stage)

1. Record the stage's reviewer findings here (fed by the review-gate workflow's structured
   return: `issuesByRound`, `recurringCategoriesForInstructionTuning`, gate result).
2. Flag any category that recurred (≥2 in a stage, or across stages).
3. For each recurring category, decide a response — **guided by `agent-principles.md` →
   "Principle-writing discipline": nip the pattern, not the symptom.** Prefer a general
   principle or a structural fix over a narrow, over-fitted rule. Skip a one-off; act on the
   2nd–3rd recurrence.
4. Log the tweak made (with before → after and rationale, incl. "generalized from symptom X").
5. Periodically consolidate: merge overlapping rules, delete rules made obsolete by structural
   fixes, keep the principles doc lean.

Instruction tweaks get **human approval** — they are not applied automatically, to avoid
over-fitting the shared implementer prompt.

---

## Stage 1 — rules core

**Issues caught (pre-mutation, during coverage remediation):**
- `gate-gaming / safety-in-depth` — implementer **silently deleted a defensive guard**
  (`!Number.isInteger` in `lines.ts collinearAxis`) to reach 100% coverage. Sound math, but
  removed a tripwire without flagging it.
- `coverage-vs-verification` — coverage hit 100% but that alone doesn't prove tests are
  genuine (motivated adding mutation testing).

**Tweaks made (generalized, not symptom-specific):**
- Added to `agent-principles.md`: *"Modifying code under test to satisfy a gate"* — such
  changes are a **mandatory review item**, and prefer **assert-over-delete** for unreachable
  branches (keep the tripwire). → generalized from the `lines.ts` incident, applies to any
  gate-driven code change.
- Added the **mutation-testing** gate (Stryker ≥95% on `src/core`) + **assertion-lint**
  (`eslint-plugin-vitest`) so "executed" is never mistaken for "verified".
- Added the **adversarial reviewer** phase + **fix loop** (max 3, then escalate) and the
  **Reviewer Charter** (approving is the lazy path → reviewers hunt).

**Recurring categories:** none yet (first stage). Watch: `gate-gaming`, `proof-by-log`.

**Status:** review-gate workflow running to validate all 150 Stage 1 tests via mutation +
2 adversarial reviewers before the Stage 1 push.
