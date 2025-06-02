# Issue #005: Clicking Intersection Nodes Doesn't Place Pieces

**Status**: Active  
**Priority**: Critical (Core gameplay broken)  
**Reported**: 2025-06-01 by user  
**Last Updated**: 2025-06-01

## Description
Clicking on intersection nodes shows debug messages but doesn't actually place pieces on the board. The click detection is working (debug console shows "Click detected" with correct intersection data) but no piece appears.

## Expected Behavior
- Clicking on an intersection node should place a piece (black/white alternating)
- The piece should appear visually on the board
- The game state should update

## Investigation Needed
1. Check if `game.placePiece()` is being called
2. Verify the board is updating after piece placement
3. Check if renderer.updatePieces() is called
4. Verify pieces are being rendered correctly

## Test Results
From E2E tests:
- Click detection works: "Click detected: {intersections: 66, boardPosition: Vector3, temporaryMode: false}"
- But piece count remains 0 after click

## Related Issues
- Previously fixed #003 (click detection) - clicks are now detected but pieces still don't place

---

## Investigation Progress (2025-06-01)
1. **Click detection works** - Debug shows "Click detected: {intersections: 66, boardPosition: Vector3}"
2. **Fixed instanceof check** - InputHandler line 152-156 was checking instanceof Vector3, changed to duck typing
3. **placePiece is being called** - Returns false, indicating validation failure
4. **Plain object vs Vector3** - When passing {x:3, y:3, z:3} directly, placePiece works
5. **Root Cause Found**: Coordinate system mismatch between Renderer (0-6) and Board (-3 to 3)

## Resolution Attempt #1 (Partial Fix)
The coordinate system mismatch was fixed:
- The Board uses centered coordinates (-3 to 3 for a size 7 board)
- The Renderer was storing node positions as array indices (0 to 6)
- Fixed by converting coordinates in Renderer

However, the issue persists with a new symptom:
- `placePiece()` returns true (success)
- GameState updates correctly
- Move slider shows the move was recorded
- **BUT: No visual piece appears on the grid**

## Current Status (2025-06-01)
The game logic is working but the visual rendering is not:
- Click → placePiece(true) → GameState updated → Move recorded
- Missing: renderer.updatePieces() is called but pieces don't appear visually
- Need to investigate why Three.js mesh creation or scene update is failing

## Testing Policy
**Work CANNOT begin on this issue until a headless test replicates it.**

Test file: `/home/guy/code/git/github.com/ggcdevs/pente3d.ai/tests/e2e/interactions/piece-placement.spec.ts`
- Test name: "should place piece on click"
- Current status: NEEDS UPDATE - must check for visual mesh in scene, not just game state