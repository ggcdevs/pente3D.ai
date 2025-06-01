# Chunk 1.1: Basic Data Structures - Development Guide

## Overview
Implement the fundamental data structures that form the foundation of the Pente3D game logic. This chunk creates robust, typed classes for Vector3D coordinates, Players, Moves, and Pieces with comprehensive validation and testing.

## Prerequisites
- Chunk 0.1 (Project Infrastructure) completed and tested
- All build tools working correctly
- TypeScript path mapping functional

## Step-by-Step Implementation

### Step 1: Create Type Definitions
Create `src/types/index.ts` with core interfaces and enums:

```typescript
// Core game types
export type PlayerColor = 'black' | 'white';
export type PieceType = 'normal' | 'temporary';

// Game state types
export interface IVector3 {
  x: number;
  y: number;
  z: number;
}

export interface IPlayer {
  id: string;
  color: PlayerColor;
  isLocal: boolean;
  captures: number;
}

export interface IMove {
  coords: IVector3;
  player: IPlayer;
  timestamp: number;
  capturedPieces: IVector3[];
}

export interface IPiece {
  coords: IVector3;
  player: IPlayer;
  isTemporary: boolean;
}

// Utility types
export type Coordinates = [number, number, number];
export type Direction = IVector3;
```

### Step 2: Implement Vector3 Class
Create `src/core/Vector3.ts`:

```typescript
import { IVector3, Coordinates } from '@/types';

export class Vector3 implements IVector3 {
  public readonly x: number;
  public readonly y: number;
  public readonly z: number;

  constructor(x: number, y: number, z: number) {
    // Validate inputs
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error('Vector3 coordinates must be finite numbers');
    }
    
    this.x = Math.round(x);
    this.y = Math.round(y);
    this.z = Math.round(z);
  }

  // Factory methods
  static fromArray(coords: Coordinates): Vector3 {
    return new Vector3(coords[0], coords[1], coords[2]);
  }

  static fromObject(obj: IVector3): Vector3 {
    return new Vector3(obj.x, obj.y, obj.z);
  }

  static zero(): Vector3 {
    return new Vector3(0, 0, 0);
  }

  // Comparison methods
  equals(other: Vector3 | IVector3): boolean {
    return this.x === other.x && this.y === other.y && this.z === other.z;
  }

  // Arithmetic operations (immutable)
  add(other: Vector3 | IVector3): Vector3 {
    return new Vector3(this.x + other.x, this.y + other.y, this.z + other.z);
  }

  subtract(other: Vector3 | IVector3): Vector3 {
    return new Vector3(this.x - other.x, this.y - other.y, this.z - other.z);
  }

  multiply(scalar: number): Vector3 {
    if (!Number.isFinite(scalar)) {
      throw new Error('Scalar must be a finite number');
    }
    return new Vector3(this.x * scalar, this.y * scalar, this.z * scalar);
  }

  // Utility methods
  distance(other: Vector3 | IVector3): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    const dz = this.z - other.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  normalize(): Vector3 {
    const mag = this.magnitude();
    if (mag === 0) {
      return Vector3.zero();
    }
    return this.multiply(1 / mag);
  }

  // Conversion methods
  toArray(): Coordinates {
    return [this.x, this.y, this.z];
  }

  toString(): string {
    return `Vector3(${this.x}, ${this.y}, ${this.z})`;
  }

  toJSON(): IVector3 {
    return { x: this.x, y: this.y, z: this.z };
  }

  // Immutability
  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }
}
```

### Step 3: Implement Player Class
Create `src/core/Player.ts`:

```typescript
import { IPlayer, PlayerColor } from '@/types';

export class Player implements IPlayer {
  public readonly id: string;
  public readonly color: PlayerColor;
  public readonly isLocal: boolean;
  private _captures: number;
  public readonly connectionId?: string;

  constructor(
    id: string, 
    color: PlayerColor, 
    isLocal: boolean = true,
    connectionId?: string
  ) {
    // Validation
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('Player ID must be a non-empty string');
    }
    
    if (!['black', 'white'].includes(color)) {
      throw new Error('Player color must be "black" or "white"');
    }

    this.id = id.trim();
    this.color = color;
    this.isLocal = isLocal;
    this._captures = 0;
    this.connectionId = connectionId;
  }

  // Factory methods
  static createLocal(id: string, color: PlayerColor): Player {
    return new Player(id, color, true);
  }

  static createRemote(id: string, color: PlayerColor, connectionId: string): Player {
    return new Player(id, color, false, connectionId);
  }

  // Getters
  get captures(): number {
    return this._captures;
  }

  // Game actions
  incrementCaptures(amount: number = 1): Player {
    if (amount < 0) {
      throw new Error('Capture increment must be non-negative');
    }
    
    const newPlayer = this.clone();
    newPlayer._captures = this._captures + amount;
    return newPlayer;
  }

  resetCaptures(): Player {
    const newPlayer = this.clone();
    newPlayer._captures = 0;
    return newPlayer;
  }

  // Network status
  isConnected(): boolean {
    if (this.isLocal) {
      return true;
    }
    return !!this.connectionId;
  }

  // Utility methods
  equals(other: Player | IPlayer): boolean {
    return this.id === other.id && this.color === other.color;
  }

  toString(): string {
    return `Player(${this.id}, ${this.color}, captures: ${this.captures})`;
  }

  toJSON(): IPlayer {
    return {
      id: this.id,
      color: this.color,
      isLocal: this.isLocal,
      captures: this.captures,
    };
  }

  // Immutability
  clone(): Player {
    const cloned = new Player(this.id, this.color, this.isLocal, this.connectionId);
    cloned._captures = this._captures;
    return cloned;
  }
}
```

### Step 4: Implement Move Class
Create `src/core/Move.ts`:

```typescript
import { IMove, IVector3, IPlayer } from '@/types';
import { Vector3 } from './Vector3';
import { Player } from './Player';

export class Move implements IMove {
  public readonly coords: Vector3;
  public readonly player: Player;
  public readonly timestamp: number;
  public readonly capturedPieces: Vector3[];

  constructor(
    coords: Vector3 | IVector3,
    player: Player | IPlayer,
    capturedPieces: (Vector3 | IVector3)[] = [],
    timestamp?: number
  ) {
    // Validation
    if (!coords) {
      throw new Error('Move coordinates are required');
    }
    
    if (!player) {
      throw new Error('Move player is required');
    }

    // Convert to our types
    this.coords = coords instanceof Vector3 ? coords : Vector3.fromObject(coords);
    this.player = player instanceof Player ? player : new Player(
      player.id, 
      player.color, 
      player.isLocal
    );
    
    this.capturedPieces = capturedPieces.map(piece => 
      piece instanceof Vector3 ? piece : Vector3.fromObject(piece)
    );
    
    this.timestamp = timestamp || Date.now();

    // Validate captured pieces
    if (this.capturedPieces.length > 0 && this.capturedPieces.length % 2 !== 0) {
      throw new Error('Captured pieces must be in pairs');
    }
  }

  // Factory methods
  static createSimple(coords: Vector3 | IVector3, player: Player | IPlayer): Move {
    return new Move(coords, player);
  }

  static createCapture(
    coords: Vector3 | IVector3, 
    player: Player | IPlayer,
    capturedPieces: (Vector3 | IVector3)[]
  ): Move {
    return new Move(coords, player, capturedPieces);
  }

  // Utility methods
  isCapture(): boolean {
    return this.capturedPieces.length > 0;
  }

  getCaptureCount(): number {
    return this.capturedPieces.length;
  }

  getCoords(): Vector3 {
    return this.coords;
  }

  getPlayer(): Player {
    return this.player;
  }

  // Validation
  isValid(): boolean {
    try {
      // Basic validation
      if (!this.coords || !this.player) {
        return false;
      }

      // Timestamp validation
      if (this.timestamp <= 0 || this.timestamp > Date.now() + 1000) {
        return false;
      }

      // Capture validation
      if (this.capturedPieces.length % 2 !== 0) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  // Comparison
  equals(other: Move | IMove): boolean {
    return (
      this.coords.equals(other.coords) &&
      this.player.equals(other.player) &&
      this.timestamp === other.timestamp &&
      this.capturedPieces.length === other.capturedPieces.length &&
      this.capturedPieces.every((piece, index) => 
        piece.equals(other.capturedPieces[index])
      )
    );
  }

  toString(): string {
    const captureInfo = this.isCapture() ? ` (captures ${this.getCaptureCount()})` : '';
    return `Move(${this.coords.toString()}, ${this.player.id}${captureInfo})`;
  }

  toJSON(): IMove {
    return {
      coords: this.coords.toJSON(),
      player: this.player.toJSON(),
      timestamp: this.timestamp,
      capturedPieces: this.capturedPieces.map(piece => piece.toJSON()),
    };
  }

  // Immutability
  clone(): Move {
    return new Move(
      this.coords.clone(),
      this.player.clone(),
      this.capturedPieces.map(piece => piece.clone()),
      this.timestamp
    );
  }
}
```

### Step 5: Implement Piece Class
Create `src/core/Piece.ts`:

```typescript
import { IPiece, IVector3, IPlayer, PieceType } from '@/types';
import { Vector3 } from './Vector3';
import { Player } from './Player';

export class Piece implements IPiece {
  public readonly coords: Vector3;
  public readonly player: Player;
  public readonly isTemporary: boolean;
  public readonly placedAt: number;

  constructor(
    coords: Vector3 | IVector3,
    player: Player | IPlayer,
    isTemporary: boolean = false,
    placedAt?: number
  ) {
    // Validation
    if (!coords) {
      throw new Error('Piece coordinates are required');
    }
    
    if (!player) {
      throw new Error('Piece player is required');
    }

    // Convert to our types
    this.coords = coords instanceof Vector3 ? coords : Vector3.fromObject(coords);
    this.player = player instanceof Player ? player : new Player(
      player.id, 
      player.color, 
      player.isLocal
    );
    
    this.isTemporary = isTemporary;
    this.placedAt = placedAt || Date.now();
  }

  // Factory methods
  static createNormal(coords: Vector3 | IVector3, player: Player | IPlayer): Piece {
    return new Piece(coords, player, false);
  }

  static createTemporary(coords: Vector3 | IVector3, player: Player | IPlayer): Piece {
    return new Piece(coords, player, true);
  }

  // Getters
  getCoords(): Vector3 {
    return this.coords;
  }

  getPlayer(): Player {
    return this.player;
  }

  getType(): PieceType {
    return this.isTemporary ? 'temporary' : 'normal';
  }

  // State queries
  isPermanent(): boolean {
    return !this.isTemporary;
  }

  belongsTo(player: Player | IPlayer): boolean {
    return this.player.equals(player);
  }

  isAt(coords: Vector3 | IVector3): boolean {
    return this.coords.equals(coords);
  }

  // Transformations
  makeTemporary(): Piece {
    if (this.isTemporary) {
      return this;
    }
    return new Piece(this.coords, this.player, true, this.placedAt);
  }

  makePermanent(): Piece {
    if (!this.isTemporary) {
      return this;
    }
    return new Piece(this.coords, this.player, false, Date.now());
  }

  moveTo(newCoords: Vector3 | IVector3): Piece {
    const coords = newCoords instanceof Vector3 ? newCoords : Vector3.fromObject(newCoords);
    return new Piece(coords, this.player, this.isTemporary, this.placedAt);
  }

  // Validation
  isValid(): boolean {
    try {
      // Basic validation
      if (!this.coords || !this.player) {
        return false;
      }

      // Timestamp validation
      if (this.placedAt <= 0 || this.placedAt > Date.now() + 1000) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  // Comparison
  equals(other: Piece | IPiece): boolean {
    return (
      this.coords.equals(other.coords) &&
      this.player.equals(other.player) &&
      this.isTemporary === other.isTemporary
    );
  }

  toString(): string {
    const type = this.isTemporary ? 'temporary' : 'permanent';
    return `Piece(${this.coords.toString()}, ${this.player.id}, ${type})`;
  }

  toJSON(): IPiece {
    return {
      coords: this.coords.toJSON(),
      player: this.player.toJSON(),
      isTemporary: this.isTemporary,
    };
  }

  // Immutability
  clone(): Piece {
    return new Piece(
      this.coords.clone(),
      this.player.clone(),
      this.isTemporary,
      this.placedAt
    );
  }
}
```

### Step 6: Create Barrel Export
Create `src/core/index.ts`:

```typescript
// Core data structures
export { Vector3 } from './Vector3';
export { Player } from './Player';
export { Move } from './Move';
export { Piece } from './Piece';

// Re-export types for convenience
export type {
  IVector3,
  IPlayer,
  IMove,
  IPiece,
  PlayerColor,
  PieceType,
  Coordinates,
  Direction,
} from '@/types';
```

### Step 7: Update Main Entry Point
Update `src/main.ts` to test the new classes:

```typescript
import './style.css';
import { testValue } from '@/utils/test';
import { Vector3, Player, Move, Piece } from '@/core';

console.log('Pente3D.ai initializing...');
console.log(testValue);

// Test basic data structures
const testVector = new Vector3(1, 2, 3);
const testPlayer = Player.createLocal('player1', 'black');
const testMove = Move.createSimple(testVector, testPlayer);
const testPiece = Piece.createNormal(testVector, testPlayer);

console.log('Data structures loaded:', {
  vector: testVector.toString(),
  player: testPlayer.toString(),
  move: testMove.toString(),
  piece: testPiece.toString(),
});

// Basic application bootstrap
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const loading = document.getElementById('loading');
  
  if (!canvas) {
    throw new Error('Game canvas element not found');
  }
  
  // Hide loading indicator
  if (loading) {
    loading.style.display = 'none';
  }
  
  // Basic canvas setup
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  
  console.log('Pente3D.ai initialized successfully');
});

// Handle window resize
window.addEventListener('resize', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
});
```

## Validation Checklist
- [ ] All TypeScript interfaces defined in `src/types/index.ts`
- [ ] `Vector3` class with arithmetic operations and validation
- [ ] `Player` class with capture tracking and immutability
- [ ] `Move` class with capture validation and timestamps
- [ ] `Piece` class with temporary/permanent states
- [ ] Barrel export in `src/core/index.ts`
- [ ] Main entry point updated to test classes
- [ ] All classes are immutable (return new instances)
- [ ] Comprehensive error handling and validation
- [ ] TypeScript compilation passes without errors
- [ ] Classes integrate well together

## Expected Deliverables
1. Complete type definitions for core game objects
2. Robust Vector3 class with 3D mathematics
3. Player class with capture tracking and network support
4. Move class with capture validation and immutability
5. Piece class with temporary/permanent state management
6. All classes properly tested and validated
7. Clean barrel exports for easy importing
8. TypeScript strict mode compliance

## Common Issues & Solutions

**Issue**: TypeScript path mapping not resolving
**Solution**: Ensure `@/types` and `@/core` paths are configured in both `tsconfig.json` and `vite.config.ts`

**Issue**: Circular dependency between classes
**Solution**: Keep dependencies one-way: Vector3 → Player → Move/Piece

**Issue**: Immutability not maintained
**Solution**: Always return new instances from methods, never mutate existing objects

**Issue**: Validation errors in constructors
**Solution**: Validate all inputs and provide clear error messages for debugging

This implementation provides a solid foundation of immutable, well-typed data structures ready for game logic integration.