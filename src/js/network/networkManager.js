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
        console.info('NetworkManager: Initializing...');
        
        this.game = game;
        this.connected = false;
        this.isHost = false;
        this.gameCode = null;
        this.peer = null;
        
        // Connection type from config
        this.connectionType = CONFIG.network.connectionType;
        console.info(`NetworkManager: Using connection type: ${this.connectionType}`);
        
        // Initialize connection
        console.debug('NetworkManager: Creating connection with config:', CONFIG.network);
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
        console.info('NetworkManager: Initialization complete');
    }
    
    /**
     * Set up handlers for connection events
     * @private
     */
    _setupConnectionHandlers() {
        console.debug('NetworkManager: Setting up connection event handlers');
        
        // Connection established
        this.connection.onConnect(peerId => {
            console.info(`NetworkManager: Connected to peer: ${peerId}`);
            this.connected = true;
            this.peer = peerId;
            
            // Notify any registered connection callback
            if (this.connectionCallbacks.onConnect) {
                console.debug('NetworkManager: Executing onConnect callback');
                this.connectionCallbacks.onConnect(peerId);
            } else {
                console.debug('NetworkManager: No onConnect callback registered');
            }
        });
        
        // Connection lost
        this.connection.onDisconnect(() => {
            console.info('NetworkManager: Disconnected from peer');
            this.connected = false;
            
            // Notify any registered disconnect callback
            if (this.connectionCallbacks.onDisconnect) {
                console.debug('NetworkManager: Executing onDisconnect callback');
                this.connectionCallbacks.onDisconnect();
            } else {
                console.debug('NetworkManager: No onDisconnect callback registered');
            }
        });
        
        // Data received
        this.connection.onData(data => {
            console.info('NetworkManager: Received data from peer');
            console.debug('NetworkManager: Data content:', data);
            
            // Process the data based on type
            this._handleNetworkData(data);
        });
        
        // Error occurred
        this.connection.onError(error => {
            console.error('NetworkManager: Connection error:', error);
            
            // Notify any registered error callback
            if (this.connectionCallbacks.onError) {
                console.debug('NetworkManager: Executing onError callback');
                this.connectionCallbacks.onError(error);
            } else {
                console.debug('NetworkManager: No onError callback registered');
            }
        });
        
        console.info('NetworkManager: Connection event handlers setup complete');
    }
    
    /**
     * Handle incoming network data
     * @private
     * @param {Object} data - The received data
     */
    _handleNetworkData(data) {
        // Ensure data has a type
        if (!data || !data.type) {
            console.error('NetworkManager: Received invalid data format', data);
            return;
        }
        
        console.info(`NetworkManager: Processing data of type: ${data.type}`);
        
        // Handle different data types
        switch (data.type) {
            case 'join':
                console.debug('NetworkManager: Processing join event with data:', data.playerInfo);
                // Player joined
                if (this.connectionCallbacks.onJoin) {
                    console.debug('NetworkManager: Executing onJoin callback');
                    this.connectionCallbacks.onJoin(data.playerInfo);
                } else {
                    console.debug('NetworkManager: No onJoin callback registered');
                }
                break;
                
            case 'game_start':
                console.debug('NetworkManager: Processing game_start event with state:', data.gameState);
                // Game started
                if (this.connectionCallbacks.onGameStart) {
                    console.debug('NetworkManager: Executing onGameStart callback');
                    this.connectionCallbacks.onGameStart(data.gameState);
                } else {
                    console.debug('NetworkManager: No onGameStart callback registered');
                }
                break;
                
            case 'move':
                console.debug('NetworkManager: Processing move event with data:', data.move);
                // Player made a move
                if (this.connectionCallbacks.onMove) {
                    console.debug('NetworkManager: Executing onMove callback');
                    this.connectionCallbacks.onMove(data.move);
                } else {
                    console.debug('NetworkManager: No onMove callback registered');
                }
                break;
                
            case 'chat':
                console.debug('NetworkManager: Processing chat event (not implemented)');
                // Chat message
                // Implement if chat feature is added
                break;
                
            default:
                console.warn(`NetworkManager: Unknown data type: ${data.type}`, data);
        }
    }
    
    /**
     * Create a new game as host
     * @returns {Promise<string>} Game code to share
     */
    async createGame() {
        console.info('NetworkManager: Creating a new game as host');
        
        try {
            this.isHost = true;
            console.debug('NetworkManager: Set isHost flag to true');
            
            console.debug('NetworkManager: Calling connection.createGame()');
            const gameCode = await this.connection.createGame();
            console.info(`NetworkManager: Game created with code: ${gameCode}`);
            
            this.gameCode = gameCode;
            console.debug('NetworkManager: Game code stored');
            
            return gameCode;
        } catch (error) {
            console.error('NetworkManager: Failed to create game:', error);
            throw error;
        }
    }
    
    /**
     * Join an existing game as guest
     * @param {string} code - Game code to join
     * @returns {Promise<void>}
     */
    async joinGame(code) {
        console.info(`NetworkManager: Joining game with code: ${code}`);
        
        try {
            this.isHost = false;
            console.debug('NetworkManager: Set isHost flag to false');
            
            console.debug(`NetworkManager: Calling connection.joinGame(${code})`);
            await this.connection.joinGame(code);
            console.info(`NetworkManager: Successfully joined game: ${code}`);
            
            this.gameCode = code;
            console.debug('NetworkManager: Game code stored');
            
            // Send join event to host
            const playerInfo = {
                // Add any player info here
                joinTime: Date.now()
            };
            console.debug('NetworkManager: Sending join event to host with info:', playerInfo);
            
            await this.sendData({
                type: 'join',
                playerInfo: playerInfo
            });
            console.info('NetworkManager: Join event sent to host');
            
        } catch (error) {
            console.error('NetworkManager: Failed to join game:', error);
            throw error;
        }
    }
    
    /**
     * Start the game (host only)
     * @returns {Promise<void>}
     */
    async startGame(initialState) {
        console.info('NetworkManager: Starting game');
        
        if (!this.isHost) {
            const error = new Error('Only the host can start the game');
            console.error('NetworkManager: ' + error.message);
            throw error;
        }
        
        if (!this.connected) {
            const error = new Error('Not connected to a peer');
            console.error('NetworkManager: ' + error.message);
            throw error;
        }
        
        try {
            console.debug('NetworkManager: Sending game_start event with state:', initialState);
            await this.sendData({
                type: 'game_start',
                gameState: initialState || {}
            });
            console.info('NetworkManager: Game started successfully');
        } catch (error) {
            console.error('NetworkManager: Failed to start game:', error);
            throw error;
        }
    }
    
    /**
     * Send a move to the peer
     * @param {Object} move - Move data
     * @returns {Promise<void>}
     */
    async sendMove(move) {
        console.info('NetworkManager: Sending move to peer');
        console.debug('NetworkManager: Move data:', move);
        
        if (!this.connected) {
            const error = new Error('Not connected to a peer');
            console.error('NetworkManager: ' + error.message);
            throw error;
        }
        
        try {
            console.debug('NetworkManager: Creating move packet');
            await this.sendData({
                type: 'move',
                move: move
            });
            console.info('NetworkManager: Move sent successfully');
        } catch (error) {
            console.error('NetworkManager: Failed to send move:', error);
            throw error;
        }
    }
    
    /**
     * Send data to the peer
     * @param {Object} data - Data to send
     * @returns {Promise<void>}
     */
    async sendData(data) {
        console.info(`NetworkManager: Sending data of type: ${data.type}`);
        console.debug('NetworkManager: Data payload:', data);
        
        if (!this.connected && data.type !== 'join') {
            // Allow join messages even if not fully connected yet
            const error = new Error('Not connected to a peer');
            console.error('NetworkManager: ' + error.message);
            throw error;
        }
        
        try {
            console.debug('NetworkManager: Calling connection.sendData()');
            await this.connection.sendData(data);
            console.info('NetworkManager: Data sent successfully');
        } catch (error) {
            console.error('NetworkManager: Failed to send data:', error);
            throw error;
        }
    }
    
    /**
     * Disconnect from the current game
     * @returns {Promise<void>}
     */
    async disconnect() {
        console.info('NetworkManager: Disconnecting from game');
        
        try {
            console.debug('NetworkManager: Calling connection.disconnect()');
            await this.connection.disconnect();
            
            console.debug('NetworkManager: Resetting state');
            this.connected = false;
            this.isHost = false;
            this.gameCode = null;
            this.peer = null;
            
            console.info('NetworkManager: Disconnected successfully');
        } catch (error) {
            console.error('NetworkManager: Error disconnecting:', error);
            throw error;
        }
    }
    
    /**
     * Register callback for connection events
     * @param {string} event - Event name: 'connect', 'disconnect', 'join', 'error', 'gameStart', 'move'
     * @param {Function} callback - Function to call when event occurs
     */
    on(event, callback) {
        console.info(`NetworkManager: Registering callback for event: ${event}`);
        
        if (!callback || typeof callback !== 'function') {
            console.warn('NetworkManager: Invalid callback provided for event:', event);
            return;
        }
        
        switch (event) {
            case 'connect':
                console.debug('NetworkManager: Registered connect callback');
                this.connectionCallbacks.onConnect = callback;
                break;
            case 'disconnect':
                console.debug('NetworkManager: Registered disconnect callback');
                this.connectionCallbacks.onDisconnect = callback;
                break;
            case 'join':
                console.debug('NetworkManager: Registered join callback');
                this.connectionCallbacks.onJoin = callback;
                break;
            case 'error':
                console.debug('NetworkManager: Registered error callback');
                this.connectionCallbacks.onError = callback;
                break;
            case 'gameStart':
                console.debug('NetworkManager: Registered gameStart callback');
                this.connectionCallbacks.onGameStart = callback;
                break;
            case 'move':
                console.debug('NetworkManager: Registered move callback');
                this.connectionCallbacks.onMove = callback;
                break;
            default:
                console.warn(`NetworkManager: Unknown event type: ${event}`);
        }
    }
    
    /**
     * Check if connected to a peer
     * @returns {boolean} True if connected
     */
    isConnected() {
        console.debug(`NetworkManager: Connection status check: ${this.connected ? 'connected' : 'not connected'}`);
        return this.connected;
    }
    
    /**
     * Check if this client is the host
     * @returns {boolean} True if host
     */
    isGameHost() {
        console.debug(`NetworkManager: Host status check: ${this.isHost ? 'host' : 'guest'}`);
        return this.isHost;
    }
    
    /**
     * Get the current game code
     * @returns {string|null} Game code or null if not in a game
     */
    getGameCode() {
        console.debug(`NetworkManager: Game code request: ${this.gameCode || 'none'}`);
        return this.gameCode;
    }
    
    /**
     * Get connection details
     * @returns {Object} Connection information
     */
    getConnectionInfo() {
        console.debug('NetworkManager: Getting connection info');
        const connectionInfo = {
            type: this.connectionType,
            connected: this.connected,
            isHost: this.isHost,
            gameCode: this.gameCode,
            peer: this.peer,
            ...this.connection.getConnectionInfo()
        };
        console.debug('NetworkManager: Connection info:', connectionInfo);
        return connectionInfo;
    }
}