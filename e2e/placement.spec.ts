import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import keybindingsDefault from '../src/config/defaults/keybindings.json' with { type: 'json' };
import materialsDefault from '../src/config/defaults/materials.json' with { type: 'json' };
import { keyOf } from '../src/core/coords.ts';

/**
 * Task 4.8 e2e — placement + temp mode is an IO boundary, verified by driving the REAL app
 * and asserting on `window.__pente` (agent-principles #3: observable behavior, never a log
 * line). The pure logic (`placementFromHit`, the temp state machine, `tempPlacementScope`)
 * is mutation-gated in Vitest; here we prove the wiring on the live canvas:
 *   - `clickAt` on an empty node PLACES the current player's piece (state + mesh change);
 *   - `clickAt` on the now-occupied node does NOT place a second piece (empty-only rule);
 *   - `t` (enterTempMode) pushes the `tempPlacement` scope onto the live scope stack;
 *   - a click under temp mode draws a TRANSLUCENT preview (opacity = config tempPieceOpacity)
 *     WITHOUT committing a real piece;
 *   - `Enter` (confirmTempPiece) commits the preview → a real piece + pops the temp scope;
 *   - `t` again (exitTempMode) discards the preview + pops the scope.
 * Chords + opacity derive from the tracked config JSON so nothing volatile is hardcoded
 * (agent-principles #8).
 */

type Player = 'white' | 'black';
interface GameStateReadout {
  pieces: Record<string, Player>;
  turn: Player;
}
interface TempReadout {
  active: boolean;
  preview: string | null;
  previewOpacity: number;
}
interface InputReadout {
  scopes: string[];
  commands: string[];
}
interface KeyResolution {
  commandId: string | null;
  scopeId: string | null;
  handled: boolean;
}
interface PieceReadout {
  node: string;
  owner: Player;
}

type Pente = {
  clickAt(ndcX: number, ndcY: number): GameStateReadout | null;
  getState(): GameStateReadout | null;
  getTemp(): TempReadout | null;
  getInput(): InputReadout | null;
  getPieces(): PieceReadout[] | null;
  pressKey(chord: string): KeyResolution | null;
  pickAt(ndcX: number, ndcY: number): { kind: string; node?: string } | null;
};

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.clickAt === 'function' &&
      typeof p.getTemp === 'function' &&
      typeof p.getInput === 'function' &&
      typeof p.pressKey === 'function' &&
      typeof p.pickAt === 'function' &&
      !!document.querySelector('canvas')
    );
  });
}

const call = <T,>(page: import('@playwright/test').Page, fn: (p: Pente) => T): Promise<T> =>
  page.evaluate((body: string): unknown => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    const revived = eval(`(${body})`) as (api: Pente) => unknown;
    return revived(p);
  }, fn.toString()) as Promise<T>;

/** Like `call` but passes a serializable `arg` into the in-page fn (for NDC coords etc.). */
const callWith = <A, T>(
  page: import('@playwright/test').Page,
  arg: A,
  fn: (p: Pente, arg: A) => T,
): Promise<T> =>
  page.evaluate(
    ({ body, a }: { body: string; a: A }): unknown => {
      const p = (window as unknown as { __pente: Pente }).__pente;
      const revived = eval(`(${body})`) as (api: Pente, arg: A) => unknown;
      return revived(p, a);
    },
    { body: fn.toString(), a: arg },
  ) as Promise<T>;

/** Click at an NDC coord pair in-page and return the resulting state (or null). */
const clickNdc = (
  page: import('@playwright/test').Page,
  ndc: [number, number],
): Promise<GameStateReadout | null> =>
  callWith(page, ndc, (p, [x, y]) => p.clickAt(x, y));

/**
 * Find NDC coordinates whose raycast resolves to the given empty node, by scanning the
 * viewport. Camera framing is fixed at load, so a coarse grid reliably finds each node.
 * Returns the NDC that hits `node` (as an empty node), or throws if unreachable.
 */
async function ndcForNode(
  page: import('@playwright/test').Page,
  node: string,
): Promise<[number, number]> {
  const found = await page.evaluate((target: string) => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    for (let iy = 0; iy <= 60; iy++) {
      for (let ix = 0; ix <= 60; ix++) {
        const x = (ix / 60) * 2 - 1;
        const y = (iy / 60) * 2 - 1;
        const hit = p.pickAt(x, y);
        if (hit && hit.node === target) return [x, y] as [number, number];
      }
    }
    return null;
  }, node);
  if (!found) throw new Error(`no NDC resolves to node ${node}`);
  return found;
}

test('clickAt an empty node places a piece; clicking it again does not place a second', async ({
  page,
}) => {
  await ready(page);

  // Empty board to start (no pieces).
  const before = await call(page, (p) => p.getState()!);
  expect(Object.keys(before.pieces)).toHaveLength(0);
  expect(before.turn).toBe('white');

  // Aim at the center node and click it — the pure `placementFromHit` accepts the empty node.
  const center = '2,2,2';
  const centerNdc = await ndcForNode(page, center);
  // clickAt returns the new state on a real placement (not null).
  const placed = await clickNdc(page, centerNdc);
  expect(placed).not.toBeNull();
  expect(placed!.pieces[keyOf([2, 2, 2])]).toBe('white');
  expect(placed!.turn).toBe('black');

  // Click the SAME (now occupied) node — the empty-only rule rejects it, no second piece,
  // turn unchanged.
  const second = await clickNdc(page, centerNdc);
  expect(second).toBeNull();
  const afterSecond = await call(page, (p) => p.getState()!);
  expect(Object.keys(afterSecond.pieces)).toHaveLength(1);
  expect(afterSecond.turn).toBe('black');
});

test('temp mode: t pushes the scope, a click previews translucently, Enter commits, t exits', async ({
  page,
}) => {
  await ready(page);

  // The tracked defaults bind `t → enterTempMode` and `Enter → confirmTempPiece` (SSOT).
  expect(keybindingsDefault['t']).toBe('enterTempMode');
  expect(keybindingsDefault['Enter']).toBe('confirmTempPiece');

  // Enter temp mode via the real keybinding path.
  const enter = await call(page, (p) => p.pressKey('t'));
  expect(enter!.commandId).toBe('enterTempMode');
  const inTemp = await call(page, (p) => p.getInput()!);
  // The tempPlacement scope is now the TOP of the live scope stack.
  expect(inTemp.scopes[inTemp.scopes.length - 1]).toBe('tempPlacement');
  const tempEntered = await call(page, (p) => p.getTemp()!);
  expect(tempEntered.active).toBe(true);
  expect(tempEntered.preview).toBeNull();

  // Click an empty node UNDER temp mode → a translucent preview appears, but NO real piece
  // is committed (state still empty). The preview opacity comes from config (agent-principles #8).
  const node = '3,2,1';
  const nodeNdc = await ndcForNode(page, node);
  const clickResult = await clickNdc(page, nodeNdc);
  expect(clickResult).toBeNull(); // click in temp mode does not commit
  const previewing = await call(page, (p) => p.getTemp()!);
  expect(previewing.active).toBe(true);
  expect(previewing.preview).toBe(node);
  expect(previewing.previewOpacity).toBeCloseTo(materialsDefault.tempPieceOpacity, 6);
  const stillEmpty = await call(page, (p) => p.getState()!);
  expect(Object.keys(stillEmpty.pieces)).toHaveLength(0); // nothing committed yet

  const shot = resolve('e2e/artifacts/placement-temp-preview.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });

  // Enter confirms: the preview becomes a REAL white piece, temp mode exits, scope popped.
  const confirm = await call(page, (p) => p.pressKey('Enter'));
  expect(confirm!.commandId).toBe('confirmTempPiece');
  const committed = await call(page, (p) => p.getState()!);
  expect(committed.pieces[keyOf([3, 2, 1])]).toBe('white');
  expect(committed.turn).toBe('black');
  const afterConfirm = await call(page, (p) => p.getTemp()!);
  expect(afterConfirm.active).toBe(false);
  expect(afterConfirm.preview).toBeNull();
  expect(afterConfirm.previewOpacity).toBeCloseTo(0, 6); // preview mesh hidden
  const inputAfter = await call(page, (p) => p.getInput()!);
  expect(inputAfter.scopes[inputAfter.scopes.length - 1]).toBe('game'); // temp scope popped
});

test('temp mode: t again exits without committing (discard)', async ({ page }) => {
  await ready(page);

  await call(page, (p) => p.pressKey('t')); // enter
  const node = '1,1,1';
  const nodeNdc = await ndcForNode(page, node);
  await clickNdc(page, nodeNdc); // preview
  const previewing = await call(page, (p) => p.getTemp()!);
  expect(previewing.preview).toBe(node);

  // `t` under the tempPlacement scope resolves to exitTempMode (the scope overrides the
  // game-scope `t → enterTempMode`), proving top-down scope resolution on the live stack.
  const exitRes = await call(page, (p) => p.pressKey('t'));
  expect(exitRes!.commandId).toBe('exitTempMode');
  const afterExit = await call(page, (p) => p.getTemp()!);
  expect(afterExit.active).toBe(false);
  expect(afterExit.preview).toBeNull();
  // Discarded: nothing was committed.
  const state = await call(page, (p) => p.getState()!);
  expect(Object.keys(state.pieces)).toHaveLength(0);
  const input = await call(page, (p) => p.getInput()!);
  expect(input.scopes[input.scopes.length - 1]).toBe('game');
});
