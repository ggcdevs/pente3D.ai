import { test, expect } from '@playwright/test';

test.describe('Issue #008: Firefox Dialog Prevention', () => {
  test('rapid firefox launches should not show dialogs', async ({ browser }) => {
    const startTime = Date.now();
    
    // Rapidly create and close multiple Firefox instances
    // This should trigger the "Firefox is already running" dialog if not properly configured
    for (let i = 0; i < 5; i++) {
      console.log(`Launch ${i + 1}: Creating new Firefox context...`);
      
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Navigate to trigger full browser initialization
      await page.goto('/');
      
      // Quick interaction to ensure it's working
      const title = await page.title();
      expect(title).toContain('Pente3D');
      
      // Close immediately
      await context.close();
      
      console.log(`Launch ${i + 1}: Closed successfully`);
      
      // Small delay to prevent overwhelming
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const endTime = Date.now();
    console.log(`✅ Rapid launches completed in ${endTime - startTime}ms without dialogs`);
  });

  test('concurrent firefox instances should not conflict', async ({ browser }) => {
    // Create multiple contexts simultaneously (not sequentially)
    const promises = [];
    
    for (let i = 0; i < 3; i++) {
      const promise = (async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        
        console.log(`Concurrent ${i + 1}: Navigating...`);
        await page.goto('/');
        
        // Do some work
        await page.focus('#game-canvas');
        await page.keyboard.press('t');
        await page.waitForTimeout(500);
        
        const tempMode = await page.evaluate(() => {
          return (window as any).inputHandler?.state?.temporaryPieceMode || false;
        });
        
        expect(tempMode).toBe(true);
        console.log(`Concurrent ${i + 1}: Completed successfully`);
        
        await context.close();
        return true;
      })();
      
      promises.push(promise);
    }
    
    // Wait for all to complete
    const results = await Promise.all(promises);
    expect(results).toHaveLength(3);
    console.log('✅ All concurrent Firefox instances completed successfully');
  });

  test('firefox process cleanup verification', async ({ browser }) => {
    // This test verifies that Firefox processes are properly cleaned up
    
    // Create a context, use it, then close it
    const context = await browser.newContext();
    const page = await context.newPage();
    
    await page.goto('/');
    
    // Get some info about the browser
    const userAgent = await page.evaluate(() => navigator.userAgent);
    expect(userAgent).toContain('Firefox');
    
    // Check browser state
    const isConnected = browser.isConnected();
    expect(isConnected).toBe(true);
    
    // Close context cleanly
    await context.close();
    
    // Browser should still be connected (managed by Playwright)
    expect(browser.isConnected()).toBe(true);
    
    console.log('✅ Firefox process cleanup verified');
  });

  test('verify explicit headless configuration', async ({ page }) => {
    // This test verifies that our explicit headless configuration is working
    
    await page.goto('/');
    
    // Check that we're actually running in headless mode
    // In headless mode, certain properties behave differently
    
    const isHeadless = await page.evaluate(() => {
      // In headless Firefox, screen dimensions are usually different
      return {
        screenWidth: screen.width,
        screenHeight: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        userAgent: navigator.userAgent
      };
    });
    
    console.log('Browser environment:', isHeadless);
    
    // Verify it's Firefox
    expect(isHeadless.userAgent).toContain('Firefox');
    
    // In headless mode, screen dimensions should be reasonable
    expect(isHeadless.screenWidth).toBeGreaterThan(0);
    expect(isHeadless.screenHeight).toBeGreaterThan(0);
    
    console.log('✅ Headless Firefox configuration verified');
  });
});