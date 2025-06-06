# Documentation and Comments Improvements

## 1. Missing Documentation

### 1.1 API Documentation
**Problem**: No comprehensive API documentation
**Solution**: Generate TypeDoc documentation

```typescript
// typedoc.json
{
  "entryPoints": ["src/index.ts"],
  "out": "docs/api",
  "exclude": ["**/*.test.ts", "**/*.spec.ts"],
  "excludePrivate": true,
  "excludeProtected": false,
  "includeVersion": true,
  "name": "Pente3D API",
  "readme": "README.md",
  "plugin": ["typedoc-plugin-markdown"],
  "theme": "default"
}
```

### 1.2 JSDoc Comments
**Problem**: Inconsistent or missing JSDoc comments
```typescript
// Current: No documentation
export class Board {
  placePiece(piece: Piece): Board {
    // ...
  }
}
```

**Solution**: Comprehensive JSDoc
```typescript
/**
 * Represents the 3D game board for Pente.
 * Manages piece placement and board state.
 * 
 * @example
 * ```typescript
 * const board = new Board(7);
 * const newBoard = board.placePiece(new Piece(player, new Vector3(0, 0, 0)));
 * ```
 */
export class Board {
  /**
   * Places a piece on the board at the specified position.
   * 
   * @param piece - The piece to place on the board
   * @returns A new Board instance with the piece placed
   * @throws {InvalidMoveError} If the position is already occupied
   * @throws {OutOfBoundsError} If the position is outside the board
   * 
   * @example
   * ```typescript
   * const piece = new Piece(blackPlayer, new Vector3(3, 3, 3));
   * const newBoard = board.placePiece(piece);
   * ```
   */
  placePiece(piece: Piece): Board {
    // ...
  }
}
```

### 1.3 README Files
**Problem**: Minimal project README
**Solution**: Comprehensive documentation structure

```markdown
# README.md
# Pente3D

A 3D implementation of the classic Pente board game.

## Features
- 3D game board with full camera controls
- Online multiplayer via WebRTC
- AI opponents (coming soon)
- Customizable themes and settings
- Accessibility features

## Quick Start
\`\`\`bash
npm install
npm run dev
\`\`\`

## Documentation
- [User Guide](./docs/user-guide.md)
- [API Documentation](./docs/api/README.md)
- [Contributing](./docs/CONTRIBUTING.md)
- [Architecture](./docs/ARCHITECTURE.md)

## Development
See [Development Guide](./docs/development/README.md)
```

## 2. Code Comments

### 2.1 Remove Redundant Comments
**Problem**: Comments that repeat the code
```typescript
// Bad: Redundant comment
// Increment the counter
counter++;

// Set the name to the provided value
this.name = name;
```

**Solution**: Remove obvious comments, add valuable ones
```typescript
// Good: Explains why, not what
// Increment by 2 for alternating player turns
counter += 2;

// Cache the normalized name for case-insensitive comparison
this.name = name.toLowerCase().trim();
```

### 2.2 Complex Algorithm Documentation
**Problem**: Complex algorithms without explanation
```typescript
// Current: No explanation
generateAllLines(): Line[] {
  const lines: Line[] = [];
  // Complex nested loops...
}
```

**Solution**: Document the algorithm
```typescript
/**
 * Generates all possible winning lines in 3D space.
 * 
 * Algorithm:
 * 1. Generate axis-aligned lines (X, Y, Z)
 * 2. Generate 2D diagonals on each plane (XY, XZ, YZ)
 * 3. Generate 3D diagonals through the cube
 * 4. Generate skew diagonals (non-face diagonals)
 * 
 * Total lines for NxNxN board: 
 * - Axis lines: 3N²
 * - Face diagonals: 6N
 * - Space diagonals: 4
 * - Skew diagonals: 8(N-2)
 * 
 * @returns Array of all possible winning lines
 */
generateAllLines(): Line[] {
  const lines: Line[] = [];
  
  // Axis-aligned lines (parallel to X, Y, or Z axis)
  this.generateAxisLines(lines);
  
  // 2D diagonals on each face
  this.generateFaceDiagonals(lines);
  
  // 3D diagonals through the cube
  this.generateSpaceDiagonals(lines);
  
  // Skew diagonals (harder to visualize)
  this.generateSkewDiagonals(lines);
  
  return lines;
}
```

### 2.3 TODO Comments
**Problem**: Vague or outdated TODOs
```typescript
// TODO: Fix this
// TODO: Optimize
// FIXME: Sometimes breaks
```

**Solution**: Actionable TODOs with context
```typescript
// TODO(#123): Optimize line generation for boards > 10x10x10
// Performance degrades exponentially with board size
// Consider caching or lazy generation

// TODO(@username): Add validation for negative coordinates
// Currently assumes all coordinates are positive
// Ticket: PENTE-456

// DEPRECATED: Use Board.placePiece() instead
// Will be removed in v2.0.0
```

## 3. User Documentation

### 3.1 User Guide
```markdown
# docs/user-guide.md
# Pente3D User Guide

## Getting Started
### Basic Controls
- **Left Click**: Place a piece
- **Right Drag**: Rotate the board
- **Scroll**: Zoom in/out
- **Middle Drag**: Pan the view

### Game Rules
Pente is a strategy game where players aim to:
1. Place 5 pieces in a row (any direction in 3D)
2. OR capture 5 pairs of opponent pieces

### Keyboard Shortcuts
- `T`: Enter temporary piece mode
- `Enter`: Confirm temporary piece
- `Ctrl+Z`: Undo last move
- `H`: Show help
```

### 3.2 Feature Documentation
```markdown
# docs/features/temporary-pieces.md
# Temporary Pieces Feature

## Overview
Temporary pieces allow you to visualize potential moves before committing.

## How to Use
1. Press `T` to enter temporary mode
2. Click on any valid position
3. The piece appears semi-transparent
4. Press `Enter` to confirm or `T` to cancel

## Use Cases
- Planning ahead
- Teaching new players
- Analyzing positions
```

## 4. Architecture Documentation

### 4.1 System Architecture
```markdown
# docs/ARCHITECTURE.md
# Pente3D Architecture

## Overview
Pente3D follows a modular architecture with clear separation of concerns.

## Core Modules

### Game Core (`/src/core`)
Handles game logic, rules, and state management.
- **Board**: 3D board representation
- **Game**: Game controller and state machine
- **GameRules**: Win detection and move validation

### Rendering (`/src/rendering`)
Manages 3D visualization using Three.js.
- **Renderer**: Main rendering pipeline
- **QualityManager**: Dynamic quality adjustment
- **AnimationController**: Smooth transitions

### Networking (`/src/network`)
Peer-to-peer multiplayer using WebRTC.
- **NetworkManager**: Connection management
- **ConflictResolver**: Handle simultaneous moves

## Data Flow
\`\`\`
User Input → InputHandler → Game Core → State Update
                                ↓
                          Network Sync
                                ↓
                   Renderer ← Board State
\`\`\`
```

### 4.2 Module Documentation
```markdown
# docs/modules/game-core.md
# Game Core Module

## Purpose
The game core module contains all game logic independent of rendering or UI.

## Key Classes

### Board
- Immutable 3D board representation
- Efficient piece lookup using coordinate keys
- Copy-on-write for state updates

### Game
- High-level game controller
- Manages game flow and rules
- Handles undo/redo functionality

## Design Decisions
- **Immutability**: All state changes create new objects
- **Event-Driven**: Components communicate via events
- **Pure Functions**: Game logic is side-effect free
```

## 5. Development Documentation

### 5.1 Contributing Guide
```markdown
# docs/CONTRIBUTING.md
# Contributing to Pente3D

## Getting Started
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Code Standards
- Use TypeScript strict mode
- Follow ESLint rules
- Write tests for new features
- Document public APIs

## Commit Messages
Follow conventional commits:
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation
- `test:` Test additions
- `refactor:` Code refactoring
```

### 5.2 Testing Guide
```markdown
# docs/development/testing.md
# Testing Guide

## Test Structure
- `unit/` - Isolated component tests
- `integration/` - Module interaction tests
- `e2e/` - User scenario tests

## Writing Tests
### Unit Tests
\`\`\`typescript
describe('Board', () => {
  describe('placePiece', () => {
    it('should place a piece at valid position', () => {
      // Arrange
      const board = new Board(7);
      const piece = new Piece(player, new Vector3(0, 0, 0));
      
      // Act
      const newBoard = board.placePiece(piece);
      
      // Assert
      expect(newBoard.getPieceAt(0, 0, 0)).toBe(piece);
    });
  });
});
\`\`\`

### E2E Tests
Always use helper functions:
\`\`\`typescript
test('player can place piece', async ({ page }) => {
  const game = createGameHelpers(page);
  await game.clickGridNode(3, 3, 3);
  await game.validatePieceAt(3, 3, 3, 'black');
});
\`\`\`
```

## 6. Inline Documentation Standards

### 6.1 File Headers
```typescript
/**
 * @fileoverview Board class implementation for 3D Pente game.
 * Manages the game board state and piece positions.
 * 
 * @module core/Board
 * @requires core/Piece
 * @requires core/Vector3
 */
```

### 6.2 Interface Documentation
```typescript
/**
 * Configuration options for the renderer.
 * 
 * @interface RendererOptions
 * @property {HTMLCanvasElement} canvas - Target canvas element
 * @property {number} [boardSize=7] - Board dimension (NxNxN)
 * @property {number} [cellSize=1] - Size of each grid cell
 * @property {boolean} [antialias=true] - Enable antialiasing
 * 
 * @example
 * ```typescript
 * const options: RendererOptions = {
 *   canvas: document.getElementById('game-canvas'),
 *   boardSize: 9,
 *   antialias: false
 * };
 * ```
 */
export interface RendererOptions {
  canvas: HTMLCanvasElement;
  boardSize?: number;
  cellSize?: number;
  antialias?: boolean;
}
```

### 6.3 Error Documentation
```typescript
/**
 * Thrown when attempting to place a piece at an invalid position.
 * 
 * @class InvalidMoveError
 * @extends {GameError}
 * 
 * @example
 * ```typescript
 * try {
 *   board.placePiece(piece);
 * } catch (error) {
 *   if (error instanceof InvalidMoveError) {
 *     console.log('Invalid move:', error.message);
 *   }
 * }
 * ```
 */
export class InvalidMoveError extends GameError {
  constructor(message: string, public position: Vector3) {
    super(message, 'INVALID_MOVE');
  }
}
```

## 7. Documentation Generation

### 7.1 API Docs Script
```json
// package.json
{
  "scripts": {
    "docs:api": "typedoc",
    "docs:serve": "serve docs",
    "docs:build": "run-s docs:api docs:diagrams",
    "docs:diagrams": "node scripts/generate-diagrams.js"
  }
}
```

### 7.2 Diagram Generation
```javascript
// scripts/generate-diagrams.js
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function generateDiagrams() {
  const diagrams = [
    'planning/class-diagrams.gv',
    'docs/architecture/data-flow.gv',
    'docs/architecture/module-deps.gv'
  ];
  
  for (const diagram of diagrams) {
    await execAsync(`dot -Tpng ${diagram} -o ${diagram.replace('.gv', '.png')}`);
  }
}
```

## 8. Documentation Maintenance

### 8.1 Documentation Checklist
- [ ] Public APIs have JSDoc comments
- [ ] Complex algorithms are explained
- [ ] README is up to date
- [ ] Examples work with current code
- [ ] Architecture diagrams match implementation
- [ ] User guide covers all features
- [ ] Development guide is current
- [ ] CHANGELOG is updated

### 8.2 Documentation Review Process
1. Code changes require doc updates
2. Doc changes require example testing
3. Major changes update architecture docs
4. Release includes documentation review

## 9. Priority Documentation Tasks

### High Priority
1. Add JSDoc to all public APIs
2. Create user guide with screenshots
3. Document keyboard shortcuts
4. Write getting started guide

### Medium Priority
1. Architecture diagrams
2. Network protocol documentation
3. Performance tuning guide
4. Accessibility features guide

### Low Priority
1. Historical design decisions
2. Algorithm complexity analysis
3. Comparative analysis with 2D Pente