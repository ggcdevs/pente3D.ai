import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import layoutDefault from '../src/config/defaults/layout.json' with { type: 'json' };

/**
 * Task 5.1 e2e — the composable-UI shell is an IO boundary, verified by driving the REAL app and
 * asserting on `window.__pente.getLayout()` (agent-principles #3: observable behavior read back
 * off the live DOM, never a log line). The PURE logic (layout resolver + widget registry) is
 * mutation-gated in Vitest; here we prove the wiring:
 *   - `getLayout()` reflects the tracked `layout` config — the right widget id lands in the right
 *     zone, in `order`, AND the actual DOM elements are the ones reported;
 *   - a hidden widget (visible:false via a localStorage config override) is absent from the DOM;
 *   - reordering the config (swapping two widgets into one zone with swapped `order`) reorders
 *     the mounted DOM elements.
 * Expected zones/ids derive from `layout.json` so nothing is hardcoded (agent-principles #8).
 */

const OVERRIDE_KEY = 'pente:config:layout';

interface LayoutReadout {
  zones: Record<string, string[]>;
}
type Pente = {
  getLayout(): LayoutReadout | null;
};

async function ready(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return !!p && typeof p.getLayout === 'function' && !!document.querySelector('canvas');
  });
}

const getLayout = (page: import('@playwright/test').Page): Promise<LayoutReadout> =>
  page.evaluate(() => {
    const p = (window as unknown as { __pente: Pente }).__pente;
    return p.getLayout() as LayoutReadout;
  });

test('getLayout reflects the tracked layout config (zone + presence)', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  const layout = await getLayout(page);

  // Every visible widget in the tracked default lands in its configured zone, and the DOM
  // element carrying that id actually exists (read back off the DOM, not the plan).
  for (const [id, placement] of Object.entries(layoutDefault.widgets)) {
    if (!placement.visible) continue;
    expect(layout.zones[placement.zone], `widget ${id} → zone ${placement.zone}`).toContain(id);
    // The reported id corresponds to a real mounted element with the widget-id attribute.
    const el = page.locator(`[data-widget-id="${id}"]`);
    await expect(el).toHaveCount(1);
    // And that element sits inside the reported zone element.
    const inZone = page.locator(`[data-zone="${placement.zone}"] [data-widget-id="${id}"]`);
    await expect(inZone).toHaveCount(1);
  }

  // The set of populated zones is exactly the set of zones named by visible widgets.
  const expectedZones = new Set(
    Object.values(layoutDefault.widgets)
      .filter((w) => w.visible)
      .map((w) => w.zone),
  );
  expect(new Set(Object.keys(layout.zones))).toEqual(expectedZones);

  const shot = resolve('e2e/artifacts/layout-default.png');
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});

test('a hidden widget (config override) is absent from the mounted DOM', async ({ page }) => {
  // Pick a widget that ships visible, and hide it via a localStorage layout override before boot.
  const [victim] = Object.entries(layoutDefault.widgets).find(([, w]) => w.visible)!;
  await page.addInitScript(
    ([key, id]) => {
      window.localStorage.setItem(key, JSON.stringify({ widgets: { [id]: { visible: false } } }));
    },
    [OVERRIDE_KEY, victim] as const,
  );

  await page.goto('/');
  await ready(page);

  const layout = await getLayout(page);
  // The hidden widget appears in NO zone, and no DOM element carries its id.
  for (const ids of Object.values(layout.zones)) expect(ids).not.toContain(victim);
  await expect(page.locator(`[data-widget-id="${victim}"]`)).toHaveCount(0);
});

test('reordering the config reorders the mounted DOM', async ({ page }) => {
  // Place two known widgets into ONE zone with a defined order, then boot and read DOM order;
  // then swap their `order` and boot again — the DOM order must follow the config.
  const ids = Object.keys(layoutDefault.widgets);
  const [w1, w2] = [ids[0], ids[1]];

  const override = (o1: number, o2: number) => ({
    widgets: {
      [w1]: { zone: 'left', order: o1, visible: true },
      [w2]: { zone: 'left', order: o2, visible: true },
    },
  });

  // Boot 1: w1 before w2.
  await page.addInitScript(
    ([key, ov]) => window.localStorage.setItem(key, ov),
    [OVERRIDE_KEY, JSON.stringify(override(0, 1))] as const,
  );
  await page.goto('/');
  await ready(page);
  const first = await getLayout(page);
  expect(first.zones['left'].filter((id) => id === w1 || id === w2)).toEqual([w1, w2]);

  // Boot 2: swap the order → w2 before w1. A second init script for the same key is registered
  // AFTER the first, so it runs last and wins on every subsequent navigation; then we reload.
  await page.addInitScript(
    ([key, ov]) => window.localStorage.setItem(key, ov),
    [OVERRIDE_KEY, JSON.stringify(override(1, 0))] as const,
  );
  await page.goto('/');
  await ready(page);
  const second = await getLayout(page);
  expect(second.zones['left'].filter((id) => id === w1 || id === w2)).toEqual([w2, w1]);

  // And the reorder is real in the DOM element order, not just the readout.
  const domOrder = await page.evaluate(() => {
    const zone = document.querySelector('[data-zone="left"]')!;
    return Array.from(zone.querySelectorAll('[data-widget-id]')).map((el) =>
      el.getAttribute('data-widget-id'),
    );
  });
  expect(domOrder.filter((id) => id === w1 || id === w2)).toEqual([w2, w1]);
});
