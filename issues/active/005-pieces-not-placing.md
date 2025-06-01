# Issue #005: Clicking Intersection Nodes Doesn't Place Pieces

**Status**: Todo  
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
5. **Next steps**: The Vector3 object from userData.position might not be compatible with what Game expects

## Key Finding
The issue seems to be that the Vector3 object stored in node.userData.position (created with Vector3.create()) is not being accepted by game.placePiece(). Need to investigate:
- What Vector3.create() returns
- Why game.placePiece() returns false for these objects
- If we need to convert/reconstruct the position object

## Testing Policy
**Work CANNOT begin on this issue until a headless test replicates it.**

Test file: `/home/guy/code/git/github.com/ggcdevs/pente3d.ai/tests/e2e/interactions/piece-placement.spec.ts`
- Test name: "should place piece on click"
- Current status: FAILING (expects piece count to increase but it doesn't)