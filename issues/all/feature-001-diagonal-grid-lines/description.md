# Feature #001: Diagonal Grid Lines Display

**Status**: Todo  
**Priority**: Medium  
**Type**: Feature Enhancement  
**Reported**: 2025-06-05 by assistant  
**Last Updated**: 2025-06-05  

## Description
Add visual diagonal lines to the 3D game board grid to help players better visualize potential winning lines and improve spatial understanding of the game space.

## Current State
The settings infrastructure exists but the rendering implementation is missing:
- ✅ Settings toggle exists and persists (`gridDiagonals`)
- ✅ UI controls are present in settings modal
- ❌ Renderer does not generate diagonal lines
- ❌ Main.ts has a TODO comment instead of implementation

## Expected Behavior
When "Show Grid Diagonals" is enabled in settings:
1. Face diagonals should be visible on all 6 faces of the cube
2. Space diagonals (4 main cube diagonals) should be visible
3. Optional: Edge diagonals for complete visualization
4. Lines should use a different visual style (opacity/dash) to distinguish from main grid

## User Stories
- As a player, I want to see diagonal lines on the board so I can better plan diagonal winning strategies
- As a new player, I want visual guides to understand all possible winning directions
- As a strategic player, I want to quickly identify diagonal threats and opportunities

## Technical Requirements
1. Implement `addDiagonalLines()` method in Renderer.ts
2. Generate line geometry for:
   - XY plane diagonals (at each Z level)
   - XZ plane diagonals (at each Y level)  
   - YZ plane diagonals (at each X level)
   - 4 main space diagonals
   - Optional: 8 edge diagonals
3. Use different material properties (opacity, color, or dashed lines)
4. Integrate with existing settings toggle
5. Performance optimization for larger boards

## Implementation Notes
- Use existing line drawing patterns from `highlightLine()` as reference
- Consider using THREE.LineDashedMaterial for visual distinction
- May need to batch geometry for performance on larger boards
- Should respect the existing coordinate system and transformations

## Acceptance Criteria
- [ ] Diagonal lines render when setting is enabled
- [ ] Diagonal lines do not render when setting is disabled
- [ ] Performance impact is minimal (<5% FPS drop)
- [ ] Lines are visually distinct from main grid
- [ ] Works correctly for all supported board sizes (3x3x3 to 20x20x20)
- [ ] Setting persists across sessions

## Related Code
- `src/storage/Settings.ts`: `getGridDiagonals()`, `setGridDiagonals()`
- `src/rendering/Renderer.ts`: `createBoardGrid()` method
- `src/main.ts`: Lines 253-256 (TODO comment)

## Visual Mockup
```
Current (orthogonal only):
+---+---+---+
|   |   |   |
+---+---+---+
|   |   |   |
+---+---+---+

With diagonals:
+---+---+---+
|\ /|\ /|\ /|
| X | X | X |
|/ \|/ \|/ \|
+---+---+---+
```