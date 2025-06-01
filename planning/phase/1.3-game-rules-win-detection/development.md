# Chunk 1.3: Game Rules & Win Detection - Development Guide

## Overview
This chunk implements the complete game rules for 3D Pente, including move validation, capture detection, and win condition checking. All operations must be immutable and maintain consistency with the previously implemented data structures.

## Dependencies
- **Chunk 1.1**: Vector3, Player, Move, Piece classes
- **Chunk 1.2**: Board, Line, WinResult classes

## Classes to Implement

### 1. GameRules Class (`src/core/GameRules.ts`)

Handles all game rule validation and detection logic.

```typescript
import { Board } from './Board';
import { Move } from './Move';
import { Player } from './Player';
import { Vector3 } from './Vector3';
import { Line } from './Line';
import { WinResult } from './WinResult';
import { Piece } from './Piece';

export class GameRules {
  // Constants
  static readonly WIN_LENGTH = 5;
  static readonly CAPTURE_LENGTH = 2;
  static readonly CAPTURES_TO_WIN = 5;

  /**
   * Validates if a move is legal
   * @param board Current board state
   * @param move Move to validate
   * @param currentPlayer Player attempting the move
   * @param moveHistory Previous moves in the game
   * @returns true if move is valid
   */
  static isValidMove(
    board: Board,
    move: Move,
    currentPlayer: Player,
    moveHistory: Move[]
  ): boolean;

  /**
   * Detects captures resulting from a move
   * @param board Board state after the move
   * @param move The move that was just made
   * @returns Array of captured piece positions
   */
  static detectCaptures(board: Board, move: Move): Vector3[];

  /**
   * Checks if the game has been won
   * @param board Current board state
   * @param players Array of players in the game
   * @param lastMove The most recent move
   * @returns WinResult if game is won, null otherwise
   */
  static checkWinConditions(
    board: Board,
    players: Player[],
    lastMove: Move | null
  ): WinResult | null;

  /**
   * Checks for 5-in-a-row win
   * @param board Current board state
   * @param player Player to check for
   * @param lastMove Optional last move for optimization
   * @returns Winning line if found, null otherwise
   */
  static checkFiveInARow(
    board: Board,
    player: Player,
    lastMove: Move | null
  ): Line | null;

  /**
   * Checks if a player has won by captures
   * @param player Player to check
   * @returns true if player has captured enough pairs
   */
  static hasWonByCaptures(player: Player): boolean;

  /**
   * Gets the current player based on move history
   * @param players Array of players
   * @param moveHistory Previous moves
   * @returns Current player
   */
  static getCurrentPlayer(players: Player[], moveHistory: Move[]): Player;

  /**
   * Validates player order
   * @param move Move to validate
   * @param currentPlayer Expected current player
   * @returns true if player is correct
   */
  static isCorrectPlayer(move: Move, currentPlayer: Player): boolean;
}
```

### 2. GameState Class (`src/core/GameState.ts`)

Immutable representation of the complete game state.

```typescript
import { Board } from './Board';
import { Player } from './Player';
import { Move } from './Move';
import { WinResult } from './WinResult';
import { GameRules } from './GameRules';

export class GameState {
  readonly board: Board;
  readonly players: Player[];
  readonly moveHistory: Move[];
  readonly currentPlayerIndex: number;
  readonly winResult: WinResult | null;
  readonly isGameOver: boolean;

  constructor(
    board: Board,
    players: Player[],
    moveHistory: Move[] = [],
    currentPlayerIndex: number = 0,
    winResult: WinResult | null = null
  );

  /**
   * Creates initial game state
   * @param boardSize Size of the board
   * @param players Array of players
   * @returns New game state
   */
  static createInitialState(boardSize: number, players: Player[]): GameState;

  /**
   * Applies a move to create new state
   * @param move Move to apply
   * @returns New game state or throws if invalid
   */
  applyMove(move: Move): GameState;

  /**
   * Gets the current player
   * @returns Current player
   */
  getCurrentPlayer(): Player;

  /**
   * Checks if a move is valid
   * @param move Move to validate
   * @returns true if valid
   */
  isValidMove(move: Move): boolean;

  /**
   * Generates a hash of the game state
   * @returns Hash string
   */
  generateHash(): string;

  /**
   * Checks equality with another state
   * @param other Other game state
   * @returns true if states are equal
   */
  equals(other: GameState): boolean;

  /**
   * Creates a deep clone
   * @returns Cloned game state
   */
  clone(): GameState;

  /**
   * Serializes to JSON
   * @returns JSON representation
   */
  toJSON(): object;

  /**
   * Creates from JSON
   * @param json JSON object
   * @returns New game state
   */
  static fromJSON(json: any): GameState;
}
```

### 3. Extended Board Methods

Add these methods to the existing Board class:

```typescript
// In Board.ts, add these methods:

/**
 * Gets all lines passing through a position
 * @param position Position to check
 * @returns Array of lines through the position
 */
getLinesAtPosition(position: Vector3): Line[];

/**
 * Gets pieces in a specific direction from a position
 * @param position Starting position
 * @param direction Direction vector
 * @param maxDistance Maximum distance to check
 * @returns Array of pieces in order
 */
getPiecesInDirection(
  position: Vector3,
  direction: Vector3,
  maxDistance: number
): (Piece | null)[];

/**
 * Counts consecutive pieces of same player
 * @param position Starting position
 * @param direction Direction to count
 * @param playerId Player to match
 * @returns Count of consecutive pieces
 */
countConsecutive(
  position: Vector3,
  direction: Vector3,
  playerId: string
): number;
```

## Implementation Details

### Move Validation Algorithm
1. Check if position is within board bounds
2. Check if position is empty
3. Check if it's the correct player's turn
4. Verify move has correct player ID

### Capture Detection Algorithm
1. For each of the 26 directions from the placed piece:
   - Check pattern: [new piece][opponent][opponent][player]
   - If pattern matches, capture the two opponent pieces
2. Return all captured positions
3. Update player capture counts

### 5-in-a-row Detection Algorithm
1. If lastMove provided, only check lines through that position
2. Otherwise, check all possible lines on the board
3. For each line:
   - Count consecutive pieces of the same player
   - If count >= 5, return the line
4. Return null if no winning line found

### Hash Generation Algorithm
1. Serialize board state deterministically
2. Include player states (captures)
3. Include move history
4. Use SHA-256 or similar for consistency
5. Cache hash for performance

## Performance Requirements
- Move validation: < 1ms
- Capture detection: < 2ms
- Win detection: < 5ms
- Hash generation: < 10ms
- State cloning: < 5ms

## Error Handling
- Invalid moves throw descriptive errors
- Out of bounds positions handled gracefully
- Null/undefined checks on all inputs
- Type validation for JSON parsing

## Integration Points
- GameRules uses Board methods for piece queries
- GameState uses GameRules for validation
- Both classes work with immutable data structures
- Clean exports through index.ts

## Code Example

```typescript
// Example usage
const initialState = GameState.createInitialState(7, [
  Player.createLocal('Alice', 'white'),
  Player.createLocal('Bob', 'black')
]);

const move = Move.create(
  Vector3.create(3, 3, 3),
  'Alice',
  []
);

try {
  const newState = initialState.applyMove(move);
  console.log('Move applied successfully');
  
  if (newState.isGameOver) {
    console.log('Game won by:', newState.winResult?.winner.id);
  }
} catch (error) {
  console.error('Invalid move:', error.message);
}
```

## Export Structure

Update `src/core/index.ts`:
```typescript
// Existing exports
export * from './Vector3';
export * from './Player';
export * from './Move';
export * from './Piece';
export * from './Board';
export * from './Line';
export * from './WinResult';

// New exports
export * from './GameRules';
export * from './GameState';
```

## Testing Considerations
- Test all 26 directions for captures
- Test win detection edge cases
- Test state immutability
- Test hash consistency
- Test performance benchmarks
- Test error scenarios