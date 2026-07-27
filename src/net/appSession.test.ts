/**
 * ONE IDENTITY: the playerId that owns a seat is the id this client announces in PRESENCE.
 *
 * ## The bug this pins
 *
 * Seats are owned by `playerId` (`seats.ts`). The arbiter decides a full room by asking whether every
 * seat OWNER is present — `claimSeat` answers `room-full` when they all are and `seat-reserved` when
 * a blocking owner is absent (design §6/§7). The present-set it consults is built from
 * `transport.onPresence`.
 *
 * `MqttTransport` mints its own `p-…` id when none is given, and the app gave it none. So the two
 * sides of that comparison were DIFFERENT NAMESPACES: the present-set could never contain another
 * peer's `playerId`, every blocking owner therefore looked absent, and `room-full` was UNREACHABLE
 * over the real relay. Captured from the arbiter itself, in a room where both owners were live and
 * both reported `peerPresent === true`:
 *
 *     DIAGARB me=smr-a reason=seat-reserved
 *             seatMap={"white":"smr-a","black":"smr-b"}
 *             present=["smr-a","p-3x9m56","p-c67xmd"]
 *
 * The hermetic `MockTransport` is constructed WITH the playerId, so the mismatch existed only on the
 * real transport — and the entire real-relay Playwright tier was dark (`e2e/relayFixture.ts`), so
 * nothing ever asked. `e2e/sessionModelRelay.spec.ts`'s "reject reason surfaces in the net panel"
 * test is the end-to-end proof; this is the unit that fails fast if the wiring is undone.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MqttTransport } from './mqttTransport';
import { claimSeat } from './seats';
import type { SeatMap } from './seats';

/** A minimal in-memory `Storage` so `resolvePlayerId` / `getConfig` can run under node. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage;
}

let previousWindow: unknown;

beforeEach(() => {
  previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { localStorage: memoryStorage() };
});

afterEach(() => {
  (globalThis as { window?: unknown }).window = previousWindow;
});

describe("the app's transport announces this client under its PLAYER id", () => {
  it('THE BUG: the transport a real session runs over presents as the playerId, not a fresh p-… id', async () => {
    const { resolveTransportFactory } = await import('./appSession');
    const transport = resolveTransportFactory('player-42')();
    expect((transport as MqttTransport).peerId).toBe('player-42');
  });

  it('two different players get two different presence ids (the id is not a constant)', async () => {
    const { resolveTransportFactory } = await import('./appSession');
    const a = resolveTransportFactory('player-a')() as MqttTransport;
    const b = resolveTransportFactory('player-b')() as MqttTransport;
    expect(a.peerId).toBe('player-a');
    expect(b.peerId).toBe('player-b');
  });

  it('and the SAME player gets the SAME id across reconnects (each call is a fresh transport)', async () => {
    const { resolveTransportFactory } = await import('./appSession');
    const factory = resolveTransportFactory('player-42');
    const first = factory() as MqttTransport;
    const second = factory() as MqttTransport;
    expect(second).not.toBe(first);
    expect(second.peerId).toBe(first.peerId);
  });
});

describe('WHY it matters: the arbiter compares seat owners against the present-set', () => {
  const seatMap: SeatMap = { white: 'player-a', black: 'player-b' };

  it('a present-set spelled in PLAYER ids reaches room-full', () => {
    const claim = claimSeat(seatMap, 'player-c', new Set(['player-a', 'player-b', 'player-c']));
    expect(claim).toEqual({ ok: false, reason: 'room-full', seatMap: { ...seatMap } });
  });

  it('THE CONSEQUENCE: a present-set spelled in transport ids can only ever say seat-reserved', () => {
    // The exact shape observed from the live arbiter: itself by playerId, everyone else by a random
    // transport id. Both owners are genuinely online; the answer is still the absent-owner reason.
    const claim = claimSeat(seatMap, 'player-c', new Set(['player-a', 'p-3x9m56', 'p-c67xmd']));
    expect(claim).toEqual({ ok: false, reason: 'seat-reserved', seatMap: { ...seatMap } });
  });

  it('and the honest seat-reserved case still reads seat-reserved (the fix did not erase it)', () => {
    // Owner B really is gone. Same namespace on both sides, and the reason is still the right one —
    // so `room-full` becoming reachable did not collapse the two reasons into one.
    const claim = claimSeat(seatMap, 'player-c', new Set(['player-a', 'player-c']));
    expect(claim).toEqual({ ok: false, reason: 'seat-reserved', seatMap: { ...seatMap } });
  });
});
