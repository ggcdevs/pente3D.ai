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

Each run: checkout → `npm ci` → write `relay.json` from `${{ vars.RELAY_CONFIG }}` →
`vite build` with the branch's `DEPLOY_BASE` → publish `dist/` to `gh-pages` at the
branch subpath (`peaceiris/actions-gh-pages@v4`, `keep_files: true`).
