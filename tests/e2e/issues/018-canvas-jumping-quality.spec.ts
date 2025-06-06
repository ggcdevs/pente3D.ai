import { test, expect } from '@playwright/test';

test.describe('Issue #018: Canvas Jumping on Quality Downgrade', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000); // Wait for game to load
  });

  test('canvas should not jump when quality changes to medium', async ({ page }) => {
    // Get initial canvas position and size
    const initialPos = await page.evaluate(() => {
      const canvas = document.querySelector('#game-canvas') as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height
      };
    });

    console.log('Initial canvas position:', initialPos);

    // Force quality manager to downgrade by simulating low FPS
    await page.evaluate(() => {
      const qualityManager = (window as any).qualityManager;
      if (qualityManager) {
        // Force a quality downgrade by triggering performance warning
        qualityManager.emit('performance-warning', {
          type: 'low-fps',
          value: 0.0,
          threshold: 45
        });
      }
    });

    await page.waitForTimeout(1000);

    // Check for quality change message
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      consoleMessages.push(msg.text());
    });

    // Wait a bit more for potential messages
    await page.waitForTimeout(2000);

    // Check if canvas position changed
    const finalPos = await page.evaluate(() => {
      const canvas = document.querySelector('#game-canvas') as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height
      };
    });

    console.log('Final canvas position:', finalPos);
    console.log('Console messages:', consoleMessages);

    // Canvas position should not change significantly
    expect(Math.abs(finalPos.left - initialPos.left)).toBeLessThan(5);
    expect(Math.abs(finalPos.top - initialPos.top)).toBeLessThan(5);
    
    // Canvas display size should remain the same
    expect(Math.abs(finalPos.width - initialPos.width)).toBeLessThan(5);
    expect(Math.abs(finalPos.height - initialPos.height)).toBeLessThan(5);
  });

  test('should reproduce actual quality downgrade scenario', async ({ page }) => {
    // Monitor console for quality change messages
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      consoleMessages.push(msg.text());
    });

    // Get initial canvas position
    const initialPos = await page.evaluate(() => {
      const canvas = document.querySelector('#game-canvas') as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });

    // Simulate actual quality manager behavior
    await page.evaluate(() => {
      const qualityManager = (window as any).qualityManager;
      if (qualityManager) {
        // Directly call the method that would be triggered by low FPS
        const presetIndex = qualityManager.currentPresetIndex || 1;
        qualityManager.currentPresetIndex = Math.min(presetIndex + 1, 4); // Move to medium/low
        
        // Apply the medium preset directly
        const preset = qualityManager.presets[qualityManager.currentPresetIndex];
        if (preset) {
          qualityManager.applyPreset(qualityManager.currentPresetIndex, 'FPS below threshold (0.0 < 45)');
        }
      }
    });

    await page.waitForTimeout(1000);

    // Check final position
    const finalPos = await page.evaluate(() => {
      const canvas = document.querySelector('#game-canvas') as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });

    console.log('Console messages during test:', consoleMessages);
    console.log('Position change:', {
      left: finalPos.left - initialPos.left,
      top: finalPos.top - initialPos.top,
      width: finalPos.width - initialPos.width,
      height: finalPos.height - initialPos.height
    });

    // Check for the specific message mentioned by user
    const hasQualityMessage = consoleMessages.some(msg => 
      msg.includes('Quality changed to medium') && msg.includes('FPS below threshold')
    );
    
    if (hasQualityMessage) {
      console.log('✓ Quality change message detected');
    }

    // The test primarily documents the behavior for debugging
    // We expect the canvas position to remain stable
    expect(Math.abs(finalPos.left - initialPos.left)).toBeLessThan(10);
    expect(Math.abs(finalPos.top - initialPos.top)).toBeLessThan(10);
  });
});