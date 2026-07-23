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
    const result = claimSeat(emptySeatMap(), 'alice');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.color).toBe('white');
    expect(result.seatMap).toEqual({ white: 'alice', black: null });
  });

  it('assigns the second, distinct joiner to black', () => {
    const first = claimSeat(emptySeatMap(), 'alice');
    if (!first.ok) throw new Error('expected ok');
    const second = claimSeat(first.seatMap, 'bob');
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('expected ok');
    expect(second.color).toBe('black');
    expect(second.seatMap).toEqual({ white: 'alice', black: 'bob' });
  });

  it('two distinct joiners get DISTINCT seats — they do NOT collide on the same color (#31)', () => {
    // The #31 regression: two players joining the SAME map must not both land on black.
    const first = claimSeat(emptySeatMap(), 'alice');
    if (!first.ok) throw new Error('expected ok');
    const second = claimSeat(first.seatMap, 'bob');
    if (!second.ok) throw new Error('expected ok');
    expect(first.color).not.toBe(second.color);
    // and the resulting map owns both, one each — no duplicate owner
    expect(second.seatMap.white).toBe('alice');
    expect(second.seatMap.black).toBe('bob');
  });

  it('fills the black seat first when only black is unowned (white already reserved)', () => {
    // first-available fires per-seat on the FIRST null slot, not blindly white.
    const claim = claimSeat({ white: 'alice', black: null }, 'bob');
    expect(claim.ok).toBe(true);
    if (!claim.ok) throw new Error('expected ok');
    expect(claim.color).toBe('black');
    expect(claim.seatMap).toEqual({ white: 'alice', black: 'bob' });
  });

  it('fills the white seat when only white is unowned (black already reserved)', () => {
    const claim = claimSeat({ white: null, black: 'bob' }, 'alice');
    expect(claim.ok).toBe(true);
    if (!claim.ok) throw new Error('expected ok');
    expect(claim.color).toBe('white');
    expect(claim.seatMap).toEqual({ white: 'alice', black: 'bob' });
  });

  it('does not mutate the input seat map (immutable / pure)', () => {
    const map = emptySeatMap();
    const result = claimSeat(map, 'alice');
    expect(result.ok).toBe(true);
    // original untouched — a genuinely new object was returned
    expect(map).toEqual({ white: null, black: null });
    if (!result.ok) throw new Error('expected ok');
    expect(result.seatMap).not.toBe(map);
  });
});

describe('claimSeat — identity-owned reclaim (reconnect/refresh non-event)', () => {
  it('returns the SAME seat/color when a playerId that already owns white re-claims', () => {
    const reclaim = claimSeat({ white: 'alice', black: null }, 'alice');
    expect(reclaim.ok).toBe(true);
    if (!reclaim.ok) throw new Error('expected ok');
    expect(reclaim.color).toBe('white');
    expect(reclaim.seatMap).toEqual({ white: 'alice', black: null });
  });

  it('reclaims black without stealing white or opening a duplicate', () => {
    const reclaim = claimSeat({ white: 'alice', black: 'bob' }, 'bob');
    expect(reclaim.ok).toBe(true);
    if (!reclaim.ok) throw new Error('expected ok');
    expect(reclaim.color).toBe('black');
    expect(reclaim.seatMap).toEqual({ white: 'alice', black: 'bob' });
  });

  it('an owner reclaims its seat even when the OTHER seat is still unowned (does not grab white)', () => {
    // bob owns black; white is free. A reclaim must return BLACK (identity), not the
    // first-available white — reclaim precedes first-available.
    const reclaim = claimSeat({ white: null, black: 'bob' }, 'bob');
    expect(reclaim.ok).toBe(true);
    if (!reclaim.ok) throw new Error('expected ok');
    expect(reclaim.color).toBe('black');
    expect(reclaim.seatMap).toEqual({ white: null, black: 'bob' });
  });

  it('reclaim is idempotent — repeated claims by an owner never flip the map', () => {
    let map: SeatMap = { white: 'alice', black: null };
    for (let i = 0; i < 3; i++) {
      const again = claimSeat(map, 'alice');
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
    const claim = claimSeat({ white: 'alice', black: null }, 'carol');
    expect(claim.ok).toBe(true);
    if (!claim.ok) throw new Error('expected ok');
    expect(claim.color).toBe('black');
    // alice's reservation is intact — she still owns white
    expect(claim.seatMap).toEqual({ white: 'alice', black: 'carol' });
  });

  it('a foreign claimant is REJECTED when the only remaining seat is reserved by an absent owner', () => {
    // Both seats owned (bob present-or-not; alice absent+reserved). A third distinct
    // player cannot take alice's reserved seat → room-full.
    const claim = claimSeat({ white: 'alice', black: 'bob' }, 'carol');
    expect(claim.ok).toBe(false);
    if (claim.ok) throw new Error('expected rejection');
    expect(claim.reason).toBe('room-full');
    // the reservation is untouched by the rejection
    expect(claim.seatMap).toEqual({ white: 'alice', black: 'bob' });
  });
});

describe('claimSeat — room full = both seats owned', () => {
  it('rejects a 3rd distinct playerId when both seats are owned by OTHERS', () => {
    const third = claimSeat({ white: 'alice', black: 'bob' }, 'carol');
    expect(third.ok).toBe(false);
    if (third.ok) throw new Error('expected rejection');
    expect(third.reason).toBe('room-full');
  });

  it('a rejected claim reports the unchanged full map (no seat granted, no mutation)', () => {
    const full: SeatMap = { white: 'alice', black: 'bob' };
    const third = claimSeat(full, 'carol');
    expect(third.ok).toBe(false);
    if (third.ok) throw new Error('expected rejection');
    expect(third.seatMap).toEqual({ white: 'alice', black: 'bob' });
    // pure: the input object itself is untouched and a fresh copy is returned
    expect(full).toEqual({ white: 'alice', black: 'bob' });
    expect(third.seatMap).not.toBe(full);
  });

  it('an OWNER is still admitted (reclaim) even when the map is full — full only rejects strangers', () => {
    const full: SeatMap = { white: 'alice', black: 'bob' };
    const alice = claimSeat(full, 'alice');
    expect(alice.ok).toBe(true);
    if (!alice.ok) throw new Error('expected ok');
    expect(alice.color).toBe('white');
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
        const first = claimSeat(emptySeatMap(), p);
        if (!first.ok) throw new Error('first must be admitted on an empty map');
        const second = claimSeat(first.seatMap, q);
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
          const r = claimSeat(map, p);
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
          const r = claimSeat(map, claimant);
          if (!r.ok) throw new Error('a free seat exists, so the claimant must be admitted');
          // the claimant lands on the FREE seat, never the reserved one
          expect(r.color).toBe(freeColor);
          // the owner's reservation survives untouched
          expect(occupantOf(r.seatMap, reservedColor)).toBe(owner);
        },
      ),
    );
  });

  it('room-full rejects every stranger; only the two owners are ever admitted (reclaim)', () => {
    fc.assert(
      fc.property(idA, idA, idA, (w, b, stranger) => {
        fc.pre(w !== b && stranger !== w && stranger !== b);
        const full: SeatMap = { white: w, black: b };
        const rejected = claimSeat(full, stranger);
        expect(rejected.ok).toBe(false);
        if (rejected.ok) throw new Error('stranger must be rejected on a full map');
        expect(rejected.reason).toBe('room-full');
        // owners still reclaim
        const rw = claimSeat(full, w);
        const rb = claimSeat(full, b);
        expect(rw.ok && rw.color === 'white').toBe(true);
        expect(rb.ok && rb.color === 'black').toBe(true);
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
          claimSeat(map, claimant);
          expect(map).toEqual(snapshot);
        },
      ),
    );
  });
});
