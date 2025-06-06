# Investigation Notes

## Test Results Analysis
```
Expected: > 29.978460547666195
Received:   21.949352359419937
```

The screen distance DECREASED when we expected it to INCREASE.

## Code Investigation
In `game-interactions.ts:zoomBoard()`:
```javascript
async zoomBoard(delta: number): Promise<void> {
  // ...
  await page.mouse.wheel(0, -delta); // This negation is the issue!
}
```

## Why This Happens
1. Mouse wheel conventions:
   - Scroll up (away from user) = negative deltaY = zoom in
   - Scroll down (toward user) = positive deltaY = zoom out

2. Our code inverts this:
   - `zoomBoard(500)` → `wheel(0, -500)` → scrolls up → zooms in
   - But objects get SMALLER when camera gets closer due to perspective

Wait, that's not right. Let me reconsider...

## Actually...
The camera distance IS decreasing (getting closer), which is correct for zoom in. But objects appear smaller? This might be a different issue:

1. Camera is getting closer (correct)
2. But the measurement might be affected by perspective distortion
3. Or the projection calculation might be wrong

## Recommended Investigation
1. Log the actual camera distance before/after
2. Check if OrbitControls has any zoom limits
3. Verify the projection math in `measureScreenDistance`

## Quick Fix
For now, invert the test's zoom direction:
```javascript
await game.zoomBoard(-500); // Use negative for zoom in
```