# Test Helper Library

This directory contains comprehensive test utilities for Pente3D tests.

## Structure

- `builders.ts` - Test data builders using the builder pattern
- `mocks.ts` - Mock factories for external dependencies
- `assertions.ts` - Custom Jest matchers and assertion helpers
- `test-utils.ts` - General testing utilities

## Usage

### Test Data Builders

```typescript
import { 
  Vector3Builder, 
  PlayerBuilder, 
  BoardBuilder, 
  GameBuilder,
  TestDataFactory,
  vector3,
  player,
  move
} from '@/tests/helpers';

// Create test objects with builders
const blackPlayer = new PlayerBuilder()
  .withId('player1')
  .withColor('black')
  .build();

const testBoard = new BoardBuilder()
  .withSize(7)
  .withPiece(0, 0, 0, blackPlayer)
  .withPiece(1, 0, 0, whitePlayer)
  .build();

// Use factory methods
const winningBoard = TestDataFactory.createWinningBoard();
const gameInProgress = TestDataFactory.createGameInProgress();

// Quick creation functions
const pos = vector3(1, 2, 3);
const blackPlayer = player('black');
const testMove = move(0, 0, 0, blackPlayer);
```

### Mock Factories

```typescript
import { 
  createMockNetworkManager,
  createMockRenderer,
  setupMockDOM,
  cleanupMockDOM,
  mockPerformanceNow
} from '@/tests/helpers';

// Setup DOM environment
beforeEach(() => {
  setupMockDOM();
});

afterEach(() => {
  cleanupMockDOM();
});

// Create mocks
const mockNetwork = createMockNetworkManager();
const mockRenderer = createMockRenderer();

// Mock timing
const perfNow = mockPerformanceNow();
perfNow.advance(100); // Advance time by 100ms
```

### Custom Assertions

```typescript
import { setupCustomMatchers, assertBoard, assertGame } from '@/tests/helpers';

// Setup custom matchers in test setup
beforeAll(() => {
  setupCustomMatchers();
});

// Use custom matchers
expect(board).toHavePieceAt(0, 0, 0);
expect(board).toHavePlayerAt(1, 0, 0, whitePlayer);
expect(board).toBeEmptyAt(2, 0, 0);
expect(board).toHaveSize(7);
expect(board).toHavePieceCount(5);
expect(error).toBePente3DError('INVALID_MOVE');
expect(move).toBeValidMove();
expect(gameState).toHaveWinner(blackPlayer);

// Use assertion helpers
assertBoard.isEmpty(board);
assertBoard.hasCorrectDimensions(board, 7);
assertGame.isInitialState(game);
assertGame.hasMoveCount(game, 10);
```

### Test Utilities

```typescript
import { 
  waitFor,
  waitFrames,
  simulateMoves,
  getAllValidPositions,
  createGameSnapshot,
  compareSnapshots,
  measurePerformance,
  suppressConsole
} from '@/tests/helpers';

// Wait for conditions
await waitFor(() => game.isGameOver(), 5000);
await waitFrames(3);

// Simulate gameplay
await simulateMoves(game, [
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 }
]);

// Snapshot testing
const snapshot1 = createGameSnapshot(game);
// ... make changes ...
const snapshot2 = createGameSnapshot(game);
const { equal, differences } = compareSnapshots(snapshot1, snapshot2);

// Performance testing
const perf = await measurePerformance(() => {
  board.getAllLines();
}, 1000);
console.log(`Average time: ${perf.averageTime}ms`);

// Suppress console during test
const restore = suppressConsole();
// ... test code that logs ...
restore();
```

## Best Practices

1. **Use builders for complex objects** - They make tests more readable and maintainable
2. **Prefer factory methods** - For common scenarios like "winning board" or "game in progress"
3. **Setup custom matchers** - They provide better error messages than generic assertions
4. **Mock external dependencies** - Always mock network, storage, and rendering in unit tests
5. **Use snapshots for complex state** - Compare game states before/after operations
6. **Measure performance** - For performance-critical code paths
7. **Clean up after tests** - Always restore mocks and clean up DOM

## Example Test

```typescript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { 
  GameBuilder,
  PlayerBuilder,
  TestDataFactory,
  setupCustomMatchers,
  setupMockDOM,
  cleanupMockDOM,
  assertGame,
  simulateMoves
} from '@/tests/helpers';

describe('Game', () => {
  beforeAll(() => {
    setupCustomMatchers();
  });

  beforeEach(() => {
    setupMockDOM();
  });

  afterEach(() => {
    cleanupMockDOM();
  });

  it('should detect five in a row', async () => {
    // Arrange
    const game = new GameBuilder()
      .withBoardSize(7)
      .build();
    
    // Act
    await simulateMoves(game, [
      { x: 0, y: 0, z: 0 }, // black
      { x: 0, y: 1, z: 0 }, // white
      { x: 1, y: 0, z: 0 }, // black
      { x: 0, y: 2, z: 0 }, // white
      { x: 2, y: 0, z: 0 }, // black
      { x: 0, y: 3, z: 0 }, // white
      { x: 3, y: 0, z: 0 }, // black
      { x: 1, y: 1, z: 0 }, // white
      { x: 4, y: 0, z: 0 }, // black wins!
    ]);
    
    // Assert
    expect(game.isGameOver()).toBe(true);
    expect(game.getWinner()).toBe('black');
    assertGame.hasMoveCount(game, 9);
  });
});
```