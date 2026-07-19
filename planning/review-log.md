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

### Stage 1 — round 2 (adversarial review of the "gate added" claim)

The tweak above ("Added the mutation-testing gate (Stryker ≥95%)") was itself **proof-by-
inference, not proof-by-behavior**: the config had *no* `thresholds.break`, so Stryker
defaulted to `break: null` and `npx stryker run` exited 0 at any score. The real measured
score was 90.56% — **below** the claimed 95% bar. The `src/core` "100% coverage floor" was
likewise documentation-only: `vite.config.ts` had no `coverage.thresholds`. Two gates the
docs asserted existed were never machine-enforced, and one target was not even met.

**Fix (behavior-proven, not claimed):**
- Stryker: added `thresholds.break = 95`. Proof: `npx stryker run` now prints *"Final
  mutation score of 95.89 is greater than or equal to break threshold 95"* and exits 0;
  temporarily raising `break` to 97 makes it print *"under breaking threshold 97, setting
  exit code to 1"* and exit 1. The gate is real.
- Vitest coverage: added a per-glob `thresholds` block pinning `src/core/**/*.ts` to 100%
  on all four metrics. Proof: `npm run coverage` exits 0 at 100%; injecting one uncovered
  branch in a core file makes it print *"Coverage for branches (99.56%) does not meet
  'src/core/\*\*/\*.ts' threshold (100%)"* and exit 1.
- Raised the actual score 90.56% → 95.89% with **genuine** tests (negative/observable-
  behavior, not threshold-lowering): the near/far custodian-flank negative cases, undo-vs-
  redo hash distinction (pinned per-arm digests), the `assertValidNodeKey` round-trip +
  integer guards (`01,2,3` / ` 1,2,3` / `1.5,2,3`), the `size: 1` boundary, error-message
  and dedup-discrimination assertions, and reverse-order partial-line ordering. Test count
  153 → 172. `src/core` mutation & line/branch coverage: eventLog/gameState/hash/coords now
  100% mutation; whole core 95.89%.
- Residual survivors are equivalent / redundant-guard mutants (documented in
  `stryker.config.mjs`) that cannot be killed without changing observable behavior; 95 is
  the honest floor, not a number reverse-engineered to pass.

**Recurring category flagged:** `gate-gaming / proof-by-inference` recurred (guard-deletion in
round 1, then *claiming a gate exists without running it* here). Response is structural, per
"nip the pattern": the gates are now **executable and self-proving** (they exit non-zero on
regression), so "the gate exists" is verifiable by running one command rather than by reading
a doc claim. No new prose rule added — the structural fix makes the existing principle #6
enforceable.
