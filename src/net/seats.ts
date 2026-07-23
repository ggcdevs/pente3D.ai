/**
 * Seat manager — pure, identity-owned durable seats (build plan Task S.2, epic #35,
 * closes #31; design doc §2.3 "Identity-owned seats").
 *
 * ## What this is
 *
 * Two seats, **white / black**, each OWNED by a persistent `playerId` (localStorage on
 * the client, survives refresh + reconnect) or `null` (never yet owned). Ownership is a
 * durable property of the GAME (persisted with it — S.5 wires the persistence); this
 * module is the pure decision over the map's value. The rules:
 *
 * - **Genuine creation only:** first-available, white-preferred. A seat is assigned by
 *   arrival ONLY when it is `null` (no owner yet) — i.e. at the game's first instant.
 * - **Reclaim-by-identity:** on entry, if your `playerId` already owns a seat you get it
 *   back (same color) — so a drop/refresh/reconnect is a non-event.
 * - **Reserve vacated seats:** a seat OWNED by a different `playerId` is never reassigned
 *   to a new claimant, even while its owner is absent. There is no "free the seat" — an
 *   owner keeps its seat until the game ends. Absence does not vacate ownership.
 * - **Room full = both seats owned** (by anyone). A player who owns NEITHER seat when
 *   both are owned is **rejected** (`room-full`). Spectating is #36 (out of scope).
 *
 * ## Purity & the shared-state seam
 *
 * This is **pure logic**: every function takes a {@link SeatMap} and returns a *new* one
 * (or a query result) — never mutating its input, never touching the network, DOM, or a
 * clock. The {@link SeatMap} is the identity-owned value carried IN the persisted game
 * (design §2.3); the transport/persistence carry it, this module decides it. Keeping the
 * decision pure is exactly what makes it unit-testable to 100% coverage + mutation
 * (agent-principles: the IO adapter stays thin, the logic is separable).
 *
 * This module carries no game logic and imports nothing from three/render/ui/net-io.
 *
 * ## Out of scope (leave the seam, do NOT build here)
 *
 * - **Initiator election / simultaneous-arrival tiebreak** and the reconciliation matrix
 *   (0/1/2 seed proposals, same-UUID match vs divergent) live in the pure
 *   `net/admission.ts` module (build plan Task S.3), NOT here. This module only decides a
 *   single claim against a known map.
 * - **Spectator mode** (#36) — admit extra joiners read-only instead of `room-full`.
 */

/** The two player colors. First joiner → white, second → black. */
export type SeatColor = 'white' | 'black';

/**
 * The identity-owned seat map — the durable value mapping each seat color to the REAL
 * `playerId` that owns it, or `null` if that seat has never been owned. This is persisted
 * IN the game (design §2.3, S.5 wiring); the dumb relay only ever sees it as opaque JSON.
 * There is no `'host'` sentinel — every owner is a genuine `playerId` or `null`.
 */
export interface SeatMap {
  /** The playerId owning the white seat, or `null` if it has no owner yet. */
  readonly white: string | null;
  /** The playerId owning the black seat, or `null` if it has no owner yet. */
  readonly black: string | null;
}

/** Why a {@link claimSeat} was refused. Extended by admission (S.3) with more reasons. */
export type ClaimRejection = 'room-full';

/**
 * The result of a {@link claimSeat}: either a granted seat with the resulting new map, or
 * a rejection carrying the (unchanged) map and a machine-readable reason.
 */
export type ClaimResult =
  | { readonly ok: true; readonly color: SeatColor; readonly seatMap: SeatMap }
  | {
      readonly ok: false;
      readonly reason: ClaimRejection;
      readonly seatMap: SeatMap;
    };

/** Seat colors in **claim-preference order** (white-preferred). */
const SEAT_ORDER: readonly SeatColor[] = ['white', 'black'];

/** A fresh, fully-unowned seat map. Returns a new object each call. */
export function emptySeatMap(): SeatMap {
  return { white: null, black: null };
}

/**
 * Attempt to claim a seat for `playerId` against `seatMap` (pure — returns a new map,
 * never mutates the input).
 *
 * Resolution order (identity-owned, reserve-vacated, first-available white-preferred):
 * 1. **Reclaim** — if `playerId` already owns a seat, return it (same color; map
 *    unchanged in value). A refresh/reconnect is thus a non-event.
 * 2. **First-available** — else take the first `null` (never-owned) seat in white→black
 *    order. This is the ONLY arrival-based assignment, and it fires only on a `null` seat
 *    (genuine creation); a seat OWNED by a different playerId is RESERVED and skipped —
 *    never reassigned to `playerId`.
 * 3. **Room full** — else (both seats owned by OTHER playerIds) → reject `room-full`.
 *    Ownership by an absent player still counts as owned: the seat stays reserved.
 */
export function claimSeat(seatMap: SeatMap, playerId: string): ClaimResult {
  // 1. Reclaim — identity ownership makes a refresh/reconnect a non-event.
  const owned = seatOf(seatMap, playerId);
  if (owned !== null) {
    return { ok: true, color: owned, seatMap: cloneSeatMap(seatMap) };
  }
  // 2. First UNOWNED seat, white-preferred. An owned (reserved) seat is skipped — never
  //    reassigned to a different playerId, even if its owner is absent.
  for (const color of SEAT_ORDER) {
    if (seatMap[color] === null) {
      return {
        ok: true,
        color,
        seatMap: { ...cloneSeatMap(seatMap), [color]: playerId },
      };
    }
  }
  // 3. Both seats owned by others (reserved) → room full.
  return { ok: false, reason: 'room-full', seatMap: cloneSeatMap(seatMap) };
}

/** The color `playerId` owns in `seatMap`, or `null` if it owns neither seat. */
export function seatOf(seatMap: SeatMap, playerId: string): SeatColor | null {
  for (const color of SEAT_ORDER) {
    if (seatMap[color] === playerId) return color;
  }
  return null;
}

/** The playerId occupying `color`, or `null` if that seat has no owner. */
export function occupantOf(seatMap: SeatMap, color: SeatColor): string | null {
  return seatMap[color];
}

/** True iff both seats are owned (room full — reserved owners count even if absent). */
export function isFull(seatMap: SeatMap): boolean {
  return seatMap.white !== null && seatMap.black !== null;
}

/** A shallow copy of a seat map (both fields are primitives). */
function cloneSeatMap(seatMap: SeatMap): SeatMap {
  return { white: seatMap.white, black: seatMap.black };
}
