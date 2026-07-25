/**
 * Bootstraps a real {@link NetSession} in Node by injecting the same seams the
 * browser app does — the MQTT transport over mqtt.js, an IndexedDB via
 * `fake-indexeddb`, and a stable playerId — so the CLI reuses src/ verbatim and
 * cannot drift from the browser's protocol.
 *
 * The mqtt.js connect seam comes from {@link connect} in `netlink.ts` rather than
 * `mqtt.connect` directly, so the socket stays controllable (`drop`/`restore`) for
 * outage scenarios like the issue #45 repro.
 */
import 'fake-indexeddb/auto';
import { NetSession } from '../src/net/session';
import { MqttTransport } from '../src/net/mqttTransport';
import { openDatabase } from '../src/persist/db';
import { relayConfig, BOARD_SIZE } from './relay';
import { connect } from './netlink';

export interface CliSession {
  readonly session: NetSession;
  readonly playerId: string;
}

/**
 * A minimal in-memory `Storage` for the `activeNetworkedGame` breadcrumb
 * (`src/net/activeGame.ts`). Node has no `localStorage`, and without a store the
 * session's breadcrumb — hence a returning peer's re-seed from the game's uuid —
 * would be silently disabled in the CLI while working in the browser. Scoped to
 * the daemon PROCESS, exactly like the `fake-indexeddb` archive above it: it makes
 * a within-daemon return (leave → re-enter) behave as the browser does; it does
 * NOT survive a daemon restart (there is no on-disk store to survive into).
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

/**
 * Build a connected-capable session. `dbName` isolates the fake-IndexedDB store
 * (unique per daemon so two local CLIs don't share a DB); `playerId` is the
 * stable seat identity — persisted by the caller so a reconnect reclaims the seat.
 */
export async function createSession(dbName: string, playerId: string): Promise<CliSession> {
  const db = await openDatabase(dbName);
  const session = new NetSession({
    createTransport: () => new MqttTransport(relayConfig(), { connect }),
    db,
    playerId,
    size: BOARD_SIZE,
    storage: memoryStorage(),
  });
  return { session, playerId };
}
