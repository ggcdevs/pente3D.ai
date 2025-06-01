import { test, expect } from '@playwright/test';

test.describe('Detailed Network Analysis', () => {
  test('capture all network activity with detailed logging', async ({ page, browserName }) => {
    const networkLog: any[] = [];
    
    // Track all requests with detailed info
    page.on('request', request => {
      const entry = {
        timestamp: new Date().toISOString(),
        event: 'request',
        url: request.url(),
        type: request.resourceType(),
        method: request.method(),
        headers: request.headers(),
        postData: request.postData()
      };
      networkLog.push(entry);
      
      // Log WebSocket-like requests immediately
      if (request.url().includes('ws://') || 
          request.url().includes('wss://') || 
          request.url().includes('socket') ||
          request.url().includes('token=') ||
          request.resourceType() === 'websocket') {
        console.log(`\n[${browserName}] Suspicious request detected:`);
        console.log(`  URL: ${request.url()}`);
        console.log(`  Method: ${request.method()}`);
        console.log(`  Type: ${request.resourceType()}`);
        console.log(`  Headers:`, request.headers());
      }
    });
    
    // Track failed requests
    page.on('requestfailed', request => {
      const entry = {
        timestamp: new Date().toISOString(),
        event: 'requestfailed',
        url: request.url(),
        failure: request.failure()?.errorText || 'Unknown',
        method: request.method(),
        type: request.resourceType()
      };
      networkLog.push(entry);
      console.log(`\n[${browserName}] Request failed: ${request.url()}`);
      console.log(`  Error: ${entry.failure}`);
    });
    
    // Track responses
    page.on('response', response => {
      const entry = {
        timestamp: new Date().toISOString(),
        event: 'response',
        url: response.url(),
        status: response.status(),
        headers: response.headers()
      };
      networkLog.push(entry);
      
      if (response.status() >= 400) {
        console.log(`\n[${browserName}] HTTP Error ${response.status()}: ${response.url()}`);
      }
    });
    
    // Also track WebSocket events
    page.on('websocket', ws => {
      console.log(`\n[${browserName}] WebSocket created: ${ws.url()}`);
      
      ws.on('framereceived', event => {
        console.log(`  Frame received: ${event.payload}`);
      });
      
      ws.on('framesent', event => {
        console.log(`  Frame sent: ${event.payload}`);
      });
      
      ws.on('close', () => {
        console.log(`  WebSocket closed`);
      });
    });
    
    console.log(`\n=== Starting ${browserName} test ===`);
    
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000); // Wait longer to catch delayed requests
    
    // Analyze the network log
    console.log(`\n=== ${browserName} Network Summary ===`);
    console.log(`Total requests: ${networkLog.filter(e => e.event === 'request').length}`);
    
    // Look for any suspicious patterns
    const suspiciousRequests = networkLog.filter(e => 
      e.event === 'request' && (
        e.url.includes('ws://') || 
        e.url.includes('wss://') || 
        e.url.includes('socket') ||
        e.url.includes('token=') ||
        e.url.includes(':9222') || // Chrome DevTools
        e.type === 'websocket'
      )
    );
    
    if (suspiciousRequests.length > 0) {
      console.log(`\n=== Suspicious Requests for ${browserName} ===`);
      suspiciousRequests.forEach(req => {
        console.log(`${req.method} ${req.url}`);
        console.log(`  Type: ${req.type}`);
        console.log(`  Time: ${req.timestamp}`);
      });
    }
    
    // Check for localhost connections on unusual ports
    const localhostRequests = networkLog.filter(e => 
      e.event === 'request' && 
      e.url.includes('localhost') && 
      !e.url.includes('localhost:3000')
    );
    
    if (localhostRequests.length > 0) {
      console.log(`\n=== Non-3000 localhost requests for ${browserName} ===`);
      localhostRequests.forEach(req => {
        console.log(`${req.method} ${req.url}`);
      });
    }
    
    expect(true).toBe(true);
  });
});