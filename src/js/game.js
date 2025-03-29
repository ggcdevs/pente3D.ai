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
        
        this.nodeHoverSettings = {
            opacity: 0.8
        };
        
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
        
        // Scene setup
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        
        // Raycaster for mouse interaction
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
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
        this.animate();
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
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
    }
    
    createBoard() {
        // Create the board visualization
        this.boardMesh = this.board.createBoardMesh();
        this.scene.add(this.boardMesh);
    }
    
    setupEventListeners() {
        this.renderer.domElement.addEventListener('mousemove', this.handleMouseMove);
        this.renderer.domElement.addEventListener('click', this.handleMouseClick);
    }
    
    handleMouseMove(event) {
        if (this.isGameOver) return;
        
        // Calculate mouse position
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        // Update the hover effect
        this.updateHoverPoint();
    }
    
    handleMouseClick(event) {
        if (this.isGameOver) return;
        
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
                    firstObject.material.color.set(this.currentPlayer.color);
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
        const x = Math.round(position.x + (this.boardSize - 1) / 2);
        const y = Math.round(position.y + (this.boardSize - 1) / 2);
        const z = Math.round(position.z + (this.boardSize - 1) / 2);
        
        // Place the piece on the board data structure
        if (this.board.placePiece(x, y, z, this.currentPlayer.color)) {
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
                        // Remove the piece visually from the scene
                        this.scene.remove(capturedPiece.mesh);
                        // Remove the piece from the board data structure
                        this.board.board[capturedPos.x][capturedPos.y][capturedPos.z] = null;
                    }
                }
                
                // Increment capture count - one per capture event, not per piece
                this.currentPlayer.captures += 1;
                
                // Update the capture counts
                this.updateCaptureDisplay();
                
                // Check for win by capture
                if (this.currentPlayer.captures >= 5) {
                    this.endGame(`${this.currentPlayer.color.charAt(0).toUpperCase() + this.currentPlayer.color.slice(1)} wins by capture!`);
                    return;
                }
            }
            
            // Check for win by five in a row
            const winningLine = this.board.checkWin(x, y, z, this.currentPlayer.color);
            if (winningLine.length >= 5) {
                this.winningLine = winningLine;
                this.highlightWinningLine();
                this.endGame(`${this.currentPlayer.color.charAt(0).toUpperCase() + this.currentPlayer.color.slice(1)} wins with 5 in a row!`);
                return;
            }
            
            // Switch players
            this.switchPlayer();
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
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Update controls
        this.controls.update();
        
        // Render the scene
        this.renderer.render(this.scene, this.camera);
    }
}