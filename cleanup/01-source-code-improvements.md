# Source Code Improvements

## 1. Code Duplication Elimination

### 1.1 Event Handling Pattern
**Problem**: Multiple classes reimplement event handling logic
```typescript
// Current: InputHandler.ts and NetworkManager.ts both have:
private listeners = new Map<string, Function[]>();
on(event: string, callback: Function) { /* ... */ }
off(event: string, callback: Function) { /* ... */ }
emit(event: string, data?: any) { /* ... */ }
```

**Solution**: Consistently use EventEmitter base class
```typescript
// Recommended approach:
import { EventEmitter } from '../utils/EventEmitter';

export class InputHandler extends EventEmitter {
  // Remove duplicate event handling code
}
```

### 1.2 Material Creation Pattern
**Problem**: Repeated material creation in Renderer.ts
```typescript
// Lines 257-294: Similar material creation repeated 4+ times
this.blackPieceMaterial = new THREE.MeshPhongMaterial({
  color: this.options.blackPieceColor,
  shininess: 80,
  specular: 0x222222
});
```

**Solution**: Create MaterialFactory
```typescript
class MaterialFactory {
  createPieceMaterial(config: PieceMaterialConfig): THREE.Material {
    return new THREE.MeshPhongMaterial({
      color: config.color,
      shininess: config.shininess || 80,
      specular: config.specular || 0x222222,
      transparent: config.transparent || false,
      opacity: config.opacity || 1.0
    });
  }
}
```

### 1.3 Coordinate Conversion Duplication
**Problem**: Multiple coordinate conversion implementations
- Renderer.ts: `arrayIndexToBoardCoord`, `boardCoordToWorldPos`
- Board.ts: Similar coordinate handling logic

**Solution**: Create unified CoordinateSystem utility
```typescript
// utils/CoordinateSystem.ts
export class CoordinateSystem {
  constructor(private boardSize: number, private cellSize: number) {}
  
  arrayToBoard(index: number): number { /* ... */ }
  boardToWorld(coord: number): number { /* ... */ }
  worldToBoard(pos: number): number { /* ... */ }
  validateCoordinate(coord: number): boolean { /* ... */ }
}
```

## 2. Inconsistent Patterns Resolution

### 2.1 Error Handling Strategy
**Problem**: Different error handling approaches across modules
- Board.ts: Throws errors
- Game.ts: Returns boolean
- NetworkManager.ts: Emits error events

**Solution**: Implement consistent error handling
```typescript
// Define custom error types
export class GameError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

export class InvalidMoveError extends GameError {
  constructor(message: string) {
    super(message, 'INVALID_MOVE');
  }
}

// Use Result<T> pattern for operations
type Result<T> = { success: true; value: T } | { success: false; error: GameError };

// Example usage:
placePiece(position: Vector3): Result<Move> {
  if (!this.isValidPosition(position)) {
    return { success: false, error: new InvalidMoveError('Invalid position') };
  }
  // ...
}
```

### 2.2 Async Pattern Standardization
**Problem**: Mix of Promises, callbacks, and events
**Solution**: Use async/await consistently with typed promises
```typescript
// Standardize on Promises with proper types
interface NetworkOperation<T> {
  execute(): Promise<T>;
  cancel(): void;
}

// Replace callback-based APIs
async connectToPeer(peerId: string): Promise<Connection> {
  try {
    const connection = await this.peer.connect(peerId);
    return connection;
  } catch (error) {
    throw new NetworkError('Connection failed', error);
  }
}
```

## 3. Magic Numbers and Constants

### 3.1 Extract Configuration Constants
**Problem**: Magic numbers throughout codebase
```typescript
// Current scattered magic numbers:
const distance = this.options.boardSize * this.options.cellSize * 2; // What is 2?
if (this.networkGameState.hashChain.length > 50) // Why 50?
```

**Solution**: Create constants file
```typescript
// constants/RenderingConstants.ts
export const RENDERING = {
  CAMERA_DISTANCE_MULTIPLIER: 2,
  MAX_CAMERA_DISTANCE_MULTIPLIER: 4,
  CONTROLS_DAMPING_FACTOR: 0.05,
  CONTROLS_ROTATION_SPEED: 0.5,
  ZOOM_MIN_SPEED: 0.3,
  ZOOM_MAX_SPEED: 10,
} as const;

// constants/NetworkConstants.ts
export const NETWORK = {
  MAX_HASH_CHAIN_LENGTH: 50,
  MAX_LOG_SIZE: 100,
  CONNECTION_TIMEOUT_MS: 30000,
  HEARTBEAT_INTERVAL_MS: 5000,
  ROOM_CODE_CHARS: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
} as const;
```

## 4. Method Complexity Reduction

### 4.1 Break Down Long Methods
**Problem**: Methods exceeding 40 lines with complex logic

**Example**: Renderer.ts `createBoardGrid()` method
```typescript
// Before: 74 lines with triple nested loops
createBoardGrid(): void {
  // ... 74 lines of code ...
}

// After: Break into logical components
createBoardGrid(): void {
  this.gridGroup.clear();
  
  const gridGeometry = this.createGridGeometry();
  const gridMesh = new THREE.LineSegments(gridGeometry, this.gridMaterial);
  this.gridGroup.add(gridMesh);
  
  this.createGridNodes();
  
  if (this.options.showDiagonals) {
    this.addDiagonalLines();
  }
}

private createGridGeometry(): THREE.BufferGeometry {
  const positions = [
    ...this.createXAxisLines(),
    ...this.createYAxisLines(),
    ...this.createZAxisLines()
  ];
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}
```

### 4.2 Extract Complex Conditionals
**Problem**: Nested if-else chains in onClick, handleMoveMessage
```typescript
// Before: Complex nested conditions
if (condition1) {
  if (condition2) {
    if (condition3) {
      // ... deep nesting
    }
  }
}

// After: Early returns and extracted methods
if (!this.isValidGameState()) return;
if (!this.canPlayerMove()) return;

const validatedMove = this.validateMove(position);
if (!validatedMove.success) {
  this.handleInvalidMove(validatedMove.error);
  return;
}

this.executeMove(validatedMove.value);
```

## 5. Separation of Concerns

### 5.1 Split Renderer Responsibilities
**Problem**: Renderer.ts handles too many concerns
- 3D rendering
- Animation
- Input highlighting
- Performance monitoring
- Accessibility

**Solution**: Create focused classes
```typescript
// Separate classes for distinct responsibilities
class SceneRenderer {
  // Core 3D rendering logic
}

class AnimationController {
  // Animation loops and updates
}

class HighlightManager {
  // Visual highlighting logic
}

class CameraController {
  // Camera movement and controls
}

// Facade pattern to coordinate
class GameRenderer {
  constructor(
    private scene: SceneRenderer,
    private animation: AnimationController,
    private highlights: HighlightManager,
    private camera: CameraController
  ) {}
}
```

## 6. Resource Management

### 6.1 Fix Event Listener Cleanup
**Problem**: Creating new function references in removeEventListener
```typescript
// Current problem:
this.canvas.removeEventListener('mousemove', this.onMouseMove.bind(this));
// bind() creates new function, won't remove original

// Solution: Store bound references
class InputHandler {
  private boundHandlers = {
    mouseMove: this.onMouseMove.bind(this),
    mouseDown: this.onMouseDown.bind(this),
    mouseUp: this.onMouseUp.bind(this)
  };
  
  dispose(): void {
    this.canvas.removeEventListener('mousemove', this.boundHandlers.mouseMove);
    // ... other cleanup
  }
}
```

### 6.2 Material and Geometry Disposal
**Problem**: Materials cloned but not disposed
```typescript
// Add proper disposal tracking
class ResourceManager {
  private disposables = new Set<THREE.Material | THREE.Geometry>();
  
  trackResource<T extends THREE.Material | THREE.Geometry>(resource: T): T {
    this.disposables.add(resource);
    return resource;
  }
  
  dispose(): void {
    this.disposables.forEach(resource => resource.dispose());
    this.disposables.clear();
  }
}
```

## 7. Type Safety Improvements

### 7.1 Enable Strict TypeScript
**tsconfig.json** updates:
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### 7.2 Replace 'any' Types
**Problem**: Extensive use of 'any' type
```typescript
// Before:
on(event: string, callback: Function): void
emit(event: string, data?: any): void

// After: Typed events
interface GameEvents {
  move: { move: Move; player: Player };
  gameOver: { winner: Player; winType: WinType };
  stateChange: { newState: GameState; oldState: GameState };
}

class TypedEventEmitter<T extends Record<string, any>> {
  on<K extends keyof T>(event: K, callback: (data: T[K]) => void): void;
  emit<K extends keyof T>(event: K, data: T[K]): void;
}
```

## 8. Design Pattern Implementation

### 8.1 Command Pattern for Game Actions
```typescript
interface GameCommand {
  execute(state: GameState): Result<GameState>;
  undo(state: GameState): Result<GameState>;
  validate(state: GameState): boolean;
}

class PlacePieceCommand implements GameCommand {
  constructor(private position: Vector3, private player: Player) {}
  
  execute(state: GameState): Result<GameState> {
    // Implementation
  }
  
  undo(state: GameState): Result<GameState> {
    // Implementation
  }
}
```

### 8.2 Strategy Pattern for Message Handling
```typescript
interface MessageHandler<T extends NetworkMessage> {
  messageType: MessageType;
  handle(message: T, context: NetworkContext): Promise<void>;
}

class MoveMessageHandler implements MessageHandler<MoveMessage> {
  messageType = MessageType.MOVE;
  
  async handle(message: MoveMessage, context: NetworkContext): Promise<void> {
    // Handle move message
  }
}

// Registry of handlers
class MessageHandlerRegistry {
  private handlers = new Map<MessageType, MessageHandler<any>>();
  
  register(handler: MessageHandler<any>): void {
    this.handlers.set(handler.messageType, handler);
  }
  
  async handle(message: NetworkMessage, context: NetworkContext): Promise<void> {
    const handler = this.handlers.get(message.type);
    if (!handler) throw new Error(`No handler for message type: ${message.type}`);
    await handler.handle(message, context);
  }
}
```

## 9. Performance Optimizations

### 9.1 Object Pooling for Frequent Allocations
```typescript
// Extend ObjectPool usage to more objects
class GeometryPool extends ObjectPool<THREE.BufferGeometry> {
  protected createObject(): THREE.BufferGeometry {
    return new THREE.BufferGeometry();
  }
  
  protected resetObject(geometry: THREE.BufferGeometry): void {
    geometry.deleteAttribute('position');
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
  }
}
```

### 9.2 Memoization for Expensive Calculations
```typescript
class MemoizedCalculations {
  private cache = new Map<string, any>();
  
  getBoardPositionKey(pos: Vector3): string {
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, this.calculateWorldPosition(pos));
    }
    return this.cache.get(key);
  }
}
```

## 10. Logging and Debugging

### 10.1 Replace Console Calls with Logger
```typescript
interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, error?: Error, ...args: any[]): void;
}

class ConsoleLogger implements Logger {
  constructor(private namespace: string) {}
  
  debug(message: string, ...args: any[]): void {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[${this.namespace}] ${message}`, ...args);
    }
  }
}
```

## Implementation Priority

1. **High Priority** (Immediate fixes):
   - Fix event listener cleanup bugs
   - Extract magic numbers to constants
   - Fix material disposal issues

2. **Medium Priority** (Next sprint):
   - Implement consistent error handling
   - Break down complex methods
   - Add TypeScript strict mode

3. **Low Priority** (Long-term refactoring):
   - Implement design patterns
   - Split large classes
   - Add comprehensive logging