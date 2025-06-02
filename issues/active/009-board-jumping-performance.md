# Issue #009: Board Jumping and Performance Issues

**Status**: Active  
**Priority**: High (Affects usability)  
**Reported**: 2025-06-01 by user  
**Last Updated**: 2025-06-01  

## Description
The 3D board view jumps/stutters, and the quality manager is reporting extremely low FPS, causing it to drop to medium quality settings.

## Symptoms
1. Board view jumps or stutters during interaction
2. Console error: `Quality changed to medium: FPS below threshold (0.0 < 45) main.ts:63:10`
3. WebGL warning: `drawElementsInstanced: Drawing to a destination rect smaller than the viewport rect. (This warning will only be given once)`

## Technical Details
- The FPS is being reported as 0.0, which suggests the performance monitoring may not be working correctly
- The WebGL warning suggests a viewport/canvas sizing issue
- This may be related to the canvas resizing or render loop implementation

## Investigation Needed
1. Check why FPS is reporting as 0.0
2. Investigate the viewport rect vs destination rect mismatch
3. Check if the render loop is running properly
4. Verify canvas sizing calculations

## Related Issues
- May be affecting the visual rendering of pieces (Issue #005)

## Testing Policy
**Work CANNOT begin on this issue until a headless test replicates it.**

Test needed: Performance monitoring and canvas sizing test