# Issue #018: Canvas Jumps When Quality Changes to Medium

**Status**: Resolved  
**Priority**: High (Visual bug, affects user experience)  
**Reported**: 2025-06-05 by user  
**Last Updated**: 2025-06-05  
**Resolved**: 2025-06-05

## Resolution
The canvas jumping was caused by `setPixelRatio()` calls during quality changes that modified the canvas buffer size without updating the display dimensions. Fixed by:

1. **Added `setSize()` call in `applyQualitySettings()`** - Maintains display dimensions after pixel ratio changes
2. **Fixed `recreateRenderer()` to use display dimensions** - Uses `getBoundingClientRect()` instead of buffer dimensions
3. **Created comprehensive test suite** - Verifies canvas stability during quality changes

## Files Changed
- `src/rendering/Renderer.ts` (lines 1427-1433, 1469-1471)
- `tests/e2e/issues/018-canvas-jumping-quality.spec.ts` (new test file)  

## Description
The canvas jumps to the top-right of the screen and becomes smaller when the QualityManager downgrades performance to medium quality due to low FPS.

User reports seeing the message: `Quality changed to medium: FPS below threshold (0.0 < 45)` when the jump occurs.

## Expected Behavior
- Canvas should remain in the same position regardless of quality changes
- Quality downgrade should only affect rendering settings, not layout
- No visual displacement of the game area

## Investigation Needed
1. Check QualityManager implementation for layout-affecting changes
2. Look for CSS/styling changes triggered by quality events
3. Investigate if 0.0 FPS reading is accurate or a measurement error
4. Check if quality change events modify canvas sizing or positioning
5. Review any CSS classes applied during quality changes

## Potential Causes
- QualityManager applying CSS changes that affect canvas position
- Performance monitoring triggering layout recalculations
- Quality change events modifying canvas dimensions
- CSS transitions or animations triggered by quality state changes
- Event handlers that modify DOM structure during quality changes

## Timeline
1. User interacts with application
2. FPS drops to 0.0 (possibly measurement error)
3. QualityManager detects threshold breach
4. Message appears: "Quality changed to medium: FPS below threshold (0.0 < 45)"
5. Canvas jumps to top-right and becomes smaller

## Differences from Issue #004
- Original issue #004 had setInterval messages (now resolved)
- Current issue triggered by QualityManager performance monitoring
- FPS reading of 0.0 suggests possible measurement issue
- Similar visual symptoms but different root cause

## Files to Check
- `src/rendering/QualityManager.ts` - Quality management logic
- `src/rendering/Renderer.ts` - Canvas handling during quality changes
- `src/style.css` - CSS classes for different quality levels
- `src/utils/PerformanceMonitor.ts` - FPS measurement accuracy
- Any CSS transitions triggered by quality state changes

## Test Plan
1. Create test that triggers quality downgrade
2. Monitor canvas position before/after quality change
3. Verify FPS measurement accuracy
4. Test with different performance thresholds
5. Ensure quality changes don't affect layout

## Related Issues
- #004 (canvas jumping - resolved, different cause)
- Performance monitoring and quality management system