# Performance Optimizations

## 1. Rendering Performance

### 1.1 Object Pooling Expansion
**Problem**: Creating/destroying many objects during gameplay
```typescript
// Current: New objects created each frame
const tempVector = new THREE.Vector3();
const tempMatrix = new THREE.Matrix4();
```

**Solution**: Comprehensive object pooling
```typescript
// utils/RenderingPools.ts
class RenderingPools {
  private static vectorPool = new ObjectPool(() => new THREE.Vector3());
  private static matrixPool = new ObjectPool(() => new THREE.Matrix4());
  private static quaternionPool = new ObjectPool(() => new THREE.Quaternion());
  private static colorPool = new ObjectPool(() => new THREE.Color());
  
  static getVector(): PooledObject<THREE.Vector3> {
    return this.vectorPool.acquire();
  }
  
  static getMatrix(): PooledObject<THREE.Matrix4> {
    return this.matrixPool.acquire();
  }
}

// Usage with automatic cleanup
function calculatePosition() {
  using vec = RenderingPools.getVector();
  using mat = RenderingPools.getMatrix();
  
  vec.value.set(1, 2, 3);
  mat.value.makeTranslation(vec.value);
  // Objects automatically returned to pool
}
```

### 1.2 Geometry Instancing
**Problem**: Individual meshes for each piece
```typescript
// Current: 343 draw calls for a full 7x7x7 board
this.piecesGroup.add(new THREE.Mesh(geometry, material));
```

**Solution**: Use instanced rendering
```typescript
class PieceRenderer {
  private blackPieces: THREE.InstancedMesh;
  private whitePieces: THREE.InstancedMesh;
  private matrices: Float32Array;
  
  constructor(maxPieces: number = 500) {
    const geometry = new THREE.SphereGeometry(0.3, 16, 16);
    
    this.blackPieces = new THREE.InstancedMesh(
      geometry,
      this.blackMaterial,
      maxPieces
    );
    
    this.whitePieces = new THREE.InstancedMesh(
      geometry,
      this.whiteMaterial,
      maxPieces
    );
    
    // Pre-allocate matrix buffer
    this.matrices = new Float32Array(maxPieces * 16);
  }
  
  updatePieces(pieces: Piece[]): void {
    let blackCount = 0;
    let whiteCount = 0;
    
    for (const piece of pieces) {
      const matrix = new THREE.Matrix4();
      matrix.setPosition(this.boardToWorld(piece.position));
      
      if (piece.player.color === 'black') {
        matrix.toArray(this.matrices, blackCount * 16);
        blackCount++;
      } else {
        matrix.toArray(this.matrices, whiteCount * 16);
        whiteCount++;
      }
    }
    
    this.blackPieces.count = blackCount;
    this.whitePieces.count = whiteCount;
    this.blackPieces.instanceMatrix.needsUpdate = true;
    this.whitePieces.instanceMatrix.needsUpdate = true;
  }
}
```

### 1.3 Level of Detail (LOD)
**Problem**: Full quality rendering regardless of distance
**Solution**: Implement proper LOD system
```typescript
class BoardLOD {
  private lods: Map<string, THREE.LOD> = new Map();
  
  createPieceLOD(): THREE.LOD {
    const lod = new THREE.LOD();
    
    // High quality (close)
    const highGeo = new THREE.SphereGeometry(0.3, 32, 32);
    lod.addLevel(new THREE.Mesh(highGeo, this.material), 0);
    
    // Medium quality
    const medGeo = new THREE.SphereGeometry(0.3, 16, 16);
    lod.addLevel(new THREE.Mesh(medGeo, this.material), 50);
    
    // Low quality (far)
    const lowGeo = new THREE.SphereGeometry(0.3, 8, 8);
    lod.addLevel(new THREE.Mesh(lowGeo, this.material), 100);
    
    // Billboard (very far)
    const sprite = new THREE.Sprite(this.spriteMaterial);
    lod.addLevel(sprite, 200);
    
    return lod;
  }
}
```

## 2. Memory Management

### 2.1 Texture Atlas
**Problem**: Multiple texture loads for UI elements
**Solution**: Create texture atlases
```typescript
class UITextureAtlas {
  private atlas: THREE.Texture;
  private regions: Map<string, TextureRegion> = new Map();
  
  constructor() {
    // Combine all UI textures into one
    this.createAtlas([
      'button-normal.png',
      'button-hover.png',
      'button-active.png',
      'icons-sprite.png'
    ]);
  }
  
  getRegion(name: string): TextureRegion {
    return this.regions.get(name)!;
  }
  
  applyToMaterial(material: THREE.Material, regionName: string): void {
    const region = this.getRegion(regionName);
    material.map = this.atlas;
    material.map.offset.set(region.u, region.v);
    material.map.repeat.set(region.width, region.height);
  }
}
```

### 2.2 Geometry Sharing
**Problem**: Duplicate geometries
**Solution**: Geometry cache
```typescript
class GeometryCache {
  private static cache = new Map<string, THREE.BufferGeometry>();
  
  static get(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
    if (!this.cache.has(key)) {
      this.cache.set(key, factory());
    }
    return this.cache.get(key)!;
  }
  
  static getSphere(radius: number, segments: number): THREE.BufferGeometry {
    const key = `sphere_${radius}_${segments}`;
    return this.get(key, () => new THREE.SphereGeometry(radius, segments, segments));
  }
  
  static dispose(): void {
    this.cache.forEach(geometry => geometry.dispose());
    this.cache.clear();
  }
}
```

### 2.3 State Object Reuse
**Problem**: Creating new state objects frequently
**Solution**: Immutable.js or object pooling for states
```typescript
// Using Immer for efficient immutable updates
import { produce } from 'immer';

class GameStateManager {
  private statePool = new ObjectPool(() => new GameState());
  
  updateState(current: GameState, update: (draft: GameState) => void): GameState {
    return produce(current, update, (patches) => {
      // Recycle old state objects
      this.recycleOldStates(patches);
    });
  }
  
  // Alternative: Manual pooling
  createState(from: GameState, changes: Partial<GameState>): GameState {
    const newState = this.statePool.acquire();
    Object.assign(newState, from, changes);
    return newState;
  }
}
```

## 3. Computation Optimization

### 3.1 Line Validation Caching
**Problem**: Recalculating winning lines every move
**Solution**: Incremental line updates
```typescript
class LineCache {
  private lineStates: Map<string, LineState> = new Map();
  private dirtyLines: Set<string> = new Set();
  
  markDirty(position: Vector3): void {
    // Only mark lines that pass through this position
    const affectedLines = this.getLinesContaining(position);
    affectedLines.forEach(line => this.dirtyLines.add(line.id));
  }
  
  validateLines(): WinResult | null {
    // Only check dirty lines
    for (const lineId of this.dirtyLines) {
      const result = this.checkLine(lineId);
      if (result) return result;
    }
    
    this.dirtyLines.clear();
    return null;
  }
}
```

### 3.2 Spatial Indexing
**Problem**: O(n) piece lookups
**Solution**: Octree for spatial queries
```typescript
class PieceOctree {
  private octree: Octree<Piece>;
  
  constructor(boardSize: number) {
    this.octree = new Octree({
      min: new Vector3(0, 0, 0),
      max: new Vector3(boardSize, boardSize, boardSize)
    });
  }
  
  addPiece(piece: Piece): void {
    this.octree.insert(piece.position, piece);
  }
  
  getPiecesInRegion(min: Vector3, max: Vector3): Piece[] {
    return this.octree.query({ min, max });
  }
  
  getNearbyPieces(position: Vector3, radius: number): Piece[] {
    return this.octree.queryRadius(position, radius);
  }
}
```

### 3.3 Web Workers for Heavy Computation
**Problem**: Win detection blocking UI
**Solution**: Move to Web Worker
```typescript
// workers/gameLogic.worker.ts
class GameLogicWorker {
  private board: Board;
  private rules: GameRules;
  
  onmessage = (e: MessageEvent) => {
    switch (e.data.type) {
      case 'CHECK_WIN':
        const result = this.rules.checkWinCondition(this.board);
        postMessage({ type: 'WIN_RESULT', result });
        break;
        
      case 'CALCULATE_MOVES':
        const moves = this.calculatePossibleMoves();
        postMessage({ type: 'POSSIBLE_MOVES', moves });
        break;
    }
  };
}

// Main thread
class GameController {
  private worker = new Worker('./workers/gameLogic.worker.js');
  
  async checkWin(): Promise<WinResult | null> {
    return new Promise(resolve => {
      this.worker.onmessage = (e) => {
        if (e.data.type === 'WIN_RESULT') {
          resolve(e.data.result);
        }
      };
      this.worker.postMessage({ type: 'CHECK_WIN' });
    });
  }
}
```

## 4. Network Performance

### 4.1 Message Batching
**Problem**: Many small network messages
**Solution**: Batch messages
```typescript
class NetworkBatcher {
  private pendingMessages: NetworkMessage[] = [];
  private batchTimer?: number;
  private readonly BATCH_DELAY = 16; // One frame
  
  queueMessage(message: NetworkMessage): void {
    this.pendingMessages.push(message);
    
    if (!this.batchTimer) {
      this.batchTimer = window.setTimeout(() => this.flush(), this.BATCH_DELAY);
    }
  }
  
  private flush(): void {
    if (this.pendingMessages.length === 0) return;
    
    const batch: BatchMessage = {
      type: MessageType.BATCH,
      messages: this.pendingMessages,
      timestamp: Date.now()
    };
    
    this.send(batch);
    this.pendingMessages = [];
    this.batchTimer = undefined;
  }
}
```

### 4.2 Delta Compression
**Problem**: Sending full game state
**Solution**: Send only changes
```typescript
class StateDelta {
  static create(oldState: GameState, newState: GameState): StateDelta {
    const delta: any = {};
    
    // Only include changed properties
    if (oldState.moveCount !== newState.moveCount) {
      delta.moveCount = newState.moveCount;
    }
    
    // Diff pieces
    const addedPieces = newState.pieces.filter(p => 
      !oldState.pieces.some(op => op.equals(p))
    );
    const removedPieces = oldState.pieces.filter(p => 
      !newState.pieces.some(np => np.equals(p))
    );
    
    if (addedPieces.length) delta.addedPieces = addedPieces;
    if (removedPieces.length) delta.removedPieces = removedPieces;
    
    return delta;
  }
  
  static apply(state: GameState, delta: StateDelta): GameState {
    const newState = state.clone();
    
    if (delta.moveCount !== undefined) {
      newState.moveCount = delta.moveCount;
    }
    
    if (delta.removedPieces) {
      newState.pieces = newState.pieces.filter(p => 
        !delta.removedPieces.some(rp => rp.equals(p))
      );
    }
    
    if (delta.addedPieces) {
      newState.pieces.push(...delta.addedPieces);
    }
    
    return newState;
  }
}
```

## 5. Asset Loading

### 5.1 Progressive Loading
**Problem**: Loading all assets upfront
**Solution**: Load on demand
```typescript
class AssetLoader {
  private loadingQueue: LoadRequest[] = [];
  private cache = new Map<string, any>();
  
  async loadCritical(): Promise<void> {
    // Load only essential assets
    await Promise.all([
      this.loadTexture('board-texture.jpg'),
      this.loadModel('piece.glb'),
      this.loadSound('move.mp3')
    ]);
  }
  
  async loadSecondary(): Promise<void> {
    // Load in background
    requestIdleCallback(() => {
      this.loadTexture('environment.hdr');
      this.loadSound('victory.mp3');
      this.loadModel('effects.glb');
    });
  }
  
  async loadOnDemand(asset: string): Promise<any> {
    if (this.cache.has(asset)) {
      return this.cache.get(asset);
    }
    
    const loaded = await this.load(asset);
    this.cache.set(asset, loaded);
    return loaded;
  }
}
```

### 5.2 Texture Compression
**Problem**: Large texture files
**Solution**: Use compressed formats
```typescript
class TextureOptimizer {
  async loadOptimizedTexture(path: string): Promise<THREE.Texture> {
    const loader = new THREE.TextureLoader();
    
    // Try WebP first, fallback to JPEG
    const formats = ['.webp', '.jpg', '.png'];
    
    for (const format of formats) {
      try {
        const texture = await loader.loadAsync(path.replace(/\.\w+$/, format));
        
        // Apply optimizations
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        texture.anisotropy = 4; // Reduced from default 16
        
        return texture;
      } catch (e) {
        continue;
      }
    }
    
    throw new Error(`Failed to load texture: ${path}`);
  }
}
```

## 6. Animation Performance

### 6.1 Animation System
**Problem**: Individual animation updates
**Solution**: Centralized animation manager
```typescript
class AnimationManager {
  private animations: Set<Animation> = new Set();
  private rafId?: number;
  
  add(animation: Animation): void {
    this.animations.add(animation);
    this.start();
  }
  
  private update = (timestamp: number) => {
    const deltaTime = timestamp - this.lastTime;
    this.lastTime = timestamp;
    
    // Update all animations in one pass
    for (const animation of this.animations) {
      if (animation.update(deltaTime)) {
        animation.onComplete?.();
        this.animations.delete(animation);
      }
    }
    
    if (this.animations.size > 0) {
      this.rafId = requestAnimationFrame(this.update);
    }
  };
}
```

### 6.2 CSS Animation Offloading
**Problem**: JavaScript animations for UI
**Solution**: Use CSS where possible
```css
/* Use CSS animations for UI elements */
@keyframes pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
}

.temporary-piece {
  animation: pulse 2s infinite;
  will-change: transform;
}

/* Use transform instead of position changes */
.modal-enter {
  transform: translateY(-100%);
  transition: transform 0.3s ease-out;
}

.modal-enter-active {
  transform: translateY(0);
}
```

## 7. Profiling and Monitoring

### 7.1 Performance Metrics Collection
```typescript
class PerformanceCollector {
  private metrics: Map<string, number[]> = new Map();
  
  measure<T>(name: string, fn: () => T): T {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;
    
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(duration);
    
    // Keep only last 100 measurements
    if (this.metrics.get(name)!.length > 100) {
      this.metrics.get(name)!.shift();
    }
    
    return result;
  }
  
  getReport(): PerformanceReport {
    const report: any = {};
    
    for (const [name, durations] of this.metrics) {
      const sorted = [...durations].sort((a, b) => a - b);
      report[name] = {
        avg: durations.reduce((a, b) => a + b) / durations.length,
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
      };
    }
    
    return report;
  }
}
```

## 8. Build-Time Optimizations

### 8.1 Tree Shaking Configuration
```javascript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      treeshake: {
        preset: 'recommended',
        moduleSideEffects: false,
        propertyReadSideEffects: false,
        tryCatchDeoptimization: false,
      }
    }
  }
});
```

### 8.2 Code Splitting Strategy
```typescript
// Lazy load heavy features
const NetworkModal = lazy(() => import('./ui/NetworkModal'));
const SettingsModal = lazy(() => import('./ui/SettingsModal'));
const StatsOverlay = lazy(() => import('./ui/StatsOverlay'));

// Route-based splitting
const routes = {
  '/': () => import('./views/Game'),
  '/tutorial': () => import('./views/Tutorial'),
  '/replays': () => import('./views/Replays'),
};
```

## 9. Performance Budget

### 9.1 Metrics Goals
```javascript
// performance.budget.js
export const PERFORMANCE_BUDGET = {
  // Initial load
  firstContentfulPaint: 1500, // ms
  timeToInteractive: 3000, // ms
  bundleSize: 500 * 1024, // 500KB
  
  // Runtime
  frameRate: 60, // fps
  frameTime: 16.67, // ms
  inputLatency: 100, // ms
  
  // Memory
  heapSize: 50 * 1024 * 1024, // 50MB
  textureMemory: 100 * 1024 * 1024, // 100MB
};
```

## 10. Priority Optimizations

### Critical (Immediate impact)
1. Implement geometry instancing for pieces
2. Add object pooling for vectors/matrices
3. Fix memory leaks in event handlers
4. Enable texture compression

### High (Significant improvement)
1. Web Worker for win detection
2. LOD system for distant objects
3. Network message batching
4. Progressive asset loading

### Medium (Nice to have)
1. Octree spatial indexing
2. Animation system refactor
3. State delta compression
4. CSS animation offloading