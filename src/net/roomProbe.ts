/**
 * PURE room-PROBE reading (Task V.5, epic **#47**, design §6) — what an overheard room message tells a
 * boot-time probe about the game being played there.
 *
 * A reload lands on an EMPTY SLATE, so before offering a way back into the room the `activeNetworkedGame`
 * breadcrumb names, the app takes a NON-COMMITTAL look at it (`NetSession.probeRoom`): it publishes no
 * admission message and claims nothing, it only listens. This module is the decision that listening
 * comes down to — which is a total function from a wire message to a game identity, so it lives here,
 * unit + mutation gated, rather than inside the transport glue that supplies the messages.
 *
 * The probe's answer feeds the PURE `ui/widgets/rejoinPromptModel.ts`, whose `peer-silent` arm exists
 * precisely for "someone is there but named no game" — so a message this module reads as `null` is not
 * an error, it is one of the four §6 outcomes. Getting that wrong in either direction is the failure
 * design §6 forbids: naming a stranger's game as ours (a hijack), or reporting silence from a peer that
 * did say which game it is on.
 *
 * THREE-free / DOM-free / transport-free: it takes the plain wire record and returns a uuid or `null`.
 * The IO half (building a throwaway transport, listening for a window, disconnecting) is
 * `NetSession.probeRoom`, proven over the MockTransport in `session.test.ts` and end-to-end in
 * `e2e/rejoinPrompt.spec.ts`.
 */

import { parseGameMessage, type GameMessage } from './sync';
import type { TransportMessage } from './transport';

/**
 * The game UUID an overheard room message names, or `null` when it names none.
 *
 * Exactly two message kinds carry a game identity a probe may trust as "the game someone in this room
 * is on":
 *
 *  - a **`sync`** — the whole authoritative log, so its `uuid` IS the game being played. This is what a
 *    resident republishes in answer to a newcomer's presence (design §4 resident-peer republish, V.3),
 *    and therefore the usual way the room answers a probe;
 *  - a **`hello` whose seed NAMES a concrete game** (`resume`/`current`, design §3) — a peer that is
 *    mid-entry has no authoritative log yet, but its proposal already says which game it brought.
 *
 * Everything else is `null`, and each for a stated reason rather than as a catch-all:
 *
 *  - a `hello` seeded `new`/`defer` names no game (it is asking for one, or leaving the choice open);
 *  - an `admit`/`reject`/`proposal`/`response` is protocol traffic ABOUT an entry, not a claim about
 *    which game is being played — the `sync` that follows an admission is what names it;
 *  - an unparseable publish tells us nothing. The relay is PUBLICLY WRITABLE, so junk on the topic is
 *    expected; for a probe it is simply an absence of information, never a failure (an entering
 *    session validates the same traffic strictly, and rejects it loudly). Nothing is masked here: no
 *    error was raised at us — we overheard a message that says nothing.
 */
export function probedGameUuid(msg: TransportMessage): string | null {
  let parsed: GameMessage;
  try {
    parsed = parseGameMessage(msg);
  } catch {
    return null;
  }
  if (parsed.kind === 'sync') return parsed.uuid;
  if (parsed.kind !== 'hello') return null;
  const seed = parsed.proposal;
  return seed.kind === 'resume' || seed.kind === 'current' ? seed.uuid : null;
}
