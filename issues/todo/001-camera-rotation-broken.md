# Issue #001: Camera Rotation Broken

**Status**: Todo  
**Priority**: High (Blocks Phase 2 & 3 testing)  
**Reported**: 2025-06-01 by user  
**Last Updated**: 2025-06-01  

## Description
Cannot rotate the board with any mouse input:
- Left click doesn't work
- Right click doesn't work  
- Shift + left click doesn't work
- Middle click untested (user doesn't have middle mouse button)

## Expected Behavior
- Board should rotate when dragging with appropriate mouse button
- Likely should use OrbitControls from Three.js

## Investigation Needed
1. Check if OrbitControls is initialized
2. Verify mouse event listeners are attached
3. Check if canvas is capturing mouse events properly
4. Look for any event.preventDefault() blocking controls

## Files to Check
- `src/rendering/GameRenderer.ts` - Likely contains camera setup
- `src/rendering/CameraController.ts` - If exists
- `src/main.ts` - May have initialization code
- Any file importing/using OrbitControls

## Related Issues
- #003 (click handling broken - may be same root cause)
- #004 (canvas positioning - may interfere with mouse events)