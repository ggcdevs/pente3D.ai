# Investigation Notes

## Evidence of Modal Interference

### Test 1: Validation Helpers
- Places piece at (1,0,0) - SUCCESS
- Tries to place at (2,0,0) - FAILS
- Error context shows "Network Conflict Detected" modal

### Test 2: Camera Helpers  
- Tries to place 3 pieces
- Only 2 pieces found (expected >=3, got 2)
- Likely the same (2,0,0) placement failing

## Pattern
- First piece placements work
- Subsequent placements fail
- Network conflict appears after some game activity

## Why Network Conflicts Occur in Tests
1. PeerJS might initialize even in single-player tests
2. Rapid game state changes might trigger sync issues
3. Multiple test runs might leave stale connections

## Current Modal Handling
The test does try to handle modals:
```javascript
const modalVisible = await game.isModalVisible();
if (modalVisible) {
  await game.closeModal();
  await page.waitForTimeout(500);
}
```

But this only runs once at the start. The modal appears later.

## Debugging Approach
1. Add logging to see when modals appear
2. Check NetworkManager initialization in tests
3. See if we can disable network features for tests

## Immediate Workaround
Add modal checks before each piece placement:
```javascript
async function safePlacePiece(game, x, y, z) {
  // Close any modals first
  while (await game.isModalVisible()) {
    await game.closeModal();
    await page.waitForTimeout(200);
  }
  await game.placePiece(x, y, z);
}
```