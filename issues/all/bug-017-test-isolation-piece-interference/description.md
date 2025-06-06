# Issue #017: Test Isolation - Pieces from Previous Tests Interfere

## Problem
Tests are not properly isolated, causing pieces placed in one test to interfere with subsequent tests. This leads to placement failures when positions are already occupied.

## Current Behavior
- Tests run in sequence without resetting game state
- Pieces from earlier tests remain on the board
- Later tests fail when trying to place pieces at occupied positions
- No clear error message - placements just silently fail

## Expected Behavior
- Each test should start with a clean game state
- No pieces from previous tests should remain
- Tests should be independent and runnable in any order

## Technical Details
Evidence from test failures:
1. Camera helpers test expects to place pieces at (1,0,0), (2,0,0), (0,1,0)
2. Only 2 pieces are placed successfully
3. The (1,0,0) or (2,0,0) position is likely already occupied from the validation test

Pattern observed:
- First test in the suite usually passes
- Subsequent tests fail on piece placements
- Same positions are used across multiple tests

## Root Cause Analysis

### 1. No Test Cleanup
Tests don't reset the game state after completion:
```javascript
test('some test', async ({ page }) => {
  // Places pieces
  // Test ends without cleanup
});

test('next test', async ({ page }) => {
  // Tries to place at same positions
  // Fails because pieces already there
});
```

### 2. Shared Browser Context
The same page/game instance is reused across tests within a describe block.

### 3. Common Test Positions
Multiple tests use the same convenient positions like (0,0,0), (1,0,0), (2,0,0).

## Potential Solutions

### 1. Add beforeEach Reset
```javascript
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000);
  // Or call a game.reset() method if available
});
```

### 2. Add afterEach Cleanup
```javascript
test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    const game = (window as any).game;
    game.reset(); // If available
  });
});
```

### 3. Use Unique Positions
Generate unique positions for each test to avoid conflicts:
```javascript
const testId = Date.now() % 7; // Use time-based offset
await game.placePiece(testId, 0, 0);
```

### 4. Force Page Reload
```javascript
test('test name', async ({ page }) => {
  await page.reload(); // Fresh start
  await page.waitForTimeout(2000);
  // Run test
});
```

### 5. Implement Game Reset
Add a method to the game to clear all pieces:
```javascript
async resetGame() {
  await page.evaluate(() => {
    const game = (window as any).game;
    const board = game.getBoard();
    board.clear(); // If available
  });
}
```

## Test Locations
Affects all tests in:
- `tests/e2e/test-helpers-individual.spec.ts`

Particularly:
- Line 408: validation helpers (places at 1,0,0 and 2,0,0)
- Line 477: camera helpers (tries to place at same positions)

## Impact
- Causes false test failures
- Makes tests order-dependent
- Reduces test reliability
- Makes debugging harder (failures depend on which tests ran before)