# Chunk 1.3: Game Rules & Win Detection - Testing Guide

## Testing Overview
Comprehensive test coverage for game rules, move validation, capture detection, and win conditions. Target: >95% coverage with 150+ tests.

## Test Files Structure

### 1. `tests/unit/core/GameRules.test.ts`

#### Test Group 1: Move Validation (15 tests)
```typescript
describe('GameRules', () => {
  describe('isValidMove', () => {
    test('accepts valid move on empty position');
    test('rejects move on occupied position');
    test('rejects move outside board bounds');
    test('rejects move with wrong player turn');
    test('accepts first move from first player');
    test('enforces alternating turns');
    test('rejects move with mismatched player ID');
    test('handles empty move history');
    test('validates moves at board edges');
    test('validates moves at board corners');
    test('rejects negative coordinates');
    test('rejects coordinates beyond board size');
    test('accepts move after captures');
    test('maintains turn order after captures');
    test('handles null/undefined inputs gracefully');
  });
```

#### Test Group 2: Capture Detection (25 tests)
```typescript
  describe('detectCaptures', () => {
    test('detects horizontal capture (positive X)');
    test('detects horizontal capture (negative X)');
    test('detects vertical capture (positive Y)');
    test('detects vertical capture (negative Y)');
    test('detects depth capture (positive Z)');
    test('detects depth capture (negative Z)');
    test('detects diagonal capture (XY plane)');
    test('detects diagonal capture (XZ plane)');
    test('detects diagonal capture (YZ plane)');
    test('detects 3D diagonal capture (all positive)');
    test('detects 3D diagonal capture (mixed signs)');
    test('detects multiple captures in one move');
    test('detects captures at board edges');
    test('detects captures at board corners');
    test('does not detect incomplete patterns');
    test('does not detect wrong player patterns');
    test('does not detect patterns with gaps');
    test('handles capturing temporary pieces');
    test('ignores permanent pieces in patterns');
    test('detects up to 8 captures from one move');
    test('returns empty array when no captures');
    test('validates capture positions are in bounds');
    test('handles captures near board boundaries');
    test('correctly identifies capturable pieces');
    test('performance: processes captures quickly');
  });
```

#### Test Group 3: Win Detection - 5 in a Row (20 tests)
```typescript
  describe('checkFiveInARow', () => {
    test('detects horizontal win (X axis)');
    test('detects vertical win (Y axis)');
    test('detects depth win (Z axis)');
    test('detects diagonal win in XY plane');
    test('detects diagonal win in XZ plane');
    test('detects diagonal win in YZ plane');
    test('detects 3D diagonal win');
    test('detects exactly 5 in a row');
    test('detects more than 5 in a row');
    test('does not detect 4 in a row');
    test('handles interrupted sequences');
    test('detects win at board edges');
    test('detects win at board corners');
    test('optimizes search with last move hint');
    test('finds win without last move hint');
    test('handles multiple potential wins');
    test('returns longest winning line');
    test('ignores opponent pieces in line');
    test('performance: quick win detection');
    test('handles empty board correctly');
  });
```

#### Test Group 4: Capture Win Detection (10 tests)
```typescript
  describe('hasWonByCaptures', () => {
    test('detects win with exactly 5 captures');
    test('detects win with more than 5 captures');
    test('does not trigger with 4 captures');
    test('counts pair captures correctly');
    test('handles player with no captures');
    test('updates capture count accurately');
    test('distinguishes between players captures');
    test('handles capture count edge cases');
    test('validates capture win state');
    test('performance: instant capture check');
  });
```

#### Test Group 5: Player Management (10 tests)
```typescript
  describe('getCurrentPlayer', () => {
    test('returns first player for empty history');
    test('alternates between two players');
    test('handles three player games');
    test('handles four player games');
    test('maintains order after captures');
    test('cycles through all players');
    test('handles single player edge case');
    test('throws error for empty player array');
    test('validates player array integrity');
    test('performance: instant player lookup');
  });
});
```

### 2. `tests/unit/core/GameState.test.ts`

#### Test Group 6: GameState Construction (15 tests)
```typescript
describe('GameState', () => {
  describe('constructor and creation', () => {
    test('creates initial state with empty board');
    test('creates state with specified board size');
    test('initializes with provided players');
    test('sets first player as current');
    test('initializes empty move history');
    test('sets game as not over initially');
    test('has no win result initially');
    test('validates minimum player count');
    test('validates maximum player count');
    test('validates board size');
    test('creates immutable state');
    test('preserves player order');
    test('handles custom starting positions');
    test('factory method creates valid state');
    test('throws on invalid construction params');
  });
```

#### Test Group 7: Move Application (20 tests)
```typescript
  describe('applyMove', () => {
    test('applies valid move successfully');
    test('returns new state instance');
    test('preserves immutability of original');
    test('updates board with new piece');
    test('adds move to history');
    test('advances current player');
    test('detects and applies captures');
    test('updates player capture counts');
    test('detects win conditions');
    test('sets game over on win');
    test('sets win result correctly');
    test('throws on invalid move');
    test('throws on game already over');
    test('validates move coordinates');
    test('validates current player');
    test('handles capture at board edge');
    test('handles multiple captures');
    test('maintains state consistency');
    test('preserves move timestamps');
    test('performance: applies move quickly');
  });
```

#### Test Group 8: State Queries (10 tests)
```typescript
  describe('state queries', () => {
    test('getCurrentPlayer returns correct player');
    test('isValidMove checks all rules');
    test('correctly reports game over state');
    test('provides access to move history');
    test('provides current board state');
    test('tracks player statistics');
    test('calculates legal moves');
    test('identifies check/threat positions');
    test('provides undo capability');
    test('supports state analysis');
  });
```

#### Test Group 9: Hash Generation (15 tests)
```typescript
  describe('generateHash', () => {
    test('generates consistent hash for same state');
    test('generates different hash for different boards');
    test('includes player state in hash');
    test('includes move history in hash');
    test('includes current player in hash');
    test('handles empty board state');
    test('handles full board state');
    test('is deterministic across runs');
    test('is unique for different positions');
    test('is unique for different capture counts');
    test('handles hash collisions gracefully');
    test('performance: generates hash quickly');
    test('works with all board sizes');
    test('maintains hash after serialization');
    test('validates hash format');
  });
```

#### Test Group 10: Equality and Cloning (10 tests)
```typescript
  describe('equals and clone', () => {
    test('equals returns true for identical states');
    test('equals returns false for different boards');
    test('equals returns false for different players');
    test('equals returns false for different history');
    test('equals handles null/undefined');
    test('clone creates identical copy');
    test('clone preserves all properties');
    test('clone creates independent instance');
    test('clone maintains immutability');
    test('performance: clones efficiently');
  });
```

#### Test Group 11: Serialization (10 tests)
```typescript
  describe('JSON serialization', () => {
    test('serializes all state properties');
    test('deserializes to identical state');
    test('handles empty game state');
    test('handles complex game state');
    test('preserves move history');
    test('preserves player statistics');
    test('preserves win conditions');
    test('validates JSON structure');
    test('handles malformed JSON gracefully');
    test('round-trip maintains equality');
  });
});
```

### 3. `tests/unit/core/Board.extended.test.ts`

#### Test Group 12: Extended Board Methods (15 tests)
```typescript
describe('Board Extended Methods', () => {
  describe('getLinesAtPosition', () => {
    test('returns all 26 lines for center position');
    test('returns limited lines for edge position');
    test('returns minimal lines for corner position');
    test('handles out of bounds position');
    test('includes all orthogonal lines');
    test('includes all diagonal lines');
    test('includes all 3D diagonal lines');
    test('filters lines by minimum length');
    test('performance: generates lines quickly');
  });

  describe('getPiecesInDirection', () => {
    test('returns pieces in positive direction');
    test('returns pieces in negative direction');
    test('stops at board boundary');
    test('respects max distance parameter');
    test('handles empty positions correctly');
    test('returns pieces in correct order');
  });

  describe('countConsecutive', () => {
    test('counts single piece');
    test('counts multiple consecutive pieces');
    test('stops at opponent piece');
    test('stops at empty position');
    test('stops at board boundary');
    test('handles all 26 directions');
  });
});
```

### 4. `tests/integration/game-rules-integration.test.ts`

#### Test Group 13: Complete Game Scenarios (20 tests)
```typescript
describe('Game Rules Integration', () => {
  describe('complete game scenarios', () => {
    test('plays game to horizontal win');
    test('plays game to vertical win');
    test('plays game to diagonal win');
    test('plays game to 3D diagonal win');
    test('plays game to capture win');
    test('handles complex capture sequences');
    test('handles near-win blocking');
    test('manages multiple threat positions');
    test('completes 50-move game');
    test('handles draw conditions');
    test('validates tournament rules');
    test('supports different board sizes');
    test('handles 3-player games');
    test('handles 4-player games');
    test('maintains consistency throughout');
    test('tracks statistics correctly');
    test('handles edge case positions');
    test('stress test with random moves');
    test('performance: handles long games');
    test('memory: no leaks in long games');
  });
});
```

## Performance Benchmarks

### 5. `tests/performance/game-rules-performance.test.ts`

```typescript
describe('Game Rules Performance', () => {
  test('move validation completes in <1ms');
  test('capture detection completes in <2ms');
  test('win detection completes in <5ms');
  test('hash generation completes in <10ms');
  test('state cloning completes in <5ms');
  test('handles 1000 moves efficiently');
  test('scales linearly with board size');
  test('memory usage remains bounded');
});
```

## Test Data Helpers

Create `tests/fixtures/game-states.ts`:
```typescript
export const gameStates = {
  empty: // Empty board state
  midGame: // Complex mid-game position
  nearWin: // One move from victory
  capturePosition: // Multiple capture opportunities
  endGame: // Nearly full board
  drawPosition: // No winning moves available
};

export const moveSequences = {
  horizontalWin: // 9 moves to horizontal victory
  diagonalWin: // 11 moves to diagonal victory
  captureWin: // 20 moves to capture victory
  complexGame: // 50+ move realistic game
};
```

## Edge Cases to Test
1. Simultaneous win conditions (5-in-a-row and captures)
2. Win detection with 6+ in a row
3. Captures creating winning positions
4. Board boundaries affecting captures
5. Complex 3D diagonal patterns
6. Performance with nearly full board
7. Hash collisions and uniqueness
8. State recovery from corruption

## Coverage Requirements
- Line coverage: >95%
- Branch coverage: >90%
- Function coverage: 100%
- Statement coverage: >95%

## Total Test Count
- GameRules.test.ts: 80 tests
- GameState.test.ts: 70 tests  
- Board.extended.test.ts: 15 tests
- Integration tests: 20 tests
- Performance tests: 8 tests
- **Total: 193 tests**