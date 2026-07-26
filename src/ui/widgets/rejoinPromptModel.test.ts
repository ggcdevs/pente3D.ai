import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  deriveRejoinPrompt,
  HIDDEN_REJOIN_PROMPT,
  type RejoinProbe,
  type RejoinPromptView,
} from './rejoinPromptModel';

/**
 * Task V.5 (epic #47) — the PURE rejoin-prompt view-model (design §6 "Reload & rejoin flow").
 *
 * A tab reload lands on an EMPTY SLATE, so this prompt is the ONLY thing that offers a way back into
 * a game that was in progress. That makes two properties load-bearing, and they are what this suite
 * is about:
 *
 *  1. **It only ever OFFERS.** Every arm produces a question with a decline, never an action. The
 *     three §6 outcomes are distinguished by what they offer, and the "someone else is in that room
 *     on another game" arm must NOT offer to rejoin at all — hijacking a stranger's game is the one
 *     outcome the design names as forbidden.
 *  2. **The colour is DISPLAYED, never negotiated** (design §7 — what keeps #31/#40 shut). The copy
 *     may name a colour ONLY when the game's own seat map derived one for us; with no derived colour
 *     the prompt still offers the rejoin, but says nothing about colour rather than guessing.
 *
 * Plus the quiet arms: no breadcrumb, a stale breadcrumb, or a breadcrumb naming a game this browser
 * does not hold produce NO prompt at all (design §6 "a stale `updatedAt` expires quietly").
 */

/** A valid, canonical room code — the shape `validateGameCode` accepts (6 chars, upper-case). */
const CODE = 'DUDEEE';
const MY_GAME = 'game-uuid-mine';
const OTHER_GAME = 'game-uuid-theirs';

/** A probe with everything believable: a fresh breadcrumb for a game we hold, seated black. */
function probe(over: Partial<RejoinProbe> = {}): RejoinProbe {
  return {
    crumb: { code: CODE, gameUuid: MY_GAME },
    stale: false,
    haveGame: true,
    myColour: 'black',
    peerPresent: true,
    peerGameUuid: MY_GAME,
    ...over,
  };
}

/** Every visible-view string, for "does the copy claim a colour it was not given" assertions. */
function prose(view: RejoinPromptView): string {
  return [view.headline, view.detail, view.confirmLabel, view.declineLabel].join(' ');
}

describe('deriveRejoinPrompt — the QUIET arms (no prompt at all)', () => {
  it('shows NOTHING when there is no breadcrumb (an ordinary empty-slate boot)', () => {
    expect(deriveRejoinPrompt(probe({ crumb: null }))).toEqual(HIDDEN_REJOIN_PROMPT);
  });

  it('shows NOTHING for a STALE breadcrumb — it expires quietly (design §6)', () => {
    // "I am currently mid-game in DUDEEE" stops being a believable claim about a live session; the
    // route back to the game is then the games list, not a prompt about a room nobody is in.
    expect(deriveRejoinPrompt(probe({ stale: true }))).toEqual(HIDDEN_REJOIN_PROMPT);
  });

  it('shows NOTHING when the named game is NOT in this browser (nothing to rejoin with)', () => {
    // The breadcrumb is only a name; the game itself lives in the archive by uuid. Offering to
    // "rejoin" a game we cannot seed would put a claim on the wire we could not honour.
    expect(deriveRejoinPrompt(probe({ haveGame: false }))).toEqual(HIDDEN_REJOIN_PROMPT);
  });

  it('the hidden view is inert — no outcome, no action, no code, no copy', () => {
    expect(HIDDEN_REJOIN_PROMPT).toEqual({
      show: false,
      outcome: null,
      action: null,
      code: '',
      colour: null,
      headline: '',
      detail: '',
      confirmLabel: '',
      declineLabel: '',
    });
  });
});

describe('deriveRejoinPrompt — peer present on the SAME game (design §6 row 1)', () => {
  const view = deriveRejoinPrompt(probe());

  it('offers the rejoin, naming the room and the colour the SEAT MAP derived', () => {
    expect(view.show).toBe(true);
    expect(view.outcome).toBe('same-game');
    expect(view.action).toBe('rejoin');
    expect(view.code).toBe(CODE);
    expect(view.colour).toBe('black');
    expect(view.headline).toBe('Rejoin DUDEEE as Black?');
    expect(view.detail).toBe('Your opponent is there, on the same game.');
    expect(view.confirmLabel).toBe('Rejoin');
    expect(view.declineLabel).toBe('Not now');
  });

  it('names WHITE when that is the colour the game owns for us (the copy follows the seat map)', () => {
    const white = deriveRejoinPrompt(probe({ myColour: 'white' }));
    expect(white.colour).toBe('white');
    expect(white.headline).toBe('Rejoin DUDEEE as White?');
  });

  it('claims NO colour when the game owns none for us — it displays, it never negotiates', () => {
    // Reachable: the game's seat map owns both seats for other playerIds (this browser lost its
    // `pente:playerId`). The rejoin is still offered — admission decides the seat — but the prompt
    // must not invent a colour, which is exactly what keeps #31/#40 shut (design §7).
    const view = deriveRejoinPrompt(probe({ myColour: null }));
    expect(view.show).toBe(true);
    expect(view.outcome).toBe('same-game');
    expect(view.action).toBe('rejoin');
    expect(view.colour).toBeNull();
    expect(view.headline).toBe('Rejoin DUDEEE?');
    expect(prose(view)).not.toMatch(/black|white/i);
  });
});

describe('deriveRejoinPrompt — peer present on a DIFFERENT game (design §6 row 2 — never hijack)', () => {
  const view = deriveRejoinPrompt(probe({ peerGameUuid: OTHER_GAME }));

  it('warns and offers a NEW CODE — it never offers to rejoin', () => {
    expect(view.show).toBe(true);
    expect(view.outcome).toBe('other-game');
    expect(view.action).toBe('new-code');
    expect(view.code).toBe(CODE);
    expect(view.headline).toBe('There is a different game going in DUDEEE.');
    expect(view.detail).toBe(
      'Rejoining would interrupt it. Do you want to restart your last game under a new code?',
    );
    expect(view.confirmLabel).toBe('Use a new code');
    expect(view.declineLabel).toBe('Not now');
  });

  it('reads as news, not as an error', () => {
    // The build plan makes this explicit: the warning "must not sound like an error".
    expect(prose(view)).not.toMatch(/error|fail|refus|invalid|cannot/i);
  });

  it('says nothing about our colour — there is no game of ours to sit down at yet', () => {
    expect(view.colour).toBeNull();
    expect(prose(view)).not.toMatch(/black|white/i);
  });
});

describe('deriveRejoinPrompt — the room is EMPTY (design §6 row 3 — rejoin and wait)', () => {
  const view = deriveRejoinPrompt(probe({ peerPresent: false, peerGameUuid: null }));

  it('says the room is empty and offers to rejoin anyway, as the colour we own', () => {
    expect(view.show).toBe(true);
    expect(view.outcome).toBe('empty-room');
    expect(view.action).toBe('rejoin');
    expect(view.colour).toBe('black');
    expect(view.headline).toBe('You were playing in DUDEEE, but no one is there anymore.');
    expect(view.detail).toBe('Rejoin as Black anyway? You will be waiting there when they come back.');
    expect(view.confirmLabel).toBe('Rejoin');
  });

  it('is the EMPTY-ROOM arm even if a peer had named a game before leaving', () => {
    // `peerGameUuid` is what the probe HEARD; `peerPresent` is who is there NOW. A peer that
    // announced its game and then dropped inside the probe window leaves an empty room, and the
    // offer must describe the room as it is — not as it was a moment ago.
    const gone = deriveRejoinPrompt(probe({ peerPresent: false, peerGameUuid: OTHER_GAME }));
    expect(gone.outcome).toBe('empty-room');
    expect(gone.action).toBe('rejoin');
  });

  it('omits the colour sentence when the game owns no seat for us', () => {
    const view = deriveRejoinPrompt(probe({ peerPresent: false, peerGameUuid: null, myColour: null }));
    expect(view.detail).toBe('Rejoin anyway? You will be waiting there when they come back.');
    expect(prose(view)).not.toMatch(/black|white/i);
  });
});

describe('deriveRejoinPrompt — a peer that has not said which game it is on', () => {
  const view = deriveRejoinPrompt(probe({ peerGameUuid: null }));

  it('offers the rejoin but does not claim the games match', () => {
    // Reachable and honest: a resident answers a fresh presence with its state, but that is a
    // non-retained QoS-0 publish — it can be lost, or the peer may be mid-entry with no game yet. We
    // know someone is there and nothing more, so we say exactly that.
    expect(view.show).toBe(true);
    expect(view.outcome).toBe('peer-silent');
    expect(view.action).toBe('rejoin');
    expect(view.headline).toBe('Rejoin DUDEEE as Black?');
    expect(view.detail).toBe(
      'Someone is in that room, but has not said which game they are playing.',
    );
  });
});

describe('deriveRejoinPrompt — properties over every probe shape', () => {
  /** Arbitrary probe: every believability flag, colour and peer-uuid combination. */
  const anyProbe = (): fc.Arbitrary<RejoinProbe> =>
    fc.record({
      crumb: fc.option(
        fc.record({
          code: fc.constantFrom(CODE, 'M2N7VB', 'ZZZZZZ'),
          gameUuid: fc.constantFrom(MY_GAME, 'other-uuid'),
        }),
        { nil: null },
      ),
      stale: fc.boolean(),
      haveGame: fc.boolean(),
      myColour: fc.constantFrom<'white' | 'black' | null>('white', 'black', null),
      peerPresent: fc.boolean(),
      peerGameUuid: fc.option(fc.constantFrom(MY_GAME, 'other-uuid'), { nil: null }),
    });

  it('a visible prompt always names the breadcrumb\'s OWN room, and a hidden one is inert', () => {
    fc.assert(
      fc.property(anyProbe(), (p) => {
        const view = deriveRejoinPrompt(p);
        if (!view.show) {
          expect(view).toEqual(HIDDEN_REJOIN_PROMPT);
          return;
        }
        // The prompt can only ever be about the ONE room the breadcrumb names — there is no
        // code→game lookup anywhere in this model, so no other code could reach it.
        expect(view.code).toBe(p.crumb!.code);
        expect(view.headline).toContain(p.crumb!.code);
        expect(view.confirmLabel.length).toBeGreaterThan(0);
        expect(view.declineLabel.length).toBeGreaterThan(0);
      }),
    );
  });

  it('is shown EXACTLY when the breadcrumb is believable — fresh, present, and backed by a game', () => {
    fc.assert(
      fc.property(anyProbe(), (p) => {
        const believable = p.crumb !== null && !p.stale && p.haveGame;
        expect(deriveRejoinPrompt(p).show).toBe(believable);
      }),
    );
  });

  it('NEVER offers a rejoin when a present peer is on a DIFFERENT game (no hijack, ever)', () => {
    fc.assert(
      fc.property(anyProbe(), (p) => {
        const view = deriveRejoinPrompt(p);
        if (!view.show) return;
        const hijack =
          p.peerPresent && p.peerGameUuid !== null && p.peerGameUuid !== p.crumb!.gameUuid;
        if (hijack) {
          expect(view.outcome).toBe('other-game');
          expect(view.action).toBe('new-code');
        } else {
          expect(view.action).toBe('rejoin');
        }
      }),
    );
  });

  it('claims a colour in its COPY only when one was derived for us (never invents one)', () => {
    fc.assert(
      fc.property(anyProbe(), (p) => {
        const view = deriveRejoinPrompt(p);
        if (!view.show) return;
        const mentionsColour = /black|white/i.test(prose(view));
        // A colour may be named only when the prompt carries one, and the one it carries is
        // exactly the seat map's — the prompt DISPLAYS a colour, it never negotiates one.
        expect(mentionsColour).toBe(view.colour !== null);
        if (view.colour !== null) {
          expect(view.colour).toBe(p.myColour);
          expect(prose(view).toLowerCase()).toContain(view.colour);
        }
      }),
    );
  });

  it('the outcome is a total, mutually-exclusive classification of the probe', () => {
    fc.assert(
      fc.property(anyProbe(), (p) => {
        const view = deriveRejoinPrompt(p);
        if (!view.show) {
          expect(view.outcome).toBeNull();
          return;
        }
        const expected = !p.peerPresent
          ? 'empty-room'
          : p.peerGameUuid === null
            ? 'peer-silent'
            : p.peerGameUuid === p.crumb!.gameUuid
              ? 'same-game'
              : 'other-game';
        expect(view.outcome).toBe(expected);
      }),
    );
  });
});
