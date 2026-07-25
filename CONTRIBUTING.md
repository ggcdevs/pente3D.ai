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

Issues stay **open until the work reaches `main`**. The `on-dev` label marks "built and live on
`/dev/`, pending promotion".

### `dev` / `test` / `main` are FROZEN while v3.1 is in flight

v3 is feature-complete but carries the game-bricking #45 and the stale-game push #46, so **v3.1 is
what ships to `main`** (design §11) and nothing lands on the three shared branches until the remodel
is done and deliberately promoted. That is enforced mechanically, not by memory — autonomous build
and gate agents push on their own after a passing review gate:

```bash
tools/install-git-hooks.sh    # symlinks tools/git-hooks/* into the SHARED hooks dir (all worktrees)
```

The `pre-push` hook refuses `dev`/`test`/`main` and prints why. To promote on purpose:
`PENTE_ALLOW_PROTECTED_PUSH=1 git push origin test`. To drop the guard once v3.1 has shipped:
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
| `feat!` / `BREAKING CHANGE:` | breaking | **flags for a manual major** — never bumped automatically |

Prefer these over ad-hoc types (older history contains `workflow:` and `plan:`; treat those as `ci`
and `docs`).

## Tickets

Labels: `bug`, `enhancement`, `epic`. Milestones track generations (`v3`, `v3.1`).

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

- `main` push → release tag `vX.Y.Z` + a GitHub Release.
- `test` push → prerelease tag `vX.Y.Z-rc.N`.
- `dev` / feature branches → no tag; their version is `git describe` (e.g. `v3.0.0-87-g00f5521`).
- The bump is derived from commit types + ticket labels (above). **Major is never automatic** —
  "backwards incompatible" is a human judgement, so major versions are tagged by hand.
- Major = generation (the v1/v2/v3 rewrites) · minor = feature milestone · patch = fixes.

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

**Regenerate diagrams before pushing to `test` or `main`** — CI staleness-checks them there (and
only there, so `dev` won't warn you):

```bash
npm run diagrams && npm run diagrams:check
```

Testing bar: pure logic earns unit + property (fast-check) + **mutation ≥95** + 100% coverage; IO
glue (THREE/DOM/network) is Playwright-verified against `window.__pente` real state, never log lines.
See `planning/2026-07-18-testing-strategy.md`.
