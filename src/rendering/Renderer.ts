import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { Board } from '@/core/Board';
import { Vector3 } from '@/core/Vector3';
import { Piece } from '@/core/Piece';
import { Player } from '@/core/Player';
import { Line } from '@/core/Line';
import { PerformanceMonitor } from '@/utils/PerformanceMonitor';
import { QualityManager, QualitySettings } from './QualityManager';
import { ObjectPool } from '@/utils/ObjectPool';

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
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private board: Board | null = null;
  
  // Rendering groups
  private gridGroup!: THREE.Group;
  private piecesGroup!: THREE.Group;
  private temporaryPiecesGroup!: THREE.Group;
  private uiGroup!: THREE.Group;
  
  // Materials
  private gridMaterial!: THREE.LineBasicMaterial;
  private nodeMaterial!: THREE.MeshBasicMaterial;
  private blackPieceMaterial!: THREE.MeshPhongMaterial;
  private whitePieceMaterial!: THREE.MeshPhongMaterial;
  private temporaryBlackMaterial!: THREE.MeshPhongMaterial;
  private temporaryWhiteMaterial!: THREE.MeshPhongMaterial;
  
  // Highlighting materials
  private highlightedNodeMaterial!: THREE.MeshBasicMaterial;
  private lineHighlightMaterial!: THREE.MeshBasicMaterial;
  private connectedPieceHighlightMaterial!: THREE.MeshPhongMaterial;
  private captureHighlightMaterial!: THREE.MeshPhongMaterial;
  
  // Geometries (shared for performance)
  private pieceGeometry!: THREE.SphereGeometry;
  private nodeGeometry!: THREE.SphereGeometry;
  
  // Options
  private options: Required<RendererOptions>;
  
  // Animation
  private animationId: number | null = null;
  private animationMixers: THREE.AnimationMixer[] = [];
  private clock: THREE.Clock = new THREE.Clock();
  
  // Highlighting
  private temporaryPiece: THREE.Mesh | null = null;
  private highlightedLines: Map<string, THREE.Group> = new Map();
  private highlightedPieces: Map<string, { mesh: THREE.Mesh, originalMaterial: THREE.Material }> = new Map();
  private nodeHighlights: Map<string, { mesh: THREE.Mesh, originalMaterial: THREE.Material }> = new Map();
  
  // State indicators
  private currentPlayerIndicator: THREE.Mesh | null = null;
  private captureCountSprites: { black: THREE.Sprite | null, white: THREE.Sprite | null } = { black: null, white: null };
  
  // Performance optimization
  private performanceMonitor?: PerformanceMonitor;
  private qualityManager?: QualityManager;
  private objectPools: Map<string, ObjectPool<any>> = new Map();
  private materialPool: Map<string, THREE.Material[]> = new Map();
  private geometryPool: Map<string, THREE.BufferGeometry[]> = new Map();
  private frustumCuller: THREE.Frustum = new THREE.Frustum();
  private cameraMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private renderStats = {
    visibleObjects: 0,
    culledObjects: 0,
    batchedDrawCalls: 0
  };
  
  // Level of Detail (LOD) management
  private lodManager = {
    enabled: true,
    distances: [50, 150, 300],
    updateFrequency: 10,
    frameCounter: 0
  };
  
  // Batch rendering for pieces - reserved for future use
  // private pieceBatches: Map<string, THREE.InstancedMesh> = new Map();
  // private maxInstancesPerBatch = 1000;
  
  // Accessibility
  private reducedMotion = false;
  
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
  
  // Coordinate System Utilities
  /**
   * Converts an array index (0 to boardSize-1) to board coordinate (-halfSize to +halfSize)
   * @param index Array index (0-based)
   * @returns Board coordinate (centered)
   */
  private arrayIndexToBoardCoord(index: number): number {
    return index - Math.floor(this.options.boardSize / 2);
  }
  
  
  /**
   * Converts a board coordinate to world position for Three.js rendering
   * @param coord Board coordinate (centered)
   * @returns World position
   */
  private boardCoordToWorldPos(coord: number): number {
    return coord * this.options.cellSize;
  }
  
  /**
   * Converts a full Vector3 board coordinate to world position
   * @param boardPos Board position in centered coordinates
   * @returns World position for Three.js
   */
  private boardPositionToWorld(boardPos: Vector3): THREE.Vector3 {
    return new THREE.Vector3(
      this.boardCoordToWorldPos(boardPos.x),
      this.boardCoordToWorldPos(boardPos.y),
      this.boardCoordToWorldPos(boardPos.z)
    );
  }
  
  private initializeScene(): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.options.backgroundColor);
  }
  
  private initializeCamera(): void {
    const aspect = window.innerWidth / window.innerHeight;
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
    
    // Use viewport dimensions instead of canvas client dimensions
    this.renderer.setSize(
      window.innerWidth,
      window.innerHeight
    );
    
    this.renderer.setPixelRatio(window.devicePixelRatio);
  }
  
  private initializeControls(): void {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    
    // Configure controls per basic-wants.md:
    // left click + drag = rotate
    // right click + drag = pan  
    // scroll = zoom
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
    
    // Configure controls
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = false;
    // Allow camera to zoom inside the board (board radius is ~3.5 for 7x7x7)
    this.controls.minDistance = 0.5; // Allow very close zoom
    this.controls.maxDistance = this.options.boardSize * this.options.cellSize * 4;
    
    // Set rotation limits
    this.controls.maxPolarAngle = Math.PI * 0.9;
    this.controls.minPolarAngle = Math.PI * 0.1;
  }
  
  private initializeLighting(): void {
    // Ambient light for overall illumination - reduced to prevent washing out colors
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);
    
    // Directional light for shadows and depth
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.3);
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
    
    
    // Piece materials with enhanced contrast
    this.blackPieceMaterial = new THREE.MeshPhongMaterial({
      color: this.options.blackPieceColor,
      specular: 0x111111,  // Reduced specular for less grey appearance
      shininess: 30,       // Lower shininess for matte look
      emissive: 0x000000,  // No emissive light
      emissiveIntensity: 0
    });
    
    this.whitePieceMaterial = new THREE.MeshPhongMaterial({
      color: this.options.whitePieceColor,
      specular: 0xffffff,
      shininess: 80,
      emissive: 0x222222,  // Slight emissive to ensure visibility
      emissiveIntensity: 0.1
    });
    
    // Temporary piece materials with enhanced transparency
    this.temporaryBlackMaterial = new THREE.MeshPhongMaterial({
      color: this.options.blackPieceColor,
      specular: 0x222222,
      shininess: 50,
      opacity: this.options.temporaryOpacity,
      transparent: true,
      emissive: 0x111111,
      emissiveIntensity: 0.2,
      depthWrite: false // Better transparency rendering
    });
    
    this.temporaryWhiteMaterial = new THREE.MeshPhongMaterial({
      color: this.options.whitePieceColor,
      specular: 0xffffff,
      shininess: 80,
      opacity: this.options.temporaryOpacity,
      transparent: true,
      emissive: 0xcccccc,
      emissiveIntensity: 0.1,
      depthWrite: false // Better transparency rendering
    });
    
    // Highlighting materials
    this.highlightedNodeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      opacity: 0.8,
      transparent: true
    });
    
    this.lineHighlightMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      opacity: 0.6,
      transparent: true
    });
    
    this.connectedPieceHighlightMaterial = new THREE.MeshPhongMaterial({
      color: 0xff8800,
      specular: 0xffffff,
      shininess: 100,
      emissive: 0xff8800,
      emissiveIntensity: 0.3
    });
    
    this.captureHighlightMaterial = new THREE.MeshPhongMaterial({
      color: 0xff0000,
      specular: 0xffffff,
      shininess: 100,
      emissive: 0xff0000,
      emissiveIntensity: 0.5
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
    this.uiGroup = new THREE.Group();
    
    // Add groups to scene
    this.scene.add(this.gridGroup);
    this.scene.add(this.piecesGroup);
    this.scene.add(this.temporaryPiecesGroup);
    this.scene.add(this.uiGroup);
  }
  
  private setupEventListeners(): void {
    // Handle window resize
    window.addEventListener('resize', this.handleResize.bind(this));
    
    // Handle control changes
    (this.controls as any).addEventListener('change', () => {
      if (!this.animationId) {
        this.render();
      }
    });
  }
  
  private handleResize(): void {
    // Use viewport dimensions
    const width = window.innerWidth;
    const height = window.innerHeight;
    
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
  
  /**
   * Creates the visual grid for the board
   * Internal method - uses array indices for iteration
   */
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
          // Store position data for raycasting
          // Convert from array indices to board coordinates
          const boardX = this.arrayIndexToBoardCoord(x);
          const boardY = this.arrayIndexToBoardCoord(y);
          const boardZ = this.arrayIndexToBoardCoord(z);
          node.userData = {
            type: 'intersection',
            position: Vector3.create(boardX, boardY, boardZ)
          };
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
          // Convert from array indices to board coordinates
          const boardX = this.arrayIndexToBoardCoord(x);
          const boardY = this.arrayIndexToBoardCoord(y);
          const boardZ = this.arrayIndexToBoardCoord(z);
          const position = Vector3.create(boardX, boardY, boardZ);
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
      material = piece.player.color === 'black' ? 
        this.temporaryBlackMaterial : 
        this.temporaryWhiteMaterial;
    } else {
      material = piece.player.color === 'black' ? 
        this.blackPieceMaterial : 
        this.whitePieceMaterial;
    }
    
    return new THREE.Mesh(this.pieceGeometry, material);
  }
  
  /**
   * Adds a temporary piece to the scene
   * @param position Board coordinates (centered, e.g., -3 to 3 for size 7)
   * @param player Player who owns the piece
   */
  addTemporaryPiece(position: Vector3, player: Player): void {
    // Create temporary piece
    const piece = Piece.createTemporary(position, player);
    const mesh = this.createPieceMesh(piece);
    
    // Position receives board coordinates, convert to world position
    const worldPos = this.boardPositionToWorld(position);
    mesh.position.copy(worldPos);
    
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
  
  /**
   * Highlights a board position
   * @param position Board coordinates (centered, e.g., -3 to 3 for size 7)
   * @param color Highlight color
   */
  highlightPosition(position: Vector3, color: number = 0xffff00): void {
    const key = `${position.x},${position.y},${position.z}`;
    
    // Check if already highlighted
    if (this.nodeHighlights.has(key)) {
      return;
    }
    
    // Find the node mesh at this position
    let targetNode: THREE.Mesh | null = null;
    this.gridGroup.traverse((child) => {
      if (child instanceof THREE.Mesh && child.userData.type === 'intersection') {
        const nodePos = child.userData.position as Vector3;
        if (nodePos && nodePos.equals(position)) {
          targetNode = child as THREE.Mesh;
        }
      }
    });
    
    if (targetNode) {
      const node = targetNode as THREE.Mesh;
      // Store original material
      const originalMaterial = node.material as THREE.Material;
      
      // Apply highlight material
      node.material = this.highlightedNodeMaterial.clone();
      (node.material as THREE.MeshBasicMaterial).color = new THREE.Color(color);
      
      // Store in map for later removal
      this.nodeHighlights.set(key, { mesh: node, originalMaterial });
      
      this.render();
    }
  }
  
  unhighlightPosition(position: Vector3): void {
    const key = `${position.x},${position.y},${position.z}`;
    const nodeHighlight = this.nodeHighlights.get(key);
    
    if (nodeHighlight) {
      // Restore original material
      nodeHighlight.mesh.material = nodeHighlight.originalMaterial;
      
      // Clean up cloned material
      const meshMaterial = nodeHighlight.mesh.material;
      if (meshMaterial !== nodeHighlight.originalMaterial) {
        if (Array.isArray(meshMaterial)) {
          meshMaterial.forEach(m => m.dispose());
        } else {
          const mat = meshMaterial as THREE.Material;
          if (mat !== nodeHighlight.originalMaterial) {
            mat.dispose();
          }
        }
      }
      
      this.nodeHighlights.delete(key);
      this.render();
    }
  }
  
  highlightLine(line: Line, color: number = 0x00ff00): void {
    const lineKey = line.coords.map(c => `${c.x},${c.y},${c.z}`).join('|');
    
    // Check if already highlighted
    if (this.highlightedLines.has(lineKey)) {
      return;
    }
    
    const lineGroup = new THREE.Group();
    const cellSize = this.options.cellSize;
    const halfSize = (this.options.boardSize - 1) * cellSize / 2;
    
    // Create cylinders connecting the positions
    for (let i = 0; i < line.coords.length - 1; i++) {
      const start = line.coords[i];
      const end = line.coords[i + 1];
      
      // Calculate cylinder position and rotation
      const startPos = new THREE.Vector3(
        start.x * cellSize - halfSize,
        start.y * cellSize - halfSize,
        start.z * cellSize - halfSize
      );
      const endPos = new THREE.Vector3(
        end.x * cellSize - halfSize,
        end.y * cellSize - halfSize,
        end.z * cellSize - halfSize
      );
      
      const distance = startPos.distanceTo(endPos);
      const midpoint = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);
      
      // Create cylinder
      const geometry = new THREE.CylinderGeometry(
        this.options.pieceSize * 0.15,
        this.options.pieceSize * 0.15,
        distance,
        8
      );
      const material = this.lineHighlightMaterial.clone();
      (material as THREE.MeshBasicMaterial).color = new THREE.Color(color);
      
      const cylinder = new THREE.Mesh(geometry, material);
      cylinder.position.copy(midpoint);
      
      // Orient cylinder to connect the two points
      cylinder.lookAt(endPos);
      cylinder.rotateX(Math.PI / 2);
      
      lineGroup.add(cylinder);
    }
    
    // Add spheres at each position for emphasis
    line.coords.forEach(coord => {
      const geometry = new THREE.SphereGeometry(this.options.pieceSize * 0.25, 12, 12);
      const material = this.lineHighlightMaterial.clone();
      (material as THREE.MeshBasicMaterial).color = new THREE.Color(color);
      
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.set(
        coord.x * cellSize - halfSize,
        coord.y * cellSize - halfSize,
        coord.z * cellSize - halfSize
      );
      
      lineGroup.add(sphere);
    });
    
    this.highlightedLines.set(lineKey, lineGroup);
    this.scene.add(lineGroup);
    this.render();
  }
  
  unhighlightLine(line: Line): void {
    const lineKey = line.coords.map(c => `${c.x},${c.y},${c.z}`).join('|');
    const lineGroup = this.highlightedLines.get(lineKey);
    
    if (lineGroup) {
      // Dispose of all geometries and materials in the group
      lineGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      
      this.scene.remove(lineGroup);
      this.highlightedLines.delete(lineKey);
      this.render();
    }
  }
  
  clearAllLineHighlights(): void {
    this.highlightedLines.forEach(lineGroup => {
      lineGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this.scene.remove(lineGroup);
    });
    
    this.highlightedLines.clear();
    this.render();
  }
  
  highlightPiece(position: Vector3, highlightType: 'connected' | 'capture' = 'connected'): void {
    const key = `${position.x},${position.y},${position.z}`;
    
    // Check if already highlighted
    if (this.highlightedPieces.has(key)) {
      return;
    }
    
    // Find the piece mesh at this position
    let targetPiece: THREE.Mesh | null = null;
    const cellSize = this.options.cellSize;
    const halfSize = (this.options.boardSize - 1) * cellSize / 2;
    const worldPos = new THREE.Vector3(
      position.x * cellSize - halfSize,
      position.y * cellSize - halfSize,
      position.z * cellSize - halfSize
    );
    
    this.piecesGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.position.distanceTo(worldPos) < 0.01) {
          targetPiece = child as THREE.Mesh;
        }
      }
    });
    
    if (targetPiece) {
      const piece = targetPiece as THREE.Mesh;
      // Store original material
      const originalMaterial = piece.material as THREE.Material;
      
      // Apply highlight material based on type
      const highlightMaterial = highlightType === 'capture' 
        ? this.captureHighlightMaterial.clone()
        : this.connectedPieceHighlightMaterial.clone();
      
      piece.material = highlightMaterial;
      
      // Store in map for later removal
      this.highlightedPieces.set(key, { mesh: piece, originalMaterial });
      
      this.render();
    }
  }
  
  unhighlightPiece(position: Vector3): void {
    const key = `${position.x},${position.y},${position.z}`;
    const highlight = this.highlightedPieces.get(key);
    
    if (highlight) {
      // Restore original material
      highlight.mesh.material = highlight.originalMaterial;
      
      // Clean up cloned material
      const meshMaterial = highlight.mesh.material;
      if (meshMaterial !== highlight.originalMaterial) {
        if (Array.isArray(meshMaterial)) {
          meshMaterial.forEach(m => m.dispose());
        } else {
          const mat = meshMaterial as THREE.Material;
          if (mat !== highlight.originalMaterial) {
            mat.dispose();
          }
        }
      }
      
      this.highlightedPieces.delete(key);
      this.render();
    }
  }
  
  highlightConnectedPieces(positions: Vector3[]): void {
    positions.forEach(pos => this.highlightPiece(pos, 'connected'));
  }
  
  highlightCapturablePieces(positions: Vector3[]): void {
    positions.forEach(pos => this.highlightPiece(pos, 'capture'));
  }
  
  clearAllPieceHighlights(): void {
    this.highlightedPieces.forEach(({ mesh, originalMaterial }) => {
      // Restore original material
      mesh.material = originalMaterial;
      
      // Clean up cloned materials
      const meshMaterial = mesh.material;
      if (meshMaterial !== originalMaterial) {
        if (Array.isArray(meshMaterial)) {
          meshMaterial.forEach(m => m.dispose());
        } else {
          const mat = meshMaterial as THREE.Material;
          if (mat !== originalMaterial) {
            mat.dispose();
          }
        }
      }
    });
    
    this.highlightedPieces.clear();
    this.render();
  }
  
  /**
   * Sets a temporary piece at the specified position
   * @param position Board coordinates (centered, e.g., -3 to 3 for size 7)
   * @param player Player who owns the temporary piece
   */
  setTemporaryPiece(position: Vector3, player: Player): void {
    // Clear existing temporary piece
    this.clearTemporaryPiece();
    
    // Create temporary piece with enhanced material
    const material = player.id === 'black' ? 
      this.temporaryBlackMaterial.clone() : 
      this.temporaryWhiteMaterial.clone();
    
    // Add outline effect
    const outlineGeometry = new THREE.SphereGeometry(
      this.options.pieceSize * 1.1,
      16,
      16
    );
    const outlineMaterial = new THREE.MeshBasicMaterial({
      color: player.id === 'black' ? 0x333333 : 0xeeeeee,
      opacity: 0.3,
      transparent: true,
      side: THREE.BackSide
    });
    
    const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
    
    // Create the main piece
    this.temporaryPiece = new THREE.Mesh(this.pieceGeometry, material);
    // Position receives board coordinates, convert to world position
    const worldPos = this.boardPositionToWorld(position);
    this.temporaryPiece.position.copy(worldPos);
    
    // Add outline as child
    this.temporaryPiece.add(outline);
    
    // Store initial scale for animation
    this.temporaryPiece.userData = { 
      baseScale: 1.0,
      time: 0
    };
    
    this.temporaryPiecesGroup.add(this.temporaryPiece);
    this.render();
  }
  
  clearTemporaryPiece(): void {
    if (this.temporaryPiece) {
      this.temporaryPiecesGroup.remove(this.temporaryPiece);
      if (Array.isArray(this.temporaryPiece.material)) {
        this.temporaryPiece.material.forEach(m => m.dispose());
      } else {
        this.temporaryPiece.material.dispose();
      }
      this.temporaryPiece = null;
      this.render();
    }
  }
  
  updateCurrentPlayerIndicator(currentPlayer: 'black' | 'white'): void {
    // Remove existing indicator
    if (this.currentPlayerIndicator) {
      this.uiGroup.remove(this.currentPlayerIndicator);
      this.currentPlayerIndicator.geometry.dispose();
      if (Array.isArray(this.currentPlayerIndicator.material)) {
        this.currentPlayerIndicator.material.forEach(m => m.dispose());
      } else {
        (this.currentPlayerIndicator.material as THREE.Material).dispose();
      }
    }
    
    // Create new indicator
    const indicatorGeometry = new THREE.TorusGeometry(
      this.options.pieceSize * 0.8,
      this.options.pieceSize * 0.15,
      8,
      16
    );
    
    const indicatorMaterial = new THREE.MeshPhongMaterial({
      color: currentPlayer === 'black' ? 0x000000 : 0xffffff,
      emissive: currentPlayer === 'black' ? 0x333333 : 0xcccccc,
      emissiveIntensity: 0.5,
      specular: 0xffffff,
      shininess: 100
    });
    
    this.currentPlayerIndicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
    
    // Position at top of the board
    const boardTop = (this.options.boardSize - 1) * this.options.cellSize / 2 + 2;
    this.currentPlayerIndicator.position.set(0, boardTop, 0);
    this.currentPlayerIndicator.rotation.x = Math.PI / 2;
    
    this.uiGroup.add(this.currentPlayerIndicator);
    this.render();
  }
  
  updateCaptureCount(blackCaptures: number, whiteCaptures: number): void {
    // Create canvas for text rendering
    const createTextSprite = (text: string, color: string): THREE.Sprite => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 128;
      
      const context = canvas.getContext('2d')!;
      context.fillStyle = 'rgba(0, 0, 0, 0.8)';
      context.fillRect(0, 0, canvas.width, canvas.height);
      
      context.font = 'bold 48px Arial';
      context.fillStyle = color;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, canvas.width / 2, canvas.height / 2);
      
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ 
        map: texture,
        transparent: true
      });
      
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(2, 1, 1);
      
      return sprite;
    };
    
    // Clear existing sprites
    if (this.captureCountSprites.black) {
      this.uiGroup.remove(this.captureCountSprites.black);
      (this.captureCountSprites.black.material as THREE.SpriteMaterial).map?.dispose();
      this.captureCountSprites.black.material.dispose();
    }
    if (this.captureCountSprites.white) {
      this.uiGroup.remove(this.captureCountSprites.white);
      (this.captureCountSprites.white.material as THREE.SpriteMaterial).map?.dispose();
      this.captureCountSprites.white.material.dispose();
    }
    
    // Create new sprites
    const boardExtent = (this.options.boardSize - 1) * this.options.cellSize / 2 + 3;
    
    this.captureCountSprites.black = createTextSprite(
      `Black: ${blackCaptures}`,
      '#ffffff'
    );
    this.captureCountSprites.black.position.set(-boardExtent, 0, 0);
    
    this.captureCountSprites.white = createTextSprite(
      `White: ${whiteCaptures}`,
      '#ffffff'
    );
    this.captureCountSprites.white.position.set(boardExtent, 0, 0);
    
    this.uiGroup.add(this.captureCountSprites.black);
    this.uiGroup.add(this.captureCountSprites.white);
    
    this.render();
  }
  
  startRenderLoop(): void {
    if (this.animationId !== null) return;
    
    // Start performance monitoring
    if (this.performanceMonitor) {
      this.performanceMonitor.startMonitoring();
    }
    
    const animate = () => {
      this.animationId = requestAnimationFrame(animate);
      
      const delta = this.clock.getDelta();
      const elapsed = this.clock.getElapsedTime();
      
      // Update controls
      this.controls.update();
      
      // Animate temporary piece
      if (this.temporaryPiece && this.temporaryPiece.userData.time !== undefined && !this.reducedMotion) {
        this.temporaryPiece.userData.time += delta;
        const scale = 1.0 + Math.sin(elapsed * 3) * 0.05;
        this.temporaryPiece.scale.setScalar(scale);
        
        // Animate opacity
        const material = this.temporaryPiece.material as THREE.MeshPhongMaterial;
        material.opacity = this.options.temporaryOpacity + Math.sin(elapsed * 2) * 0.1;
      }
      
      // Animate current player indicator
      if (this.currentPlayerIndicator) {
        this.currentPlayerIndicator.rotation.z += delta * 0.5;
        const bobAmount = Math.sin(elapsed * 2) * 0.1;
        const baseY = (this.options.boardSize - 1) * this.options.cellSize / 2 + 2;
        this.currentPlayerIndicator.position.y = baseY + bobAmount;
      }
      
      // Animate highlighted nodes
      this.nodeHighlights.forEach(({ mesh }) => {
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.opacity = 0.6 + Math.sin(elapsed * 4) * 0.2;
      });
      
      // Animate line highlights
      this.highlightedLines.forEach(lineGroup => {
        lineGroup.children.forEach((child, index) => {
          if (child instanceof THREE.Mesh) {
            const offset = index * 0.1;
            const scale = 1.0 + Math.sin(elapsed * 3 + offset) * 0.1;
            child.scale.setScalar(scale);
          }
        });
      });
      
      // Update animation mixers
      this.animationMixers.forEach(mixer => mixer.update(delta));
      
      // Render scene with performance monitoring
      this.render();
    };
    
    animate();
  }
  
  stopRenderLoop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    
    // Stop performance monitoring
    if (this.performanceMonitor) {
      this.performanceMonitor.stopMonitoring();
    }
  }
  
  render(): void {
    if (!this.scene || !this.camera) return;
    
    if (this.performanceMonitor) {
      this.performanceMonitor.beginFrame();
    }
    
    // Update frustum for culling
    this.lodManager.frameCounter++;
    if (this.lodManager.frameCounter % 2 === 0) { // Update frustum every other frame
      this.cameraMatrix.multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse
      );
      this.frustumCuller.setFromProjectionMatrix(this.cameraMatrix);
    }
    
    // Perform frustum culling
    this.performFrustumCulling();
    
    // Update LOD if needed
    if (this.lodManager.enabled && 
        this.lodManager.frameCounter % this.lodManager.updateFrequency === 0) {
      this.updateLOD();
    }
    
    // Update animations efficiently
    if (this.qualityManager) {
      const quality = this.qualityManager.getSettings().animationQuality;
      this.updateAnimations(quality);
    }
    
    // Render scene
    this.renderer.render(this.scene, this.camera);
    
    if (this.performanceMonitor) {
      this.performanceMonitor.endFrame();
    }
  }
  
  clearAllHighlights(): void {
    // Clear node highlights
    this.nodeHighlights.forEach(({ mesh, originalMaterial }) => {
      mesh.material = originalMaterial;
    });
    this.nodeHighlights.clear();
    
    // Clear line highlights
    this.clearAllLineHighlights();
    
    // Clear piece highlights
    this.clearAllPieceHighlights();
    
    // Clear temporary pieces
    this.clearTemporaryPiece();
    
    this.render();
  }
  
  // Performance optimization methods - to be implemented later
  // The materialPool and geometryPool are defined for future optimization
  
  // Settings application methods
  applyColorSettings(colors: any): void {
    // Update background color
    if (colors.background) {
      this.scene.background = new THREE.Color(colors.background);
    }
    
    // Update grid material
    if (colors.boardGrid && this.gridMaterial) {
      this.gridMaterial.color.set(colors.boardGrid);
    }
    
    // Update node material
    if (colors.nodeSpheres && this.nodeMaterial) {
      this.nodeMaterial.color.set(colors.nodeSpheres);
    }
    
    // Update piece materials
    if (colors.blackPieces && this.blackPieceMaterial) {
      this.blackPieceMaterial.color.set(colors.blackPieces);
      this.temporaryBlackMaterial.color.set(colors.blackPieces);
    }
    
    if (colors.whitePieces && this.whitePieceMaterial) {
      this.whitePieceMaterial.color.set(colors.whitePieces);
      this.temporaryWhiteMaterial.color.set(colors.whitePieces);
    }
    
    // Update highlight materials
    if (colors.highlightedNodes && this.highlightedNodeMaterial) {
      this.highlightedNodeMaterial.color.set(colors.highlightedNodes);
    }
    
    if (colors.highlightedLines && this.lineHighlightMaterial) {
      this.lineHighlightMaterial.color.set(colors.highlightedLines);
    }
    
    if (colors.capturedPieces && this.captureHighlightMaterial) {
      this.captureHighlightMaterial.color.set(colors.capturedPieces);
    }
    
    if (colors.winningLine && this.connectedPieceHighlightMaterial) {
      this.connectedPieceHighlightMaterial.color.set(colors.winningLine);
    }
    
    // Update temporary piece materials
    if (colors.temporaryPieces) {
      // Add slight tint to temporary materials
      const tempColor = new THREE.Color(colors.temporaryPieces);
      this.temporaryBlackMaterial.emissive = tempColor;
      this.temporaryBlackMaterial.emissiveIntensity = 0.3;
      this.temporaryWhiteMaterial.emissive = tempColor;
      this.temporaryWhiteMaterial.emissiveIntensity = 0.3;
    }
    
    // Update lighting
    if (colors.ambientLight) {
      const ambientLight = this.scene.children.find(child => child instanceof THREE.AmbientLight) as THREE.AmbientLight;
      if (ambientLight) {
        ambientLight.color.set(colors.ambientLight);
      }
    }
    
    if (colors.directionalLight) {
      const directionalLight = this.scene.children.find(child => child instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
      if (directionalLight) {
        directionalLight.color.set(colors.directionalLight);
      }
    }
    
    // Re-render to show changes
    this.render();
  }
  
  applyOpacitySettings(opacity: any): void {
    // Update grid opacity
    if (opacity.boardGrid !== undefined && this.gridMaterial) {
      this.gridMaterial.opacity = opacity.boardGrid;
      this.gridMaterial.transparent = opacity.boardGrid < 1;
    }
    
    // Update node opacity
    if (opacity.nodeSpheres !== undefined && this.nodeMaterial) {
      this.nodeMaterial.opacity = opacity.nodeSpheres;
      this.nodeMaterial.transparent = opacity.nodeSpheres < 1;
    }
    
    // Update piece opacity
    if (opacity.pieces !== undefined) {
      this.blackPieceMaterial.opacity = opacity.pieces;
      this.blackPieceMaterial.transparent = opacity.pieces < 1;
      this.whitePieceMaterial.opacity = opacity.pieces;
      this.whitePieceMaterial.transparent = opacity.pieces < 1;
    }
    
    // Update temporary piece opacity
    if (opacity.temporaryPieces !== undefined) {
      this.options.temporaryOpacity = opacity.temporaryPieces;
      this.temporaryBlackMaterial.opacity = opacity.temporaryPieces;
      this.temporaryBlackMaterial.transparent = opacity.temporaryPieces < 1;
      this.temporaryWhiteMaterial.opacity = opacity.temporaryPieces;
      this.temporaryWhiteMaterial.transparent = opacity.temporaryPieces < 1;
      
      // Update existing temporary piece
      if (this.temporaryPiece) {
        const material = this.temporaryPiece.material as THREE.MeshPhongMaterial;
        material.opacity = opacity.temporaryPieces;
      }
    }
    
    // Update highlight opacity
    if (opacity.highlights !== undefined) {
      this.highlightedNodeMaterial.opacity = opacity.highlights;
      this.highlightedNodeMaterial.transparent = opacity.highlights < 1;
      this.lineHighlightMaterial.opacity = opacity.highlights;
      this.lineHighlightMaterial.transparent = opacity.highlights < 1;
      this.captureHighlightMaterial.opacity = opacity.highlights;
      this.captureHighlightMaterial.transparent = opacity.highlights < 1;
      this.connectedPieceHighlightMaterial.opacity = opacity.highlights;
      this.connectedPieceHighlightMaterial.transparent = opacity.highlights < 1;
    }
    
    // Re-render to show changes
    this.render();
  }
  
  updateElementColor(element: string, color: string): void {
    const colorObj: any = {};
    colorObj[element] = color;
    this.applyColorSettings(colorObj);
  }
  
  updateElementOpacity(element: string, opacity: number): void {
    const opacityObj: any = {};
    opacityObj[element] = opacity;
    this.applyOpacitySettings(opacityObj);
  }
  
  enterPreviewMode(): void {
    // Optional: Add visual indicator that we're in preview mode
    // For now, the live updates handle this
  }
  
  exitPreviewMode(): void {
    // Optional: Remove preview mode indicators
    // For now, the live updates handle this
  }
  
  applyPreviewSettings(settings: any): void {
    if (settings.colors) {
      this.applyColorSettings(settings.colors);
    }
    if (settings.opacity) {
      this.applyOpacitySettings(settings.opacity);
    }
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
    this.highlightedNodeMaterial.dispose();
    this.lineHighlightMaterial.dispose();
    this.connectedPieceHighlightMaterial.dispose();
    this.captureHighlightMaterial.dispose();
    
    // Dispose geometries
    this.pieceGeometry.dispose();
    this.nodeGeometry.dispose();
    
    // Dispose performance resources
    // Clear object pools
    this.objectPools.forEach(pool => pool.clear());
    this.objectPools.clear();
    
    // Clear material pool
    this.materialPool.forEach(materials => {
      materials.forEach(m => m.dispose());
    });
    this.materialPool.clear();
    
    // Clear geometry pool
    this.geometryPool.forEach(geometries => {
      geometries.forEach(g => g.dispose());
    });
    this.geometryPool.clear();
    
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
  
  // Performance optimization methods
  
  setPerformanceMonitor(monitor: PerformanceMonitor): void {
    this.performanceMonitor = monitor;
    monitor.setRenderer(this.renderer);
  }
  
  setQualityManager(manager: QualityManager): void {
    this.qualityManager = manager;
    
    // Apply quality settings
    manager.on('quality-changed', ({ settings }: any) => {
      this.applyQualitySettings(settings);
    });
  }
  
  private applyQualitySettings(settings: QualitySettings): void {
    // Update renderer settings
    this.renderer.setPixelRatio(settings.pixelRatio);
    
    // Ensure canvas display size remains consistent after pixel ratio change
    // This prevents the canvas from jumping when quality changes
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    this.renderer.setSize(rect.width, rect.height, false);
    
    // Update shadow settings
    this.renderer.shadowMap.enabled = settings.shadowQuality !== 'none';
    if (settings.shadowQuality !== 'none') {
      switch (settings.shadowQuality) {
        case 'low':
          this.renderer.shadowMap.type = THREE.BasicShadowMap;
          break;
        case 'medium':
          this.renderer.shadowMap.type = THREE.PCFShadowMap;
          break;
        case 'high':
          this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          break;
      }
    }
    
    // Recreate renderer if needed (for antialias changes)
    if ((this.renderer as any).antialias !== settings.antialias) {
      this.recreateRenderer(settings);
    }
  }
  
  private recreateRenderer(settings: QualitySettings): void {
    const oldRenderer = this.renderer;
    const canvas = oldRenderer.domElement;
    
    // Create new renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: settings.antialias,
      powerPreference: 'high-performance'
    });
    
    // Copy settings - use display dimensions, not buffer dimensions
    const rect = canvas.getBoundingClientRect();
    this.renderer.setSize(rect.width, rect.height, false);
    this.renderer.setPixelRatio(settings.pixelRatio);
    
    // Dispose old renderer
    oldRenderer.dispose();
    
    // Update performance monitor
    if (this.performanceMonitor) {
      this.performanceMonitor.setRenderer(this.renderer);
    }
  }
  
  private performFrustumCulling(): void {
    this.renderStats.visibleObjects = 0;
    this.renderStats.culledObjects = 0;
    
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        if (object.geometry.boundingSphere === null) {
          object.geometry.computeBoundingSphere();
        }
        
        // Check if object is in frustum
        const inFrustum = this.frustumCuller.intersectsObject(object);
        object.visible = inFrustum;
        
        if (inFrustum) {
          this.renderStats.visibleObjects++;
        } else {
          this.renderStats.culledObjects++;
        }
      }
    });
  }
  
  private updateLOD(): void {
    const cameraPosition = this.camera.position;
    
    this.piecesGroup.children.forEach((piece) => {
      if (piece instanceof THREE.Mesh) {
        const distance = piece.position.distanceTo(cameraPosition);
        
        // Adjust geometry detail based on distance
        if (distance > this.lodManager.distances[2]) {
          // Very far - use simplest geometry
          piece.visible = false; // Or use very low poly version
        } else if (distance > this.lodManager.distances[1]) {
          // Far - use low detail
          if (piece.geometry.attributes.position.count > 100) {
            // Switch to simpler geometry
          }
        } else if (distance > this.lodManager.distances[0]) {
          // Medium distance - use medium detail
        } else {
          // Close - use full detail
        }
      }
    });
  }
  
  private updateAnimations(quality: 'low' | 'medium' | 'high'): void {
    const deltaTime = this.clock.getDelta();
    
    // Update rotation animations based on quality
    if (quality === 'high') {
      // Update all animations every frame
      this.updateAllAnimations(deltaTime);
    } else if (quality === 'medium') {
      // Update animations every other frame
      if (this.lodManager.frameCounter % 2 === 0) {
        this.updateAllAnimations(deltaTime);
      }
    } else {
      // Update animations every 3rd frame
      if (this.lodManager.frameCounter % 3 === 0) {
        this.updateAllAnimations(deltaTime);
      }
    }
  }
  
  private updateAllAnimations(deltaTime: number): void {
    // Update pulsing animations for temporary pieces
    if (this.temporaryPiecesGroup.children.length > 0 || this.temporaryPiece) {
      const time = this.clock.getElapsedTime();
      const pulseScale = 1 + Math.sin(time * 3) * 0.1;
      
      // Update temporary pieces group
      this.temporaryPiecesGroup.children.forEach((piece) => {
        piece.scale.setScalar(pulseScale);
      });
      
      // Update single temporary piece
      if (this.temporaryPiece) {
        this.temporaryPiece.scale.setScalar(pulseScale);
      }
    }
    
    // Update rotating animations for highlights
    this.highlightedLines.forEach((lineGroup) => {
      lineGroup.children.forEach((child) => {
        if (child.userData.rotating) {
          child.rotation.y += deltaTime;
        }
      });
    });
    
    // Update animation mixers
    this.animationMixers.forEach((mixer) => {
      mixer.update(deltaTime);
    });
  }
  
  focusCameraOnPosition(position: Vector3): void {
    // Smoothly move camera to look at the focused position
    const targetPosition = new THREE.Vector3(position.x, position.y, position.z);
    
    // Update orbit controls target
    this.controls.target.lerp(targetPosition, 0.1);
    this.controls.update();
    
    // Ensure the position is visible
    const cameraDistance = this.camera.position.distanceTo(targetPosition);
    if (cameraDistance > this.options.boardSize * 2) {
      // Move camera closer if too far
      const direction = new THREE.Vector3().subVectors(this.camera.position, targetPosition).normalize();
      const newPosition = targetPosition.clone().add(direction.multiplyScalar(this.options.boardSize * 1.5));
      this.camera.position.lerp(newPosition, 0.1);
    }
    
    this.render();
  }
  
  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
    
    if (enabled) {
      // Disable all animations
      this.animationMixers.forEach(mixer => {
        mixer.timeScale = 0;
      });
      
      // Stop rotating animations
      this.highlightedLines.forEach((lineGroup) => {
        lineGroup.children.forEach((child) => {
          if (child.userData.rotating) {
            child.userData.rotating = false;
            child.rotation.y = 0;
          }
        });
      });
      
      // Disable pulsing animations
      if (this.temporaryPiece) {
        this.temporaryPiece.scale.setScalar(1);
      }
      
      // Disable current player indicator rotation
      if (this.currentPlayerIndicator) {
        this.currentPlayerIndicator.rotation.z = 0;
      }
    } else {
      // Re-enable animations
      this.animationMixers.forEach(mixer => {
        mixer.timeScale = 1;
      });
    }
  }
}