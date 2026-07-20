import { test, expect } from '@playwright/test';
import interactionDefault from '../src/config/defaults/interaction.json' with { type: 'json' };

/**
 * GitHub issue #1 e2e — the drag-vs-click guard is an IO boundary, verified by driving REAL
 * pointer gestures on the live canvas and asserting on `window.__pente.getState()` /
 * `getPieces()` (agent-principles #3: observable behavior, never a log line). The pure
 * decision (`shouldPlaceFromPointer`) is mutation-gated in Vitest; here we prove the wiring:
 *
 *   - a DRAG across the canvas (pointer moves well past the threshold) does NOT place a piece;
 *   - a plain CLICK (pointerdown → pointerup at the same spot) DOES place a piece;
 *   - with the guard DISABLED via a localStorage config override, a DRAG DOES place — proving
 *     the toggle actually changes behavior (agent-principles #7: the gate/config bites).
 *
 * The guard threshold comes from the tracked `interaction.json` default (agent-principles #8:
 * nothing volatile hardcoded). The override is written into localStorage BEFORE the app boots
 * (init script), exactly how a user's stored override reaches the config store on load.
 */

interface Pente {
  getState(): { pieces: Record<string, 'white' | 'black'>; turn: 'white' | 'black' } | null;
  getPieces(): { node: string; owner: string }[] | null;
  pickAt(ndcX: number, ndcY: number): { kind: string; node?: string } | null;
}

const threshold = interactionDefault.dragGuard.thresholdPx;
const OVERRIDE_KEY = 'pente:config:interaction';

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getState === 'function' &&
      typeof p.getPieces === 'function' &&
      typeof p.pickAt === 'function' &&
      !!document.querySelector('canvas')
    );
  });
}

/**
 * Find CLIENT pixel coordinates over an empty node by scanning the CENTRAL NDC region, then
 * converting the winning NDC back to canvas client pixels via the canvas rect — the same
 * space `page.mouse` operates in. The scan is kept central (|ndc| <= ~0.6) with margin so the
 * click AND a surrounding drag stay on-screen and reach the canvas pointer listeners (edge
 * nodes map to off-viewport pixels that receive no pointer events). Returns `{ x, y, node }`.
 */
async function clientPxForCentralNode(
  page: import('@playwright/test').Page,
): Promise<{ x: number; y: number; node: string }> {
  const found = await page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    // Central band only: NDC in [-0.6, 0.6] on both axes keeps the pixel comfortably inside
    // the viewport so pointer events land AND a ~180px drag around it stays on-canvas. A FINE
    // step is used because empty-node hitboxes are marker-sized (GitHub issue #3): a coarse grid
    // can step over a small far marker. We also require the CLIENT pixel to round-trip back to
    // the SAME node (the space `page.mouse` uses), so the later release genuinely lands on it.
    const toClient = (ndcX: number, ndcY: number) => ({
      x: rect.left + ((ndcX + 1) / 2) * rect.width,
      y: rect.top + ((1 - ndcY) / 2) * rect.height,
    });
    const toNdc = (clientX: number, clientY: number) => ({
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((clientY - rect.top) / rect.height) * 2 - 1),
    });
    // A CLIENT pixel is only accepted when it and a small pixel neighbourhood (±2px in each
    // direction) ALL resolve to the SAME empty node. Requiring a centred pocket — not just a
    // single edge sample — guarantees the marker-sized hitbox (issue #3) genuinely surrounds the
    // release pixel, so `page.mouse`'s integer/sub-pixel coordinates still land on it.
    const nodeAtPixel = (cx: number, cy: number): string | null => {
      const n = toNdc(cx, cy);
      const h = p.pickAt(n.x, n.y);
      return h && h.kind === 'empty-node' && h.node ? h.node : null;
    };
    for (let iy = 200; iy <= 400; iy++) {
      for (let ix = 200; ix <= 400; ix++) {
        const ndcX = (ix / 600) * 2 - 1;
        const ndcY = (iy / 600) * 2 - 1;
        const hit = p.pickAt(ndcX, ndcY);
        if (hit && hit.kind === 'empty-node' && hit.node) {
          const client = toClient(ndcX, ndcY);
          const cx = Math.round(client.x);
          const cy = Math.round(client.y);
          const centre = nodeAtPixel(cx, cy);
          if (
            centre === hit.node &&
            nodeAtPixel(cx - 2, cy) === hit.node &&
            nodeAtPixel(cx + 2, cy) === hit.node &&
            nodeAtPixel(cx, cy - 2) === hit.node &&
            nodeAtPixel(cx, cy + 2) === hit.node
          ) {
            return { x: cx, y: cy, node: hit.node };
          }
        }
      }
    }
    return null;
  });
  if (!found) throw new Error('no central client pixel resolves to an empty node');
  return found;
}

test('a drag across the canvas does NOT place a piece (guard enabled by default)', async ({
  page,
}) => {
  await ready(page);

  const before = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getState()!,
  );
  expect(Object.keys(before.pieces)).toHaveLength(0);

  const target = await clientPxForCentralNode(page);
  // Drag from a side point and RELEASE exactly over the node. The release position resolves to
  // a placeable empty node, so the ONLY reason nothing is placed is the guard recognizing the
  // >threshold travel as a drag — the identical gesture DOES place when the guard is disabled
  // (test below), which is what makes this a genuine (biting) assertion, not a lucky miss.
  const startX = target.x - (threshold + 60);
  const startY = target.y + (threshold + 60);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 16 });
  await page.mouse.up();

  const after = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getState()!,
  );
  // No piece placed — the release was recognized as a drag, not a click.
  expect(Object.keys(after.pieces)).toHaveLength(0);
  expect(after.turn).toBe('white'); // turn did not advance
});

test('a plain click DOES place a piece (guard enabled by default)', async ({ page }) => {
  await ready(page);

  const target = await clientPxForCentralNode(page);
  // pointerdown → pointerup at the SAME spot: a genuine click, zero travel.
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.up();

  const after = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getState()!,
  );
  // Exactly one piece, placed at the clicked node, by the first (white) player.
  expect(Object.keys(after.pieces)).toHaveLength(1);
  expect(after.pieces[target.node]).toBe('white');
  expect(after.turn).toBe('black'); // turn advanced
});

test('with the guard DISABLED via config override, a drag DOES place (toggle bites)', async ({
  page,
}) => {
  // Store the override BEFORE the app boots, exactly how a real user override reaches the
  // config store on load. Disabling reverts to legacy place-on-release regardless of drag.
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [OVERRIDE_KEY, JSON.stringify({ dragGuard: { enabled: false } })] as const,
  );

  await ready(page);

  const before = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getState()!,
  );
  expect(Object.keys(before.pieces)).toHaveLength(0);

  const target = await clientPxForCentralNode(page);
  // Placement uses the RELEASE position, so drag from an empty node OFF onto (ending at) that
  // SAME node's cell: a real >threshold drag whose release still resolves to a node. We start
  // a bit to the side and release exactly over the node — the travel far exceeds threshold.
  const startX = target.x - (threshold + 60);
  const startY = target.y + (threshold + 60);
  // Sanity: the start point is genuinely past the threshold from the release point.
  expect(Math.hypot(target.x - startX, target.y - startY)).toBeGreaterThan(threshold);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 16 });
  await page.mouse.up();

  const after = await page.evaluate(
    () => (window as unknown as { __pente: Pente }).__pente.getState()!,
  );
  // A piece WAS placed (at the release node) despite the large movement — the toggle changed
  // behavior: the identical gesture is suppressed when the guard is enabled (test above).
  expect(Object.keys(after.pieces)).toHaveLength(1);
  expect(after.pieces[target.node]).toBe('white');
  expect(after.turn).toBe('black');
});
