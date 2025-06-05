# Investigation Notes

## Evidence of Cross-Test Interference

### Test Execution Order
1. piece placement and validation - ✓ PASSES
2. board rotation - Places at (3,0,0), (0,0,3), (-3,0,0)
3. zoom functionality - Places at (0,0,0), (1,0,0)
4. pan functionality - ✓ PASSES - Places at (0,0,0)
5. UI interactions - ✓ PASSES - No pieces
6. game state helpers - ✓ PASSES - Places at (1,0,0)
7. validation helpers - ✗ FAILS - Tries (1,0,0) then (2,0,0)
8. camera helpers - ✗ FAILS - Tries (1,0,0), (2,0,0), (0,1,0)

### Position Conflicts
- (1,0,0) used by: zoom test, game state test, validation test, camera test
- (2,0,0) used by: validation test, camera test
- (0,0,0) used by: zoom test, pan test

### Why Some Tests Pass
- UI interactions: Doesn't place pieces
- Pan functionality: Only uses (0,0,0) which might get cleared or is at center
- Early tests: Run before conflicts accumulate

## Current Test Structure
```javascript
test.describe('Test Helpers - Individual Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });
  
  // Tests run sequentially, sharing the same page instance
});
```

The `page.goto('/')` does load a fresh page, but tests within the same worker might share state.

## Playwright Isolation
- Each test gets a fresh context by default
- But our beforeEach only navigates, doesn't ensure clean game state
- The game might persist some state in localStorage or memory

## Quick Fix Ideas
1. Add `page.reload()` in beforeEach
2. Clear localStorage
3. Use unique positions per test
4. Add explicit game reset

## Debug Commands
```javascript
// Check how many pieces before test
const piecesBefore = await page.evaluate(() => {
  return (window as any).game.getBoard().getAllPieces().length;
});
console.log('Pieces before test:', piecesBefore);
```