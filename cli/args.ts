/**
 * The `pente` CLI's argument parse — PURE, so the rules below are unit-testable without a daemon,
 * a relay, or a process.
 *
 * ## Why this is its own module
 *
 * It used to live inside `cli/main.ts`, which calls `main()` at import time: nothing could load the
 * parser to assert on it, so the parse was covered only by whatever a live scenario happened to
 * exercise. That is how `pente enter ABCDE new` came to be accepted and SILENTLY treated as
 * `--seed defer` — the positional was collected and never read, the daemon's
 * `enter: want a seed of new | defer` guard was unreachable from the CLI, and a plausible typo
 * quietly produced the opposite of the §3 seed the operator asked for (adopt a peer's game instead
 * of starting a new one — the #43/#46 behaviour class the scenarios exist to protect).
 *
 * ## The rule
 *
 * An argument this CLI does not understand is REFUSED, never ignored (agent-principles, logging
 * discipline: errors must propagate honestly and never be masked or swallowed). That rule covers
 * BOTH halves of a command line, because a swallow does not care which half it hides in:
 *
 *   · positionals — {@link VERB_ARITY} declares, per verb, how many may follow the room code;
 *   · flags — {@link FLAG_KIND} declares every flag name this CLI reads, and whether it takes a
 *     value. {@link unknownFlag} refuses anything else.
 *
 * The flag half was open for a full stage after the positional half was closed, which is the whole
 * argument for stating the rule over the command line rather than over one token type: `pente enter
 * ABCDE --seedd new` parsed, dropped `--seedd` on the floor and asked the daemon for `defer` — the
 * exact "adopt a peer's game when the operator said `new`" inversion described above, reachable by
 * adding one character instead of by dropping two. Same for `pente drop CODE --silen`, which made a
 * NON-silent drop and so ran the opposite branch of the #45 mirror case while reporting success.
 */

/** A parsed command line: the verb, the room code (first positional), the rest, and the flags. */
export interface Args {
  readonly verb: string;
  readonly code: string | null;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

/**
 * Whether a flag carries a value (`--view layers`) or is a bare switch (`--json`).
 *
 * This is the CLI's whole flag vocabulary, declared as data in one place. It is checked against
 * `cli/main.ts` + this file — the code that actually READS `flags.x` — by `args.test.ts`, in both
 * directions: a flag read with no row here would be refused as unknown, and a row nobody reads is a
 * flag this CLI accepts and then ignores. Either way the table is compared with something outside
 * itself, never with itself.
 *
 * The check is global rather than per-verb because two of these are read through helpers shared by
 * every branch (`--view` before the switch, `--json` inside `output`/`jsonMode`), so a per-verb
 * source scan could not see who reads them and would be sound only by accident.
 */
export const FLAG_KIND: Readonly<Record<string, 'value' | 'switch'>> = {
  view: 'value', // the board rendering — cli/views.ts owns the name vocabulary
  seed: 'value', // enter's §3 seed — cli/daemon.ts owns the `new | defer` vocabulary
  timeout: 'value', // wait's budget in seconds
  json: 'switch', // print the raw snapshot instead of a board
  host: 'switch', // play: take the host seat
  silent: 'switch', // drop: graceful DISCONNECT, so no Last-Will fires (the #45 mirror case)
  lossy: 'switch', // drop: throw away publishes made while down instead of queueing them
};

/**
 * Split `argv` into verb / positionals / flags.
 *
 * Three shapes are understood, and they are understood by NAME rather than by position:
 *
 *   · `--k=v` — the GNU spelling. It used to parse as a flag literally named `k=v`, which meant
 *     `flags.view` stayed undefined and `--view=layerz` sailed past main's refusal into the default
 *     board, and `--seed=new` reached the daemon as `defer`: the standard spelling silently produced
 *     the OPPOSITE seed, bypassing a guard written specifically to stop that.
 *   · `--k v` — only for a flag {@link FLAG_KIND} declares as `value`, and only when `v` is not
 *     itself a flag. Nothing else eats the next token: `pente move ABCDE --json 2,2,2` keeps its
 *     coordinate instead of feeding it to `--json`, and an UNKNOWN flag does not guess at an arity
 *     it has no row for — `--vew list` leaves `list` alone rather than swallowing it, so the
 *     refusal `cli/main.ts` prints names the flag the operator got wrong.
 *   · `--k` — a switch, or (for a value flag) the valueless shape `true`, which each reader refuses
 *     by name rather than collapsing to a default.
 */
export function parseArgs(argv: readonly string[]): Args {
  const [verb = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const next = rest[i + 1];
      if (FLAG_KIND[body] === 'value' && next !== undefined && !next.startsWith('--')) {
        flags[body] = next;
        i++;
      } else flags[body] = true;
    } else positional.push(a);
  }
  return { verb, code: positional[0] ?? null, positional, flags };
}

/** The flag names this CLI understands, in a stable order, for a refusal message. */
function flagList(): string {
  return Object.keys(FLAG_KIND)
    .sort()
    .map((k) => `--${k}`)
    .join(', ');
}

/**
 * The refusal for a flag this CLI does not understand, or `null` when every flag is known.
 *
 * Two ways to be wrong, both of which used to be silent:
 *
 *   · a name nobody reads (`--vew list`, `--silen`) — collected by the parser and dropped, so the
 *     command did something OTHER than what was typed and exited 0 saying nothing;
 *   · a value handed to a switch (`--json=true`), which is not the `true` its reader tests for and
 *     so turned the switch off while looking like it turned it on.
 *
 * Returned rather than printed so the decision is testable as a value; `cli/main.ts` prints it and
 * exits non-zero, in the same place it checks {@link unexpectedPositional}.
 */
export function unknownFlag(args: Args): string | null {
  for (const [name, value] of Object.entries(args.flags)) {
    // `Object.hasOwn`, never a raw index read. `FLAG_KIND` is a plain object literal, so
    // `FLAG_KIND['constructor']` (or `toString`, `valueOf`, `__proto__`…) resolves to an INHERITED
    // member that is neither `undefined` nor `'switch'` — every such flag would be accepted as known
    // and then silently dropped, exit 0 and empty stderr. Same defect, same fix as `isViewName`.
    const kind = Object.hasOwn(FLAG_KIND, name) ? FLAG_KIND[name] : undefined;
    if (kind === undefined) {
      return `${args.verb}: unknown option "--${name}" — this CLI understands: ${flagList()}`;
    }
    if (kind === 'switch' && typeof value === 'string') {
      return `${args.verb}: --${name} is a switch and takes no value (got "${value}")`;
    }
  }
  return null;
}

/**
 * How many positionals each verb takes AFTER the room code. A verb absent from this table is not
 * checked (an unknown verb falls through to the usage text, which is the honest answer there).
 *
 * Declared as data, once, rather than as a per-verb `if`: the failure this closes was a verb that
 * simply forgot to look at `positional[1]`, and a table cannot forget.
 *
 * A table CAN, however, be incomplete — which is the same swallow wearing a different hat, and is
 * exactly what happened: `local-undo`, `local-redo` and `views` were dispatched by `cli/main.ts` and
 * missing here, so `unexpectedPositional` took its `arity === undefined` early return and accepted
 * the stray argument (observed: `["local-undo","ABCDE","stray"] -> null`). The two `local-*` verbs
 * are the scenario tooling's own rewind controls, so a typo'd argument was swallowed by the very
 * instrument that exists to refuse swallows. `args.test.ts` now checks this table against
 * `cli/main.ts`'s dispatcher rather than against itself — a table that cannot forget must be
 * compared with something outside it.
 */
export const VERB_ARITY: Readonly<Record<string, number>> = {
  play: 0,
  show: 0,
  status: 0,
  wait: 0,
  drop: 0,
  restore: 0,
  move: 1, // the coordinate: `pente move ABCDE 2,2,2`
  undo: 0,
  redo: 0,
  'local-undo': 0, // scenario tooling: rewind THIS peer only (see the daemon's `local-undo` case)
  'local-redo': 0,
  resolve: 1, // the choice: `pente resolve ABCDE take-theirs`
  agree: 0,
  refuse: 0,
  rematch: 0,
  accept: 0,
  decline: 0,
  leave: 0,
  enter: 0, // the seed is a FLAG (`--seed new|defer`), never a positional
  quit: 0,
  views: 0, // takes no room code either — see CODELESS_VERBS
};

/**
 * Verbs that address no room at all, so their own arguments start at `positional[0]` rather than at
 * `positional[1]`. Without this, `views: 0` would still accept `pente views extra` — the arity would
 * be measured past a room code that verb never takes, which is how `pente views extra` printed the
 * view list and exited 0.
 */
export const CODELESS_VERBS: ReadonlySet<string> = new Set(['views']);

/** Verb-specific advice appended to the refusal — the spelling the operator most likely meant. */
const ARITY_HINT: Readonly<Record<string, string>> = {
  enter: "The seed is a FLAG: 'pente enter <CODE> --seed new|defer'.",
};

/**
 * The refusal message for an argument this verb does not take, or `null` when the command line is
 * within the verb's arity.
 *
 * Returned rather than printed so the decision is testable as a value; `cli/main.ts` prints it and
 * exits non-zero.
 */
export function unexpectedPositional(args: Args): string | null {
  // Own-property only, for the same reason as `unknownFlag`: `VERB_ARITY['toString']` would
  // otherwise resolve to an inherited function and be used as an arity.
  const arity = Object.hasOwn(VERB_ARITY, args.verb) ? VERB_ARITY[args.verb] : undefined;
  if (arity === undefined) return null;
  // positional[0] is the room code, so the verb's own arguments start at 1 — except for a verb that
  // takes no room code, whose own arguments start at 0.
  const codeless = CODELESS_VERBS.has(args.verb);
  const extra = args.positional[(codeless ? 0 : 1) + arity];
  if (extra === undefined) return null;
  const takes = codeless
    ? 'takes no arguments'
    : arity === 0
      ? 'takes no argument after the room code'
      : `takes ${arity} argument(s) after the room code`;
  const hint = ARITY_HINT[args.verb];
  return `${args.verb}: unexpected argument "${extra}" — ${args.verb} ${takes}.${hint === undefined ? '' : ` ${hint}`}`;
}

/**
 * The §3 seed `pente enter` will ask the daemon for, or the refusal to print.
 *
 * The seed VOCABULARY (`new` / `defer`) is deliberately NOT re-validated here: `cli/daemon.ts` owns
 * it, and routing the value there unchanged is what keeps its
 * `enter: want a seed of new | defer (got "X")` guard reachable — and therefore exercised — instead
 * of shadowed by a second copy of the same list that could drift from it. What this DOES refuse is
 * the shape the daemon can never see: `--seed` with no value at all, which the flag parser turns
 * into `true` and which the old code quietly collapsed to `defer`.
 */
export function enterSeed(args: Args): { readonly seed: string } | { readonly error: string } {
  const raw = args.flags.seed;
  if (raw === undefined) return { seed: 'defer' };
  if (typeof raw !== 'string') {
    return { error: "enter: --seed needs a value: 'pente enter <CODE> --seed new|defer'" };
  }
  return { seed: raw };
}

/** How long `pente wait` blocks when `--timeout` is not given, in seconds. */
export const DEFAULT_WAIT_SECONDS = 55;

/**
 * The number of seconds `pente wait` will block for, or the refusal to print.
 *
 * `--timeout` was the third flag with the swallow the other two had already closed, left open in the
 * same switch statement: `const timeoutS = Number(args.flags.timeout ?? 55)` turned the valueless
 * `--timeout` into `Number(true) === 1`, so `pente wait CODE --timeout --json` waited ONE second and
 * then reported "(still opponent's turn after 1s)" — a wrong number stated as an observed fact — and
 * `--timeout abc` became `NaN`, which flowed into `request(…, { timeoutMs: NaN }, NaN)` with no
 * diagnostic at all.
 *
 * Lives here, as a value-returning pure function like {@link enterSeed}, precisely so both of those
 * are unit-assertable: `cli/main.ts` runs `main()` at import time and cannot be loaded to be
 * asserted on, which is why the defect survived inside it.
 */
export function waitTimeout(
  flags: Args['flags'],
): { readonly seconds: number } | { readonly error: string } {
  const raw = flags.timeout;
  if (raw === undefined) return { seconds: DEFAULT_WAIT_SECONDS };
  if (typeof raw !== 'string') {
    return { error: "wait: --timeout needs a value: 'pente wait <CODE> --timeout 30'" };
  }
  // `Number()` alone accepts '', ' 5 ', '0x1e' and '1e3'; a seconds budget is a plain whole number,
  // and anything else is a typo we must name rather than silently reinterpret.
  if (!/^[0-9]+$/.test(raw) || Number(raw) === 0) {
    return { error: `wait: --timeout: not a whole number of seconds (got "${raw}")` };
  }
  return { seconds: Number(raw) };
}
