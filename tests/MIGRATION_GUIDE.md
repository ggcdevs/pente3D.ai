# Test Helper Migration Guide

This guide helps you migrate existing tests to use the new test helper frameworks created during the cleanup phase.

## Overview

The new test helpers provide:
- Better abstractions and cleaner APIs
- Type safety with full TypeScript support
- Built-in test isolation
- Performance monitoring
- Visual regression testing

## E2E Test Migration

### Old Pattern → New Pattern

#### Basic Setup

**Before:**
```typescript
import { test, expect } from '@playwright/test';
import { waitForSceneReady } from '../utils/threejs-helpers';
import { createGameHelpers } from '../utils/game-interactions';

test('example', async ({ page }) => {
  await page.goto('/');
  await waitForSceneReady(page);
  const game = createGameHelpers(page);
  await game.clickGridNode(0, 0, 0);
});
```

**After:**
```typescript
import { test, expect, setupTest } from '@/tests/helpers/e2e';

test('example', async ({ page, game }) => {
  await setupTest(page);
  await game.placePiece({ x: 0, y: 0, z: 0 });
});
```

#### Piece Interactions

**Before:**
```typescript
const game = createGameHelpers(page);
await game.clickGridNode(0, 0, 0);
const pieces = await game.getVisiblePiecesDebug();
```

**After:**
```typescript
await game.placePiece({ x: 0, y: 0, z: 0 });
const pieces = await game.getVisiblePieces();
```

#### Canvas Interactions

**Before:**
```typescript
import { captureCanvas } from '../utils/threejs-helpers';
const screenshot = await captureCanvas(page);
```

**After:**
```typescript
const screenshot = await visual.takeScreenshot({
  animations: 'disabled'
});
```

#### Visual Regression

**Before:**
```typescript
import { compareScreenshots } from '../utils/visual-regression';
const result = await compareScreenshots(actual, baseline);
```

**After:**
```typescript
const result = await visual.compareWithBaseline(screenshot, 'test-name');
expect(result.match).toBe(true);
```

### Complete Migration Example

Here's a full test file migration:

**Before (tests/e2e/smoke/app-loads.spec.ts):**
```typescript
import { test, expect } from '@playwright/test';
import { waitForSceneReady, checkWebGLSupport } from '../utils/threejs-helpers';

test('app loads with 3D scene', async ({ page }) => {
  await page.goto('/');
  
  const hasWebGL = await checkWebGLSupport(page);
  expect(hasWebGL).toBe(true);
  
  await waitForSceneReady(page);
  
  const canvas = await page.$('#game-canvas');
  expect(canvas).toBeTruthy();
});
```

**After:**
```typescript
import { test, expect } from '@/tests/helpers/e2e';

test('app loads with 3D scene', async ({ page, testEnv, browser }) => {
  await testEnv.skipIfNoWebGL();
  
  await page.goto('/');
  await page.waitForSelector('#game-canvas');
  
  const caps = await browser.checkCapabilities();
  expect(caps.webgl).toBe(true);
});
```

## Unit Test Migration

### Test Data Builders

**Before:**
```typescript
const board = new Board(7);
const player = new Player('p1', 'black');
board.placePiece(Vector3.create(0, 0, 0), player);
```

**After:**
```typescript
const board = new BoardBuilder()
  .withSize(7)
  .withPiece(0, 0, 0, new PlayerBuilder().withColor('black').build())
  .build();
```

### Mock Creation

**Before:**
```typescript
const mockNetwork = {
  hostGame: jest.fn().mockResolvedValue('ABC123'),
  getStatus: jest.fn().mockReturnValue('connected'),
  // ... manually mock each method
};
```

**After:**
```typescript
const network = new StatefulNetworkManagerMock();
// Automatically tracks state and simulates real behavior
await network.hostGame(); // Returns realistic game code
```

## Migration Checklist

When migrating a test file:

1. **Update imports**
   - Replace old helper imports with new ones
   - Use `@/tests/helpers/*` paths

2. **Replace setup code**
   - Use `setupTest()` instead of manual navigation
   - Use test fixtures instead of manual creation

3. **Update interactions**
   - Use semantic methods (`placePiece` vs `clickGridNode`)
   - Use high-level helpers for complex operations

4. **Add test isolation**
   ```typescript
   test.beforeEach(async ({ testEnv }) => {
     await testEnv.isolateTest();
   });
   ```

5. **Update assertions**
   - Use new validation helpers
   - Use visual regression for UI tests

6. **Add performance checks** (optional)
   ```typescript
   await PerformanceAssertions.assertCompleteWithin(
     () => game.placePiece({ x: 0, y: 0, z: 0 }),
     50 // ms
   );
   ```

## Common Patterns

### Waiting for Elements

**Before:**
```typescript
await page.waitForSelector('#game-canvas');
await page.waitForTimeout(1000); // Arbitrary wait
```

**After:**
```typescript
await game.waitForSceneReady();
await visual.waitForVisualStability();
```

### Modal Interactions

**Before:**
```typescript
await page.click('#menu-button');
await page.waitForSelector('.modal');
await page.click('button:has-text("Settings")');
```

**After:**
```typescript
await game.openMenu();
await game.clickButton('Settings');
await expect(game.isModalVisible('Settings')).resolves.toBe(true);
```

### Network Game Testing

**Before:**
```typescript
// Complex manual setup with mocks
```

**After:**
```typescript
const gameCode = await game.hostGame();
await expect(game.isHost()).resolves.toBe(true);
```

## Tips

1. **Start with smoke tests** - They're usually simpler to migrate
2. **Run tests after each change** - Ensure behavior remains the same
3. **Use the examples** - Check `test-helpers-example.spec.ts` for patterns
4. **Leverage TypeScript** - The new helpers have better type hints
5. **Don't migrate all at once** - Do it file by file

## Need Help?

- Check the example tests in `tests/e2e/examples/`
- Read the helper documentation in `tests/helpers/*/README.md`
- Look at the already migrated tests for patterns