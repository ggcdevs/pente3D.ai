# E2E Test Helpers Documentation

This directory contains the consolidated E2E test utilities that improve upon and replace the existing test helpers.

## Overview

The new test helper library provides:
- **Unified API**: Single consistent interface for all test interactions
- **Better Abstractions**: Higher-level methods that handle common patterns
- **Type Safety**: Full TypeScript support with proper types
- **Test Isolation**: Built-in cleanup and isolation mechanisms
- **Visual Testing**: Enhanced screenshot comparison with masking
- **Performance Monitoring**: Track FPS, memory, and timing metrics
- **Browser Compatibility**: Handle different browsers and capabilities

## Main Components

### 1. Game Page Helpers (`game-page.ts`)

Provides high-level game interaction methods:

```typescript
import { test } from '@/tests/helpers/e2e';

test('example', async ({ game }) => {
  // Place a piece
  await game.placePiece({ x: 0, y: 0, z: 0 });
  
  // Validate placement
  await game.validatePieceAt({ x: 0, y: 0, z: 0 }, 'black');
  
  // Control camera
  await game.rotateBoard(100, 50);
  await game.zoomBoard(200);
  
  // Check game state
  const state = await game.getGameState();
  expect(state.currentPlayer).toBe('white');
});
```

### 2. Visual Testing (`visual-testing.ts`)

Enhanced visual regression testing:

```typescript
test('visual test', async ({ visual }) => {
  // Take screenshot with options
  const screenshot = await visual.takeScreenshot({
    animations: 'disabled',
    maskRegions: [
      { x: 0, y: 0, width: 200, height: 50 } // Mask timestamp
    ]
  });
  
  // Compare with baseline
  const result = await visual.compareWithBaseline(screenshot, 'test-name');
  expect(result.match).toBe(true);
  
  // Test responsive layouts
  const screenshots = await visual.takeResponsiveScreenshots('responsive', [
    { width: 1920, height: 1080, label: 'desktop' },
    { width: 768, height: 1024, label: 'tablet' }
  ]);
});
```

### 3. Browser Helpers (`browser-helpers.ts`)

Browser environment and capability management:

```typescript
test('browser test', async ({ browser }) => {
  // Check capabilities
  const caps = await browser.checkCapabilities();
  expect(caps.webgl).toBe(true);
  
  // Set network conditions
  await browser.setNetworkConditions({
    downloadThroughput: 1.5 * 1024 * 1024 / 8, // 1.5 Mbps
    latency: 40 // 40ms
  });
  
  // Monitor performance
  const metrics = await browser.getPerformanceMetrics();
  expect(metrics.fps).toBeGreaterThan(30);
});
```

### 4. Test Environment (`test-environment.ts`)

Test setup, isolation, and utilities:

```typescript
test('isolated test', async ({ page, testEnv }) => {
  // Skip based on conditions
  await testEnv.skipIfNoWebGL();
  await testEnv.skipIfMobile();
  
  // Track errors
  testEnv.expectNoConsoleErrors();
  
  // Add cleanup handlers
  testEnv.addCleanup(async () => {
    // Custom cleanup logic
  });
  
  // Performance tracing
  await testEnv.startPerformanceTrace();
  // ... perform actions ...
  await testEnv.stopPerformanceTrace('trace-name');
});
```

## Migration Guide

### From Old Helpers to New

**Old way:**
```typescript
import { createGameHelpers } from '../utils/game-interactions';
import { waitForSceneReady } from '../utils/threejs-helpers';

const game = createGameHelpers(page);
await waitForSceneReady(page);
await game.clickGridNode(0, 0, 0);
```

**New way:**
```typescript
import { test, setupTest } from '@/tests/helpers/e2e';

test('example', async ({ page, game }) => {
  await setupTest(page);
  await game.placePiece({ x: 0, y: 0, z: 0 });
});
```

### Key Differences

1. **Fixtures instead of manual creation**: Test helpers are provided as fixtures
2. **Automatic setup**: Common setup is handled by `setupTest()`
3. **Better naming**: Methods have more intuitive names (`placePiece` vs `clickGridNode`)
4. **Type safety**: Full TypeScript support with proper types
5. **Error handling**: Built-in error tracking and reporting

## Best Practices

### 1. Always Isolate Tests
```typescript
test.beforeEach(async ({ testEnv }) => {
  await testEnv.isolateTest();
});
```

### 2. Use Visual Snapshots for UI Changes
```typescript
const screenshot = await visual.takeScreenshot({ animations: 'disabled' });
const result = await visual.compareWithBaseline(screenshot, 'ui-state');
```

### 3. Track Performance for Critical Paths
```typescript
await testEnv.startPerformanceTrace();
// ... perform critical actions ...
await testEnv.stopPerformanceTrace('critical-path');
```

### 4. Handle Modal Dialogs Properly
```typescript
// The game helpers automatically close blocking modals
await game.placePiece({ x: 0, y: 0, z: 0 }); // Will close any open modals first
```

### 5. Use Semantic Waiting
```typescript
// Instead of arbitrary timeouts
await page.waitForTimeout(1000); // Bad

// Use semantic waits
await game.waitForPieceAt({ x: 0, y: 0, z: 0 }); // Good
await visual.waitForVisualStability(); // Good
```

## Advanced Usage

### Custom Test Fixtures

Create your own fixtures that build on the base ones:

```typescript
export const customTest = test.extend<{ 
  gameWithPieces: GamePageHelpers 
}>({
  gameWithPieces: async ({ game }, use) => {
    // Set up initial pieces
    await game.placePiece({ x: 0, y: 0, z: 0 });
    await game.placePiece({ x: 1, y: 0, z: 0 });
    
    // Provide the game with setup
    await use(game);
  }
});
```

### Performance Benchmarking

```typescript
test('performance benchmark', async ({ browser, testEnv }) => {
  const iterations = 10;
  const timings: number[] = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    // ... perform action ...
    timings.push(Date.now() - start);
  }
  
  const avg = timings.reduce((a, b) => a + b) / timings.length;
  expect(avg).toBeLessThan(100); // Must complete in under 100ms
});
```

### Network Testing

```typescript
test('offline mode', async ({ browser, game }) => {
  // Go offline
  await browser.setNetworkConditions({ offline: true });
  
  // Verify offline handling
  await game.hostGame();
  await expect(game.getNetworkStatus()).resolves.toBe('error');
});
```

## Debugging

### Enable Debug Mode
```typescript
// In test
await page.evaluate(() => {
  (window as any).DEBUG = true;
});
```

### Take Annotated Screenshots
```typescript
import { testUtils } from '@/tests/helpers/e2e';

const screenshot = await testUtils.annotatedScreenshot(page, 'debug', [
  { type: 'circle', x: 100, y: 100, radius: 50, color: 'red' },
  { type: 'text', x: 100, y: 150, text: 'Problem here', color: 'red' }
]);
```

### Trace Browser Events
```typescript
const logs = browser.setupConsoleMonitoring({
  logErrors: true,
  logWarnings: true,
  logInfo: true
});

// After test
console.log('Errors:', logs.errors);
console.log('Warnings:', logs.warnings);
```