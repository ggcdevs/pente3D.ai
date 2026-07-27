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
