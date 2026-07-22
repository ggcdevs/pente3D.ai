import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  isRemoteMoveForMe,
  deriveMoveNotification,
  shouldReconnect,
  defaultNotificationsConfig,
  YOUR_TURN_BODY,
  YOUR_TURN_TITLE_FLASH,
  type NotificationsConfig,
  type MoveNotification,
} from './notify';
import { initialState, type GameState, type Player } from '../core/gameState';
import { getDefault } from '../config/config';

/**
 * Strict unit + mutation gate for the PURE #20 notify/reconnect decisions (Task N.5.1). These are the
 * DOM-free / transport-free triggers the session GLUE consumes: whether an adopted state change was the
 * OPPONENT's move that made it MY turn (→ a 'your turn' notification), the enumerated notification COPY,
 * and whether a visibility/online edge on a dropped session should trigger a reconnect. Every arm is
 * asserted positive AND negative so no mutant that inverts a comparison, drops a guard, or reads the
 * wrong operand survives.
 */

/**
 * A minimal GameState with `turn` to move and `winner` set. The ply (move-log length) is carried
 * SEPARATELY by the caller — the decision reads it via explicit arguments, not from GameState — so this
 * fixture proves the decision depends on the ply arguments + turn/winner, not on the pieces map.
 */
function state(turn: Player, winner: Player | null = null): GameState {
  return { ...initialState(5), turn, winner };
}

describe('isRemoteMoveForMe', () => {
  it('TRUE: the opponent moved (log grew) and it is now MY turn', () => {
    // I am white. The log grew 3→4 (a placement landed) and after it it is white (me) to move — so the
    // mover was black (the opponent) and it is my turn: the trigger for a 'your turn' notification.
    expect(isRemoteMoveForMe(state('white'), 'white', 3, 4)).toBe(true);
  });

  it('TRUE: symmetric — black is notified when white completes a move making it black to move', () => {
    expect(isRemoteMoveForMe(state('black'), 'black', 2, 3)).toBe(true);
  });

  it('FALSE: MY OWN move (log grew but it is now the OPPONENT to move) does NOT notify', () => {
    // I am white and I just placed: log grew 3→4 but it is now black to move (not me). No self-notify.
    expect(isRemoteMoveForMe(state('black'), 'white', 3, 4)).toBe(false);
  });

  it('FALSE: a non-move change (log did NOT grow) even if it is my turn', () => {
    // A re-emit / conflict-reflection with no new ply: nothing was placed, so nothing to notify — even
    // though it is my turn. Guards against notifying on every session re-emit.
    expect(isRemoteMoveForMe(state('white'), 'white', 4, 4)).toBe(false);
  });

  it('FALSE: the log SHRANK (an undo rolled back a move) does not notify', () => {
    // An adopted undo shortens the log. Not a forward opponent move — no 'your turn'.
    expect(isRemoteMoveForMe(state('white'), 'white', 4, 3)).toBe(false);
  });

  it('FALSE: a remote move that leaves it the OPPONENT still to move (defensive multi-move case)', () => {
    // Standard Pente always alternates turn, so this cannot arise today. But the decision is TOTAL: if a
    // future rule (or a malformed adopted log) grows the log yet leaves it NOT my turn, it is NOT "my
    // turn" and MUST NOT notify. Pinned so the turn===mySeat guard can never silently drop.
    // log grew 3→4 but it is STILL white, and I am black:
    expect(isRemoteMoveForMe(state('white'), 'black', 3, 4)).toBe(false);
  });

  it('FALSE: an opponent move that WON the game does not fire a your-turn notification', () => {
    // The winning move ends the game — that is the end-state overlay's job (#12), not a 'your turn'
    // nudge. Even though the log grew and turn would read as mine, a set winner suppresses it.
    // black just won; turn reads white, I am white:
    expect(isRemoteMoveForMe(state('white', 'black'), 'white', 3, 4)).toBe(false);
  });

  it('FALSE: no seat held (mySeat null) — there is no "my turn" to notify about', () => {
    expect(isRemoteMoveForMe(state('white'), null, 3, 4)).toBe(false);
  });

  it('property: fires exactly iff the log grew, no winner, and it is mySeat to move (seat non-null)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Player>('white', 'black'),
        fc.option(fc.constantFrom<Player>('white', 'black'), { nil: null }),
        fc.option(fc.constantFrom<Player>('white', 'black'), { nil: null }),
        fc.nat({ max: 50 }),
        fc.integer({ min: -3, max: 3 }),
        (nextTurn, winner, mySeat, prevPly, delta) => {
          const nextPly = prevPly + delta;
          const next = state(nextTurn, winner);
          // `nextTurn === mySeat` already subsumes the held-seat check (turn is never null), so the
          // null case falls out here exactly as the impl computes it — the dedicated null test above
          // pins that the no-seat case is false, killing any mutant that widens the turn comparison.
          const expected = nextPly > prevPly && winner === null && nextTurn === mySeat;
          expect(isRemoteMoveForMe(next, mySeat, prevPly, nextPly)).toBe(expected);
        },
      ),
    );
  });
});

describe('deriveMoveNotification', () => {
  const on: NotificationsConfig = { titleFlash: true, browserNotification: true, sound: false };

  it('when NOT triggered: no notification (all channels silent)', () => {
    const result = deriveMoveNotification(false, on, true);
    expect(result).toEqual<MoveNotification>({
      titleFlash: null,
      browserNotification: null,
      sound: false,
    });
  });

  it('when triggered + all channels on + permission granted: title-flash + browser + copy from enum', () => {
    const result = deriveMoveNotification(true, { ...on, sound: true }, true);
    expect(result).toEqual<MoveNotification>({
      titleFlash: YOUR_TURN_TITLE_FLASH,
      browserNotification: { title: YOUR_TURN_TITLE_FLASH, body: YOUR_TURN_BODY },
      sound: true,
    });
  });

  it('title-flash off by config: no flash even when triggered (the other channels unaffected)', () => {
    const result = deriveMoveNotification(true, { ...on, titleFlash: false }, true);
    expect(result.titleFlash).toBeNull();
    expect(result.browserNotification).toEqual({ title: YOUR_TURN_TITLE_FLASH, body: YOUR_TURN_BODY });
  });

  it('browser notification GATED by permission: config on but permission NOT granted → no browser notif', () => {
    // Design #20: browserNotification is on-by-config but only fires once the one-time permission is
    // granted. The pure layer ANDs config.browserNotification with the granted flag.
    const result = deriveMoveNotification(true, on, false);
    expect(result.browserNotification).toBeNull();
    // The title flash needs no permission, so it still fires.
    expect(result.titleFlash).toBe(YOUR_TURN_TITLE_FLASH);
  });

  it('browser notification off by config: no browser notif even WITH permission granted', () => {
    const result = deriveMoveNotification(true, { ...on, browserNotification: false }, true);
    expect(result.browserNotification).toBeNull();
    expect(result.titleFlash).toBe(YOUR_TURN_TITLE_FLASH);
  });

  it('sound flag mirrors config exactly (default OFF) — computed but INERT: no glue plays audio', () => {
    // The PURE decision computes `sound` from `config.sound` (kept in lock-step with the config SSOT), but
    // it is TODO(sound-effect-not-implemented) end-to-end: `NotifyGlue` deliberately does not consume it
    // (no audio player in `src/`). These assertions pin the pure computation only.
    expect(deriveMoveNotification(true, { ...on, sound: false }, true).sound).toBe(false);
    expect(deriveMoveNotification(true, { ...on, sound: true }, true).sound).toBe(true);
    // Never sets the flag when NOT triggered, even with sound configured on.
    expect(deriveMoveNotification(false, { ...on, sound: true }, true).sound).toBe(false);
  });

  it('copy is the enumerated your-turn strings only — no opponent free text (security #20)', () => {
    // The notification body/title derive from a fixed constant, never from any networked/opponent field.
    expect(YOUR_TURN_BODY).toBe('Your turn');
    expect(YOUR_TURN_TITLE_FLASH).toBe('(!) Your turn — Pente');
  });
});

describe('shouldReconnect', () => {
  it('TRUE: offline session + the tab just became visible', () => {
    expect(shouldReconnect('offline', 'visible', true)).toBe(true);
  });

  it('TRUE: offline session + the network just came back online (tab hidden is irrelevant)', () => {
    expect(shouldReconnect('offline', 'hidden', true)).toBe(true);
  });

  it('FALSE: offline but the tab is hidden AND the network is offline (no trigger edge)', () => {
    expect(shouldReconnect('offline', 'hidden', false)).toBe(false);
  });

  it('FALSE: already connected — a visibility/online edge must NOT re-connect a live session', () => {
    expect(shouldReconnect('connected', 'visible', true)).toBe(false);
  });

  it('FALSE: connecting (a host/join in flight) — do not stack a second reconnect', () => {
    expect(shouldReconnect('connecting', 'visible', true)).toBe(false);
  });

  it('FALSE: conflict phase — the game is stopped by a fork; do not auto-reconnect over it', () => {
    expect(shouldReconnect('conflict', 'visible', true)).toBe(false);
  });

  it('property: reconnect exactly iff phase is offline AND (visible OR online)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('offline', 'connecting', 'connected', 'conflict'),
        fc.constantFrom('visible', 'hidden'),
        fc.boolean(),
        (phase, visibility, online) => {
          const expected = phase === 'offline' && (visibility === 'visible' || online);
          expect(shouldReconnect(phase, visibility, online)).toBe(expected);
        },
      ),
    );
  });
});

describe('defaultNotificationsConfig', () => {
  it('reads the tracked notifications default (#20: flash ON, browser ON, sound OFF) — no magic values', () => {
    // Proves the pure config accessor delegates to the config SSOT default, not a hardcoded literal.
    expect(defaultNotificationsConfig()).toEqual(getDefault('notifications'));
    expect(defaultNotificationsConfig()).toEqual({
      titleFlash: true,
      browserNotification: true,
      sound: false,
    });
  });

  it('returns a fresh object each call (a caller mutating it cannot corrupt the next read)', () => {
    const a = defaultNotificationsConfig();
    const b = defaultNotificationsConfig();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
