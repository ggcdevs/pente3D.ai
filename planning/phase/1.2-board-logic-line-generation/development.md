# Chunk 1.2: Board Logic & Line Generation - Development Guide

## Overview
Implement the 3D board representation with comprehensive line generation capabilities. This chunk creates the spatial logic foundation that enables win detection, capture detection, and visualization of potential winning lines in 3D space.

## Prerequisites
- Chunk 1.1 (Basic Data Structures) completed and tested
- Understanding of 3D Moore neighborhoods (26 neighbors)
- Familiarity with 3D line generation algorithms

## Step-by-Step Implementation

### Step 1: Create Board-Related Type Definitions
Update `src/types/index.ts` with board-specific types:

```typescript
// Add to existing types
export type BoardSize = 7 | 9 | 11;

export interface IBoard {
  size: BoardSize;
  pieces: Map<string, IPiece>;
}

export interface ILine {
  coords: IVector3[];
  direction: IVector3;
  isComplete: boolean;
}

export interface IWinResult {
  winner: IPlayer | null;
  winningLine: ILine | null;
  winType: 'five-in-a-row' | 'captures' | null;
}

// 3D direction vectors for all 26 directions
export const DIRECTIONS_3D: IVector3[] = [
  // Face directions (6)
  { x: 1, y: 0, z: 0 },   // Right
  { x: -1, y: 0, z: 0 },  // Left
  { x: 0, y: 1, z: 0 },   // Up
  { x: 0, y: -1, z: 0 },  // Down
  { x: 0, y: 0, z: 1 },   // Forward
  { x: 0, y: 0, z: -1 },  // Backward
  
  // Edge directions (12)
  { x: 1, y: 1, z: 0 },   // Right-Up
  { x: 1, y: -1, z: 0 },  // Right-Down
  { x: -1, y: 1, z: 0 },  // Left-Up
  { x: -1, y: -1, z: 0 }, // Left-Down
  { x: 1, y: 0, z: 1 },   // Right-Forward
  { x: 1, y: 0, z: -1 },  // Right-Backward
  { x: -1, y: 0, z: 1 },  // Left-Forward
  { x: -1, y: 0, z: -1 }, // Left-Backward
  { x: 0, y: 1, z: 1 },   // Up-Forward
  { x: 0, y: 1, z: -1 },  // Up-Backward
  { x: 0, y: -1, z: 1 },  // Down-Forward
  { x: 0, y: -1, z: -1 }, // Down-Backward
  
  // Corner directions (8)
  { x: 1, y: 1, z: 1 },   // Right-Up-Forward
  { x: 1, y: 1, z: -1 },  // Right-Up-Backward
  { x: 1, y: -1, z: 1 },  // Right-Down-Forward
  { x: 1, y: -1, z: -1 }, // Right-Down-Backward
  { x: -1, y: 1, z: 1 },  // Left-Up-Forward
  { x: -1, y: 1, z: -1 }, // Left-Up-Backward
  { x: -1, y: -1, z: 1 }, // Left-Down-Forward
  { x: -1, y: -1, z: -1 } // Left-Down-Backward
];

// Helper type for coordinate keys
export type CoordKey = string; // Format: "x,y,z"
```

### Step 2: Implement Line Class
Create `src/core/Line.ts`:

```typescript
import { ILine, IVector3 } from '@/types';
import { Vector3 } from './Vector3';

export class Line implements ILine {
  public readonly coords: Vector3[];
  public readonly direction: Vector3;
  public readonly isComplete: boolean;

  constructor(coords: (Vector3 | IVector3)[], direction: Vector3 | IVector3) {
    // Validation
    if (!coords || coords.length === 0) {
      throw new Error('Line must have at least one coordinate');
    }

    if (!direction) {
      throw new Error('Line direction is required');
    }

    // Convert to Vector3 instances
    this.coords = coords.map(coord => 
      coord instanceof Vector3 ? coord : Vector3.fromObject(coord)
    );
    
    this.direction = direction instanceof Vector3 
      ? direction 
      : Vector3.fromObject(direction);

    // A complete line has exactly 5 coordinates
    this.isComplete = this.coords.length === 5;

    // Validate line continuity
    this.validateContinuity();
  }

  // Factory methods
  static fromCoords(coords: (Vector3 | IVector3)[]): Line {
    if (coords.length < 2) {
      throw new Error('Need at least 2 coordinates to determine direction');
    }

    const first = coords[0] instanceof Vector3 ? coords[0] : Vector3.fromObject(coords[0]);
    const second = coords[1] instanceof Vector3 ? coords[1] : Vector3.fromObject(coords[1]);
    const direction = second.subtract(first);

    return new Line(coords, direction);
  }

  // Validation
  private validateContinuity(): void {
    if (this.coords.length < 2) return;

    for (let i = 1; i < this.coords.length; i++) {
      const expected = this.coords[0].add(this.direction.multiply(i));
      if (!this.coords[i].equals(expected)) {
        throw new Error(`Line is not continuous at index ${i}`);
      }
    }
  }

  // Query methods
  contains(coord: Vector3 | IVector3): boolean {
    const target = coord instanceof Vector3 ? coord : Vector3.fromObject(coord);
    return this.coords.some(c => c.equals(target));
  }

  getLength(): number {
    return this.coords.length;
  }

  getStart(): Vector3 {
    return this.coords[0];
  }

  getEnd(): Vector3 {
    return this.coords[this.coords.length - 1];
  }

  // Extend the line by one position in the positive direction
  extend(): Line | null {
    const nextCoord = this.getEnd().add(this.direction);
    return new Line([...this.coords, nextCoord], this.direction);
  }

  // Extend the line by one position in the negative direction
  extendBackward(): Line | null {
    const prevCoord = this.getStart().subtract(this.direction);
    return new Line([prevCoord, ...this.coords], this.direction);
  }

  // Check if this line is a subset of another line
  isSubsetOf(other: Line): boolean {
    if (!this.direction.equals(other.direction)) {
      return false;
    }
    return this.coords.every(coord => other.contains(coord));
  }

  // Utility methods
  toString(): string {
    const coordStr = this.coords.map(c => c.toString()).join(' -> ');
    return `Line(${coordStr})`;
  }

  toJSON(): ILine {
    return {
      coords: this.coords.map(c => c.toJSON()),
      direction: this.direction.toJSON(),
      isComplete: this.isComplete
    };
  }

  clone(): Line {
    return new Line(
      this.coords.map(c => c.clone()),
      this.direction.clone()
    );
  }
}
```

### Step 3: Implement Board Class
Create `src/core/Board.ts`:

```typescript
import { IBoard, IPiece, IVector3, BoardSize, CoordKey, DIRECTIONS_3D } from '@/types';
import { Vector3 } from './Vector3';
import { Piece } from './Piece';
import { Line } from './Line';

export class Board implements IBoard {
  public readonly size: BoardSize;
  private readonly _pieces: Map<string, Piece>;

  constructor(size: BoardSize = 7) {
    // Validate size
    if (![7, 9, 11].includes(size)) {
      throw new Error('Board size must be 7, 9, or 11');
    }

    this.size = size;
    this._pieces = new Map();
  }

  // Factory methods
  static createEmpty(size: BoardSize = 7): Board {
    return new Board(size);
  }

  static fromPieces(pieces: (Piece | IPiece)[], size: BoardSize = 7): Board {
    const board = new Board(size);
    pieces.forEach(piece => {
      board.placePiece(piece);
    });
    return board;
  }

  // Coordinate key management
  private coordToKey(coord: Vector3 | IVector3): CoordKey {
    const v = coord instanceof Vector3 ? coord : Vector3.fromObject(coord);
    return `${v.x},${v.y},${v.z}`;
  }

  private keyToCoord(key: CoordKey): Vector3 {
    const [x, y, z] = key.split(',').map(Number);
    return new Vector3(x, y, z);
  }

  // Board state queries
  get pieces(): Map<string, IPiece> {
    const result = new Map<string, IPiece>();
    this._pieces.forEach((piece, key) => {
      result.set(key, piece.toJSON());
    });
    return result;
  }

  getPiece(coord: Vector3 | IVector3): Piece | null {
    const key = this.coordToKey(coord);
    return this._pieces.get(key) || null;
  }

  hasPiece(coord: Vector3 | IVector3): boolean {
    return this.getPiece(coord) !== null;
  }

  isEmpty(coord: Vector3 | IVector3): boolean {
    return !this.hasPiece(coord);
  }

  getPieceCount(): number {
    return this._pieces.size;
  }

  getAllPieces(): Piece[] {
    return Array.from(this._pieces.values());
  }

  // Board bounds checking
  isInBounds(coord: Vector3 | IVector3): boolean {
    const v = coord instanceof Vector3 ? coord : Vector3.fromObject(coord);
    const halfSize = Math.floor(this.size / 2);
    
    return (
      v.x >= -halfSize && v.x <= halfSize &&
      v.y >= -halfSize && v.y <= halfSize &&
      v.z >= -halfSize && v.z <= halfSize
    );
  }

  // Moore neighborhood (26 neighbors in 3D)
  getNeighbors(coord: Vector3 | IVector3): Vector3[] {
    const center = coord instanceof Vector3 ? coord : Vector3.fromObject(coord);
    const neighbors: Vector3[] = [];

    DIRECTIONS_3D.forEach(dir => {
      const neighbor = center.add(dir);
      if (this.isInBounds(neighbor)) {
        neighbors.push(neighbor);
      }
    });

    return neighbors;
  }

  // Line generation methods
  generateFullLine(start: Vector3 | IVector3, end: Vector3 | IVector3): Line | null {
    const startVec = start instanceof Vector3 ? start : Vector3.fromObject(start);
    const endVec = end instanceof Vector3 ? end : Vector3.fromObject(end);

    // Validate both points are in bounds
    if (!this.isInBounds(startVec) || !this.isInBounds(endVec)) {
      return null;
    }

    // Calculate direction
    const diff = endVec.subtract(startVec);
    
    // Check if points are collinear in a valid 3D direction
    const isValidDirection = DIRECTIONS_3D.some(dir => {
      const scale = this.getScaleFactor(diff, dir);
      return scale !== null && scale > 0;
    });

    if (!isValidDirection) {
      return null;
    }

    // Generate all points on the line
    const coords: Vector3[] = [];
    const direction = this.normalizeDirection(diff);
    let current = startVec.clone();

    while (!current.equals(endVec)) {
      coords.push(current.clone());
      current = current.add(direction);
      
      // Safety check to prevent infinite loops
      if (coords.length > this.size) {
        return null;
      }
    }
    coords.push(endVec);

    return new Line(coords, direction);
  }

  generatePartialLine(
    center: Vector3 | IVector3, 
    direction: Vector3 | IVector3, 
    radius: number = 2
  ): Line {
    const centerVec = center instanceof Vector3 ? center : Vector3.fromObject(center);
    const dirVec = direction instanceof Vector3 ? direction : Vector3.fromObject(direction);

    // Normalize direction to unit vector
    const unitDir = this.normalizeDirection(dirVec);
    const coords: Vector3[] = [];

    // Generate line from -radius to +radius around center
    for (let i = -radius; i <= radius; i++) {
      const point = centerVec.add(unitDir.multiply(i));
      if (this.isInBounds(point)) {
        coords.push(point);
      }
    }

    // Ensure we have at least one coordinate
    if (coords.length === 0) {
      coords.push(centerVec);
    }

    return new Line(coords, unitDir);
  }

  // Get all possible lines of length 5 containing a given coordinate
  getLinesContaining(coord: Vector3 | IVector3, length: number = 5): Line[] {
    const center = coord instanceof Vector3 ? coord : Vector3.fromObject(coord);
    const lines: Line[] = [];

    DIRECTIONS_3D.forEach(dir => {
      // For each direction, generate all possible lines containing the coord
      for (let offset = 0; offset < length; offset++) {
        const start = center.subtract(dir.multiply(offset));
        const end = start.add(dir.multiply(length - 1));

        // Check if line is within bounds
        if (this.isInBounds(start) && this.isInBounds(end)) {
          const line = this.generateFullLine(start, end);
          if (line && line.getLength() === length) {
            lines.push(line);
          }
        }
      }
    });

    return this.removeDuplicateLines(lines);
  }

  // Helper methods
  private normalizeDirection(direction: IVector3): Vector3 {
    // Find the matching unit direction from DIRECTIONS_3D
    for (const dir of DIRECTIONS_3D) {
      const scale = this.getScaleFactor(direction, dir);
      if (scale !== null && scale > 0) {
        return Vector3.fromObject(dir);
      }
    }
    
    // If no exact match, normalize to unit vector
    const vec = Vector3.fromObject(direction);
    const magnitude = Math.max(Math.abs(vec.x), Math.abs(vec.y), Math.abs(vec.z));
    return new Vector3(
      Math.round(vec.x / magnitude),
      Math.round(vec.y / magnitude),
      Math.round(vec.z / magnitude)
    );
  }

  private getScaleFactor(vector: IVector3, unitVector: IVector3): number | null {
    // Check if vector is a scalar multiple of unitVector
    const scales = [
      unitVector.x !== 0 ? vector.x / unitVector.x : null,
      unitVector.y !== 0 ? vector.y / unitVector.y : null,
      unitVector.z !== 0 ? vector.z / unitVector.z : null
    ].filter(s => s !== null);

    // All non-zero scales must be equal
    if (scales.length === 0) return null;
    const firstScale = scales[0];
    
    const allEqual = scales.every(s => Math.abs(s! - firstScale!) < 0.0001);
    return allEqual ? firstScale : null;
  }

  private removeDuplicateLines(lines: Line[]): Line[] {
    const uniqueLines: Line[] = [];
    
    for (const line of lines) {
      const isDuplicate = uniqueLines.some(existing => 
        existing.getStart().equals(line.getStart()) &&
        existing.getEnd().equals(line.getEnd())
      );
      
      if (!isDuplicate) {
        uniqueLines.push(line);
      }
    }
    
    return uniqueLines;
  }

  // Board mutations (return new Board instance)
  placePiece(piece: Piece | IPiece): Board {
    const p = piece instanceof Piece ? piece : Piece.createNormal(piece.coords, piece.player);
    
    if (!this.isInBounds(p.coords)) {
      throw new Error('Piece placement out of bounds');
    }

    if (this.hasPiece(p.coords)) {
      throw new Error('Position already occupied');
    }

    const newBoard = this.clone();
    newBoard._pieces.set(newBoard.coordToKey(p.coords), p);
    return newBoard;
  }

  removePiece(coord: Vector3 | IVector3): Board {
    if (!this.hasPiece(coord)) {
      return this;
    }

    const newBoard = this.clone();
    newBoard._pieces.delete(newBoard.coordToKey(coord));
    return newBoard;
  }

  // Utility methods
  clear(): Board {
    return new Board(this.size);
  }

  equals(other: Board): boolean {
    if (this.size !== other.size) return false;
    if (this._pieces.size !== other._pieces.size) return false;

    for (const [key, piece] of this._pieces) {
      const otherPiece = other._pieces.get(key);
      if (!otherPiece || !piece.equals(otherPiece)) {
        return false;
      }
    }

    return true;
  }

  clone(): Board {
    const newBoard = new Board(this.size);
    this._pieces.forEach((piece, key) => {
      newBoard._pieces.set(key, piece.clone());
    });
    return newBoard;
  }

  toString(): string {
    return `Board(${this.size}x${this.size}x${this.size}, ${this._pieces.size} pieces)`;
  }

  toJSON(): IBoard {
    return {
      size: this.size,
      pieces: this.pieces
    };
  }
}
```

### Step 4: Create WinResult Class
Create `src/core/WinResult.ts`:

```typescript
import { IWinResult, IPlayer, ILine } from '@/types';
import { Player } from './Player';
import { Line } from './Line';

export class WinResult implements IWinResult {
  public readonly winner: Player | null;
  public readonly winningLine: Line | null;
  public readonly winType: 'five-in-a-row' | 'captures' | null;

  constructor(
    winner: Player | IPlayer | null = null,
    winningLine: Line | ILine | null = null,
    winType: 'five-in-a-row' | 'captures' | null = null
  ) {
    this.winner = winner 
      ? (winner instanceof Player ? winner : new Player(winner.id, winner.color, winner.isLocal))
      : null;
    
    this.winningLine = winningLine
      ? (winningLine instanceof Line ? winningLine : new Line(winningLine.coords, winningLine.direction))
      : null;
    
    this.winType = winType;

    // Validate consistency
    if (this.winner && !this.winType) {
      throw new Error('Win result must specify win type');
    }
    if (this.winType === 'five-in-a-row' && !this.winningLine) {
      throw new Error('Five-in-a-row win must include winning line');
    }
  }

  // Factory methods
  static noWin(): WinResult {
    return new WinResult();
  }

  static fiveInARow(winner: Player | IPlayer, line: Line | ILine): WinResult {
    return new WinResult(winner, line, 'five-in-a-row');
  }

  static captures(winner: Player | IPlayer): WinResult {
    return new WinResult(winner, null, 'captures');
  }

  // Query methods
  isWin(): boolean {
    return this.winner !== null;
  }

  isFiveInARow(): boolean {
    return this.winType === 'five-in-a-row';
  }

  isCaptures(): boolean {
    return this.winType === 'captures';
  }

  // Utility methods
  toString(): string {
    if (!this.isWin()) {
      return 'WinResult(no winner)';
    }
    return `WinResult(${this.winner!.id} wins by ${this.winType})`;
  }

  toJSON(): IWinResult {
    return {
      winner: this.winner ? this.winner.toJSON() : null,
      winningLine: this.winningLine ? this.winningLine.toJSON() : null,
      winType: this.winType
    };
  }
}
```

### Step 5: Update Barrel Export
Update `src/core/index.ts`:

```typescript
// Core data structures
export { Vector3 } from './Vector3';
export { Player } from './Player';
export { Move } from './Move';
export { Piece } from './Piece';
export { Board } from './Board';
export { Line } from './Line';
export { WinResult } from './WinResult';

// Re-export types for convenience
export type {
  IVector3,
  IPlayer,
  IMove,
  IPiece,
  IBoard,
  ILine,
  IWinResult,
  PlayerColor,
  PieceType,
  BoardSize,
  Coordinates,
  Direction,
  CoordKey,
} from '@/types';

export { DIRECTIONS_3D } from '@/types';
```

### Step 6: Update Main Entry Point
Update `src/main.ts` to test the new board logic:

```typescript
import './style.css';
import { Vector3, Player, Board, Line } from '@/core';

console.log('Pente3D.ai - Board Logic Testing');

// Test board creation and line generation
const board = Board.createEmpty(7);
const center = Vector3.zero();
const player = Player.createLocal('test', 'black');

// Test Moore neighborhood
const neighbors = board.getNeighbors(center);
console.log(`Center has ${neighbors.length} neighbors`);

// Test line generation
const lineUp = board.generatePartialLine(center, { x: 0, y: 1, z: 0 }, 2);
console.log('Vertical line:', lineUp.toString());

// Test diagonal line
const diagonalEnd = new Vector3(4, 4, 4);
const diagonalLine = board.generateFullLine(center, diagonalEnd);
console.log('Diagonal line:', diagonalLine?.toString());

// Test getting all lines containing a position
const allLines = board.getLinesContaining(center, 5);
console.log(`Found ${allLines.length} possible 5-lines containing center`);

// Basic application bootstrap (same as before)
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const loading = document.getElementById('loading');
  
  if (!canvas) {
    throw new Error('Game canvas element not found');
  }
  
  if (loading) {
    loading.style.display = 'none';
  }
  
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  
  console.log('Pente3D.ai board logic initialized');
});

window.addEventListener('resize', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
});
```

## Validation Checklist
- [ ] Board types defined in `src/types/index.ts`
- [ ] All 26 3D directions properly defined
- [ ] `Line` class with continuity validation
- [ ] `Board` class with 3D grid management
- [ ] Moore neighborhood calculation (26 neighbors)
- [ ] `generateFullLine()` with face-to-face validation
- [ ] `generatePartialLine()` for radius-based lines
- [ ] `getLinesContaining()` for win detection support
- [ ] `WinResult` class for game outcomes
- [ ] Board bounds checking for all operations
- [ ] Immutable board operations (return new instances)
- [ ] Comprehensive coordinate key management
- [ ] TypeScript compilation without errors

## Expected Deliverables
1. Complete 3D board representation with configurable sizes
2. Line generation supporting all 26 3D directions
3. Moore neighborhood calculations for any position
4. Immutable board operations with piece management
5. Win result tracking for game outcomes
6. Efficient coordinate indexing with string keys
7. Comprehensive bounds checking and validation
8. Performance optimized for <1ms line generation

## Common Issues & Solutions

**Issue**: Line generation creates discontinuous lines
**Solution**: Validate each coordinate is exactly one unit away from previous

**Issue**: Moore neighborhood returns wrong number of neighbors
**Solution**: Check bounds validation for edge and corner positions

**Issue**: generateFullLine fails for valid face-to-face lines
**Solution**: Ensure direction normalization handles all 26 unit vectors

**Issue**: Board performance degrades with many pieces
**Solution**: Use Map with string keys for O(1) lookups

**Issue**: Duplicate lines in getLinesContaining
**Solution**: Implement proper line comparison using start/end coordinates

This implementation provides a robust 3D board system ready for game rules and win detection integration.