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

## Config / env overrides

Defaults target the live deployed relay. Override any of:

| var | purpose |
|-----|---------|
| `PENTE_WSS_URL` / `PENTE_USERNAME` / `PENTE_PASSWORD` / `PENTE_TOPIC_ROOT` | relay endpoint + creds + topic root |
| `PENTE_BOARD_SIZE` | board edge length (default 5) |
| `PENTE_PLAYER_ID` | seat identity (default: persisted in `.pente-cli/playerid`) |
| `PENTE_STATE_DIR` | runtime dir for socket + playerid (lets two CLIs co-exist) |

Requires the repo's dev deps installed (`npm install`); runs via `tsx`, no build step.
