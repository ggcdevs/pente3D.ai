# Issue #014: Board Rotation Test - Movement Validation Expectations

## Problem
The board rotation test expects pieces to move more than 100 pixels on screen when the board is rotated by 200 pixels horizontally, but the actual movement is less (around 80 pixels).

## Current Behavior
- Test places pieces at edges: (3,0,0), (0,0,3), (-3,0,0)
- Rotates board by dragging 200 pixels horizontally
- Right piece at (3,0,0) only moves ~80 pixels instead of expected >100 pixels

## Expected Behavior
The test should have realistic expectations for how much screen movement occurs for a given rotation amount.

## Technical Details
From the test output:
```
Expected: > 100
Received: rightPieceDelta (actual movement)
```

The rotation is performed by:
```javascript
await game.rotateBoard(200, 0); // 200px horizontal drag
```

## Root Cause Analysis
1. **Perspective Effects**: The amount of screen movement depends on:
   - Camera distance from the board
   - Field of view settings
   - The piece's position relative to the rotation center

2. **Rotation Center**: The board likely rotates around (0,0,0), so pieces at (3,0,0) are 3 units from center

3. **Screen Space Calculation**: A 200px drag might only rotate the board by ~45-60 degrees, which at the current camera distance produces less screen movement than expected

## Potential Solutions
1. **Adjust Expectations**: Lower the expected movement to ~50-80 pixels
2. **Increase Rotation**: Use a larger drag distance (e.g., 300-400 pixels)
3. **Calculate Expected Movement**: Based on actual rotation angle and camera parameters
4. **Use Angle Validation**: Instead of pixel movement, validate the actual rotation angle change

## Test Location
`tests/e2e/test-helpers-individual.spec.ts:63` (board rotation with validation)

## Related Code
- `tests/e2e/utils/game-interactions.ts:rotateBoard()` - The rotation helper
- `src/rendering/Renderer.ts` - Camera and controls setup