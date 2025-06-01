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
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private board: Board | null = null;
  
  // Rendering groups
  private gridGroup!: THREE.Group;
  private piecesGroup!: THREE.Group;
  private temporaryPiecesGroup!: THREE.Group;
  
  // Materials
  private gridMaterial!: THREE.LineBasicMaterial;
  private nodeMaterial!: THREE.MeshBasicMaterial;
  private blackPieceMaterial!: THREE.MeshPhongMaterial;
  private whitePieceMaterial!: THREE.MeshPhongMaterial;
  private temporaryBlackMaterial!: THREE.MeshPhongMaterial;
  private temporaryWhiteMaterial!: THREE.MeshPhongMaterial;
  
  // Geometries (shared for performance)
  private pieceGeometry!: THREE.SphereGeometry;
  private nodeGeometry!: THREE.SphereGeometry;
  
  // Options
  private options: Required<RendererOptions>;
  
  // Animation
  private animationId: number | null = null;
  
  // Highlighting
  private highlightedPositions: Map<string, THREE.Mesh> = new Map();
  private temporaryPiece: THREE.Mesh | null = null;
  
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
    (this.controls as any).addEventListener('change', () => {
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
          // Store position data for raycasting
          node.userData = {
            type: 'intersection',
            position: Vector3.create(x, y, z)
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
      material = piece.player.id === 'black' ? 
        this.temporaryBlackMaterial : 
        this.temporaryWhiteMaterial;
    } else {
      material = piece.player.id === 'black' ? 
        this.blackPieceMaterial : 
        this.whitePieceMaterial;
    }
    
    return new THREE.Mesh(this.pieceGeometry, material);
  }
  
  addTemporaryPiece(position: Vector3, player: Player): void {
    const cellSize = this.options.cellSize;
    const halfSize = (this.options.boardSize - 1) * cellSize / 2;
    
    // Create temporary piece
    const piece = Piece.createTemporary(position, player);
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
    const key = `${position.x},${position.y},${position.z}`;
    
    // Remove existing highlight at this position
    if (this.highlightedPositions.has(key)) {
      return; // Already highlighted
    }
    
    const cellSize = this.options.cellSize;
    const halfSize = (this.options.boardSize - 1) * cellSize / 2;
    
    // Create highlight sphere
    const geometry = new THREE.SphereGeometry(this.options.pieceSize * 0.6, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color,
      opacity: 0.5,
      transparent: true
    });
    
    const highlight = new THREE.Mesh(geometry, material);
    highlight.position.set(
      position.x * cellSize - halfSize,
      position.y * cellSize - halfSize,
      position.z * cellSize - halfSize
    );
    
    highlight.name = 'highlight';
    this.highlightedPositions.set(key, highlight);
    this.scene.add(highlight);
    this.render();
  }
  
  unhighlightPosition(position: Vector3): void {
    const key = `${position.x},${position.y},${position.z}`;
    const highlight = this.highlightedPositions.get(key);
    
    if (highlight) {
      this.scene.remove(highlight);
      this.highlightedPositions.delete(key);
      highlight.geometry.dispose();
      if (Array.isArray(highlight.material)) {
        highlight.material.forEach(m => m.dispose());
      } else {
        highlight.material.dispose();
      }
      this.render();
    }
  }
  
  setTemporaryPiece(position: Vector3, player: Player): void {
    // Clear existing temporary piece
    this.clearTemporaryPiece();
    
    const cellSize = this.options.cellSize;
    const halfSize = (this.options.boardSize - 1) * cellSize / 2;
    
    // Create temporary piece
    const material = player.id === 'black' ? 
      this.temporaryBlackMaterial.clone() : 
      this.temporaryWhiteMaterial.clone();
    
    this.temporaryPiece = new THREE.Mesh(this.pieceGeometry, material);
    this.temporaryPiece.position.set(
      position.x * cellSize - halfSize,
      position.y * cellSize - halfSize,
      position.z * cellSize - halfSize
    );
    
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