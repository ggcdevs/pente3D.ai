# Issue #002: Canvas Not Fullscreen on Larger Displays

**Status**: Resolved  
**Priority**: High (Blocks Phase 3 visual testing)  
**Reported**: 2025-06-01 by user  
**Last Updated**: 2025-06-01  
**Resolved**: 2025-06-01  

## Description
Canvas is not filling the screen on larger displays. CSS rule `#game-canvas` exists but is being overridden by inline styles with hardcoded pixel dimensions.

## Expected Behavior
- Canvas should fill viewport (100vw x 100vh)
- Should respond to window resize events
- No hardcoded dimensions

## Investigation Needed
1. Find where `renderer.setSize()` is called with pixel values
2. Check for inline style assignments to canvas element
3. Look for resize event handlers
4. Verify CSS cascade isn't being disrupted

## Current State
```css
/* This CSS exists but gets overridden */
#game-canvas {
  /* styles being ignored due to inline styles */
}
```

## Files to Check
- `src/style.css` - Has #game-canvas rules
- `src/rendering/GameRenderer.ts` - Likely sets canvas size
- `src/main.ts` - May have window resize handlers
- Any file calling `renderer.setSize()` or setting `canvas.width/height`

## Resolution
Fixed canvas sizing to use viewport dimensions instead of canvas client dimensions:
1. Updated Renderer initialization to use window.innerWidth/Height
2. Updated resize handler to use viewport dimensions
3. Updated camera aspect ratio calculation
4. Fixed CSS to use 100vw/100vh with absolute positioning

## Files Changed
- `src/rendering/Renderer.ts` - Use window dimensions (lines 141, 157-159, 322-323)
- `src/style.css` - Canvas uses viewport units (lines 41-47)

## Related Issues
- #004 (canvas positioning - same CSS/sizing system)