# Ticket walkthrough plan (post-v3.1)

**Date:** 2026-07-27 · **State:** `dev` = v3.1 (`54c903c`), `test` = v3, `main` = v3.0.0.
**Purpose:** work the 40 open issues against what v3.1 actually changed, in an order that makes most
of them answer themselves.

> **Do step 0 first.** Most of the ambiguity below dissolves once you have played it. Reading code to
> decide whether a behaviour ticket is satisfied is the slow, unreliable route; five minutes on two
> devices settles most of Group B.

---

## Step 0 — CONFIRM WHAT IS DEPLOYED, then play it on two devices (~15 min)

**Check the build before you trust anything you see.** The page loading proves nothing — a failed
deploy leaves the PREVIOUS build serving happily at the same URL:

```bash
curl -s https://ggcdevs.github.io/pente3D.ai/dev/version.json   # must describe a commit you recognise
gh run list --branch dev --limit 1                              # and the deploy must say success
```

This is not hypothetical. On 2026-07-27 the v3.1 promotion pushed two branches seconds apart, the two
deploys raced on `gh-pages`, and the `dev` one lost — so `/dev/` served the pre-v3.1 build for an
hour, and the only symptom was `version.json` 404ing (that older build predates the file). Playing
that build and triaging tickets against it would have produced confident, wrong answers. The race is
fixed (`concurrency: gh-pages-deploy` in `deploy.yml`), but the habit is the real protection.

Then open **https://ggcdevs.github.io/pente3D.ai/dev/** on a laptop and a phone.

Run this sequence and keep notes — it exercises nearly everything v3.1 changed:

1. Host on one, join on the other with the **same code**. → distinct colours, one game.
2. Play a few moves. **Lock the phone** mid-game, play a move on the laptop, unlock. → the phone
   catches up on its own. *(This is #45, the bug that froze v3.)*
3. **Reload** the laptop tab. → empty slate, then a prompt offering to rejoin, naming your colour.
4. Finish the game, **Rematch** from either side. → colours swap on both.
5. Start a **New Game at the same room code**. → an empty board, not the old one. *(#46/#43)*
6. Open the **games list**. → both games listed, finished vs unfinished, resume works on the
   unfinished one.

Anything that feels wrong here is worth a ticket of its own before triaging the old ones.

---

## Group A — likely closable (verify, then close)

These are superseded rather than merely touched. For each: do the check, and if it holds, close with a
comment naming the commit and the test that proves it. **Do not close on code reading alone.**

| # | check | proof already in the repo |
|---|---|---|
| **#45** | step 0.2 above | `npm run scenario:issue45` (live relay) |
| **#46**, **#43** | step 0.5 above | `scenario:code-reuse`, `e2e/netWiring.spec.ts` |
| **#42** | step 0.1 — one game uuid on both (`window.__pente.getGameUuid()`) | `e2e/sessionModel.spec.ts` #31 regression |
| **#38** | see Group B note — needs a forced divergence | `scenario:divergence`, `e2e/divergence.spec.ts` |
| **#37** | step 0.6 above | `e2e/gamesList.spec.ts` |
| **#35** | the v3 epic — its model is superseded by the v3.1 design | the whole branch |

**Mechanics:** issues stay open until the work reaches `main` (CONTRIBUTING). Since v3.1 is on `dev`,
either label them `on-dev` now and close at promotion, or close now and accept that the convention
bends. Closing keywords in commits only auto-close from the **default branch**.

---

## Group B — behavioural re-review (decide, do not assume)

The build plan's closing checklist. Each asks the same question: *is this behaviour still required,
and does it still hold?*

- **#40** (rematch → reconnect keeps the swapped colour) — step 0.4, then lock/unlock the phone.
  Covered by `scenario:rematch`; confirm by hand because the original bug was a deadlock nobody saw
  coming.
- **#31** (two Joiners get distinct seats) — step 0.1 with *both* sides choosing Dealer's choice.
- **#41** (real-relay scenario matrix) — arguably delivered by `npm run scenario:all` (8 scenarios,
  live broker). Read the ticket's original scope: if it wanted *browser* two-context coverage too,
  part of it remains.
- **#33** (history slider in networked games), **#34** (random starting board), **#36** (spectator) —
  **untouched by v3.1**, and each needs re-speccing against the new model before any build:
  - #33: the slider is local-only by design (#17); decide what "scrub a networked game" now means
  - #34: is now just another *seed kind* — cheap in the new entry flow
  - #36: re-spec against design §3's seed matrix (a spectator brings no game and takes no seat)

**To see a divergence for #38**, you cannot produce one honestly — two correct clients never fork
(the turn gate caps drift at one move). Use the CLI: `npm run scenario:divergence`, or drive it by
hand with `pente local-undo` (documented as simulating a modified client).

---

## Group C — untouched by v3.1

Triage normally; nothing here depends on the remodel. Notable ones:

- **#30** code validation — while fixing a hollow test I found `validateGameCode` **accepts codes
  LONGER than `CODE_LENGTH`** (it only refuses short ones). Pinned by a characterization test in
  `src/net/activeGame.test.ts`; the fix belongs here.
- **#49** colour preference for a NEW game — small, and the entry flow is now the natural home.
- **#51 / #52** version display + bump-mismatch warning — independent of the remodel.
- **#50** authoritative server — v4-scale, captured not planned.
- UI/polish (#44, #32, #29, #28, #27, #26, #24, #19, #16, #14, #10, #9, #21, #23, #25) — unaffected.

---

## Group D — file these, they came out of the build

1. **Simultaneous-resolution tie-break.** If both players click a resolution inside one relay
   round-trip, N.1's "latest ask wins" makes each accept the *other's* proposal and they swap
   histories — still apart, nothing lost, immediately re-detected and re-resolvable. A proper fix is a
   deterministic tie-break inside the **shared** handshake, which also touches #12 and #18.
   *Recommended: ticket, not surgery.*
2. **Known test gaps** — recorded in `planning/2026-07-25-net-model-v3.1-build-plan.md` under "Known
   test gaps, reported not hidden": axis array order unpinned; bearer tie-break determinism untested;
   two conflict-archival assertions; and `VERB_ARITY`'s registry check being blind to fall-through
   `case` labels. One ticket, or one per gap.
3. **UI copy pass** — the divergence panel and the rejoin prompts. Both were written plain on purpose
   and flagged as collaboration points; they want your voice.

---

## Suggested order

1. **Step 0** — play it. (Everything below is cheaper afterwards.)
2. **Group A** — close the six; that is the bulk of the backlog reduction.
3. **Group B** — #40/#31 confirm-and-close, #41 read-the-scope, then re-spec #33/#34/#36.
4. **Group D** — file the three while the context is fresh.
5. **Group C** — normal triage; #30 and #49 are the cheap wins.
6. **Promotion to `main`** when you are satisfied — `PENTE_ALLOW_PROTECTED_PUSH=1 git push origin
   test` then the same for `main`, and afterwards retire the guard:
   `rm "$(git rev-parse --git-common-dir)/hooks/pre-push"`. That promotion is what closes the ~16 v3
   tickets carrying `on-dev`.
