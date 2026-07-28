# Contributing to Pente3D

Conventions for humans and agents. The deeper docs are the source of truth for *how to work*:

| Doc | What |
|---|---|
| **`planning/agent-principles.md`** | The constitution — proof-not-inference, genuine tests, never weaken a gate. **Every agent gets this.** |
| `HANDOFF.md` | Current project state + hard-won gotchas. Read first when picking the project up. |
| `GLOSSARY.md` | Vocabulary (node/piece, 13 line-axes, seat, headHash, room vs game…). |
| `planning/*-design.md` | Design of record per subsystem. |
| `docs/diagrams/` | Auto-generated architecture (`npm run diagrams`). |

This file covers the things that are *conventions* rather than principles: branches, commits,
tickets, versions, deploys.

---

## Branches & environments

| Branch | Role | Deploys to |
|---|---|---|
| `main` | Release gate. Only advances on a deliberate promotion. | site root |
| `test` | Staging. | `/test/` |
| `dev` | Daily integration. | `/dev/` |
| `feat/*`, anything else | Feature work. | `/<branch-name>/` |

**Every branch is playable online** at its own subpath (`ggcdevs.github.io/pente3D.ai/<branch>/`).
Subpaths of deleted branches are pruned automatically on the next push to any branch.

Work **in-place on the current branch**. Never `git checkout`/`git switch` inside an agent task —
the working tree is shared, and switching it out from under a running dev server or another agent
has caused real incidents. Push with `git push origin HEAD`.

Issues close when the work lands on **`dev`** — not when it reaches `main`. The backlog's job is to
describe what is still true of the codebase, and a ticket whose fix is merged and playable no longer
is. *(Changed 2026-07-27. The older rule was "open until `main`", and the `on-dev` label existed to
mark the gap that created; it is now vestigial.)*

### `test` / `main` still hold v3 until the promotion

v3 is feature-complete but carries the game-bricking #45 and the stale-game push #46, so **v4.0 is
what ships to `main`** (design §11). The remodel has landed on `dev`; `test` and `main` still hold v3
and advance only on a deliberate promotion. That is enforced mechanically, not by memory — autonomous
build and gate agents push on their own after a passing review gate:

```bash
tools/install-git-hooks.sh    # symlinks tools/git-hooks/* into the SHARED hooks dir (all worktrees)
```

The `pre-push` hook refuses `dev`/`test`/`main` and prints why. To promote on purpose:
`PENTE_ALLOW_PROTECTED_PUSH=1 git push origin test`. To drop the guard once v4.0 has shipped:
`rm "$(git rev-parse --git-common-dir)/hooks/pre-push"`. (The hook is a symlink into the worktree it
was installed from — if that worktree is removed, re-run the installer from the main checkout.)

## Commits

**Format:** conventional commit + the issue number.

```
feat(net): unified entry UI with seed selector (#35, #31)
fix(render): settle opaque pieces into the opaque pass (#28)
docs(design): record the release decision (#47)
```

- **Every commit for ticketed work references its issue** — `(#N)` inline or a trailing `Refs #N`.
  Name all of them if the change spans tickets. This makes the issue timeline the source of truth
  for what touched what; reconstructing a session without it is genuinely painful.
- Use a **closing keyword** (`Fixes #N` / `Closes #N`) *only* on the commit that truly completes the
  ticket. Note it auto-closes only when the commit reaches the **default branch** (`main`), never on
  `dev`/`test`.
- One logical change per commit. The subject says *what changed and why*, never "wip".

**Types** — and what each means for versioning:

| Type | Meaning | Version effect |
|---|---|---|
| `feat` | new user-facing capability | **minor** |
| `fix` | corrects broken behaviour | **patch** |
| `docs`, `test`, `chore`, `style`, `refactor`, `ci`, `build`, `perf` | no user-facing behaviour change | none |
| `feat!` / `BREAKING CHANGE:` | **the wire protocol broke** | **flags for a manual major** — never bumped automatically |

Reserve `feat!` / `BREAKING CHANGE:` for a **protocol** break, now that the major version *is* the
wire version (below). A breaking change to the build, the config shape or an internal API is not one.

Prefer these over ad-hoc types (older history contains `workflow:` and `plan:`; treat those as `ci`
and `docs`).

## Tickets

**Type labels** — `bug`, `enhancement`. **Every ticket needs one**: the version bump reads the labels
of every `#N` a commit cites, so an unlabelled ticket contributes no signal (eleven were found
unlabelled in the 2026-07-27 triage).

**Other labels**, each with a mechanical meaning:

| Label | Means |
|---|---|
| `epic` | Umbrella spanning multiple tickets; closes when its children do |
| `parked` | A recorded idea, deliberately **not** scheduled. Excluded from milestones so it never distorts a release count |
| `tracker` | A running checklist, never "done" (e.g. #32). No milestone, and **no type label** — its commits carry their own prefix, which is the right signal |
| `verify-in-ci` | Built, but only provable by watching a CI event that cannot be rehearsed locally. `release-tag.yml` **comments on every open issue carrying it** whenever it cuts a tag or publishes a Release, naming what happened — so the event announces itself instead of someone having to remember. Opt-in and self-retiring: remove the label or close the issue and it stops |

**Milestones** are the schedule, not a taxonomy: the next release (`v4.0`), the batch after (`v4.1`),
and *no milestone* for real work that is not yet scheduled. `parked` + no milestone = an idea;
no label + no milestone = unscheduled work. A milestone closes when it hits zero open.

**The commit prefix describes the COMMIT; the label describes the TICKET.** They legitimately
differ — a `fix:` commit while building an `enhancement` ticket is normal and expected, not an
error. So the version tooling takes the **higher** of the two signals and only treats one direction
as suspicious:

| Situation | Reading |
|---|---|
| `fix:` commit on an `enhancement` ticket | **Normal.** Fixing something mid-feature. No warning. |
| `feat:` commit on a `bug` ticket | **Suspicious.** Either the ticket is mislabelled, or the work grew past its ticket. Warn. |

If a bug ticket keeps attracting `feat:` commits, that's the signal to split it or relabel it.

## Versioning

**Git tags are the single source of truth.** `package.json`'s `"version": "0.0.0"` is *not* the
version — the package is private and never published; ignore that field.

### The major version IS the wire-protocol version

Adopted 2026-07-27, and it is the whole point of the scheme: **the major bumps if and only if the
network protocol breaks.** That makes compatibility a single integer comparison —

> **If the majors differ, no game.**

— with no second version number to keep in sync. The cost, accepted knowingly: the older convention
("major = generation — the v1/v2/v3 rewrites") is retired. A full rewrite that leaves the wire alone
stays `v4.x`.

Two consequences worth stating outright:

- A peer built before this scheme sends **no version field at all**, so an *absent* version counts as
  incompatible, not as a match.
- The version must be **on the wire** in the release that introduces the scheme, or the next major
  cannot detect this one either. Enforcement is #51.

Minor = feature milestone · patch = fixes. Unchanged.

### Cadence

- `main` push → release tag `vX.Y.Z` + a GitHub Release.
- `test` push → prerelease tag `vX.Y.Z-rc.N`.
- `dev` / feature branches → no tag; their version is `git describe` (e.g. `v3.0.0-87-g00f5521`).
- The minor/patch bump is derived from commit types + ticket labels (above), the higher of the two.
- **Major is never automatic.** No code path in `tools/versionBump.mjs` returns `major` — nothing in a
  commit message proves the protocol broke. **You tag `dev` by hand:**

  ```bash
  git tag -a v5.0.0 -m 'why the wire changed' && git push origin v5.0.0
  ```

  That is the *only* manual step in the whole release process. When that commit reaches `main`, CI cuts
  the Release from the tag it finds there (#55 — **pending**; until it lands, a hand-tagged major
  reaching `main` produces no Release at all, because the workflow only releases tags it cut itself).
  Tag **before** pushing the branch, or the bump is computed from the previous tag and the wrong
  version is cut.

Every build emits **`version.json`** next to the bundle:

```bash
curl -s https://ggcdevs.github.io/pente3D.ai/dev/version.json
```

Use it to confirm what is actually deployed — it beats comparing bundle hashes.

## Before you push

```bash
npm run build   # tsc --noEmit + vite build — a green `npm test` does NOT imply a green build
npm run lint    # 0 warnings
npm test        # unit
npm run e2e     # Playwright (add --workers=1 when debugging two-context networked specs)
```

**Do not edit `src/**` while `npm run e2e` is running.** Playwright drives the **Vite dev server**, so
saving a file in the app's module graph sends an HMR full-reload to every open page. Mid-test that
wipes `window.__pente` and boots a fresh app with no net session, and the failure then looks like
anything but its cause — a missing panel, a collapsed layout, `Cannot read properties of undefined`.
It cost two separate investigations (5 failures in 17 runs, all while files were being saved; 10/10
green with the tree untouched). `e2e/divergence.spec.ts` now asserts against a mid-test reload and
names the real reason, but the other specs do not — so let a run finish, or run it against a built
preview.

**Regenerate diagrams before pushing to `test` or `main`** — CI staleness-checks them there (and
only there, so `dev` won't warn you):

```bash
npm run diagrams && npm run diagrams:check
```

Testing bar: pure logic earns unit + property (fast-check) + **mutation ≥95** + 100% coverage; IO
glue (THREE/DOM/network) is Playwright-verified against `window.__pente` real state, never log lines.
See `planning/2026-07-18-testing-strategy.md`.
