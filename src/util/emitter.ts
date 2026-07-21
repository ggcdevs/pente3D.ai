/**
 * A PURE, dependency-free typed event-emitter factory (Menu & live-settings batch, Task A.1 —
 * GitHub issue #15).
 *
 * ## Why this exists
 *
 * The live-settings work needs a general pub/sub primitive so that `setConfig` / `resetConfig`
 * can notify subscribers of the changed section (A.2's `onConfigChange`) without per-site
 * boilerplate. Rather than reinvent an emitter at each call site, this factory produces one typed,
 * self-contained emitter. It is reused later by the handshake / notification tickets and by the
 * #26 `scene.onStateChange` retrofit.
 *
 * ## Placement — imports NOTHING
 *
 * This module imports nothing (no THREE, no DOM, no browser globals, not even other repo modules),
 * so any layer — INCLUDING the pure `src/core` — may use it without violating the eslint boundary
 * rule. It carries the strict pure-logic gate (Vitest unit + fast-check property tests + Stryker
 * mutation + 100% coverage via the `src/util/**` pins already in `vite.config.ts` /
 * `stryker.config.mjs`).
 *
 * ## Contract
 *
 * `createEmitter<T>()` returns an object with:
 *   - `emit(payload: T): void` — invokes all CURRENT listeners, in subscription order, passing the
 *     payload through by reference (no copy). See the snapshot note below for re-entrancy.
 *   - `subscribe(fn): () => void` — registers `fn` and returns an unsubscribe function that removes
 *     EXACTLY that subscription. Subscribing the same function twice creates two independent
 *     subscriptions (each fires, each has its own unsubscribe). Calling an unsubscribe more than
 *     once is a harmless no-op — it never removes a different subscription.
 *
 * Each `createEmitter()` owns its own listener list in closure; two emitters share no state.
 *
 * ## Per-emit snapshot (re-entrancy safety)
 *
 * `emit` iterates over a SNAPSHOT of the listener list taken at the start of that emit. A listener
 * that subscribes or unsubscribes DURING an emit therefore does not affect the in-flight emit's
 * iteration: a newly-added listener waits for the NEXT emit, and a listener removed mid-emit still
 * runs for the emit already in progress (it was captured in the snapshot) but is absent from the
 * next. This makes mutation during dispatch neither skip nor double-invoke any listener — the exact
 * hazard that a naive splice-while-iterating over the live array would introduce.
 */

/** The pub/sub surface returned by {@link createEmitter}. */
export interface Emitter<T> {
  /** Invoke all current listeners, in subscription order, with `payload` (passed by reference). */
  emit(payload: T): void;
  /**
   * Register `fn`; returns an unsubscribe fn that removes exactly this subscription. Idempotent —
   * calling the returned fn again is a no-op and never removes another subscription.
   */
  subscribe(fn: (payload: T) => void): () => void;
}

/**
 * Create an independent typed emitter (see file header for the full contract). Imports nothing, so
 * it is usable from any layer including `src/core`.
 */
export function createEmitter<T>(): Emitter<T> {
  // Closure-local listener list — private to this emitter instance, so two emitters never share
  // state. An array (not a Set) preserves subscription order and lets the SAME function subscribe
  // more than once as distinct entries. Each entry is a fresh wrapper object whose identity is the
  // subscription key, so unsubscribe removes exactly its own entry regardless of fn equality.
  interface Entry {
    fn: (payload: T) => void;
  }
  const listeners: Entry[] = [];

  return {
    emit(payload: T): void {
      // Snapshot the current entries so that subscribing/unsubscribing from within a listener does
      // not alter THIS dispatch (re-entrancy safety — see file header). A shallow copy is enough:
      // entries are never mutated in place, only added to / removed from `listeners`.
      const snapshot = listeners.slice();
      for (const entry of snapshot) {
        entry.fn(payload);
      }
    },

    subscribe(fn: (payload: T) => void): () => void {
      const entry: Entry = { fn };
      listeners.push(entry);
      return (): void => {
        const i = listeners.indexOf(entry);
        // indexOf returns -1 once this entry has already been removed, so a second (or later) call
        // finds nothing to splice — the idempotent no-op that must not touch any other entry.
        if (i !== -1) {
          listeners.splice(i, 1);
        }
      };
    },
  };
}
