/**
 * Tests for the PURE, dependency-free typed event-emitter factory {@link createEmitter}
 * (Menu & live-settings batch, Task A.1 — GitHub issue #15).
 *
 * ## Why this exists
 *
 * `createEmitter<T>()` is the shared pub/sub primitive backing config's `onConfigChange`
 * (A.2) and, later, the handshake/notification tickets and the #26 `scene.onStateChange`
 * retrofit. It must be:
 *   - INDEPENDENT per instance — two emitters never share listeners (no module-global state);
 *   - order-preserving — `emit` invokes CURRENT listeners in subscription order;
 *   - precise on unsubscribe — the returned fn removes EXACTLY that listener, and calling it
 *     twice is a no-op (does not remove an unrelated listener that happens to be equal);
 *   - re-entrancy-safe — adding or removing a listener DURING an `emit` must not skip or
 *     double-invoke the listeners of that in-flight emit (per-emit snapshot).
 *
 * These tests assert on OBSERVED BEHAVIOR — the actual call sequence / payloads received /
 * invocation counts recorded by real listener functions — never on a log line
 * (agent-principles #2/#3). Each behavioural guarantee has a test that FAILS if the
 * corresponding mechanism is removed (agent-principles #7): drop the per-emit snapshot and
 * the re-entrancy tests break; drop the identity-based removal and the unsubscribe tests
 * break; share state across instances and the isolation test breaks. No volatile fact is
 * hardcoded (agent-principles #8).
 */

import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { createEmitter } from './emitter.ts';

describe('createEmitter', () => {
  it('delivers the exact payload to a single subscriber', () => {
    const e = createEmitter<number>();
    const seen: number[] = [];
    e.subscribe((n) => seen.push(n));
    e.emit(42);
    expect(seen).toEqual([42]);
  });

  it('delivers a structured payload by reference (no copying/wrapping)', () => {
    // The emitter must pass the payload through untouched — same object identity, not a clone.
    const e = createEmitter<{ section: string }>();
    const payload = { section: 'colors' };
    let received: { section: string } | undefined;
    e.subscribe((p) => {
      received = p;
    });
    e.emit(payload);
    expect(received).toBe(payload);
  });

  it('invokes all subscribers, in subscription order, on a single emit', () => {
    const e = createEmitter<string>();
    const order: string[] = [];
    e.subscribe(() => order.push('a'));
    e.subscribe(() => order.push('b'));
    e.subscribe(() => order.push('c'));
    e.emit('x');
    // Order-preserving: a mutant that reverses/reorders iteration breaks this literal.
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('invokes each subscriber exactly once per emit, and once more per subsequent emit', () => {
    const e = createEmitter<void>();
    const fn = vi.fn();
    e.subscribe(fn);
    e.emit();
    e.emit();
    e.emit();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does nothing (and does not throw) when emitting with no subscribers', () => {
    const e = createEmitter<number>();
    expect(() => e.emit(1)).not.toThrow();
  });

  it('registers the SAME function twice as two independent subscriptions', () => {
    // Two subscribe() calls with the same fn ⇒ two invocations per emit; unsubscribing one
    // leaves the other. This pins that the store is subscription-keyed, not fn-keyed (a Set of
    // fns would collapse the two — a real behavioural difference, not padding).
    const e = createEmitter<void>();
    const fn = vi.fn();
    const off1 = e.subscribe(fn);
    e.subscribe(fn);
    e.emit();
    expect(fn).toHaveBeenCalledTimes(2);
    off1();
    e.emit();
    expect(fn).toHaveBeenCalledTimes(3); // only the second subscription survives
  });

  // --- UNSUBSCRIBE ------------------------------------------------------------------------
  it('unsubscribe removes exactly that listener and leaves the others firing', () => {
    const e = createEmitter<string>();
    const order: string[] = [];
    e.subscribe(() => order.push('a'));
    const offB = e.subscribe(() => order.push('b'));
    e.subscribe(() => order.push('c'));

    offB();
    e.emit('x');
    // b is gone; a and c remain, still in order.
    expect(order).toEqual(['a', 'c']);
  });

  it('calling an unsubscribe twice is a no-op (does not remove a different listener)', () => {
    const e = createEmitter<void>();
    const a = vi.fn();
    const b = vi.fn();
    const offA = e.subscribe(a);
    e.subscribe(b);

    offA();
    offA(); // second call must be a harmless no-op...
    e.emit();
    // ...and must NOT have removed b.
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('after unsubscribing all listeners, emit is a silent no-op', () => {
    const e = createEmitter<number>();
    const fn = vi.fn();
    const off = e.subscribe(fn);
    off();
    e.emit(7);
    expect(fn).not.toHaveBeenCalled();
  });

  // --- INSTANCE ISOLATION -----------------------------------------------------------------
  it('two emitters are fully independent — no shared or global listener state', () => {
    const e1 = createEmitter<string>();
    const e2 = createEmitter<string>();
    const seen1: string[] = [];
    const seen2: string[] = [];
    e1.subscribe((s) => seen1.push(s));
    e2.subscribe((s) => seen2.push(s));

    e1.emit('one');
    // e2's listener must NOT fire on e1's emit, and vice-versa.
    expect(seen1).toEqual(['one']);
    expect(seen2).toEqual([]);

    e2.emit('two');
    expect(seen1).toEqual(['one']);
    expect(seen2).toEqual(['two']);
  });

  // --- RE-ENTRANCY: mutate the listener set DURING an emit --------------------------------
  it('a listener SUBSCRIBED during an emit is NOT invoked by that same emit', () => {
    // Per-emit snapshot: the newcomer must wait for the NEXT emit, so the in-flight emit does
    // not run a just-added listener. Without a snapshot (iterating the live set), the newcomer
    // would fire immediately — this test catches that.
    const e = createEmitter<void>();
    const late = vi.fn();
    let added = false;
    e.subscribe(() => {
      if (!added) {
        added = true;
        e.subscribe(late);
      }
    });

    e.emit();
    expect(late).not.toHaveBeenCalled(); // did not fire during the emit that added it
    e.emit();
    expect(late).toHaveBeenCalledTimes(1); // fires on the next emit
  });

  it('a listener UNSUBSCRIBED during an emit STILL runs for that in-flight emit but not after', () => {
    // Per-emit snapshot again: once an emit has begun, its listener set is fixed. A listener the
    // FIRST listener unsubscribes is already in this emit's snapshot, so it still runs this time;
    // it is gone from the NEXT emit. Iterating the live set would let the removal skip it mid-emit
    // (index shift) — this asserts the opposite.
    const e = createEmitter<void>();
    const victim = vi.fn();
    let removed = false;
    let off = (): void => {};
    e.subscribe(() => {
      if (!removed) {
        removed = true;
        off();
      }
    });
    off = e.subscribe(victim);

    e.emit();
    expect(victim).toHaveBeenCalledTimes(1); // still ran this emit (was in the snapshot)
    e.emit();
    expect(victim).toHaveBeenCalledTimes(1); // gone from the next emit
  });

  it('removing an EARLIER, not-yet-invoked listener during an emit does not skip a later one', () => {
    // Classic live-mutation bug: listener[0] removes listener[1] while we iterate; a naive
    // splice-and-continue would shift indices and skip listener[2]. With a per-emit snapshot,
    // b still runs (it was snapshotted) and c is never skipped.
    const e = createEmitter<void>();
    const order: string[] = [];
    let offB = (): void => {};
    e.subscribe(() => {
      order.push('a');
      offB();
    });
    offB = e.subscribe(() => order.push('b'));
    e.subscribe(() => order.push('c'));

    e.emit();
    // All three ran this emit (snapshot); none skipped.
    expect(order).toEqual(['a', 'b', 'c']);

    // On the NEXT emit, b is gone.
    order.length = 0;
    e.emit();
    expect(order).toEqual(['a', 'c']);
  });

  it('a listener that unsubscribes ITSELF during emit runs once, then never again', () => {
    const e = createEmitter<void>();
    const fn = vi.fn();
    let off = (): void => {};
    off = e.subscribe(() => {
      fn();
      off();
    });
    e.emit();
    e.emit();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // --- PROPERTY: order + count under arbitrary subscribe/emit interleavings ---------------
  it('property: N subscribers each receive every payload, in emit order, once per emit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 6 }), // number of subscribers
        fc.array(fc.integer(), { minLength: 0, maxLength: 8 }), // payloads to emit
        (n, payloads) => {
          const e = createEmitter<number>();
          const logs: number[][] = Array.from({ length: n }, () => []);
          for (let i = 0; i < n; i++) {
            const idx = i;
            e.subscribe((p) => logs[idx].push(p));
          }
          for (const p of payloads) e.emit(p);
          // Every subscriber saw exactly the emitted sequence, in order.
          for (const log of logs) expect(log).toEqual(payloads);
        },
      ),
    );
  });

  it('property: after unsubscribing a chosen subscriber, only the rest receive later emits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }), // subscriber count (≥1 so there is one to drop)
        fc.integer({ min: 0 }), // which one to unsubscribe (mod n)
        (n, rawPick) => {
          const e = createEmitter<number>();
          const counts = new Array<number>(n).fill(0);
          const offs: Array<() => void> = [];
          for (let i = 0; i < n; i++) {
            const idx = i;
            offs.push(e.subscribe(() => counts[idx]++));
          }
          const pick = rawPick % n;

          e.emit(1); // all fire once
          offs[pick](); // drop the chosen one
          e.emit(2); // everyone but `pick` fires again

          for (let i = 0; i < n; i++) {
            expect(counts[i]).toBe(i === pick ? 1 : 2);
          }
        },
      ),
    );
  });
});
