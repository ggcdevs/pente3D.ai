import { test, expect, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Issue #44 mobile-UI-polish artifacts — NOT a behavioral gate, a screenshot capture for the human's
 * hands-on review pass. Drives the REAL app and, at BOTH a mobile (iPhone-13) viewport and desktop,
 * captures the board + HUD showing the three #44 changes together:
 *   1. the relocated Undo / Redo / Reset controls directly UNDER the history slider (bottom-center);
 *   2. the shared modern rounded input/button styling across the HUD + the open menu drawer;
 *   3. the merged net status (game code + "waiting for opponent") INSIDE the left-aligned, wrapping
 *      score banner (top-center).
 * A hermetic in-page mock transport is injected so hosting connects instantly (no live relay), and a
 * couple of pieces are placed so the score/captures + history controls are populated. The artifacts
 * land in `e2e/artifacts/issue44-*.png` for the human to eyeball and tweak from.
 */

interface NetState {
  phase: 'offline' | 'connecting' | 'connected' | 'conflict';
  code: string | null;
}

/** Inject the deterministic mock transport BEFORE boot so `hostGame` connects instantly (hermetic). */
async function installMock(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    interface MockShared {
      presenceCb: (peers: readonly string[]) => void;
      room: string | null;
    }
    const shared: MockShared = { presenceCb: () => {}, room: null };
    (
      window as unknown as { __penteNetTransportFactory: () => unknown }
    ).__penteNetTransportFactory = () => ({
      connect: (roomCode: string) => {
        shared.room = roomCode;
        shared.presenceCb([]);
        return Promise.resolve();
      },
      publish: () => {},
      onMessage: () => {},
      onPresence: (cb: (peers: readonly string[]) => void) => {
        shared.presenceCb = cb;
      },
      disconnect: () => {
        shared.room = null;
      },
    });
  });
}

async function ready(page: import('@playwright/test').Page) {
  await installMock(page);
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente?: Record<string, unknown> }).__pente;
    return (
      !!p &&
      typeof p.getNet === 'function' &&
      typeof p.dispatch === 'function' &&
      typeof p.place === 'function' &&
      !!document.querySelector('canvas') &&
      !!document.querySelector('[data-widget-id="statusBanner"]') &&
      !!document.querySelector('[data-widget-id="historySlider"]')
    );
  });
}

/** Host a game (so the merged net code + "waiting" status shows) and place two pieces (so the score
 * shows and the history controls enable), leaving the HUD fully populated for the screenshot. */
async function populateHud(page: import('@playwright/test').Page) {
  await page.evaluate(() =>
    (window as unknown as { __pente: { dispatch(id: string): boolean } }).__pente.dispatch(
      'hostGame',
    ),
  );
  await page.waitForFunction(() => {
    const p = (window as unknown as { __pente: { getNet(): NetState | null } }).__pente;
    return p.getNet()?.phase === 'connected';
  });
  await page.evaluate(() =>
    (window as unknown as { __pente: { place(c: [number, number, number]): unknown } }).__pente.place(
      [2, 2, 2],
    ),
  );
  await page.evaluate(() =>
    (window as unknown as { __pente: { place(c: [number, number, number]): unknown } }).__pente.place(
      [3, 3, 3],
    ),
  );
}

const save = (name: string) => {
  const shot = resolve(`e2e/artifacts/${name}`);
  mkdirSync(dirname(shot), { recursive: true });
  return shot;
};

test('desktop: board + HUD (merged score/code/status bar + relocated history controls)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page);
  await populateHud(page);

  // The merged net status shows the code + waiting line inside the banner (top-center).
  await expect(page.locator('[data-widget-id="statusBanner"] [data-testid="net-code"]')).toBeVisible();
  await expect(
    page.locator('[data-widget-id="statusBanner"] [data-testid="net-status-line"]'),
  ).toHaveText('Waiting for opponent…');
  // The relocated Undo/Redo/Reset controls are present under the slider and Undo is enabled.
  await expect(page.locator('[data-testid="history-button-undo"]')).toBeEnabled();

  await page.screenshot({ path: save('issue44-desktop.png') });
});

test('desktop: the menu drawer OPEN over the live board (shared rounded styling)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page);
  await populateHud(page);

  await page.locator('[data-testid="menu-button"]').click();
  await expect(page.locator('[data-testid="menu-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-modal"]')).toHaveClass(/pente-menu-drawer--open/);

  await page.screenshot({ path: save('issue44-menu.png') });
});

test('mobile (iPhone 13): board + HUD wraps/collapses reasonably at a narrow width', async ({
  page,
}) => {
  const iphone = devices['iPhone 13'];
  await page.setViewportSize(iphone.viewport);
  await ready(page);
  await populateHud(page);

  // At the narrow viewport the merged banner still shows the score + code + status; it wraps rather
  // than overflowing (the banner box stays within the viewport width).
  await expect(page.locator('[data-widget-id="statusBanner"] [data-testid="net-code"]')).toBeVisible();
  const box = await page.locator('[data-widget-id="statusBanner"]').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(iphone.viewport.width + 1);

  await page.screenshot({ path: save('issue44-mobile.png') });
});

test('mobile (iPhone 13): the menu drawer OPEN at a narrow width', async ({ page }) => {
  const iphone = devices['iPhone 13'];
  await page.setViewportSize(iphone.viewport);
  await ready(page);
  await populateHud(page);

  await page.locator('[data-testid="menu-button"]').click();
  await expect(page.locator('[data-testid="menu-modal"]')).toBeVisible();

  await page.screenshot({ path: save('issue44-mobile-menu.png') });
});
