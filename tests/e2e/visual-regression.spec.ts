/**
 * Visual regression test suite
 * Tests all UI states and visual components
 */

import { test, expect } from '@/tests/helpers/e2e';

test.describe('Visual Regression Tests', () => {
  test.beforeEach(async ({ page, testEnv }) => {
    await testEnv.isolateTest();
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test.describe('Game Board States', () => {
    test('empty board', async ({ visual }) => {
      await visual.waitForVisualStability();
      
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled',
        maskRegions: [
          { x: 0, y: 0, width: 200, height: 50 } // Mask timestamp/version
        ]
      });
      
      const result = await visual.compareWithBaseline(screenshot, 'board-empty');
      expect(result.match).toBe(true);
    });

    test('board with pieces', async ({ game, visual }) => {
      // Place some pieces
      await game.placePiece({ x: 0, y: 0, z: 0 });
      await game.placePiece({ x: 1, y: 0, z: 0 });
      await game.placePiece({ x: 0, y: 1, z: 0 });
      await game.placePiece({ x: 1, y: 1, z: 0 });
      
      await visual.waitForVisualStability();
      
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled'
      });
      
      const result = await visual.compareWithBaseline(screenshot, 'board-with-pieces');
      expect(result.match).toBe(true);
    });

    test('winning position', async ({ game, visual }) => {
      // Create a winning line
      for (let i = 0; i < 5; i++) {
        await game.placePiece({ x: i, y: 0, z: 0 });
        if (i < 4) {
          await game.placePiece({ x: i, y: 1, z: 0 });
        }
      }
      
      await visual.waitForVisualStability();
      
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled'
      });
      
      const result = await visual.compareWithBaseline(screenshot, 'board-winning');
      expect(result.match).toBe(true);
    });

    test('board rotations', async ({ game, visual }) => {
      // Place pieces for reference
      await game.placePiece({ x: 0, y: 0, z: 0 });
      await game.placePiece({ x: 2, y: 2, z: 0 });
      
      const rotations = [
        { angle: 45, name: 'rotation-45' },
        { angle: 90, name: 'rotation-90' },
        { angle: 180, name: 'rotation-180' },
      ];
      
      for (const { angle, name } of rotations) {
        await game.rotateBoard(angle, 0);
        await visual.waitForVisualStability();
        
        const screenshot = await visual.takeScreenshot({
          animations: 'disabled'
        });
        
        const result = await visual.compareWithBaseline(screenshot, `board-${name}`);
        expect(result.match).toBe(true);
      }
    });
  });

  test.describe('UI Modals', () => {
    test('menu modal', async ({ game, visual }) => {
      await game.openMenu();
      await expect(game.isModalVisible('Menu')).resolves.toBe(true);
      
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled'
      });
      
      const result = await visual.compareWithBaseline(screenshot, 'modal-menu');
      expect(result.match).toBe(true);
    });

    test('settings modal', async ({ game, visual }) => {
      await game.openMenu();
      await game.clickButton('Settings');
      await expect(game.isModalVisible('Settings')).resolves.toBe(true);
      
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled'
      });
      
      const result = await visual.compareWithBaseline(screenshot, 'modal-settings');
      expect(result.match).toBe(true);
    });

    test('network modal', async ({ game, visual }) => {
      await game.openMenu();
      await game.clickButton('Network Game');
      await expect(game.isModalVisible('Network Game')).resolves.toBe(true);
      
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled'
      });
      
      const result = await visual.compareWithBaseline(screenshot, 'modal-network');
      expect(result.match).toBe(true);
    });

    test('keyboard help modal', async ({ game, visual }) => {
      await game.openMenu();
      await game.clickButton('Keyboard Shortcuts');
      await expect(game.isModalVisible('Keyboard Shortcuts')).resolves.toBe(true);
      
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled'
      });
      
      const result = await visual.compareWithBaseline(screenshot, 'modal-keyboard-help');
      expect(result.match).toBe(true);
    });
  });

  test.describe('Themes', () => {
    test('default theme', async ({ visual }) => {
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled',
        fullPage: true
      });
      
      const result = await visual.compareWithBaseline(screenshot, 'theme-default');
      expect(result.match).toBe(true);
    });

    test('dark theme', async ({ page, game, visual }) => {
      // Apply dark theme
      await game.openMenu();
      await game.clickButton('Settings');
      await page.click('select#theme-select');
      await page.selectOption('select#theme-select', 'dark');
      await game.closeModal();
      
      await visual.waitForVisualStability();
      
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled',
        fullPage: true
      });
      
      const result = await visual.compareWithBaseline(screenshot, 'theme-dark');
      expect(result.match).toBe(true);
    });

    test('high contrast theme', async ({ page, game, visual }) => {
      // Apply high contrast theme
      await game.openMenu();
      await game.clickButton('Settings');
      await page.click('select#theme-select');
      await page.selectOption('select#theme-select', 'high-contrast');
      await game.closeModal();
      
      await visual.waitForVisualStability();
      
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled',
        fullPage: true
      });
      
      const result = await visual.compareWithBaseline(screenshot, 'theme-high-contrast');
      expect(result.match).toBe(true);
    });
  });

  test.describe('Responsive Layout', () => {
    test('responsive viewports', async ({ game, visual }) => {
      // Place some pieces for context
      await game.placePiece({ x: 0, y: 0, z: 0 });
      await game.placePiece({ x: 1, y: 1, z: 0 });
      
      const viewports = [
        { width: 1920, height: 1080, label: 'desktop-full' },
        { width: 1366, height: 768, label: 'desktop-medium' },
        { width: 1024, height: 768, label: 'tablet-landscape' },
        { width: 768, height: 1024, label: 'tablet-portrait' },
        { width: 375, height: 667, label: 'mobile' },
      ];
      
      const screenshots = await visual.takeResponsiveScreenshots(
        'layout',
        viewports,
        { animations: 'disabled' }
      );
      
      for (const [name, screenshot] of screenshots) {
        const result = await visual.compareWithBaseline(screenshot, name);
        expect(result.match).toBe(true);
      }
    });
  });

  test.describe('Game States', () => {
    test('hover states', async ({ page, game, visual }) => {
      // Place a piece
      await game.placePiece({ x: 0, y: 0, z: 0 });
      
      // Hover over empty position
      const canvas = await page.$('#game-canvas');
      const box = await canvas!.boundingBox();
      await page.mouse.move(box!.x + box!.width / 2 + 50, box!.y + box!.height / 2);
      
      await page.waitForTimeout(100); // Let hover state settle
      
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled'
      });
      
      const result = await visual.compareWithBaseline(screenshot, 'state-hover');
      expect(result.match).toBe(true);
    });

    test('piece highlights', async ({ game, visual }) => {
      // Create a situation with captures
      await game.placePiece({ x: 0, y: 0, z: 0 }); // black
      await game.placePiece({ x: 1, y: 0, z: 0 }); // white
      await game.placePiece({ x: 3, y: 0, z: 0 }); // black
      await game.placePiece({ x: 2, y: 0, z: 0 }); // white
      
      await visual.waitForVisualStability();
      
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled'
      });
      
      const result = await visual.compareWithBaseline(screenshot, 'state-highlights');
      expect(result.match).toBe(true);
    });

    test('network status indicators', async ({ game, visual }) => {
      // Host a network game
      await game.hostGame();
      
      await visual.waitForVisualStability();
      
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled',
        maskRegions: [
          { x: 0, y: 50, width: 300, height: 50 } // Mask game code
        ]
      });
      
      const result = await visual.compareWithBaseline(screenshot, 'state-network-host');
      expect(result.match).toBe(true);
    });
  });

  test.describe('Error States', () => {
    test('connection error', async ({ page, browser, visual }) => {
      // Simulate offline
      await browser.setNetworkConditions({ offline: true });
      
      // Try to host game
      await page.click('#menu-button');
      await page.click('button:has-text("Network Game")');
      await page.click('button:has-text("Host Game")');
      
      await page.waitForTimeout(1000); // Wait for error
      
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled'
      });
      
      const result = await visual.compareWithBaseline(screenshot, 'error-connection');
      expect(result.match).toBe(true);
    });
  });

  test.describe('Accessibility Features', () => {
    test('focus indicators', async ({ page, visual }) => {
      // Tab through UI elements
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled'
      });
      
      const result = await visual.compareWithBaseline(screenshot, 'accessibility-focus');
      expect(result.match).toBe(true);
    });

    test('reduced motion', async ({ page, game, visual }) => {
      // Enable reduced motion
      await page.emulateMedia({ reducedMotion: 'reduce' });
      
      // Perform actions that would normally animate
      await game.placePiece({ x: 0, y: 0, z: 0 });
      await game.rotateBoard(90, 0);
      
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled'
      });
      
      const result = await visual.compareWithBaseline(screenshot, 'accessibility-reduced-motion');
      expect(result.match).toBe(true);
    });
  });

  test.describe('Cross-Browser Visual Tests', () => {
    test('cross-browser consistency', async ({ page, browserName, game, visual }) => {
      // Set up consistent state
      await game.placePiece({ x: 0, y: 0, z: 0 });
      await game.placePiece({ x: 1, y: 1, z: 0 });
      await game.placePiece({ x: -1, y: -1, z: 0 });
      
      const screenshot = await visual.takeScreenshot({
        animations: 'disabled'
      });
      
      // Store screenshots by browser
      const screenshots = new Map<string, Buffer>();
      screenshots.set(browserName, screenshot);
      
      // Compare if we have multiple browsers
      if (screenshots.size > 1) {
        const results = await visual.crossBrowserCompare('game-state', screenshots);
        
        for (const [browser, result] of results) {
          expect(result.match).toBe(true);
        }
      }
    });
  });
});