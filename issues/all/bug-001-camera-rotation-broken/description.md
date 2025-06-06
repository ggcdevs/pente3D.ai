# Issue #001: Camera Rotation Broken

**Status**: Resolved  
**Priority**: High (Blocks Phase 2 & 3 testing)  
**Reported**: 2025-06-01 by user  
**Resolved**: 2025-06-01  

## Description
Cannot rotate the board with any mouse input:
- Left click doesn't work
- Right click doesn't work  
- Shift + left click doesn't work
- Middle click untested (user doesn't have middle mouse button)

## Expected Behavior
- Board should rotate when dragging with appropriate mouse button
- Likely should use OrbitControls from Three.js

## Resolution
Fixed OrbitControls configuration in Renderer.ts to match basic-wants.md requirements:
- Left click + drag = rotate
- Right click + drag = pan
- Scroll = zoom

The issue was that InputHandler was disabling OrbitControls on left click to allow piece placement, but this prevented rotation. Fixed by:
1. Configuring OrbitControls properly with correct mouse button mappings
2. Removing the control disabling logic from InputHandler
3. Implementing drag detection to differentiate between click and drag

## Files Changed
- `src/rendering/Renderer.ts` - Fixed OrbitControls configuration (lines 172-176)
- `src/ui/InputHandler.ts` - Removed control disabling, added drag detection

## Related Issues
- #003 (click handling broken - was same root cause)
- #004 (canvas positioning - fixed together)