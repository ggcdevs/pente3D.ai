/**
 * PURE resolution vocabulary for a divergence (Task V.4b, epic **#47** — design §5; absorbs **#38**).
 *
 * ## What this is
 *
 * {@link reconcile} (V.4a) settles every case the turn gate can explain and sends the rest to the
 * players as `needs-resolution`, carrying the last common ancestor and a readable diff. THIS module
 * is the language the two players then speak: which of the three histories on the table — **mine**,
 * **theirs**, or the **shared ancestor** — the pair agrees to continue from, and what each side must
 * do to land on it.
 *
 * It invents NO second handshake. The agreement rides the SAME out-of-band N.1 primitive
 * (`handshake.ts`) that #12 rematch and #18 undo/redo already use: an opaque `action` tag, one pending
 * proposal at a time, resolved to accepted/declined, auto-cancelled when the peer drops. Nothing lands
 * until BOTH sides agree — the identical guarantee #18 has.
 *
 * ## Why the action names a HEAD HASH rather than a side
 *
 * The obvious encoding — `take-mine` / `take-theirs` on the wire — is **proposer-relative**, and that
 * is a bug waiting to happen: the responder has to invert it ("their *mine* is my *theirs*"), and the
 * inversion is only correct while both peers' divergence records are exact mirrors of each other. They
 * are not always mirrors. On a publicly-writable relay a third publisher can put a log in the room
 * that BOTH peers record as `theirs`, and the mirror assumption then lands the two peers on DIFFERENT
 * histories while both believe they agreed.
 *
 * So a resolution names its target ABSOLUTELY, by the {@link headHash} of the history to continue
 * from: `resolve:<headHash>`. The head hash already fingerprints game identity AND the whole history
 * (the uuid is folded into the chain seed), so the receiver can answer three questions with one
 * comparison — *is that my history, the divergent one, or the ancestor?* — and, crucially, can say
 * honestly that it is NONE of them rather than guess. Both peers therefore end on the same history by
 * construction, in the mirrored case and in the third-publisher case alike.
 *
 * ## Purity & layering
 *
 * Strings and comparisons only — no log, no transport, no DOM, no clock. The SESSION applies the
 * agreed effect ({@link ResolutionEffect}) through `SyncEngine.applyResolution`, which REPLAY-VALIDATES
 * any history it adopts (design §5 "Integrity") exactly as an automatic fast-forward does; the PANEL
 * renders {@link ResolutionChoice} through the pure `ui/widgets/divergenceModel.ts` view-model.
 */

/**
 * The three histories a divergence puts on the table, each by its {@link headHash}. `lca` is `null`
 * when the two logs share no ancestor at all (different games — {@link LastCommonAncestor}), in which
 * case there is nothing to rewind TO and that choice is simply not offered.
 */
export interface ResolutionCandidates {
  /** The head of MY current history. */
  readonly mine: string;
  /** The head of the DIVERGENT history the peer published. */
  readonly theirs: string;
  /** The head at the last point the two agreed, or `null` when they share no ancestor. */
  readonly lca: string | null;
}

/** A resolution in a player's terms — what the panel offers and what a proposal means. */
export type ResolutionChoice =
  /** Continue from MY history; the moves only the peer has are dropped. */
  | 'take-mine'
  /** Continue from THEIR history; the moves only I have are dropped. */
  | 'take-theirs'
  /** Both sides return to the last shared move; everything after it is dropped on both sides. */
  | 'rewind';

/** What the local engine must DO to land on an agreed history. */
export type ResolutionEffect =
  /** Keep the log we already hold, and put it back on the wire so the peer converges onto it. */
  | 'keep-mine'
  /** Adopt the divergent log (replay-validated first, like any adopted history). */
  | 'adopt-theirs'
  /** Cut our own log back to the last common ancestor. */
  | 'rewind-to-lca';

/**
 * The choice → local effect map. It is the SAME table on both sides because a
 * {@link ResolutionChoice} is derived from the ABSOLUTE target hash against the LOCAL candidates
 * (see {@link targetChoice}) — the proposer reads its own target as `take-mine`, the responder reads
 * that same hash as `take-theirs`, and both land on the one history.
 */
const EFFECT_OF: Readonly<Record<ResolutionChoice, ResolutionEffect>> = {
  'take-mine': 'keep-mine',
  'take-theirs': 'adopt-theirs',
  rewind: 'rewind-to-lca',
};

/** The local effect of an agreed {@link ResolutionChoice}. */
export function effectOf(choice: ResolutionChoice): ResolutionEffect {
  return EFFECT_OF[choice];
}

/**
 * The prefix that marks an N.1 `action` tag as a RESOLUTION rather than a rematch/undo/redo. The tag
 * is opaque to the handshake machine (it never interprets one), so the consumers are distinguished
 * purely by what they recognise here — which is what keeps #12/#18 and this one decoupled.
 */
export const RESOLVE_ACTION_PREFIX = 'resolve:';

/** The N.1 `action` tag proposing that both sides continue from the history whose head is `target`. */
export function resolutionAction(target: string): string {
  return `${RESOLVE_ACTION_PREFIX}${target}`;
}

/**
 * The head hash a resolution `action` names, or `null` if the tag is not a resolution at all (a
 * `'rematch'` / `'undo'` / `'redo'` ask, or a tag from some future consumer). An EMPTY target is
 * rejected too: `resolve:` names no history, so it can never match a candidate and must not be
 * mistaken for one that does.
 */
export function resolutionTarget(action: string): string | null {
  if (!action.startsWith(RESOLVE_ACTION_PREFIX)) return null;
  const target = action.slice(RESOLVE_ACTION_PREFIX.length);
  return target.length === 0 ? null : target;
}

/**
 * The head hash a {@link ResolutionChoice} names, given the local {@link ResolutionCandidates} — what
 * a proposer puts on the wire. `null` only for `rewind` when there is no shared ancestor.
 */
export function targetFor(choice: ResolutionChoice, candidates: ResolutionCandidates): string | null {
  switch (choice) {
    case 'take-mine':
      return candidates.mine;
    case 'take-theirs':
      return candidates.theirs;
    case 'rewind':
      return candidates.lca;
  }
}

/**
 * Read an ABSOLUTE `target` head hash as a choice IN LOCAL TERMS, or `null` when this client holds no
 * history with that head and therefore cannot honour the proposal (an honest decline, never a guess).
 *
 * The order is `mine` → `theirs` → `lca`, and the overlaps are deliberate rather than accidental:
 * when my own log IS the common ancestor (I am strictly behind) `take-mine` and `rewind` name the same
 * history, and when THEIR log is the ancestor (they are strictly behind) `take-theirs` and `rewind` do
 * — in both cases every matching arm lands on the identical log, so the first match is as correct as
 * any other and it is the one that describes the outcome in the plainest words.
 */
export function targetChoice(
  target: string,
  candidates: ResolutionCandidates,
): ResolutionChoice | null {
  if (target === candidates.mine) return 'take-mine';
  if (target === candidates.theirs) return 'take-theirs';
  if (candidates.lca !== null && target === candidates.lca) return 'rewind';
  return null;
}
