/**
 * THE SILENTLY-IGNORED-ARGUMENT REGRESSION TEST.
 *
 * `pente enter <CODE> new` used to be ACCEPTED and treated as `--seed defer`. The positional was
 * collected by the parser and never read by the `enter` case, so the daemon's own
 * `enter: want a seed of new | defer (got "X")` guard was unreachable from the CLI and a plausible
 * typo produced the OPPOSITE of the §3 seed the operator asked for: `defer` adopts a peer's
 * (or a breadcrumb's) existing game, where `new` starts over. That is the #43/#46 behaviour class the
 * `cli/scenarios/` matrix exists to protect, reachable by dropping two characters.
 *
 * Observed at the time, driving a real daemon through the scenario harness:
 *
 *     positional `enter bogus` -> ACCEPTED phase=connected (argument SILENTLY IGNORED)
 *     flag `--seed bogus`      -> REFUSED (parsed)
 *
 * The parse now lives in `cli/args.ts` precisely so that probe can be a unit test instead of a
 * throwaway script: `cli/main.ts` calls `main()` at import time and cannot be loaded to be asserted on.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CODELESS_VERBS, VERB_ARITY, enterSeed, parseArgs, unexpectedPositional } from './args';

/** Parse an argv the way `cli/main.ts` does (`process.argv.slice(2)`). */
const cli = (...argv: string[]) => parseArgs(argv);

/** An argv for `verb` carrying one stray argument, with a room code iff the verb takes one. */
const withStray = (verb: string): string[] =>
  CODELESS_VERBS.has(verb) ? [verb, 'stray'] : [verb, 'ABCDE', 'stray'];

describe('parseArgs — verb, room code, positionals, flags', () => {
  it('reads the verb and the room code, and keeps the rest positional', () => {
    expect(cli('move', 'ABCDE', '2,2,2')).toEqual({
      verb: 'move',
      code: 'ABCDE',
      positional: ['ABCDE', '2,2,2'],
      flags: {},
    });
  });

  it('takes the token after a `--flag` as its value', () => {
    expect(cli('enter', 'ABCDE', '--seed', 'new').flags).toEqual({ seed: 'new' });
  });

  it('treats a `--flag` followed by another flag as a boolean', () => {
    expect(cli('play', 'ABCDE', '--host', '--json').flags).toEqual({ host: true, json: true });
  });

  it('defaults to `help` with no arguments at all, and reports no code', () => {
    expect(cli()).toEqual({ verb: 'help', code: null, positional: [], flags: {} });
  });
});

describe('unexpectedPositional — an argument we do not understand is REFUSED, never ignored', () => {
  it('THE BUG: `enter <CODE> new` is refused, and says the seed is a flag', () => {
    const refusal = unexpectedPositional(cli('enter', 'ABCDE', 'new'));
    expect(refusal).toBe(
      'enter: unexpected argument "new" — enter takes no argument after the room code. ' +
        "The seed is a FLAG: 'pente enter <CODE> --seed new|defer'.",
    );
  });

  it('refuses a nonsense positional too — it must never reach the room as `defer`', () => {
    expect(unexpectedPositional(cli('enter', 'ABCDE', 'THIS-IS-NOT-A-SEED'))).toContain(
      'unexpected argument "THIS-IS-NOT-A-SEED"',
    );
  });

  it('allows the correct spelling — the seed as a flag', () => {
    expect(unexpectedPositional(cli('enter', 'ABCDE', '--seed', 'new'))).toBeNull();
  });

  it('lets each verb keep the arguments it genuinely takes', () => {
    expect(unexpectedPositional(cli('move', 'ABCDE', '2,2,2'))).toBeNull();
    expect(unexpectedPositional(cli('resolve', 'ABCDE', 'take-theirs'))).toBeNull();
    expect(unexpectedPositional(cli('status', 'ABCDE'))).toBeNull();
    expect(unexpectedPositional(cli('leave', 'ABCDE'))).toBeNull();
  });

  it('refuses a SECOND argument to a verb that takes one', () => {
    expect(unexpectedPositional(cli('move', 'ABCDE', '2,2,2', '3,3,3'))).toBe(
      'move: unexpected argument "3,3,3" — move takes 1 argument(s) after the room code.',
    );
  });

  it('refuses a stray argument on every zero-arity verb (the table is not just about `enter`)', () => {
    const zeroArity = Object.keys(VERB_ARITY).filter((v) => VERB_ARITY[v] === 0);
    // Named as a map, so a verb that silently starts ignoring arguments is identified by name in the
    // diff rather than hidden in a count.
    const refused = Object.fromEntries(
      zeroArity.map((v) => [v, unexpectedPositional(cli(...withStray(v))) !== null]),
    );
    expect(refused).toEqual(Object.fromEntries(zeroArity.map((v) => [v, true])));
    expect(zeroArity.length).toBeGreaterThan(10);
  });

  it('refuses a stray argument to `views`, which addresses no room at all', () => {
    // `pente views extra` printed the view list and exited 0 while `views` was missing from the
    // table; adding it at arity 0 alone would NOT have closed it, because the arity would still be
    // measured past a room code this verb never takes.
    expect(unexpectedPositional(cli('views', 'extra'))).toBe(
      'views: unexpected argument "extra" — views takes no arguments.',
    );
    expect(unexpectedPositional(cli('views'))).toBeNull();
  });

  it('refuses a stray argument to the scenario rewind verbs', () => {
    // The measuring instrument's own controls: `local-undo`/`local-redo` drive the FF-vs-divergence
    // scenarios, so an argument swallowed HERE is a swallow in the tool that exists to refuse them.
    expect(unexpectedPositional(cli('local-undo', 'ABCDE', 'stray'))).toBe(
      'local-undo: unexpected argument "stray" — local-undo takes no argument after the room code.',
    );
    expect(unexpectedPositional(cli('local-redo', 'ABCDE', 'new'))).toBe(
      'local-redo: unexpected argument "new" — local-redo takes no argument after the room code.',
    );
  });

  it('says nothing about a verb it does not know (the usage text is the honest answer there)', () => {
    expect(unexpectedPositional(cli('frobnicate', 'ABCDE', 'whatever'))).toBeNull();
  });
});

/**
 * THE INCOMPLETE-TABLE REGRESSION TEST — the arity table checked against something OUTSIDE itself.
 *
 * `VERB_ARITY` closes "a verb that forgot to read `positional[1]`" because a table cannot forget.
 * A table can still be INCOMPLETE, and it was: `cli/main.ts` dispatched `local-undo`, `local-redo`
 * and `views` with no row here, so `unexpectedPositional` took its `arity === undefined` early
 * return and accepted the stray argument. Observed at the time:
 *
 *     ["local-undo","ABCDE","stray"] -> null
 *     ["local-redo","ABCDE","new"]   -> null
 *     ["views","extra"]              -> null
 *     ["undo","ABCDE","stray"]       -> "undo: unexpected argument \"stray\" — …"   (in the table)
 *
 * No gate could see it: the suite above derives its cases from `Object.keys(VERB_ARITY)` — it
 * asserts the table against itself, so a MISSING row is invisible to it — and neither 100% coverage
 * nor mutation testing can see a data row that was never written. The dispatcher is the only honest
 * second opinion, so it is read here, from source.
 */
describe('VERB_ARITY is complete — every verb `cli/main.ts` dispatches has a row', () => {
  /** The verbs `cli/main.ts` actually handles: each `case '<verb>':` label in its switch. */
  const dispatched = (): string[] => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    return [...src.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]!);
  };

  it('finds the dispatcher and reads a plausible verb list out of it', () => {
    // Guards the regex itself: a switch rewritten into an object map would make the check below pass
    // vacuously by matching nothing, which is the failure mode of every source-scanning test.
    expect(dispatched()).toContain('enter');
    expect(dispatched().length).toBeGreaterThan(10);
  });

  it('leaves no dispatched verb unchecked', () => {
    // `Object.hasOwn`, not `v in VERB_ARITY`: `in` walks the prototype chain, so a verb named
    // `constructor` or `valueOf` would report itself covered by a row nobody wrote — the same
    // inherited-member trap that let `--view valueOf` past the CLI's view guard.
    expect(dispatched().filter((v) => !Object.hasOwn(VERB_ARITY, v))).toEqual([]);
  });
});

describe('enterSeed — what `enter` actually asks the daemon for', () => {
  it("defaults to 'defer' when no seed is named (dealer's choice, design §3)", () => {
    expect(enterSeed(cli('enter', 'ABCDE'))).toEqual({ seed: 'defer' });
  });

  it("asks for 'new' when the operator asked for new — it does NOT quietly defer", () => {
    expect(enterSeed(cli('enter', 'ABCDE', '--seed', 'new'))).toEqual({ seed: 'new' });
  });

  it('passes an unknown seed THROUGH, so the daemon guard that owns the vocabulary is reachable', () => {
    // The refusal a user sees for this is `enter: want a seed of new | defer (got "bogus")`, minted
    // by cli/daemon.ts. Duplicating the list here would shadow that guard and let the two drift.
    expect(enterSeed(cli('enter', 'ABCDE', '--seed', 'bogus'))).toEqual({ seed: 'bogus' });
  });

  it('refuses a valueless `--seed` instead of collapsing it to `defer`', () => {
    // `--seed --json` parses the flag as `true`; the old code's `typeof … === 'string'` test turned
    // that into a silent `defer` — the same swallow, one layer up.
    expect(enterSeed(cli('enter', 'ABCDE', '--seed', '--json'))).toEqual({
      error: "enter: --seed needs a value: 'pente enter <CODE> --seed new|defer'",
    });
  });
});
