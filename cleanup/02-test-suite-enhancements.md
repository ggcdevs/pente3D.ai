# Test Suite Enhancements

## 1. Test Pattern Inconsistencies

### 1.1 Mixed Helper Usage
**Problem**: Some tests use game helpers, others use raw Playwright operations
```typescript
// Inconsistent: Raw keyboard press in tests
await page.keyboard.press('t'); // issues/019-resolved-test.spec.ts
await page.keyboard.press('Enter');

// Better: Create helper for keyboard actions
await game.enterTemporaryMode();
await game.confirmTemporaryPiece();
```

**Solution**: Extend game helpers for all interactions
```typescript
// Add to game-interactions.ts
export interface GameTestHelpers {
  // Keyboard shortcuts
  enterTemporaryMode(): Promise<void>;
  confirmTemporaryPiece(): Promise<void>;
  cancelTemporaryMode(): Promise<void>;
  showKeyboardHelp(): Promise<void>;
  
  // Game state shortcuts
  undoLastMove(): Promise<void>;
  redoLastMove(): Promise<void>;
  resetGame(): Promise<void>;
}
```

### 1.2 Inconsistent Test Setup
**Problem**: Different approaches to page initialization
```typescript
// Pattern 1: Direct navigation
await page.goto('http://localhost:3000');

// Pattern 2: Using base URL
await page.goto('/');

// Pattern 3: With GamePage abstraction
const gamePage = new GamePage(page);
await gamePage.goto();
```

**Solution**: Standardize on GamePage pattern
```typescript
// Standard setup for all e2e tests
test.beforeEach(async ({ page }) => {
  const gamePage = new GamePage(page);
  await gamePage.initialize(); // Handles navigation, waits for load
  
  // Ensure clean state
  await gamePage.ensureCleanBoard();
});
```

### 1.3 Inconsistent Validation Patterns
**Problem**: Different ways to check the same thing
```typescript
// Pattern 1: Direct evaluation
const pieceCount = await page.evaluate(() => {
  const game = (window as any).game;
  return game.getBoard().getAllPieces().length;
});

// Pattern 2: Using helpers
const hasPiece = await game.hasPieceAt(0, 0, 0);

// Pattern 3: Complex evaluation with logging
const result = await page.evaluate(() => {
  // Multiple lines of code...
});
console.log('Result:', result);
```

**Solution**: Use consistent helper-based validation
```typescript
// Always use helpers when available
await game.validatePieceAt(0, 0, 0, 'black');
await game.validateBoardState({
  pieceCount: 5,
  currentPlayer: 'white',
  moveCount: 5
});
```

## 2. Missing Validations

### 2.1 Tests Without Expectations
**Problem**: Debug tests that don't validate anything
```typescript
// tests/e2e/debug/console-check.spec.ts
test('capture all console messages', async ({ page }) => {
  // ... captures messages ...
  // This test is just for debugging, so we don't fail it
  expect(true).toBe(true); // Meaningless assertion
});
```

**Solution**: Convert to proper validation or move to utilities
```typescript
// Either validate console output:
test('should have no console errors', async ({ page }) => {
  const errors = await captureConsoleErrors(page);
  expect(errors).toHaveLength(0);
});

// Or move to test utilities:
export async function debugConsoleOutput(page: Page): Promise<ConsoleReport> {
  // Debugging utility, not a test
}
```

### 2.2 Incomplete State Validation
**Problem**: Tests that perform actions without verifying results
```typescript
// Current: Click and hope
await page.click('#game-canvas');
await page.waitForTimeout(500); // Wait and pray

// Missing: Validation of what happened
```

**Solution**: Always validate action results
```typescript
// Better: Action + Validation
await game.clickGridNode(0, 0, 0);
await game.waitForPieceAt(0, 0, 0); // Wait for specific condition
await game.validatePieceAt(0, 0, 0, 'black'); // Verify placement
```

### 2.3 Timing-Based Validation
**Problem**: Using arbitrary timeouts instead of waiting for conditions
```typescript
// Bad: Fixed timeout
await page.waitForTimeout(3000); // Wait 3 seconds and hope

// Also bad: Multiple short timeouts
await page.waitForTimeout(500);
// ... do something ...
await page.waitForTimeout(500);
```

**Solution**: Wait for specific conditions
```typescript
// Good: Wait for specific state
await page.waitForFunction(() => {
  const renderer = (window as any).renderer;
  return renderer && renderer.isReady();
});

// Better: Use helper with built-in waits
await game.waitForBoardReady();
await game.waitForAnimationComplete();
```

## 3. Raw Playwright Operations

### 3.1 Direct Mouse Operations
**Problem**: Tests using page.mouse directly
```typescript
// Found in older tests:
await page.mouse.move(x, y);
await page.mouse.down();
await page.mouse.up();
```

**Solution**: Use game-specific helpers
```typescript
// Use helpers that simulate real user interaction
await game.clickGridNode(x, y, z);
await game.rotateBoard(90, 45);
await game.hoverOverNode(x, y, z);
```

### 3.2 Direct Canvas Clicks
**Problem**: Clicking canvas without context
```typescript
// Bad: Click canvas at arbitrary position
await page.click('#game-canvas');

// Problem: Doesn't account for 3D projection
```

**Solution**: Use 3D-aware helpers
```typescript
// Good: Click specific 3D position
await game.clickGridNode(0, 0, 0);

// Handles:
// - 3D to 2D projection
// - Camera position
// - Node visibility
```

## 4. Test Organization Issues

### 4.1 Mixed Concerns in Test Files
**Problem**: Single test file testing multiple unrelated features
```typescript
// Example: piece-placement.spec.ts also tests:
// - Raycasting internals
// - Node detection
// - Camera state
```

**Solution**: Separate concerns into focused test files
```typescript
// pieces/placement.spec.ts - User-facing piece placement
// pieces/validation.spec.ts - Piece state validation
// internals/raycasting.spec.ts - Technical raycasting tests
// internals/node-detection.spec.ts - Node system tests
```

### 4.2 Poor Test Descriptions
**Problem**: Vague or incorrect test names
```typescript
test('should work correctly', async () => {});
test('test piece placement', async () => {}); // Redundant 'test'
test('asdfasdf', async () => {}); // Found in some debug tests
```

**Solution**: Descriptive test names following convention
```typescript
describe('Piece Placement', () => {
  test('places black piece on empty node when clicked', async () => {});
  test('alternates between black and white pieces', async () => {});
  test('prevents placement on occupied nodes', async () => {});
});
```

### 4.3 Test File Sprawl
**Problem**: Many similar test files with slight variations
```typescript
// All testing similar things:
019-simple-click-test.spec.ts
019-basic-test.spec.ts
019-temporary-piece-mouse-test.spec.ts
019-resolved-test.spec.ts
```

**Solution**: Consolidate related tests
```typescript
// Single comprehensive test file:
temporary-pieces.spec.ts
  describe('activation')
  describe('placement')
  describe('confirmation')
  describe('cancellation')
  describe('mouse interaction')
```

## 5. Missing Test Coverage

### 5.1 Error Path Testing
**Missing**: Tests for error conditions
```typescript
// Need tests for:
test('shows error when placing piece outside board bounds', async () => {
  await game.clickGridNode(10, 10, 10); // Out of bounds
  await game.validateError('Invalid position');
});

test('handles network disconnection gracefully', async () => {
  await game.startNetworkGame();
  await game.simulateDisconnect();
  await game.validateConnectionError();
});
```

### 5.2 Edge Case Testing
**Missing**: Boundary and edge cases
```typescript
// Need tests for:
test('handles rapid clicks without placing multiple pieces', async () => {
  await game.rapidClickGridNode(0, 0, 0, 5); // Click 5 times quickly
  await game.validatePieceCount(1); // Only one piece placed
});

test('handles board rotation during piece animation', async () => {
  const placePromise = game.clickGridNode(0, 0, 0);
  const rotatePromise = game.rotateBoard(180, 0);
  await Promise.all([placePromise, rotatePromise]);
  await game.validatePieceAt(0, 0, 0, 'black');
});
```

### 5.3 Performance Testing
**Missing**: Tests that validate performance
```typescript
test('maintains 30+ FPS during normal gameplay', async () => {
  const stats = await game.startPerformanceMonitoring();
  
  // Simulate gameplay
  for (let i = 0; i < 10; i++) {
    await game.placePieceAtRandom();
    await game.rotateBoard(45, 0);
  }
  
  const avgFPS = await stats.getAverageFPS();
  expect(avgFPS).toBeGreaterThan(30);
});
```

## 6. Test Data Management

### 6.1 Hardcoded Test Data
**Problem**: Magic coordinates and values throughout tests
```typescript
// Hardcoded coordinates everywhere:
await game.clickGridNode(0, 0, 0);
await game.clickGridNode(1, 1, 1);
await game.clickGridNode(2, 2, 2);
```

**Solution**: Use test data factories
```typescript
// Test data builders
const TestPatterns = {
  fiveInARow: {
    diagonal: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      { x: 2, y: 2, z: 2 },
      { x: 3, y: 3, z: 3 },
      { x: 4, y: 4, z: 4 }
    ],
    horizontal: [/* ... */]
  },
  capturePattern: [/* ... */]
};

// Usage:
for (const pos of TestPatterns.fiveInARow.diagonal) {
  await game.clickGridNode(pos.x, pos.y, pos.z);
}
```

## 7. Flaky Test Prevention

### 7.1 Animation Interference
**Problem**: Tests failing due to ongoing animations
```typescript
// Flaky: Click during rotation animation
await game.rotateBoard(90, 0);
await game.clickGridNode(0, 0, 0); // Might miss due to movement
```

**Solution**: Wait for animations to complete
```typescript
await game.rotateBoard(90, 0);
await game.waitForAnimationComplete();
await game.clickGridNode(0, 0, 0);
```

### 7.2 Network Timing Issues
**Problem**: Tests assuming immediate network responses
```typescript
// Flaky: No wait for network
await game.startNetworkGame();
await game.invitePlayer(peerId); // Might fail if not connected
```

**Solution**: Proper network state waiting
```typescript
await game.startNetworkGame();
await game.waitForNetworkReady();
await game.invitePlayer(peerId);
await game.waitForPlayerJoined();
```

## 8. Test Utilities Enhancement

### 8.1 Better Debug Output
**Create**: Enhanced debugging helpers
```typescript
// utils/test-debug.ts
export async function captureGameState(page: Page): Promise<GameDebugInfo> {
  return {
    board: await page.screenshot({ path: 'debug-board.png' }),
    pieces: await game.getVisiblePieces(),
    camera: await game.getCameraState(),
    errors: await page.evaluate(() => window.errors || [])
  };
}

// Use in tests:
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== 'passed') {
    const debug = await captureGameState(page);
    await testInfo.attach('debug-info', {
      body: JSON.stringify(debug, null, 2),
      contentType: 'application/json'
    });
  }
});
```

### 8.2 Visual Regression Helpers
**Enhance**: Screenshot comparison utilities
```typescript
export async function compareGameState(
  page: Page,
  baselineName: string
): Promise<VisualDiff> {
  const screenshot = await game.captureBoard({
    hideUI: true,
    stabilizeAnimations: true,
    maskDynamicElements: true
  });
  
  return compareToBaseline(screenshot, baselineName);
}
```

## Implementation Priority

1. **Critical** (Immediately):
   - Fix tests with missing validations
   - Replace hardcoded timeouts with proper waits
   - Add error path testing

2. **High** (Next sprint):
   - Standardize helper usage across all tests
   - Consolidate duplicate test files
   - Improve test descriptions

3. **Medium** (Future):
   - Add performance test suite
   - Implement visual regression tests
   - Create comprehensive test data factories

## Testing Best Practices Checklist

- [ ] Every action has a validation
- [ ] No hardcoded timeouts
- [ ] Use game helpers, not raw Playwright
- [ ] Descriptive test names
- [ ] Test both success and failure paths
- [ ] Clean test data setup/teardown
- [ ] Proper error messages on failure
- [ ] No console.log debugging left in tests
- [ ] Tests are independent and can run in isolation
- [ ] Visual tests have stable baselines