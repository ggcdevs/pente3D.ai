import * as THREE from 'three';

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
            this.panel.classList.remove('open');
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
            
            // Update value display when input changes
            input.addEventListener('input', (e) => {
                if (input.type === 'range') {
                    const valueDisplay = input.nextElementSibling;
                    if (valueDisplay) {
                        valueDisplay.textContent = input.id === 'gridline-diameter' 
                            ? input.value.padStart(5, '0')
                            : input.value + (input.id.includes('translucency') ? '%' : '');
                    }
                }
                
                // Preview the change
                this.previewSetting(input.id, input.value);
            });
        });
    }
    
    previewSetting(id, value) {
        // Create a temporary object to preview the setting
        const setting = {};
        
        switch (id) {
            case 'background-color':
                setting.backgroundColor = value;
                break;
            case 'node-spacing':
                setting.nodeSpacing = parseFloat(value);
                break;
            case 'black-color':
                setting.blackColor = value;
                break;
            case 'white-color':
                setting.whiteColor = value;
                break;
            case 'piece-translucency':
                setting.pieceTranslucency = parseInt(value);
                break;
            case 'node-color':
                setting.nodeColor = value;
                break;
            case 'node-translucency':
                setting.nodeTranslucency = parseInt(value);
                break;
            case 'hover-node-translucency':
                setting.hoverNodeTranslucency = parseInt(value);
                break;
            case 'gridline-color':
                setting.gridlineColor = value;
                break;
            case 'gridline-diameter':
                setting.gridlineDiameter = parseFloat(value);
                break;
            case 'gridline-translucency':
                setting.gridlineTranslucency = parseInt(value);
                break;
            case 'hover-gridline-color':
                setting.hoverGridlineColor = value;
                break;
            case 'hover-gridline-translucency':
                setting.hoverGridlineTranslucency = parseInt(value);
                break;
        }
        
        // Apply just this setting for preview
        this.applySettingsPreview(setting);
    }
    
    saveSettings() {
        // Get all settings from the form
        const settings = {
            backgroundColor: document.getElementById('background-color').value,
            nodeSpacing: parseFloat(document.getElementById('node-spacing').value),
            blackColor: document.getElementById('black-color').value,
            whiteColor: document.getElementById('white-color').value,
            pieceTranslucency: parseInt(document.getElementById('piece-translucency').value),
            nodeColor: document.getElementById('node-color').value,
            nodeTranslucency: parseInt(document.getElementById('node-translucency').value),
            hoverNodeTranslucency: parseInt(document.getElementById('hover-node-translucency').value),
            gridlineColor: document.getElementById('gridline-color').value,
            gridlineDiameter: parseFloat(document.getElementById('gridline-diameter').value),
            gridlineTranslucency: parseInt(document.getElementById('gridline-translucency').value),
            hoverGridlineColor: document.getElementById('hover-gridline-color').value,
            hoverGridlineTranslucency: parseInt(document.getElementById('hover-gridline-translucency').value)
        };
        
        // Save to current settings
        this.current = settings;
        
        // Apply the settings to the game
        this.applySettings();
        
        // Save to localStorage for persistence
        localStorage.setItem('pente3d_settings', JSON.stringify(settings));
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
    
    applySettingsPreview(setting) {
        // Create a merged settings object for preview
        const previewSettings = {...this.current, ...setting};
        
        // Apply the preview settings
        this.applySettingsToGame(previewSettings);
    }
    
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
            for (const point of this.game.board.intersectionPoints) {
                if (point && point.material) {
                    point.material.color.set(settings.nodeColor);
                    point.material.opacity = nodeOpacity;
                }
            }
        }
        
        // Store hover node settings
        this.game.nodeHoverSettings = {
            opacity: 1 - (settings.hoverNodeTranslucency / 100)
        };
        
        // Apply grid line settings if grid lines exist
        if (this.game.board && this.game.board.gridLines) {
            const gridlineOpacity = 1 - (settings.gridlineTranslucency / 100);
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