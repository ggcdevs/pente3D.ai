# Agent Guiding Principles

Every implementer and reviewer subagent working on this repo receives this document.
Reviewers additionally receive the **Reviewer Charter** below. These are hard constraints,
not suggestions.

## Why this exists

An agent minimizes effort against its *perceived* constraints. Anything we leave unstated
becomes the cut corner — usually well-intentioned scaffolding with a silent "we'll fix this
later" that then goes unnoticed. We cannot enumerate every value for every scenario, so we
state overarching values here and add specifics where warranted. When a reviewer keeps
catching the same category of problem, that is a signal to strengthen the *implementer's*
instructions — not just to fix the instance.

## Overarching values (ALL agents)

1. **Genuine completeness over apparent completeness.** Never present scaffolding, a stub, a
   happy-path shell, or a "good enough for now" as done. If something is incomplete, say so
   explicitly with a `TODO(reason)` — never disguise it as finished.
2. **Proof, not inference.** Never claim success. Run the command and show real output. If it
   was not observed, it is not done. "should pass" / "likely works" is forbidden.
3. **Proof = observable behavior, never a log line.** Assert on return values, `GameState`,
   `headHash`, `window.__pente` values, or — for networking — the *other* client actually
   receiving the move over the real relay. A log message saying "sent" proves nothing.
4. **Follow the design docs exactly** (`planning/*-design.md`, `GLOSSARY.md`). DRY, YAGNI.
5. **Respect architecture boundaries.** `src/core` stays pure (no three/DOM/net/ui). The
   eslint boundary rule enforces this — do not weaken it.
6. **Never weaken a gate to pass it.** Do not lower coverage/mutation thresholds, disable
   tests, add blanket ignores, or relax lint to get green. That is a firing offense for a
   reviewer to catch.
7. **A gate you haven't watched reject something isn't a gate.** When you add or configure a
   gate/threshold, prove it *fails when it should* — not merely that it currently passes.
   Show the command exiting non-zero on a deliberate regression (e.g. raise the mutation
   `break` and see exit 1; inject an uncovered branch and see coverage fail), then restore.
   A threshold that never rejects anything, reported as a "gate," is proof-by-inference — the
   exact trap that shipped an unenforced 95% mutation "gate" in Stage 1.
8. **Don't hardcode volatile facts.** Mutation scores, coverage %, timings, counts — anything
   that changes run-to-run or as code evolves — must NOT be written into code, comments, or
   docs as a documented "fact." It goes stale the moment it's written and becomes
   proof-by-inference. State the *mechanism* and point to the command that yields the current
   truth ("run `npm run mutate`"), never a frozen number. (This repeatedly tripped the review
   gate on stale mutation figures in `stryker.config.mjs`.)

## Tests must be genuine

- Every test asserts on **specific expected values**, not that code merely ran. No
  `expect(true).toBe(true)`, no asserting a value equals the same literal you just fed in.
- **Coverage is a floor, not proof** — it shows code executed, not that behavior was
  verified. Mutation score is the real bar.
- Include **negative / failure tests** (illegal move throws, wrong-turn rejected, malformed
  input rejected). Positive-only suites are suspect.
- Do **not** mock the unit under test. Fault-injection via spies is allowed only to reach
  genuinely-unreachable defensive branches, and the test must still assert real behavior
  (e.g. the error propagates verbatim and is not masked).

## Logging discipline

- Logs state **observed facts** (`published event seq=5`), never **conclusions**
  (`message sent successfully`).
- Never emit optimistic messages on error paths. Errors must propagate honestly and never be
  masked, swallowed, or mislabeled — misleading logs corrupt diagnosis.

## Commit hygiene & ticket traceability

- **Every commit for ticketed work references its issue in the message** — `(#N)` inline, or
  a trailing `Refs #N`. This makes the issue timeline the source of truth for which work
  touched which ticket (GitHub auto-cross-references `#N`). Work that spans several tickets
  names all of them.
- Use a **closing keyword** (`Fixes #N` / `Closes #N`) *only* on the commit that genuinely
  completes the ticket — and know it auto-closes the issue only once the commit reaches the
  **default branch** (`main`), never on `dev`/`test`. Use plain `#N` for partial/progress work.
- One logical change per commit; the subject says *what changed and why*, not "wip".

## Modifying code under test to satisfy a gate

- Allowed, but it is a **mandatory review item** — flag it explicitly; it is never silently
  accepted.
- For a genuinely-unreachable branch, **prefer replacing the guard with an explicit assertion**
  (e.g. `assert(vi === 1 || vi === -1)`) over deleting it. Keep coverage clean *and* keep the
  tripwire against future invariant violations. Silent deletion of a defensive guard is a
  regression in safety-in-depth even when currently unreachable.

## Reviewer Charter (reviewers only)

- **Your goal is to find problems, not to approve.** Approving is the lazy path here, so the
  effort-minimizing move for *you* is rigorous hunting. Rubber-stamping is forbidden.
- **Assume the implementer took the minimal-effort path. Verify the opposite.**
- Read the actual implementation AND the actual tests. Hunt specifically for:
  - hollow / tautological tests; coverage-padding; assertions on the test's own input
  - missing negative/failure cases
  - proof-by-log instead of proof-by-behavior
  - silent scaffolding, stubs, or `TODO`s presented as complete
  - errors masked, swallowed, or mislabeled
  - unjustified or unflagged changes to code under test
  - weakened configs / thresholds / disabled or focused tests
  - deviations from the design docs
- For every issue return: **category, severity, exact location, and which principle it
  violates.** Cite specific lines. If you are uncertain whether something is real, flag it —
  do not approve to be safe.

## Principle-writing discipline (for instruction tweaks & consolidation)

When a recurring issue prompts a change to this document or an implementer prompt:

- **Nip the pattern, not the symptom.** Abstract the specific failure into the most general
  rule that fixes its root cause. Bad example: a reviewer keeps finding color rules split
  wrongly across files, so someone adds "always edit `dark.css` and `light.css`." That is
  wrong — it won't apply to most implementers and mis-frames the problem. The right response
  is a general rule about single-source-of-truth / proper organization, plus (where warranted)
  restructuring the code so the correct thing is the easy thing.
- **Prefer structural fixes over rule-patching.** If the codebase makes the wrong thing easy,
  change the structure so the rule is rarely needed at all.
- **Generality test:** would this rule make sense to an implementer working on a completely
  different part of the system? If not, it is too specific — generalize it, or scope it
  explicitly to where it applies.
- **Keep this document lean.** Consolidate overlapping rules; delete any made obsolete by a
  structural fix. A bloated principles doc gets skimmed and ignored — which defeats its purpose.
