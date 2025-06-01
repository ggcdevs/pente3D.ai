import { test, expect } from '@playwright/test';

test.describe('Console Error Detection', () => {
  test('capture all console errors and network failures', async ({ page }) => {
    const consoleMessages: { type: string; text: string; location?: string }[] = [];
    const pageErrors: Error[] = [];
    const failedRequests: { url: string; failure: string }[] = [];
    
    // Capture console messages with more detail
    page.on('console', msg => {
      const location = msg.location();
      consoleMessages.push({
        type: msg.type(),
        text: msg.text(),
        location: location ? `${location.url}:${location.lineNumber}:${location.columnNumber}` : undefined
      });
    });
    
    // Capture page errors (uncaught exceptions)
    page.on('pageerror', error => {
      pageErrors.push(error);
    });
    
    // Capture failed network requests
    page.on('requestfailed', request => {
      failedRequests.push({
        url: request.url(),
        failure: request.failure()?.errorText || 'Unknown error'
      });
    });
    
    // Navigate to the page
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    
    // Wait a bit longer to catch any delayed errors
    await page.waitForTimeout(5000);
    
    // Print all console messages
    console.log('\n=== ALL Console Messages ===');
    consoleMessages.forEach(msg => {
      console.log(`[${msg.type.toUpperCase()}] ${msg.text}`);
      if (msg.location) {
        console.log(`    at ${msg.location}`);
      }
    });
    
    // Print page errors
    if (pageErrors.length > 0) {
      console.log('\n=== Page Errors (Uncaught Exceptions) ===');
      pageErrors.forEach(err => {
        console.log(`ERROR: ${err.message}`);
        console.log(`Stack: ${err.stack}`);
      });
    }
    
    // Print failed requests
    if (failedRequests.length > 0) {
      console.log('\n=== Failed Network Requests ===');
      failedRequests.forEach(req => {
        console.log(`FAILED: ${req.url}`);
        console.log(`Reason: ${req.failure}`);
      });
    }
    
    // Filter for errors and warnings
    const errors = consoleMessages.filter(m => m.type === 'error');
    const warnings = consoleMessages.filter(m => m.type === 'warning');
    
    console.log(`\n=== Summary ===`);
    console.log(`Console Errors: ${errors.length}`);
    console.log(`Console Warnings: ${warnings.length}`);
    console.log(`Page Errors: ${pageErrors.length}`);
    console.log(`Failed Requests: ${failedRequests.length}`);
    
    // Print errors in detail
    if (errors.length > 0) {
      console.log('\n=== Console Errors Detail ===');
      errors.forEach(err => {
        console.log(`ERROR: ${err.text}`);
        if (err.location) {
          console.log(`    at ${err.location}`);
        }
      });
    }
    
    // This test always passes - we just want to see the output
    expect(true).toBe(true);
  });
});