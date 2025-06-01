# Issue #004: Canvas Jumps After Click

**Status**: Todo  
**Priority**: High (Visual bug, blocks all testing)  
**Reported**: 2025-06-01 by user  
**Last Updated**: 2025-06-01  

## Description
After clicking the canvas:
1. Yellow border appears (see issue #003)
2. A few seconds later, canvas jumps up and to the left of viewport
3. Positioning becomes incorrect

## Expected Behavior
- Canvas should remain stationary at all times
- No position changes on interaction
- Stable layout

## Investigation Needed
1. Check for CSS transitions or animations
2. Look for JavaScript that modifies canvas position
3. Check if focus state changes layout
4. Investigate setTimeout/setInterval that might trigger movement
5. Check for CSS flexbox/grid layout shifts

## Potential Causes
- CSS transition on focus state
- JavaScript repositioning canvas after delay
- Layout shift due to border being added
- Absolute/relative positioning conflicts
- Transform properties being applied

## Timeline
1. User clicks canvas
2. Yellow border appears immediately
3. ~2-3 seconds pass
4. Canvas jumps up and left

## Files to Check
- `src/style.css` - CSS animations/transitions
- `src/main.ts` - Delayed initialization code
- `src/rendering/GameRenderer.ts` - Canvas positioning
- Any setTimeout/setInterval calls
- CSS position/transform properties

## Related Issues
- #002 (canvas sizing - same rendering system)
- #003 (click handling - triggers this issue)