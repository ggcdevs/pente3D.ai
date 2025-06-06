import { test, expect } from '@playwright/test';

test.describe('Issue #009: Performance FPS Reporting', () => {
  test('performance monitor should report valid FPS, not 0.0', async ({ page }) => {
    console.log('Testing FPS reporting in performance monitor...');
    
    // Navigate to the app
    await page.goto('/');
    await page.waitForTimeout(3000); // Let render loop start
    
    // Get the current FPS metrics
    const metrics = await page.evaluate(() => {
      const performanceMonitor = (window as any).renderer?.performanceMonitor;
      if (!performanceMonitor) {
        return { error: 'Performance monitor not found' };
      }
      
      return performanceMonitor.getMetrics();
    });
    
    console.log('Performance metrics:', metrics);
    
    // Verify we have a valid performance monitor
    expect(metrics.error).toBeUndefined();
    
    // Wait a bit more for FPS to stabilize
    await page.waitForTimeout(2000);
    
    const updatedMetrics = await page.evaluate(() => {
      const performanceMonitor = (window as any).renderer?.performanceMonitor;
      return performanceMonitor.getMetrics();
    });
    
    console.log('Updated performance metrics:', updatedMetrics);
    
    // Check that FPS is being tracked (should be > 0)
    expect(updatedMetrics.averageFps).toBeGreaterThan(0);
    expect(updatedMetrics.fps).toBeGreaterThan(0);
    
    // FPS should be reasonable (at least 1 FPS in headless environment)
    expect(updatedMetrics.averageFps).toBeGreaterThan(1);
    
    console.log(`✅ FPS reporting working: ${updatedMetrics.averageFps.toFixed(1)} avg FPS`);
  });
  
  test('quality manager should not report 0.0 FPS threshold errors', async ({ page }) => {
    console.log('Testing quality manager FPS threshold detection...');
    
    // Capture console messages
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      consoleMessages.push(msg.text());
    });
    
    // Navigate to the app
    await page.goto('/');
    await page.waitForTimeout(5000); // Wait longer for quality manager
    
    // Check console for the specific error
    const fpsErrors = consoleMessages.filter(msg => 
      msg.includes('FPS below threshold') && msg.includes('0.0 <')
    );
    
    console.log('All console messages:', consoleMessages);
    console.log('FPS error messages:', fpsErrors);
    
    // Should not have any "0.0 < threshold" errors
    expect(fpsErrors.length).toBe(0);
    
    // Get current quality level
    const qualityInfo = await page.evaluate(() => {
      const qualityManager = (window as any).renderer?.qualityManager;
      if (!qualityManager) return { error: 'Quality manager not found' };
      
      return {
        currentPreset: qualityManager.getCurrentPreset(),
        autoAdjustEnabled: qualityManager.isAutoAdjustEnabled()
      };
    });
    
    console.log('Quality info:', qualityInfo);
    expect(qualityInfo.error).toBeUndefined();
    
    console.log('✅ No 0.0 FPS threshold errors detected');
  });
  
  test('canvas viewport should not have WebGL warnings', async ({ page }) => {
    console.log('Testing for WebGL viewport warnings...');
    
    // Capture console messages
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      consoleMessages.push(msg.text());
    });
    
    // Navigate to the app
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    // Interact with the canvas to trigger rendering
    const canvas = page.locator('#game-canvas');
    await expect(canvas).toBeVisible();
    
    // Try some interactions that might trigger viewport issues
    await canvas.focus();
    await page.keyboard.press('t'); // Enter temporary mode
    await page.waitForTimeout(500);
    
    // Move mouse over canvas
    await canvas.hover();
    await page.waitForTimeout(500);
    
    // Check for WebGL viewport warnings
    const webglWarnings = consoleMessages.filter(msg => 
      msg.includes('viewport rect') || 
      msg.includes('destination rect') ||
      msg.includes('drawElementsInstanced')
    );
    
    console.log('Console messages:', consoleMessages);
    console.log('WebGL warnings:', webglWarnings);
    
    // Should not have viewport rect warnings
    expect(webglWarnings.length).toBe(0);
    
    console.log('✅ No WebGL viewport warnings detected');
  });
});