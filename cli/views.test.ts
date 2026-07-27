/**
 * The CLI's board VIEWS — the measuring instrument's own readout.
 *
 * `cli/views.ts` is what a scenario script and a human operator both READ. Every claim a
 * `cli/scenarios/*.scenario.ts` run makes about "what the other client actually received"
 * (agent-principles #3) is read back through these strings, so a view that renders the wrong glyph,
 * the wrong axis, or a stale "last move" does not merely look bad — it makes a green scenario a lie.
 * That is why this file asserts WHOLE rendered outputs character-for-character rather than sampling
 * `toContain`: a mutated separator, a flipped comparison or an off-by-one row is only visible in the
 * complete frame.
 *
 * The board used throughout is deliberately ASYMMETRIC (a 2×2×2 with one stone per plane and the
 * last move on a corner), so slicing along x, y and z produce three DIFFERENT pictures — a frame
 * table that swapped two axes would still render a plausible-looking cube on a symmetric board.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, VIEWS, isViewName, render, viewFromFlag, viewNames, type Snapshot } from './views';
import type { GameState } from '../src/core/gameState';
import { HIDDEN_END_STATE, type EndState } from '../src/net/endState';
import type { DivergenceView } from '../src/ui/widgets/divergenceModel';

/**
 * A 2×2×2 board whose four stones sit on four different (x,y,z) planes.
 *
 * `pieces` is written in an order that is NOT the sorted key order on purpose: `list` sorts, and a
 * mutant that drops the `.sort()` would otherwise render identically.
 */
const BOARD: GameState = {
  size: 2,
  pieces: { '1,1,1': 'black', '0,0,0': 'white', '1,0,0': 'white', '0,1,0': 'black' },
  turn: 'black',
  captures: { white: 1, black: 0 },
  winner: null,
};

const SNAP: Snapshot = {
  code: 'ABCDE',
  seat: 'white',
  phase: 'connected',
  peerPresent: true,
  joinError: null,
  canPlace: false,
  ply: 4,
  lastMove: '1,1,1',
  seatOwners: { white: 'p-me', black: 'p-them' },
  game: BOARD,
  gameUuid: '0123456789abcdef',
  headHash: 'deadbeefcafe',
  link: 'up',
  divergence: null,
  endState: HIDDEN_END_STATE,
};

const snap = (patch: Partial<Snapshot> = {}): Snapshot => ({ ...SNAP, ...patch });
const lines = (...parts: string[]): string => parts.join('\n');

/** The three header lines the default snapshot produces — every view opens with exactly these. */
const HEADER = [
  'Room ABCDE · you are WHITE · phase connected · opponent present · game 01234567',
  'Turn: BLACK (opponent) — waiting   captures W1 B0 · ply 4',
  'Last move: black @ (1,1,1)',
];

const GLYPH_KEY = 'glyphs: O=white X=black ·=empty (lowercase = last move)';

/** `list` renders a short, fully-assertable body — so header variants are checked through it. */
const LIST_BODY = [
  'Stones (4):',
  '  white (0,0,0)',
  '  black (0,1,0)',
  '  white (1,0,0)',
  '  black (1,1,1)  <- last',
];

/**
 * A whole `list` render for a given header. Returns the EXPECTED string rather than asserting it —
 * an assertion hidden inside a helper is invisible to `vitest/expect-expect`, which is the lint gate
 * that stops a test from silently asserting nothing at all.
 */
const listWith = (...header: string[]): string => lines(...header, ...LIST_BODY);

describe('slice views — the cube cut along each axis', () => {
  it('`layers` stacks the z-slices, rows high→low, last move lowercase', () => {
    expect(render(snap(), 'layers')).toBe(
      lines(
        ...HEADER,
        '',
        '   z=0    z=1  ',
        // z=0 holds black at (0,1,0) and the two white stones on its bottom row;
        // z=1 holds only the last move at (1,1,1), rendered lowercase.
        ' 1 X ·    · x',
        ' 0 O O    · ·',
        '   x:0 1   (rows = y)',
        '',
        GLYPH_KEY,
      ),
    );
  });

  it('`layers-z` is the same cut as `layers` (the explicit spelling of the default)', () => {
    expect(render(snap(), 'layers-z')).toBe(render(snap(), 'layers'));
    expect(VIEWS['layers-z']).toBe(VIEWS['layers']);
  });

  it('`layers-y` cuts along y: panels are y, rows are z, columns are x', () => {
    expect(render(snap(), 'layers-y')).toBe(
      lines(
        ...HEADER,
        '',
        '   y=0    y=1  ',
        ' 1 · ·    · x',
        ' 0 O O    X ·',
        '   x:0 1   (rows = z)',
        '',
        GLYPH_KEY,
      ),
    );
  });

  it('`layers-x` cuts along x: panels are x, rows are z, columns are y', () => {
    expect(render(snap(), 'layers-x')).toBe(
      lines(
        ...HEADER,
        '',
        '   x=0    x=1  ',
        ' 1 · ·    · x',
        ' 0 O X    O ·',
        '   y:0 1   (rows = z)',
        '',
        GLYPH_KEY,
      ),
    );
  });

  it('the three cuts of the SAME board disagree — an axis swap cannot hide', () => {
    const [z, y, x] = [render(snap(), 'layers'), render(snap(), 'layers-y'), render(snap(), 'layers-x')];
    expect(new Set([z, y, x]).size).toBe(3);
  });

  it('with no last move, the corner stone is an ordinary uppercase glyph', () => {
    expect(render(snap({ lastMove: null }), 'layers')).toBe(
      lines(
        ...HEADER.slice(0, 2),
        '',
        '   z=0    z=1  ',
        ' 1 X ·    · X',
        ' 0 O O    · ·',
        '   x:0 1   (rows = y)',
        '',
        GLYPH_KEY,
      ),
    );
  });

  it('lowercases a WHITE last move too — both colours have their own marker', () => {
    // The black last move is exercised above; without this the white entry of the lowercase glyph
    // table is never rendered, and a `white: ''` table would still draw a plausible board.
    expect(render(snap({ lastMove: '0,0,0' }), 'layers')).toBe(
      lines(
        HEADER[0]!,
        HEADER[1]!,
        'Last move: white @ (0,0,0)',
        '',
        '   z=0    z=1  ',
        ' 1 X ·    · X',
        ' 0 o O    · ·',
        '   x:0 1   (rows = y)',
        '',
        GLYPH_KEY,
      ),
    );
  });

  it('scales to a 3×3×3 — the title row, row range and column legend all follow `size`', () => {
    const g: GameState = { ...BOARD, size: 3, pieces: { '2,2,2': 'white' }, captures: { white: 0, black: 0 } };
    expect(render(snap({ game: g, lastMove: null, ply: 1 }), 'layers')).toBe(
      lines(
        'Room ABCDE · you are WHITE · phase connected · opponent present · game 01234567',
        'Turn: BLACK (opponent) — waiting   captures W0 B0 · ply 1',
        '',
        '   z=0      z=1      z=2    ',
        ' 2 · · ·    · · ·    · · O',
        ' 1 · · ·    · · ·    · · ·',
        ' 0 · · ·    · · ·    · · ·',
        '   x:0 1 2   (rows = y)',
        '',
        GLYPH_KEY,
      ),
    );
  });

  it('shows the header alone when there is no game to draw', () => {
    expect(render(snap({ game: null, lastMove: null }), 'layers')).toBe(HEADER[0]);
  });
});

describe('`list` view — every placed stone', () => {
  it('sorts by coord and marks the last move', () => {
    expect(render(snap(), 'list')).toBe(lines(...HEADER, ...LIST_BODY));
  });

  it('says so when the board is empty (and the header reports the phantom last move honestly)', () => {
    expect(render(snap({ game: { ...BOARD, pieces: {} } }), 'list')).toBe(
      lines(
        HEADER[0]!,
        'Turn: BLACK (opponent) — waiting   captures W1 B0 · ply 4',
        // `?` is the honest readout for a lastMove naming a node the game does not hold — the
        // stale-lastMove defect cli/lastMove.ts exists to prevent, reported rather than hidden.
        'Last move: ? @ (1,1,1)',
        'Stones (0):',
        '  (empty board)',
      ),
    );
  });

  it('shows the header alone when there is no game to list', () => {
    expect(render(snap({ game: null, lastMove: null }), 'list')).toBe(HEADER[0]);
  });
});

describe('header — the status line every view opens with', () => {
  it('reports no seat, an absent opponent, a dropped link and no game identity', () => {
    expect(
      render(
        snap({ seat: null, peerPresent: false, link: 'down', gameUuid: null, game: null, joinError: null }),
        'list',
      ),
    ).toBe('Room ABCDE · you are — · phase connected · opponent waiting… · LINK DOWN (offline)');
  });

  it('prints the join error when there is no game because joining failed', () => {
    expect(render(snap({ game: null, joinError: 'that seat is taken' }), 'list')).toBe(
      lines(HEADER[0]!, 'join error: that seat is taken'),
    );
  });

  it('calls the move YOURS when this client may place', () => {
    expect(render(snap({ canPlace: true }), 'list')).toBe(
      listWith(HEADER[0]!, 'Turn: BLACK — YOUR MOVE   captures W1 B0 · ply 4', HEADER[2]!),
    );
  });

  it('a `none` link is not announced — only a DOWN link is', () => {
    expect(render(snap({ link: 'none' }), 'list')).toBe(listWith(...HEADER));
  });
});

describe('header — a finished game and the rematch ask', () => {
  const won = (winner: 'white' | 'black', endState: EndState = HIDDEN_END_STATE): Snapshot =>
    snap({ game: { ...BOARD, winner }, endState });

  it('says YOU won when the winner is this seat, and offers the rematch', () => {
    expect(render(won('white'), 'list')).toBe(
      listWith(
          HEADER[0]!,
          'GAME OVER — WHITE wins (you!)',
          '  pente rematch  (colours alternate)',
          HEADER[2]!,
      ),
    );
  });

  it('does NOT claim the win when the other seat won', () => {
    expect(render(won('black'), 'list')).toBe(
      listWith(
        HEADER[0]!,
        'GAME OVER — BLACK wins',
        '  pente rematch  (colours alternate)',
        HEADER[2]!,
      ),
    );
  });

  it('shows an INCOMING rematch ask with the verbs that answer it', () => {
    const endState: EndState = {
      ...HIDDEN_END_STATE,
      rematchUi: 'incoming',
      rematchPrompt: 'Black wants a rematch',
    };
    expect(render(won('black', endState), 'list')).toBe(
      listWith(
        HEADER[0]!,
        'GAME OVER — BLACK wins',
        '  Black wants a rematch  →  pente accept | pente decline',
        HEADER[2]!,
      ),
    );
  });

  it('shows OUR ask still waiting on an answer', () => {
    expect(render(won('white', { ...HIDDEN_END_STATE, rematchUi: 'proposed-waiting' }), 'list')).toBe(
      listWith(
        HEADER[0]!,
        'GAME OVER — WHITE wins (you!)',
        '  waiting for your opponent to accept the rematch…',
        HEADER[2]!,
      ),
    );
  });

  it('reports a declined rematch', () => {
    expect(render(won('white', { ...HIDDEN_END_STATE, rematchUi: 'declined' }), 'list')).toBe(
      listWith(
        HEADER[0]!,
        'GAME OVER — WHITE wins (you!)',
        '  the rematch was declined',
        HEADER[2]!,
      ),
    );
  });

  it('says nothing about the rematch once it was ACCEPTED — there is nothing left to ask', () => {
    expect(render(won('white', { ...HIDDEN_END_STATE, rematchUi: 'accepted' }), 'list')).toBe(
      listWith(
        HEADER[0]!,
        'GAME OVER — WHITE wins (you!)',
        HEADER[2]!,
      ),
    );
  });
});

describe('header — an open divergence is called out ABOVE the board', () => {
  const DIVERGENCE: DivergenceView = {
    show: true,
    headline: 'Your game and your opponent’s have gone out of step',
    explanation: 'you agree up to move 2',
    sharedPly: 2,
    // TWO entries on BOTH sides: a one-item list renders identically however the items are
    // joined, so a single `mine` move left the `, ` separator untested on that line.
    mine: [
      { ply: 2, text: 'white (1,1,1)' },
      { ply: 3, text: 'black (0,0,2)' },
    ],
    theirs: [
      { ply: 2, text: 'black (0,0,1)' },
      { ply: 3, text: 'white (2,2,2)' },
    ],
    options: [
      { choice: 'take-mine', label: 'Keep mine', detail: '…' },
      { choice: 'take-theirs', label: 'Take theirs', detail: '…' },
    ],
    ui: 'choose',
    incomingText: null,
    canAccept: true,
    note: null,
  };

  /** Rendered with no game, so the assertion is the divergence block and nothing else. */
  const diverged = (patch: Partial<DivergenceView>): string =>
    render(snap({ game: null, divergence: { ...DIVERGENCE, ...patch } }), 'list');

  it('lists both tails and the resolutions on offer', () => {
    expect(diverged({})).toBe(
      lines(
        HEADER[0]!,
        'OUT OF STEP — you agree up to move 2, then you differ:',
        '  only yours:  white (1,1,1), black (0,0,2)',
        '  only theirs: black (0,0,1), white (2,2,2)',
        '  pente resolve <take-mine | take-theirs>',
      ),
    );
  });

  it('says `(nothing)` for a side that holds no divergent move of its own', () => {
    expect(diverged({ mine: [], theirs: [], sharedPly: 0, options: [{ choice: 'rewind', label: 'R', detail: '…' }] })).toBe(
      lines(
        HEADER[0]!,
        'OUT OF STEP — you agree up to move 0, then you differ:',
        '  only yours:  (nothing)',
        '  only theirs: (nothing)',
        '  pente resolve <rewind>',
      ),
    );
  });

  it('offers the ANSWER verbs when the peer has asked to settle it', () => {
    expect(diverged({ ui: 'incoming', incomingText: 'they ask to continue from their history', options: [] })).toBe(
      lines(
        HEADER[0]!,
        'OUT OF STEP — you agree up to move 2, then you differ:',
        '  only yours:  white (1,1,1), black (0,0,2)',
        '  only theirs: black (0,0,1), white (2,2,2)',
        '  they ask to continue from their history  →  pente agree | pente refuse',
      ),
    );
  });

  it('says we are waiting when OUR ask is outstanding', () => {
    expect(diverged({ ui: 'waiting', incomingText: null })).toBe(
      lines(
        HEADER[0]!,
        'OUT OF STEP — you agree up to move 2, then you differ:',
        '  only yours:  white (1,1,1), black (0,0,2)',
        '  only theirs: black (0,0,1), white (2,2,2)',
        '  waiting for your opponent to agree…',
      ),
    );
  });

  it('shows the board BELOW the divergence — the game is still readable while unsettled', () => {
    expect(render(snap({ divergence: DIVERGENCE }), 'list')).toBe(
      lines(
        HEADER[0]!,
        'OUT OF STEP — you agree up to move 2, then you differ:',
        '  only yours:  white (1,1,1), black (0,0,2)',
        '  only theirs: black (0,0,1), white (2,2,2)',
        '  pente resolve <take-mine | take-theirs>',
        ...HEADER.slice(1),
        ...LIST_BODY,
      ),
    );
  });
});

describe('render — the view registry', () => {
  it('defaults to `layers` when no view is named', () => {
    expect(render(snap())).toBe(render(snap(), 'layers'));
    expect(DEFAULT_VIEW).toBe('layers');
  });

  it('a view name nobody registered is REFUSED, not silently downgraded', () => {
    // This used to assert the OPPOSITE — that `render` fell back to the default — which pinned a
    // swallow as intended behaviour: `pente show ABCDE --view layerz` printed a z-slice board
    // character-for-character identical to `layers`, so an operator who asked for one cut of the
    // cube read another with no diagnostic. `cli/args.ts` states the rule this now obeys: an
    // argument this CLI does not understand is REFUSED, never ignored.
    expect(() => render(snap(), 'layerz')).toThrow(
      'unknown view: layerz — available views: layers, layers-z, layers-y, layers-x, list',
    );
    expect(() => render(snap(), 'no-such-view')).toThrow(/^unknown view: no-such-view/);
  });

  it('honours an explicitly named view over the default', () => {
    expect(render(snap(), 'list')).not.toBe(render(snap(), DEFAULT_VIEW));
    expect(render(snap(), 'list')).toBe(VIEWS['list']!(snap()));
  });

  it('registers exactly the documented view names', () => {
    expect(Object.keys(VIEWS).sort()).toEqual(['layers', 'layers-x', 'layers-y', 'layers-z', 'list']);
  });

  it('`viewNames` is the registry itself, in registration order — the list every refusal quotes', () => {
    expect(viewNames()).toEqual(['layers', 'layers-z', 'layers-y', 'layers-x', 'list']);
  });
});

/**
 * THE PROTOTYPE-MEMBER REGRESSION TEST.
 *
 * `VIEWS` is a plain object, so `VIEWS[name]` resolves every `Object.prototype` member, and both the
 * registry lookup (`VIEWS[viewName] ?? VIEWS[DEFAULT_VIEW]`) and the real CLI's `--view` guard
 * (`VIEWS[v] ? v : DEFAULT_VIEW`, cli/main.ts) were truthiness tests — so the fallback could never
 * fire for these four names and `pente show <CODE> --view valueOf` passed the guard and then crashed
 * inside `render`. Observed on the implementation this test was written against:
 *
 *     --view toString       passes main.ts:34 guard = true · render -> "[object Undefined]"
 *     --view constructor    passes main.ts:34 guard = true · render -> {"code":"ABCDE",…}
 *     --view valueOf        passes main.ts:34 guard = true · render -> THROWS: Cannot convert
 *                                                                     undefined or null to object
 *     --view hasOwnProperty passes main.ts:34 guard = true · render -> THROWS: (same)
 *
 * Two returned garbage where a board belonged and two threw a `TypeError` naming nothing useful.
 * The measuring instrument the scenario matrix reads its evidence THROUGH must not do either, so
 * membership is asked with `Object.hasOwn` and the whole prototype chain is pinned here.
 */
describe('view names inherited from Object.prototype are NOT registered views', () => {
  for (const name of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
    it(`\`${name}\` is refused by name, not resolved off the prototype`, () => {
      expect(isViewName(name)).toBe(false);
      expect(() => render(snap(), name)).toThrow(`unknown view: ${name} — available views:`);
      expect(viewFromFlag(name)).toEqual({
        error: `--view: unknown view "${name}" — available views: layers, layers-z, layers-y, layers-x, list`,
      });
    });
  }

  it('says YES for every name that really is registered', () => {
    expect(viewNames().map(isViewName)).toEqual([true, true, true, true, true]);
  });
});

describe('viewFromFlag — what `--view` actually selects, decided once', () => {
  it('defaults to `layers` when no view is named', () => {
    expect(viewFromFlag(undefined)).toEqual({ view: DEFAULT_VIEW });
  });

  it('passes a registered name through unchanged', () => {
    expect(viewFromFlag('layers-x')).toEqual({ view: 'layers-x' });
    expect(viewFromFlag('list')).toEqual({ view: 'list' });
  });

  it('REFUSES a typo instead of quietly handing back the default', () => {
    // `layers-Y` is the realistic typo: capitalised, one keystroke from a real cut of the cube, and
    // under the old rule it printed the z-slices with no diagnostic at all.
    expect(viewFromFlag('layers-Y')).toEqual({
      error: '--view: unknown view "layers-Y" — available views: layers, layers-z, layers-y, layers-x, list',
    });
  });

  it('refuses a valueless `--view` instead of collapsing it to the default', () => {
    // `--view --json` parses the flag as `true` — the same swallow `enterSeed` refuses for `--seed`.
    expect(viewFromFlag(true)).toEqual({
      error: "--view needs a value: 'pente <verb> <CODE> --view layers|layers-z|layers-y|layers-x|list'",
    });
  });
});
