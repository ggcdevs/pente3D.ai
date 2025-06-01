# Issue #006: Can't Zoom Into Center of Board

**Status**: Resolved  
**Priority**: High (Blocks inner cube gameplay)  
**Reported**: 2025-06-01 by user  
**Last Updated**: 2025-06-01  
**Resolved**: 2025-06-01  

## Description
Zoom stops working when camera gets close to the board grid/cube. This makes it impossible to place pieces in the inner part of the 3D cube since you can't zoom in close enough to see/click those positions.

## Expected Behavior
- Should be able to zoom INTO the 3D cube
- Camera should be able to move inside the board volume
- Inner intersections should be accessible

## Investigation Needed
1. Check OrbitControls minDistance setting
2. Verify camera collision detection
3. Look for zoom restrictions in Renderer
4. Consider if camera needs to clip through outer layers

## Current State
- Can zoom out fine
- Zoom in stops at edge of cube
- Inner board positions unreachable

## Files to Check
- `src/rendering/Renderer.ts` - OrbitControls configuration
- Look for `minDistance` settings

## Root Cause
Found in Renderer.ts line 182:
```typescript
this.controls.minDistance = this.options.boardSize * this.options.cellSize; // = 7
```
This sets minimum distance to 7, but board radius is only ~3.5, preventing camera from entering the cube.

---

## Testing Policy
**Work CANNOT begin on this issue until a headless test replicates it.**

Test file: `/home/guy/code/git/github.com/ggcdevs/pente3d.ai/tests/e2e/issues/006-zoom-limits.spec.ts`
- Test name: "should allow zooming into center of board"
- Current status: PASSING (minDistance=0.5 is less than boardRadius=3.5)

## Resolution
Changed minDistance from 7 to 0.5 in Renderer.ts line 183. Camera can now zoom deep inside the 3D board cube, allowing access to inner intersections.