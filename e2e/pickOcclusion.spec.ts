import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import geometryDefault from '../src/config/defaults/geometry.json' with { type: 'json' };
import { keyOf } from '../src/core/coords.ts';

/**
 * GitHub issue #3 regression — node pick-hitboxes must match the VISIBLE geometry so a near
 * EMPTY node no longer occludes a far node's marker.
 *
 * The bug: `createPicking` gave EVERY node one generous PIECE-sized invisible pick sphere
 * (`min(spacing*0.49, max(pieceRadius, markerRadius*1.5))` ≈ pieceRadius for the tracked
 * defaults), even empty nodes whose visible marker is small (markerRadius). Viewed at an
 * angle, a near empty node's oversized sphere intercepted the ray aimed at a FAR node's
 * marker; the nearest-hit raycaster then returned the wrong (nearer) node — a "dead zone" over
 * the far marker. The fix sizes each empty node's hitbox to its MARKER, not the piece.
 *
 * This spec drives the REAL app (agent-principles #3: observable behavior, not a log line). It
 * does NOT hardcode a fragile screen coordinate: it uses the `rayNodeDistances` test seam to
 * FIND, from the live camera geometry, the exact fingerprint of the bug —
 *   - a FAR node A the ray passes within a MARKER radius of (so A's small marker is genuinely
 *     under the pointer), and
 *   - a NEARER, still-EMPTY node B the ray passes within the OLD PIECE radius of but well
 *     OUTSIDE a marker radius (so B's OLD oversized sphere would have stolen the pick, while
 *     its NEW marker-sized sphere does not).
 * Then it asserts `pickAt`/`getHoverTarget` at that spot resolve to A, not B. Restoring the old
 * oversized radius makes this FAIL (proven in the change report by reverting the fix). Radii
 * come from the tracked geometry JSON so nothing volatile is hardcoded (agent-principles #8).
 */

type RaycastHit =
  | { kind: 'empty-node'; node: string }
  | { kind: 'placed-sphere'; node: string }
  | { kind: 'line'; lineId: string };
interface HoverTarget {
  nodes: string[];
  lines: string[];
  pieces: string[];
}
interface Vec3 {
  x: number;
  y: number;
  z: number;
}
interface RayNodeDist {
  node: string;
  distance: number;
  depth: number;
}

type Pente = {
  setCamera(position: Vec3, target: Vec3): void;
  pickAt(x: number, y: number): RaycastHit | null;
  hoverAt(x: number, y: number): HoverTarget | null;
  getHoverTarget(): HoverTarget | null;
  radiusOf(node: [number, number, number]): number | null;
  rayNodeDistances(x: number, y: number): RayNodeDist[];
  place(coords: [number, number, number]): unknown;
};

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.pickAt === 'function' &&
      typeof p.setCamera === 'function' &&
      typeof p.rayNodeDistances === 'function' &&
      !!document.querySelector('canvas')
    );
  });
}

/** The tracked visible radii + the OLD oversized pick radius the bug used, for the fingerprint. */
const MARKER = geometryDefault.markerRadius;
const PIECE = geometryDefault.pieceRadius;
const PAD = geometryDefault.pickPadding;
const NEW_EMPTY = MARKER + PAD; // an empty node's NEW pick radius
// The OLD radius every node (incl. empty) used: min(spacing*0.49, max(piece, marker*1.5)).
const OLD_RADIUS = Math.min(
  geometryDefault.spacing * 0.49,
  Math.max(PIECE, MARKER * 1.5),
);

test('issue #3: a near EMPTY node no longer steals the pick aimed at the far node behind it', async ({
  page,
}) => {
  await ready(page);
  // Fix the camera to the load-time angled framing so the geometry is deterministic.
  await page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    p.setCamera({ x: 6, y: 5, z: 8 }, { x: 0, y: 0, z: 0 });
  });

  // Search the NDC plane for the occlusion fingerprint using the live ray geometry.
  const fingerprint = await page.evaluate(
    ({ newEmpty, oldRadius }) => {
      const p = (window as unknown as { __pente: Pente }).__pente;
      // Comfortable margins so the case is unambiguous: A well inside a marker radius; B well
      // inside the OLD radius yet well OUTSIDE a marker radius, and clearly NEARER than A.
      for (let ix = -50; ix <= 50; ix++) {
        for (let iy = -50; iy <= 50; iy++) {
          const x = ix / 100;
          const y = iy / 100;
          const ds = p.rayNodeDistances(x, y).filter((d) => d.depth > 0);
          const nearMarker = ds
            .filter((d) => d.distance < newEmpty)
            .sort((a, b) => a.depth - b.depth);
          if (nearMarker.length === 0) continue;
          const A = nearMarker[nearMarker.length - 1]!; // farthest node still under the marker
          const B = ds
            .filter(
              (d) =>
                d.depth < A.depth - 1 && // clearly nearer the camera than A
                d.distance > newEmpty + 0.03 && // outside the NEW (marker) hitbox — no longer hit
                d.distance < oldRadius - 0.05, // inside the OLD (piece) hitbox — used to steal
            )
            .sort((a, b) => a.distance - b.distance)[0];
          if (!B) continue;
          const hit = p.pickAt(x, y);
          if (hit && hit.kind === 'empty-node' && hit.node === A.node) {
            return { x, y, A: A.node, B: B.node, Adist: A.distance, Bdist: B.distance };
          }
        }
      }
      return null;
    },
    { newEmpty: NEW_EMPTY, oldRadius: OLD_RADIUS },
  );

  // The fingerprint MUST exist — the fixed camera views the dense lattice at an angle, so far
  // markers sit behind nearer empty nodes. (If picking were still piece-sized, no NDC would
  // report A here: `pickAt` would return B, and this search would find nothing.)
  expect(fingerprint).not.toBeNull();
  const fp = fingerprint!;
  // Sanity on the geometry we found: B is inside the OLD hitbox but outside the NEW one.
  expect(fp.Bdist).toBeLessThan(OLD_RADIUS);
  expect(fp.Bdist).toBeGreaterThan(NEW_EMPTY);
  expect(fp.Adist).toBeLessThan(NEW_EMPTY);

  // THE REGRESSION ASSERTION: at that spot `pickAt` resolves to the FAR node A, not the nearer
  // empty node B. With the OLD oversized radius, B's sphere intercepts this ray → returns B.
  const hit = await page.evaluate(
    (f) => (window as unknown as { __pente: Pente }).__pente.pickAt(f.x, f.y),
    fp,
  );
  expect(hit).not.toBeNull();
  expect(hit!.kind).toBe('empty-node');
  expect((hit as { node: string }).node).toBe(fp.A);
  expect((hit as { node: string }).node).not.toBe(fp.B);

  // The hover path agrees: hovering that NDC highlights A, and does NOT highlight B.
  const target = await page.evaluate(
    (f) => (window as unknown as { __pente: Pente }).__pente.hoverAt(f.x, f.y),
    fp,
  );
  expect(target).not.toBeNull();
  expect(target!.nodes).toContain(fp.A);
  expect(target!.nodes).not.toContain(fp.B);
  const readback = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getHoverTarget(),
  );
  expect(readback).toEqual(target);

  const shot = resolve('e2e/artifacts/pick-occlusion-far-node.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('issue #3: occupying the near node CORRECTLY makes it intercept (hitbox tracks occupancy)', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    p.setCamera({ x: 6, y: 5, z: 8 }, { x: 0, y: 0, z: 0 });
  });

  // Find the same fingerprint (A far, B nearer-empty). After PLACING a piece on B, its hitbox
  // GROWS to piece-sized (via the syncBoard occupancy hook) and it SHOULD now intercept the ray
  // — because there is now a visible piece there. This proves the hitbox tracks the live visible
  // geometry both ways: empty ⇒ small (A wins), occupied ⇒ large (B wins).
  const fp = await page.evaluate(
    ({ newEmpty, oldRadius }) => {
      const p = (window as unknown as { __pente: Pente }).__pente;
      for (let ix = -50; ix <= 50; ix++) {
        for (let iy = -50; iy <= 50; iy++) {
          const x = ix / 100;
          const y = iy / 100;
          const ds = p.rayNodeDistances(x, y).filter((d) => d.depth > 0);
          const nearMarker = ds
            .filter((d) => d.distance < newEmpty)
            .sort((a, b) => a.depth - b.depth);
          if (nearMarker.length === 0) continue;
          const A = nearMarker[nearMarker.length - 1]!;
          const B = ds
            .filter(
              (d) =>
                d.depth < A.depth - 1 &&
                d.distance > newEmpty + 0.03 &&
                d.distance < oldRadius - 0.05,
            )
            .sort((a, b) => a.distance - b.distance)[0];
          if (!B) continue;
          const hit = p.pickAt(x, y);
          if (hit && hit.kind === 'empty-node' && hit.node === A.node) {
            return { x, y, A: A.node, B: B.node };
          }
        }
      }
      return null;
    },
    { newEmpty: NEW_EMPTY, oldRadius: OLD_RADIUS },
  );
  expect(fp).not.toBeNull();

  // Empty B → pick is the far A (the fix).
  const before = await page.evaluate(
    (f) => (window as unknown as { __pente: Pente }).__pente.pickAt(f.x, f.y),
    fp!,
  );
  expect((before as { node: string }).node).toBe(fp!.A);

  // Place a piece on B → its pick sphere grows to piece-sized; the ray now strikes B (a real
  // piece is genuinely there and nearer), reading as a placed-sphere.
  await page.evaluate((f) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    p.place(f.B.split(',').map(Number) as [number, number, number]);
  }, fp!);
  const after = await page.evaluate(
    (f) => (window as unknown as { __pente: Pente }).__pente.pickAt(f.x, f.y),
    fp!,
  );
  expect(after).not.toBeNull();
  expect(after!.kind).toBe('placed-sphere');
  expect((after as { node: string }).node).toBe(fp!.B);
});

test('issue #3: pick-sphere radius matches the VISIBLE geometry per node (marker vs piece)', async ({
  page,
}) => {
  await ready(page);

  // On an empty board every node's pick sphere is MARKER-sized (+padding), never piece-sized.
  const emptyRadius = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.radiusOf([2, 2, 2]),
  );
  expect(emptyRadius).not.toBeNull();
  expect(emptyRadius!).toBeCloseTo(MARKER + PAD, 6);
  // Explicitly NOT piece-sized — the exact over-sizing that caused issue #3.
  expect(emptyRadius!).toBeLessThan(PIECE);

  // Place a piece there → its pick sphere GROWS to piece-sized (occupancy sync via syncBoard).
  await page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    p.place([2, 2, 2]);
  });
  const occupiedRadius = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.radiusOf([2, 2, 2]),
  );
  expect(occupiedRadius).not.toBeNull();
  expect(occupiedRadius!).toBeCloseTo(PIECE + PAD, 6);
  expect(occupiedRadius!).toBeGreaterThan(emptyRadius!);

  // A still-empty neighbour stayed marker-sized (only the occupied node grew).
  const neighbourRadius = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.radiusOf([2, 2, 4]),
  );
  expect(neighbourRadius!).toBeCloseTo(MARKER + PAD, 6);
  // Reference the shared origin node key so the coords import is load-bearing (SSOT).
  expect(keyOf([2, 2, 2])).toBe('2,2,2');
});
