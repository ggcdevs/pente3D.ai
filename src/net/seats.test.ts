import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  emptySeatMap,
  claimSeat,
  seatOf,
  occupantOf,
  isFull,
  type SeatColor,
  type SeatMap,
} from './seats';

/**
 * The live-presence snapshot for a {@link claimSeat} call. `claimSeat`'s reject-reason
 * distinction (design §6/§7) turns on WHICH owners are present, so every call names them:
 *  - `allPresent(...ids)` — those ids are in the room (the third arg to claimSeat).
 * A claim that never reaches the reject branch (reclaim / first-available) is unaffected by
 * the snapshot, but the tests still pass an honest one so the argument is never a lie.
 */
function present(...ids: readonly string[]): ReadonlySet<string> {
  return new Set(ids);
}

describe('emptySeatMap', () => {
  it('starts with both seats unowned (null owners)', () => {
    const map = emptySeatMap();
    expect(map).toEqual({ white: null, black: null });
  });

  it('returns a fresh object each call (no shared mutable singleton)', () => {
    const a = emptySeatMap();
    const b = emptySeatMap();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('claimSeat — genuine creation: first-available, white-preferred', () => {
  it('assigns the first joiner to white', () => {
    const result = claimSeat(emptySeatMap(), 'alice', present('alice'));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.color).toBe('white');
    expect(result.seatMap).toEqual({ white: 'alice', black: null });
  });

  it('assigns the second, distinct joiner to black', () => {
    const first = claimSeat(emptySeatMap(), 'alice', present('alice'));
    if (!first.ok) throw new Error('expected ok');
    const second = claimSeat(first.seatMap, 'bob', present('alice', 'bob'));
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('expected ok');
    expect(second.color).toBe('black');
    expect(second.seatMap).toEqual({ white: 'alice', black: 'bob' });
  });

  it('two distinct joiners get DISTINCT seats — they do NOT collide on the same color (#31)', () => {
    // The #31 regression: two players joining the SAME map must not both land on black.
    const first = claimSeat(emptySeatMap(), 'alice', present('alice'));
    if (!first.ok) throw new Error('expected ok');
    const second = claimSeat(first.seatMap, 'bob', present('alice', 'bob'));
    if (!second.ok) throw new Error('expected ok');
    expect(first.color).not.toBe(second.color);
    // and the resulting map owns both, one each — no duplicate owner
    expect(second.seatMap.white).toBe('alice');
    expect(second.seatMap.black).toBe('bob');
  });

  it('fills the black seat first when only black is unowned (white already reserved)', () => {
    // first-available fires per-seat on the FIRST null slot, not blindly white.
    const claim = claimSeat({ white: 'alice', black: null }, 'bob', present('alice', 'bob'));
    expect(claim.ok).toBe(true);
    if (!claim.ok) throw new Error('expected ok');
    expect(claim.color).toBe('black');
    expect(claim.seatMap).toEqual({ white: 'alice', black: 'bob' });
  });

  it('fills the white seat when only white is unowned (black already reserved)', () => {
    const claim = claimSeat({ white: null, black: 'bob' }, 'alice', present('alice', 'bob'));
    expect(claim.ok).toBe(true);
    if (!claim.ok) throw new Error('expected ok');
    expect(claim.color).toBe('white');
    expect(claim.seatMap).toEqual({ white: 'alice', black: 'bob' });
  });

  it('does not mutate the input seat map (immutable / pure)', () => {
    const map = emptySeatMap();
    const result = claimSeat(map, 'alice', present('alice'));
    expect(result.ok).toBe(true);
    // original untouched — a genuinely new object was returned
    expect(map).toEqual({ white: null, black: null });
    if (!result.ok) throw new Error('expected ok');
    expect(result.seatMap).not.toBe(map);
  });
});

describe('claimSeat — identity-owned reclaim (reconnect/refresh non-event)', () => {
  it('returns the SAME seat/color when a playerId that already owns white re-claims', () => {
    const reclaim = claimSeat({ white: 'alice', black: null }, 'alice', present('alice'));
    expect(reclaim.ok).toBe(true);
    if (!reclaim.ok) throw new Error('expected ok');
    expect(reclaim.color).toBe('white');
    expect(reclaim.seatMap).toEqual({ white: 'alice', black: null });
  });

  it('reclaims black without stealing white or opening a duplicate', () => {
    const reclaim = claimSeat({ white: 'alice', black: 'bob' }, 'bob', present('alice', 'bob'));
    expect(reclaim.ok).toBe(true);
    if (!reclaim.ok) throw new Error('expected ok');
    expect(reclaim.color).toBe('black');
    expect(reclaim.seatMap).toEqual({ white: 'alice', black: 'bob' });
  });

  it('an owner reclaims its seat even when the OTHER seat is still unowned (does not grab white)', () => {
    // bob owns black; white is free. A reclaim must return BLACK (identity), not the
    // first-available white — reclaim precedes first-available.
    const reclaim = claimSeat({ white: null, black: 'bob' }, 'bob', present('bob'));
    expect(reclaim.ok).toBe(true);
    if (!reclaim.ok) throw new Error('expected ok');
    expect(reclaim.color).toBe('black');
    expect(reclaim.seatMap).toEqual({ white: null, black: 'bob' });
  });

  it('reclaim is idempotent — repeated claims by an owner never flip the map', () => {
    let map: SeatMap = { white: 'alice', black: null };
    for (let i = 0; i < 3; i++) {
      const again = claimSeat(map, 'alice', present('alice'));
      if (!again.ok) throw new Error('expected ok');
      expect(again.color).toBe('white');
      map = again.seatMap;
    }
    expect(map).toEqual({ white: 'alice', black: null });
  });
});

describe('claimSeat — reserve vacated seats (an owner keeps its seat while absent)', () => {
  it('does NOT hand a foreign claimant a seat reserved by an absent owner; gives the free seat instead', () => {
    // alice owns white but is ABSENT; the seat stays reserved. carol must land on the
    // FREE black seat, never on alice's reserved white.
    const claim = claimSeat({ white: 'alice', black: null }, 'carol', present('carol'));
    expect(claim.ok).toBe(true);
    if (!claim.ok) throw new Error('expected ok');
    expect(claim.color).toBe('black');
    // alice's reservation is intact — she still owns white
    expect(claim.seatMap).toEqual({ white: 'alice', black: 'carol' });
  });

  it('a foreign claimant is REJECTED seat-reserved when the only remaining seat is held for an ABSENT owner (scenario 5)', () => {
    // Both seats owned: bob PRESENT (black), alice ABSENT + reserved (white). A third distinct
    // player cannot take alice's reserved seat → the DISTINCT reason `seat-reserved` (a seat is
    // being held for its owner's return), NOT the generic `room-full`. This is design §6/§7
    // scenario 5 (A dropped; C is refused because A's white is reserved).
    const claim = claimSeat({ white: 'alice', black: 'bob' }, 'carol', present('bob', 'carol'));
    expect(claim.ok).toBe(false);
    if (claim.ok) throw new Error('expected rejection');
    expect(claim.reason).toBe('seat-reserved');
    // the reservation is untouched by the rejection
    expect(claim.seatMap).toEqual({ white: 'alice', black: 'bob' });
  });

  it('reports seat-reserved when BOTH owners are absent (both seats held for their return)', () => {
    // Neither owner is in the room: both seats are reserved. A stranger is refused with the
    // held-for-owner reason, not room-full (nobody is actually here occupying an active game).
    const claim = claimSeat({ white: 'alice', black: 'bob' }, 'carol', present('carol'));
    expect(claim.ok).toBe(false);
    if (claim.ok) throw new Error('expected rejection');
    expect(claim.reason).toBe('seat-reserved');
  });
});

describe('claimSeat — room full = both seats owned AND both owners present (scenario 1)', () => {
  it('rejects a 3rd distinct playerId room-full when both owners are PRESENT', () => {
    // alice + bob are BOTH here (a full, active game); carol is the third arriver → room-full,
    // the DISTINCT reason from scenario 5's seat-reserved (design §6/§7 scenario 1).
    const third = claimSeat({ white: 'alice', black: 'bob' }, 'carol', present('alice', 'bob', 'carol'));
    expect(third.ok).toBe(false);
    if (third.ok) throw new Error('expected rejection');
    expect(third.reason).toBe('room-full');
  });

  it('a rejected claim reports the unchanged full map (no seat granted, no mutation)', () => {
    const full: SeatMap = { white: 'alice', black: 'bob' };
    const third = claimSeat(full, 'carol', present('alice', 'bob', 'carol'));
    expect(third.ok).toBe(false);
    if (third.ok) throw new Error('expected rejection');
    expect(third.seatMap).toEqual({ white: 'alice', black: 'bob' });
    // pure: the input object itself is untouched and a fresh copy is returned
    expect(full).toEqual({ white: 'alice', black: 'bob' });
    expect(third.seatMap).not.toBe(full);
  });

  it('an OWNER is still admitted (reclaim) even when the map is full — full only rejects strangers', () => {
    const full: SeatMap = { white: 'alice', black: 'bob' };
    const alice = claimSeat(full, 'alice', present('alice', 'bob'));
    expect(alice.ok).toBe(true);
    if (!alice.ok) throw new Error('expected ok');
    expect(alice.color).toBe('white');
  });

  it('the SAME full map yields room-full when both owners present but seat-reserved when one is absent', () => {
    // Same map + same claimant; the ONLY difference is presence. This pins the distinction the
    // design requires (scenario 1 vs scenario 5) directly on the reason value, not a generic
    // non-null check — the reason is a function of presence, nothing else.
    const full: SeatMap = { white: 'alice', black: 'bob' };
    const bothHere = claimSeat(full, 'carol', present('alice', 'bob', 'carol'));
    const aliceGone = claimSeat(full, 'carol', present('bob', 'carol'));
    if (bothHere.ok || aliceGone.ok) throw new Error('both must reject');
    expect(bothHere.reason).toBe('room-full');
    expect(aliceGone.reason).toBe('seat-reserved');
  });
});

describe('seatOf / occupantOf / isFull — seat-map queries', () => {
  it('seatOf returns the color a playerId owns, or null', () => {
    const map: SeatMap = { white: 'alice', black: 'bob' };
    expect(seatOf(map, 'alice')).toBe('white');
    expect(seatOf(map, 'bob')).toBe('black');
    expect(seatOf(map, 'carol')).toBe(null);
  });

  it('seatOf on the empty map returns null for any player', () => {
    expect(seatOf(emptySeatMap(), 'alice')).toBe(null);
  });

  it('occupantOf returns the playerId in a color seat, or null', () => {
    const map: SeatMap = { white: 'alice', black: null };
    expect(occupantOf(map, 'white')).toBe('alice');
    expect(occupantOf(map, 'black')).toBe(null);
  });

  it('isFull is true only when both seats are owned', () => {
    expect(isFull(emptySeatMap())).toBe(false);
    expect(isFull({ white: 'alice', black: null })).toBe(false);
    expect(isFull({ white: null, black: 'bob' })).toBe(false);
    expect(isFull({ white: 'alice', black: 'bob' })).toBe(true);
  });
});

describe('claimSeat — properties (fast-check)', () => {
  // Distinct, non-empty player ids so identity comparisons are unambiguous.
  const idA = fc.stringMatching(/^[a-z]{1,8}$/);

  it('two distinct joiners on a fresh map always get DISTINCT seats (the #31 no-collision invariant)', () => {
    fc.assert(
      fc.property(idA, idA, (p, q) => {
        fc.pre(p !== q);
        const first = claimSeat(emptySeatMap(), p, present(p));
        if (!first.ok) throw new Error('first must be admitted on an empty map');
        const second = claimSeat(first.seatMap, q, present(p, q));
        if (!second.ok) throw new Error('second must be admitted on a one-seat map');
        expect(first.color).not.toBe(second.color);
        expect(occupantOf(second.seatMap, first.color)).toBe(p);
        expect(occupantOf(second.seatMap, second.color)).toBe(q);
      }),
    );
  });

  it('reclaim is idempotent — an owner claiming any number of times fixes the map value', () => {
    fc.assert(
      fc.property(idA, idA, fc.integer({ min: 1, max: 6 }), (p, q, n) => {
        fc.pre(p !== q);
        // A full, distinct-owner map; p reclaims repeatedly.
        let map: SeatMap = { white: p, black: q };
        const start = map;
        for (let i = 0; i < n; i++) {
          const r = claimSeat(map, p, present(p, q));
          if (!r.ok) throw new Error('owner must always reclaim');
          expect(r.color).toBe('white');
          map = r.seatMap;
        }
        expect(map).toEqual(start);
      }),
    );
  });

  it('a reserved seat is never reassigned: a foreign claimant never receives a seat owned by another', () => {
    fc.assert(
      fc.property(
        idA,
        idA,
        idA,
        fc.constantFrom<SeatColor>('white', 'black'),
        (owner, other, claimant, reservedColor) => {
          fc.pre(owner !== other && owner !== claimant && other !== claimant);
          const freeColor: SeatColor = reservedColor === 'white' ? 'black' : 'white';
          // Exactly one seat reserved by `owner`; the other free.
          const map: SeatMap = { white: null, black: null, [reservedColor]: owner };
          const r = claimSeat(map, claimant, present(owner, claimant));
          if (!r.ok) throw new Error('a free seat exists, so the claimant must be admitted');
          // the claimant lands on the FREE seat, never the reserved one
          expect(r.color).toBe(freeColor);
          // the owner's reservation survives untouched
          expect(occupantOf(r.seatMap, reservedColor)).toBe(owner);
        },
      ),
    );
  });

  it('both owners present → every stranger is rejected room-full; only the two owners reclaim', () => {
    fc.assert(
      fc.property(idA, idA, idA, (w, b, stranger) => {
        fc.pre(w !== b && stranger !== w && stranger !== b);
        const full: SeatMap = { white: w, black: b };
        // BOTH owners in the room → a full active game → the stranger gets room-full (scenario 1).
        const rejected = claimSeat(full, stranger, present(w, b, stranger));
        expect(rejected.ok).toBe(false);
        if (rejected.ok) throw new Error('stranger must be rejected on a full map');
        expect(rejected.reason).toBe('room-full');
        // owners still reclaim
        const rw = claimSeat(full, w, present(w, b));
        const rb = claimSeat(full, b, present(w, b));
        expect(rw.ok && rw.color === 'white').toBe(true);
        expect(rb.ok && rb.color === 'black').toBe(true);
      }),
    );
  });

  it('a blocking owner absent → the stranger is rejected seat-reserved, never room-full (scenario 5)', () => {
    fc.assert(
      fc.property(idA, idA, idA, fc.constantFrom<SeatColor>('white', 'black'), (w, b, stranger, absentColor) => {
        fc.pre(w !== b && stranger !== w && stranger !== b);
        const full: SeatMap = { white: w, black: b };
        // Exactly one owner is ABSENT from the room; the other + the stranger are present. A held
        // seat → seat-reserved, whichever seat's owner stepped out. Never room-full while a seat is
        // being held for an absent owner.
        const absentOwner = absentColor === 'white' ? w : b;
        const roomIds = [w, b, stranger].filter((id) => id !== absentOwner);
        const rejected = claimSeat(full, stranger, present(...roomIds));
        expect(rejected.ok).toBe(false);
        if (rejected.ok) throw new Error('stranger must be rejected on a full map');
        expect(rejected.reason).toBe('seat-reserved');
      }),
    );
  });

  it('claimSeat never mutates its input map', () => {
    fc.assert(
      fc.property(
        fc.option(idA, { nil: null }),
        fc.option(idA, { nil: null }),
        idA,
        (white, black, claimant) => {
          const map: SeatMap = { white, black };
          const snapshot = { white, black };
          claimSeat(map, claimant, present(claimant));
          expect(map).toEqual(snapshot);
        },
      ),
    );
  });
});
