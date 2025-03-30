import * as THREE from 'three';
import { Board } from './board.js';

// Game settings manager
export class Settings {
    constructor(game) {
        this.game = game;
        
        // Default settings
        this.defaults = {
            backgroundColor: '#222222',
            nodeSpacing: 1.0,
            blackColor: '#111111',
            whiteColor: '#ffffff',
            pieceTranslucency: 15,
            nodeColor: '#888888',
            nodeTranslucency: 50,
            hoverNodeColor: '#ffcc00',
            hoverNodeTranslucency: 20,
            gridlineColor: '#444444',
            gridlineDiameter: 0.02,
            gridlineTranslucency: 50,
            hoverGridlineColor: '#00ff00',
            hoverGridlineTranslucency: 20
        };
        
        // Current settings (start with defaults)
        this.current = {...this.defaults};
        
        // Initialize after DOM is fully loaded
        this.initializeElements();
    }
    
    initializeElements() {
        // Get all required DOM elements
        this.panel = document.getElementById('settings-panel');
        this.settingsButton = document.getElementById('settings-button');
        this.closeButton = document.querySelector('.close-button');
        this.saveButton = document.getElementById('save-settings');
        this.resetButton = document.getElementById('reset-settings');
        
        if (!this.panel || !this.settingsButton || !this.closeButton || 
            !this.saveButton || !this.resetButton) {
            console.error("Settings panel elements not found in DOM");
            return;
        }
        
        // Initialize event listeners
        this.initEventListeners();
        this.initSettingListeners();
    }
    
    initEventListeners() {
        // Settings button opens the panel
        this.settingsButton.addEventListener('click', () => {
            this.panel.classList.add('open');
        });
        
        // Close button closes the panel
        this.closeButton.addEventListener('click', () => {
            this.closePanel();
        });
        
        // Save button applies settings
        this.saveButton.addEventListener('click', () => {
            this.saveSettings();
            // Keep the panel open to see the changes
        });
        
        // Reset button resets to defaults
        this.resetButton.addEventListener('click', () => {
            this.resetToDefaults();
        });
        
        // Close panel when clicking outside
        document.addEventListener('mousedown', (event) => {
            // Check if panel is open and click was outside the panel
            if (this.panel.classList.contains('open') && 
                !this.panel.contains(event.target) && 
                event.target !== this.settingsButton &&
                !this.settingsButton.contains(event.target)) {
                this.closePanel();
            }
        });
        
        // Close panel with Escape key
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.panel.classList.contains('open')) {
                this.closePanel();
            }
        });
    }
    
    // Helper method to close panel
    closePanel() {
        this.panel.classList.remove('open');
    }
    
    initSettingListeners() {
        // For each input, update display value and/or preview
        const inputs = document.querySelectorAll('.setting-item input');
        
        if (!inputs || inputs.length === 0) {
            console.error("No setting inputs found");
            return;
        }
        
        inputs.forEach(input => {
            // Initial value display
            if (input.type === 'range') {
                const valueDisplay = input.nextElementSibling;
                if (valueDisplay) {
                    valueDisplay.textContent = input.id === 'gridline-diameter' 
                        ? input.value.padStart(5, '0')
                        : input.value + (input.id.includes('translucency') ? '%' : '');
                }
            }
            
            // Real-time update handling
            const handleChange = () => {
                // Update display for range inputs
                if (input.type === 'range') {
                    const valueDisplay = input.nextElementSibling;
                    if (valueDisplay) {
                        valueDisplay.textContent = input.id === 'gridline-diameter' 
                            ? input.value.padStart(5, '0')
                            : input.value + (input.id.includes('translucency') ? '%' : '');
                    }
                }
                
                // Apply the change immediately
                this.updateCurrentSetting(input.id, input.value);
            };
            
            // For real-time updates during dragging
            input.addEventListener('input', handleChange);
            
            // For final change when control is released
            input.addEventListener('change', () => {
                handleChange();
                // Save to localStorage for persistence
                this.saveToLocalStorage();
            });
        });
    }
    
    updateCurrentSetting(id, value) {
        // Update the current settings object with this new value
        switch (id) {
            case 'background-color':
                this.current.backgroundColor = value;
                break;
            case 'node-spacing':
                this.current.nodeSpacing = parseFloat(value);
                break;
            case 'black-color':
                this.current.blackColor = value;
                break;
            case 'white-color':
                this.current.whiteColor = value;
                break;
            case 'piece-translucency':
                this.current.pieceTranslucency = parseInt(value);
                break;
            case 'node-color':
                this.current.nodeColor = value;
                break;
            case 'node-translucency':
                this.current.nodeTranslucency = parseInt(value);
                break;
            case 'hover-node-color':
                this.current.hoverNodeColor = value;
                break;
            case 'hover-node-translucency':
                this.current.hoverNodeTranslucency = parseInt(value);
                break;
            case 'gridline-color':
                this.current.gridlineColor = value;
                break;
            case 'gridline-diameter':
                this.current.gridlineDiameter = parseFloat(value);
                break;
            case 'gridline-translucency':
                this.current.gridlineTranslucency = parseInt(value);
                break;
            case 'hover-gridline-color':
                this.current.hoverGridlineColor = value;
                break;
            case 'hover-gridline-translucency':
                this.current.hoverGridlineTranslucency = parseInt(value);
                break;
        }
        
        // Apply the updated settings to the game
        this.applySettings();
    }
    
    saveToLocalStorage() {
        // Save current settings to localStorage
        localStorage.setItem('pente3d_settings', JSON.stringify(this.current));
    }
    
    // Removed preview method - now using direct apply via updateCurrentSetting
    
    saveSettings() {
        // Get all current form values
        document.querySelectorAll('.setting-item input').forEach(input => {
            // Update each setting based on current form value
            this.updateCurrentSetting(input.id, input.value);
        });
        
        // Save to localStorage
        this.saveToLocalStorage();
        
        // Confirm save with visual feedback (optional)
        const saveButton = document.getElementById('save-settings');
        if (saveButton) {
            const originalText = saveButton.textContent;
            saveButton.textContent = "✓ Saved!";
            setTimeout(() => {
                saveButton.textContent = originalText;
            }, 1000);
        }
    }
    
    loadSettings() {
        // Attempt to load from localStorage
        const savedSettings = localStorage.getItem('pente3d_settings');
        if (savedSettings) {
            try {
                const settings = JSON.parse(savedSettings);
                this.current = {...this.defaults, ...settings};
                
                // Update form values
                this.updateFormValues();
                
                // Apply settings to game
                this.applySettings();
            } catch (e) {
                console.error('Error loading settings:', e);
                this.resetToDefaults();
            }
        } else {
            this.resetToDefaults();
        }
    }
    
    resetToDefaults() {
        // Reset current settings to defaults
        this.current = {...this.defaults};
        
        // Update form values
        this.updateFormValues();
        
        // Apply default settings
        this.applySettings();
        
        // Save defaults to localStorage
        localStorage.setItem('pente3d_settings', JSON.stringify(this.defaults));
    }
    
    updateFormValues() {
        // Update all form inputs with current settings
        document.getElementById('background-color').value = this.current.backgroundColor;
        document.getElementById('node-spacing').value = this.current.nodeSpacing;
        document.getElementById('black-color').value = this.current.blackColor;
        document.getElementById('white-color').value = this.current.whiteColor;
        document.getElementById('piece-translucency').value = this.current.pieceTranslucency;
        document.getElementById('node-color').value = this.current.nodeColor;
        document.getElementById('node-translucency').value = this.current.nodeTranslucency;
        document.getElementById('hover-node-color').value = this.current.hoverNodeColor;
        document.getElementById('hover-node-translucency').value = this.current.hoverNodeTranslucency;
        document.getElementById('gridline-color').value = this.current.gridlineColor;
        document.getElementById('gridline-diameter').value = this.current.gridlineDiameter;
        document.getElementById('gridline-translucency').value = this.current.gridlineTranslucency;
        document.getElementById('hover-gridline-color').value = this.current.hoverGridlineColor;
        document.getElementById('hover-gridline-translucency').value = this.current.hoverGridlineTranslucency;
        
        // Update text display for range inputs
        document.querySelectorAll('.setting-item input[type="range"]').forEach(input => {
            const valueDisplay = input.nextElementSibling;
            valueDisplay.textContent = input.id === 'gridline-diameter' 
                ? input.value.padStart(5, '0')
                : input.value + (input.id.includes('translucency') ? '%' : '');
        });
    }
    
    // Removed preview method - now applying settings directly
    
    applySettings() {
        // Apply all settings to the game
        this.applySettingsToGame(this.current);
    }
    
    applySettingsToGame(settings) {
        // Ensure game and all required properties exist
        if (!this.game || !this.game.scene) {
            console.error("Game or scene not available");
            return;
        }
            
        // Apply background color
        this.game.scene.background = new THREE.Color(settings.backgroundColor);
        
        // Store the node spacing setting in the game object
        this.game.nodeSpacing = settings.nodeSpacing;
        
        // Check if node spacing has changed - will be true even on first change
        const nodeSpacingChanged = this.game.prevNodeSpacing === undefined || 
                                   this.game.prevNodeSpacing !== settings.nodeSpacing;
        
        // If node spacing changed, we need to rebuild the board
        if (nodeSpacingChanged) {
            // Store pieces temporarily
            const pieces = [];
            if (this.game.board) {
                this.game.board.forEachPiece((piece, x, y, z) => {
                    pieces.push({
                        x, y, z, 
                        color: piece.color
                    });
                });
            }
            
            // Remove existing board and pieces
            if (this.game.boardMesh) {
                this.game.scene.remove(this.game.boardMesh);
            }
            
            // Create a new board with proper spacing
            const oldBoardSize = this.game.board ? this.game.board.size : this.game.boardSize;
            this.game.board = new Board(oldBoardSize);
            this.game.board.game = this.game;
            
            // Create and add new board mesh
            this.game.boardMesh = this.game.board.createBoardMesh();
            this.game.scene.add(this.game.boardMesh);
            
            // Find the node positions in the newly created board
            const findNodeByCoords = (x, y, z) => {
                for (const node of this.game.board.intersectionPoints) {
                    if (node.userData && 
                        node.userData.x === x && 
                        node.userData.y === y && 
                        node.userData.z === z) {
                        return node;
                    }
                }
                return null;
            };
            
            // Restore pieces
            for (const piece of pieces) {
                if (this.game.board.placePiece(piece.x, piece.y, piece.z, piece.color)) {
                    const player = piece.color === 'black' ? this.game.playerBlack : this.game.playerWhite;
                    const pieceMesh = player.createPiece();
                    
                    // Find the exact node where this piece should be placed
                    const node = findNodeByCoords(piece.x, piece.y, piece.z);
                    
                    if (node) {
                        // Use the node's exact position
                        pieceMesh.position.copy(node.position);
                    } else {
                        // Fallback to calculated position
                        const offset = (this.game.board.size - 1) / 2;
                        const position = new THREE.Vector3(
                            (piece.x - offset) * settings.nodeSpacing,
                            (piece.y - offset) * settings.nodeSpacing,
                            (piece.z - offset) * settings.nodeSpacing
                        );
                        pieceMesh.position.copy(position);
                    }
                    
                    this.game.scene.add(pieceMesh);
                    
                    // Store reference to the mesh
                    const boardPiece = this.game.board.getPieceAt(piece.x, piece.y, piece.z);
                    if (boardPiece) {
                        boardPiece.mesh = pieceMesh;
                    }
                }
            }
            
            // Store current spacing for future comparison
            this.game.prevNodeSpacing = settings.nodeSpacing;
        }
        
        // Apply piece translucency to any existing pieces
        const pieceOpacity = 1 - (settings.pieceTranslucency / 100);
        if (this.game.board && typeof this.game.board.forEachPiece === 'function') {
            this.game.board.forEachPiece(piece => {
                if (piece && piece.mesh) {
                    piece.mesh.material.opacity = pieceOpacity;
                    
                    // Update piece colors
                    if (piece.color === 'black') {
                        piece.mesh.material.color.set(settings.blackColor);
                    } else {
                        piece.mesh.material.color.set(settings.whiteColor);
                    }
                }
            });
        }
        
        // Store settings for future piece creation
        this.game.pieceSettings = {
            blackColor: settings.blackColor,
            whiteColor: settings.whiteColor,
            opacity: pieceOpacity
        };
        
        // Apply node settings if intersection points exist
        if (this.game.board && this.game.board.intersectionPoints) {
            const nodeOpacity = 1 - (settings.nodeTranslucency / 100);
            
            // Store node settings in game object for persistence
            this.game.nodeColor = settings.nodeColor;
            this.game.nodeTranslucency = settings.nodeTranslucency;
            
            for (const point of this.game.board.intersectionPoints) {
                if (point && point.material) {
                    point.material.color.set(settings.nodeColor);
                    point.material.opacity = nodeOpacity;
                }
            }
        }
        
        // Store hover node settings
        this.game.nodeHoverSettings = {
            color: settings.hoverNodeColor,
            opacity: 1 - (settings.hoverNodeTranslucency / 100)
        };
        
        // Apply grid line settings if grid lines exist
        if (this.game.board && this.game.board.gridLines) {
            const gridlineOpacity = 1 - (settings.gridlineTranslucency / 100);
            
            // Store grid line settings in game object for persistence
            this.game.gridlineColor = settings.gridlineColor;
            this.game.gridlineTranslucency = settings.gridlineTranslucency;
            
            for (const line of this.game.board.gridLines) {
                if (line && line.material) {
                    line.material.color.set(settings.gridlineColor);
                    line.material.opacity = gridlineOpacity;
                    
                    // Adjust grid line diameter - this is more complex and would require recreating the cylinders
                    // For simplicity in this preview, we're just scaling them
                    if (typeof settings.gridlineDiameter === 'number') {
                        const scale = settings.gridlineDiameter / 0.02; // 0.02 is the default diameter
                        line.scale.set(scale, 1, scale);
                    }
                }
            }
        }
        
        // Store hover gridline settings
        this.game.gridlineHoverSettings = {
            color: settings.hoverGridlineColor,
            opacity: 1 - (settings.hoverGridlineTranslucency / 100)
        };
    }
}