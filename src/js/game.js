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
        
        // Game history for undo functionality
        this.moveHistory = [];
        
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
        this.animate();
    }
    
    setupGameControls() {
        // Set initial state of undo button
        this.undoButton.disabled = true;
        
        // Setup undo button click handler
        this.undoButton.addEventListener('click', () => this.undoLastMove());
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
        
        // Handle key presses for shift key
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Shift') {
                // Show grabbing cursor when shift is held (ready to pan)
                if (this.isMouseOverCanvas) {
                    this.renderer.domElement.style.cursor = 'grab';
                }
            }
        });
        
        document.addEventListener('keyup', (event) => {
            if (event.key === 'Shift') {
                // Reset cursor when shift is released
                if (this.isMouseOverCanvas) {
                    this.renderer.domElement.style.cursor = 'default';
                }
            }
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
    
    handleMouseMove(event) {
        if (this.isGameOver) return;
        
        // Skip hover effects during navigation (Fusion 360 style)
        // Skip for middle-click (orbit), shift+left-click (pan), or right-click (zoom)
        if (event.buttons === 4 ||                         // Middle button
            (event.buttons === 1 && event.shiftKey) ||     // Left button + Shift
            event.buttons === 2) {                         // Right button
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
        if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.altKey) return;
        
        // Calculate mouse position
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        // Place a stone at the hovered position
        this.placePiece();
    }
    
    updateHoverPoint() {
        // Update the raycaster
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Reset previous hover state
        this.board.resetHoverState();
        this.hoveredPoint = null;
        
        // Get all objects (points and lines) and check intersections
        const allObjects = [...this.board.intersectionPoints, ...this.board.gridLines];
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
                }
            } else {
                // It's a grid line
                this.board.highlightGridLine(firstObject);
            }
        }
    }
    
    placePiece() {
        if (!this.hoveredPoint) return;
        
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
                this.currentPlayer.captures += captures.length;
                
                // Update the capture counts
                this.updateCaptureDisplay();
                
                // Check for win by capture
                if (this.currentPlayer.captures >= 5) {
                    // Still record the move in history
                    this.moveHistory.push(moveData);
                    this.undoButton.disabled = false;
                    
                    this.endGame(`${this.currentPlayer.color.charAt(0).toUpperCase() + this.currentPlayer.color.slice(1)} wins by capture!`);
                    return;
                }
            }
            
            // Check for win by five in a row
            const winningLine = this.board.checkWin(x, y, z, this.currentPlayer.color);
            if (winningLine.length >= 5) {
                // Still record the move in history
                this.moveHistory.push(moveData);
                this.undoButton.disabled = false;
                
                this.winningLine = winningLine;
                this.highlightWinningLine();
                this.endGame(`${this.currentPlayer.color.charAt(0).toUpperCase() + this.currentPlayer.color.slice(1)} wins with 5 in a row!`);
                return;
            }
            
            // Add the move to history
            this.moveHistory.push(moveData);
            
            // Enable the undo button
            this.undoButton.disabled = false;
            
            // Switch players
            this.switchPlayer();
        }
    }
    
    undoLastMove() {
        if (this.moveHistory.length === 0 || this.isGameOver) return;
        
        // Get the last move from history
        const lastMove = this.moveHistory.pop();
        
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
        
        // Clear move history and disable undo button
        this.moveHistory = [];
        this.undoButton.disabled = true;
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