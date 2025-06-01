# Issue #003: Clicking Canvas Doesn't Place Pieces

**Status**: Todo  
**Priority**: Critical (Core gameplay broken - Blocks Phase 2)  
**Reported**: 2025-06-01 by user  
**Last Updated**: 2025-06-01  

## Description
Clicking on the canvas:
1. Adds yellow border around canvas (focus outline?)
2. Does NOT place any game pieces
3. Later causes canvas to jump (see issue #004)

## Expected Behavior
- Clicking on board should place a piece at the clicked intersection
- No visual focus indicators on canvas
- Canvas should remain stationary

## Investigation Needed
1. Check if click event listeners exist for piece placement
2. Look for raycasting implementation to detect board clicks
3. Find source of yellow border (CSS :focus pseudo-class?)
4. Verify game state allows piece placement (whose turn, game started, etc.)

## Potential Causes
- Missing click event handlers
- Raycasting not implemented
- Game state not initialized
- CSS focus outline on canvas element
- Event handlers on wrong element

## Files to Check
- `src/rendering/InputHandler.ts` or similar
- `src/rendering/GameRenderer.ts` - May handle clicks
- `src/core/GameController.ts` - Game logic
- `src/style.css` - Look for :focus styles
- Any file with `addEventListener('click')`
- Raycasting implementations

## Related Issues
- #001 (rotation broken - same input system?)
- #004 (canvas jumping - triggered by this issue)