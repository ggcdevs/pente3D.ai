import { test, expect } from '@playwright/test';

test.describe('Issue #006: Zoom Limits (Quick)', () => {
  test('minDistance should allow zooming into board', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Just check the minDistance setting
    const config = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      if (!renderer) return null;
      
      const controls = renderer.getControls();
      const boardRadius = 3.5; // 7x7x7 board with cellSize 1
      
      return {
        minDistance: controls.minDistance,
        boardRadius
      };
    });
    
    console.log('Config:', config);
    expect(config).toBeTruthy();
    
    // The minDistance should be less than board radius to allow zooming inside
    expect(config!.minDistance).toBeLessThan(config!.boardRadius);
    expect(config!.minDistance).toBe(0.5); // Our new setting
  });
});