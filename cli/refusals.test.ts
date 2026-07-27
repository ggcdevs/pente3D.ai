/**
 * THE GLUE-TIER REFUSAL TEST — the real `pente` binary, run as a process.
 *
 * `cli/args.ts` and `cli/views.ts` decide the refusals as VALUES, and their unit suites assert those
 * values. Neither can prove `cli/main.ts` actually *asks* — it calls `main()` at import time, so it
 * cannot be loaded and asserted on, and it is (correctly) outside both the coverage and the mutation
 * scopes as the CLI's argv/`console`/`process.exit` boundary. That gap is where both defects this
 * file pins actually lived:
 *
 *   · `pente views extra` printed the view list and exited 0 — `views` had no `VERB_ARITY` row.
 *   · `pente show <CODE> --view valueOf` passed main's `VIEWS[v] ? v : DEFAULT_VIEW` guard, because
 *     that truthiness test answers YES for every `Object.prototype` member, and then crashed inside
 *     `render` with `TypeError: Cannot convert undefined or null to object`.
 *   · `pente show <CODE> --view layerz` printed a z-slice board, silently, exit 0.
 *
 * So the assertion is made where the operator makes it: spawn the CLI, read the exit code and what
 * it wrote to stderr. Every case here is refused BEFORE any daemon socket is touched, which is both
 * the behaviour under test (a typo must not cost a round trip, or worse, a wrong-looking board) and
 * why this needs no relay, no daemon and no network.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CLI_DIR, '..');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const MAIN = path.join(CLI_DIR, 'main.ts');

/** Run the real CLI with `argv` and report exactly what an operator would see. */
function pente(...argv: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [TSX, MAIN, ...argv], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('the real CLI refuses an unknown --view instead of downgrading it', () => {
  it('a typo is named back, with the list `pente views` prints, and exits 2', () => {
    const r = pente('show', 'ABCDE', '--view', 'layerz');
    expect(r.stderr.trim()).toBe(
      '--view: unknown view "layerz" — available views: layers, layers-z, layers-y, layers-x, list',
    );
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  it.each(['toString', 'valueOf', 'hasOwnProperty', 'constructor'])(
    'refuses the Object.prototype member `%s` by name — it never reaches render',
    (name) => {
      const r = pente('show', 'ABCDE', '--view', name);
      expect(r.stderr.trim()).toBe(
        `--view: unknown view "${name}" — available views: layers, layers-z, layers-y, layers-x, list`,
      );
      // The crash this replaces. Asserted by absence AND by the exit code: a `TypeError` out of
      // `render` left status 1 and this text on stderr.
      expect(r.stderr).not.toContain('Cannot convert undefined or null to object');
      expect(r.status).toBe(2);
    },
  );

  it('accepts a registered view (the refusal is about the name, not about --view)', () => {
    // `quit` needs no daemon to answer honestly, so this reaches the verb rather than the guard.
    const r = pente('quit', 'ABCDE', '--view', 'layers-x');
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe('no running daemon (or it already exited).');
    expect(r.status).toBe(0);
  });
});

describe('the real CLI refuses a stray positional on the verbs the table used to miss', () => {
  it('`views extra` is refused — it used to print the list and exit 0', () => {
    const r = pente('views', 'extra');
    expect(r.stderr.trim()).toBe('views: unexpected argument "extra" — views takes no arguments.');
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  it('`views` alone still lists the registered views', () => {
    const r = pente('views');
    expect(r.stdout.trim()).toBe('available views: layers, layers-z, layers-y, layers-x, list (default: layers)');
    expect(r.status).toBe(0);
  });

  it.each([
    ['local-undo', 'stray'],
    ['local-redo', 'new'],
  ])('`%s ABCDE %s` is refused — the scenario tooling swallows nothing either', (verb, stray) => {
    const r = pente(verb, 'ABCDE', stray);
    expect(r.stderr.trim()).toBe(
      `${verb}: unexpected argument "${stray}" — ${verb} takes no argument after the room code.`,
    );
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });
});

/**
 * THE `--flag=value` BYPASS, AT THE BOUNDARY. `cli/args.test.ts` asserts the parse; this asserts
 * that the operator's own command line reaches it, because the bypass was invisible to every unit:
 * `--view=layerz` parsed as a flag NAMED `view=layerz`, `flags.view` stayed undefined, and the
 * refusal at `cli/main.ts` never fired. Observed at HEAD, on this binary:
 *
 *     pente quit ABCDE --view listt  -> '--view: unknown view "listt" …'   exit 2
 *     pente quit ABCDE --view=listt  -> 'no running daemon …'              exit 0
 */
describe('the real CLI refuses an unknown --view in the `--view=NAME` spelling too', () => {
  it('`--view=layerz` is named back and exits 2, exactly like `--view layerz`', () => {
    const r = pente('quit', 'ABCDE', '--view=layerz');
    expect(r.stderr.trim()).toBe(
      '--view: unknown view "layerz" — available views: layers, layers-z, layers-y, layers-x, list',
    );
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  it('accepts a registered view in that spelling — the refusal is about the name, not the `=`', () => {
    const r = pente('quit', 'ABCDE', '--view=layers-x');
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe('no running daemon (or it already exited).');
    expect(r.status).toBe(0);
  });
});

/**
 * THE SILENTLY-IGNORED-FLAG BYPASS, AT THE BOUNDARY. Unknown flags were collected by the parser and
 * dropped: `pente quit ABCDE --vew list` wrote nothing to stderr and exited 0. That matters most for
 * the measuring instrument — `pente drop CODE --silen` performed a NON-silent drop, so a scenario
 * written to exercise the #45 mirror case fired a Last-Will, took the other branch, and reported
 * green.
 */
describe('the real CLI refuses a flag it does not understand', () => {
  const KNOWN = '--host, --json, --lossy, --seed, --silent, --timeout, --view';

  it.each([
    ['quit', '--vew', 'list'],
    ['enter', '--seedd', 'new'],
  ])('`%s ABCDE %s %s` is refused, naming the flag and the ones that exist', (verb, bad, val) => {
    const r = pente(verb, 'ABCDE', bad, val);
    expect(r.stderr.trim()).toBe(`${verb}: unknown option "${bad}" — this CLI understands: ${KNOWN}`);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  it('`drop --silen` is refused — it used to perform the opposite kind of drop, silently', () => {
    const r = pente('drop', 'ABCDE', '--silen');
    expect(r.stderr.trim()).toBe(`drop: unknown option "--silen" — this CLI understands: ${KNOWN}`);
    expect(r.status).toBe(2);
  });

  it('`--json=true` is refused — a value on a switch is not the `true` its reader tests for', () => {
    const r = pente('quit', 'ABCDE', '--json=true');
    expect(r.stderr.trim()).toBe('quit: --json is a switch and takes no value (got "true")');
    expect(r.status).toBe(2);
  });

  it('lets the real flags through untouched', () => {
    const r = pente('quit', 'ABCDE', '--json', '--view', 'list');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});

/**
 * THE `--timeout` SWALLOW, AT THE BOUNDARY. `Number(args.flags.timeout ?? 55)` made a valueless
 * `--timeout` into `Number(true) === 1`, so `pente wait CODE --timeout --json` waited one second and
 * then STATED "(still opponent's turn after 1s)" — a wrong number reported as an observed fact.
 */
describe('the real CLI refuses a --timeout it cannot read as seconds', () => {
  it('a valueless `--timeout` is refused before any daemon is contacted', () => {
    const r = pente('wait', 'ABCDE', '--timeout', '--json');
    expect(r.stderr.trim()).toBe("wait: --timeout needs a value: 'pente wait <CODE> --timeout 30'");
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  it('a non-numeric `--timeout` is refused instead of reaching the client as NaN', () => {
    const r = pente('wait', 'ABCDE', '--timeout', 'abc');
    expect(r.stderr.trim()).toBe('wait: --timeout: not a whole number of seconds (got "abc")');
    expect(r.status).toBe(2);
  });

  it('a trailing `--timeout` with nothing after it is refused, not read past the end of argv', () => {
    const r = pente('wait', 'ABCDE', '--timeout');
    expect(r.stderr.trim()).toBe("wait: --timeout needs a value: 'pente wait <CODE> --timeout 30'");
    expect(r.status).toBe(2);
  });

  it('a trailing `--view` with nothing after it is refused, not collapsed to the default cut', () => {
    const r = pente('show', 'ABCDE', '--view');
    expect(r.stderr.trim()).toBe(
      "--view needs a value: 'pente <verb> <CODE> --view layers|layers-z|layers-y|layers-x|list'",
    );
    expect(r.status).toBe(2);
  });
});

/**
 * THE NONSENSE BOARD, AT THE BOUNDARY. `PENTE_BOARD_SIZE=abc` used to resolve to `NaN` and
 * `PENTE_BOARD_SIZE=` to `0`, and a daemon started on that board — every render, coordinate check
 * and scenario assertion past that point meaningless, with nothing said. The unit test in
 * `cli/relay.test.ts` pins the value; this pins that the process actually stops.
 */
describe('the real CLI refuses to start on a nonsense board size', () => {
  it('names the variable and the value, and does not run the verb', () => {
    const r = spawnSync(process.execPath, [TSX, MAIN, 'views'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, PENTE_BOARD_SIZE: 'abc' },
    });
    expect(r.stderr).toContain('PENTE_BOARD_SIZE: not a positive whole number of cells (got "abc")');
    expect(r.stdout).toBe('');
    expect(r.status).not.toBe(0);
  });

  it('still runs the verb on a board size it CAN read (the refusal is about the value)', () => {
    const r = spawnSync(process.execPath, [TSX, MAIN, 'views'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, PENTE_BOARD_SIZE: '7' },
    });
    expect(r.stdout.trim()).toBe(
      'available views: layers, layers-z, layers-y, layers-x, list (default: layers)',
    );
    expect(r.status).toBe(0);
  });
});
