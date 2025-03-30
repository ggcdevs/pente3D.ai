// Menu functionality
export class Menu {
    constructor(game) {
        this.game = game;
        
        // DOM elements
        this.menuButton = document.getElementById('menu-button');
        this.menuModal = document.getElementById('menu-modal');
        this.closeModalButton = document.querySelector('.close-modal-button');
        this.settingsOption = document.getElementById('settings-option');
        this.joinGameOption = document.getElementById('join-game-option');
        this.joinGameForm = document.getElementById('join-game-form');
        this.gameCodeInput = document.getElementById('game-code-input');
        this.joinGameButton = document.getElementById('join-game-button');
        
        // Flag to track menu state
        this.isMenuOpen = false;
        this.isJoinGameFormVisible = false;
        
        // Store reference to original game keyboard handlers
        this.originalKeyDownHandler = null;
        this.originalKeyUpHandler = null;
        
        // Initialize event listeners
        this.initEventListeners();
    }
    
    initEventListeners() {
        // Open menu modal when menu button is clicked
        this.menuButton.addEventListener('click', () => {
            this.openMenuModal();
        });
        
        // Close menu modal when close button is clicked
        if (this.closeModalButton) {
            this.closeModalButton.addEventListener('click', () => {
                this.closeMenuModal();
            });
        }
        
        // Close menu modal when clicking outside
        this.menuModal.addEventListener('click', (event) => {
            if (event.target === this.menuModal) {
                this.closeMenuModal();
            }
        });
        
        // Close menu modal with Escape key
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !this.menuModal.classList.contains('hidden')) {
                this.closeMenuModal();
            }
        });
        
        // Handle settings option header click
        const settingsHeader = this.settingsOption?.querySelector('.menu-option-header');
        if (settingsHeader) {
            settingsHeader.addEventListener('click', () => {
                this.openSettings();
            });
        }
        
        // Handle join game option header click
        const joinGameHeader = this.joinGameOption?.querySelector('.menu-option-header');
        if (joinGameHeader) {
            joinGameHeader.addEventListener('click', () => {
                this.toggleJoinGameForm();
            });
        }
        
        // Handle join game button click
        if (this.joinGameButton) {
            this.joinGameButton.addEventListener('click', () => {
                this.handleJoinGame();
            });
        }
    }
    
    openMenuModal() {
        if (this.menuModal) {
            this.menuModal.classList.remove('hidden');
            this.menuModal.style.display = 'flex';
            this.isMenuOpen = true;
            
            // Reset join game form to hidden state when opening menu
            this.isJoinGameFormVisible = false;
            if (this.joinGameForm) {
                this.joinGameForm.classList.add('hidden');
            }
            
            // Disable game keyboard shortcuts while menu is open
            this.disableGameKeyboardShortcuts();
        }
    }
    
    closeMenuModal() {
        if (this.menuModal) {
            this.menuModal.classList.add('hidden');
            this.menuModal.style.display = 'none';
            this.isMenuOpen = false;
            
            // Re-enable game keyboard shortcuts after menu is closed
            this.enableGameKeyboardShortcuts();
        }
    }
    
    // Disable game keyboard shortcuts by temporarily removing them
    disableGameKeyboardShortcuts() {
        if (this.game && this.game.handleKeyDown && this.game.handleKeyUp) {
            // Store original handlers
            this.originalKeyDownHandler = this.game.handleKeyDown;
            this.originalKeyUpHandler = this.game.handleKeyUp;
            
            // Remove event listeners
            window.removeEventListener('keydown', this.game.handleKeyDown);
            window.removeEventListener('keyup', this.game.handleKeyUp);
            
            console.log('Game keyboard shortcuts disabled');
        }
    }
    
    // Re-enable game keyboard shortcuts
    enableGameKeyboardShortcuts() {
        if (this.game && this.originalKeyDownHandler && this.originalKeyUpHandler) {
            // Restore event listeners
            window.addEventListener('keydown', this.originalKeyDownHandler);
            window.addEventListener('keyup', this.originalKeyUpHandler);
            
            console.log('Game keyboard shortcuts re-enabled');
        }
    }
    
    openSettings() {
        // First close the menu modal
        this.closeMenuModal();
        
        // Then open the settings panel if it exists
        const settingsPanel = document.getElementById('settings-panel');
        if (settingsPanel) {
            settingsPanel.classList.add('open');
        }
    }
    
    toggleJoinGameForm() {
        this.isJoinGameFormVisible = !this.isJoinGameFormVisible;
        
        if (this.joinGameForm) {
            if (this.isJoinGameFormVisible) {
                this.joinGameForm.classList.remove('hidden');
                
                // Adjust border-radius when form is visible
                const header = this.joinGameOption?.querySelector('.menu-option-header');
                if (header) {
                    header.style.borderRadius = '8px 8px 0 0';
                }
                
                // Focus on the input field
                setTimeout(() => {
                    if (this.gameCodeInput) {
                        this.gameCodeInput.focus();
                    }
                }, 100);
            } else {
                this.joinGameForm.classList.add('hidden');
                
                // Restore border-radius when form is hidden
                const header = this.joinGameOption?.querySelector('.menu-option-header');
                if (header) {
                    header.style.borderRadius = '8px';
                }
            }
        }
    }
    
    handleJoinGame() {
        const gameCode = this.gameCodeInput ? this.gameCodeInput.value.trim() : '';
        
        if (gameCode) {
            console.log('Joining game with code:', gameCode);
            // Here we would implement the actual joining logic later
            
            // For now, just close the modal
            this.closeMenuModal();
        } else {
            // Show error for empty code
            alert('Please enter a valid game code.');
        }
    }
}