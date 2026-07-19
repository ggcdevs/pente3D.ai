# Networking POC Design — MQTT Relay

- **Date:** 2026-07-18
- **Status:** Approved, ready for implementation
- **Branch context:** `rewrite2` (orphan / clean slate). Working only from
  `planning/basic-wants.md` and `planning/user-stories.md`. All prior branches
  (`broken-diagonals`, `broken-diagonals-v2`, `lan-capability`, `rewrite`) and any
  staged `src/`/`planning/phase/` material are treated as abandoned reference, not
  canonical.

## Purpose

Prove — with a small, deliberately throwaway build — that **two browsers on arbitrary
separate networks can reliably exchange data and converge on a shared JSON object**,
with **no paid infrastructure**. This de-risks the single feature that killed the two
prior iterations (networking). Only one artifact survives the POC: the `Transport`
interface and its `MqttTransport` implementation.

## Why not WebRTC / PeerJS (the prior approach)

The prior attempts used PeerJS and "couldn't establish links between different
computers." Root cause: PeerJS is a signaling broker + WebRTC. WebRTC opens a *direct*
peer-to-peer link, which is impossible when both peers sit behind symmetric NAT / CGNAT
(common on home + mobile ISPs) unless a **TURN relay** is added — which the free PeerJS
broker does not provide. It "sometimes worked" (one friendly NAT) and failed across
restrictive networks.

Why native P2P apps (BitTorrent/ZeroNet) *feel* like they "just work" while a 2-browser
game does not:

1. **Swarm redundancy** — a torrent needs only *some* of hundreds of peers; failures are
   invisible. A 2-player game needs *the one specific peer*, so any failure is total.
2. **Native apps can become directly connectable** — they open listening sockets and
   auto-forward a port via UPnP/NAT-PMP. A browser **cannot** (no listening sockets, no
   inbound), so both browsers are permanently stuck on the "must dial out" side — the
   hardest NAT case.
3. **Rich fallbacks** (TCP + µTP, DHT, PEX, relays); WebRTC-by-default ships only STUN, so
   a failed punch has nowhere to go.

WebRTC uses the *same* UDP hole-punching as a torrent; it is not worse at punching. It
just has no swarm and no way to be the connectable side. Hole-punching succeeds ~80% in
the wild; the failing ~20% (symmetric/CGNAT) is exactly where a 2-browser game lands with
nothing to fall back on.

**Conclusion:** for a turn-based game (a few bytes every few seconds), WebRTC's only
payoff — low-latency P2P, zero server bandwidth — is worthless, while its only cost — NAT
traversal — is the exact thing that keeps failing. A relay where both clients connect
**outbound** over `wss://` sidesteps NAT entirely: outbound HTTPS/WSS works from behind
every NAT and firewall.

## Decision: MQTT relay (Mosquitto) on shitchell.com

A pure relay on a self-hosted box. Chosen over TURN and a hand-rolled WebSocket relay:

- **TURN rejected** — it only relays WebRTC/ICE traffic, so it *keeps* the whole
  WebRTC + PeerJS stack and *still* needs a separate signaling/matchmaking server; it does
  not do rooms itself. More moving parts, not fewer. (Prior setup attempt reportedly had
  issues, consistent with this complexity.)
- **Hand-rolled WS relay rejected** — simplest to reason about, but it is our code to
  maintain (reconnection, robustness). Bar was an *established, reliable* protocol.
- **MQTT/Mosquitto chosen** — ISO-standard pub/sub, decades in production, `apt install`
  + config (zero server code we write), rooms = topics (arbitrary concurrent games),
  retained messages = free state-on-join, Last-Will-and-Testament = free disconnect
  detection. NATS was the honorable-mention alternative.

The broker is a **pure relay**: it forwards opaque JSON on topic strings and knows
**nothing** about Pente. Retention, presence, and delivery are generic MQTT features. No
conflict resolution or game logic on the server.

## Architecture

```
Browser A ──wss──┐                              ┌──wss── Browser B
                 ▼                              ▼
        nginx (443, TLS, existing Let's Encrypt) reverse-proxy
                 │  location /<obscured>-mqtt  →  127.0.0.1
                 ▼
        Mosquitto broker (localhost-only, dumb pub/sub)
        topics: pente/poc/{roomCode}[, /state, /presence/{peerId}]
```

Both browsers connect **outbound** over `wss://` — no NAT, no hole-punching, works from
any network including cellular.

### The keeper artifact — `Transport`

The only durable output of the POC. The real game codes against these five methods; MQTT
can later be swapped for anything (Firebase, Trystero, etc.) without touching game logic.

```ts
interface Transport {
  connect(roomCode: string): Promise<void>
  publish(msg: unknown): void            // fire a JSON message to the room
  onMessage(cb: (msg) => void): void     // receive peers' messages
  onPresence(cb: (peers) => void): void  // who's in the room right now
  disconnect(): void
}
```

`MqttTransport` implements it with `mqtt.js`.

### Sync model — append-only log, entirely client-side

Clients do **not** overwrite a shared blob. Each peer **appends events to an ordered log**
and derives state by replaying it — conflict-free by construction, and exactly how the
real game (deterministic `placePiece` + history) will work. The POC event is trivial
(`{by, seq, payload}` incrementing a counter); the machinery is the keeper. The broker
never sees this as anything but opaque JSON.

## Server setup

- **Install:** `apt install mosquitto` (systemd service; nothing custom to write).
- **TLS/WSS:** **reverse-proxy via existing nginx** (already terminates TLS with Let's
  Encrypt on shitchell.com). Mosquitto listens plain-WS on `127.0.0.1`; nginx exposes
  `wss://shitchell.com/<obscured>-mqtt` and reuses the existing cert + auto-renewal.
- **Auth:** **not anonymous.** `allow_anonymous false` + one shared username/password
  (`password_file`). An open broker gets scanner-hammered within minutes. Game-code-scoped
  ACLs are a later production concern.
- **Topics** (opaque to broker):
  - `pente/poc/{roomCode}` — peers publish log events.
  - `pente/poc/{roomCode}/state` — **retained** full-state snapshot; joiner/refresher gets
    current state instantly.
  - `pente/poc/{roomCode}/presence/{peerId}` — presence via MQTT **LWT**: each client
    registers an "offline" will on connect, so the broker auto-announces a drop →
    "opponent disconnected" (user story 20) for free.

### Port / abuse hardening

Stay on **443** — do *not* move to a non-standard public port. With the reverse-proxy the
broker is not internet-exposed at all (localhost-only), so classic MQTT-port scanning is
already defeated. A non-standard port is security-through-obscurity (mass scanners sweep
all ports anyway) *and* would hurt reachability: locked-down networks (corporate, some
cellular, captive portals) often allow only 80/443 outbound — the exact networks we want
to prove. Better levers, all at the exposed nginx layer:

- **Obscure the path** (`/a8f3k-mqtt`, not `/mqtt`) — same obscurity, zero reachability cost.
- **nginx `limit_req`** rate-limiting on that location.
- **Shared password** as the real control.

## Throwaway UI & the proof

A deliberately ugly ~single `index.html`, **hosted on GitHub Pages** (throwaway included —
this proves the real deployment path: static HTTPS page → `wss://` relay).

UI: room-code box + Connect; presence dot ("opponent: online/offline"); shared-state
readout (derived counter + raw JSON log); `[+1]` button; own peerId.

Behavior (all client-side): connect → subscribe to events/state/presence, register LWT,
publish "online". `[+1]` → append event to local log, publish event, write full derived
state to retained `/state`. Receive event → append, re-derive, re-render.

### Test — definition of "proven"

1. Open on **two devices on genuinely different networks** — laptop on home wifi **+ phone
   on cellular** (CGNAT: the exact case that killed WebRTC). Same room code.
2. Both show **"opponent: online."**
3. `[+1]` on A appears on B in ~1s; `[+1]` on B appears on A. *(bidirectional)*
4. **Refresh B** → instantly reloads current state from the retained snapshot.
   *(state-on-join)*
5. **Kill B's network** → A flips to **"opponent: offline"** within the keepalive window.
   *(LWT disconnect)*
6. Bonus: repeat once on a locked-down network (corporate wifi / captive portal) to
   confirm 443 reachability.

**Proven = steps 1–5 pass across two real separate networks.** Then delete the UI and keep
only `Transport` + `MqttTransport`.

---

## Decision log (settled rulings, with rationale)

Captured per the user's rationale-capture preference; quotes are the user's own words.

### Networking: relay over P2P; MQTT/Mosquitto; pure relay
- **Status:** Accepted.
- **Context:** `rewrite2`, 2026-07-18. Two prior iterations failed on PeerJS. User owns
  shitchell.com (passwordless sudo/ssh) with nginx + Let's Encrypt already in place.
- **Rationale (user):** "our main wants are to simply have two devices on arbitrary
  separate networks able to play together without any paid infra (ideally minimal infra,
  low/no setup)"; "it could be any other established, reliable relay protocol as long as it
  workks between browsers and arbitrary numbers of clients connected playing separate
  games"; "we will leave the shitchell server as pure relay, no conflict stuffs. it knows
  nothing about pente."; "yeah! let's use MQTT for our POC".
- **Modularity constraint (user):** conflict resolution — "i'm good with either. conflict
  resolution would be nice. if we don't build that now we should at least make it modular
  enough to drop in with 0 heavy refactoring later." → satisfied by the client-side
  append-only move-log + swappable `Transport`.

### Camera controls: Fusion 360 presets + full config system
- **Status:** Accepted. Supersedes the contradictory bindings in `user-stories.md` Story 3
  and the single binding in `basic-wants.md:35`.
- **Decision:** Ship **selectable control presets** (Fusion 360 default = pan on
  middle-drag, zoom on scroll, orbit on Shift+middle-drag; plus a **web-friendly default
  preset**, since middle-mouse is awkward in browsers). Controls fully configurable via a
  **repo-tracked JSON** (defaults the game loads) **overridden by localStorage**. Touch /
  two-finger pan to be added for a later mobile pass.
- **Rationale (user):** "i'd prefer if we could customize the controls -- both via a config
  json tracked in the repo that the game loads for defaults and via localStorage which
  provides parallel config overrides. a mobile version will be tested later, but we'll also
  want to be able to drop in touch / two finger pan controls there." General principle:
  "i like all the modularity and all the config. no magic values, tracked json for
  defaults, localStorage to override."

### Capture win condition: 5 pairs
- **Status:** Accepted. Resolves the Story 5 title/body ambiguity.
- **Decision:** Winning by capture = **5 captured pairs** (10 opponent pieces). Treat "5 or
  more" only as a defensive guard against an over-count bug.
- **Rationale (user):** "yeah lol, we want 5 pairs. ignore any ambiguity. capturing 5 pairs
  is a win. i think in one of the iterations we said 5 or more as a soft catch in case some
  bug put us at more than 5 captures. but 5 pairs is a win".

### Keyboard shortcuts: add `?` help modal
- **Status:** Accepted. `basic-wants.md:12-22` shortcut list is authoritative and correct.
- **Decision:** Add `?` to open a keyboard-shortcut modal. Finish the truncated Story 23 to
  reference the `basic-wants` list rather than restate it.
- **Rationale (user):** "the basic wants looks correct upon review. i'd simply add an extra
  '?' to show a keyboard shortcut modal".

### Chat: cut
- **Status:** Accepted (removed as scope creep).
- **Decision:** Drop the "chat or communication features" line from Story 20.
- **Rationale (user):** "we can nix chat".

## Future flex points — v1 designs around these, does not build them

Raised 2026-07-18: eventually each room should be **limited to 2 players**, possibly
gated by a **room password**. Not a v1 feature, but **v1 must be architected so these drop
in with zero heavy refactoring** (consistent with the earlier conflict-resolution
constraint and the general modularity principle).

The relay stays **dumb**, so enforcement lives above it. Two escalating levels, both
non-breaking if the seams below exist:

- **Level 1 — cooperative, relay stays dumb (likely enough for friends):**
  - **Room password via topic derivation** — fold the password into the room identity:
    `topic = f(roomCode, password)` (e.g. a hash). Without the password you can't even
    *derive* the topic, so you can't join. No broker change.
  - **2-player cap via presence policy** — the app already tracks room presence; a small
    `RoomPolicy` layer rejects a 3rd joiner (client refuses to start / marks them
    spectator). Cooperative (a hostile client could ignore it), which is fine for the
    friendly-play threat model.

- **Level 2 — enforced, swap the transport (if we ever need real enforcement):**
  - Replace `MqttTransport` with a `RelayTransport` that first calls a tiny matchmaking
    service (capacity check, password auth, issues a short-lived token). **No game-logic
    change** — it's all behind the `Transport` seam.

### Seams v1 MUST reserve now (cheap, non-functional in v1)

1. **All networking behind `Transport`** — game code never sees topics/broker (already true
   in the POC). This is the master seam that makes Level 2 a swap.
2. **`connect(roomCode, opts?)`** — widen the signature to accept `{ password? }` now, even
   though v1 ignores it. Callers won't change when it starts mattering.
3. **`roomTopic(roomCode, opts?)`** — a single function that maps room identity → topic, so
   password-into-topic (Level 1) is a one-function change, not a caller sweep.
4. **Explicit room membership / seat model** — represent players as up to 2 **seats**
   (black/white) plus spectators, derived from presence. v1: everyone's a player. Future:
   seat assignment + "room full" rejection is a policy on top, not a data-model rewrite.

### Seat & reconnection model (raised 2026-07-18)

**v1 direction — identity-owned sticky seats.** Chosen over pure positional slots because
it makes network drops/refreshes a non-event (the stated goal). Base rules:

- Two seats, **white / black**. First joiner → white; second → black (first-available,
  white-preferred).
- Seats are **owned by a persistent `playerId`** (localStorage, survives refresh +
  reconnect), not by position. On join: if your `playerId` already owns a seat → **reclaim
  it** (same seat, same color); else take the first free seat; else **reject**.
- A player leaving frees their seat for a new owner; a **3rd distinct player is rejected**
  (spectator is a trivial future toggle the model already affords).
- Seat map lives in the **shared retained state** (dumb relay stays dumb).

**Deferred flex points (handle as need arises — user: "we'll handle those cases later as
need arises ... add those as design flex points"):**

- **Grace window** — mark a dropped seat *vacant-but-reserved* for its owner for ~30–60s
  before it opens to a new joiner (prevents seat theft during a wifi blip).
- **Color-swap protection** on double-rejoin (both players drop, rejoin in swapped order) —
  falls out of identity ownership once grace/reclaim exists.
- **Simultaneous-claim tiebreaker** — two clients grabbing the same free seat at once:
  deterministic resolution (earlier timestamp, then lower `playerId`; loser re-evaluates).
  Rare with 2 players.
- **Spectator mode** — admit extra joiners as read-only instead of rejecting.

v1 builds the base rules; the deferred items must remain drop-in (they all sit on the
`playerId` + seat-map-in-shared-state foundation, so no rewrite).

## Open items for the next design pass (non-POC)

Flagged during review of the planning docs; to discuss when we move past networking
("on this and any other code stuffs, let's discuss"):

- The `generateFullLine` / `generatePartialLine` line-generation API + validations
  (`basic-wants.md:2-10`) — the most-emphasized item ("trouble in V1 with diagonals"),
  currently has no user story.
- `placePiece(coordinates)` returning an updated `GameState` or throwing, and a `Game`
  class tracking history (`basic-wants.md:39-41`) — core architecture for tests, AI/LLM,
  and networking.
- 26-direction Moore-neighborhood mesh (`basic-wants.md:1`) as a stated foundational
  requirement.
- Static GitHub Pages hosting (`basic-wants.md:43`) as an explicit non-functional
  constraint.
- De-dupe Story 17 vs Story 22 (identical "configurable board size").
