import { test, expect } from '@playwright/test';

test.describe('Issue #006: Zoom Limits', () => {
  test('should allow zooming into center of board', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Get initial camera distance and board size
    const initialState = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      if (!renderer) return null;
      
      const camera = renderer.getCamera();
      const controls = renderer.getControls();
      
      // Calculate distance from origin
      const distance = Math.sqrt(
        camera.position.x ** 2 + 
        camera.position.y ** 2 + 
        camera.position.z ** 2
      );
      
      // Board size is 7x7x7 with cellSize 1, so radius is ~3.5
      const boardRadius = 3.5;
      
      return {
        distance,
        minDistance: controls.minDistance,
        maxDistance: controls.maxDistance,
        boardRadius,
        boardSize: 7
      };
    });
    
    console.log('Initial state:', initialState);
    expect(initialState).toBeTruthy();
    
    // The minDistance should be less than board radius to allow zooming inside
    expect(initialState!.minDistance).toBeLessThan(initialState!.boardRadius);
    
    // Try to zoom in as much as possible
    const canvas = page.locator('canvas');
    await canvas.hover();
    
    // Zoom in aggressively
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(50);
    }
    
    // Check final camera distance
    const finalDistance = await page.evaluate(() => {
      const renderer = (window as any).renderer;
      const camera = renderer.getCamera();
      
      return Math.sqrt(
        camera.position.x ** 2 + 
        camera.position.y ** 2 + 
        camera.position.z ** 2
      );
    });
    
    console.log('Final distance after zoom:', finalDistance);
    console.log('Board radius:', initialState!.boardRadius);
    
    // Camera should be able to get inside the board (distance < boardRadius)
    expect(finalDistance).toBeLessThan(initialState!.boardRadius);
  });
});