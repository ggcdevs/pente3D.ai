import { NetworkManager } from './network/networkManager.js';
import { CONFIG } from './config.js';

// Menu functionality
export class Menu {
    constructor(game) {
        this.game = game;
        
        // DOM elements
        this.menuButton = document.getElementById('menu-button');
        this.menuModal = document.getElementById('menu-modal');
        this.closeModalButton = document.querySelector('.close-modal-button');
        this.settingsOption = document.getElementById('settings-option');
        
        // Join game elements
        this.joinGameOption = document.getElementById('join-game-option');
        this.joinGameForm = document.getElementById('join-game-form');
        this.gameCodeInput = document.getElementById('game-code-input');
        this.joinGameButton = document.getElementById('join-game-button');
        
        // Host game elements
        this.hostGameOption = document.getElementById('host-game-option');
        this.hostGameForm = document.getElementById('host-game-form');
        this.gameCodeDisplay = document.getElementById('game-code-display');
        this.generatedGameCode = document.getElementById('generated-game-code');
        this.copyGameCodeButton = document.getElementById('copy-game-code');
        this.hostGameButton = document.getElementById('host-game-button');
        
        // Troubleshooting elements
        this.troubleshootingPanel = document.getElementById('connection-troubleshooting');
        this.showDetailsButton = document.getElementById('show-connection-details');
        this.technicalDetails = document.getElementById('connection-technical-details');
        
        // Testing mode indicator
        this.localTestingMode = document.getElementById('local-testing-mode');
        
        // Check if local testing mode is enabled and show the indicator
        if (CONFIG.network.localTestingMode && this.localTestingMode) {
            this.localTestingMode.classList.remove('hidden');
        }
        
        // Flag to track menu state
        this.isMenuOpen = false;
        this.isJoinGameFormVisible = false;
        this.isHostGameFormVisible = false;
        
        // Store reference to original game keyboard handlers
        this.originalKeyDownHandler = null;
        this.originalKeyUpHandler = null;
        
        // Network manager
        this.networkManager = null;
        
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
        
        // Handle host game option header click
        const hostGameHeader = this.hostGameOption?.querySelector('.menu-option-header');
        if (hostGameHeader) {
            hostGameHeader.addEventListener('click', () => {
                this.toggleHostGameForm();
            });
        }
        
        // Handle host game button click
        if (this.hostGameButton) {
            this.hostGameButton.addEventListener('click', () => {
                this.handleHostGame();
            });
        }
        
        // Handle copy game code button click
        if (this.copyGameCodeButton) {
            this.copyGameCodeButton.addEventListener('click', () => {
                this.copyGameCodeToClipboard();
            });
        }
        
        // Handle show technical details button
        if (this.showDetailsButton) {
            this.showDetailsButton.addEventListener('click', () => {
                this.toggleTechnicalDetails();
            });
        }
    }
    
    openMenuModal() {
        if (this.menuModal) {
            this.menuModal.classList.remove('hidden');
            this.menuModal.style.display = 'flex';
            this.isMenuOpen = true;
            
            // Reset forms to hidden state when opening menu
            this.isJoinGameFormVisible = false;
            this.isHostGameFormVisible = false;
            
            if (this.joinGameForm) {
                this.joinGameForm.classList.add('hidden');
                // Reset border-radius
                const joinHeader = this.joinGameOption?.querySelector('.menu-option-header');
                if (joinHeader) {
                    joinHeader.style.borderRadius = '8px';
                }
            }
            
            if (this.hostGameForm) {
                this.hostGameForm.classList.add('hidden');
                // Reset border-radius
                const hostHeader = this.hostGameOption?.querySelector('.menu-option-header');
                if (hostHeader) {
                    hostHeader.style.borderRadius = '8px';
                }
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
        // If host game form is visible, hide it first
        if (this.isHostGameFormVisible) {
            this.isHostGameFormVisible = false;
            if (this.hostGameForm) {
                this.hostGameForm.classList.add('hidden');
                
                // Reset host header border-radius
                const hostHeader = this.hostGameOption?.querySelector('.menu-option-header');
                if (hostHeader) {
                    hostHeader.style.borderRadius = '8px';
                }
            }
        }
        
        // Toggle join game form
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
    
    toggleHostGameForm() {
        // If join game form is visible, hide it first
        if (this.isJoinGameFormVisible) {
            this.isJoinGameFormVisible = false;
            if (this.joinGameForm) {
                this.joinGameForm.classList.add('hidden');
                
                // Reset join header border-radius
                const joinHeader = this.joinGameOption?.querySelector('.menu-option-header');
                if (joinHeader) {
                    joinHeader.style.borderRadius = '8px';
                }
            }
        }
        
        // Toggle host game form
        this.isHostGameFormVisible = !this.isHostGameFormVisible;
        
        if (this.hostGameForm) {
            if (this.isHostGameFormVisible) {
                this.hostGameForm.classList.remove('hidden');
                
                // Adjust border-radius when form is visible
                const header = this.hostGameOption?.querySelector('.menu-option-header');
                if (header) {
                    header.style.borderRadius = '8px 8px 0 0';
                }
                
                // Hide the game code display when first opening the form
                if (this.gameCodeDisplay) {
                    this.gameCodeDisplay.classList.add('hidden');
                }
                
                // Reset host button
                if (this.hostGameButton) {
                    this.hostGameButton.textContent = 'Create Game';
                    this.hostGameButton.disabled = false;
                }
            } else {
                this.hostGameForm.classList.add('hidden');
                
                // Restore border-radius when form is hidden
                const header = this.hostGameOption?.querySelector('.menu-option-header');
                if (header) {
                    header.style.borderRadius = '8px';
                }
            }
        }
    }
    
    /**
     * Initialize the network manager
     * @returns {NetworkManager} The initialized network manager
     */
    initNetworkManager() {
        console.info('Menu: Initializing network manager');
        if (!this.networkManager) {
            console.debug('Menu: Creating new NetworkManager instance');
            this.networkManager = new NetworkManager(this.game);
            console.debug('Menu: Setting up network event handlers');
            this.setupNetworkHandlers();
            
            // Show local testing mode notification if enabled
            if (CONFIG.network.localTestingMode) {
                console.warn('Menu: Local testing mode is enabled');
                this.showConnectionStatus('⚠️ LOCAL TESTING MODE - for same-device connections only', 'warning', 10000);
            }
        } else {
            console.debug('Menu: Using existing NetworkManager instance');
        }
        return this.networkManager;
    }
    
    async handleJoinGame() {
        console.info('Menu: Handle join game action initiated');
        const gameCode = this.gameCodeInput ? this.gameCodeInput.value.trim().toUpperCase() : '';
        console.debug(`Menu: Game code entered: ${gameCode}`);
        
        if (!gameCode) {
            console.warn('Menu: Empty game code provided');
            // Show error for empty code
            alert('Please enter a valid game code.');
            return;
        }
        
        try {
            // Initialize network manager if not already done
            console.debug('Menu: Ensuring network manager is initialized');
            this.initNetworkManager();
            
            // Show loading indicator
            console.debug('Menu: Updating UI to show connecting state');
            this.joinGameButton.textContent = 'Connecting...';
            this.joinGameButton.disabled = true;
            
            // Join the game
            console.info(`Menu: Attempting to join game with code: ${gameCode}`);
            await this.networkManager.joinGame(gameCode);
            
            // Close the modal
            console.debug('Menu: Closing menu modal after successful connection');
            this.closeMenuModal();
            
            // Show success message
            console.debug('Menu: Showing success connection status');
            this.showConnectionStatus(`Connected to game ${gameCode}`, 'success');
        } catch (error) {
            console.error('Menu: Failed to join game:', error);
            
            // Reset button
            console.debug('Menu: Resetting join button to original state');
            this.joinGameButton.textContent = 'Join';
            this.joinGameButton.disabled = false;
            
            // Show error message with network troubleshooting help
            console.debug('Menu: Showing error alert to user');
            
            // Enhanced error message with troubleshooting suggestions
            let errorMsg = `Failed to join game: ${error.message}\n\n`;
            
            if (error.message.includes('WebRTC connection failed') || 
                error.message.includes('Connection timed out')) {
                errorMsg += "Network troubleshooting tips:\n";
                errorMsg += "1. Make sure both devices are on the same network\n";
                errorMsg += "2. Some corporate/school networks may block WebRTC connections\n";
                errorMsg += "3. Try disabling VPN or firewall software if you're using any\n";
                errorMsg += "4. If on mobile, try switching to WiFi if using cellular data";
            }
            
            alert(errorMsg);
            
            // Show troubleshooting panel
            this.showTroubleshooting();
        }
    }
    
    async handleHostGame() {
        console.info('Menu: Handle host game action initiated');
        
        try {
            // Initialize network manager if not already done
            console.debug('Menu: Ensuring network manager is initialized');
            this.initNetworkManager();
            
            // Show loading indicator
            console.debug('Menu: Updating UI to show creating state');
            this.hostGameButton.textContent = 'Creating...';
            this.hostGameButton.disabled = true;
            
            // Create the game
            console.info('Menu: Creating new game as host');
            const gameCode = await this.networkManager.createGame();
            console.info(`Menu: Game created with code: ${gameCode}`);
            
            // Show the game code display
            if (this.gameCodeDisplay && this.generatedGameCode) {
                console.debug('Menu: Showing game code display UI');
                this.gameCodeDisplay.classList.remove('hidden');
                this.generatedGameCode.textContent = gameCode;
                
                // Update host button
                console.debug('Menu: Updating host button to waiting state');
                this.hostGameButton.textContent = 'Waiting for Player...';
            } else {
                console.warn('Menu: Game code display elements missing');
            }
            
            // Show info message
            console.debug('Menu: Showing waiting for opponent status');
            this.showConnectionStatus('Game created! Waiting for opponent...', 'info');
        } catch (error) {
            console.error('Menu: Failed to create game:', error);
            
            // Reset button
            console.debug('Menu: Resetting host button to original state');
            this.hostGameButton.textContent = 'Create Game';
            this.hostGameButton.disabled = false;
            
            // Show error message and troubleshooting panel
            console.debug('Menu: Showing error alert to user');
            alert(`Failed to create game: ${error.message}`);
            
            // Show troubleshooting panel
            this.showTroubleshooting();
        }
    }
    
    copyGameCodeToClipboard() {
        if (!this.generatedGameCode) return;
        
        const gameCode = this.generatedGameCode.textContent;
        if (!gameCode) return;
        
        // Copy to clipboard
        navigator.clipboard.writeText(gameCode)
            .then(() => {
                // Show success message
                this.showConnectionStatus('Game code copied to clipboard!', 'success');
                
                // Visual feedback on button
                if (this.copyGameCodeButton) {
                    const originalText = this.copyGameCodeButton.textContent;
                    this.copyGameCodeButton.textContent = '✓';
                    
                    setTimeout(() => {
                        this.copyGameCodeButton.textContent = originalText;
                    }, 1500);
                }
            })
            .catch(err => {
                console.error('Failed to copy game code:', err);
                alert('Failed to copy game code. Please copy it manually.');
            });
    }
    
    /**
     * Toggle the display of technical connection details
     */
    toggleTechnicalDetails() {
        if (!this.technicalDetails) return;
        
        const isHidden = this.technicalDetails.classList.contains('hidden');
        
        if (isHidden) {
            // Show details and update content
            this.technicalDetails.classList.remove('hidden');
            this.updateTechnicalDetails();
            this.showDetailsButton.textContent = 'Hide Technical Details';
        } else {
            // Hide details
            this.technicalDetails.classList.add('hidden');
            this.showDetailsButton.textContent = 'Show Technical Details';
        }
    }
    
    /**
     * Update the technical details panel with connection information
     */
    updateTechnicalDetails() {
        if (!this.technicalDetails || !this.networkManager) return;
        
        try {
            // Get browser info
            const browserInfo = {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                language: navigator.language,
                webRTC: 'RTCPeerConnection' in window ? 'Supported' : 'Not supported'
            };
            
            // Get connection info if available
            let connectionInfo = 'No active connection';
            if (this.networkManager.connection) {
                connectionInfo = this.networkManager.getConnectionInfo();
            }
            
            // Format the information
            const details = 
                `BROWSER INFORMATION:\n` +
                `- User Agent: ${browserInfo.userAgent}\n` +
                `- Platform: ${browserInfo.platform}\n` +
                `- WebRTC Support: ${browserInfo.webRTC}\n\n` +
                `CONNECTION INFORMATION:\n` +
                JSON.stringify(connectionInfo, null, 2);
            
            this.technicalDetails.textContent = details;
        } catch (error) {
            console.error('Error generating technical details:', error);
            this.technicalDetails.textContent = 'Error generating technical details';
        }
    }
    
    /**
     * Show troubleshooting panel after connection attempts fail
     */
    showTroubleshooting() {
        if (this.troubleshootingPanel) {
            this.troubleshootingPanel.classList.remove('hidden');
        }
    }
    
    /**
     * Set up network event handlers
     */
    setupNetworkHandlers() {
        if (!this.networkManager) return;
        
        // When connected to a peer
        this.networkManager.on('connect', (peerId) => {
            console.log('Connected to peer:', peerId);
            this.showConnectionStatus(`Connected to peer ${peerId}`, 'success');
            
            // If we're the host, we want to keep the menu open to show the game code
            // The menu will close later when a player joins
            if (this.networkManager.isGameHost()) {
                console.log('Menu: Host connected (to self or broker) - keeping menu open to show game code');
                // Notice we're NOT closing the menu here anymore
            } else {
                // For clients, we can close the menu as soon as they're connected
                console.log('Menu: Client connected to host - closing menu');
                this.closeMenuModal();
            }
        });
        
        // When someone joins (host only)
        this.networkManager.on('join', (playerInfo) => {
            console.log('Menu: Player joined!', playerInfo);
            this.showConnectionStatus(`Player joined! Client ID: ${playerInfo.clientId || 'unknown'}`, 'success');
            
            // Update host button state
            if (this.hostGameButton && this.networkManager.isGameHost()) {
                console.log('Menu: Updating host UI for player join');
                this.hostGameButton.textContent = 'Player Connected!';
                
                // Show a prominent notification
                this.showConnectionStatus(`🎉 A player has joined! You can now start the game.`, 'success', 10000);
                
                // Add pulsing effect to the button to draw attention
                this.hostGameButton.classList.add('pulse-animation');
                
                // Close the menu modal after a brief delay to show the connection
                setTimeout(() => {
                    console.log('Menu: Closing host menu after player joined');
                    this.closeMenuModal();
                    
                    // Update button outside the menu
                    this.hostGameButton.textContent = 'Start Game';
                    this.hostGameButton.disabled = false;
                    
                    // Change button action to start game
                    console.log('Menu: Changing host button action to start game');
                    // Use a proper bind for handleHostGame to ensure proper removal
                    if (this.handleHostGame) {
                        this.hostGameButton.removeEventListener('click', this.handleHostGame);
                    }
                    
                    const startGameHandler = () => {
                        console.log('Menu: Start game button clicked');
                        this.startGame();
                    };
                    
                    this.hostGameButton.addEventListener('click', startGameHandler);
                    // Store reference to make it easy to remove later
                    this.startGameHandler = startGameHandler;
                    
                    // Remove pulsing effect after a little while
                    setTimeout(() => {
                        this.hostGameButton.classList.remove('pulse-animation');
                    }, 5000);
                }, 1500);
            } else {
                console.log('Menu: Host button not available or not host');
            }
        });
        
        // When disconnected
        this.networkManager.on('disconnect', () => {
            console.log('Disconnected from peer');
            this.showConnectionStatus('Disconnected from game', 'warning');
            
            // Reset host button if we're the host
            if (this.networkManager.isGameHost() && this.hostGameButton) {
                this.hostGameButton.textContent = 'Create Game';
                this.hostGameButton.disabled = false;
                
                // Reset button action
                this.hostGameButton.removeEventListener('click', this.startGame);
                this.hostGameButton.addEventListener('click', () => {
                    this.handleHostGame();
                });
            }
        });
        
        // When there's an error
        this.networkManager.on('error', (error) => {
            console.error('Network error:', error);
            this.showConnectionStatus(`Error: ${error.message}`, 'error');
        });
        
        // When game starts
        this.networkManager.on('gameStart', (gameState) => {
            console.log('Game started:', gameState);
            // Initialize game with the received state
            // this.game.initializeNetworkGame(gameState);
            
            // Close the menu modal if it's still open
            this.closeMenuModal();
            
            // Show success message
            this.showConnectionStatus('Game started!', 'success');
        });
        
        // When receiving a move
        this.networkManager.on('move', (move) => {
            console.log('Received move:', move);
            // Apply the received move
            // this.game.applyNetworkMove(move);
        });
    }
    
    /**
     * Start the game (host only)
     */
    async startGame() {
        if (!this.networkManager || !this.networkManager.isGameHost()) {
            console.error('Only the host can start the game');
            return;
        }
        
        try {
            // Disable button
            if (this.hostGameButton) {
                this.hostGameButton.textContent = 'Starting...';
                this.hostGameButton.disabled = true;
            }
            
            // Start the game
            await this.networkManager.startGame({
                // Add initial game state here
                boardSize: this.game.board.boardSize,
                currentPlayer: this.game.currentPlayer.id,
                moves: [] // Initial empty moves
            });
            
            // Close the menu
            this.closeMenuModal();
            
            // Show success message
            this.showConnectionStatus('Game started!', 'success');
        } catch (error) {
            console.error('Failed to start game:', error);
            
            // Reset button
            if (this.hostGameButton) {
                this.hostGameButton.textContent = 'Start Game';
                this.hostGameButton.disabled = false;
            }
            
            // Show error message
            alert(`Failed to start game: ${error.message}`);
        }
    }
    
    /**
     * Show a connection status message
     * @param {string} message - The message to show
     * @param {string} type - The type of message: 'success', 'warning', 'error', 'info'
     * @param {number} duration - How long to show the message in milliseconds (default: 5000)
     */
    showConnectionStatus(message, type = 'info', duration = 5000) {
        // Create status element if it doesn't exist
        let statusEl = document.getElementById('connection-status');
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.id = 'connection-status';
            document.querySelector('.game-container').appendChild(statusEl);
        }
        
        // Set class based on type
        statusEl.className = `connection-status ${type}`;
        statusEl.textContent = message;
        
        // Show the status
        statusEl.classList.remove('hidden');
        
        // Hide after delay
        setTimeout(() => {
            statusEl.classList.add('hidden');
        }, duration);
    }
}