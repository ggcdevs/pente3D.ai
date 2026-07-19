import { describe, it, expect } from 'vitest';
import {
  emptySeatMap,
  claimSeat,
  releaseSeat,
  seatOf,
  occupantOf,
  isFull,
  type SeatMap,
} from './seats';

describe('emptySeatMap', () => {
  it('starts with both seats vacant (null owners)', () => {
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

describe('claimSeat — first-available, white-preferred', () => {
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

describe('claimSeat — identity-owned reclaim', () => {
  it('returns the SAME seat/color when a playerId that already owns white re-claims', () => {
    const first = claimSeat(emptySeatMap(), 'alice');
    if (!first.ok) throw new Error('expected ok');
    const reclaim = claimSeat(first.seatMap, 'alice');
    expect(reclaim.ok).toBe(true);
    if (!reclaim.ok) throw new Error('expected ok');
    expect(reclaim.color).toBe('white');
    expect(reclaim.seatMap).toEqual({ white: 'alice', black: null });
  });

  it('reclaims black without stealing white or opening a duplicate', () => {
    const first = claimSeat(emptySeatMap(), 'alice');
    if (!first.ok) throw new Error('expected ok');
    const second = claimSeat(first.seatMap, 'bob');
    if (!second.ok) throw new Error('expected ok');
    // bob reclaims after a refresh
    const reclaim = claimSeat(second.seatMap, 'bob');
    expect(reclaim.ok).toBe(true);
    if (!reclaim.ok) throw new Error('expected ok');
    expect(reclaim.color).toBe('black');
    expect(reclaim.seatMap).toEqual({ white: 'alice', black: 'bob' });
  });

  it('reclaim is idempotent — repeated claims by an owner never flip the map', () => {
    const first = claimSeat(emptySeatMap(), 'alice');
    if (!first.ok) throw new Error('expected ok');
    let map = first.seatMap;
    for (let i = 0; i < 3; i++) {
      const again = claimSeat(map, 'alice');
      if (!again.ok) throw new Error('expected ok');
      expect(again.color).toBe('white');
      map = again.seatMap;
    }
    expect(map).toEqual({ white: 'alice', black: null });
  });
});

describe('claimSeat — third distinct player rejected', () => {
  it('rejects a 3rd distinct playerId when both seats are owned', () => {
    const first = claimSeat(emptySeatMap(), 'alice');
    if (!first.ok) throw new Error('expected ok');
    const second = claimSeat(first.seatMap, 'bob');
    if (!second.ok) throw new Error('expected ok');
    const third = claimSeat(second.seatMap, 'carol');
    expect(third.ok).toBe(false);
    if (third.ok) throw new Error('expected rejection');
    expect(third.reason).toBe('room-full');
  });

  it('a rejected claim reports the unchanged full map (no seat granted)', () => {
    const full: SeatMap = { white: 'alice', black: 'bob' };
    const third = claimSeat(full, 'carol');
    expect(third.ok).toBe(false);
    if (third.ok) throw new Error('expected rejection');
    expect(third.seatMap).toEqual({ white: 'alice', black: 'bob' });
  });
});

describe('releaseSeat — freed seat is takeable', () => {
  it('frees the seat owned by the given playerId (white)', () => {
    const map: SeatMap = { white: 'alice', black: 'bob' };
    const freed = releaseSeat(map, 'alice');
    expect(freed).toEqual({ white: null, black: 'bob' });
    // pure: original untouched
    expect(map).toEqual({ white: 'alice', black: 'bob' });
  });

  it('frees the seat owned by the given playerId (black)', () => {
    const map: SeatMap = { white: 'alice', black: 'bob' };
    const freed = releaseSeat(map, 'bob');
    expect(freed).toEqual({ white: 'alice', black: null });
  });

  it('a new distinct player can take a freed seat (and gets that color)', () => {
    const map: SeatMap = { white: 'alice', black: 'bob' };
    const freed = releaseSeat(map, 'alice');
    const claim = claimSeat(freed, 'carol');
    expect(claim.ok).toBe(true);
    if (!claim.ok) throw new Error('expected ok');
    // white was the freed seat, so carol gets white
    expect(claim.color).toBe('white');
    expect(claim.seatMap).toEqual({ white: 'carol', black: 'bob' });
  });

  it('releasing a playerId that owns no seat is a no-op returning an equal map', () => {
    const map: SeatMap = { white: 'alice', black: 'bob' };
    const freed = releaseSeat(map, 'stranger');
    expect(freed).toEqual({ white: 'alice', black: 'bob' });
    expect(freed).not.toBe(map);
  });

  it('releasing on an already-empty map is a no-op', () => {
    const freed = releaseSeat(emptySeatMap(), 'nobody');
    expect(freed).toEqual({ white: null, black: null });
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
