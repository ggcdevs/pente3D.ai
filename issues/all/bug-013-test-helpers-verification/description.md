# Issue #013: Test Helper Functions Need Verification and Fixes

**Status**: Active  
**Priority**: High (Test infrastructure is critical)  
**Created**: 2025-06-04  
**Last Updated**: 2025-06-04  

## Description
The comprehensive test helper library (game-interactions.ts) was created but the test execution shows:
1. Page loads
2. Window disappears/reappears
3. Only one black piece gets placed
4. No rotation, zoom, pan, or other interactions occur
5. Test exits prematurely with errors

## Expected Behavior
- All helper functions should execute successfully
- Board rotation should be visually verifiable
- Zoom and pan should work
- UI interactions (menu, modals) should function
- All test assertions should have proper expectations

## Resolution Criteria
**This issue MUST NOT be marked resolved until a human verifies:**
- [ ] All test interactions are visually working (rotation, zoom, pan, clicks)
- [ ] No errors in test logs
- [ ] All assertions have proper expectations
- [ ] Board rotation is properly validated (tracked node positions)
- [ ] Test runs to completion without premature exit

## Technical Requirements
1. Fix coordinate projection math in clickGridNode
2. Add proper rotation validation by tracking node positions
3. Ensure all interactions simulate realistic mouse movements
4. Add proper error handling and debugging output
5. Validate each helper function individually before comprehensive test

## Testing Strategy
For rotation validation:
- Track a specific node's screen position before rotation
- Perform rotation
- Get new screen position
- Validate the position change matches expected rotation
- Test multiple rotation angles to ensure consistency