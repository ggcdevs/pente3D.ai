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
import {
  CODELESS_VERBS,
  DEFAULT_WAIT_SECONDS,
  FLAG_KIND,
  VERB_ARITY,
  enterSeed,
  parseArgs,
  unexpectedPositional,
  unknownFlag,
  waitTimeout,
} from './args';

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

  it('treats a value flag with NOTHING after it as valueless `true`, for its reader to refuse', () => {
    // The end-of-argv case: there is no next token to take. It must land as `true` — the shape
    // `enterSeed`/`viewFromFlag`/`waitTimeout` each refuse by name — rather than reading past the
    // end of the command line.
    expect(cli('show', 'ABCDE', '--view').flags).toEqual({ view: true });
    expect(cli('wait', 'ABCDE', '--timeout').flags).toEqual({ timeout: true });
    expect(cli('enter', 'ABCDE', '--seed').flags).toEqual({ seed: true });
  });

  it('defaults to `help` with no arguments at all, and reports no code', () => {
    expect(cli()).toEqual({ verb: 'help', code: null, positional: [], flags: {} });
  });

  /**
   * THE `--flag=value` BYPASS. The parser understood only `--k v`, so `--k=v` produced a flag
   * literally NAMED `k=v`: `flags.view` and `flags.seed` stayed undefined, every refusal written
   * against them was unreachable, and the DEFAULT was taken silently. `--seed=new` is the damaging
   * half — the standard GNU spelling asked the daemon to ADOPT the peer's game when the operator
   * said start a fresh one, which is the #43/#46 inversion this whole module exists to refuse.
   *
   * Observed at the time, on the real binary:
   *
   *     pente quit ABCDE --view listt  -> '--view: unknown view "listt" …'  exit 2
   *     pente quit ABCDE --view=listt  -> 'no running daemon …'             exit 0
   *     enterSeed(parseArgs(['enter','ABCDE','--seed=new'])) -> { seed: 'defer' }
   */
  it('reads the `--k=v` spelling as the flag k, not as a flag named "k=v"', () => {
    expect(cli('show', 'ABCDE', '--view=layers-x').flags).toEqual({ view: 'layers-x' });
    expect(cli('enter', 'ABCDE', '--seed=new').flags).toEqual({ seed: 'new' });
  });

  it('THE BYPASS: `--seed=new` asks for new — it must never come out as `defer`', () => {
    expect(enterSeed(cli('enter', 'ABCDE', '--seed=new'))).toEqual({ seed: 'new' });
  });

  it('keeps an empty `--k=` as a value, so its own reader can refuse it by name', () => {
    // Not collapsed to `true`/absent: `--view=` must reach the view guard as "" and be named back,
    // rather than quietly becoming the default cut of the cube.
    expect(cli('show', 'ABCDE', '--view=').flags).toEqual({ view: '' });
  });

  it('keeps a value containing `=` intact — only the FIRST `=` separates', () => {
    expect(cli('show', 'ABCDE', '--view=a=b').flags).toEqual({ view: 'a=b' });
  });

  it('never lets a switch eat the next token, so `move --json 2,2,2` keeps its coordinate', () => {
    // `--json` is a switch: the old positional parse consumed whatever followed ANY flag, so the
    // coordinate became the value of `--json` and `move` reported "need a coordinate".
    expect(cli('move', 'ABCDE', '--json', '2,2,2')).toEqual({
      verb: 'move',
      code: 'ABCDE',
      positional: ['ABCDE', '2,2,2'],
      flags: { json: true },
    });
  });
});

/**
 * THE SILENTLY-IGNORED-FLAG REGRESSION TEST — the other half of the same rule.
 *
 * `VERB_ARITY` closed the positional half; the flag half stayed open, one keystroke away from the
 * form it fixed. Observed at the time:
 *
 *     ['enter','ABCDE','--seedd','new'] -> flags {"seedd":"new"} | unexpectedPositional: null
 *                                       -> enterSeed: {"seed":"defer"}   (the operator asked for NEW)
 *     ['show','ABCDE','--veiw','list']  -> viewFromFlag(undefined): {"view":"layers"}
 *     pente quit ABCDE --vew list       -> stderr '', exit 0
 */
describe('unknownFlag — a flag we do not understand is REFUSED, never ignored', () => {

  it('refuses an Object.prototype member as a flag — the whole chain, not just a sample', () => {
    // A raw index read on a plain object literal resolves EVERY inherited member to something that
    // is neither `undefined` nor `'switch'`, so each of these was accepted as a known flag and then
    // silently dropped: exit 0, empty stderr, the option ignored. Enumerated from the prototype
    // itself so a future member is covered the day it exists.
    for (const name of Object.getOwnPropertyNames(Object.prototype)) {
      const refusal = unknownFlag({ verb: 'show', code: 'ABCDEF', positional: ['ABCDEF'], flags: { [name]: true } });
      // (the flag name is in the loop variable; a failure names it in the diff)
      expect({ name, refusal }).not.toEqual({ name, refusal: null });
    }
  });
  it('THE BUG: a one-character typo on `--seed` is refused, not turned into `defer`', () => {
    const a = cli('enter', 'ABCDE', '--seedd', 'new');
    expect(enterSeed(a)).toEqual({ seed: 'defer' }); // what the daemon would have been asked for
    expect(unknownFlag(a)).toBe(
      'enter: unknown option "--seedd" — this CLI understands: ' +
        '--host, --json, --lossy, --seed, --silent, --timeout, --view',
    );
  });

  it('names the FLAG, not the token after it, when a typo strands a value as a positional', () => {
    // `--seedd` is unknown, so it does not consume `new` — which leaves `new` looking like the
    // stray positional of the ORIGINAL bug. Both gates have an opinion; `cli/main.ts` asks this one
    // first, because the operator's mistake is the flag and the positional is only its collateral.
    const a = cli('enter', 'ABCDE', '--seedd', 'new');
    expect(unexpectedPositional(a)).toContain('unexpected argument "new"');
    expect(unknownFlag(a)).toContain('unknown option "--seedd"');
  });

  it('refuses a typo on `--view` rather than downgrading it to the default cut', () => {
    expect(unknownFlag(cli('show', 'ABCDE', '--veiw', 'layers-x'))).toContain(
      'unknown option "--veiw"',
    );
  });

  it('refuses a typo on `--silent`, which used to make a NON-silent drop and report success', () => {
    // The #45 mirror case: `--silent` leaves via a graceful DISCONNECT so no Last-Will fires. A
    // mistyped one fired the Will, ran the OTHER branch, and the scenario still went green.
    expect(unknownFlag(cli('drop', 'ABCDE', '--silen'))).toContain('unknown option "--silen"');
    expect(unknownFlag(cli('drop', 'ABCDE', '--lossyy'))).toContain('unknown option "--lossyy"');
  });

  it.each(['json', 'host', 'silent', 'lossy'])(
    'refuses a value handed to the switch `--%s` — it is not the `true` its reader tests for',
    (name) => {
      expect(unknownFlag(cli('show', 'ABCDE', `--${name}=true`))).toBe(
        `show: --${name} is a switch and takes no value (got "true")`,
      );
    },
  );

  it.each(['view', 'seed', 'timeout'])(
    'lets the value flag `--%s` take the token after it, rather than refusing it as a switch',
    (name) => {
      // The other half of the same row: mislabelling a value flag as a switch would strand its
      // value as a positional, so both halves of `FLAG_KIND` have to be observable.
      expect(cli('show', 'ABCDE', `--${name}`, 'x').flags).toEqual({ [name]: 'x' });
      expect(cli('show', 'ABCDE', `--${name}`, 'x').positional).toEqual(['ABCDE']);
    },
  );

  it('does not let an UNKNOWN flag swallow the token after it', () => {
    // An unknown flag has no arity to guess at. If it ate the next token, `pente move ABCDE --wat
    // 2,2,2` would lose the coordinate as well as the flag.
    const a = cli('move', 'ABCDE', '--wat', '2,2,2');
    expect(a.flags).toEqual({ wat: true });
    expect(a.positional).toEqual(['ABCDE', '2,2,2']);
    expect(unknownFlag(a)).toContain('unknown option "--wat"');
  });

  it('accepts every flag the CLI genuinely reads, in both spellings', () => {
    for (const [name, kind] of Object.entries(FLAG_KIND)) {
      const argv = kind === 'switch' ? [`--${name}`] : [`--${name}`, 'x'];
      expect(unknownFlag(cli('show', 'ABCDE', ...argv))).toBeNull();
      expect(unknownFlag(cli('show', 'ABCDE', `--${name}${kind === 'switch' ? '' : '=x'}`))).toBeNull();
    }
  });

  it('says nothing when there are no flags at all', () => {
    expect(unknownFlag(cli('move', 'ABCDE', '2,2,2'))).toBeNull();
  });

  it('refuses a bare `--`, which is a flag with no name rather than a separator here', () => {
    expect(unknownFlag(cli('show', 'ABCDE', '--'))).toContain('unknown option "--"');
  });
});

/**
 * THE FLAG-TABLE COMPLETENESS TEST — `FLAG_KIND` checked against the code that READS `flags.x`.
 *
 * Same shape of second opinion as `VERB_ARITY is complete` below, and for the same reason: a table
 * cannot forget, but it CAN be incomplete or stale, and neither coverage nor mutation testing can
 * see a data row that was never written (or one nobody reads any more). Checked in BOTH directions —
 * a flag read with no row would be refused as unknown the moment someone used it; a row nobody reads
 * is a flag this CLI accepts and then silently ignores, which is the defect this table exists to end.
 */
describe('FLAG_KIND matches the flags the CLI actually reads', () => {
  /**
   * Every `flags.<name>` READ in the CLI's argv-consuming modules. Comments are stripped first:
   * these files describe the flag rules in prose, and a doc comment is not a read — counting one
   * would have this test demand a table row for whatever a sentence happened to mention.
   */
  const flagsRead = (): Set<string> => {
    const read = new Set<string>();
    for (const file of ['./main.ts', './args.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const m of src.matchAll(/\bflags\.([a-zA-Z]+)/g)) read.add(m[1]!);
    }
    return read;
  };

  it('finds the readers and sees the flags we know are read there', () => {
    // Anti-vacuity: a rename that made the regex match nothing would otherwise pass the check below
    // by finding no reads at all — the failure mode of every source-scanning test.
    const read = flagsRead();
    expect([...read].sort()).toContain('view');
    expect([...read].sort()).toContain('json');
    expect(read.size).toBeGreaterThan(4);
  });

  it('has a row for every flag the CLI reads — nothing read is refused as unknown', () => {
    expect([...flagsRead()].filter((f) => !Object.hasOwn(FLAG_KIND, f)).sort()).toEqual([]);
  });

  it('has no row nobody reads — nothing is accepted and then silently ignored', () => {
    const read = flagsRead();
    expect(Object.keys(FLAG_KIND).filter((f) => !read.has(f)).sort()).toEqual([]);
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

/**
 * THE WRONG-VALUE TEST — presence was checked against the dispatcher, the VALUE was not.
 *
 * "Every dispatched verb HAS a row" leaves the row's number free, and the zero-arity sweep above
 * derives its cases from `VERB_ARITY` itself — so a verb wrongly written as `0` is asserted to
 * refuse the argument it legitimately needs, and the suite calls that a pass. Only `move` and
 * `resolve` were protected, by two hand-written cases.
 *
 * Probed by adding a verb to `cli/main.ts` that reads `args.positional[1]` and giving it a row of
 * `annotate: 0`: all 106 cli tests stayed green while the real CLI answered
 * `annotate: unexpected argument "hello" — annotate takes no argument after the room code.` (exit 2).
 *
 * So the row is compared with the only thing that knows the truth: how deep into `args.positional`
 * the verb's own `case` block actually reaches.
 */
describe('VERB_ARITY is RIGHT — no verb is allotted fewer arguments than its case body reads', () => {
  /** verb -> highest `args.positional[N]` index its `case` block reads (0 if it reads none). */
  const positionalDepthByVerb = (): Record<string, number> => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const depth: Record<string, number> = {};
    for (const block of src.split(/\n(?=\s*case ')/)) {
      const labels = [...block.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]!);
      if (labels.length === 0) continue;
      const reads = [...block.matchAll(/args\.positional\[(\d+)\]/g)].map((m) => Number(m[1]));
      const max = reads.length === 0 ? 0 : Math.max(...reads);
      for (const v of labels) depth[v] = Math.max(depth[v] ?? 0, max);
    }
    return depth;
  };

  it('finds the dispatcher and sees the known argument-taking verbs', () => {
    // Anti-vacuity, again: these two are the verbs that genuinely read `positional[1]`, so a scan
    // that stopped working would fail here rather than pass the check below by matching nothing.
    const d = positionalDepthByVerb();
    expect(d['move']).toBe(1);
    expect(d['resolve']).toBe(1);
  });

  it('gives every verb at least as many arguments as its case body reads', () => {
    const d = positionalDepthByVerb();
    const short = Object.entries(d)
      .filter(([verb, read]) => {
        if (read === 0) return false;
        const base = CODELESS_VERBS.has(verb) ? 0 : 1; // positional[0] is the room code
        return read > (VERB_ARITY[verb] ?? 0) + base - 1;
      })
      .map(([v, r]) => `${v}: reads positional[${r}] but arity ${VERB_ARITY[v]}`);
    expect(short).toEqual([]);
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

/**
 * THE THIRD FLAG WITH THE SAME SWALLOW. `--seed` and `--view` both learned to refuse a valueless
 * flag; `--timeout` was left as `Number(args.flags.timeout ?? 55)` in the same switch statement, so:
 *
 *     pente wait CODE --timeout --json   -> Number(true)  === 1    → waited 1s, then printed
 *                                           "(still opponent's turn after 1s — run wait again)"
 *     pente wait CODE --timeout abc      -> Number('abc') === NaN  → request(…, { timeoutMs: NaN }, NaN)
 *
 * The first states a wrong number as an observed fact, which is the logging-discipline failure, not
 * merely a wrong default; the second reaches the client with no diagnostic at all.
 */
describe('waitTimeout — how long `pente wait` actually blocks', () => {
  it('defaults when no timeout is named', () => {
    expect(waitTimeout({})).toEqual({ seconds: DEFAULT_WAIT_SECONDS });
    expect(DEFAULT_WAIT_SECONDS).toBe(55);
  });

  it('takes the seconds the operator asked for, as a number', () => {
    expect(waitTimeout({ timeout: '30' })).toEqual({ seconds: 30 });
  });

  it('THE BUG: a valueless `--timeout` is refused, not silently waited-1-second', () => {
    expect(waitTimeout({ timeout: true })).toEqual({
      error: "wait: --timeout needs a value: 'pente wait <CODE> --timeout 30'",
    });
  });

  it('THE BUG: a non-numeric timeout is refused, not passed on as NaN', () => {
    expect(waitTimeout({ timeout: 'abc' })).toEqual({
      error: 'wait: --timeout: not a whole number of seconds (got "abc")',
    });
  });

  it.each(['', ' 30 ', '0x1e', '1e3', '-5', '2.5', '30s'])(
    'refuses "%s", which `Number()` alone would have reinterpreted or zeroed',
    (raw) => {
      expect(waitTimeout({ timeout: raw })).toEqual({
        error: `wait: --timeout: not a whole number of seconds (got "${raw}")`,
      });
    },
  );

  it('refuses a zero-second wait, which is a wait that never waits', () => {
    expect(waitTimeout({ timeout: '0' })).toEqual({
      error: 'wait: --timeout: not a whole number of seconds (got "0")',
    });
  });
});
