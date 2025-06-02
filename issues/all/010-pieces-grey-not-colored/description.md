# Issue #010: Played Pieces Are Grey Instead of Black/White

**Status**: Active  
**Priority**: Medium (Visual bug)  
**Reported**: 2025-06-01 by user  
**Last Updated**: 2025-06-01  

## Description
All played pieces appear grey instead of their proper colors (black or white). The test output shows `materialColor: 16777215` (0xFFFFFF = white) but visually they appear grey.

## Expected Behavior
- Black player's pieces should appear black (color: 0x000000)
- White player's pieces should appear white (color: 0xFFFFFF)
- Pieces should be visually distinguishable

## Current Behavior
- All pieces appear as grey spheres
- The material color in the test shows as white (0xFFFFFF) but renders as grey
- Both black and white pieces look identical

## Investigation Needed
1. Check the material creation in `createPieceMesh()`
2. Verify the lighting setup (pieces might be in shadow)
3. Check if materials are being properly assigned based on player color
4. Investigate if the piece material colors are being overridden

## Related Code
- `src/rendering/Renderer.ts` - createPieceMesh() method
- Material definitions: blackPieceMaterial, whitePieceMaterial

## Testing Policy
**Work CANNOT begin on this issue until a headless test replicates it.**