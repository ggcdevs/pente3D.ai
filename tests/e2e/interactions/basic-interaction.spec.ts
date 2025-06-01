import { test, expect } from '@playwright/test';

test.describe('Basic Interactions', () => {
  test('should load game and expose objects', async ({ page }) => {
    await page.goto('/');
    
    // Wait for game to initialize
    await page.waitForTimeout(1000);
    
    // Check if objects are exposed
    const exposed = await page.evaluate(() => {
      const win = window as any;
      return {
        hasGame: !!win.game,
        hasRenderer: !!win.renderer,
        hasInputHandler: !!win.inputHandler,
        canvasFound: !!document.querySelector('canvas')
      };
    });
    
    console.log('Exposed objects:', exposed);
    
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

    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Try a simple click
    await page.mouse.click(300, 300);
    await page.waitForTimeout(500);
    
    // Try a drag
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(300, 200, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    
    // Check for any console errors
    const errors = consoleMessages.filter(msg => msg.startsWith('error:'));
    console.log('Console errors:', errors);
    
    expect(errors.length).toBe(0);
  });

  test('should show click debug messages', async ({ page }) => {
    const clickMessages: string[] = [];
    page.on('console', msg => {
      if (msg.text().includes('Click detected')) {
        clickMessages.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Click on canvas
    const canvas = page.locator('canvas');
    await canvas.click({ position: { x: 300, y: 300 } });
    
    await page.waitForTimeout(500);
    
    console.log('Click messages:', clickMessages);
    
    // Should have logged click detection
    expect(clickMessages.length).toBeGreaterThan(0);
  });
});