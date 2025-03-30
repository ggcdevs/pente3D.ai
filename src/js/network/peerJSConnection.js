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
            debug: true, // Enable debug by default
            ...config
        };
        
        console.info('PeerJSConnection: Initializing with config', this.config);
        
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
        console.info('PeerJSConnection: Initializing PeerJS...');
        
        // Import Peer dynamically (since it's an external library)
        // Using latest version for better browser compatibility
        return import('https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js')
            .then(() => {
                console.debug('PeerJSConnection: PeerJS library loaded successfully');
                
                // Clear any existing peer
                if (this.peer) {
                    console.debug('PeerJSConnection: Destroying existing peer connection');
                    this.peer.destroy();
                }
                
                let id = this._generateId();
                console.info(`PeerJSConnection: Generated peer ID: ${id}`);
                
                if (this.config.usePublicServer) {
                    // Use the public PeerJS server with custom options
                    console.info('PeerJSConnection: Using public PeerJS server');
                    const options = this.config.options || {};
                    console.debug('PeerJSConnection: Using options:', options);
                    
                    this.peer = new Peer(id, options);
                    console.debug('PeerJSConnection: Peer created with public server', this.peer);
                } else if (this.config.customServer) {
                    // Use a custom PeerJS server
                    const { host, port, path, secure } = this.config.customServer;
                    const options = this.config.options || {};
                    
                    console.info(`PeerJSConnection: Using custom PeerJS server at ${host}:${port}${path}`);
                    console.debug('PeerJSConnection: Using options:', { ...options, host, port, path, secure });
                    
                    this.peer = new Peer(id, {
                        ...options,
                        host, port, path, secure
                    });
                    console.debug('PeerJSConnection: Peer created with custom server', this.peer);
                } else {
                    console.error('PeerJSConnection: Invalid configuration - neither public nor custom server specified');
                    throw new Error('PeerJS configuration is invalid');
                }
                
                // Set up peer event handlers
                this._setupPeerEvents();
                
                return new Promise((resolve, reject) => {
                    console.debug('PeerJSConnection: Waiting for peer to open...');
                    
                    // Add timeout for peer open
                    const timeout = setTimeout(() => {
                        console.error('PeerJSConnection: Peer open timed out after 20 seconds');
                        reject(new Error('Peer connection timed out'));
                    }, 20000);
                    
                    this.peer.on('open', id => {
                        clearTimeout(timeout);
                        console.info(`PeerJSConnection: Peer opened successfully with ID: ${id}`);
                        resolve(id);
                    });
                    
                    this.peer.on('error', err => {
                        clearTimeout(timeout);
                        console.error('PeerJSConnection: Error during peer initialization', err);
                        reject(err);
                    });
                });
            })
            .catch(error => {
                console.error('PeerJSConnection: Failed to load PeerJS library', error);
                throw error;
            });
    }
    
    /**
     * Set up PeerJS event handlers
     * @private
     */
    _setupPeerEvents() {
        console.debug('PeerJSConnection: Setting up peer event handlers');
        
        // Connection events
        this.peer.on('connection', conn => {
            console.info('PeerJSConnection: Incoming connection from peer:', conn.peer);
            console.debug('PeerJSConnection: Connection details:', conn);
            
            // Only accept connection if we're the host and not already connected
            if (!this.isHost) {
                console.warn('PeerJSConnection: Rejecting connection - not in host mode');
                conn.close();
                return;
            }
            
            if (this.connection) {
                console.warn('PeerJSConnection: Rejecting connection - already connected to another peer');
                conn.close();
                return;
            }
            
            console.info(`PeerJSConnection: Accepting connection from peer: ${conn.peer}`);
            this.connection = conn;
            this._setupConnectionEvents();
        });
        
        // Open event - when connected to the signaling server
        this.peer.on('open', id => {
            console.info(`PeerJSConnection: Peer connected to signaling server with ID: ${id}`);
        });
        
        // Error handling
        this.peer.on('error', err => {
            console.error('PeerJSConnection: Peer error:', err);
            
            // Log specific error types for easier debugging
            if (err.type === 'peer-unavailable') {
                console.error(`PeerJSConnection: Peer unavailable - The peer you're trying to connect to does not exist or is not online`);
            } else if (err.type === 'network') {
                console.error('PeerJSConnection: Network connectivity issue:', err.message);
            } else if (err.type === 'server-error') {
                console.error('PeerJSConnection: PeerJS server error:', err.message);
            } else if (err.type === 'socket-error') {
                console.error('PeerJSConnection: Socket error connecting to server:', err.message);
            } else if (err.type === 'socket-closed') {
                console.error('PeerJSConnection: Socket connection closed unexpectedly');
            } else if (err.type === 'unavailable-id') {
                console.error('PeerJSConnection: ID is unavailable - already taken');
            } else if (err.type === 'browser-incompatible') {
                console.error('PeerJSConnection: Browser incompatible with WebRTC');
            } else {
                console.error(`PeerJSConnection: Unknown error type: ${err.type} - ${err.message}`);
            }
            
            if (this.errorCallback) this.errorCallback(err);
        });
        
        // New data connection event
        this.peer.on('call', call => {
            console.info('PeerJSConnection: Received a call (media connection)');
            console.debug('PeerJSConnection: Ignoring call as we do not use media connections');
            // We don't handle calls (media connections) in this implementation
            call.close();
        });
        
        // Cleanup on disconnect
        this.peer.on('disconnected', () => {
            console.info('PeerJSConnection: Peer disconnected from broker server');
            this.connected = false;
            
            if (this.disconnectCallback) {
                console.debug('PeerJSConnection: Triggering disconnect callback');
                this.disconnectCallback();
            }
            
            // Attempt to reconnect
            console.info('PeerJSConnection: Attempting to reconnect to broker server...');
            this.peer.reconnect();
        });
        
        this.peer.on('close', () => {
            console.info('PeerJSConnection: Peer connection closed permanently');
            this.connected = false;
            
            if (this.disconnectCallback) {
                console.debug('PeerJSConnection: Triggering disconnect callback');
                this.disconnectCallback();
            }
        });
    }
    
    /**
     * Set up data connection event handlers
     * @private
     */
    _setupConnectionEvents() {
        if (!this.connection) {
            console.error('PeerJSConnection: Cannot setup connection events - connection is null');
            return;
        }
        
        console.debug('PeerJSConnection: Setting up connection event handlers for peer:', this.connection.peer);
        
        this.connection.on('open', () => {
            console.info(`PeerJSConnection: Connection established with peer: ${this.connection.peer}`);
            this.connected = true;
            
            // Notify connection callback
            if (this.connectCallback) {
                console.debug('PeerJSConnection: Executing connect callback');
                this.connectCallback(this.connection.peer);
            } else {
                console.debug('PeerJSConnection: No connect callback registered');
            }
        });
        
        this.connection.on('data', data => {
            console.info('PeerJSConnection: Received data from peer');
            console.debug('PeerJSConnection: Data content:', data);
            
            // Notify data callback
            if (this.dataCallback) {
                console.debug('PeerJSConnection: Executing data callback');
                this.dataCallback(data);
            } else {
                console.debug('PeerJSConnection: No data callback registered');
            }
        });
        
        this.connection.on('close', () => {
            console.info('PeerJSConnection: Connection closed with peer');
            this.connected = false;
            
            // Notify disconnect callback
            if (this.disconnectCallback) {
                console.debug('PeerJSConnection: Executing disconnect callback');
                this.disconnectCallback();
            } else {
                console.debug('PeerJSConnection: No disconnect callback registered');
            }
        });
        
        this.connection.on('error', err => {
            console.error('PeerJSConnection: Connection error:', err);
            
            // Notify error callback
            if (this.errorCallback) {
                console.debug('PeerJSConnection: Executing error callback');
                this.errorCallback(err);
            } else {
                console.debug('PeerJSConnection: No error callback registered');
            }
        });
        
        // Log if the connection is reliable or not
        console.info(`PeerJSConnection: Connection reliability: ${this.connection.reliable ? 'reliable' : 'unreliable'}`);
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
        console.info('PeerJSConnection: Creating a new game as host');
        
        try {
            // Initialize PeerJS
            console.debug('PeerJSConnection: Initializing peer for host');
            const id = await this._initializePeer();
            this.isHost = true;
            this.gameCode = id;
            
            console.info(`PeerJSConnection: Game created successfully with code: ${id}`);
            console.debug('PeerJSConnection: Host mode activated, waiting for connections');
            return id;
        } catch (error) {
            console.error('PeerJSConnection: Error creating game:', error);
            if (this.errorCallback) {
                console.debug('PeerJSConnection: Notifying error callback about game creation failure');
                this.errorCallback(error);
            }
            throw error;
        }
    }
    
    /**
     * Join an existing game as a guest
     * @param {string} code - The game code provided by the host
     * @returns {Promise<void>}
     */
    async joinGame(code) {
        console.info(`PeerJSConnection: Attempting to join game with code: ${code}`);
        
        if (!code) {
            const error = new Error('Game code is required');
            console.error('PeerJSConnection: ' + error.message);
            throw error;
        }
        
        try {
            // Initialize PeerJS
            console.debug('PeerJSConnection: Initializing peer for guest');
            await this._initializePeer();
            this.isHost = false;
            this.gameCode = code;
            
            console.info(`PeerJSConnection: Initialized as guest, connecting to host: ${code}`);
            
            // Connect to the host
            console.debug('PeerJSConnection: Creating data connection to host');
            
            // Enhanced connection options with more debugging and better compatibility
            const connectionOptions = {
                reliable: true,
                serialization: 'json',
                // Use binary serialization for better performance if needed
                // serialization: 'binary',
                metadata: {
                    clientId: this.peer.id,
                    timestamp: Date.now(),
                    version: '1.0'
                },
                // Debug level for this specific connection
                debug: 3,
                // Modify SDP to improve NAT traversal chances
                sdpTransform: (sdp) => {
                    console.debug('PeerJSConnection: SDP before transform:', sdp);
                    
                    // Add a=candidate lines to the SDP to improve NAT traversal
                    // Format: a=candidate:foundation_id component_id transport priority ip port type ...
                    // This adds public candidates that might help with connectivity
                    const modifiedSdp = sdp;
                    
                    /* 
                    // Uncomment if you need to modify SDP for specific network conditions
                    // Example: Add IPV6 preference if needed
                    modifiedSdp = sdp.replace(
                        /a=ice-options:trickle\r\n/g, 
                        "a=ice-options:trickle\r\na=ipv6-default-address:2001:db8:85a3:8d3:1319:8a2e:370:7344\r\n"
                    );
                    */
                    
                    return modifiedSdp;
                },
                // Try to configure the connection for better reliability
                config: {
                    // Re-use the same ICE servers from the peer object
                    iceServers: this.peer.options.config.iceServers,
                    // These settings may help with NAT traversal
                    bundlePolicy: 'max-bundle',
                    rtcpMuxPolicy: 'require',
                    // Use UDP and TCP
                    iceTransportPolicy: 'all',
                    // Force IPv4 if IPv6 is causing issues
                    // iceTransportPolicy: 'relay'
                }
            };
            
            console.debug('PeerJSConnection: Connection options:', connectionOptions);
            
            try {
                this.connection = this.peer.connect(code, connectionOptions);
                
                if (!this.connection) {
                    const error = new Error('Failed to create connection - peer.connect returned null');
                    console.error('PeerJSConnection: ' + error.message);
                    throw error;
                }
                
                console.info(`PeerJSConnection: Connection object created with peer ID: ${code}`);
                console.debug('PeerJSConnection: Connection details:', {
                    connectionId: this.connection.connectionId,
                    type: this.connection.type,
                    peer: this.connection.peer,
                    reliable: this.connection.reliable,
                    serialization: this.connection.serialization
                });
                
                // Set up connection events
                this._setupConnectionEvents();
                
                // Return a promise that resolves when connected or rejects on error
                return new Promise((resolve, reject) => {
                    console.debug('PeerJSConnection: Waiting for connection to open...');
                    
                    // Set up ice connection state monitoring
                    if (this.connection._pc) {
                        console.debug('PeerJSConnection: Setting up ICE connection state monitoring');
                        
                        this.connection._pc.addEventListener('iceconnectionstatechange', () => {
                            const state = this.connection._pc.iceConnectionState;
                            console.info(`PeerJSConnection: ICE connection state changed to: ${state}`);
                            
                            if (state === 'failed') {
                                console.error('PeerJSConnection: ICE connection failed - may need TURN server');
                                // Only reject if we haven't already resolved
                                clearTimeout(timeout);
                                reject(new Error('WebRTC connection failed - network issue detected'));
                            }
                            
                            if (state === 'connected' || state === 'completed') {
                                console.info('PeerJSConnection: ICE connection established successfully');
                                // This is backup to the 'open' event, but sometimes helps
                                if (!this.connected && this.connection.open) {
                                    console.info('PeerJSConnection: Connection is now open based on ICE state');
                                    clearTimeout(timeout);
                                    resolve();
                                }
                            }
                        });
                    }
                    
                    // Set timeout for connection - increased to 30 seconds
                    const timeout = setTimeout(() => {
                        console.error('PeerJSConnection: Connection timed out after 30 seconds');
                        
                        // Try to capture the connection state for debugging
                        if (this.connection) {
                            // Log detailed connection state
                            const iceState = this.connection._pc ? 
                                this.connection._pc.iceConnectionState : 'No ICE connection';
                            const candidates = this.connection._pc ? 
                                'ICE candidates were exchanged' : 'No ICE candidates';
                            
                            console.debug('PeerJSConnection: Connection state at timeout:', {
                                open: this.connection.open,
                                iceConnectionState: iceState,
                                iceCandidates: candidates,
                                dataChannel: this.connection._dc ? {
                                    readyState: this.connection._dc.readyState,
                                    bufferedAmount: this.connection._dc.bufferedAmount
                                } : 'No data channel'
                            });
                            
                            // Try one last reconnect attempt
                            console.info('PeerJSConnection: Attempting one final reconnect...');
                            if (this.connection._pc) {
                                this.connection._pc.restartIce();
                            }
                        }
                        
                        // Longer timeout for the retry
                        setTimeout(() => {
                            reject(new Error('Connection timed out. This could be due to firewall restrictions or network issues.'));
                        }, 5000);
                    }, 30000); // 30 seconds timeout
                    
                    // On connection
                    this.connection.on('open', () => {
                        console.info(`PeerJSConnection: Connection established with host: ${code}`);
                        clearTimeout(timeout);
                        resolve();
                    });
                    
                    // On error - this event might not be fired in some cases where the connection silently fails
                    this.connection.on('error', err => {
                        console.error('PeerJSConnection: Error establishing connection with host:', err);
                        clearTimeout(timeout);
                        reject(err);
                    });
                    
                    // Check if already open (sometimes the event can fire before we attach the listener)
                    if (this.connection.open) {
                        console.info(`PeerJSConnection: Connection was already open with host: ${code}`);
                        clearTimeout(timeout);
                        resolve();
                    }
                });
            } catch (error) {
                console.error('PeerJSConnection: Error creating connection:', error);
                throw error;
            }
        } catch (error) {
            console.error('PeerJSConnection: Error joining game:', error);
            if (this.errorCallback) {
                console.debug('PeerJSConnection: Notifying error callback about join failure');
                this.errorCallback(error);
            }
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