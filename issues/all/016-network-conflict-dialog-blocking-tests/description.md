# Issue #016: Network Conflict Dialog Blocking Test Interactions

## Problem
A "Network Conflict Detected" modal dialog appears during tests and blocks clicks from reaching the game board, causing piece placement to fail.

## Current Behavior
- Tests attempt to close modals at the start
- Network Conflict dialog appears later during test execution
- Clicks intended for the game board hit the modal overlay instead
- Piece placement fails silently (no error, just doesn't place)

## Expected Behavior
- Tests should run without network-related modal interruptions
- OR modals should be automatically dismissed
- OR tests should detect and handle modals before each interaction

## Technical Details
From the error context:
```yaml
- heading "Network Conflict Detected" [level=3]
- button "Close": ×
```

The validation test shows:
```javascript
// Test tries to close modals at start:
const modalVisible = await game.isModalVisible();
if (modalVisible) {
  await game.closeModal();
}

// But later, piece placement fails:
await game.placePiece(2, 0, 0);
hasPiece = await game.hasPieceAt(2, 0, 0);
expect(hasPiece).toBe(true); // FAILS - piece wasn't placed
```

## Root Cause Analysis
1. **Timing**: Network conflict detection happens asynchronously, so the modal can appear after initial modal check

2. **Test Environment**: Tests might trigger network conflicts due to:
   - Rapid state changes
   - Multiple browser contexts
   - WebRTC/PeerJS initialization issues

3. **Modal Overlay**: The modal creates a full-screen overlay that captures all clicks

## Potential Solutions

### 1. Disable Network Features in Tests
```javascript
// Set up test environment without network
window.DISABLE_NETWORK = true;
```

### 2. Robust Modal Handling
```javascript
async function ensureNoModals() {
  const modal = await page.locator('.modal:visible');
  if (await modal.count() > 0) {
    await page.locator('.modal button:has-text("Close")').click();
    await page.waitForTimeout(200);
  }
}

// Call before each interaction
await ensureNoModals();
await game.placePiece(x, y, z);
```

### 3. Add Modal Detection to Click Helpers
```javascript
async clickGridNode(x, y, z) {
  // Check for modals first
  if (await this.isModalVisible()) {
    await this.closeModal();
  }
  // Then proceed with click
  // ...
}
```

### 4. Mock Network Manager
Create a test setup that mocks the NetworkManager to prevent conflicts.

## Test Locations
- `tests/e2e/test-helpers-individual.spec.ts:408` - validation helpers
- Potentially affects all tests with piece placement

## Related Code
- `src/network/NetworkManager.ts` - Triggers conflict detection
- `src/ui/ConflictNotification.ts` - Creates the modal
- `tests/e2e/utils/game-interactions.ts` - Click helpers that get blocked