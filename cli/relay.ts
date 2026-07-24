/**
 * Relay config for the CLI. Defaults to the LIVE deployed relay (the same values
 * the GitHub Pages build bakes in from the `RELAY_CONFIG` repo variable), so the
 * CLI talks to the exact broker/topic-root the browser client uses — same room
 * code ⇒ same game. Every field is overridable by env for a different broker.
 */
import type { RelayConfig } from '../src/config/config';

export function relayConfig(): RelayConfig {
  return {
    wssUrl: process.env.PENTE_WSS_URL ?? 'wss://api.shitchell.com/289d700bfbd3-mqtt',
    username: process.env.PENTE_USERNAME ?? 'pente',
    password: process.env.PENTE_PASSWORD ?? '01cdb6fbbccb8a5d149027a14e37ef7bec9f76a66f7f1e58',
    topicRoot: process.env.PENTE_TOPIC_ROOT ?? 'pente/v1',
  };
}

/** Board edge length (5 ⇒ 5×5×5), matching src/config/defaults/board.json. */
export const BOARD_SIZE = Number(process.env.PENTE_BOARD_SIZE ?? 5);
