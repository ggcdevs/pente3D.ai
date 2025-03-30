import { createConnection } from './connectionFactory.js';
import { CONFIG } from '../config.js';

/**
 * NetworkManager - Manages network connections and game state synchronization
 */
export class NetworkManager {
    /**
     * Create a new NetworkManager
     * @param {Object} game - Reference to the main game object
     */
    constructor(game) {
        this.game = game;
        this.connected = false;
        this.isHost = false;
        this.gameCode = null;
        this.peer = null;
        
        // Connection type from config
        this.connectionType = CONFIG.network.connectionType;
        
        // Initialize connection
        this.connection = createConnection(
            this.connectionType, 
            CONFIG.network
        );
        
        // Event callbacks
        this.connectionCallbacks = {
            onConnect: null,
            onDisconnect: null,
            onJoin: null,
            onError: null,
            onGameStart: null,
            onMove: null
        };
        
        // Set up connection event handlers
        this._setupConnectionHandlers();
    }
    
    /**
     * Set up handlers for connection events
     * @private
     */
    _setupConnectionHandlers() {
        // Connection established
        this.connection.onConnect(peerId => {
            this.connected = true;
            this.peer = peerId;
            
            if (CONFIG.network.debug) {
                console.log(`Connected to peer: ${peerId}`);
            }
            
            // Notify any registered connection callback
            if (this.connectionCallbacks.onConnect) {
                this.connectionCallbacks.onConnect(peerId);
            }
        });
        
        // Connection lost
        this.connection.onDisconnect(() => {
            this.connected = false;
            
            if (CONFIG.network.debug) {
                console.log('Disconnected from peer');
            }
            
            // Notify any registered disconnect callback
            if (this.connectionCallbacks.onDisconnect) {
                this.connectionCallbacks.onDisconnect();
            }
        });
        
        // Data received
        this.connection.onData(data => {
            if (CONFIG.network.debug) {
                console.log('Received data:', data);
            }
            
            // Process the data based on type
            this._handleNetworkData(data);
        });
        
        // Error occurred
        this.connection.onError(error => {
            if (CONFIG.network.debug) {
                console.error('Connection error:', error);
            }
            
            // Notify any registered error callback
            if (this.connectionCallbacks.onError) {
                this.connectionCallbacks.onError(error);
            }
        });
    }
    
    /**
     * Handle incoming network data
     * @private
     * @param {Object} data - The received data
     */
    _handleNetworkData(data) {
        // Ensure data has a type
        if (!data || !data.type) {
            console.error('Received invalid data format', data);
            return;
        }
        
        // Handle different data types
        switch (data.type) {
            case 'join':
                // Player joined
                if (this.connectionCallbacks.onJoin) {
                    this.connectionCallbacks.onJoin(data.playerInfo);
                }
                break;
                
            case 'game_start':
                // Game started
                if (this.connectionCallbacks.onGameStart) {
                    this.connectionCallbacks.onGameStart(data.gameState);
                }
                break;
                
            case 'move':
                // Player made a move
                if (this.connectionCallbacks.onMove) {
                    this.connectionCallbacks.onMove(data.move);
                }
                break;
                
            case 'chat':
                // Chat message
                // Implement if chat feature is added
                break;
                
            default:
                console.warn(`Unknown data type: ${data.type}`, data);
        }
    }
    
    /**
     * Create a new game as host
     * @returns {Promise<string>} Game code to share
     */
    async createGame() {
        try {
            this.isHost = true;
            const gameCode = await this.connection.createGame();
            this.gameCode = gameCode;
            return gameCode;
        } catch (error) {
            console.error('Failed to create game:', error);
            throw error;
        }
    }
    
    /**
     * Join an existing game as guest
     * @param {string} code - Game code to join
     * @returns {Promise<void>}
     */
    async joinGame(code) {
        try {
            this.isHost = false;
            await this.connection.joinGame(code);
            this.gameCode = code;
            
            // Send join event to host
            await this.sendData({
                type: 'join',
                playerInfo: {
                    // Add any player info here
                    joinTime: Date.now()
                }
            });
        } catch (error) {
            console.error('Failed to join game:', error);
            throw error;
        }
    }
    
    /**
     * Start the game (host only)
     * @returns {Promise<void>}
     */
    async startGame(initialState) {
        if (!this.isHost) {
            throw new Error('Only the host can start the game');
        }
        
        if (!this.connected) {
            throw new Error('Not connected to a peer');
        }
        
        try {
            await this.sendData({
                type: 'game_start',
                gameState: initialState || {}
            });
        } catch (error) {
            console.error('Failed to start game:', error);
            throw error;
        }
    }
    
    /**
     * Send a move to the peer
     * @param {Object} move - Move data
     * @returns {Promise<void>}
     */
    async sendMove(move) {
        if (!this.connected) {
            throw new Error('Not connected to a peer');
        }
        
        try {
            await this.sendData({
                type: 'move',
                move: move
            });
        } catch (error) {
            console.error('Failed to send move:', error);
            throw error;
        }
    }
    
    /**
     * Send data to the peer
     * @param {Object} data - Data to send
     * @returns {Promise<void>}
     */
    async sendData(data) {
        if (!this.connected) {
            throw new Error('Not connected to a peer');
        }
        
        try {
            await this.connection.sendData(data);
        } catch (error) {
            console.error('Failed to send data:', error);
            throw error;
        }
    }
    
    /**
     * Disconnect from the current game
     * @returns {Promise<void>}
     */
    async disconnect() {
        try {
            await this.connection.disconnect();
            this.connected = false;
            this.isHost = false;
            this.gameCode = null;
            this.peer = null;
        } catch (error) {
            console.error('Error disconnecting:', error);
            throw error;
        }
    }
    
    /**
     * Register callback for connection events
     * @param {string} event - Event name: 'connect', 'disconnect', 'join', 'error', 'gameStart', 'move'
     * @param {Function} callback - Function to call when event occurs
     */
    on(event, callback) {
        switch (event) {
            case 'connect':
                this.connectionCallbacks.onConnect = callback;
                break;
            case 'disconnect':
                this.connectionCallbacks.onDisconnect = callback;
                break;
            case 'join':
                this.connectionCallbacks.onJoin = callback;
                break;
            case 'error':
                this.connectionCallbacks.onError = callback;
                break;
            case 'gameStart':
                this.connectionCallbacks.onGameStart = callback;
                break;
            case 'move':
                this.connectionCallbacks.onMove = callback;
                break;
            default:
                console.warn(`Unknown event type: ${event}`);
        }
    }
    
    /**
     * Check if connected to a peer
     * @returns {boolean} True if connected
     */
    isConnected() {
        return this.connected;
    }
    
    /**
     * Check if this client is the host
     * @returns {boolean} True if host
     */
    isGameHost() {
        return this.isHost;
    }
    
    /**
     * Get the current game code
     * @returns {string|null} Game code or null if not in a game
     */
    getGameCode() {
        return this.gameCode;
    }
    
    /**
     * Get connection details
     * @returns {Object} Connection information
     */
    getConnectionInfo() {
        return {
            type: this.connectionType,
            connected: this.connected,
            isHost: this.isHost,
            gameCode: this.gameCode,
            peer: this.peer,
            ...this.connection.getConnectionInfo()
        };
    }
}