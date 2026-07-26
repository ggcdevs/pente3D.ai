import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { probedGameUuid } from './roomProbe';
import {
  toSyncMessage,
  toHelloMessage,
  toAdmitMessage,
  toAdoptAdmitMessage,
  toRejectMessage,
  parseGameMessage,
} from './sync';
import {
  deferProposal,
  newProposal,
  resumeProposal,
  currentProposal,
} from './admission';
import { Game } from '../core/game';
import { headHash } from '../core/eventLog';
import type { SeatMap } from './seats';

/**
 * Task V.5 (epic #47, design §6) — the PURE reading a boot-time room PROBE makes of what it overhears.
 *
 * The probe claims nothing: it listens, and whatever it concludes goes straight into the §6 offer
 * (`rejoinPromptModel`). Two answers are therefore load-bearing in OPPOSITE directions, and this suite
 * pins both:
 *
 *  - a message that DOES name a game must yield that uuid — otherwise a peer sitting on OUR game is
 *    reported as silent and the card degrades to the weaker `peer-silent` copy;
 *  - a message that names NO game must yield `null` — otherwise a stranger's game (or a fragment of
 *    protocol traffic) is read as a named game and the card can offer a rejoin into someone else's
 *    room, the one outcome design §6 forbids.
 *
 * Every assertion is on the returned value for a REAL wire message built by the same `sync.ts`
 * constructors the session publishes — never on a log line (agent-principles #3).
 */

const SEATS: SeatMap = { white: 'player-a', black: null };

/** A real game with history, so its `sync` payload carries a genuine uuid + log. */
function playedGame(uuid: string): Game {
  const g = new Game(9, uuid);
  g.place([4, 4, 4]);
  g.place([4, 4, 5]);
  return g;
}

/** A message as it arrives at a listener: the plain JSON record the transport delivers. */
function onWire(msg: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(msg)) as Record<string, unknown>;
}

describe('probedGameUuid — messages that NAME the game being played', () => {
  it('reads a resident republish (`sync`) as the uuid of the game it carries', () => {
    const game = playedGame('the-live-game');
    expect(probedGameUuid(onWire(toSyncMessage(game.log)))).toBe('the-live-game');
  });

  it('reads an UN-KINDED legacy sync (the pre-union envelope) too — same answer', () => {
    // `parseGameMessage` treats an un-kinded payload as a sync (sync.ts), so a peer on an older build
    // still names its game to a probe. Asserted through the same public seam a listener uses.
    const wire = onWire(toSyncMessage(playedGame('older-build-game').log));
    delete wire.kind;
    expect(parseGameMessage(wire).kind).toBe('sync');
    expect(probedGameUuid(wire)).toBe('older-build-game');
  });

  it('reads a `hello` seeded RESUME as the uuid its proposal names (a peer mid-entry, no log yet)', () => {
    const game = playedGame('the-resumed-game');
    const hello = toHelloMessage(
      'h1',
      'player-b',
      resumeProposal(game.uuid, headHash(game.log)),
      SEATS,
      0,
    );
    expect(probedGameUuid(onWire(hello))).toBe('the-resumed-game');
  });

  it('reads a `hello` seeded CURRENT the same way (provenance differs, identity does not)', () => {
    const game = playedGame('the-current-board');
    const hello = toHelloMessage(
      'h2',
      'player-b',
      currentProposal(game.uuid, headHash(game.log)),
      SEATS,
      0,
    );
    expect(probedGameUuid(onWire(hello))).toBe('the-current-board');
  });
});

describe('probedGameUuid — messages that name NO game (the `peer-silent` arm, negative cases)', () => {
  it('a `hello` seeded NEW names nothing — it is asking for a game, not announcing one', () => {
    const hello = toHelloMessage('h3', 'player-b', newProposal(), SEATS, 0);
    expect(probedGameUuid(onWire(hello))).toBeNull();
  });

  it("a `hello` seeded DEFER names nothing — dealer's choice announces no identity", () => {
    const hello = toHelloMessage('h4', 'player-b', deferProposal(), SEATS, 0);
    expect(probedGameUuid(onWire(hello))).toBeNull();
  });

  it('an `admit` carrying an agreed game is protocol traffic, not a claim about the room', () => {
    // Deliberate: the admit's payload DOES contain a uuid, and reading it would make a probe report a
    // game from an exchange between two other peers. The `sync` that follows an admission is what
    // names the room's game.
    const game = playedGame('agreed-elsewhere');
    const admit = toAdmitMessage('a1', 'player-c', toSyncMessage(game.log), SEATS);
    expect(probedGameUuid(onWire(admit))).toBeNull();
    const adopt = toAdoptAdmitMessage('a2', 'player-c', 'newcomers-game', SEATS);
    expect(probedGameUuid(onWire(adopt))).toBeNull();
  });

  it('a `reject` names no game', () => {
    expect(probedGameUuid(onWire(toRejectMessage('r1', 'player-c', 'room-full')))).toBeNull();
  });

  it('an out-of-band proposal / response names no game', () => {
    expect(
      probedGameUuid({ kind: 'proposal', id: 'p1', action: 'rematch', proposedBy: 'white' }),
    ).toBeNull();
    expect(probedGameUuid({ kind: 'response', proposalId: 'p1', accepted: true })).toBeNull();
  });

  it('MALFORMED junk on the publicly-writable relay is an absence of information, not a throw', () => {
    // Each of these makes `parseGameMessage` throw a SyncError; a probe must absorb that as "this said
    // nothing" — while an ENTERING session still rejects it loudly (asserted on the same input).
    const junk: unknown[] = [
      { kind: 'gibberish' },
      { kind: 'sync', version: 1 }, // a sync missing its log/uuid
      { kind: 'hello', id: 'h', playerId: 'p' }, // a hello missing its proposal
      { kind: 'hello', id: 'h', playerId: 'p', proposal: { kind: 'resume' } }, // seed with no uuid
      'not even an object',
      42,
      null,
    ];
    for (const bad of junk) {
      expect(() => parseGameMessage(bad)).toThrow();
      expect(probedGameUuid(bad as Record<string, unknown>)).toBeNull();
    }
  });
});

describe('probedGameUuid — properties', () => {
  it('a `sync` ALWAYS reports its own log uuid, for any game identity', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (uuid) => {
        expect(probedGameUuid(onWire(toSyncMessage(playedGame(uuid).log)))).toBe(uuid);
      }),
    );
  });

  it('NEVER invents an identity: what it returns is a uuid the message itself carries, or null', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom('sync', 'resume', 'current', 'new', 'defer'),
        (uuid, kind) => {
          const game = playedGame(uuid);
          const msg =
            kind === 'sync'
              ? toSyncMessage(game.log)
              : toHelloMessage(
                  'h',
                  'player-b',
                  kind === 'resume'
                    ? resumeProposal(uuid, headHash(game.log))
                    : kind === 'current'
                      ? currentProposal(uuid, headHash(game.log))
                      : kind === 'new'
                        ? newProposal()
                        : deferProposal(),
                  SEATS,
                  0,
                );
          const named = probedGameUuid(onWire(msg));
          // Either the message's OWN game, or an honest silence — never some third value.
          expect(named === uuid || named === null).toBe(true);
          // And silence happens exactly for the two seeds that carry no identity.
          expect(named === null).toBe(kind === 'new' || kind === 'defer');
        },
      ),
    );
  });
});
