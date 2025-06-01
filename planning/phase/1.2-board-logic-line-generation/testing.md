# Chunk 1.2: Board Logic & Line Generation - Testing Guide

## Testing Overview
Comprehensive validation of 3D board representation, line generation algorithms, and spatial calculations. This testing ensures mathematical correctness, performance targets, and edge case handling for the game's spatial foundation.

## Pre-Testing Setup
- Ensure Chunk 1.1 is complete with all 97 tests passing
- Verify TypeScript compilation succeeds
- Understand 3D coordinate systems and Moore neighborhoods

## Automated Testing Protocols

### 1. Line Class Testing

#### Test Group A: Line Construction and Validation
```bash
# Tests 1-8: Line construction
npm test -- --testNamePattern="Line.*construction"
```

**Test Coverage:**
- **Test 1**: Valid line with continuous coordinates
- **Test 2**: Line from 2 points (auto-direction)
- **Test 3**: Line from 5 points (complete line)
- **Test 4**: Empty coordinates throws error
- **Test 5**: Missing direction throws error
- **Test 6**: Non-continuous coordinates throws error
- **Test 7**: Single coordinate line is valid
- **Test 8**: Factory method fromCoords calculates direction

**Expected Results:**
- Continuous lines validate successfully
- Non-continuous lines throw clear errors
- Direction is correctly calculated from coordinates
- Complete lines have exactly 5 coordinates

#### Test Group B: Line Operations
```bash
# Tests 9-15: Line operations
npm test -- --testNamePattern="Line.*operations"
```

**Test Coverage:**
- **Test 9**: contains() finds coordinates correctly
- **Test 10**: extend() adds coordinate in positive direction
- **Test 11**: extendBackward() adds coordinate in negative direction
- **Test 12**: isSubsetOf() correctly identifies subsets
- **Test 13**: getLength() returns correct count
- **Test 14**: getStart() and getEnd() return correct coordinates
- **Test 15**: Lines with different directions aren't subsets

#### Test Group C: Line Utilities
```bash
# Tests 16-20: Line utilities
npm test -- --testNamePattern="Line.*utility"
```

**Test Coverage:**
- **Test 16**: toString() format is readable
- **Test 17**: toJSON() includes all properties
- **Test 18**: clone() creates independent copy
- **Test 19**: Immutability of line coordinates
- **Test 20**: Direction vector is normalized correctly

### 2. Board Class Testing

#### Test Group D: Board Construction
```bash
# Tests 21-26: Board construction
npm test -- --testNamePattern="Board.*construction"
```

**Test Coverage:**
- **Test 21**: Valid board sizes (7, 9, 11)
- **Test 22**: Invalid board size throws error
- **Test 23**: Empty board has no pieces
- **Test 24**: Board from pieces initializes correctly
- **Test 25**: createEmpty factory method
- **Test 26**: Default size is 7

#### Test Group E: Coordinate Management
```bash
# Tests 27-34: Coordinate management
npm test -- --testNamePattern="Board.*coordinates"
```

**Test Coverage:**
- **Test 27**: coordToKey generates consistent keys
- **Test 28**: isInBounds for center positions
- **Test 29**: isInBounds for edge positions
- **Test 30**: isInBounds for corner positions
- **Test 31**: isInBounds rejects out-of-bounds
- **Test 32**: Coordinate keys are unique
- **Test 33**: Negative coordinates handled correctly
- **Test 34**: Board size affects bounds correctly

#### Test Group F: Piece Management
```bash
# Tests 35-42: Piece management
npm test -- --testNamePattern="Board.*pieces"
```

**Test Coverage:**
- **Test 35**: placePiece adds piece correctly
- **Test 36**: placePiece returns new board instance
- **Test 37**: placePiece out of bounds throws error
- **Test 38**: placePiece on occupied position throws error
- **Test 39**: removePiece removes correctly
- **Test 40**: removePiece on empty position returns same board
- **Test 41**: getPiece retrieves correct piece
- **Test 42**: getAllPieces returns all pieces

#### Test Group G: Moore Neighborhood
```bash
# Tests 43-50: Moore neighborhood
npm test -- --testNamePattern="Board.*neighbors"
```

**Test Coverage:**
- **Test 43**: Center position has 26 neighbors
- **Test 44**: Face position has fewer neighbors
- **Test 45**: Edge position has fewer neighbors
- **Test 46**: Corner position has 7 neighbors
- **Test 47**: Neighbors are unique
- **Test 48**: Neighbors are all adjacent
- **Test 49**: Size 7 board neighbor counts
- **Test 50**: Size 11 board neighbor counts

#### Test Group H: Line Generation - Full Lines
```bash
# Tests 51-60: Full line generation
npm test -- --testNamePattern="Board.*generateFullLine"
```

**Test Coverage:**
- **Test 51**: Face-to-face line (straight)
- **Test 52**: Edge-to-edge line (2D diagonal)
- **Test 53**: Corner-to-corner line (3D diagonal)
- **Test 54**: Non-collinear points return null
- **Test 55**: Out-of-bounds start returns null
- **Test 56**: Out-of-bounds end returns null
- **Test 57**: Same start and end returns single point
- **Test 58**: Reverse direction creates same line
- **Test 59**: All 26 directions work correctly
- **Test 60**: Performance <1ms for any line

#### Test Group I: Line Generation - Partial Lines
```bash
# Tests 61-68: Partial line generation
npm test -- --testNamePattern="Board.*generatePartialLine"
```

**Test Coverage:**
- **Test 61**: Radius 2 creates 5-point line at center
- **Test 62**: Radius 1 creates 3-point line
- **Test 63**: Edge position truncates line correctly
- **Test 64**: Corner position truncates line correctly
- **Test 65**: Direction normalization works
- **Test 66**: All 26 directions supported
- **Test 67**: Zero radius creates single point
- **Test 68**: Large radius capped by board bounds

#### Test Group J: Lines Containing Position
```bash
# Tests 69-76: Get lines containing position
npm test -- --testNamePattern="Board.*getLinesContaining"
```

**Test Coverage:**
- **Test 69**: Center position has maximum lines
- **Test 70**: Edge position has fewer lines
- **Test 71**: Corner position has minimum lines
- **Test 72**: All returned lines contain the position
- **Test 73**: All lines have requested length
- **Test 74**: No duplicate lines returned
- **Test 75**: Performance scales with board size
- **Test 76**: Custom length parameter works

### 3. WinResult Class Testing

#### Test Group K: WinResult Construction
```bash
# Tests 77-82: WinResult construction
npm test -- --testNamePattern="WinResult.*construction"
```

**Test Coverage:**
- **Test 77**: No-win result construction
- **Test 78**: Five-in-a-row win construction
- **Test 79**: Capture win construction
- **Test 80**: Winner without type throws error
- **Test 81**: Five-in-a-row without line throws error
- **Test 82**: Factory methods work correctly

#### Test Group L: WinResult Queries
```bash
# Tests 83-88: WinResult queries
npm test -- --testNamePattern="WinResult.*queries"
```

**Test Coverage:**
- **Test 83**: isWin() detects wins correctly
- **Test 84**: isFiveInARow() works correctly
- **Test 85**: isCaptures() works correctly
- **Test 86**: No-win returns false for all queries
- **Test 87**: toString() formats correctly
- **Test 88**: toJSON() serialization complete

### 4. Integration Testing

#### Test Group M: Board and Line Integration
```bash
# Tests 89-95: Integration tests
npm test -- --testNamePattern="Integration.*board"
```

**Test Coverage:**
- **Test 89**: Lines from board positions are valid
- **Test 90**: Board piece placement preserves immutability
- **Test 91**: Complex board states handle correctly
- **Test 92**: Line generation with pieces on board
- **Test 93**: Memory efficiency with many operations
- **Test 94**: Thread safety of immutable operations
- **Test 95**: Board equality comparison accuracy

### 5. Performance Testing

#### Test Group N: Performance Benchmarks
```bash
# Tests 96-100: Performance tests
npm test -- --testNamePattern="Performance.*board"
```

**Test Coverage:**
- **Test 96**: Line generation <1ms for any size
- **Test 97**: Neighbor calculation <0.1ms
- **Test 98**: Board clone <1ms for full board
- **Test 99**: getLinesContaining <5ms worst case
- **Test 100**: 1000 piece operations <100ms

### 6. Edge Cases and Stress Testing

#### Test Group O: Edge Cases
```bash
# Tests 101-110: Edge cases
npm test -- --testNamePattern="Board.*edge|Line.*edge"
```

**Test Coverage:**
- **Test 101**: Maximum board size (11x11x11)
- **Test 102**: Minimum board size (7x7x7)
- **Test 103**: All corner positions accessible
- **Test 104**: All face centers accessible
- **Test 105**: Lines at board boundaries
- **Test 106**: Negative coordinate handling
- **Test 107**: Zero vector as direction
- **Test 108**: Parallel line detection
- **Test 109**: Memory limits with full board
- **Test 110**: Concurrent modifications safe

## Manual Testing Checklist

### Visual Verification
- [ ] Print board bounds for all sizes
- [ ] Verify neighbor counts at key positions
- [ ] Check line directions are normalized
- [ ] Validate coordinate key uniqueness

### Performance Profiling
- [ ] Profile line generation hotspots
- [ ] Memory usage during gameplay
- [ ] Garbage collection patterns
- [ ] CPU usage during complex calculations

### Integration Validation
- [ ] Board integrates with Chunk 1.1 classes
- [ ] Type definitions compile correctly
- [ ] No circular dependencies
- [ ] Bundle size impact acceptable

## Test Data Generators

### Board State Generator
```typescript
function generateTestBoard(fillPercent: number = 0.3): Board {
  const board = Board.createEmpty(7);
  const positions = generateRandomPositions(board.size, fillPercent);
  // Add pieces at positions
  return board;
}
```

### Line Pattern Generator
```typescript
function generateLinePatterns(): Line[] {
  // Generate lines in all 26 directions
  // Include edge cases and boundary conditions
}
```

## Success Criteria
- ✅ All 110 tests passing
- ✅ 95%+ code coverage on Board and Line classes
- ✅ Performance benchmarks met (<1ms line generation)
- ✅ No memory leaks detected
- ✅ TypeScript strict mode compliance
- ✅ Integration with existing classes verified

## Common Test Failures

**Issue**: Neighbor count wrong at corners
**Fix**: Ensure bounds checking excludes out-of-bounds neighbors

**Issue**: Line generation too slow
**Fix**: Optimize direction normalization and validation

**Issue**: Duplicate lines in getLinesContaining
**Fix**: Implement proper line equality comparison

**Issue**: Board mutations affect original
**Fix**: Ensure deep cloning of piece map

This comprehensive test suite ensures the 3D board logic is mathematically correct, performant, and ready for game rule implementation.