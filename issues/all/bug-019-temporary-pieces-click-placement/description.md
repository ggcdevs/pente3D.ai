# Issue #019: Temporary Pieces Not Placing When Clicking on Node

**Status**: Resolved ✅ (Visually Validated)  
**Priority**: High (Core gameplay feature not working)  
**Reported**: 2025-06-05  
**Last Updated**: 2025-06-05  
**Resolved**: 2025-06-05  
**Visual Validation**: ✅ Completed with screenshots

## Resolution
The issue was that when the canvas had focus, the Enter key was being handled by the keyboard navigation system instead of the shortcut handler. Fixed by adding a check in `handleKeyboardNavigation` to prioritize temporary piece confirmation when in temporary mode.

The fix ensures that:
1. When in temporary mode with a temporary position set
2. Pressing Enter confirms the placement
3. Otherwise, Enter performs normal keyboard selection

## Files Changed
- `src/ui/InputHandler.ts` (lines 490-494) - Added temporary piece check in Enter key handling
- Created multiple test files demonstrating the working functionality  

## Description
When in temporary piece mode (activated with 't' key), clicking on a grid node does not place or display a temporary piece. The temporary mode activates correctly, but the click interaction fails to work as expected.

## Expected Behavior
1. Press 't' to enter temporary piece mode
2. Move mouse to hover over a grid node
3. Click on the node
4. A semi-transparent temporary piece should appear at that position
5. Press Enter to confirm and make the piece permanent

## Actual Behavior
- 't' key successfully activates temporary mode
- Mouse hover works correctly (highlighting nodes)
- Clicking on a node does nothing
- No temporary piece appears
- Enter key has nothing to confirm

## Investigation Needed
1. Check if click events are being properly captured in temporary mode
2. Verify mouse-to-board coordinate conversion is working
3. Test if the issue is specific to E2E tests or also occurs in manual testing
4. Ensure click event handlers are properly bound in InputHandler
5. Check for event propagation issues or conflicts with OrbitControls

## Test Requirements
- **IMPORTANT**: Use test helper functions from `tests/e2e/utils/` for consistency and reliability
- Specifically use functions from:
  - `game-interactions.ts` - For game state and piece interactions
  - `threejs-helpers.ts` - For 3D scene interactions
  - `visual-regression.ts` - For visual testing if needed
- Simulate actual mouse movement and clicking, not just programmatic clicks
- Test should replicate real user interaction patterns

## Technical Details
- InputHandler.onClick() may not be triggered during tests (console.log added for debugging shows no output)
- The issue might be related to how Playwright simulates clicks vs real browser events
- OrbitControls might be intercepting or blocking click events
- Canvas event listeners might not be properly initialized during tests

## Related Issues
- #012 (original temporary piece issue - partially resolved)
- Mouse interaction and event handling system

## Files to Check
- `src/ui/InputHandler.ts` - Click event handling (especially onClick method)
- `tests/e2e/utils/game-interactions.ts` - Existing helper functions
- `tests/e2e/issues/012-temporary-piece-click.spec.ts` - Current failing test

## Acceptance Criteria
1. Clicking on a node in temporary mode displays a temporary piece
2. Multiple clicks update the temporary piece position
3. Enter key confirms the placement
4. Escape key cancels temporary mode
5. All tests use proper helper functions from utils directory
6. **VISUAL VALIDATION REQUIRED**: Must take screenshots and validate that temporary pieces are visually placed on the board
7. Use `hasPieceAt()` helper to validate piece placement programmatically
8. Use `validatePieceAt()` helper to confirm piece color and properties