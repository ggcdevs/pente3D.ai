import * as THREE from 'three';
import { Board } from './board.js';
import { Player } from './player.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Game {
    constructor(container) {
        this.container = container;
        this.boardSize = 9; // 9x9x9 3D board
        this.playerBlack = new Player('black', this);
        this.playerWhite = new Player('white', this);
        this.currentPlayer = this.playerBlack;
        this.board = new Board(this.boardSize);
        
        // Reference to the game for settings
        this.board.game = this;
        
        // Visualization mode flags
        this.isGridVisible = true;
        this.isNodesVisible = true;
        this.isDiagonalGridVisible = false;
        
        // Temporary piece tracking
        this.temporaryPiece = null;
        this.temporaryPiecePosition = null;
        
        // Diagonal gridlines storage
        this.diagonalGridLines = [];
        
        // Settings for rendering
        this.pieceSettings = {
            blackColor: '#111111',
            whiteColor: '#ffffff',
            opacity: 0.85  // 15% translucency
        };
        
        // Node settings
        this.nodeColor = '#888888';
        this.nodeTranslucency = 50;
        this.nodeHoverSettings = {
            color: '#ffcc00',
            opacity: 0.8
        };
        
        // Gridline settings
        this.gridlineColor = '#444444';
        this.gridlineTranslucency = 50;
        this.gridlineHoverSettings = {
            color: '#00ff00',
            opacity: 0.8
        };
        this.isGameOver = false;
        this.winningLine = null;
        
        // DOM elements
        this.playerIndicator = document.getElementById('player-indicator');
        this.blackCaptureCount = document.getElementById('black-capture-count');
        this.whiteCaptureCount = document.getElementById('white-capture-count');
        this.gameMessage = document.getElementById('game-message');
        this.undoButton = document.getElementById('undo-move');
        this.redoButton = document.getElementById('redo-move');
        this.viewModeIndicator = document.getElementById('view-mode-indicator');
        this.tempPieceIndicator = document.getElementById('temp-piece-indicator');
        
        // Game history for undo/redo functionality
        this.moveHistory = [];
        this.redoHistory = [];
        
        // Scene setup
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        
        // Raycaster for mouse interaction
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.isMouseOverCanvas = false;
        
        // Bind event handlers
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseClick = this.handleMouseClick.bind(this);
    }
    
    initialize() {
        this.setupScene();
        this.setupCamera();
        this.setupRenderer();
        this.setupLights();
        this.setupControls();
        this.createBoard();
        this.setupEventListeners();
        this.setupGameControls();
        this.setupKeyboardShortcuts();
        this.animate();
    }
    
    setupGameControls() {
        // Set initial state of undo and redo buttons
        this.undoButton.disabled = true;
        this.redoButton.disabled = true;
        
        // Setup undo and redo button click handlers
        this.undoButton.addEventListener('click', () => this.undoLastMove());
        this.redoButton.addEventListener('click', () => this.redoMove());
    }
    
    setupKeyboardShortcuts() {
        // Move keyboard event listeners directly to the window object
        // and make them instance methods to ensure proper context
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
        
        console.log('Keyboard shortcuts initialized');
    }
    
    handleKeyDown(event) {
        console.log('Key pressed:', event.key);
        
        // Avoid repeating key events when key is held down
        if (event.repeat) return;
        
        if (event.key === 'Shift') {
            // Show grabbing cursor when shift is held (ready to pan)
            if (this.isMouseOverCanvas) {
                this.renderer.domElement.style.cursor = 'grab';
            }
        } else if (event.key.toLowerCase() === 'v') {
            console.log('V key pressed - toggling grid and node visibility');
            // Toggle grid and node visibility with each press of the 'v' key
            this.isGridVisible = !this.isGridVisible;
            this.isNodesVisible = !this.isNodesVisible;
            this.toggleBoardVisibility();
        } else if (event.key.toLowerCase() === 'd') {
            console.log('D key pressed - toggling diagonal gridlines');
            // Toggle diagonal gridlines
            this.isDiagonalGridVisible = !this.isDiagonalGridVisible;
            this.toggleDiagonalGridlines();
            console.log('Diagonal gridlines are now:', this.isDiagonalGridVisible ? 'visible' : 'hidden');
        } else if (event.key.toLowerCase() === 't') {
            console.log('T key pressed - toggling temporary piece');
            // Toggle temporary piece at currently hovered node
            this.toggleTemporaryPiece();
        } else if (event.key === 'Enter') {
            console.log('Enter key pressed - confirming temporary piece');
            // Confirm temporary piece placement
            this.confirmTemporaryPiece();
        } else if (event.key === 'z' && (event.ctrlKey || event.metaKey)) {
            console.log('Ctrl+Z pressed - undo last move');
            // Undo last move
            this.undoLastMove();
        } else if ((event.key === 'Z' || event.key === 'y') && (event.ctrlKey || event.metaKey)) {
            console.log('Ctrl+Shift+Z or Ctrl+Y pressed - redo move');
            // Redo move
            this.redoMove();
        }
    }
    
    handleKeyUp(event) {
        if (event.key === 'Shift') {
            // Reset cursor when shift is released
            if (this.isMouseOverCanvas) {
                this.renderer.domElement.style.cursor = 'default';
            }
        }
        // Note: 'v' key is now a toggle, so no action needed on key up
    }
    
    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x222222);
    }
    
    setupCamera() {
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
        this.camera.position.set(15, 15, 15);
        this.camera.lookAt(0, 0, 0);
    }
    
    setupRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.container.appendChild(this.renderer.domElement);
        
        // Prevent context menu on right-click to allow right-click zooming
        this.renderer.domElement.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        });
        
        // Handle window resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }
    
    setupLights() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);
        
        // Directional lights from different angles
        const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight1.position.set(10, 20, 10);
        this.scene.add(directionalLight1);
        
        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight2.position.set(-10, -20, -10);
        this.scene.add(directionalLight2);
    }
    
    setupControls() {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        
        // Enable damping for smoother camera movement
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        
        // Configure control buttons - Fusion 360 style
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.PAN,       // Left click - pan (when Shift is held)
            MIDDLE: THREE.MOUSE.ROTATE,  // Middle click - orbit/rotate (Fusion 360 style)
            RIGHT: THREE.MOUSE.DOLLY     // Right click - zoom
        };
        
        // Additional orbit control options
        this.controls.enablePan = true;  
        this.controls.panSpeed = 0.8;    
        this.controls.rotateSpeed = 0.8; // Adjust rotation speed
        this.controls.screenSpacePanning = true; // Pan parallel to the screen
        
        // Enable keyboard control
        this.controls.enableKeys = true;
        
        // Note: KeyboardEvent.code values are used by THREE.js internally
        // When using enableKeys, OrbitControls automatically handles WASD
        // No need to configure keys explicitly for OrbitControls v126+
        
        // Disable left-click rotation by requiring the shift key
        // This mimics Fusion 360's behavior where left-click by itself selects
        this.controls.enableRotate = true;
        this.controls.keyPanSpeed = 10.0; // Make keyboard panning faster
    }
    
    createBoard() {
        // Create the board visualization
        this.boardMesh = this.board.createBoardMesh();
        this.scene.add(this.boardMesh);
    }
    
    setupEventListeners() {
        // Game interaction events
        this.renderer.domElement.addEventListener('mousemove', this.handleMouseMove);
        this.renderer.domElement.addEventListener('click', this.handleMouseClick);
        
        // Navigation and cursor style events
        this.renderer.domElement.addEventListener('mousedown', (event) => {
            // Update cursor based on which button is pressed
            if (event.button === 1) { // Middle button
                // Middle-click orbiting (Fusion 360 style)
                this.renderer.domElement.style.cursor = 'move';
            } else if (event.button === 0 && event.shiftKey) {
                // Shift+Left click panning
                this.renderer.domElement.style.cursor = 'grabbing';
            } else if (event.button === 2) {
                // Right-click zooming
                this.renderer.domElement.style.cursor = 'ns-resize';
            }
        });
        
        this.renderer.domElement.addEventListener('mouseup', () => {
            // Reset cursor when mouse button is released
            this.renderer.domElement.style.cursor = 'default';
        });
        
        // Handle mouse leaving the canvas
        this.renderer.domElement.addEventListener('mouseleave', () => {
            this.renderer.domElement.style.cursor = 'default';
        });
        
        // Track if mouse is over the canvas
        this.isMouseOverCanvas = false;
        this.renderer.domElement.addEventListener('mouseenter', () => {
            this.isMouseOverCanvas = true;
        });
        this.renderer.domElement.addEventListener('mouseleave', () => {
            this.isMouseOverCanvas = false;
        });
    }
    
    // Method to toggle visibility of grid and nodes
    toggleBoardVisibility() {
        console.log('Toggling board visibility. Grid visible:', this.isGridVisible, 'Nodes visible:', this.isNodesVisible);
        
        if (this.board && this.board.gridLines) {
            // Toggle grid lines visibility
            for (const line of this.board.gridLines) {
                line.visible = this.isGridVisible;
            }
        }
        
        if (this.board && this.board.intersectionPoints) {
            // Toggle intersection points visibility
            for (const point of this.board.intersectionPoints) {
                point.visible = this.isNodesVisible;
            }
        }
        
        // Toggle the indicator
        if (!this.isGridVisible && !this.isNodesVisible) {
            this.viewModeIndicator.classList.remove('hidden');
        } else {
            this.viewModeIndicator.classList.add('hidden');
        }
    }
    
    // Creates diagonal gridlines if they don't exist yet, or toggles their visibility
    toggleDiagonalGridlines() {
        console.log('Toggling diagonal gridlines. Visible:', this.isDiagonalGridVisible);
        
        // Always clean up existing diagonal gridlines when toggling off
        if (!this.isDiagonalGridVisible) {
            console.log('Removing existing diagonal gridlines');
            for (const line of this.diagonalGridLines) {
                this.scene.remove(line);
            }
            this.diagonalGridLines = [];
        }
        // If we're turning on diagonals, create them
        else if (this.isDiagonalGridVisible) {
            // First clean up any existing diagonal lines
            for (const line of this.diagonalGridLines) {
                this.scene.remove(line);
            }
            this.diagonalGridLines = [];
            
            console.log('Creating new diagonal gridlines');
            this.createDiagonalGridlines();
        }
        
        // Show indicator if diagonal gridlines are visible
        if (this.isDiagonalGridVisible) {
            // Only create a new indicator if it doesn't exist
            if (!this.diagonalIndicator) {
                this.diagonalIndicator = document.createElement('div');
                this.diagonalIndicator.id = 'diagonal-indicator';
                this.diagonalIndicator.textContent = 'Diagonal Gridlines (D to toggle)';
                this.diagonalIndicator.classList.add('mode-indicator');
                document.querySelector('.game-container').appendChild(this.diagonalIndicator);
            }
            this.diagonalIndicator.classList.remove('hidden');
        } else if (this.diagonalIndicator) {
            this.diagonalIndicator.classList.add('hidden');
        }
    }
    
    // Creates diagonal gridlines that only extend to the exact boundaries of the grid
    createDiagonalGridlines() {
        console.log('Creating clean diagonal gridlines');
        
        const offset = (this.boardSize - 1) / 2;
        const spacing = this.nodeSpacing || 1.0;
        const size = this.boardSize;
        
        // Get the color and opacity from the game settings or use defaults
        const gridlineColor = this.gridlineColor || '#444444';
        const gridOpacity = 1 - ((this.gridlineTranslucency || 50) / 100);
        
        // Calculate the exact min/max boundaries of the grid
        const minBound = -offset * spacing;
        const maxBound = offset * spacing;
        
        // Create a list of diagonal line definitions (start and end points)
        const diagonals = [];
        
        // --------- STRICTLY CONTAINED DIAGONAL LINES ---------
        
        // Limit diagonals to just a few key planes to reduce visual clutter and pokie issues
        // Only generate diagonals for the middle plane and possibly the boundary planes
        // We're being more selective to avoid the cascading pokie issues
        
        // Define only the middle plane for better clarity and fewer visual artifacts
        const midPlane = Math.floor(size / 2);
        
        // 1. XY plane diagonals (only for the middle Z plane)
        const zPos = (midPlane - offset) * spacing;
        
        // Main diagonal 1: Bottom-left to top-right (middle Z plane only)
        diagonals.push({
            start: new THREE.Vector3(minBound, minBound, zPos),
            end: new THREE.Vector3(maxBound, maxBound, zPos),
            type: 'xy-diagonal1',
            index: midPlane
        });
        
        // Main diagonal 2: Top-left to bottom-right (middle Z plane only)
        diagonals.push({
            start: new THREE.Vector3(minBound, maxBound, zPos),
            end: new THREE.Vector3(maxBound, minBound, zPos),
            type: 'xy-diagonal2',
            index: midPlane
        });
        
        // 2. XZ plane diagonals (only for the middle Y plane)
        const yPos = (midPlane - offset) * spacing;
        
        // Main diagonal 1: Back-left to front-right
        diagonals.push({
            start: new THREE.Vector3(minBound, yPos, minBound),
            end: new THREE.Vector3(maxBound, yPos, maxBound),
            type: 'xz-diagonal1',
            index: midPlane
        });
        
        // Main diagonal 2: Front-left to back-right
        diagonals.push({
            start: new THREE.Vector3(minBound, yPos, maxBound),
            end: new THREE.Vector3(maxBound, yPos, minBound),
            type: 'xz-diagonal2',
            index: midPlane
        });
        
        // 3. YZ plane diagonals (only for the middle X plane)
        const xPos = (midPlane - offset) * spacing;
        
        // Main diagonal 1: Bottom-back to top-front
        diagonals.push({
            start: new THREE.Vector3(xPos, minBound, minBound),
            end: new THREE.Vector3(xPos, maxBound, maxBound),
            type: 'yz-diagonal1',
            index: midPlane
        });
        
        // Main diagonal 2: Bottom-front to top-back
        diagonals.push({
            start: new THREE.Vector3(xPos, minBound, maxBound),
            end: new THREE.Vector3(xPos, maxBound, minBound),
            type: 'yz-diagonal2',
            index: midPlane
        });
        
        // 4. Space diagonals - connecting opposite corners of the cube
        
        // Main diagonal 1: Bottom-back-left to top-front-right
        diagonals.push({
            start: new THREE.Vector3(minBound, minBound, minBound),
            end: new THREE.Vector3(maxBound, maxBound, maxBound),
            type: 'space-diagonal1',
            index: 0
        });
        
        // Main diagonal 2: Bottom-front-left to top-back-right
        diagonals.push({
            start: new THREE.Vector3(minBound, minBound, maxBound),
            end: new THREE.Vector3(maxBound, maxBound, minBound),
            type: 'space-diagonal2',
            index: 0
        });
        
        // Main diagonal 3: Top-back-left to bottom-front-right
        diagonals.push({
            start: new THREE.Vector3(minBound, maxBound, minBound),
            end: new THREE.Vector3(maxBound, minBound, maxBound),
            type: 'space-diagonal3',
            index: 0
        });
        
        // Main diagonal 4: Top-front-left to bottom-back-right
        diagonals.push({
            start: new THREE.Vector3(minBound, maxBound, maxBound),
            end: new THREE.Vector3(maxBound, minBound, minBound),
            type: 'space-diagonal4',
            index: 0
        });
        
        // Create all the diagonal lines
        for (const diagonal of diagonals) {
            // Strictly ensure the start and end points are within the grid bounds
            const clampedStart = this.clampPointToBounds(diagonal.start, minBound, maxBound);
            const clampedEnd = this.clampPointToBounds(diagonal.end, minBound, maxBound);
            
            // Calculate direction vector between clamped points
            const direction = new THREE.Vector3().subVectors(clampedEnd, clampedStart);
            const length = direction.length();
            
            // Skip lines that are too short (this would happen when the clamping makes them too small)
            // Using a higher threshold to avoid tiny segments that can cause visual artifacts
            if (length < spacing * 0.8) continue;
            
            // To prevent "pokies", we'll inset the start and end points from the grid boundaries
            // Calculate unit direction vector
            const unitDirection = direction.clone().normalize();
            
            // Use a larger base inset amount to prevent pokies
            const insetAmount = 0.075 * spacing;
            
            // Apply even larger insets for points near top/bottom boundaries
            // Check if start or end is at/near the top or bottom boundary
            const yEdgeThreshold = 0.01;
            const isStartAtTopEdge = Math.abs(clampedStart.y - maxBound) < yEdgeThreshold;
            const isStartAtBottomEdge = Math.abs(clampedStart.y - minBound) < yEdgeThreshold;
            const isEndAtTopEdge = Math.abs(clampedEnd.y - maxBound) < yEdgeThreshold;
            const isEndAtBottomEdge = Math.abs(clampedEnd.y - minBound) < yEdgeThreshold;
            
            // Additional inset for y-direction when on top/bottom edges
            let startInset = insetAmount;
            let endInset = insetAmount;
            
            // Apply extra inset at top/bottom edges to fix the cascade effect
            if (isStartAtTopEdge || isStartAtBottomEdge || isEndAtTopEdge || isEndAtBottomEdge) {
                startInset = 0.12 * spacing;
                endInset = 0.12 * spacing;
            }
            
            const insetStart = clampedStart.clone().add(unitDirection.clone().multiplyScalar(startInset));
            const insetEnd = clampedEnd.clone().sub(unitDirection.clone().multiplyScalar(endInset));
            
            // Skip if the diagonal becomes too short after insetting
            if (insetStart.distanceTo(insetEnd) < spacing * 0.5) continue;
            
            // Create the diagonal line with inset endpoints to avoid pokies
            this.createDiagonalLine(
                insetStart, 
                insetEnd, 
                gridlineColor, 
                gridOpacity, 
                diagonal.type, 
                diagonal.index
            );
        }
    }
    
    // Helper to ensure a point is strictly within the grid bounds
    clampPointToBounds(point, min, max) {
        return new THREE.Vector3(
            Math.max(min, Math.min(max, point.x)),
            Math.max(min, Math.min(max, point.y)),
            Math.max(min, Math.min(max, point.z))
        );
    }
    
    // Helper method to create a diagonal gridline
    createDiagonalLine(start, end, color, opacity, diagonalType, index) {
        // For diagonal lines, we'll create a custom cylinder that's slightly thinner
        const direction = new THREE.Vector3().subVectors(end, start);
        const length = direction.length();
        
        // Get node spacing or default to 1.0
        const spacing = this.nodeSpacing || 1.0;
        
        // Skip creating perfectly vertical lines (those are already covered by regular grid lines)
        // Check if this is a vertical line by comparing X and Z components
        const isVertical = Math.abs(direction.x) < 0.001 && Math.abs(direction.z) < 0.001;
        if (isVertical) {
            return null; // Skip creating this line
        }
        
        // Skip creating perfectly horizontal lines in X, Y, or Z directions (already covered by grid)
        const isHorizontalX = Math.abs(direction.y) < 0.001 && Math.abs(direction.z) < 0.001;
        const isHorizontalY = Math.abs(direction.x) < 0.001 && Math.abs(direction.z) < 0.001;
        const isHorizontalZ = Math.abs(direction.x) < 0.001 && Math.abs(direction.y) < 0.001;
        if (isHorizontalX || isHorizontalY || isHorizontalZ) {
            return null; // Skip creating this line
        }
        
        // Create a cylinder geometry - make diagonals 75% as thick as regular grid lines
        const radius = 0.015 * spacing; // Thinner than regular gridlines (0.02)
        const geometry = new THREE.CylinderGeometry(radius, radius, length, 8, 1);
        
        // Position and rotate the cylinder
        geometry.translate(0, length / 2, 0); // Move up so the bottom face is at the origin
        
        const material = new THREE.MeshBasicMaterial({ 
            color: color,
            transparent: true,
            opacity: opacity
        });
        
        const line = new THREE.Mesh(geometry, material);
        
        // Position at the start point
        line.position.copy(start);
        
        // Orient the cylinder to point from start to end
        if (direction.y > 0.99) {
            // Special case: vertical line (already aligned with Y-axis)
            // No rotation needed
        } else if (direction.y < -0.99) {
            // Special case: vertical line pointing down
            line.rotateX(Math.PI); // Rotate 180 degrees around X axis
        } else {
            // General case: use lookAt
            line.lookAt(end);
            line.rotateX(Math.PI / 2); // Adjust to match THREE.js cylinder orientation
        }
        
        // Mark this as a diagonal line for hover highlighting
        line.userData = { 
            type: 'diagonalLine',
            diagonalType: diagonalType,
            index: index,
            start: start.clone(),
            end: end.clone()
        };
        
        // Set visibility based on current state
        line.visible = this.isDiagonalGridVisible;
        
        // Add to scene and to the list of diagonal gridlines
        this.scene.add(line);
        this.diagonalGridLines.push(line);
        
        return line;
    }
    
    // Helper method to highlight a diagonal gridline
    highlightDiagonalLine(line) {
        if (line && line.userData && line.userData.type === 'diagonalLine') {
            // Use settings if available, otherwise fallback to default
            const color = this.gridlineHoverSettings?.color || '#00ff00';
            const opacity = this.gridlineHoverSettings?.opacity || 0.8;
            
            line.material.color.set(color);
            line.material.opacity = opacity;
            
            // Highlight pieces that lie along this diagonal line
            this.highlightPiecesAlongDiagonalLine(line);
        }
    }
    
    // Method to highlight all diagonal gridlines that pass through a node
    highlightIntersectingDiagonalLines(point) {
        if (!point || !point.userData) return;
        
        const { x, y, z } = point.userData;
        const offset = (this.boardSize - 1) / 2;
        const spacing = this.nodeSpacing || 1.0;
        
        // Convert board coordinates to world coordinates
        const pointPos = point.position.clone();
        
        // For our full-span diagonal lines, we need to check if the node lies on each diagonal line
        for (const line of this.diagonalGridLines) {
            if (!line.userData || line.userData.type !== 'diagonalLine') continue;
            
            const { start, end, diagonalType, index } = line.userData;
            
            // Different checks based on the type of diagonal line
            let isOnDiagonal = false;
            
            // For diagonals in the XY plane
            if (diagonalType.startsWith('xy-')) {
                // Node must be on the same Z level as the diagonal
                if (Math.abs(z - index) < 0.01 && diagonalType.includes('main')) {
                    // For main diagonals, check if the point lies on the line
                    isOnDiagonal = this.isPointOnLine(pointPos, start, end);
                }
                else if (Math.abs(z - Math.floor(index / this.boardSize)) < 0.01) {
                    // For non-main diagonals, we need to check if the point lies on the line
                    isOnDiagonal = this.isPointOnLine(pointPos, start, end);
                }
            }
            // For diagonals in the XZ plane
            else if (diagonalType.startsWith('xz-')) {
                // Node must be on the same Y level as the diagonal
                if (Math.abs(y - index) < 0.01 && diagonalType.includes('main')) {
                    // For main diagonals, check if the point lies on the line
                    isOnDiagonal = this.isPointOnLine(pointPos, start, end);
                }
                else if (Math.abs(y - Math.floor(index / this.boardSize)) < 0.01) {
                    // For non-main diagonals, we need to check if the point lies on the line
                    isOnDiagonal = this.isPointOnLine(pointPos, start, end);
                }
            }
            // For diagonals in the YZ plane
            else if (diagonalType.startsWith('yz-')) {
                // Node must be on the same X level as the diagonal
                if (Math.abs(x - index) < 0.01 && diagonalType.includes('main')) {
                    // For main diagonals, check if the point lies on the line
                    isOnDiagonal = this.isPointOnLine(pointPos, start, end);
                }
                else if (Math.abs(x - Math.floor(index / this.boardSize)) < 0.01) {
                    // For non-main diagonals, we need to check if the point lies on the line
                    isOnDiagonal = this.isPointOnLine(pointPos, start, end);
                }
            }
            // For full 3D space diagonals
            else if (diagonalType.startsWith('space-')) {
                // Check if the point lies on the line
                isOnDiagonal = this.isPointOnLine(pointPos, start, end);
            }
            
            if (isOnDiagonal) {
                this.highlightDiagonalLine(line);
            }
        }
    }
    
    // Helper method to check if a point is on a line segment
    isPointOnLine(point, lineStart, lineEnd) {
        // Create a direction vector from start to end
        const lineDir = new THREE.Vector3().subVectors(lineEnd, lineStart).normalize();
        
        // Vector from start to point
        const startToPoint = new THREE.Vector3().subVectors(point, lineStart);
        
        // Project this vector onto the line direction
        const projection = startToPoint.dot(lineDir);
        
        // Check if projection is within line segment bounds
        if (projection >= 0 && projection <= lineStart.distanceTo(lineEnd)) {
            // Calculate the point on the line that's closest to the point
            const projectedPoint = new THREE.Vector3().copy(lineStart).addScaledVector(lineDir, projection);
            
            // Check if the point is very close to this projected point
            const distance = point.distanceTo(projectedPoint);
            const threshold = 0.01 * (this.nodeSpacing || 1.0); // Small threshold for floating point comparison
            
            return distance < threshold;
        }
        
        return false;
    }
    
    // Method to highlight pieces along a diagonal gridline
    highlightPiecesAlongDiagonalLine(line) {
        if (!line || !line.userData || line.userData.type !== 'diagonalLine') return;
        
        const { start, end } = line.userData;
        const offset = (this.boardSize - 1) / 2;
        const spacing = this.nodeSpacing || 1.0;
        
        // For our full-span diagonal lines, we need to check all nodes along the line
        // to find any pieces that should be highlighted
        
        // Highlight any pieces that lie on this diagonal line
        this.board.forEachPiece((piece, x, y, z) => {
            // Convert board coordinates to world coordinates
            const pieceX = (x - offset) * spacing;
            const pieceY = (y - offset) * spacing;
            const pieceZ = (z - offset) * spacing;
            const piecePos = new THREE.Vector3(pieceX, pieceY, pieceZ);
            
            // Check if the piece is on this diagonal line
            if (this.isPointOnLine(piecePos, start, end) && piece.mesh) {
                // Highlight the piece
                const highlightColor = new THREE.Color(this.gridlineHoverSettings?.color || '#00ff00');
                piece.mesh.material.emissive = highlightColor;
                piece.mesh.material.emissiveIntensity = 0.5;
                piece.isHighlighted = true;
            }
        });
    }
    
    // Clean up event listeners
    cleanup() {
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
    }
    
    // Creates or removes a temporary piece at the hovered node
    toggleTemporaryPiece() {
        console.log('Toggle temporary piece called');
        
        // If there's already a temporary piece, remove it
        if (this.temporaryPiece) {
            console.log('Removing existing temporary piece');
            this.removeTemporaryPiece();
            return;
        }
        
        // If no node is hovered, we can't place a piece
        if (!this.hoveredPoint) {
            console.log('No node is hovered, cannot place temporary piece');
            return;
        }
        
        // Get position from hovered node
        const position = this.hoveredPoint.position.clone();
        const spacing = this.nodeSpacing || 1.0;
        const offset = (this.boardSize - 1) / 2;
        const x = Math.round((position.x / spacing) + offset);
        const y = Math.round((position.y / spacing) + offset);
        const z = Math.round((position.z / spacing) + offset);
        
        // Check if there's already a piece at this position
        if (this.board.getPieceAt(x, y, z)) {
            console.log('Position is already occupied, cannot place temporary piece');
            return;
        }
        
        console.log('Creating temporary piece at position', x, y, z);
        
        // Create a temporary piece mesh (semi-transparent)
        const tempPiece = this.currentPlayer.createPiece(true); // true indicates temporary
        
        // Make it more transparent than normal pieces
        tempPiece.material.opacity = 0.5;
        
        // Add a pulsing effect
        const originalScale = tempPiece.scale.clone();
        const animate = () => {
            if (!this.temporaryPiece) return;
            
            const pulse = 0.15 * Math.sin(Date.now() * 0.005) + 1;
            tempPiece.scale.set(
                originalScale.x * pulse,
                originalScale.y * pulse,
                originalScale.z * pulse
            );
            
            requestAnimationFrame(animate);
        };
        animate();
        
        // Position the temporary piece
        tempPiece.position.copy(position);
        this.scene.add(tempPiece);
        
        // Store reference to the temporary piece and its position
        this.temporaryPiece = tempPiece;
        this.temporaryPiecePosition = { x, y, z };
        
        // Show the temporary piece indicator
        this.tempPieceIndicator.classList.remove('hidden');
    }
    
    // Removes the temporary piece
    removeTemporaryPiece() {
        console.log('Remove temporary piece called');
        if (this.temporaryPiece) {
            console.log('Removing temporary piece from scene');
            this.scene.remove(this.temporaryPiece);
            this.temporaryPiece = null;
            this.temporaryPiecePosition = null;
            
            // Hide the temporary piece indicator
            this.tempPieceIndicator.classList.add('hidden');
        } else {
            console.log('No temporary piece to remove');
        }
    }
    
    // Confirms the temporary piece (places a real piece)
    confirmTemporaryPiece() {
        console.log('Confirm temporary piece called');
        
        if (!this.temporaryPiece || !this.temporaryPiecePosition) {
            console.log('No temporary piece to confirm');
            return;
        }
        
        console.log('Confirming temporary piece placement');
        
        const { x, y, z } = this.temporaryPiecePosition;
        
        // Remove the temporary piece
        this.scene.remove(this.temporaryPiece);
        this.temporaryPiece = null;
        
        // Hide the temporary piece indicator
        this.tempPieceIndicator.classList.add('hidden');
        
        // Place a real piece at the same position
        if (this.board.placePiece(x, y, z, this.currentPlayer.color)) {
            // Create move data for undo history
            const moveData = {
                x, y, z,
                playerColor: this.currentPlayer.color,
                playerCaptures: this.currentPlayer.captures,
                opponentCaptures: this.currentPlayer === this.playerBlack 
                    ? this.playerWhite.captures 
                    : this.playerBlack.captures,
                captures: []
            };
            
            // Calculate the position in world space
            const spacing = this.nodeSpacing || 1.0;
            const offset = (this.boardSize - 1) / 2;
            const position = new THREE.Vector3(
                (x - offset) * spacing,
                (y - offset) * spacing,
                (z - offset) * spacing
            );
            
            // Create a visual representation of the piece
            const pieceMesh = this.currentPlayer.createPiece();
            pieceMesh.position.copy(position);
            this.scene.add(pieceMesh);
            
            // Store reference to the mesh in the board data structure
            const boardPiece = this.board.getPieceAt(x, y, z);
            if (boardPiece) {
                boardPiece.mesh = pieceMesh;
            }
            
            // Check for captures
            const captures = this.board.checkCaptures(x, y, z, this.currentPlayer.color);
            
            if (captures.length > 0) {
                // Remove captured pieces
                for (const capturedPos of captures) {
                    const capturedPiece = this.board.getPieceAt(capturedPos.x, capturedPos.y, capturedPos.z);
                    if (capturedPiece && capturedPiece.mesh) {
                        // Store capture data for undo history
                        moveData.captures.push({
                            x: capturedPos.x,
                            y: capturedPos.y,
                            z: capturedPos.z,
                            color: capturedPiece.color,
                            mesh: capturedPiece.mesh
                        });
                        
                        // Remove the piece visually from the scene
                        this.scene.remove(capturedPiece.mesh);
                        // Remove the piece from the board data structure
                        this.board.board[capturedPos.x][capturedPos.y][capturedPos.z] = null;
                    }
                }
                
                // Increment capture count - each capture is 2 pieces, so divide by 2
                this.currentPlayer.captures += captures.length / 2;
                
                // Update the capture counts
                this.updateCaptureDisplay();
                
                // Check for win by capture
                if (this.currentPlayer.captures >= 5) {
                    // Record the move in history
                    this.moveHistory.push(moveData);
                    this.undoButton.disabled = false;
                    
                    this.endGame(`${this.currentPlayer.color.charAt(0).toUpperCase() + this.currentPlayer.color.slice(1)} wins by capture!`);
                    return;
                }
            }
            
            // Check for win by five in a row
            const winningLine = this.board.checkWin(x, y, z, this.currentPlayer.color);
            if (winningLine.length >= 5) {
                // Record the move in history
                this.moveHistory.push(moveData);
                this.undoButton.disabled = false;
                
                this.winningLine = winningLine;
                this.highlightWinningLine();
                this.endGame(`${this.currentPlayer.color.charAt(0).toUpperCase() + this.currentPlayer.color.slice(1)} wins with 5 in a row!`);
                return;
            }
            
            // Add the move to history and clear redo history
            this.moveHistory.push(moveData);
            this.redoHistory = [];
            
            // Enable the undo button and disable the redo button
            this.undoButton.disabled = false;
            this.redoButton.disabled = true;
            
            // Switch players
            this.switchPlayer();
        } else {
            // If piece placement failed, clear the temporary piece position
            this.temporaryPiecePosition = null;
        }
    }
    
    handleMouseMove(event) {
        if (this.isGameOver) return;
        
        // Skip hover effects during navigation or when grid is hidden
        // Skip for middle-click (orbit), shift+left-click (pan), right-click (zoom), or v key
        if (event.buttons === 4 ||                         // Middle button
            (event.buttons === 1 && event.shiftKey) ||     // Left button + Shift
            event.buttons === 2 ||                         // Right button
            !this.isGridVisible) {                         // When 'v' key is pressed
            return;
        }
        
        // Calculate mouse position
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        // Update the hover effect
        this.updateHoverPoint();
    }
    
    handleMouseClick(event) {
        if (this.isGameOver) return;
        
        // Only handle left clicks (button 0) without modifier keys
        // Also don't place pieces when viewing in pieces-only mode ('v' key held)
        if (event.button !== 0 || 
            event.shiftKey || 
            event.ctrlKey || 
            event.altKey || 
            !this.isGridVisible) return;
        
        // Calculate mouse position
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        // Place a stone at the hovered position
        this.placePiece();
    }
    
    // Method to reset all hover highlighting, including diagonal lines
    resetHoverState() {
        // Reset basic hover state using the board's method
        this.board.resetHoverState();
        
        // Additionally reset diagonal gridlines if they exist
        if (this.diagonalGridLines.length > 0) {
            const gridlineColor = this.gridlineColor || '#444444';
            const gridOpacity = 1 - ((this.gridlineTranslucency || 50) / 100);
            
            for (const line of this.diagonalGridLines) {
                if (line.visible) {
                    line.material.color.set(gridlineColor);
                    line.material.opacity = gridOpacity;
                }
            }
        }
    }
    
    updateHoverPoint() {
        // Update the raycaster
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Reset previous hover state (including diagonal lines)
        this.resetHoverState();
        this.hoveredPoint = null;
        
        // Get all objects (points, regular grid lines, and diagonal lines if visible)
        const allObjects = [...this.board.intersectionPoints, ...this.board.gridLines];
        
        // Add diagonal grid lines to raycast targets if they're visible
        if (this.isDiagonalGridVisible && this.diagonalGridLines.length > 0) {
            allObjects.push(...this.diagonalGridLines);
        }
        
        const intersects = this.raycaster.intersectObjects(allObjects);
        
        // If we have any intersections
        if (intersects.length > 0) {
            const firstObject = intersects[0].object;
            
            // Check if the first intersection is a point (intersection node)
            const isPointIntersection = this.board.intersectionPoints.includes(firstObject);
            
            if (isPointIntersection) {
                // Prioritize nodes over grid lines behind them
                if (!this.board.isOccupied(firstObject.position)) {
                    // Highlight the node
                    // Use the hover node color if available, otherwise use player color
                    const hoverColor = this.nodeHoverSettings?.color || this.currentPlayer.color;
                    firstObject.material.color.set(hoverColor);
                    // Use hover settings if available
                    firstObject.material.opacity = this.nodeHoverSettings?.opacity || 0.8;
                    this.hoveredPoint = firstObject;
                    
                    // Also highlight the 3 grid lines that intersect at this node
                    this.board.highlightIntersectingLines(firstObject);
                    
                    // If diagonal gridlines are visible, also highlight any diagonal lines passing through this point
                    if (this.isDiagonalGridVisible) {
                        this.highlightIntersectingDiagonalLines(firstObject);
                    }
                }
            } else if (firstObject.userData && firstObject.userData.type === 'line') {
                // It's a regular grid line
                this.board.highlightGridLine(firstObject);
            } else if (firstObject.userData && firstObject.userData.type === 'diagonalLine') {
                // It's a diagonal grid line
                this.highlightDiagonalLine(firstObject);
            }
        }
    }
    
    placePiece() {
        if (!this.hoveredPoint) return;
        
        // If there's a temporary piece, remove it
        if (this.temporaryPiece) {
            this.removeTemporaryPiece();
        }
        
        const position = this.hoveredPoint.position.clone();
        
        // Get the node spacing for calculating board coordinates
        const spacing = this.nodeSpacing || 1.0;
        
        // Adjust for spacing when converting from 3D position to board coordinates
        // For a spacing of 1.0, this is the same as before
        // For other spacings, we need to divide by the spacing factor
        const offset = (this.boardSize - 1) / 2;
        const x = Math.round((position.x / spacing) + offset);
        const y = Math.round((position.y / spacing) + offset);
        const z = Math.round((position.z / spacing) + offset);
        
        // Place the piece on the board data structure
        if (this.board.placePiece(x, y, z, this.currentPlayer.color)) {
            // Create move data for undo history
            const moveData = {
                x, y, z,
                playerColor: this.currentPlayer.color,
                playerCaptures: this.currentPlayer.captures,
                opponentCaptures: this.currentPlayer === this.playerBlack 
                    ? this.playerWhite.captures 
                    : this.playerBlack.captures,
                captures: []
            };
            
            // Create a visual representation of the piece
            const pieceMesh = this.currentPlayer.createPiece();
            // Use the exact position of the hovered node for visual accuracy
            pieceMesh.position.copy(position);
            this.scene.add(pieceMesh);
            
            // Store reference to the mesh in the board data structure
            const boardPiece = this.board.getPieceAt(x, y, z);
            if (boardPiece) {
                boardPiece.mesh = pieceMesh;
            }
            
            // Check for captures
            const captures = this.board.checkCaptures(x, y, z, this.currentPlayer.color);
            
            if (captures.length > 0) {
                // Remove captured pieces
                for (const capturedPos of captures) {
                    const capturedPiece = this.board.getPieceAt(capturedPos.x, capturedPos.y, capturedPos.z);
                    if (capturedPiece && capturedPiece.mesh) {
                        // Store capture data for undo history
                        moveData.captures.push({
                            x: capturedPos.x,
                            y: capturedPos.y,
                            z: capturedPos.z,
                            color: capturedPiece.color,
                            mesh: capturedPiece.mesh
                        });
                        
                        // Remove the piece visually from the scene
                        this.scene.remove(capturedPiece.mesh);
                        // Remove the piece from the board data structure
                        this.board.board[capturedPos.x][capturedPos.y][capturedPos.z] = null;
                    }
                }
                
                // Increment capture count based on how many pieces were captured
                this.currentPlayer.captures += captures.length / 2;
                
                // Update the capture counts
                this.updateCaptureDisplay();
                
                // Check for win by capture
                if (this.currentPlayer.captures >= 5) {
                    // Still record the move in history and clear redo history
                    this.moveHistory.push(moveData);
                    this.redoHistory = [];
                    this.undoButton.disabled = false;
                    this.redoButton.disabled = true;
                    
                    this.endGame(`${this.currentPlayer.color.charAt(0).toUpperCase() + this.currentPlayer.color.slice(1)} wins by capture!`);
                    return;
                }
            }
            
            // Check for win by five in a row
            const winningLine = this.board.checkWin(x, y, z, this.currentPlayer.color);
            if (winningLine.length >= 5) {
                // Still record the move in history and clear redo history
                this.moveHistory.push(moveData);
                this.redoHistory = [];
                this.undoButton.disabled = false;
                this.redoButton.disabled = true;
                
                this.winningLine = winningLine;
                this.highlightWinningLine();
                this.endGame(`${this.currentPlayer.color.charAt(0).toUpperCase() + this.currentPlayer.color.slice(1)} wins with 5 in a row!`);
                return;
            }
            
            // Add the move to history and clear redo history
            this.moveHistory.push(moveData);
            this.redoHistory = [];
            
            // Enable the undo button and disable the redo button
            this.undoButton.disabled = false;
            this.redoButton.disabled = true;
            
            // Switch players
            this.switchPlayer();
        }
    }
    
    undoLastMove() {
        if (this.moveHistory.length === 0 || this.isGameOver) return;
        
        // Get the last move from history
        const lastMove = this.moveHistory.pop();
        
        // Move the undone move to redoHistory for potential redo
        this.redoHistory.push(lastMove);
        
        // Enable the redo button since we now have something to redo
        this.redoButton.disabled = false;
        
        // If this is the last move, disable the undo button
        if (this.moveHistory.length === 0) {
            this.undoButton.disabled = true;
        }
        
        // Switch back to the player who made the move
        this.currentPlayer = lastMove.playerColor === 'black' ? this.playerBlack : this.playerWhite;
        this.playerIndicator.textContent = this.currentPlayer.color.charAt(0).toUpperCase() + this.currentPlayer.color.slice(1);
        
        // Remove the piece from the board
        const piece = this.board.getPieceAt(lastMove.x, lastMove.y, lastMove.z);
        if (piece && piece.mesh) {
            this.scene.remove(piece.mesh);
            this.board.board[lastMove.x][lastMove.y][lastMove.z] = null;
        }
        
        // Restore captured pieces
        for (const capture of lastMove.captures) {
            // Create a piece object
            const restoredPiece = {
                color: capture.color,
                mesh: capture.mesh
            };
            
            // Add it back to the board data structure
            this.board.board[capture.x][capture.y][capture.z] = restoredPiece;
            
            // Add it back to the scene
            this.scene.add(capture.mesh);
        }
        
        // Restore capture counts
        this.playerBlack.captures = lastMove.playerColor === 'black' ? lastMove.playerCaptures : lastMove.opponentCaptures;
        this.playerWhite.captures = lastMove.playerColor === 'white' ? lastMove.playerCaptures : lastMove.opponentCaptures;
        this.updateCaptureDisplay();
        
        // If the game was over, reactivate it
        if (this.isGameOver) {
            this.isGameOver = false;
            this.gameMessage.classList.add('hidden');
            this.winningLine = null;
        }
    }
    
    redoMove() {
        if (this.redoHistory.length === 0 || this.isGameOver) return;
        
        // Get the last undone move
        const redoMove = this.redoHistory.pop();
        
        // If no more moves to redo, disable the redo button
        if (this.redoHistory.length === 0) {
            this.redoButton.disabled = true;
        }
        
        // Enable the undo button
        this.undoButton.disabled = false;
        
        // Add the move back to the moveHistory
        this.moveHistory.push(redoMove);
        
        // Place the piece back on the board
        const { x, y, z, playerColor } = redoMove;
        
        // Calculate the position in world space
        const spacing = this.nodeSpacing || 1.0;
        const offset = (this.boardSize - 1) / 2;
        const position = new THREE.Vector3(
            (x - offset) * spacing,
            (y - offset) * spacing,
            (z - offset) * spacing
        );
        
        // Place the piece back on the board data structure
        this.board.placePiece(x, y, z, playerColor);
        
        // Get the player who made the move
        const player = playerColor === 'black' ? this.playerBlack : this.playerWhite;
        
        // Create a visual representation of the piece
        const pieceMesh = player.createPiece();
        pieceMesh.position.copy(position);
        this.scene.add(pieceMesh);
        
        // Store reference to the mesh in the board data structure
        const boardPiece = this.board.getPieceAt(x, y, z);
        if (boardPiece) {
            boardPiece.mesh = pieceMesh;
        }
        
        // Remove the captured pieces from the board again
        for (const capture of redoMove.captures) {
            const capturedPiece = this.board.getPieceAt(capture.x, capture.y, capture.z);
            if (capturedPiece && capturedPiece.mesh) {
                // Remove the piece visually from the scene
                this.scene.remove(capturedPiece.mesh);
                // Remove the piece from the board data structure
                this.board.board[capture.x][capture.y][capture.z] = null;
            }
        }
        
        // Restore capture counts from the redoMove
        this.playerBlack.captures = playerColor === 'black' ? redoMove.playerCaptures : redoMove.opponentCaptures;
        this.playerWhite.captures = playerColor === 'white' ? redoMove.playerCaptures : redoMove.opponentCaptures;
        this.updateCaptureDisplay();
        
        // Switch to the next player
        this.currentPlayer = playerColor === 'black' ? this.playerWhite : this.playerBlack;
        this.playerIndicator.textContent = this.currentPlayer.color.charAt(0).toUpperCase() + this.currentPlayer.color.slice(1);
        
        // Check if this was a winning move
        if (playerColor === 'black' && this.playerBlack.captures >= 5 || 
            playerColor === 'white' && this.playerWhite.captures >= 5) {
            // Win by capture
            this.endGame(`${playerColor.charAt(0).toUpperCase() + playerColor.slice(1)} wins by capture!`);
            return;
        }
        
        // Check for win by five in a row (would need to run checkWin again)
        const winningLine = this.board.checkWin(x, y, z, playerColor);
        if (winningLine.length >= 5) {
            this.winningLine = winningLine;
            this.highlightWinningLine();
            this.endGame(`${playerColor.charAt(0).toUpperCase() + playerColor.slice(1)} wins with 5 in a row!`);
        }
    }
    
    switchPlayer() {
        this.currentPlayer = this.currentPlayer === this.playerBlack ? this.playerWhite : this.playerBlack;
        this.playerIndicator.textContent = this.currentPlayer.color.charAt(0).toUpperCase() + this.currentPlayer.color.slice(1);
    }
    
    updateCaptureDisplay() {
        this.blackCaptureCount.textContent = this.playerBlack.captures;
        this.whiteCaptureCount.textContent = this.playerWhite.captures;
    }
    
    highlightWinningLine() {
        // Create a line geometry to highlight the winning line
        if (this.winningLine && this.winningLine.length >= 5) {
            const points = this.winningLine.map(pos => {
                const x = pos.x - (this.boardSize - 1) / 2;
                const y = pos.y - (this.boardSize - 1) / 2;
                const z = pos.z - (this.boardSize - 1) / 2;
                return new THREE.Vector3(x, y, z);
            });
            
            const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
            const lineMaterial = new THREE.LineBasicMaterial({
                color: 0xffff00,
                linewidth: 5
            });
            
            const line = new THREE.Line(lineGeometry, lineMaterial);
            this.scene.add(line);
            
            // Animate the winning pieces
            for (const pos of this.winningLine) {
                const piece = this.board.getPieceAt(pos.x, pos.y, pos.z);
                if (piece && piece.mesh) {
                    // Create a pulsing animation
                    const originalScale = piece.mesh.scale.clone();
                    const animate = () => {
                        if (!this.isGameOver) return;
                        
                        const pulse = 0.2 * Math.sin(Date.now() * 0.005) + 1;
                        piece.mesh.scale.set(
                            originalScale.x * pulse,
                            originalScale.y * pulse,
                            originalScale.z * pulse
                        );
                        
                        requestAnimationFrame(animate);
                    };
                    
                    animate();
                }
            }
        }
    }
    
    endGame(message) {
        // Remove any temporary piece
        this.removeTemporaryPiece();
        
        this.isGameOver = true;
        this.gameMessage.textContent = message;
        this.gameMessage.classList.remove('hidden');
    }
    
    reset() {
        // Remove all pieces from the scene
        this.board.forEachPiece((piece) => {
            if (piece && piece.mesh) {
                this.scene.remove(piece.mesh);
            }
        });
        
        // Clear the board data
        this.board = new Board(this.boardSize);
        
        // Reference to the game for settings
        this.board.game = this;
        
        // Remove the old board mesh and create a new one
        if (this.boardMesh) {
            this.scene.remove(this.boardMesh);
        }
        this.boardMesh = this.board.createBoardMesh();
        this.scene.add(this.boardMesh);
        
        // Reset players
        this.playerBlack.captures = 0;
        this.playerWhite.captures = 0;
        this.currentPlayer = this.playerBlack;
        this.playerIndicator.textContent = this.currentPlayer.color.charAt(0).toUpperCase() + this.currentPlayer.color.slice(1);
        
        // Reset capture display
        this.updateCaptureDisplay();
        
        // Reset game state
        this.isGameOver = false;
        this.winningLine = null;
        
        // Clear move history and redo history
        this.moveHistory = [];
        this.redoHistory = [];
        
        // Disable undo and redo buttons
        this.undoButton.disabled = true;
        this.redoButton.disabled = true;
        
        // Remove any temporary piece
        this.removeTemporaryPiece();
        
        // Remove diagonal gridlines if they exist
        if (this.diagonalGridLines.length > 0) {
            console.log('Removing diagonal gridlines during reset');
            for (const line of this.diagonalGridLines) {
                this.scene.remove(line);
            }
            this.diagonalGridLines = [];
        }
        
        // Reset diagonal visibility flag
        this.isDiagonalGridVisible = false;
        
        // Update indicator
        if (this.diagonalIndicator) {
            this.diagonalIndicator.classList.add('hidden');
        }
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Update controls
        this.controls.update();
        
        // Ensure grid lines and nodes maintain their colors
        this.maintainGridLineColors();
        this.maintainNodeColors();
        
        // Render the scene
        this.renderer.render(this.scene, this.camera);
    }
    
    // Helper method to ensure grid line colors are preserved
    maintainGridLineColors() {
        // If we have custom grid line settings, make sure they're applied
        if (this.board && this.board.gridLines && this.gridlineHoverSettings) {
            const gridlineOpacity = 1 - ((this.gridlineTranslucency || 50) / 100);
            const gridlineColor = this.gridlineColor || "#444444";
            
            // Check each grid line to ensure it has the correct color if not being hovered
            for (const line of this.board.gridLines) {
                // Skip lines that are currently highlighted (being hovered)
                if (line && line.material && 
                    line.material.opacity !== this.gridlineHoverSettings.opacity) {
                    
                    // This is not a highlighted line, ensure it has the correct base color
                    if (line.material.color.getHexString() !== gridlineColor.replace('#', '')) {
                        line.material.color.set(gridlineColor);
                        line.material.opacity = gridlineOpacity;
                    }
                }
            }
        }
    }
    
    // Helper method to ensure node colors are preserved
    maintainNodeColors() {
        // If we have custom node settings, make sure they're applied
        if (this.board && this.board.intersectionPoints && this.nodeHoverSettings) {
            const nodeOpacity = 1 - ((this.nodeTranslucency || 50) / 100);
            const nodeColor = this.nodeColor || "#888888";
            
            // Check each node to ensure it has the correct color if not being hovered
            for (const node of this.board.intersectionPoints) {
                // Skip nodes that are currently highlighted (being hovered)
                if (node && node.material && 
                    node.material.opacity !== this.nodeHoverSettings.opacity) {
                    
                    // This is not a highlighted node, ensure it has the correct base color
                    if (node.material.color.getHexString() !== nodeColor.replace('#', '')) {
                        node.material.color.set(nodeColor);
                        node.material.opacity = nodeOpacity;
                    }
                }
            }
        }
    }
}