# Chunk 2.1: Three.js Scene Setup - Development Guide

## Overview
This chunk implements the 3D rendering foundation using Three.js, creating the visual representation of the Pente3D game board and pieces.

## Prerequisites
- Completed Chunk 1.4 (Game Controller)
- Three.js installed via npm
- WebGL-capable browser for testing

## Implementation Steps

### 1. Create Renderer Class

**File**: `src/rendering/Renderer.ts`

```typescript
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { Board } from '@/core/Board';
import { Vector3 } from '@/core/Vector3';
import { Piece } from '@/core/Piece';
import { Player } from '@/core/Player';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  boardSize?: number;
  cellSize?: number;
  pieceSize?: number;
  backgroundColor?: number;
  gridColor?: number;
  blackPieceColor?: number;
  whitePieceColor?: number;
  temporaryOpacity?: number;
  antialias?: boolean;
}

export class Renderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private board: Board | null = null;
  
  // Rendering groups
  private gridGroup: THREE.Group;
  private piecesGroup: THREE.Group;
  private temporaryPiecesGroup: THREE.Group;
  
  // Materials
  private gridMaterial: THREE.LineBasicMaterial;
  private nodeMaterial: THREE.MeshBasicMaterial;
  private blackPieceMaterial: THREE.MeshPhongMaterial;
  private whitePieceMaterial: THREE.MeshPhongMaterial;
  private temporaryBlackMaterial: THREE.MeshPhongMaterial;
  private temporaryWhiteMaterial: THREE.MeshPhongMaterial;
  
  // Geometries (shared for performance)
  private pieceGeometry: THREE.SphereGeometry;
  private nodeGeometry: THREE.SphereGeometry;
  
  // Options
  private options: Required<RendererOptions>;
  
  // Animation
  private animationId: number | null = null;
  
  constructor(options: RendererOptions) {
    // Set default options
    this.options = {
      canvas: options.canvas,
      boardSize: options.boardSize ?? 7,
      cellSize: options.cellSize ?? 1,
      pieceSize: options.pieceSize ?? 0.4,
      backgroundColor: options.backgroundColor ?? 0x1a1a1a,
      gridColor: options.gridColor ?? 0x444444,
      blackPieceColor: options.blackPieceColor ?? 0x000000,
      whitePieceColor: options.whitePieceColor ?? 0xffffff,
      temporaryOpacity: options.temporaryOpacity ?? 0.5,
      antialias: options.antialias ?? true
    };
    
    // Initialize Three.js components
    this.initializeScene();
    this.initializeCamera();
    this.initializeRenderer();
    this.initializeControls();
    this.initializeLighting();
    this.initializeMaterials();
    this.initializeGeometries();
    this.initializeGroups();
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Initial render
    this.render();
  }
  
  private initializeScene(): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.options.backgroundColor);
  }
  
  private initializeCamera(): void {
    const aspect = this.options.canvas.clientWidth / this.options.canvas.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    
    // Position camera to view the board
    const distance = this.options.boardSize * this.options.cellSize * 2;
    this.camera.position.set(distance, distance, distance);
    this.camera.lookAt(0, 0, 0);
  }
  
  private initializeRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.options.canvas,
      antialias: this.options.antialias
    });
    
    this.renderer.setSize(
      this.options.canvas.clientWidth,
      this.options.canvas.clientHeight
    );
    
    this.renderer.setPixelRatio(window.devicePixelRatio);
  }
  
  private initializeControls(): void {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    
    // Configure controls
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = this.options.boardSize * this.options.cellSize;
    this.controls.maxDistance = this.options.boardSize * this.options.cellSize * 4;
    
    // Set rotation limits
    this.controls.maxPolarAngle = Math.PI * 0.9;
    this.controls.minPolarAngle = Math.PI * 0.1;
  }
  
  private initializeLighting(): void {
    // Ambient light for overall illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    
    // Directional light for shadows and depth
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight.position.set(10, 10, 10);
    this.scene.add(directionalLight);
    
    // Additional light from below for better visibility
    const bottomLight = new THREE.DirectionalLight(0xffffff, 0.2);
    bottomLight.position.set(-10, -10, -10);
    this.scene.add(bottomLight);
  }
  
  private initializeMaterials(): void {
    // Grid material
    this.gridMaterial = new THREE.LineBasicMaterial({
      color: this.options.gridColor,
      opacity: 0.5,
      transparent: true
    });
    
    // Node material (intersection points)
    this.nodeMaterial = new THREE.MeshBasicMaterial({
      color: this.options.gridColor,
      opacity: 0.3,
      transparent: true
    });
    
    // Piece materials
    this.blackPieceMaterial = new THREE.MeshPhongMaterial({
      color: this.options.blackPieceColor,
      specular: 0x222222,
      shininess: 50
    });
    
    this.whitePieceMaterial = new THREE.MeshPhongMaterial({
      color: this.options.whitePieceColor,
      specular: 0xffffff,
      shininess: 80
    });
    
    // Temporary piece materials
    this.temporaryBlackMaterial = new THREE.MeshPhongMaterial({
      color: this.options.blackPieceColor,
      specular: 0x222222,
      shininess: 50,
      opacity: this.options.temporaryOpacity,
      transparent: true
    });
    
    this.temporaryWhiteMaterial = new THREE.MeshPhongMaterial({
      color: this.options.whitePieceColor,
      specular: 0xffffff,
      shininess: 80,
      opacity: this.options.temporaryOpacity,
      transparent: true
    });
  }
  
  private initializeGeometries(): void {
    // Piece geometry (sphere)
    this.pieceGeometry = new THREE.SphereGeometry(
      this.options.pieceSize,
      16,
      16
    );
    
    // Node geometry (small sphere)
    this.nodeGeometry = new THREE.SphereGeometry(
      this.options.pieceSize * 0.2,
      8,
      8
    );
  }
  
  private initializeGroups(): void {
    // Create groups for organization
    this.gridGroup = new THREE.Group();
    this.piecesGroup = new THREE.Group();
    this.temporaryPiecesGroup = new THREE.Group();
    
    // Add groups to scene
    this.scene.add(this.gridGroup);
    this.scene.add(this.piecesGroup);
    this.scene.add(this.temporaryPiecesGroup);
  }
  
  private setupEventListeners(): void {
    // Handle window resize
    window.addEventListener('resize', this.handleResize.bind(this));
    
    // Handle control changes
    this.controls.addEventListener('change', () => {
      if (!this.animationId) {
        this.render();
      }
    });
  }
  
  private handleResize(): void {
    const canvas = this.options.canvas;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    
    // Update camera aspect ratio
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    
    // Update renderer size
    this.renderer.setSize(width, height);
    
    // Re-render
    this.render();
  }
  
  // Public methods
  
  setBoard(board: Board): void {
    this.board = board;
    this.createBoardGrid();
    this.updatePieces();
  }
  
  private createBoardGrid(): void {
    // Clear existing grid
    this.gridGroup.clear();
    
    const size = this.options.boardSize;
    const cellSize = this.options.cellSize;
    const halfSize = (size - 1) * cellSize / 2;
    
    // Create grid lines
    const gridLines = new THREE.BufferGeometry();
    const positions: number[] = [];
    
    // X-axis lines (across all Y and Z)
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        positions.push(
          -halfSize, y * cellSize - halfSize, z * cellSize - halfSize,
          halfSize, y * cellSize - halfSize, z * cellSize - halfSize
        );
      }
    }
    
    // Y-axis lines (across all X and Z)
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        positions.push(
          x * cellSize - halfSize, -halfSize, z * cellSize - halfSize,
          x * cellSize - halfSize, halfSize, z * cellSize - halfSize
        );
      }
    }
    
    // Z-axis lines (across all X and Y)
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        positions.push(
          x * cellSize - halfSize, y * cellSize - halfSize, -halfSize,
          x * cellSize - halfSize, y * cellSize - halfSize, halfSize
        );
      }
    }
    
    gridLines.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );
    
    const lines = new THREE.LineSegments(gridLines, this.gridMaterial);
    this.gridGroup.add(lines);
    
    // Create node spheres at intersections
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        for (let z = 0; z < size; z++) {
          const node = new THREE.Mesh(this.nodeGeometry, this.nodeMaterial);
          node.position.set(
            x * cellSize - halfSize,
            y * cellSize - halfSize,
            z * cellSize - halfSize
          );
          this.gridGroup.add(node);
        }
      }
    }
  }
  
  updatePieces(): void {
    if (!this.board) return;
    
    // Clear existing pieces
    this.piecesGroup.clear();
    this.temporaryPiecesGroup.clear();
    
    const cellSize = this.options.cellSize;
    const halfSize = (this.options.boardSize - 1) * cellSize / 2;
    
    // Add pieces from board
    for (let x = 0; x < this.options.boardSize; x++) {
      for (let y = 0; y < this.options.boardSize; y++) {
        for (let z = 0; z < this.options.boardSize; z++) {
          const position = Vector3.create(x, y, z);
          const piece = this.board.getPieceAt(position);
          
          if (piece) {
            const mesh = this.createPieceMesh(piece);
            mesh.position.set(
              x * cellSize - halfSize,
              y * cellSize - halfSize,
              z * cellSize - halfSize
            );
            
            if (piece.isTemporary) {
              this.temporaryPiecesGroup.add(mesh);
            } else {
              this.piecesGroup.add(mesh);
            }
          }
        }
      }
    }
  }
  
  private createPieceMesh(piece: Piece): THREE.Mesh {
    let material: THREE.Material;
    
    if (piece.isTemporary) {
      material = piece.owner.id === 'black' ? 
        this.temporaryBlackMaterial : 
        this.temporaryWhiteMaterial;
    } else {
      material = piece.owner.id === 'black' ? 
        this.blackPieceMaterial : 
        this.whitePieceMaterial;
    }
    
    return new THREE.Mesh(this.pieceGeometry, material);
  }
  
  addTemporaryPiece(position: Vector3, player: Player): void {
    const cellSize = this.options.cellSize;
    const halfSize = (this.options.boardSize - 1) * cellSize / 2;
    
    // Create temporary piece
    const piece = Piece.create(position, player, true);
    const mesh = this.createPieceMesh(piece);
    
    mesh.position.set(
      position.x * cellSize - halfSize,
      position.y * cellSize - halfSize,
      position.z * cellSize - halfSize
    );
    
    // Store position data for later removal
    mesh.userData = { position };
    
    this.temporaryPiecesGroup.add(mesh);
    this.render();
  }
  
  removeTemporaryPiece(position: Vector3): void {
    // Find and remove temporary piece at position
    const toRemove: THREE.Object3D[] = [];
    
    this.temporaryPiecesGroup.traverse((child) => {
      if (child instanceof THREE.Mesh && child.userData.position) {
        const pos = child.userData.position as Vector3;
        if (pos.equals(position)) {
          toRemove.push(child);
        }
      }
    });
    
    toRemove.forEach(mesh => this.temporaryPiecesGroup.remove(mesh));
    this.render();
  }
  
  clearTemporaryPieces(): void {
    this.temporaryPiecesGroup.clear();
    this.render();
  }
  
  highlightPosition(position: Vector3, color: number = 0xffff00): void {
    const cellSize = this.options.cellSize;
    const halfSize = (this.options.boardSize - 1) * cellSize / 2;
    
    // Create highlight sphere
    const geometry = new THREE.SphereGeometry(this.options.pieceSize * 0.6, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color,
      opacity: 0.3,
      transparent: true
    });
    
    const highlight = new THREE.Mesh(geometry, material);
    highlight.position.set(
      position.x * cellSize - halfSize,
      position.y * cellSize - halfSize,
      position.z * cellSize - halfSize
    );
    
    highlight.name = 'highlight';
    this.scene.add(highlight);
    
    // Remove after a delay
    setTimeout(() => {
      this.scene.remove(highlight);
      this.render();
    }, 1000);
    
    this.render();
  }
  
  startRenderLoop(): void {
    if (this.animationId !== null) return;
    
    const animate = () => {
      this.animationId = requestAnimationFrame(animate);
      
      // Update controls
      this.controls.update();
      
      // Render scene
      this.renderer.render(this.scene, this.camera);
    };
    
    animate();
  }
  
  stopRenderLoop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
  
  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
  
  dispose(): void {
    // Stop render loop
    this.stopRenderLoop();
    
    // Remove event listeners
    window.removeEventListener('resize', this.handleResize.bind(this));
    
    // Dispose of Three.js resources
    this.gridGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    
    this.piecesGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    
    this.temporaryPiecesGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    
    // Dispose materials
    this.gridMaterial.dispose();
    this.nodeMaterial.dispose();
    this.blackPieceMaterial.dispose();
    this.whitePieceMaterial.dispose();
    this.temporaryBlackMaterial.dispose();
    this.temporaryWhiteMaterial.dispose();
    
    // Dispose geometries
    this.pieceGeometry.dispose();
    this.nodeGeometry.dispose();
    
    // Dispose renderer
    this.renderer.dispose();
    
    // Dispose controls
    this.controls.dispose();
  }
  
  // Getters for testing
  getScene(): THREE.Scene {
    return this.scene;
  }
  
  getCamera(): THREE.Camera {
    return this.camera;
  }
  
  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }
  
  getControls(): OrbitControls {
    return this.controls;
  }
}
```

### 2. Create Barrel Export

**File**: `src/rendering/index.ts`

```typescript
export { Renderer } from './Renderer';
export type { RendererOptions } from './Renderer';
```

### 3. Update Main Entry Point

**File**: `src/main.ts`

Add Three.js initialization and basic demo:

```typescript
import './style.css';
import { Game } from './core/Game';
import { Renderer } from './rendering/Renderer';
import { Vector3 } from './core/Vector3';

// Get canvas element
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
if (!canvas) {
  throw new Error('Canvas element not found');
}

// Create game instance
const game = new Game({ boardSize: 7 });

// Create renderer
const renderer = new Renderer({
  canvas,
  boardSize: 7,
  antialias: true
});

// Set the board
renderer.setBoard(game.getBoard());

// Start render loop
renderer.startRenderLoop();

// Demo: Add some pieces
const demoMoves = [
  Vector3.create(3, 3, 3),
  Vector3.create(4, 3, 3),
  Vector3.create(3, 4, 3),
  Vector3.create(4, 4, 3),
  Vector3.create(3, 3, 4),
];

// Place pieces with delay for visual effect
demoMoves.forEach((position, index) => {
  setTimeout(() => {
    if (game.placePiece(position)) {
      renderer.updatePieces();
    }
  }, index * 1000);
});

// Handle window focus/blur for performance
window.addEventListener('blur', () => renderer.stopRenderLoop());
window.addEventListener('focus', () => renderer.startRenderLoop());

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  renderer.dispose();
});
```

### 4. Update HTML Canvas

**File**: `index.html`

Update the body section to include a canvas:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pente3D.ai</title>
  </head>
  <body>
    <div id="app">
      <canvas id="game-canvas"></canvas>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

### 5. Update Styles

**File**: `src/style.css`

Update styles for full-screen canvas:

```css
:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;

  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
  overflow: hidden;
}

#app {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

#game-canvas {
  width: 100%;
  height: 100%;
  display: block;
  outline: none;
}
```

## Performance Considerations

1. **Object Pooling**: Reuse geometries and materials where possible
2. **Level of Detail**: Consider implementing LOD for large boards
3. **Render on Demand**: Only render when scene changes occur
4. **Efficient Updates**: Update only changed pieces, not entire board
5. **Memory Management**: Properly dispose of Three.js resources

## Integration Points

1. **Game Controller**: Renderer listens to game events for updates
2. **Input Handler**: Future chunk will integrate mouse interaction
3. **Settings**: Future chunk will allow visual customization
4. **Performance Monitor**: Track FPS and rendering metrics

## Common Pitfalls

1. **Memory Leaks**: Always dispose Three.js objects when done
2. **Context Loss**: Handle WebGL context loss gracefully
3. **Resize Handling**: Update camera and renderer on window resize
4. **Performance**: Avoid creating new objects in render loop
5. **Browser Compatibility**: Test WebGL support before initializing

## Testing Approach

1. **Unit Tests**: Mock Three.js for testing Renderer logic
2. **Integration Tests**: Test with actual WebGL context
3. **Visual Tests**: Manual verification of rendering output
4. **Performance Tests**: Measure FPS and memory usage
5. **Cross-Browser Tests**: Verify WebGL compatibility

## Success Criteria

- [ ] Three.js scene initializes without errors
- [ ] Board grid renders correctly in 3D
- [ ] Pieces render at correct positions
- [ ] Camera controls work smoothly
- [ ] Maintains 60fps on target hardware
- [ ] Properly handles resize events
- [ ] Resources are disposed correctly
- [ ] No memory leaks during extended use