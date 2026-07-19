/**
 * Seat manager — pure, identity-owned sticky seats (build plan Task 3.2;
 * design doc "Seat & reconnection model").
 *
 * ## What this is
 *
 * Two seats, **white / black**, each owned by a persistent `playerId`
 * (localStorage on the client, survives refresh + reconnect). The rules:
 *
 * - First joiner → white; second → black (**first-available, white-preferred**).
 * - Seats are owned by the `playerId`, **not** by position: on join, if your
 *   `playerId` already owns a seat you **reclaim it** (same color) — so a network
 *   drop/refresh is a non-event. Else you take the first free seat; else you are
 *   **rejected** (`room-full`).
 * - A player leaving **frees** their seat for a new owner (a freed seat is
 *   takeable); a 3rd distinct player is rejected.
 *
 * ## Purity & the shared-state seam
 *
 * This is **pure logic**: every function takes a {@link SeatMap} and returns a
 * *new* one (or a query result) — never mutating its input, never touching the
 * network, DOM, or a clock. The {@link SeatMap} is the value that lives in the
 * room's shared retained state (design doc: "Seat map lives in the shared retained
 * state"); the transport carries it, this module decides it. Keeping the decision
 * pure is exactly what makes it unit-testable to 100% coverage + mutation
 * (agent-principles: the IO adapter stays thin, the logic is separable).
 *
 * This module carries no game logic and imports nothing from three/render/ui.
 *
 * ## Deferred flex points (design doc — leave drop-in seams, do NOT build in v1)
 *
 * These all sit on the same `playerId` + seat-map-in-shared-state foundation, so
 * they drop in without a rewrite:
 *
 * - **Grace window** — mark a dropped seat *vacant-but-reserved* for its owner for
 *   ~30–60s before it reopens (prevents seat theft during a wifi blip). Would
 *   attach a `reservedUntil` timestamp per seat and gate {@link claimSeat} against
 *   it; needs an injected clock. `TODO(grace-window)`.
 * - **Simultaneous-claim tiebreaker** — two clients grabbing the same free seat at
 *   once: deterministic resolution (earlier timestamp, then lower `playerId`; loser
 *   re-evaluates). Rare with 2 players. `TODO(tiebreaker)`.
 * - **Spectator mode** — admit extra joiners read-only instead of returning
 *   `room-full`. Would add a `spectator` claim result rather than a rejection.
 *   `TODO(spectator)`.
 */

/** The two player colors. First joiner → white, second → black. */
export type SeatColor = 'white' | 'black';

/**
 * The seat map — the shared-state value mapping each seat color to the
 * `playerId` that owns it, or `null` if vacant. This is what lives in the room's
 * retained state; the dumb relay only ever sees it as opaque JSON.
 */
export interface SeatMap {
  /** The playerId owning the white seat, or `null` if vacant. */
  readonly white: string | null;
  /** The playerId owning the black seat, or `null` if vacant. */
  readonly black: string | null;
}

/** Why a {@link claimSeat} was refused. v1 has one reason; extensible. */
export type ClaimRejection = 'room-full';

/**
 * The result of a {@link claimSeat}: either a granted seat with the resulting new
 * map, or a rejection carrying the (unchanged) map and a machine-readable reason.
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

/** A fresh, fully-vacant seat map. Returns a new object each call. */
export function emptySeatMap(): SeatMap {
  return { white: null, black: null };
}

/**
 * Attempt to claim a seat for `playerId` against `seatMap` (pure — returns a new
 * map, never mutates the input).
 *
 * Resolution order (identity-owned, first-available, white-preferred):
 * 1. If `playerId` already owns a seat → **reclaim** it (same color; map
 *    unchanged in value).
 * 2. Else take the first vacant seat in white→black order.
 * 3. Else (both seats owned by others) → reject with `room-full`.
 *
 * TODO(grace-window): before opening a vacant seat to a new joiner, honor a
 * per-seat `reservedUntil` for the previous owner (needs an injected clock).
 * TODO(tiebreaker): on simultaneous free-seat claims, resolve deterministically
 * (earlier timestamp, then lower playerId).
 * TODO(spectator): admit extra joiners as read-only instead of `room-full`.
 */
export function claimSeat(seatMap: SeatMap, playerId: string): ClaimResult {
  // 1. Reclaim — identity ownership makes a refresh/reconnect a non-event.
  const owned = seatOf(seatMap, playerId);
  if (owned !== null) {
    return { ok: true, color: owned, seatMap: cloneSeatMap(seatMap) };
  }
  // 2. First vacant seat, white-preferred.
  for (const color of SEAT_ORDER) {
    if (seatMap[color] === null) {
      return {
        ok: true,
        color,
        seatMap: { ...cloneSeatMap(seatMap), [color]: playerId },
      };
    }
  }
  // 3. Both seats owned by others.
  return { ok: false, reason: 'room-full', seatMap: cloneSeatMap(seatMap) };
}

/**
 * Free whatever seat `playerId` owns, returning a new map (pure — input
 * untouched). If the player owns no seat, returns an equal-but-fresh map. A freed
 * seat is immediately takeable by {@link claimSeat}.
 */
export function releaseSeat(seatMap: SeatMap, playerId: string): SeatMap {
  const owned = seatOf(seatMap, playerId);
  if (owned === null) return cloneSeatMap(seatMap);
  return { ...cloneSeatMap(seatMap), [owned]: null };
}

/** The color `playerId` owns in `seatMap`, or `null` if it owns neither seat. */
export function seatOf(seatMap: SeatMap, playerId: string): SeatColor | null {
  for (const color of SEAT_ORDER) {
    if (seatMap[color] === playerId) return color;
  }
  return null;
}

/** The playerId occupying `color`, or `null` if that seat is vacant. */
export function occupantOf(seatMap: SeatMap, color: SeatColor): string | null {
  return seatMap[color];
}

/** True iff both seats are owned. */
export function isFull(seatMap: SeatMap): boolean {
  return seatMap.white !== null && seatMap.black !== null;
}

/** A shallow copy of a seat map (both fields are primitives). */
function cloneSeatMap(seatMap: SeatMap): SeatMap {
  return { white: seatMap.white, black: seatMap.black };
}
