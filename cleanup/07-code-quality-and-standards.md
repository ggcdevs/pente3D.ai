# Code Quality and Standards

## 1. Naming Conventions

### 1.1 Current Inconsistencies
**Problem**: Mixed naming styles
```typescript
// Inconsistent private member naming
private _pieces: Map<string, Piece>;  // Board.ts
private peer: Peer;                   // NetworkManager.ts
private readonly options: Options;     // Renderer.ts

// Inconsistent method naming
coordToKey() vs generateFullLine()
getPiece() vs getPieceAt()  // Duplicate functionality
```

**Solution**: Standardized naming conventions
```typescript
// Naming Convention Guide
interface NamingConventions {
  // Private members: no prefix (TypeScript private keyword is enough)
  private pieces: Map<string, Piece>;
  private peer: Peer;
  
  // Constants: UPPER_SNAKE_CASE
  private static readonly MAX_BOARD_SIZE = 20;
  private static readonly DEFAULT_PORT = 9000;
  
  // Interfaces: PascalCase with descriptive names
  interface BoardConfiguration { }
  interface NetworkMessage { }
  
  // Type aliases: PascalCase
  type PlayerId = string;
  type BoardPosition = Vector3;
  
  // Enums: PascalCase with UPPER_SNAKE_CASE values
  enum GamePhase {
    SETUP = 'SETUP',
    PLAYING = 'PLAYING',
    GAME_OVER = 'GAME_OVER'
  }
  
  // Methods: camelCase, verb-first
  placePiece() // not setPiece()
  validateMove() // not checkMove()
  calculateScore() // not getScore()
  
  // Boolean methods/properties: is/has/can prefix
  isValidPosition()
  hasWinner()
  canUndo()
  
  // Event names: kebab-case
  emit('piece-placed')
  emit('game-over')
  emit('state-changed')
}
```

### 1.2 File Naming Standards
```
src/
  core/
    Board.ts          // Classes: PascalCase
    GameRules.ts      // Multi-word: PascalCase
    index.ts          // Indexes: lowercase
  utils/
    eventEmitter.ts   // Utilities: camelCase
    coordinate.helpers.ts  // Helpers: .helpers.ts
    board.test.ts     // Tests: .test.ts
    game.spec.ts      // E2E tests: .spec.ts
  types/
    game.types.ts     // Type definitions: .types.ts
    network.d.ts      // Declarations: .d.ts
```

## 2. Code Organization Standards

### 2.1 File Structure Template
```typescript
/**
 * @fileoverview [Description]
 * @module [module/path]
 */

// 1. Imports (ordered)
// Built-in modules
import { readFile } from 'fs/promises';

// External dependencies
import * as THREE from 'three';
import { produce } from 'immer';

// Internal dependencies - absolute paths
import { Board } from '@/core/Board';
import { GameRules } from '@/core/GameRules';

// Internal dependencies - relative paths
import { validatePosition } from './validators';

// Type imports
import type { BoardState, GameConfig } from '@/types';

// 2. Constants
const DEFAULT_BOARD_SIZE = 7;
const MAX_PLAYERS = 2;

// 3. Types/Interfaces
interface LocalTypes {
  // ...
}

// 4. Main class/function
export class ClassName {
  // Static properties
  static readonly VERSION = '1.0.0';
  
  // Instance properties
  private board: Board;
  
  // Constructor
  constructor() {}
  
  // Public methods
  public methodName(): void {}
  
  // Protected methods
  protected helperMethod(): void {}
  
  // Private methods
  private internalMethod(): void {}
}

// 5. Helper functions
function helperFunction(): void {}

// 6. Exports
export { helperFunction };
export type { LocalTypes };
```

### 2.2 Method Organization
```typescript
class WellOrganizedClass {
  // 1. Properties (grouped by visibility)
  public readonly id: string;
  protected data: Data;
  private cache: Map<string, any>;
  
  // 2. Constructor
  constructor() {}
  
  // 3. Lifecycle methods
  initialize(): void {}
  dispose(): void {}
  
  // 4. Public API (grouped by feature)
  // Feature: Data Management
  getData(): Data {}
  setData(data: Data): void {}
  
  // Feature: Operations
  process(): Result {}
  validate(): boolean {}
  
  // 5. Event handlers
  private handleClick = (event: MouseEvent) => {}
  private handleKeyPress = (event: KeyboardEvent) => {}
  
  // 6. Private helpers
  private calculateInternal(): number {}
  private updateCache(): void {}
}
```

## 3. TypeScript Best Practices

### 3.1 Strict Type Usage
```typescript
// ❌ Bad: Using 'any'
function processData(data: any): any {
  return data.map((item: any) => item.value);
}

// ✅ Good: Proper typing
function processData<T extends { value: number }>(data: T[]): number[] {
  return data.map(item => item.value);
}

// ❌ Bad: Implicit any
const handler = (event) => {
  console.log(event.target);
};

// ✅ Good: Explicit types
const handler = (event: MouseEvent): void => {
  const target = event.target as HTMLElement;
  console.log(target);
};
```

### 3.2 Type Guards and Assertions
```typescript
// Type guards
function isPiece(obj: unknown): obj is Piece {
  return obj instanceof Piece;
}

function isValidPosition(pos: unknown): pos is Vector3 {
  return pos instanceof Vector3 && 
         pos.x >= 0 && pos.x < BOARD_SIZE &&
         pos.y >= 0 && pos.y < BOARD_SIZE &&
         pos.z >= 0 && pos.z < BOARD_SIZE;
}

// Assertion functions
function assertDefined<T>(value: T | undefined, name: string): asserts value is T {
  if (value === undefined) {
    throw new Error(`${name} is required but was undefined`);
  }
}

// Usage
function processMove(position?: Vector3): void {
  assertDefined(position, 'position');
  // TypeScript now knows position is defined
  console.log(position.x);
}
```

### 3.3 Utility Types
```typescript
// Use utility types effectively
type GameConfig = {
  boardSize: number;
  playerCount: number;
  timeLimit?: number;
  allowUndo: boolean;
};

// Partial for updates
type ConfigUpdate = Partial<GameConfig>;

// Required for validation
type CompleteConfig = Required<GameConfig>;

// Pick for subsets
type DisplayConfig = Pick<GameConfig, 'boardSize' | 'playerCount'>;

// Readonly for immutability
type ImmutableConfig = Readonly<GameConfig>;

// Custom utility types
type Nullable<T> = T | null;
type AsyncResult<T> = Promise<Result<T>>;
```

## 4. Error Handling Standards

### 4.1 Error Hierarchy
```typescript
// Base error class
export abstract class GameError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
  }
  
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context
    };
  }
}

// Specific error types
export class ValidationError extends GameError {
  constructor(message: string, field: string, value: unknown) {
    super(message, 'VALIDATION_ERROR', { field, value });
  }
}

export class NetworkError extends GameError {
  constructor(message: string, public readonly statusCode?: number) {
    super(message, 'NETWORK_ERROR', { statusCode });
  }
}

export class GameLogicError extends GameError {
  constructor(message: string, public readonly move?: Move) {
    super(message, 'GAME_LOGIC_ERROR', { move });
  }
}
```

### 4.2 Error Handling Patterns
```typescript
// Result type for explicit error handling
type Result<T, E = Error> = 
  | { success: true; value: T }
  | { success: false; error: E };

// Try-catch wrapper
function tryCatch<T>(fn: () => T): Result<T> {
  try {
    return { success: true, value: fn() };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

// Async error handling
async function safeAsync<T>(
  promise: Promise<T>
): Promise<Result<T>> {
  try {
    const value = await promise;
    return { success: true, value };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

// Usage
const result = await safeAsync(fetchGameData());
if (!result.success) {
  logger.error('Failed to fetch game data', result.error);
  return;
}
const gameData = result.value;
```

## 5. Code Comments Standards

### 5.1 JSDoc Standards
```typescript
/**
 * Represents a piece on the game board.
 * 
 * @remarks
 * Pieces are immutable - any change creates a new instance.
 * 
 * @example
 * ```typescript
 * const piece = new Piece(player, new Vector3(3, 3, 3));
 * const captured = piece.capture();
 * ```
 * 
 * @see {@link Board} for piece placement
 * @see {@link Player} for piece ownership
 */
export class Piece {
  /**
   * Creates a new piece.
   * 
   * @param player - The player who owns this piece
   * @param position - Board position in 3D coordinates
   * @param isTemporary - Whether this is a temporary piece
   * @throws {ValidationError} If position is invalid
   */
  constructor(
    public readonly player: Player,
    public readonly position: Vector3,
    public readonly isTemporary: boolean = false
  ) {
    this.validatePosition(position);
  }
}
```

### 5.2 Inline Comments
```typescript
// ✅ Good: Explains why
// Use WeakMap to allow garbage collection of unused boards
private cache = new WeakMap<Board, CacheEntry>();

// ❌ Bad: Explains what (obvious)
// Create a new array
const array = [];

// ✅ Good: Complex algorithm explanation
// Binary search for the insertion point
// Maintains sorted order for O(log n) lookups
let left = 0;
let right = positions.length - 1;

// ✅ Good: TODO with context
// TODO(#123): Optimize for boards larger than 10x10x10
// Current algorithm is O(n³), consider spatial indexing

// ❌ Bad: Vague TODO
// TODO: Fix this
```

## 6. Testing Standards

### 6.1 Test Structure
```typescript
describe('Board', () => {
  // Setup shared test data
  let board: Board;
  let player: Player;
  
  beforeEach(() => {
    board = new Board(7);
    player = new Player('player1', 'black');
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  describe('constructor', () => {
    it('should create board with specified size', () => {
      expect(board.size).toBe(7);
    });
    
    it('should throw for invalid size', () => {
      expect(() => new Board(-1)).toThrow(ValidationError);
      expect(() => new Board(0)).toThrow(ValidationError);
      expect(() => new Board(21)).toThrow(ValidationError);
    });
  });
  
  describe('placePiece', () => {
    it('should place piece at valid position', () => {
      // Arrange
      const position = new Vector3(3, 3, 3);
      const piece = new Piece(player, position);
      
      // Act
      const newBoard = board.placePiece(piece);
      
      // Assert
      expect(newBoard.getPieceAt(position)).toBe(piece);
      expect(newBoard).not.toBe(board); // Immutability
    });
    
    // Edge cases
    it.each([
      [0, 0, 0, 'corner'],
      [6, 6, 6, 'opposite corner'],
      [3, 0, 3, 'edge'],
      [3, 3, 3, 'center']
    ])('should place piece at %i,%i,%i (%s)', (x, y, z, description) => {
      const position = new Vector3(x, y, z);
      const piece = new Piece(player, position);
      const newBoard = board.placePiece(piece);
      expect(newBoard.getPieceAt(position)).toBe(piece);
    });
  });
});
```

### 6.2 Test Naming Conventions
```typescript
// ✅ Good: Descriptive test names
it('should return null when no piece exists at position');
it('should throw InvalidMoveError when position is occupied');
it('should emit piece-placed event after successful placement');

// ❌ Bad: Vague test names
it('works');
it('handles errors');
it('test piece placement');

// ✅ Good: Behavior-driven descriptions
describe('when board is full', () => {
  it('should return true for isFull()');
  it('should return empty array for getValidMoves()');
});

// ✅ Good: Edge case descriptions
describe('with maximum board size', () => {
  it('should handle 20x20x20 board without performance degradation');
});
```

## 7. Async Code Standards

### 7.1 Promise Patterns
```typescript
// ✅ Good: Async/await with proper error handling
async function loadGameData(id: string): Promise<GameData> {
  try {
    const response = await fetch(`/api/games/${id}`);
    if (!response.ok) {
      throw new NetworkError(`Failed to load game: ${response.statusText}`, response.status);
    }
    return await response.json();
  } catch (error) {
    logger.error('Failed to load game data', { id, error });
    throw error;
  }
}

// ❌ Bad: Mixing callbacks and promises
function loadGameData(id: string, callback: (err: Error | null, data?: GameData) => void) {
  fetch(`/api/games/${id}`)
    .then(res => res.json())
    .then(data => callback(null, data))
    .catch(err => callback(err));
}
```

### 7.2 Concurrent Operations
```typescript
// ✅ Good: Proper concurrent handling
async function initializeGame(): Promise<void> {
  // Parallel independent operations
  const [assets, config, savedState] = await Promise.all([
    loadAssets(),
    loadConfig(),
    loadSavedState()
  ]);
  
  // Sequential dependent operations
  const game = createGame(config);
  await game.initialize();
  
  if (savedState) {
    await game.restore(savedState);
  }
  
  await renderGame(game, assets);
}

// ✅ Good: Race conditions handling
async function connectWithTimeout(peerId: string, timeout: number = 5000): Promise<Connection> {
  const connection = networkManager.connect(peerId);
  const timeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('Connection timeout')), timeout)
  );
  
  return Promise.race([connection, timeoutPromise]);
}
```

## 8. Performance Standards

### 8.1 Optimization Guidelines
```typescript
// ✅ Good: Memoization for expensive operations
const memoizedLineCheck = memoize(
  (board: Board, line: Line) => checkLine(board, line),
  (board, line) => `${board.hash}_${line.id}` // Cache key
);

// ✅ Good: Early returns
function validateMove(move: Move): boolean {
  if (!move) return false;
  if (!isValidPosition(move.position)) return false;
  if (board.getPieceAt(move.position)) return false;
  if (game.isOver()) return false;
  
  return true;
}

// ❌ Bad: Unnecessary iterations
function findPiece(position: Vector3): Piece | null {
  for (const piece of this.pieces) {
    if (piece.position.equals(position)) {
      return piece;
    }
  }
  return null;
}

// ✅ Good: Use appropriate data structure
private pieceMap = new Map<string, Piece>();

function findPiece(position: Vector3): Piece | null {
  return this.pieceMap.get(position.toKey()) || null;
}
```

## 9. Security Standards

### 9.1 Input Validation
```typescript
// Always validate external input
function validateGameConfig(config: unknown): GameConfig {
  const schema = z.object({
    boardSize: z.number().int().min(3).max(20),
    playerCount: z.number().int().min(2).max(4),
    timeLimit: z.number().positive().optional(),
    allowUndo: z.boolean()
  });
  
  return schema.parse(config);
}

// Sanitize user-generated content
function sanitizePlayerName(name: string): string {
  return name
    .trim()
    .substring(0, 20)
    .replace(/[<>&'"]/g, ''); // Basic XSS prevention
}
```

### 9.2 Secure Communication
```typescript
// Never expose sensitive data
class NetworkManager {
  private sessionKey?: string; // Never send to client
  
  toJSON() {
    const { sessionKey, ...publicData } = this;
    return publicData;
  }
}
```

## 10. Code Review Checklist

### Before Submitting PR
- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] ESLint warnings addressed
- [ ] Code follows naming conventions
- [ ] Public APIs have JSDoc
- [ ] Complex logic has comments
- [ ] No console.log statements
- [ ] No commented-out code
- [ ] Error cases handled
- [ ] Performance considerations addressed
- [ ] Security implications considered
- [ ] Accessibility requirements met

### Review Focus Areas
1. **Logic Correctness**: Does it do what it should?
2. **Edge Cases**: Are all scenarios handled?
3. **Performance**: Is it efficient?
4. **Maintainability**: Is it easy to understand?
5. **Testability**: Can it be tested easily?
6. **Security**: Are inputs validated?
7. **Consistency**: Does it follow patterns?
8. **Documentation**: Is it well documented?