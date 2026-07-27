# `pente` — scriptable CLI client

A terminal client for **networked 3D Pente** that plays against the browser client
over the same MQTT relay. Same room code ⇒ same game.

It is not a reimplementation: it imports the app's own `src/net` (`NetSession`,
`MqttTransport`, the hash-chained sync + admission handshake) and `src/core` (rules,
win detection) verbatim, injecting Node seams — `mqtt.js` for the socket,
[`fake-indexeddb`](https://www.npmjs.com/package/fake-indexeddb) for persistence, and
a stable `playerId`. So it can never drift from the browser's protocol.

## How it works

The MQTT session must stay connected (to receive the opponent's moves and to avoid
flapping presence at the browser peer), so the client is split in two:

- **`pente play <CODE>`** — a long-running *daemon* that holds the one connection,
  joins/hosts the room, and serves state + commands over a Unix socket
  (`.pente-cli/<CODE>.sock`). It also prints the board to stdout on every change, so
  running it in the background gives a live game log.
- **Thin verbs** (`show`, `move`, `wait`, `status`, `undo`, `redo`, `leave`, `enter`,
  `rematch`, `accept`/`decline`, `resolve`, `agree`/`refuse`, `quit`) connect to that socket,
  do one thing, and exit — ideal for scripting.

## Usage

```sh
# 1. Start the connected daemon in the background (join a room the browser hosts):
./cli/pente play ABCDE &          # or: npm run pente -- play ABCDE
#    …to host from the CLI instead: ./cli/pente play ABCDE --host

# 2. Drive the game with thin verbs:
./cli/pente show   ABCDE                 # print the board
./cli/pente wait   ABCDE                 # BLOCK until it's your move (or game over)
./cli/pente move   ABCDE 2,2,2           # place a stone (must be your turn)
./cli/pente status ABCDE                 # one-line readout
./cli/pente quit   ABCDE                 # stop the daemon

# Simulate a network outage (see "Outages" below):
./cli/pente drop    ABCDE                # kill the socket — the session stays "connected"
./cli/pente restore ABCDE                # let mqtt.js reconnect

# Leave the room and walk back in on an explicit seed (design §3):
./cli/pente leave ABCDE                  # a real departure: seat + engine dropped (NOT `drop`)
./cli/pente enter ABCDE --seed new       # start over — sends/accepts an EMPTY game only
./cli/pente enter ABCDE --seed defer     # dealer's choice — the only seed that adopts theirs

# Rematch after a decided game (colours alternate on both sides):
./cli/pente rematch ABCDE                # ask
./cli/pente accept  ABCDE                # …or `decline`, to answer the opponent's ask
```

Any state-returning verb accepts **`--json`**, which prints the raw snapshot instead of a
rendered board — that is what scenario scripts assert on:

```sh
./cli/pente status ABCDE --json | jq '{ply, canPlace, link}'
```

A typical turn loop while scripting: `wait` → read board → `move` → repeat.
`wait` has a `--timeout <sec>` (default 55) after which it returns the current state
flagged "still their turn" so a blocking call always ends; just run it again.

## Views

`--view <name>` selects how the 5×5×5 board is drawn (default `layers`):

- **`layers`** — the five z-slices side by side ("a matrix of matrices"); columns are
  x, rows are y (up is up). Last move shows as a lowercase glyph.
- **`list`** — every placed stone by coordinate, plus captures/turn.

`./cli/pente views` lists them. Adding a view is a one-function change in
[`views.ts`](./views.ts): write `(Snapshot) => string` and register it in `VIEWS`.

## Outages — `drop` / `restore`

`drop` kills the **socket** underneath a live session (`netlink.ts`): mqtt.js stops
auto-reconnecting and the TCP stream is destroyed, so the broker's Last-Will fires and the
peer sees you go absent — while your session keeps its engine, seat and game in memory and
still reports `phase: connected`. That is precisely a phone locking its screen. `restore`
re-enables auto-reconnect and reconnects, so the transport re-subscribes and re-announces
presence.

The split matters: the **session phase** and the **transport link** are different things, and
issue #45 lives in the gap between them. `status` reports both.

## Scenarios

`cli/scenarios/` holds scripted cross-"device" tests over the real relay — two real daemons,
each with its own state dir, identity and DB, seeing each other only through the broker. They
cover what the browser cannot easily drive (design doc §8) and assert on the daemons' own
snapshots, never on log output.

```sh
npm run scenario:all         # the whole matrix, with a pass/FAIL/skipped line per scenario
SCENARIO_VERBOSE=1 npm run scenario:issue45   # one scenario, teeing both daemons' live boards
```

| script | what it puts on trial |
|---|---|
| `scenario:issue45` | a reconnect converges to the LIVE game (#45) |
| `scenario:mirror` | the returner's own unheard move reaches the resident (design §5 mirror) |
| `scenario:divergence` | a fork is seen by BOTH and resolved by agreement (#38) |
| `scenario:code-reuse` | re-using a code with New Game starts a NEW game (#46, #43) |
| `scenario:rematch` | after a rematch swap, a returning peer comes back on its NEW colour (#40) |
| `scenario:both-absent` | both leave, both return → same head, seats intact |
| `scenario:ff-boundary` | ONE entry behind converges itself; TWO must be resolved by the players |
| `scenario:last-move` | the CLI's own `lastMove` readout always names a stone that is ON the board |

**Exit codes.** `0` every check passed · `1` a check FAILED (a regression) · `2` SKIPPED because
the relay was unreachable. The last one is deliberate: without egress a scenario proves nothing,
and reporting that as a failure would train everyone to ignore a real one. `scenario:all` applies
the same rule to the suite — `1` if anything failed, `2` if *everything* was skipped.

Writing another: drop a `*.ts` in `cli/scenarios/` (it joins `scenario:all` automatically — the
runner enumerates the directory) and give it its own `scenario:<name>` script. `harness.ts` gives
you `requireRelay` / `startPeer` / `verb` / `waitFor` / `check` / `report`; a scenario is a plain
script (live network, child processes and multi-second waits make it an integration probe, not a
unit test).

`report()` exits **1 on zero checks**, not 0. Directory discovery means a scenario that quietly
stops asserting — an early return, a `check` behind a branch that no longer runs — is still
discovered and would otherwise report `0/0 checks passed` as a green line. Proving nothing is a
failure to prove. (`cli/scenarios/harness.test.ts` pins that, and runs under `npm test`.)

## Against the BROWSER

`e2e/cliVsBrowser.spec.ts` (Playwright) plays a real daemon against the real browser app over the
same relay — design §8's other half, and the only place the two implementations meet. It starts the
daemon through this same `harness`, so it cannot drift into testing a different client. Run it with
`npx playwright test e2e/cliVsBrowser.spec.ts`; with no broker egress it is a genuine skip.

## Config / env overrides

Relay resolution lives in `src/config/relayEnv.ts` and is shared with the `*.realrelay.test.ts`
vitest suites, so `pente` and `npm test` cannot disagree about which broker they mean: environment
variable → the tracked `src/config/defaults/relay.json` → the live deployed relay. Override any of:

| var | purpose |
|-----|---------|
| `PENTE_WSS_URL` / `PENTE_USERNAME` / `PENTE_PASSWORD` / `PENTE_TOPIC_ROOT` | relay endpoint + creds + topic root |
| `PENTE_BOARD_SIZE` | board edge length (default 5) |
| `PENTE_PLAYER_ID` | seat identity (default: persisted in `.pente-cli/playerid`) |
| `PENTE_STATE_DIR` | runtime dir for socket + playerid (lets two CLIs co-exist) |

A Unix socket path is capped at ~104 bytes, so in a deeply-nested checkout the default
repo-relative `.pente-cli/` can overflow it — the daemon says so and tells you to point
`PENTE_STATE_DIR` somewhere shorter (e.g. `/tmp/pente-abcde`) rather than silently binding a
truncated path that no verb can find.

Requires the repo's dev deps installed (`npm install`); runs via `tsx`, no build step.
