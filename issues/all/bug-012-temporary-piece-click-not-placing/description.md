# Issue #012: Clicking Temporary Piece Doesn't Place It

**Status**: Todo  
**Priority**: High (Feature incomplete)  
**Reported**: 2025-06-01 by user  
**Last Updated**: 2025-06-01  

## Description
When in temporary piece mode (after pressing 't'), the temporary piece correctly appears and follows the mouse hover over nodes. However, clicking on a node does not place the piece as expected.

## Expected Behavior
According to `basic-wants.md` lines 15-19:
- 't': Enter temporary placement mode
- User can hover to see translucent piece preview
- Clicking should place the temporary piece
- 'enter': Accept the temporary piece as a normal piece and conclude the player's turn
- 't' again: Remove any temporary pieces and exit temporary placement mode

## Current Behavior
- Pressing 't' correctly enters temporary mode ✓
- Hovering shows temporary piece at correct position ✓
- Clicking does nothing ✗
- The piece remains temporary and doesn't get placed

## Investigation Needed
1. Check if click events are being handled differently in temporary mode
2. Verify if `InputHandler` has logic for temporary piece placement on click
3. Check if the game logic accepts temporary piece placement
4. Investigate the expected flow: should click immediately place as permanent, or stay temporary until Enter?

## Related Issues
- Issue #011: Fixed temporary piece positioning
- Issue #005: Fixed regular piece placement

## Testing Policy
**Work CANNOT begin on this issue until a headless test replicates it.**

Test should verify:
- Clicking in temporary mode places a piece
- The piece becomes permanent (or stays temporary until Enter, depending on design)
- Game state updates appropriately