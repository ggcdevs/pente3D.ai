import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import materialsDefault from '../src/config/defaults/materials.json' with { type: 'json' };
import { keyOf } from '../src/core/coords.ts';

/**
 * GitHub issue #28 regression — a settled piece must be OCCLUDED by a gridline that is closer to
 * the camera, instead of painting on top of it.
 *
 * ROOT CAUSE (src/render/pieces.ts): every piece material was created `transparent:true` (to fade
 * in from opacity 0) and was NEVER flipped back once the fade completed. A fully-faded-in FULLY
 * OPAQUE piece therefore stayed in Three.js's TRANSPARENT render pass, which sorts by object-centre
 * distance and does not reliably occlude via the depth buffer. The gridlines are also `transparent`
 * with `depthWrite:false` (src/render/lines.ts) — so a piece and a nearer line mis-sorted and the
 * piece drew over a line that is physically in front of it.
 *
 * THE FIX: when a piece finishes fading in AND its target opacity is fully opaque (`>= 1`, the
 * tracked default), settle its material to `transparent:false` so it draws in the OPAQUE pass —
 * writing depth and z-testing, so a closer gridline (drawn after, depth-tested, blended) correctly
 * occludes it. A genuinely translucent piece (`pieceOpacity < 1`) legitimately stays transparent.
 *
 * This spec drives the REAL app and asserts OBSERVABLE RENDER TRUTH (agent-principles #3): the
 * `getPieces()[].transparent` flag read straight off the live Three.js material. That flag IS the
 * render-pass membership that decides occlusion — reverting the fix flips it back to `true` and this
 * spec FAILS (proven in the change report by reverting). The before/after screenshots (a gridline
 * oriented in front of a centre piece) are saved as reviewer artifacts alongside the assertion.
 * `pieceOpacity` comes from the tracked config JSON so no volatile fact is hardcoded (#8).
 */

type Player = 'white' | 'black';
interface PieceReadout {
  node: string;
  owner: Player;
  position: { x: number; y: number; z: number };
  opacity: number;
  fadingOut: boolean;
  transparent: boolean;
}
interface Vec3 {
  x: number;
  y: number;
  z: number;
}
type Pente = {
  place(coords: [number, number, number]): unknown;
  getPieces(): PieceReadout[] | null;
  setCamera(position: Vec3, target: Vec3): void;
  setConfig(section: string, partial: Record<string, unknown>): void;
};

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.place === 'function' &&
      typeof p.getPieces === 'function' &&
      typeof p.setCamera === 'function' &&
      !!document.querySelector('canvas')
    );
  });
}

/** Wait until every live piece has finished fading in (opacity at the given target). */
async function waitSettled(page: import('@playwright/test').Page, target: number): Promise<void> {
  await page.waitForFunction(
    (t) => {
      const p = (window as unknown as { __pente: Pente }).__pente;
      const pieces = p.getPieces();
      return !!pieces && pieces.length > 0 && pieces.every((pc) => Math.abs(pc.opacity - t) < 1e-6);
    },
    target,
  );
}

test('issue #28: a settled fully-opaque piece draws in the OPAQUE pass so a closer gridline occludes it', async ({
  page,
}) => {
  await ready(page);

  // Deterministic view: a white centre piece with an orthogonal gridline segment crossing between
  // the camera and the piece. The camera looks down a body diagonal at the board centre, so the
  // grid segments radiating from the centre node pass in front of it — the exact orbit the
  // maintainer described. Line opacity bumped so the crossing line is unmistakable in the artifact.
  await page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    p.setConfig('colors', { lineOpacity: 1 });
    p.setCamera({ x: 5, y: 4, z: 5 }, { x: 0, y: 0, z: 0 });
  });

  // Place a bright white piece at the board centre (2,2,2) → world origin, ringed by gridlines.
  await page.evaluate(() => {
    (window as unknown as { __pente: Pente }).__pente.place([2, 2, 2]);
  });

  // BEFORE artifact — the piece mid-fade-in: it is legitimately transparent (blending up from
  // opacity 0), which is the SAME transparent-pass state the BUG left a SETTLED piece stuck in.
  // This frame is what the mis-occlusion looked like (piece in the transparent pass); the settled
  // AFTER frame below is the fix (piece in the opaque pass, occluded by the closer gridline).
  const beforeShot = resolve('e2e/artifacts/issue28-before.png');
  mkdirSync(dirname(beforeShot), { recursive: true });
  await page.evaluate(
    () =>
      new Promise<void>((r) => {
        // Grab an early mid-fade frame where the piece is still transparent (opacity < target).
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      }),
  );
  await page.screenshot({ path: beforeShot });

  await waitSettled(page, materialsDefault.pieceOpacity);

  // OBSERVABLE RENDER TRUTH: the fully-opaque default piece (`pieceOpacity === 1`) settled into the
  // OPAQUE render pass — `transparent === false`. This is the pass membership that makes the depth
  // buffer occlude it against the closer `depthWrite:false` gridline. Reverting the pieces.ts fix
  // leaves this `true` (the piece never leaves the transparent pass) and this assertion FAILS.
  const pieces = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getPieces()!,
  );
  console.log('PIECES settled:', JSON.stringify(pieces));
  expect(materialsDefault.pieceOpacity).toBe(1); // the fix's opaque branch applies to the default
  expect(pieces).toHaveLength(1);
  const piece = pieces[0]!;
  expect(piece.node).toBe(keyOf([2, 2, 2]));
  expect(piece.opacity).toBeCloseTo(materialsDefault.pieceOpacity, 6);
  expect(piece.fadingOut).toBe(false);
  // THE REGRESSION ASSERTION: a settled fully-opaque piece is NOT transparent — it is an opaque
  // depth-writing object, so a nearer gridline occludes it per real 3D depth (issue #28).
  expect(piece.transparent).toBe(false);

  // The AFTER artifact: the settled piece now correctly z-orders against the crossing gridline.
  const afterShot = resolve('e2e/artifacts/issue28-after.png');
  await page.screenshot({ path: afterShot });
  console.log('SCREENSHOTS:', beforeShot, afterShot);
});

test('issue #28: a translucent piece (pieceOpacity < 1) legitimately STAYS transparent', async ({
  page,
}) => {
  await ready(page);

  // A live `materials.pieceOpacity` below 1 means the piece must BLEND — it belongs in the
  // transparent pass. The fix must NOT force such a piece opaque (that would break its blending).
  // Set the reduced opacity BEFORE placing so the piece is created + settles against the new target.
  await page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    p.setConfig('materials', { pieceOpacity: 0.5 });
    p.place([2, 2, 2]);
  });
  await waitSettled(page, 0.5);

  const pieces = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getPieces()!,
  );
  expect(pieces).toHaveLength(1);
  const piece = pieces[0]!;
  expect(piece.opacity).toBeCloseTo(0.5, 6);
  // A genuinely translucent piece stays transparent — the fix only forces the FULLY-opaque case.
  expect(piece.transparent).toBe(true);
});

test('issue #28: a captured piece returns to transparent so it FADES out (not an instant pop)', async ({
  page,
}) => {
  await ready(page);

  // Build a capture: white brackets two black pieces along +x, then plays the far flank. The two
  // flanked (settled, opaque) black pieces must fade out — which requires their material to return
  // to `transparent:true` (an opaque material ignores `opacity`). Prove they are transparent while
  // fading out, i.e. the settle→opaque flip is correctly REVERSED for the capture fade.
  for (const c of [
    [0, 0, 0],
    [1, 0, 0],
    [4, 4, 4],
    [2, 0, 0],
  ] as [number, number, number][]) {
    await page.evaluate((coord) => {
      (window as unknown as { __pente: Pente }).__pente.place(coord);
    }, c);
  }
  await waitSettled(page, materialsDefault.pieceOpacity);

  // The two black pieces are settled + opaque now.
  const settled = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getPieces()!,
  );
  for (const node of [keyOf([1, 0, 0]), keyOf([2, 0, 0])]) {
    const pc = settled.find((p) => p.node === node)!;
    expect(pc.transparent).toBe(false); // settled opaque before the capture
  }

  // White captures (1,0,0),(2,0,0). Immediately after, those meshes are FADING OUT and MUST be
  // transparent again (else the fade could not blend — the capture would pop instantly).
  await page.evaluate(() => {
    (window as unknown as { __pente: Pente }).__pente.place([3, 0, 0]);
  });
  const midCapture = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getPieces()!,
  );
  for (const node of [keyOf([1, 0, 0]), keyOf([2, 0, 0])]) {
    const pc = midCapture.find((p) => p.node === node);
    // Still present (mid fade-out), transparent so it blends toward disposal.
    expect(pc).toBeDefined();
    expect(pc!.fadingOut).toBe(true);
    expect(pc!.transparent).toBe(true);
  }
});
