# Issue #011: Temporary Pieces Don't Show Up Over Correct Node

**Status**: Resolved  
**Priority**: High (Feature broken)  
**Reported**: 2025-06-01 by user  
**Last Updated**: 2025-06-01  
**Resolved**: 2025-06-01  

## Description
Temporary pieces (placed when pressing 't' for temporary placement mode) do not appear over the correct intersection node. This is caused by coordinate system inconsistencies between centered coordinates (-3 to 3) and array indices (0 to 6).

## Expected Behavior
- Pressing 't' enters temporary placement mode
- Hovering over an intersection node should show a translucent piece at that exact position
- The temporary piece should align perfectly with the node being hovered

## Current Behavior
- Temporary pieces appear at incorrect positions
- The position offset suggests a coordinate system mismatch

## Root Cause Analysis

### Coordinate Systems in Use

The codebase uses **two different coordinate systems**:

1. **Board Coordinate System** (Centered)
   - Range: `-halfSize` to `+halfSize` where `halfSize = Math.floor(boardSize / 2)`
   - For size 7: -3 to 3
   - For size 9: -4 to 4
   - Center: (0, 0, 0)
   - Used by: Core game logic

2. **Array Index System** (0-based)
   - Range: 0 to `boardSize - 1`
   - For size 7: 0 to 6
   - For size 9: 0 to 8
   - Used by: Renderer loops

### Complete Coordinate Reference Audit

#### 1. Core Game Classes (Board Coordinates: -3 to 3)
- **`/src/core/Board.ts`**
  - Line 82-88: `isInBounds()` validates using centered coords
  - Line 113: `coordToKey()` converts Vector3 to string key
  - Line 119: `keyToCoord()` parses string key to Vector3
  - Line 247: Uses `halfSize = Math.floor(board.size / 2)`
  - Line 444: `placePiece()` expects board coordinates
  - All methods expect/return board coordinates

- **`/src/core/GameRules.ts`**
  - Line 36: `isInBounds()` check uses board coordinates
  - Line 249-259: `getAllPlayerPositions()` iterates -halfSize to +halfSize
  - Line 183-194: Direction vectors for board coordinates
  - All validation uses board coordinates

- **`/src/core/Move.ts`**, **`/src/core/Piece.ts`**
  - Store positions as Vector3 with board coordinates
  - No coordinate conversion needed

#### 2. Renderer Class (Mixed Usage)
- **`/src/rendering/Renderer.ts`**
  - **Line 406-427**: `createBoardGrid()`
    - Loops: 0 to boardSize-1 (array indices)
    - Line 417-419: Converts to board coords (BUGGY FORMULA)
    ```typescript
    const boardX = x - halfSize / cellSize; // Wrong!
    ```
  - **Line 441-467**: `updatePieces()`
    - Loops: 0 to boardSize-1 (array indices)
    - Line 445-447: Same buggy conversion formula
  - **Line 521-554**: `highlightPosition()`
    - Receives board coordinates
    - Uses them correctly
  - **Line 807-839**: `setTemporaryPiece()`
    - Receives board coordinates
    - Line 836-839: Uses them AS IF they were array indices (BUG)
    ```typescript
    this.temporaryPiece.position.set(
      position.x * cellSize - halfSize,  // Treating board coord as array index!
      position.y * cellSize - halfSize,
      position.z * cellSize - halfSize
    );
    ```

#### 3. InputHandler (Board Coordinates)
- **`/src/ui/InputHandler.ts`**
  - Line 151-157: `findBoardIntersection()` returns board coordinates
  - Line 187: Passes board coordinates to `setTemporaryPiece()`
  - Line 178: Passes board coordinates to `highlightPosition()`
  - All external interfaces use board coordinates

#### 4. Coordinate Conversion Points
Current conversion formula (INCORRECT when cellSize ≠ 1):
```typescript
// Array index to board coordinate
boardCoord = arrayIndex - halfSize / cellSize;  // BUG: division by cellSize

// Board coordinate to world position (CORRECT)
worldPos = boardCoord * cellSize - halfSize;
```

Correct formulas should be:
```typescript
// Array index to board coordinate
boardCoord = arrayIndex - Math.floor(boardSize / 2);

// Board coordinate to world position
worldPos = boardCoord * cellSize - (boardSize - 1) * cellSize / 2;
```

### Specific Bugs Found

1. **Coordinate conversion bug** in Renderer:
   - Lines 417-419, 445-447: Division by cellSize is incorrect
   - Causes issues when cellSize ≠ 1

2. **setTemporaryPiece() bug**:
   - Receives board coordinates (-3 to 3)
   - Treats them as array indices (0 to 6)
   - Results in wrong world position calculation

3. **Inconsistent coordinate usage** in Renderer:
   - Some methods expect board coords (highlight, setTemporaryPiece)
   - Some methods use array indices internally (updatePieces)
   - No clear documentation of which system is expected

## Solution Approaches

### Approach 1: Single Coordinate System (Board Coordinates Only)

**Implementation:**
- Use board coordinates (-3 to 3) everywhere
- Change all loops to iterate from -halfSize to +halfSize
- Remove all coordinate conversions

**Pros:**
- Consistent throughout codebase
- No conversion bugs possible
- Easier to understand
- Matches game logic directly

**Cons:**
- Need to refactor all Renderer loops
- Slightly less intuitive for array-style iteration
- More changes required

**Changes needed:**
```typescript
// Before
for (let x = 0; x < boardSize; x++) {
  const boardX = x - halfSize / cellSize;
  
// After  
const halfSize = Math.floor(boardSize / 2);
for (let x = -halfSize; x <= halfSize; x++) {
  // x is already in board coordinates
```

### Approach 2: Dual System with Clear Boundaries

**Implementation:**
- Keep array indices for internal Renderer loops
- Board coordinates for all external interfaces
- Add utility functions for conversion
- Document clearly which methods use which system

**Pros:**
- Minimal changes to existing code
- Array iteration remains natural
- Clear separation of concerns

**Cons:**
- Conversion bugs still possible
- Need to maintain conversion logic
- Developers must know which system to use

**Changes needed:**
```typescript
// Add utility methods to Renderer
private arrayIndexToBoardCoord(index: number): number {
  return index - Math.floor(this.options.boardSize / 2);
}

private boardCoordToWorldPos(coord: number): number {
  const halfSize = (this.options.boardSize - 1) * this.options.cellSize / 2;
  return coord * this.options.cellSize - halfSize;
}
```

### Approach 3: Encapsulate Coordinates in Type-Safe Wrappers

**Implementation:**
- Create `BoardCoord` and `ArrayIndex` types
- Type system prevents mixing coordinates
- Conversion methods on the types

**Pros:**
- Type safety prevents bugs
- Self-documenting code
- Conversion logic centralized

**Cons:**
- Major refactoring required
- More verbose code
- Learning curve for contributors

**Example:**
```typescript
class BoardCoord {
  constructor(public x: number, public y: number, public z: number) {}
  
  toArrayIndex(boardSize: number): ArrayIndex {
    const halfSize = Math.floor(boardSize / 2);
    return new ArrayIndex(
      this.x + halfSize,
      this.y + halfSize,
      this.z + halfSize
    );
  }
}
```

## Selected Solution

**Selected Approach: #2 - Dual System with Clear Boundaries**

This approach provides the best balance of:
1. **Minimal disruption** to existing code
2. **Clear mental model** (array indices for loops, board coords for game logic)
3. **Reasonable safety** with proper documentation and utilities

**Decision Date**: 2025-06-01

### Implementation Plan

1. **Fix immediate bugs**:
   ```typescript
   // Fix coordinate conversion (remove cellSize division)
   const boardX = x - Math.floor(this.options.boardSize / 2);
   
   // Fix setTemporaryPiece to handle board coordinates
   const halfSize = (this.options.boardSize - 1) * this.options.cellSize / 2;
   this.temporaryPiece.position.set(
     position.x * this.options.cellSize,  // Don't subtract halfSize again
     position.y * this.options.cellSize,
     position.z * this.options.cellSize
   );
   ```

2. **Add utility methods** to Renderer:
   ```typescript
   private toArrayIndex(boardCoord: number): number
   private toBoardCoord(arrayIndex: number): number  
   private toWorldPosition(boardCoord: number): number
   ```

3. **Document coordinate systems** clearly:
   - Add JSDoc comments specifying expected coordinate system
   - Add coordinate system note to README

4. **Add tests** for coordinate conversions with different board sizes and cell sizes

## Related Issues
- Issue #005: Fixed piece placement coordinate mismatch
- This is the same underlying issue manifesting in temporary pieces

## Resolution Summary

Implemented Approach #2 - Dual System with Clear Boundaries:

1. **Added utility methods** to Renderer for coordinate conversion:
   - `arrayIndexToBoardCoord()` - converts 0-based to centered
   - `boardCoordToArrayIndex()` - converts centered to 0-based
   - `boardCoordToWorldPos()` - converts board coord to 3D position
   - `boardPositionToWorld()` - converts Vector3 board to world

2. **Fixed coordinate bugs**:
   - Removed incorrect `cellSize` division in conversion formula
   - Fixed `setTemporaryPiece()` to properly convert board coords to world position
   - Fixed `addTemporaryPiece()` similarly
   - Updated `createBoardGrid()` and `updatePieces()` to use utility methods

3. **Added documentation**:
   - JSDoc comments on all public methods specify coordinate system expected
   - Internal methods documented as using array indices

4. **Test verification**:
   - Created comprehensive test in `tests/e2e/issues/011-temporary-pieces-test.spec.ts`
   - All positions tested (corners, center, random) now work correctly
   - Temporary pieces align perfectly with intersection nodes

## Testing Policy
**Work CANNOT begin on this issue until a headless test replicates it.**

Test file: `/home/guy/code/git/github.com/ggcdevs/pente3d.ai/tests/e2e/issues/011-temporary-pieces-test.spec.ts`
- Status: PASSING ✓
- Verifies temporary pieces appear at exact hover position
- Tests multiple board positions successfully