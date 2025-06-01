import { test, expect } from '@playwright/test';

test.describe('Full Network Analysis', () => {
  test('capture all network requests and errors', async ({ page }) => {
    const failedRequests: any[] = [];
    const allRequests: { url: string, type: string, method: string }[] = [];
    
    // Track all requests
    page.on('request', request => {
      allRequests.push({
        url: request.url(),
        type: request.resourceType(),
        method: request.method()
      });
    });
    
    // Track failed requests
    page.on('requestfailed', request => {
      failedRequests.push({
        url: request.url(),
        failure: request.failure()?.errorText || 'Unknown',
        method: request.method(),
        type: request.resourceType()
      });
    });
    
    // Track responses with errors
    page.on('response', response => {
      if (response.status() >= 400) {
        console.log(`HTTP Error: ${response.status()} - ${response.url()}`);
      }
    });
    
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    
    console.log('\n=== Failed Requests ===');
    if (failedRequests.length > 0) {
      failedRequests.forEach(req => {
        console.log(`FAILED: ${req.method} ${req.url}`);
        console.log(`  Type: ${req.type}`);
        console.log(`  Error: ${req.failure}`);
      });
    } else {
      console.log('No failed requests');
    }
    
    // Check for WebSocket connections
    const wsRequests = allRequests.filter(req => 
      req.url.includes('ws://') || 
      req.url.includes('wss://') || 
      req.type === 'websocket'
    );
    
    console.log('\n=== WebSocket Requests ===');
    if (wsRequests.length > 0) {
      wsRequests.forEach(req => {
        console.log(`${req.method} ${req.url}`);
      });
    } else {
      console.log('No WebSocket requests detected');
    }
    
    expect(true).toBe(true);
  });
});