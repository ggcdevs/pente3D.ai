# Issue #013 Investigation Notes

## Problem Analysis
Test exits after placing only one piece. Need to check logs for errors.

### UPDATE: Click helper IS working!
Debug test shows:
- Simple center click places piece at (3,3,3)
- clickGridNode(1,0,0) successfully places at (1,0,0)
- 343 intersection nodes exist in scene
- The issue is with hasPieceAt() validation, not the clicking

## Key Tasks
1. **Fix clickGridNode coordinate projection**
   - Current math may be incorrect
   - Need to properly project 3D to 2D screen coordinates
   - Consider using Three.js built-in projection if available

2. **Implement rotation validation**
   - Track a reference node (e.g., corner node at (3,0,0))
   - Get its screen position before rotation
   - Rotate board by known angle
   - Get new screen position
   - Validate position change matches rotation math
   - Formula: For rotation around Y-axis by angle θ:
     - new_x = cos(θ) * old_x - sin(θ) * old_z
     - new_z = sin(θ) * old_x + cos(θ) * old_z

3. **Debug test execution flow**
   - Add console.log statements
   - Check for promise rejections
   - Ensure proper error handling
   - Check if getCapturedCount method exists

4. **Individual helper verification**
   - Test each helper in isolation
   - Start with simplest (hasPieceAt)
   - Build up to complex (rotation validation)

5. **Realistic interaction timing**
   - Current delays may be too short
   - Browser might not be ready
   - Add proper wait conditions

## Implementation Plan
1. Check test logs for specific errors
2. Fix immediate errors (like getCapturedCount)
3. Create individual test for each helper
4. Implement rotation validation logic
5. Build comprehensive test only after all helpers verified

## Critical Context for Future Claude
- Test helpers use realistic mouse movements (not instant clicks)
- Rotation validation MUST track actual node positions
- Human must visually verify before closing issue
- Each helper needs individual verification first