import { test, expect, devices } from '@playwright/test';

test.describe('Issue #008: Firefox Headless Test', () => {
  test('firefox should run headless without dialogs', async ({ page, browserName }) => {
    // Only run this test on Firefox
    if (browserName !== 'firefox') {
      test.skip();
      return;
    }

    console.log('Testing Firefox headless behavior...');
    
    // Navigate to the app
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    // Check if we can interact with the page normally
    const title = await page.title();
    console.log('Page title:', title);
    expect(title).toBeTruthy();
    
    // Try to interact with the canvas
    const canvas = page.locator('#game-canvas');
    await expect(canvas).toBeVisible();
    
    // Focus and try keyboard interaction
    await canvas.focus();
    await page.keyboard.press('t');
    await page.waitForTimeout(100);
    
    // Verify temporary mode activation
    const tempMode = await page.evaluate(() => {
      return (window as any).inputHandler?.state?.temporaryPieceMode || false;
    });
    
    expect(tempMode).toBe(true);
    console.log('✅ Firefox headless test passed - no dialogs should have appeared');
  });

  test('multiple firefox instances should not conflict', async ({ browser }) => {
    // Create multiple contexts to simulate multiple instances
    const contexts = [];
    const pages = [];
    
    try {
      // Create 3 contexts/pages
      for (let i = 0; i < 3; i++) {
        console.log(`Creating Firefox context ${i + 1}...`);
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Navigate each to the app
        await page.goto('/');
        await page.waitForTimeout(1000);
        
        contexts.push(context);
        pages.push(page);
      }
      
      // Test that all pages are working
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const title = await page.title();
        console.log(`Page ${i + 1} title:`, title);
        expect(title).toBeTruthy();
        
        // Try basic interaction
        const canvas = page.locator('#game-canvas');
        await expect(canvas).toBeVisible();
      }
      
      console.log('✅ Multiple Firefox instances test passed');
      
    } finally {
      // Clean up all contexts
      for (const context of contexts) {
        await context.close();
      }
    }
  });
  
  test('check browser launch options', async ({ browser }) => {
    console.log('Browser name:', browser.browserType().name());
    
    // Get browser context info
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Check user agent to verify it's actually Firefox
    const userAgent = await page.evaluate(() => navigator.userAgent);
    console.log('User agent:', userAgent);
    expect(userAgent).toContain('Firefox');
    
    // Check if running headless (viewport size is usually a good indicator)
    const viewport = page.viewportSize();
    console.log('Viewport size:', viewport);
    
    // In headless mode, viewport should be set
    expect(viewport).toBeTruthy();
    expect(viewport!.width).toBeGreaterThan(0);
    expect(viewport!.height).toBeGreaterThan(0);
    
    await context.close();
    console.log('✅ Firefox browser options check passed');
  });
});