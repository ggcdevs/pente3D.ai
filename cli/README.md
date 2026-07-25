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
- **Thin verbs** (`show`, `move`, `wait`, `status`, `undo`, `redo`, `quit`) connect to
  that socket, do one thing, and exit — ideal for scripting.

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
npm run scenario:issue45     # issue #45: does a reconnect converge to the live game?
SCENARIO_VERBOSE=1 npm run scenario:issue45   # …and tee both daemons' live boards
```

Exit code 0 = every check passed. **`scenario:issue45` fails on purpose today** — it is the
repro for the reconnect-resync bug and turns green when the v3.1 remodel lands.

Writing another: `harness.ts` gives you `startPeer` / `verb` / `waitFor` / `check` / `report`;
a scenario is a plain script (live network, child processes and multi-second waits make it an
integration probe, not a unit test).

## Config / env overrides

Defaults target the live deployed relay. Override any of:

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
