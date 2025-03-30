import { ConnectionInterface } from './connectionInterface.js';

/**
 * PeerJS implementation of the ConnectionInterface
 * Uses PeerJS for WebRTC connections with a simple broker
 */
export class PeerJSConnection extends ConnectionInterface {
    constructor(config = {}) {
        super();
        this.config = {
            usePublicServer: true,
            debug: false,
            ...config
        };
        
        // Event callbacks
        this.connectCallback = null;
        this.disconnectCallback = null;
        this.dataCallback = null;
        this.errorCallback = null;
        
        // Connection state
        this.peer = null;
        this.connection = null;
        this.isHost = false;
        this.gameCode = null;
        this.connected = false;
        
        // ID generation
        this.idLength = 6;
        this.idChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous characters
    }
    
    /**
     * Initialize PeerJS instance - called internally
     * @private
     */
    _initializePeer() {
        // Import Peer dynamically (since it's an external library)
        return import('https://unpkg.com/peerjs@1.4.7/dist/peerjs.min.js')
            .then(() => {
                // Clear any existing peer
                if (this.peer) {
                    this.peer.destroy();
                }
                
                if (this.config.usePublicServer) {
                    // Use the public PeerJS server
                    this.peer = new Peer(this._generateId());
                } else if (this.config.customServer) {
                    // Use a custom PeerJS server
                    const { host, port, path, secure } = this.config.customServer;
                    this.peer = new Peer(this._generateId(), {
                        host, port, path, secure
                    });
                } else {
                    throw new Error('PeerJS configuration is invalid');
                }
                
                // Set up peer event handlers
                this._setupPeerEvents();
                
                return new Promise((resolve, reject) => {
                    this.peer.on('open', id => resolve(id));
                    this.peer.on('error', err => reject(err));
                });
            });
    }
    
    /**
     * Set up PeerJS event handlers
     * @private
     */
    _setupPeerEvents() {
        // Connection events
        this.peer.on('connection', conn => {
            if (this.config.debug) console.log('Incoming connection:', conn);
            
            // Only accept connection if we're the host and not already connected
            if (!this.isHost || this.connection) {
                conn.close();
                return;
            }
            
            this.connection = conn;
            this._setupConnectionEvents();
        });
        
        // Error handling
        this.peer.on('error', err => {
            if (this.config.debug) console.error('PeerJS error:', err);
            if (this.errorCallback) this.errorCallback(err);
        });
        
        // Cleanup on disconnect
        this.peer.on('disconnected', () => {
            if (this.config.debug) console.log('PeerJS disconnected');
            this.connected = false;
            if (this.disconnectCallback) this.disconnectCallback();
        });
        
        this.peer.on('close', () => {
            if (this.config.debug) console.log('PeerJS closed');
            this.connected = false;
            if (this.disconnectCallback) this.disconnectCallback();
        });
    }
    
    /**
     * Set up data connection event handlers
     * @private
     */
    _setupConnectionEvents() {
        if (!this.connection) return;
        
        this.connection.on('open', () => {
            if (this.config.debug) console.log('Connection established');
            this.connected = true;
            
            // Notify connection callback
            if (this.connectCallback) {
                this.connectCallback(this.connection.peer);
            }
        });
        
        this.connection.on('data', data => {
            if (this.config.debug) console.log('Received data:', data);
            
            // Notify data callback
            if (this.dataCallback) {
                this.dataCallback(data);
            }
        });
        
        this.connection.on('close', () => {
            if (this.config.debug) console.log('Connection closed');
            this.connected = false;
            
            // Notify disconnect callback
            if (this.disconnectCallback) {
                this.disconnectCallback();
            }
        });
        
        this.connection.on('error', err => {
            if (this.config.debug) console.error('Connection error:', err);
            
            // Notify error callback
            if (this.errorCallback) {
                this.errorCallback(err);
            }
        });
    }
    
    /**
     * Generate a random ID for game codes
     * @private
     * @returns {string} Random ID
     */
    _generateId() {
        let id = '';
        for (let i = 0; i < this.idLength; i++) {
            id += this.idChars.charAt(Math.floor(Math.random() * this.idChars.length));
        }
        return id;
    }
    
    /**
     * Create a new game as the host
     * @returns {Promise<string>} Game code that can be shared with others
     */
    async createGame() {
        try {
            // Initialize PeerJS
            const id = await this._initializePeer();
            this.isHost = true;
            this.gameCode = id;
            
            if (this.config.debug) console.log(`Game created with code: ${id}`);
            return id;
        } catch (error) {
            if (this.config.debug) console.error('Error creating game:', error);
            if (this.errorCallback) this.errorCallback(error);
            throw error;
        }
    }
    
    /**
     * Join an existing game as a guest
     * @param {string} code - The game code provided by the host
     * @returns {Promise<void>}
     */
    async joinGame(code) {
        try {
            // Initialize PeerJS
            await this._initializePeer();
            this.isHost = false;
            this.gameCode = code;
            
            // Connect to the host
            this.connection = this.peer.connect(code, {
                reliable: true
            });
            
            // Set up connection events
            this._setupConnectionEvents();
            
            // Return a promise that resolves when connected or rejects on error
            return new Promise((resolve, reject) => {
                // Set timeout for connection
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timed out'));
                }, 20000); // 20 seconds timeout
                
                // On connection
                this.connection.on('open', () => {
                    clearTimeout(timeout);
                    resolve();
                });
                
                // On error
                this.connection.on('error', err => {
                    clearTimeout(timeout);
                    reject(err);
                });
            });
        } catch (error) {
            if (this.config.debug) console.error('Error joining game:', error);
            if (this.errorCallback) this.errorCallback(error);
            throw error;
        }
    }
    
    /**
     * Register callback to be called when connected to peer
     * @param {Function} callback - Function(peerId) to call on connection
     */
    onConnect(callback) {
        this.connectCallback = callback;
    }
    
    /**
     * Register callback to be called when disconnected from peer
     * @param {Function} callback - Function() to call on disconnection
     */
    onDisconnect(callback) {
        this.disconnectCallback = callback;
    }
    
    /**
     * Register callback to be called when data is received
     * @param {Function} callback - Function(data) to call when data is received
     */
    onData(callback) {
        this.dataCallback = callback;
    }
    
    /**
     * Register callback to be called when an error occurs
     * @param {Function} callback - Function(error) to call on error
     */
    onError(callback) {
        this.errorCallback = callback;
    }
    
    /**
     * Send data to the connected peer
     * @param {any} data - Data to send (will be serialized as JSON)
     * @returns {Promise<void>}
     */
    async sendData(data) {
        if (!this.connection || !this.connected) {
            throw new Error('Not connected to a peer');
        }
        
        try {
            this.connection.send(data);
            return Promise.resolve();
        } catch (error) {
            if (this.config.debug) console.error('Error sending data:', error);
            if (this.errorCallback) this.errorCallback(error);
            throw error;
        }
    }
    
    /**
     * Disconnect from the current game/peer
     * @returns {Promise<void>}
     */
    async disconnect() {
        // Close connection
        if (this.connection) {
            this.connection.close();
            this.connection = null;
        }
        
        // Destroy peer
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        
        // Reset state
        this.connected = false;
        this.gameCode = null;
        this.isHost = false;
        
        return Promise.resolve();
    }
    
    /**
     * Check if currently connected to a peer
     * @returns {boolean} True if connected
     */
    isConnected() {
        return this.connected;
    }
    
    /**
     * Get connection info
     * @returns {Object} Connection details
     */
    getConnectionInfo() {
        return {
            type: 'peerjs',
            isHost: this.isHost,
            gameCode: this.gameCode,
            connected: this.connected,
            peerId: this.peer?.id
        };
    }
}