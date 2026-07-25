# Pente3D

A 3D Pente game. Local play works offline; networked host/join runs over an MQTT
relay.

## Develop

```bash
npm ci
npm run dev        # vite dev server
npm test           # unit tests (vitest)
npm run lint       # eslint (0 warnings expected)
npm run build      # tsc --noEmit && vite build → ./dist (gitignored)
```

> `package.json`'s `"version": "0.0.0"` is a placeholder, **not** this project's version.
> The version comes from git tags — see [Versioning](#versioning-issue-22).

## Relay config (issue #22)

The tracked default at `src/config/defaults/relay.json` ships **blank**:

```json
{ "wssUrl": "", "username": "", "password": "", "topicRoot": "pente/v1" }
```

The relay endpoint + creds are **not** in the repo (portability + single source of
truth for deploys). They live in a GitHub Actions repo variable, `RELAY_CONFIG`, and
the deploy workflow writes them into `relay.json` before building. Client creds are
public by nature — this is not a secret, it is decoupling the repo from one operator's
broker.

With a blank relay the app **boots and plays local games normally**. Networked
host/join **fails gracefully**: `mqtt.connect('')` cannot reach a broker, so the
connect Promise rejects with an honest error (`MqttTransport` surfaces it) — no crash,
local play unaffected. This is verified by the unit suite (`src/config/config.test.ts`
pins the blank default; the two `*.realrelay.test.ts` suites skip cleanly when the
relay is unreachable).

### Local relay for dev

To run networked games locally, supply your own relay **without editing the tracked
file** (so `relay.json` stays blank in git). The config layer deep-merges a
`localStorage` override over the tracked default (`src/config/config.ts`), so set it
once in your browser devtools console:

```js
localStorage.setItem('pente:config:relay', JSON.stringify({
  wssUrl: 'wss://your-broker/mqtt',
  username: 'you',
  password: 'secret'
  // topicRoot defaults to "pente/v1" — override only if your broker needs it
}));
// reload the page
```

`getConfig('relay')` (read on demand at host/join time) picks it up. Clear it with
`localStorage.removeItem('pente:config:relay')`.

## Deploy (GitHub Actions → GitHub Pages)

`.github/workflows/deploy.yml` deploys on push to `main`, `dev`, and `test` to the
`gh-pages` branch, each environment at its own subpath so branches don't clobber each
other:

| branch | base                 | Pages path        |
| ------ | -------------------- | ----------------- |
| main   | `/pente3D.ai/`       | site root         |
| dev    | `/pente3D.ai/dev/`   | `/dev/`           |
| test   | `/pente3D.ai/test/`  | `/test/`          |

Each run: checkout (`fetch-depth: 0` — see Versioning) → `npm ci` → write `relay.json`
from `${{ vars.RELAY_CONFIG }}` → `vite build` with the branch's `DEPLOY_BASE` → publish
`dist/` to `gh-pages` at the branch subpath (`peaceiris/actions-gh-pages@v4`,
`keep_files: true`).

## Versioning (issue #22)

**Git tags are the single source of truth.** `package.json` says `"version": "0.0.0"` and
that is a placeholder npm requires — **it is not the app version and nothing reads it.**
Do not bump it. Everything derives from tags at build time via `tools/version.mjs`:

- `__APP_VERSION__` — a compile-time constant Vite substitutes into the bundle (declared
  for TypeScript in `src/env.d.ts`). At runtime the boot code publishes it as
  `window.__penteVersion`.
- `dist/version.json` — the deploy fingerprint, fetchable at `<base>version.json`
  (e.g. `/pente3D.ai/dev/version.json`):

  ```json
  {
    "version": "v3.0.0-84-gb0cf3cb",
    "describe": "v3.0.0-84-gb0cf3cb",
    "branch": "feat/net-model-v3.1",
    "sha": "b0cf3cb",
    "builtAt": "2026-07-25T06:05:17.890Z"
  }
  ```

  `version` is `X.Y.Z` when the build sits exactly on a tag, the full `git describe` form
  when it is ahead of one, and `0.0.0-unknown` when no tag is reachable — an honest
  admission, never a guess. `sha` identifies the commit even in that degraded case.

Run `node tools/version.mjs` to see what the current tree resolves to, and
`node tools/version.mjs --plan` to see what tag the next release would get.

### Tag cadence

| push to            | tag                    | also                              |
| ------------------ | ---------------------- | --------------------------------- |
| `main`             | `vX.Y.Z`               | a GitHub Release with the commits |
| `test`             | `vX.Y.Z-rc.N`          | —                                 |
| `dev` / `feat/…`   | none                   | version is whatever `git describe` says |

`.github/workflows/release-tag.yml` cuts them. It never fights `deploy.yml`: a tag push is
not a branch push, and the two write disjoint refs.

### How the bump is derived

Two **redundant** signals over `<last release tag>..HEAD`; the **higher** wins.

| signal          | minor         | patch  | no release                                            |
| --------------- | ------------- | ------ | ----------------------------------------------------- |
| commit prefix   | `feat:`       | `fix:` | `docs test chore style ci refactor workflow plan` |
| ticket label of each cited `#N` | `enhancement` | `bug`  | any other label |

The redundancy is deliberate: commit messages travel with the repo, so versioning still
works if this project ever leaves GitHub. When `gh` is unavailable, unauthenticated or
offline, the ticket half is **skipped with a logged reason** and the commit half decides
alone.

When the two **disagree** — a `feat:` commit citing a `bug`-labelled ticket — the higher
wins and the pair is logged as a `MISMATCH` warning. That is the mislabel-catcher; it
never fails the run, because blocking a release on a label typo would be worse than a
slightly generous bump.

### Major is never automatic

`tools/versionBump.mjs` **cannot** return `major` — no code path produces it, and a
property test asserts that over arbitrary input. Nothing in a commit message or a label
can prove a change is backwards-*incompatible*; only a human can. A `feat!:` /
`BREAKING CHANGE` commit raises a `manualMajor` flag that the workflow echoes loudly, and
a person then cuts the tag by hand:

```bash
git tag -a v4.0.0 -m "what broke and why" && git push origin v4.0.0
```

### Why the deploy checkout needs `fetch-depth: 0`

`actions/checkout@v4` defaults to `fetch-depth: 1` **and** `fetch-tags: false`, so the
default CI checkout contains **zero tags**. `git describe --tags` then fails outright and
every deployed build would report `0.0.0-unknown`. Both workflows therefore check out with
`fetch-depth: 0` + `fetch-tags: true`, and `deploy.yml` prints `dist/version.json` after
the build so a regression is visible in the log rather than silently shipped.

### Testing

The bump rules are pure and IO-free (`tools/versionBump.mjs`), unit-tested in
`tools/versionBump.test.mjs`, pinned to the 100% coverage floor in `vite.config.ts`, and
in the mutation scope in `stryker.config.mjs` — run `npm run coverage` and `npm run mutate`
for the current figures. The git/`gh` half (`tools/version.mjs`) is the IO boundary,
verified by running it against this repository.
