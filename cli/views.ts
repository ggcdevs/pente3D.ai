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
import type { LinkStatus } from './netlink';
import type { DivergenceView } from '../src/ui/widgets/divergenceModel';

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
  /**
   * The TRANSPORT link, distinct from the session `phase`: a dropped socket
   * (`drop`, or a real outage) leaves the session `connected` while the link is
   * `down` — the exact split issue #45 lives in.
   */
  readonly link: LinkStatus;
  /**
   * The open DIVERGENCE (V.4b, #38), or `null` when there is nothing to resolve — the SAME pure
   * view-model the browser panel paints (`src/ui/widgets/divergenceModel.ts`), so a scenario script
   * and a player see identical facts. Its presence means the two peers hold histories that cannot
   * both be right and neither side will adopt automatically: `pente resolve` / `pente agree` is the
   * way out.
   */
  readonly divergence: DivergenceView | null;
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
  // A dropped link is called out loudly: the session still says `connected`, so without
  // this the board looks authoritative while it is quietly frozen in the past (#45).
  const link = s.link === 'down' ? ' · LINK DOWN (offline)' : '';
  lines.push(`Room ${s.code} · you are ${seat} · phase ${s.phase} · opponent ${opp}${link}`);
  // A divergence is called out ABOVE the board, because the board below it is one of two histories
  // and nothing will converge until the two players agree which (V.4b).
  const d = s.divergence;
  if (d !== null) {
    lines.push(`OUT OF STEP — you agree up to move ${d.sharedPly}, then you differ:`);
    lines.push(`  only yours:  ${d.mine.map((m) => m.text).join(', ') || '(nothing)'}`);
    lines.push(`  only theirs: ${d.theirs.map((m) => m.text).join(', ') || '(nothing)'}`);
    if (d.incomingText !== null) lines.push(`  ${d.incomingText}  →  pente agree | pente refuse`);
    else if (d.ui === 'waiting') lines.push('  waiting for your opponent to agree…');
    else lines.push(`  pente resolve <${d.options.map((o) => o.choice).join(' | ')}>`);
  }
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

type Axis = 'x' | 'y' | 'z';

/** For a given slice axis, which axis is the panels' rows and which is the columns. */
const FRAME: Record<Axis, { row: Axis; col: Axis }> = {
  z: { row: 'y', col: 'x' }, // the original layout — up is y, across is x
  y: { row: 'z', col: 'x' },
  x: { row: 'z', col: 'y' },
};

function keyFor(sliceAxis: Axis, s: number, row: Axis, r: number, col: Axis, c: number): string {
  const v: Record<Axis, number> = { x: 0, y: 0, z: 0 };
  v[sliceAxis] = s;
  v[row] = r;
  v[col] = c;
  return `${v.x},${v.y},${v.z}`;
}

/**
 * Build a "matrix of matrices" view that slices the cube along `sliceAxis`: the N
 * slices sit side by side, each a 2D grid over the other two axes (rows high→low so
 * "up is up"). `layers` slices along z (the original); `layers-y` / `layers-x` cut
 * the other ways — handy when the action has flattened onto one plane. The last move
 * shows as a lowercase glyph.
 */
function makeSlicesView(sliceAxis: Axis): View {
  const { row, col } = FRAME[sliceAxis];
  return (s) => {
    const g = s.game;
    if (!g) return header(s);
    const n = g.size;
    const axis = Array.from({ length: n }, (_, i) => i);

    const titleRow = '   ' + axis.map((v) => `${sliceAxis}=${v}`.padEnd(n * 2 + 1)).join('  ');
    const rows: string[] = [titleRow];
    for (let r = n - 1; r >= 0; r--) {
      const panels = axis.map((sv) =>
        axis.map((c) => glyphAt(g, keyFor(sliceAxis, sv, row, r, col, c), s.lastMove)).join(' '),
      );
      rows.push(` ${r} ` + panels.join('    '));
    }
    rows.push('   ' + `${col}:` + axis.join(' ') + `   (rows = ${row})`);

    return `${header(s)}\n\n${rows.join('\n')}\n\nglyphs: O=white X=black ${EMPTY}=empty (lowercase = last move)`;
  };
}

const layersView = makeSlicesView('z');

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
  layers: layersView, // z-slices (default)
  'layers-z': layersView,
  'layers-y': makeSlicesView('y'),
  'layers-x': makeSlicesView('x'),
  list: listView,
};

export const DEFAULT_VIEW = 'layers';

export function render(s: Snapshot, viewName: string = DEFAULT_VIEW): string {
  const view = VIEWS[viewName] ?? VIEWS[DEFAULT_VIEW]!;
  return view(s);
}
