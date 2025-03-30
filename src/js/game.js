import * as THREE from 'three';
import { Board } from './board.js';
import { Player } from './player.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Utility } from './utility.js';

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
        
        // Diagonals are diagonal
        this.isPerfectDiagonalsVisible = false;
        this.perfectDiagonals = [];
        
        // Temporary piece tracking
        this.temporaryPiece = null;
        this.temporaryPiecePosition = null;
        
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
            console.log('d key pressed - toggling diagonals');
            // Toggle diagonals with each press of the 'd' key
            this.togglePerfectDiagonals();
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

    toggleBoardVisibility() {
        console.log('Toggling board visibility. Grid visible:', this.isGridVisible, 'Nodes visible:', this.isNodesVisible);
        
        if (this.board && this.board.gridLines) {
            for (const line of this.board.gridLines) {
                line.visible = this.isGridVisible;
            }
        }

        if (this.board && this.board.intersectionPoints) {
            for (const point of this.board.intersectionPoints) {
                point.visible = this.isNodesVisible;
            }
        }

        // Add diagonals visibility toggle here
        if (this.perfectDiagonals) {
            for (const diagonal of this.perfectDiagonals) {
                diagonal.visible = this.isGridVisible; // tied to the grid visibility
            }
        }

        // Update view mode indicator
        Utility.toggleElementVisibility(
            this.viewModeIndicator, 
            !this.isGridVisible && !this.isNodesVisible
        );
    }

    // Helper to ensure a point is strictly within the grid bounds
    clampPointToBounds(point, min, max) {
        return Utility.clampPointToBounds(point, min, max);
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
        Utility.toggleElementVisibility(this.tempPieceIndicator, true);
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
            Utility.toggleElementVisibility(this.tempPieceIndicator, false);
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
    
    // Method to reset all hover highlighting
    resetHoverState() {
        // Reset basic hover state using the board's method
        this.board.resetHoverState();
    }

    highlightDiagonalLine(diagonalLine) {
        // Set highlighting color and opacity
        diagonalLine.material.color.set(this.gridlineHoverSettings.color);
        diagonalLine.material.opacity = this.gridlineHoverSettings.opacity;

        // Highlight pieces on this diagonal line
        const threshold = 0.1; // Adjust tolerance
        const lineStart = diagonalLine.geometry.boundingSphere.center.clone().applyMatrix4(diagonalLine.matrixWorld);
        const lineEnd = lineStart.clone().add(
            new THREE.Vector3(0, diagonalLine.geometry.parameters.height, 0)
                .applyQuaternion(diagonalLine.quaternion)
        );

        this.board.forEachPiece(piece => {
            if (piece && piece.mesh) {
                const point = piece.mesh.position;
                if (Utility.distancePointToLine(point, lineStart, lineEnd) < threshold) {
                    // Highlight the piece with an emissive glow
                    piece.mesh.material.emissive = new THREE.Color(this.nodeHoverSettings.color);
                    piece.mesh.material.emissiveIntensity = 0.8;
                }
            }
        });
    }

    // Helper method to calculate distance from a point to a line segment
    distancePointToLine(point, lineStart, lineEnd) {
        return Utility.distancePointToLine(point, lineStart, lineEnd);
    }

    updateHoverPoint() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        this.resetHoverState();
        this.hoveredPoint = null;

        const allObjects = [
            ...this.board.intersectionPoints,
            ...this.board.gridLines,
            ...this.perfectDiagonals
        ];

        const intersects = this.raycaster.intersectObjects(allObjects);

        if (intersects.length > 0) {
            const firstObject = intersects[0].object;

            const isPointIntersection = this.board.intersectionPoints.includes(firstObject);
            const isDiagonalIntersection = this.perfectDiagonals.includes(firstObject);

            if (isPointIntersection) {
                if (!this.board.isOccupied(firstObject.position)) {
                    firstObject.material.color.set(this.nodeHoverSettings.color);
                    firstObject.material.opacity = this.nodeHoverSettings.opacity;
                    this.hoveredPoint = firstObject;
                    this.board.highlightIntersectingLines(firstObject);
                    this.highlightConnectedDiagonals(firstObject.position);
                }
            } else if (firstObject.userData?.type === 'line') {
                this.board.highlightGridLine(firstObject);
            } else if (isDiagonalIntersection) {
                this.highlightDiagonalLine(firstObject);
            }
        }
    }

    highlightConnectedDiagonals(nodePosition) {
        const threshold = 0.1; // Sensitivity threshold
        for (const diagonal of this.perfectDiagonals) {
            const start = diagonal.geometry.boundingSphere.center.clone().applyMatrix4(diagonal.matrixWorld);
            const end = start.clone().add(
                new THREE.Vector3(0, diagonal.geometry.parameters.height, 0)
                    .applyQuaternion(diagonal.quaternion)
            );
            if (Utility.isPointOnLine(nodePosition, start, end, threshold)) {
                diagonal.material.color.set(this.gridlineHoverSettings.color);
                diagonal.material.opacity = this.gridlineHoverSettings.opacity;
            }
        }
    }

    resetHoverState() {
        this.board.resetHoverState();
    
        for (const diagonal of this.perfectDiagonals) {
            diagonal.material.color.set(this.gridlineColor);
            diagonal.material.opacity = 1 - ((this.gridlineTranslucency || 50) / 100);
        }
    
        this.board.forEachPiece(piece => {
            if (piece?.mesh) {
                piece.mesh.material.emissive = new THREE.Color(0x000000);
                piece.mesh.material.emissiveIntensity = 0;
            }
        });
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
        
        if (this.playerIndicator) {
            // Change player indicator background based on current player
            if (this.currentPlayer === this.playerBlack) {
                this.playerIndicator.style.backgroundColor = 'rgba(30, 30, 30, 0.5)';
            } else {
                this.playerIndicator.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
            }
            this.playerIndicator.textContent = this.currentPlayer.color.charAt(0).toUpperCase() + this.currentPlayer.color.slice(1);
        }
        
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
        
        if (this.playerIndicator) {
            // Change player indicator background based on current player
            if (this.currentPlayer === this.playerBlack) {
                this.playerIndicator.style.backgroundColor = 'rgba(30, 30, 30, 0.5)';
            } else {
                this.playerIndicator.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
            }
            this.playerIndicator.textContent = this.currentPlayer.color.charAt(0).toUpperCase() + this.currentPlayer.color.slice(1);
        }
        
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
        
        if (this.playerIndicator) {
            // Change player indicator background based on current player
            if (this.currentPlayer === this.playerBlack) {
                this.playerIndicator.style.backgroundColor = 'rgba(30, 30, 30, 0.5)';
            } else {
                this.playerIndicator.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
            }
            
            // Update text with capitalized player color
            this.playerIndicator.textContent = this.currentPlayer.color.charAt(0).toUpperCase() + this.currentPlayer.color.slice(1);
        }
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
        
        // Show game over message
        if (this.gameMessage) {
            this.gameMessage.textContent = message;
            Utility.toggleElementVisibility(this.gameMessage, true);
        }
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
        
        // Set the player indicator back to black and update text
        if (this.playerIndicator) {
            this.playerIndicator.style.backgroundColor = 'rgba(30, 30, 30, 0.5)';
            this.playerIndicator.textContent = this.currentPlayer.color.charAt(0).toUpperCase() + this.currentPlayer.color.slice(1);
        }
        
        // Reset capture display
        this.updateCaptureDisplay();
        
        // Reset game state
        this.isGameOver = false;
        this.winningLine = null;
        
        // Hide game message
        Utility.toggleElementVisibility(this.gameMessage, false);
        
        // Clear move history and redo history
        this.moveHistory = [];
        this.redoHistory = [];
        
        // Disable undo and redo buttons
        this.undoButton.disabled = true;
        this.redoButton.disabled = true;
        
        // Remove any temporary piece
        this.removeTemporaryPiece();
        
        // Recreate perfect diagonals if they were visible
        if (this.isPerfectDiagonalsVisible) {
            this.createPerfectDiagonals();
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

    createDiagonalCylinder(start, end) {
        const spacing = this.nodeSpacing || 1.0;
        const radius = 0.02 * spacing;
        const color = this.gridlineColor || '#444444';
        const opacity = 1 - ((this.gridlineTranslucency || 50) / 100);
        
        // Create cylinder using utility function
        const cylinder = Utility.createCylinderLine(start, end, color, radius, opacity);
        
        // Add to scene and track in perfectDiagonals array
        this.scene.add(cylinder);
        this.perfectDiagonals.push(cylinder);
        
        return cylinder;
    }

    createPerfectDiagonals() {
        const size = this.boardSize; // 9x9x9
        const spacing = this.nodeSpacing || 1.0;
        const offset = (size - 1) / 2;

        // Clear existing diagonals first
        for (const line of this.perfectDiagonals) {
            this.scene.remove(line);
        }
        this.perfectDiagonals = [];

        const directions = [
            [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
            [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]
        ];

        const visitedLines = new Set();

        const isValidCoord = (x, y, z) =>
            x >= 0 && x < size && y >= 0 && y < size && z >= 0 && z < size;

        const coordToWorld = (x, y, z) => new THREE.Vector3(
            (x - offset) * spacing,
            (y - offset) * spacing,
            (z - offset) * spacing
        );

        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                for (let z = 0; z < size; z++) {
                    for (const [dx, dy, dz] of directions) {
                        // Move backwards to find start of diagonal
                        let nx = x, ny = y, nz = z;
                        while (isValidCoord(nx - dx, ny - dy, nz - dz)) {
                            nx -= dx; ny -= dy; nz -= dz;
                        }
                        const startKey = `${nx},${ny},${nz}`;

                        // Move forward to find end of diagonal
                        let ex = nx, ey = ny, ez = nz;
                        while (isValidCoord(ex + dx, ey + dy, ez + dz)) {
                            ex += dx; ey += dy; ez += dz;
                        }
                        const endKey = `${ex},${ey},${ez}`;

                        // Avoid duplicate lines
                        const lineKey = [startKey, endKey].sort().join('-');
                        if (visitedLines.has(lineKey)) continue;
                        visitedLines.add(lineKey);

                        const worldStart = coordToWorld(nx, ny, nz);
                        const worldEnd = coordToWorld(ex, ey, ez);

                        this.createDiagonalCylinder(worldStart, worldEnd);
                    }
                }
            }
        }
    }

    // Ensure the toggling method uses this correctly:
    togglePerfectDiagonals() {
        this.isPerfectDiagonalsVisible = !this.isPerfectDiagonalsVisible;

        if (this.isPerfectDiagonalsVisible) {
            this.createPerfectDiagonals();
        } else {
            for (const line of this.perfectDiagonals) {
                this.scene.remove(line);
            }
            this.perfectDiagonals = [];
        }
        
        // Update the visual indicator
        Utility.updateIndicator(
            'diagonal-indicator', 
            'Perfect Diagonals (D to toggle)', 
            this.isPerfectDiagonalsVisible
        );
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
