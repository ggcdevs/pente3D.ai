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
import type { EndState } from '../src/net/endState';

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
   * The live game's IDENTITY (`Game.uuid`), or `null` offline. A room code is pure rendezvous and a
   * game is a UUID with no mapping between them (design §2), so "did re-using this code start a
   * DIFFERENT game?" is a question only this field can answer — the board being empty is not the
   * same fact (a fresh game and a rewound one both look empty).
   */
  readonly gameUuid: string | null;
  /**
   * The authoritative log's `headHash` — the fingerprint of identity + whole history, or `null`
   * offline. Two peers holding the same head hold the same game AND the same line of play, which is
   * what "converged" means; two boards that merely look alike do not prove it (an undo leaves the
   * board bare with the history real).
   */
  readonly headHash: string | null;
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
  /**
   * The networked END-STATE view-model (N.2, #12) — the SAME pure `deriveEndState` the browser's
   * overlay paints, so the CLI sees a finished game and the rematch ask exactly as a player does.
   * Always present (`show` is `false` while a game is in progress); `rematchUi` is what a scenario
   * reads to prove an ask really reached the OTHER client instead of trusting a publish.
   */
  readonly endState: EndState;
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
  // The GAME identity, short: a room code names no game (design §2), so when a re-used code hands you
  // a board you did not expect, this is the field that says whether it is a different game.
  const game = s.gameUuid === null ? '' : ` · game ${s.gameUuid.slice(0, 8)}`;
  lines.push(`Room ${s.code} · you are ${seat} · phase ${s.phase} · opponent ${opp}${game}${link}`);
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
      // The rematch ask, in the same words the browser overlay uses (N.2): a player must be able to
      // see an incoming ask, not just answer one they were told about out of band.
      const e = s.endState;
      if (e.rematchPrompt !== null) lines.push(`  ${e.rematchPrompt}  →  pente accept | pente decline`);
      else if (e.rematchUi === 'proposed-waiting') lines.push('  waiting for your opponent to accept the rematch…');
      else if (e.rematchUi === 'declined') lines.push('  the rematch was declined');
      else if (e.rematchUi === 'idle') lines.push('  pente rematch  (colours alternate)');
    } else {
      const yours = s.canPlace;
      lines.push(
        `Turn: ${g.turn.toUpperCase()} ${yours ? '— YOUR MOVE' : '(opponent) — waiting'}` +
          `   captures W${g.captures.white} B${g.captures.black} · ply ${s.ply}`,
      );
    }
    if (s.lastMove) lines.push(`Last move: ${lastMoveDesc(g, s.lastMove)}`);
  } else if (s.joinError) {
    lines.push(`join error: ${s.joinError}`);
  }
  return lines.join('\n');
}

/**
 * The last move in words: `black @ (1,1,1)`, or `? @ (…)` for a node the game does not hold.
 *
 * The game and the node are PARAMETERS rather than re-derived from the `Snapshot`, because the one
 * caller has already established both (it is inside `if (g)` / `if (s.lastMove)`). The previous
 * signature re-tested `s.lastMove && s.game` inside, a condition that was true on every reachable
 * call — an unfalsifiable branch. Making the precondition a TYPE removes it instead of asserting it:
 * there is now nothing to test and nothing that can go untested (agent-principles: a guard no input
 * can falsify is redundant code wearing a disguise).
 *
 * `?` is kept and is NOT redundant: a `lastMove` naming a node the game does not hold is exactly the
 * stale-`lastMove` defect `cli/lastMove.ts` exists to prevent, and printing `?` reports it honestly
 * instead of hiding it.
 */
function lastMoveDesc(g: GameState, lastMove: string): string {
  return `${g.pieces[lastMove] ?? '?'} @ (${lastMove})`;
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
