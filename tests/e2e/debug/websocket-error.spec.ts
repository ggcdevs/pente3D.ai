import { test, expect } from '@playwright/test';

test.describe('WebSocket Error Detection', () => {
  test('capture WebSocket connection errors', async ({ page }) => {
    const wsErrors: string[] = [];
    const wsMessages: string[] = [];
    
    // Intercept WebSocket connections
    await page.route('**/*', route => route.continue());
    
    // Listen for console messages specifically about WebSocket
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('WebSocket') || text.includes('ws://') || text.includes('wss://')) {
        wsMessages.push(`[${msg.type().toUpperCase()}] ${text}`);
        if (msg.type() === 'error') {
          wsErrors.push(text);
        }
      }
    });
    
    // Also check for failed WebSocket upgrade requests
    page.on('response', response => {
      if (response.request().headers()['upgrade'] === 'websocket' && response.status() >= 400) {
        wsErrors.push(`WebSocket upgrade failed: ${response.url()} - Status: ${response.status()}`);
      }
    });
    
    // Navigate and wait for potential WebSocket attempts
    await page.goto('http://localhost:3000');
    await page.waitForTimeout(5000);
    
    console.log('\n=== WebSocket Related Messages ===');
    wsMessages.forEach(msg => console.log(msg));
    
    console.log('\n=== WebSocket Errors ===');
    if (wsErrors.length > 0) {
      wsErrors.forEach(err => console.log(`ERROR: ${err}`));
    } else {
      console.log('No WebSocket errors detected');
    }
    
    // Check if Vite HMR WebSocket is the issue
    const viteWsError = wsMessages.find(msg => msg.includes('vite') && msg.includes('error'));
    if (viteWsError) {
      console.log('\n=== Vite HMR WebSocket Issue ===');
      console.log(viteWsError);
    }
    
    expect(true).toBe(true);
  });
});