import { test, expect } from '@playwright/test';
import { setupTest } from '../../helpers/e2e';

test.describe('Basic Interactions', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure clean test environment
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should load game and expose objects', async ({ page }) => {
    await setupTest(page);
    
    // Check if objects are exposed using helper
    const exposed = await page.evaluate(() => {
      const win = window as any;
      return {
        hasGame: !!win.game,
        hasRenderer: !!win.renderer,
        hasInputHandler: !!win.inputHandler,
        canvasFound: !!document.querySelector('canvas')
      };
    });
    
    expect(exposed.hasGame).toBe(true);
    expect(exposed.hasRenderer).toBe(true);
    expect(exposed.hasInputHandler).toBe(true);
    expect(exposed.canvasFound).toBe(true);
  });

  test('should detect board interactions without errors', async ({ page }) => {
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
    });

    await setupTest(page);
    
    // Try a simple click using page coordinates
    await page.mouse.click(300, 300);
    await page.waitForTimeout(100);
    
    // Try a drag (board rotation)
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(300, 200, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    
    // Check for any console errors
    const errors = consoleMessages.filter(msg => msg.startsWith('error:'));
    expect(errors.length).toBe(0);
  });

  test('should show click debug messages', async ({ page }) => {
    const clickMessages: string[] = [];
    page.on('console', msg => {
      if (msg.text().includes('Click detected')) {
        clickMessages.push(msg.text());
      }
    });

    await setupTest(page);
    
    // Click on canvas
    const canvas = page.locator('canvas');
    await canvas.click({ position: { x: 300, y: 300 } });
    
    await page.waitForTimeout(100);
    
    // Should have logged click detection
    expect(clickMessages.length).toBeGreaterThan(0);
  });

  test('should handle rapid interactions', async ({ page }) => {
    await setupTest(page);
    
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    
    // Perform rapid clicks
    for (let i = 0; i < 5; i++) {
      await page.mouse.click(300 + i * 50, 300);
      // No wait between clicks to test rapid interaction
    }
    
    // Perform rapid drags
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(200, 200);
      await page.mouse.down();
      await page.mouse.move(300 + i * 50, 200, { steps: 2 });
      await page.mouse.up();
    }
    
    // Should handle all interactions without errors
    expect(errors).toHaveLength(0);
  });
});