import { test, expect } from '@playwright/test';

test.describe('Console Debug', () => {
  test('capture all console messages', async ({ page }) => {
    const messages: { type: string; text: string }[] = [];
    
    // Capture all console messages
    page.on('console', msg => {
      messages.push({
        type: msg.type(),
        text: msg.text()
      });
    });
    
    // Navigate to the page
    await page.goto('http://localhost:3000');
    
    // Wait for the page to load
    await page.waitForTimeout(3000);
    
    // Print all messages
    console.log('\n=== Console Messages ===');
    messages.forEach(msg => {
      console.log(`[${msg.type.toUpperCase()}] ${msg.text}`);
    });
    
    // Separate errors and warnings
    const errors = messages.filter(m => m.type === 'error');
    const warnings = messages.filter(m => m.type === 'warning');
    
    console.log(`\n=== Summary ===`);
    console.log(`Errors: ${errors.length}`);
    console.log(`Warnings: ${warnings.length}`);
    
    // Print errors in detail
    if (errors.length > 0) {
      console.log('\n=== Errors Detail ===');
      errors.forEach(err => console.log(`- ${err.text}`));
    }
    
    // This test is just for debugging, so we don't fail it
    expect(true).toBe(true);
  });
});