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
 * discipline: errors must propagate honestly and never be masked or swallowed). {@link VERB_ARITY}
 * declares, per verb, how many positionals may follow the room code; anything beyond that is named
 * back to the operator with the spelling they probably meant.
 */

/** A parsed command line: the verb, the room code (first positional), the rest, and the flags. */
export interface Args {
  readonly verb: string;
  readonly code: string | null;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

/**
 * Split `argv` into verb / positionals / flags. `--k v` takes the next token as its value unless
 * that token is itself a flag, in which case `--k` is a boolean.
 */
export function parseArgs(argv: readonly string[]): Args {
  const [verb = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }
  return { verb, code: positional[0] ?? null, positional, flags };
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
  const arity = VERB_ARITY[args.verb];
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
