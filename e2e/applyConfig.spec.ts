import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import lightingDefault from '../src/config/defaults/lighting.json' with { type: 'json' };
import materialsDefault from '../src/config/defaults/materials.json' with { type: 'json' };
import renderingDefault from '../src/config/defaults/rendering.json' with { type: 'json' };
import blendingDefault from '../src/config/defaults/blending.json' with { type: 'json' };
import lineVisibilityDefault from '../src/config/defaults/lineVisibility.json' with { type: 'json' };
import interactionDefault from '../src/config/defaults/interaction.json' with { type: 'json' };

/**
 * Task A.3 (issue #15 core) e2e — `scene.applyConfig(section)` is the GLUE seam that live-applies a
 * whole config section to the running Three.js scene with NO reload, generalizing `applyColors`. The
 * scene + its render sub-layers are an IO boundary, so this is verified by driving the REAL app and
 * asserting on `window.__pente` readouts read back off the actual Three.js objects (lights, shared
 * materials, instanced-line blending, category visibility, the drag guard) — observable behavior,
 * NEVER a log line (agent-principles #3). Every expectation derives from the tracked config JSON
 * (imported here as the SSOT) so nothing volatile is hardcoded (agent-principles #8).
 *
 * Each live section is driven through the FULL integration path — `__pente.setConfig(section, …)`
 * persists a real override AND emits, and the app's `onConfigChange` loop calls
 * `scene.applyConfig(section)` — so a green test proves config → emitter → scene → render end to end
 * (the cross-component seam per-module gates would miss). The EXCLUDED sections (`board`/`controls`/
 * `geometry`, baked into instanced buffers / grid / OrbitControls at construction) are proven to be
 * DOCUMENTED no-ops — the scene is UNCHANGED — so the exclusion is explicit, never a silent gap.
 */

type ConfigSection = string;
interface Vec3 { x: number; y: number; z: number }
interface LightingReadout {
  background: number;
  ambient: { color: number; intensity: number };
  directional: { color: number; intensity: number; position: Vec3 };
}
interface MarkersReadout {
  count: number;
  roughness: number;
  metalness: number;
  opacity: number;
}
interface PieceReadout {
  node: string;
  roughness: number;
  metalness: number;
  opacity: number;
  fadingOut: boolean;
}
interface LineGroupReadout {
  category: 'orthogonal' | 'face' | 'space';
  visible: boolean;
  blending: 'additive' | 'normal';
}
interface DragGuardConfig { enabled: boolean; thresholdPx: number }
interface GameStateLite { pieces: Record<string, string> }
interface CameraReadout { position: Vec3; target: Vec3 }
interface CameraPresetReadout {
  name: string;
  orbitButton: 'LEFT' | 'MIDDLE' | 'RIGHT';
  panButton: 'LEFT' | 'MIDDLE' | 'RIGHT';
  rotateSpeed: number;
  panSpeed: number;
  zoomSpeed: number;
  zoomToCursor: boolean;
  minDistance: number;
  maxDistance: number;
  mouseButtons: { LEFT: number | undefined; MIDDLE: number | undefined; RIGHT: number | undefined };
}

type Pente = {
  getLighting(): LightingReadout | null;
  getMarkers(query?: readonly string[]): MarkersReadout | null;
  getPieces(): PieceReadout[] | null;
  getVisibleLines(): LineGroupReadout[] | null;
  getInteraction(): DragGuardConfig | null;
  getState(): GameStateLite | null;
  getCamera(): CameraReadout | null;
  getCameraPreset(): CameraPresetReadout | null;
  applyConfig(section: ConfigSection): void;
  setConfig(section: ConfigSection, partial: Record<string, unknown>): void;
  place(coords: [number, number, number]): GameStateLite | null;
};

/** `#rrggbb` → integer, mirroring the app's pure resolver, for building colour expectations. */
function hexToInt(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

async function ready(page: import('@playwright/test').Page) {
  // Clean override state so every re-read is unambiguous (localStorage is the getConfig backing store).
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.applyConfig === 'function' &&
      typeof p.setConfig === 'function' &&
      typeof p.getLighting === 'function' &&
      typeof p.getVisibleLines === 'function'
    );
  });
}

/** Run a closure against `window.__pente` (serialized), returning its result. */
const get = <T,>(page: import('@playwright/test').Page, fn: (p: Pente) => T): Promise<T> =>
  page.evaluate((body: string): unknown => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => unknown;
    return revived(p);
  }, fn.toString()) as Promise<T>;

/** Write a real config override for `section` through the app's own setConfig (persists + emits). */
const writeConfig = (
  page: import('@playwright/test').Page,
  section: string,
  partial: Record<string, unknown>,
): Promise<void> =>
  page.evaluate(
    ([s, pt]: [string, Record<string, unknown>]) => {
      const p = (window as unknown as { __pente: Pente }).__pente;
      p.setConfig(s, pt);
    },
    [section, partial] as [string, Record<string, unknown>],
  );

test('applyConfig(lighting): a live lighting edit re-lights the scene with no reload', async ({
  page,
}) => {
  await ready(page);

  // Baseline is the tracked default (proven from the SSOT, not a magic number).
  const before = await get(page, (p) => p.getLighting()!);
  expect(before.ambient.intensity).toBeCloseTo(lightingDefault.ambient.intensity, 5);
  expect(before.directional.intensity).toBeCloseTo(lightingDefault.directional.intensity, 5);

  // Distinct target values that differ from the default in every field we live-apply.
  const target = {
    ambient: { color: '#223344', intensity: 0.2 },
    directional: { color: '#ffcc00', intensity: 1.7, position: { x: -3, y: 4, z: -9 } },
  };
  await writeConfig(page, 'lighting', target);

  // The onConfigChange loop re-applied it LIVE — the actual THREE lights changed (observable truth).
  const after = await get(page, (p) => p.getLighting()!);
  expect(after.ambient.color).toBe(hexToInt(target.ambient.color));
  expect(after.ambient.intensity).toBeCloseTo(target.ambient.intensity, 5);
  expect(after.directional.color).toBe(hexToInt(target.directional.color));
  expect(after.directional.intensity).toBeCloseTo(target.directional.intensity, 5);
  expect(after.directional.position).toEqual(target.directional.position);
});

test('applyConfig(materials)+(rendering): live gloss/opacity on markers AND pieces', async ({
  page,
}) => {
  await ready(page);

  // Place a piece so there is a live piece material to re-target.
  await get(page, (p) => p.place([2, 2, 2]));

  // The placed piece fades IN from opacity 0; wait for it to SETTLE (fadeDir===0, opacity at the
  // default target) before editing config. This is deliberate: a settled mesh exercises the subtlest
  // branch of pieces.setMaterial — the `fadeDir === 0` SNAP that must jump material.opacity to the new
  // target immediately (pieces.ts:279). Asserting on a mid-fade opacity would be nondeterministic AND
  // would miss that snap, which is why the piece is settled first (agent-principles: proof =
  // observable behavior, not a race).
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const pc = p.getPieces()?.find((x) => x.node === '2,2,2');
    return !!pc && !pc.fadingOut && Math.abs(pc.opacity - 1) < 1e-9;
  });
  // Baseline: a settled piece sits at the tracked default pieceOpacity target (SSOT, not a magic 1).
  const pieceBefore = await get(page, (p) => p.getPieces()!.find((x) => x.node === '2,2,2')!);
  expect(pieceBefore.opacity).toBeCloseTo(materialsDefault.pieceOpacity, 5);
  expect(pieceBefore.roughness).toBeCloseTo(renderingDefault.piece.roughness, 5);
  expect(pieceBefore.metalness).toBeCloseTo(renderingDefault.piece.metalness, 5);

  const markersBefore = await get(page, (p) => p.getMarkers()!);
  expect(markersBefore.roughness).toBeCloseTo(renderingDefault.marker.roughness, 5);
  expect(markersBefore.opacity).toBeCloseTo(materialsDefault.markerOpacity, 5);

  // rendering carries gloss (roughness/metalness); materials carries opacity — two sections, both live.
  await writeConfig(page, 'rendering', {
    marker: { roughness: 0.11, metalness: 0.77 },
    piece: { roughness: 0.99, metalness: 0.22 },
  });
  await writeConfig(page, 'materials', { markerOpacity: 0.9, pieceOpacity: 0.5 });

  const markersAfter = await get(page, (p) => p.getMarkers()!);
  expect(markersAfter.roughness).toBeCloseTo(0.11, 5);
  expect(markersAfter.metalness).toBeCloseTo(0.77, 5);
  expect(markersAfter.opacity).toBeCloseTo(0.9, 5);

  // The live piece mesh's material picked up the new gloss (roughness/metalness change immediately)
  // AND — the subtle bit — the settled mesh SNAPPED its opacity to the new pieceOpacity target now.
  // A mutant that deletes the fadeDir===0 snap (pieces.ts:279) or drops the pieceOpacity retarget
  // leaves opacity at the old 1 and fails this assertion — the branch the exclusion from mutation
  // testing left ungated (render layer is Playwright-only) now has an explicit e2e gate.
  const piece = await get(page, (p) => p.getPieces()!.find((x) => x.node === '2,2,2')!);
  expect(piece.roughness).toBeCloseTo(0.99, 5);
  expect(piece.metalness).toBeCloseTo(0.22, 5);
  expect(piece.fadingOut).toBe(false);
  expect(piece.opacity).toBeCloseTo(0.5, 5);
});

test('applyConfig(blending): a live blending edit flips a line category to normal', async ({
  page,
}) => {
  await ready(page);

  const before = await get(page, (p) => p.getVisibleLines()!);
  const orthoBefore = before.find((g) => g.category === 'orthogonal')!;
  // The tracked default for orthogonal is additive (SSOT) — assert the baseline off config.
  expect(orthoBefore.blending).toBe(blendingDefault.orthogonal);

  // Flip orthogonal to normal; the other categories stay as configured.
  await writeConfig(page, 'blending', { orthogonal: 'normal' });

  const after = await get(page, (p) => p.getVisibleLines()!);
  const orthoAfter = after.find((g) => g.category === 'orthogonal')!;
  expect(orthoAfter.blending).toBe('normal');
  // Face/space unchanged (their default keys were not overridden).
  expect(after.find((g) => g.category === 'face')!.blending).toBe(blendingDefault.faceDiagonal);
  expect(after.find((g) => g.category === 'space')!.blending).toBe(blendingDefault.spaceDiagonal);
});

test('applyConfig(lineVisibility): a live edit shows a default-hidden category', async ({ page }) => {
  await ready(page);

  const before = await get(page, (p) => p.getVisibleLines()!);
  // The tracked default hides face diagonals — assert that baseline from the SSOT.
  expect(before.find((g) => g.category === 'face')!.visible).toBe(
    lineVisibilityDefault.faceDiagonal,
  );

  await writeConfig(page, 'lineVisibility', { faceDiagonal: true });

  const after = await get(page, (p) => p.getVisibleLines()!);
  expect(after.find((g) => g.category === 'face')!.visible).toBe(true);
  // Orthogonal (default-on) stays on; space (default-off, not overridden) stays off.
  expect(after.find((g) => g.category === 'orthogonal')!.visible).toBe(
    lineVisibilityDefault.orthogonal,
  );
  expect(after.find((g) => g.category === 'space')!.visible).toBe(
    lineVisibilityDefault.spaceDiagonal,
  );
});

test('applyConfig(interaction): a live edit changes the drag-vs-click guard', async ({ page }) => {
  await ready(page);

  const before = await get(page, (p) => p.getInteraction()!);
  expect(before.enabled).toBe(interactionDefault.dragGuard.enabled);
  expect(before.thresholdPx).toBe(interactionDefault.dragGuard.thresholdPx);

  await writeConfig(page, 'interaction', { dragGuard: { enabled: false, thresholdPx: 42 } });

  const after = await get(page, (p) => p.getInteraction()!);
  expect(after.enabled).toBe(false);
  expect(after.thresholdPx).toBe(42);
});

test('applyConfig(colors): the previewable colours + hover glow apply live (with a screenshot)', async ({
  page,
}) => {
  await ready(page);

  await writeConfig(page, 'colors', { background: '#ff8800', lineOrthogonal: '#00ffaa' });

  const colors = await get(page, (p) => {
    const api = p as unknown as { getColors(): { background: string; lineOrthogonal: string } };
    return api.getColors();
  });
  expect(colors.background).toBe('#ff8800');
  expect(colors.lineOrthogonal).toBe('#00ffaa');

  const shot = resolve('e2e/artifacts/applyConfig-colors.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('applyConfig is a DOCUMENTED no-op for the excluded reload/next-game sections', async ({
  page,
}) => {
  await ready(page);

  // Place a piece so getPieces() exposes a concrete world position — the observable a geometry/board
  // re-apply WOULD move (piece world position is derived from geometry.spacing and board size). Its
  // presence also proves board size is untouched (a size:7 rebuild would clear/relocate this piece).
  // Wait for its fade to settle so the before/after getPieces() comparison is over a stable opacity
  // (else mid-fade drift, not geometry, would move the readout) — the position/count is what matters.
  await get(page, (p) => p.place([2, 2, 2]));
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const pc = p.getPieces()?.find((x) => x.node === '2,2,2');
    return !!pc && !pc.fadingOut && Math.abs(pc.opacity - 1) < 1e-9;
  });

  // Snapshot everything the excluded sections COULD touch if they were (wrongly) live. Critically this
  // includes getCameraPreset() — the readout applyCameraPreset actually MUTATES (mouse buttons, rotate/
  // pan/zoom speeds, zoom limits) for a `controls` re-apply. getCamera() (position/target) can NOT
  // observe that, so a controls regression would slip past a camera-position-only assertion — the gate
  // must watch the field that would actually move (agent-principles #7).
  const lightingBefore = await get(page, (p) => p.getLighting()!);
  const markersBefore = await get(page, (p) => p.getMarkers()!);
  const linesBefore = await get(page, (p) => p.getVisibleLines()!);
  const cameraBefore = await get(page, (p) => p.getCamera()!);
  const cameraPresetBefore = await get(page, (p) => p.getCameraPreset()!);
  const piecesBefore = await get(page, (p) => p.getPieces()!);
  const stateBefore = await get(page, (p) => p.getState()!);

  // The default preset is NOT trackpad, so the override below is a genuine change — if `controls` were
  // wrongly wired live, getCameraPreset() WOULD flip. (Asserting the baseline differs proves the
  // override has teeth: the no-op claim is only meaningful because a live apply would visibly change.)
  expect(cameraPresetBefore.name).not.toBe('trackpad');

  // Write real overrides for the excluded sections, then drive applyConfig directly for each: the
  // scene must NOT change (they are baked at construction — board size into the instanced buffers,
  // the camera preset onto OrbitControls, geometry radii/spacing into every instance matrix).
  await get(page, (p) => {
    p.setConfig('geometry', { markerRadius: 0.9, spacing: 5 });
    p.setConfig('board', { size: 7 });
    p.setConfig('controls', { preset: 'trackpad' });
    p.applyConfig('geometry');
    p.applyConfig('board');
    p.applyConfig('controls');
  });

  expect(await get(page, (p) => p.getLighting()!)).toEqual(lightingBefore);
  expect(await get(page, (p) => p.getMarkers()!)).toEqual(markersBefore);
  expect(await get(page, (p) => p.getVisibleLines()!)).toEqual(linesBefore);
  expect(await get(page, (p) => p.getCamera()!)).toEqual(cameraBefore);
  // controls no-op: the preset readout applyCameraPreset would rewrite is byte-for-byte unchanged —
  // still NOT trackpad. This is the assertion that actually bites a wrongly-live `controls` case.
  const cameraPresetAfter = await get(page, (p) => p.getCameraPreset()!);
  expect(cameraPresetAfter).toEqual(cameraPresetBefore);
  expect(cameraPresetAfter.name).not.toBe('trackpad');
  // geometry/board no-op: the placed piece's world position (derived from spacing/board size) is
  // unchanged — a live geometry re-apply at spacing:5 or a board rebuild at size:7 would move/drop it.
  expect(await get(page, (p) => p.getPieces()!)).toEqual(piecesBefore);
  // The board itself (piece count) is untouched — no rebuild, no clobber of in-flight game state.
  expect(await get(page, (p) => p.getState()!)).toEqual(stateBefore);
});
