# Networking UX Batch — mini-plan

- **Date:** 2026-07-21
- **Status:** Design locked with user; ready to build (after the maintainer verifies the menu batch on /dev/).
- **Issues:** #12 (win/rematch flow), #18 (networked undo/redo handshake), #17 (history slider stays local),
  #20 (reconnect on background/return + move notifications).
- **References:** `planning/agent-principles.md`, `planning/2026-07-18-networking-poc-design.md`
  (append-only log, Transport, sticky playerId seats, LWT presence), `GLOSSARY.md`, `docs/diagrams/`.
- **Net-layer map (this session):** messages are a single fixed-shape `SyncMessage` (no type union);
  `rematch.ts` has one-sided predicates only; the win prompt is a blocking `window.confirm` (`main.ts:45`);
  undo is append-as-event, restricted to your-own-last-move (`decideUndo`, `sync.ts:126`); the history
  slider is ALREADY purely local (`scrubTo` is a read-only render seam); there is NO reconnect /
  visibilitychange / notification code today.

## Goal

The shared thread: **build one ask/accept handshake primitive and reuse it for rematch (#12) and
undo/redo (#18).** Plus reconnect + notifications (#20), and lock in the already-local history slider (#17).

## Design decisions (locked)

1. **Shared handshake primitive.** New message kinds in a **tagged union in `sync.ts`**
   (`kind: 'sync' | 'proposal' | 'response'`) — no transport changes. Proposals are held
   **out-of-band (in memory / session state), NOT appended to the log** until accepted (the log is
   append-only, so a rejected proposal must leave no trace). Published **non-retained** + carry a
   **unique id** (dedup on receive) so a reconnect never replays a stale proposal. **Auto-cancel** a
   pending proposal if the game state advances (a move lands) or the proposer disconnects. Who-may-
   propose-what is a **pure predicate** over `GameState`/seat/`myColor` (like `decideUndo`).
2. **#12 rematch — mutual + non-blocking.** Replace the blocking `window.confirm` (`main.ts:45`) with a
   **view-only end-state overlay** (result + read-only won board). Either player proposes "Rematch";
   the other accepts/declines via the handshake; on mutual accept **both reset to a fresh game in the
   same room/connection** (no disconnect/re-host). **Colors ALTERNATE every game** (swap white/black
   each rematch, regardless of who won) — a deterministic seat reassignment.
3. **#18 undo/redo — single-step, mutual confirm.** Undo proposes rolling back the **last** move
   (proposer = the last mover, per `decideUndo`); opponent confirms → both roll back one. **Redo**
   (re-apply an undone move) works the **same way** via a proposal. One step at a time. Held out-of-band
   until accepted (do not append the undo/redo event until both agree).
4. **#17 history slider stays local.** Already local — this is **verify-and-lock**: a test proving a
   scrub in a NETWORKED game issues **zero** transport publishes, plus a guard/comment so it can't
   regress. Minimal.
5. **#20 reconnect + notifications.** **Auto-reconnect** on `visibilitychange`→visible and `online`
   when the session is offline (re-join same code, reclaim sticky seat). **Move notifications** when the
   opponent moves and it's your turn: **tab-title flash** (`document.title`, no permission) + **browser
   Notification API** (opt-in, one-time permission, fires when the tab's hidden). **No banner pulse** —
   the banner keeps showing whose turn it is as it does today. All notification channels **config-driven**
   (sensible defaults; browser-notification off until permission granted).

## Guardrails (from the net-layer map — landmines)

- **Retained-message replay:** proposals MUST be non-retained + unique-id deduped, or a reconnect
  re-fires a stale proposal.
- **Append-only log:** never append a proposed undo/rematch until accepted; hold it out-of-band.
- **Disconnect mid-handshake:** on reconnect, re-propose if still valid; **cancel if the game advanced**.
- **Test against BOTH transports:** `MockTransport` (unit/e2e speed) AND the real relay (retention +
  latency + reorder) — the real-relay two-browser spec is the integration proof (self-skips without creds).
- `src/core` stays pure; handshake permission logic is pure; the SyncEngine/session wiring is the glue.

## Build steps

Test tier: *pure* = Vitest unit + fast-check + Stryker mutation (100% coverage pin); *glue* =
Playwright on the real app (`window.__pente` + screenshots; networking asserts the OTHER client
receiving over the relay), never log lines.

| # | Step | Key files | Tier |
|---|---|---|---|
| N.1 | **Handshake primitive** — `sync.ts` tagged union (`proposal`/`response`), out-of-band pending-proposal state machine (propose/accept/decline/auto-cancel/dedup), pure permission + dedup logic. | `src/net/sync.ts`, `src/net/session.ts`, a pure `handshake` module | pure core + glue |
| N.2 | **#12 win/rematch** — end-state overlay widget (replaces `window.confirm`), mutual rematch via N.1, alternate colors on reset. | `src/main.ts`, `src/net/rematch.ts`, `src/net/seats.ts`, a new `endState`/rematch widget (+model), `src/ui/*` | model pure + glue |
| N.3 | **#18 undo/redo** — mutual-confirm undo+redo (single-step) via N.1; `decideUndo`/`decideRedo` pure gates; UI to propose + a prompt to accept. | `src/net/sync.ts`, `src/core` undo/redo, undo/redo command + prompt widget | pure + glue |
| N.4 | **#17 history-local lock** — a test proving a networked scrub publishes nothing; guard/comment. | `e2e/*`, `src/ui/widgets/historySlider.ts` (guard only) | glue |
| N.5 | **#20 reconnect + notifications** — visibilitychange/online auto-reconnect; title-flash + browser Notification (config-driven); is-remote-move / is-my-turn pure decisions. | `src/net/session.ts`/`appSession.ts`, a pure notify-decision module, `src/net/defaults` config | pure + glue |

## Sequencing

- **N.1 first** (the shared primitive) → **N.2 + N.3** consume it → **N.4** (independent, small) →
  **N.5** (independent). Each shippable to /dev/ for hands-on.
- **Cross-component integration:** a two-browser e2e per handshake consumer (rematch, undo) proving the
  proposal→accept→both-apply round-trip over the relay, and that it bites if the wiring breaks.

## Collaboration points

- End-state overlay look (#12) and the undo/redo prompt UX — best-effort, then tweak live on /dev/.
- Browser-notification copy + when to request permission (#20).

## Verification (per gate)

Build (tsc+vite) 0 · lint 0 · coverage 100% on pure files · mutation ≥ threshold on the pure handshake /
decision logic · Playwright green incl. the two-browser handshake proofs · every gate proven to bite ·
independently re-run, flaky metrics ≥2×.
