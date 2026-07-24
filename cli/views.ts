/**
 * Board views for the CLI. A view is a pure `(Snapshot) => string`; they live in
 * the {@link VIEWS} registry keyed by name and are chosen with `--view`. Adding a
 * new way to look at the 5×5×5 board is a one-function change here — nothing else
 * needs to know about it.
 *
 * Rendering is done CLIENT-side from a plain, JSON-serialized {@link Snapshot} the
 * daemon ships over the socket, so every verb (`show`/`move`/`wait`) can pick its
 * own view without the daemon caring.
 */
import type { GameState, Player } from '../src/core/gameState';
import type { SeatMap } from '../src/net/seats';

/** The plain, JSON-safe game readout the daemon sends and the views render. */
export interface Snapshot {
  readonly code: string;
  readonly seat: Player | null;
  readonly phase: string;
  readonly peerPresent: boolean;
  readonly joinError: string | null;
  readonly canPlace: boolean;
  readonly ply: number;
  readonly lastMove: string | null; // NodeKey "x,y,z"
  readonly seatOwners: SeatMap | null;
  readonly game: GameState | null;
}

export type View = (s: Snapshot) => string;

const EMPTY = '·';
const GLYPH: Record<Player, string> = { white: 'O', black: 'X' };
/** Last-move glyph: lowercase so column alignment is preserved (no extra chars). */
const GLYPH_LAST: Record<Player, string> = { white: 'o', black: 'x' };

/** A one/two-line status header shared by every view. */
function header(s: Snapshot): string {
  const seat = s.seat ? s.seat.toUpperCase() : '—';
  const opp = s.peerPresent ? 'present' : 'waiting…';
  const lines: string[] = [];
  lines.push(`Room ${s.code} · you are ${seat} · phase ${s.phase} · opponent ${opp}`);
  const g = s.game;
  if (g) {
    if (g.winner) {
      const mine = g.winner === s.seat;
      lines.push(`GAME OVER — ${g.winner.toUpperCase()} wins${mine ? ' (you!)' : ''}`);
    } else {
      const yours = s.canPlace;
      lines.push(
        `Turn: ${g.turn.toUpperCase()} ${yours ? '— YOUR MOVE' : '(opponent) — waiting'}` +
          `   captures W${g.captures.white} B${g.captures.black} · ply ${s.ply}`,
      );
    }
    if (s.lastMove) lines.push(`Last move: ${lastMoveDesc(s)}`);
  } else if (s.joinError) {
    lines.push(`join error: ${s.joinError}`);
  }
  return lines.join('\n');
}

function lastMoveDesc(s: Snapshot): string {
  const who = s.lastMove && s.game ? s.game.pieces[s.lastMove] : undefined;
  return `${who ? who : '?'} @ (${s.lastMove})`;
}

function glyphAt(g: GameState, key: string, lastMove: string | null): string {
  const p = g.pieces[key];
  if (p === undefined) return EMPTY;
  return key === lastMove ? GLYPH_LAST[p] : GLYPH[p];
}

/**
 * `layers` — the N z-slices side by side ("a matrix of matrices"). Within a slice
 * columns are x (0→N-1, left→right) and rows are y (N-1→0, top→bottom) so the
 * usual cartesian "up is up" holds. The last move shows as a lowercase glyph.
 */
const layersView: View = (s) => {
  const g = s.game;
  if (!g) return header(s);
  const n = g.size;
  const axis = Array.from({ length: n }, (_, i) => i);

  const titleRow =
    '   ' + axis.map((z) => `z=${z}`.padEnd(n * 2 + 1)).join('  ');
  const rows: string[] = [titleRow];
  for (let y = n - 1; y >= 0; y--) {
    const slices = axis.map((z) =>
      axis.map((x) => glyphAt(g, `${x},${y},${z}`, s.lastMove)).join(' '),
    );
    rows.push(` ${y} ` + slices.join('    '));
  }
  const xLegend = '   ' + 'x:' + axis.join(' ');
  rows.push(xLegend);

  return `${header(s)}\n\n${rows.join('\n')}\n\nglyphs: O=white X=black ${EMPTY}=empty (lowercase = last move)`;
};

/** `list` — every placed stone, in play order isn't tracked so sorted by coord. */
const listView: View = (s) => {
  const g = s.game;
  if (!g) return header(s);
  const keys = Object.keys(g.pieces).sort();
  const body =
    keys.length === 0
      ? '  (empty board)'
      : keys
          .map((k) => {
            const mark = k === s.lastMove ? '  <- last' : '';
            return `  ${g.pieces[k]!.padEnd(5)} (${k})${mark}`;
          })
          .join('\n');
  return `${header(s)}\nStones (${keys.length}):\n${body}`;
};

export const VIEWS: Record<string, View> = {
  layers: layersView,
  list: listView,
};

export const DEFAULT_VIEW = 'layers';

export function render(s: Snapshot, viewName: string = DEFAULT_VIEW): string {
  const view = VIEWS[viewName] ?? VIEWS[DEFAULT_VIEW]!;
  return view(s);
}
