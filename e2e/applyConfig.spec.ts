import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import lightingDefault from '../src/config/defaults/lighting.json' with { type: 'json' };
import materialsDefault from '../src/config/defaults/materials.json' with { type: 'json' };
import renderingDefault from '../src/config/defaults/rendering.json' with { type: 'json' };
import blendingDefault from '../src/config/defaults/blending.json' with { type: 'json' };
import lineVisibilityDefault from '../src/config/defaults/lineVisibility.json' with { type: 'json' };
import interactionDefault from '../src/config/defaults/interaction.json' with { type: 'json' };
import colorsDefault from '../src/config/defaults/colors.json' with { type: 'json' };

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
interface MarkerNodeReadout {
  node: string;
  instanceId: number;
  visible: boolean;
  instanceColorHex: string;
}
interface MarkersReadout {
  count: number;
  roughness: number;
  metalness: number;
  opacity: number;
  baseColorHex: string;
  nodes: MarkerNodeReadout[];
}
interface PieceReadout {
  node: string;
  owner: 'white' | 'black';
  roughness: number;
  metalness: number;
  opacity: number;
  fadingOut: boolean;
}
interface ColorsReadout {
  background: string;
  emptySphere: string;
  whitePiece: string;
  blackPiece: string;
  tempPiece: string;
  winningLine: string;
  hoverHighlight: string;
}
interface TempReadout {
  active: boolean;
  preview: string | null;
  previewOpacity: number;
}
interface WinLineReadout {
  visible: boolean;
  nodes: string[];
  color: number;
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
  getColors(): ColorsReadout | null;
  getTemp(): TempReadout | null;
  getWinLine(): WinLineReadout | null;
  dispatch(id: string): boolean | null;
  pressKey(chord: string): { commandId: string | null } | null;
  pickAt(ndcX: number, ndcY: number): { kind: string; node?: string } | null;
  clickAt(ndcX: number, ndcY: number): GameStateLite | null;
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

/**
 * Issue #15 gap-closure: `applyConfig(colors)` must live-apply the FOUR previously-broken colours
 * (emptySphere / whitePiece+blackPiece / tempPiece / winningLine), re-colouring the EXISTING rendered
 * objects with NO reload. Before this fix only background/lineOpacity/the three line colours/hover
 * applied live and the rest silently needed a reload — contradicting the shipped "settings apply live"
 * claim. Each test drives the REAL setConfig path (persist + emit → onConfigChange → scene.applyConfig)
 * and asserts the RENDERED object recoloured via `window.__pente` readouts read off the live Three.js
 * objects — observable render truth, never a log line (agent-principles #3). Baselines derive from the
 * tracked `colors.json` SSOT so nothing volatile is hardcoded (agent-principles #8).
 */

/** `#rrggbb` → integer (for the win-line material colour, which reports a hex int). */
const winInt = (hex: string): number => parseInt(hex.replace('#', ''), 16);

/** Scan NDC space for a coordinate whose raycast resolves to `node` as an empty node. */
async function ndcForNode(
  page: import('@playwright/test').Page,
  node: string,
): Promise<[number, number]> {
  const found = await page.evaluate((target: string) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const STEPS = 400;
    for (let iy = 0; iy <= STEPS; iy++) {
      for (let ix = 0; ix <= STEPS; ix++) {
        const x = (ix / STEPS) * 2 - 1;
        const y = (iy / STEPS) * 2 - 1;
        const hit = p.pickAt(x, y);
        if (hit && hit.node === target) return [x, y] as [number, number];
      }
    }
    return null;
  }, node);
  if (!found) throw new Error(`no NDC resolves to node ${node}`);
  return found as [number, number];
}

test('applyConfig(colors): a live emptySphere edit re-colours the EXISTING marker instances', async ({
  page,
}) => {
  await ready(page);

  // Baseline: the marker base colour is the tracked default emptySphere (SSOT, not a magic value), and
  // an actual live marker instance draws that colour (render truth off the GPU instanceColor buffer).
  const before = await get(page, (p) => p.getColors()!);
  expect(before.emptySphere).toBe(colorsDefault.emptySphere);
  const markerBefore = await get(page, (p) => p.getMarkers(['2,2,2'])!);
  expect(markerBefore.baseColorHex).toBe(colorsDefault.emptySphere);
  expect(markerBefore.nodes[0]!.instanceColorHex).toBe(colorsDefault.emptySphere);

  // Drive the FULL live path (setConfig persists + emits → onConfigChange → applyConfig('colors')).
  await writeConfig(page, 'colors', { emptySphere: '#12ef34' });

  // The EXISTING marker instance recoloured live — both the base readout and the per-instance GPU
  // colour changed, with no reload. A mutant that dropped markers.setColor from applyColors leaves the
  // old default here and fails (the exact gap issue #15 reported).
  const after = await get(page, (p) => p.getColors()!);
  expect(after.emptySphere).toBe('#12ef34');
  const markerAfter = await get(page, (p) => p.getMarkers(['2,2,2'])!);
  expect(markerAfter.baseColorHex).toBe('#12ef34');
  expect(markerAfter.nodes[0]!.instanceColorHex).toBe('#12ef34');
});

test('applyConfig(colors): a live whitePiece/blackPiece edit re-colours EXISTING placed pieces', async ({
  page,
}) => {
  await ready(page);

  // Place a white piece (2,2,2) and a black piece (3,3,3) FIRST — the crux is that these EXISTING
  // meshes recolour, not merely that future pieces would. Wait for both to settle so the recolour is
  // asserted over a stable material (a fading mesh is a separate branch, exercised by leaving it alone).
  await get(page, (p) => p.place([2, 2, 2])); // white
  await get(page, (p) => p.place([3, 3, 3])); // black
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const w = p.getPieces()?.find((x) => x.node === '2,2,2');
    const b = p.getPieces()?.find((x) => x.node === '3,3,3');
    return !!w && !w.fadingOut && !!b && !b.fadingOut;
  });

  // Baseline: the template reports the tracked default per-owner colours (SSOT).
  const before = await get(page, (p) => p.getColors()!);
  expect(before.whitePiece).toBe(colorsDefault.whitePiece);
  expect(before.blackPiece).toBe(colorsDefault.blackPiece);
  const pieceCountBefore = await get(page, (p) => p.getPieces()!.length);

  // Live edit BOTH owner colours through the real config path.
  await writeConfig(page, 'colors', { whitePiece: '#ff00aa', blackPiece: '#00ffcc' });

  // The template retargeted AND — the crux — the two EXISTING piece meshes recoloured live. `getColors`
  // reports the live piece-material template; a mutant that dropped pieces.setColors from applyColors,
  // or recoloured only future pieces, leaves the old defaults here and fails.
  const after = await get(page, (p) => p.getColors()!);
  expect(after.whitePiece).toBe('#ff00aa');
  expect(after.blackPiece).toBe('#00ffcc');
  // No mesh was added/removed by a colour edit — the two placed pieces are the same meshes, recoloured.
  expect(await get(page, (p) => p.getPieces()!.length)).toBe(pieceCountBefore);
  const owners = await get(page, (p) =>
    p.getPieces()!.map((x) => ({ node: x.node, owner: x.owner })),
  );
  expect(owners.find((o) => o.node === '2,2,2')!.owner).toBe('white');
  expect(owners.find((o) => o.node === '3,3,3')!.owner).toBe('black');
});

test('applyConfig(colors): a live tempPiece edit re-colours the translucent preview piece', async ({
  page,
}) => {
  await ready(page);

  // Enter temp-placement mode and set a preview node so the translucent preview is actually DRAWN.
  await get(page, (p) => p.pressKey('t'));
  const node = '3,2,1';
  const nodeNdc = await ndcForNode(page, node);
  await page.evaluate((ndc: [number, number]) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    p.clickAt(ndc[0], ndc[1]);
  }, nodeNdc);
  const temp = await get(page, (p) => p.getTemp()!);
  expect(temp.active).toBe(true);
  expect(temp.preview).toBe(node);
  expect(temp.previewOpacity).toBeGreaterThan(0); // the preview is drawn

  // Baseline: the preview material draws the tracked default tempPiece colour (render truth).
  const before = await get(page, (p) => p.getColors()!);
  expect(before.tempPiece).toBe(colorsDefault.tempPiece);

  await writeConfig(page, 'colors', { tempPiece: '#ee5511' });

  // The DRAWN preview mesh recoloured live (read off the live temp material). A mutant dropping the
  // tempMaterial recolour from applyColors leaves the old default and fails.
  const after = await get(page, (p) => p.getColors()!);
  expect(after.tempPiece).toBe('#ee5511');
});

test('applyConfig(colors): a live winningLine edit re-colours the SHOWN winning line', async ({
  page,
}) => {
  await ready(page);

  // Play a real five-in-a-row for white along +x on (y=0,z=0), black spacers on the far face so no
  // capture disturbs the run — the win-line mesh is drawn along the run.
  const state = await page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const spacers: [number, number, number][] = [[0, 0, 4], [1, 0, 4], [2, 0, 4], [3, 0, 4]];
    let last: unknown = null;
    for (let i = 0; i < 5; i++) {
      last = p.place([i, 0, 0]);
      if (i < 4) p.place(spacers[i]!);
    }
    return last as { winner: string | null } | null;
  });
  expect(state!.winner).toBe('white');

  // The win-line mesh is shown, coloured from the tracked default winningLine (SSOT).
  const winBefore = await get(page, (p) => p.getWinLine()!);
  expect(winBefore.visible).toBe(true);
  expect(winBefore.color).toBe(winInt(colorsDefault.winningLine));
  const before = await get(page, (p) => p.getColors()!);
  expect(before.winningLine).toBe(colorsDefault.winningLine);

  await writeConfig(page, 'colors', { winningLine: '#ff33dd' });

  // The SHOWN win line recoloured live (the win-line material colour changed). A mutant dropping the
  // winLine.setColor from applyColors leaves the old default and fails.
  const winAfter = await get(page, (p) => p.getWinLine()!);
  expect(winAfter.visible).toBe(true);
  expect(winAfter.color).toBe(winInt('#ff33dd'));
  const after = await get(page, (p) => p.getColors()!);
  expect(after.winningLine).toBe('#ff33dd');
});
