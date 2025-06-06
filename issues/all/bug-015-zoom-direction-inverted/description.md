# Issue #015: Zoom Direction Appears to be Inverted

## Problem
When zooming IN (positive delta), objects appear SMALLER on screen instead of LARGER. This suggests the zoom direction is inverted.

## Current Behavior
- Test measures screen distance between two pieces 1 unit apart
- Calls `zoomBoard(500)` expecting to zoom IN (objects get larger)
- Screen distance DECREASES from 29.98px to 21.95px (objects got smaller)
- Camera distance decreases correctly (gets closer)

## Expected Behavior
- Positive delta should zoom IN (objects appear larger)
- Negative delta should zoom OUT (objects appear smaller)

## Technical Details
From the test:
```javascript
// Before zoom: screenDistBefore = 29.978460547666195
await game.zoomBoard(500); // Positive delta = zoom in
// After zoom: screenDistAfterZoomIn = 21.949352359419937

// Test expects:
expect(screenDistAfterZoomIn).toBeGreaterThan(screenDistBefore); // FAILS
```

## Root Cause Analysis
Looking at the zoom implementation:
```javascript
// In game-interactions.ts:
await page.mouse.wheel(0, -delta); // Note the negative!
```

The wheel implementation uses `-delta`, which inverts the direction:
- Positive delta → negative wheel → zoom OUT
- Negative delta → positive wheel → zoom IN

This is backwards from the expected behavior.

## Browser Wheel Event Behavior
- Standard: negative deltaY = scroll up = zoom in
- Our code: inverts this with `-delta`

## Potential Solutions
1. **Remove the negation** in `zoomBoard()`:
   ```javascript
   await page.mouse.wheel(0, delta); // Remove the minus
   ```

2. **Update test expectations** to match current behavior:
   ```javascript
   await game.zoomBoard(-500); // Negative to zoom in
   ```

3. **Add documentation** to clarify zoom direction

## Test Location
`tests/e2e/test-helpers-individual.spec.ts:134` (zoom functionality)

## Related Code
- `tests/e2e/utils/game-interactions.ts:572` - The wheel event with `-delta`
- OrbitControls zoom behavior in Three.js