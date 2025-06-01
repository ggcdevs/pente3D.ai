# Issue #003: Clicking Canvas Doesn't Place Pieces

**Status**: Resolved  
**Priority**: Critical (Core gameplay broken - Blocks Phase 2)  
**Reported**: 2025-06-01 by user  
**Last Updated**: 2025-06-01  
**Resolved**: 2025-06-01  

## Description
Clicking on the canvas:
1. Adds yellow border around canvas (focus outline?)
2. Does NOT place any game pieces
3. Later causes canvas to jump (see issue #004)

## Expected Behavior
- Clicking on board should place a piece at the clicked intersection
- No visual focus indicators on canvas (unless in high-contrast mode)
- Canvas should remain stationary
- Per basic-wants.md: Click detection should work on "small spheres placed on each intersection"

## Investigation Results
1. ✅ Click event listeners exist (InputHandler line 101)
2. ✅ Raycasting is implemented (lines 141-144)
3. ✅ Yellow border source found: high-contrast.css lines 200-203
4. ✅ Intersection nodes are created with proper userData (Renderer line 404-407)

## Root Causes Identified
1. **OrbitControls conflict**: Left click disables OrbitControls (line 194) but may not properly handle clicks
2. **CSS focus outline**: Canvas has tabindex="0" causing focus on click
3. **Canvas jumping**: outline-offset: 2px pushes layout when focused

## Fix Strategy
1. Modify OrbitControls to use different mouse buttons (shift+drag or middle button for rotation)
2. Remove outline except in high-contrast mode
3. Fix canvas sizing to use viewport dimensions
4. Add debugging to verify raycast detection

## Files to Check
- `src/rendering/InputHandler.ts` or similar
- `src/rendering/GameRenderer.ts` - May handle clicks
- `src/core/GameController.ts` - Game logic
- `src/style.css` - Look for :focus styles
- Any file with `addEventListener('click')`
- Raycasting implementations

## Resolution  
Fixed multiple interconnected issues:
1. **OrbitControls conflict**: Controls were being disabled on left click, breaking both rotation and clicks
2. **CSS focus outline**: Removed outline except in high-contrast mode 
3. **Drag vs click detection**: Added logic to differentiate between dragging to rotate and clicking to place pieces
4. **Debug logging**: Added console logs to help verify click detection

## Files Changed
- `src/ui/InputHandler.ts` - Removed control disabling, added drag detection and debug logs
- `src/styles/high-contrast.css` - Fixed focus outline to prevent jumping (line 202)
- `src/rendering/Renderer.ts` - Fixed OrbitControls mouse buttons

## Related Issues
- #001 (rotation broken - same input system)
- #004 (canvas jumping - triggered by focus outline)