# Issue #009 Investigation Notes

## Problem
Board jumping/stuttering and performance issues with 0.0 FPS reported.

## Clues

### Console Message During Jump (2025-06-01)
User reported this console message appeared right when the board jumped:
```
QualityManager.ts:120 [Violation] 'setInterval' handler took 105ms
```

**Hypothesis**: The board jump might be triggered by or coincide with a setInterval call. The QualityManager's interval handler taking 105ms (which is quite long) could be causing a frame skip or triggering some side effect that causes the visual jump.

### Related Symptoms
- Board view jumps or stutters during interaction
- Console error: `Quality changed to medium: FPS below threshold (0.0 < 45) main.ts:63:10`
- WebGL warning: `drawElementsInstanced: Drawing to a destination rect smaller than the viewport rect.`
- FPS being reported as 0.0 (suggests performance monitoring issue)

## Investigation Needed
1. Check QualityManager.ts line 120 and the setInterval handler
2. Look for any DOM manipulation or canvas resizing in the interval callback
3. Check if quality changes trigger any layout recalculation
4. Investigate timing correlation between quality checks and board jumps
5. Consider if the 105ms handler duration causes a cascade of issues

## Next Steps
- Profile the setInterval handler to see what's taking 105ms
- Add logging to track when jumps occur vs when quality checks run
- Consider throttling or debouncing quality adjustments