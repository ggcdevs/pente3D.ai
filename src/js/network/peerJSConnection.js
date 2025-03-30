import { ConnectionInterface } from './connectionInterface.js';
import { CONFIG } from '../config.js';

// Simple LocalChannel implementation for when testing on the same device
// This bypasses WebRTC completely for local testing
class LocalChannel {
    // Static storage for channel objects, accessible across all instances
    // Using an object that will be shared by reference across browser tabs/windows
    static channels = {};
    
    // Store a reference to the window object to detect if we're in the same tab
    static windowRef = window;
    
    // Helper function to enable reliable message passing between browser tabs
    static findOrCreateChannel(id) {
        if (!LocalChannel.channels[id]) {
            console.warn(`LocalChannel: Channel ${id} not found in map, creating placeholder`);
            
            // Don't call the constructor to avoid circular reference
            // This creates a minimal channel with just enough functionality to handle messages
            LocalChannel.channels[id] = {
                localPeerId: id,
                remotePeerId: null,
                isOpen: true,
                callbacks: {
                    open: [],
                    data: [],
                    close: [],
                    error: []
                },
                // Add on method to allow registering handlers on placeholders
                on: function(event, callback) {
                    console.log(`LocalChannel: Placeholder ${id} registering ${event} handler`);
                    if (this.callbacks[event]) {
                        this.callbacks[event].push(callback);
                        console.log(`LocalChannel: Placeholder ${id} now has ${this.callbacks[event].length} ${event} handlers`);
                    }
                },
                // Add send method to allow sending from placeholders
                send: function(data) {
                    console.log(`LocalChannel: Placeholder ${id} attempting to send:`, data);
                    if (this.remotePeerId && LocalChannel.channels[this.remotePeerId]) {
                        console.log(`LocalChannel: Placeholder ${id} sending to ${this.remotePeerId}`);
                        const dataCopy = JSON.parse(JSON.stringify(data));
                        setTimeout(() => {
                            LocalChannel.channels[this.remotePeerId]._trigger('data', dataCopy);
                        }, 100);
                        return true;
                    } else {
                        console.error(`LocalChannel: Placeholder ${id} has no remote peer to send to`);
                        return false;
                    }
                },
                // Trigger method
                _trigger: function(event, data) {
                    console.log(`LocalChannel: Placeholder ${id} triggering ${event} event with data:`, data);
                    if (this.callbacks[event]) {
                        console.log(`LocalChannel: Placeholder ${id} has ${this.callbacks[event].length} handlers for ${event}`);
                        this.callbacks[event].forEach(callback => {
                            try {
                                callback(data);
                                console.log(`LocalChannel: Placeholder ${id} ${event} handler executed successfully`);
                            } catch (err) {
                                console.error(`LocalChannel: Placeholder ${id} ${event} handler error:`, err);
                            }
                        });
                    } else {
                        console.warn(`LocalChannel: Placeholder ${id} has no handlers for ${event} event`);
                    }
                }
            };
        }
        return LocalChannel.channels[id];
    }
    
    constructor(localPeerId, remotePeerId) {
        this.localPeerId = localPeerId;
        this.remotePeerId = remotePeerId;
        this.callbacks = {
            open: [],
            data: [],
            close: [],
            error: []
        };
        this.isOpen = false;
        
        // Register in the static channels map
        LocalChannel.channels[localPeerId] = this;
        
        console.log(`LocalChannel: Created channel from ${localPeerId} to ${remotePeerId}`);
        console.log(`LocalChannel: Current channels in map:`, Object.keys(LocalChannel.channels));
        
        // Also create or ensure the remote channel exists for bidirectional communication
        if (remotePeerId) {
            const remoteChannel = LocalChannel.findOrCreateChannel(remotePeerId);
            console.log(`LocalChannel: Ensured remote channel ${remotePeerId} exists`);
            
            // Set up the relationship
            if (!remoteChannel.remotePeerId) {
                remoteChannel.remotePeerId = localPeerId;
                console.log(`LocalChannel: Updated remote channel with remotePeerId = ${localPeerId}`);
            }
        }
        
        // Auto-open the channel with a small delay to simulate connection time
        setTimeout(() => {
            this.isOpen = true;
            this._trigger('open');
            console.log(`LocalChannel: Channel ${localPeerId} is now open`);
        }, 500);
    }
    
    // Send data to the other peer
    send(data) {
        if (!this.isOpen) {
            console.error('LocalChannel: Cannot send - channel not open');
            return;
        }
        
        if (!this.remotePeerId) {
            console.error('LocalChannel: Cannot send - no remote peer ID specified');
            return;
        }
        
        console.log(`LocalChannel: Attempting to send data from ${this.localPeerId} to ${this.remotePeerId}`);
        console.log(`LocalChannel: Available channels:`, Object.keys(LocalChannel.channels));
        
        // Get the other peer's channel
        const otherChannel = LocalChannel.findOrCreateChannel(this.remotePeerId);
        
        // Ensure the remote channel is properly configured
        if (otherChannel.remotePeerId === null) {
            otherChannel.remotePeerId = this.localPeerId;
            console.log(`LocalChannel: Updated remote channel with remotePeerId = ${this.localPeerId}`);
        }
        
        // Use window.postMessage to communicate between browser windows if needed
        // This is a simple way to ensure channel state is consistent across tabs
        if (window !== LocalChannel.windowRef) {
            console.log(`LocalChannel: Detected cross-window communication need`);
            // For simplicity, we'll use the direct approach
        }
        
        // Create a copy of data to avoid reference issues
        const dataCopy = JSON.parse(JSON.stringify(data));
        
        // Simulate network delay
        setTimeout(() => {
            otherChannel._trigger('data', dataCopy);
            console.log(`LocalChannel: Data delivered to ${this.remotePeerId}:`, dataCopy);
        }, 100);
        
        console.log(`LocalChannel: Sent data from ${this.localPeerId} to ${this.remotePeerId}:`, data);
        return true;
    }
    
    // Close the channel
    close() {
        console.log(`LocalChannel: Closing channel ${this.localPeerId}`);
        this.isOpen = false;
        this._trigger('close');
        
        // Don't delete from channel map, as it might be needed for cross-window communication
        // Instead mark it as closed so other peers can detect this state
        LocalChannel.channels[this.localPeerId].isOpen = false;
        
        console.log(`LocalChannel: Closed channel ${this.localPeerId}`);
    }
    
    // Register event handlers
    on(event, callback) {
        console.log(`LocalChannel: Registering ${event} event handler on channel ${this.localPeerId}`);
        if (this.callbacks[event]) {
            this.callbacks[event].push(callback);
        }
    }
    
    // Trigger an event
    _trigger(event, data) {
        console.log(`LocalChannel: Triggering ${event} event on channel ${this.localPeerId}`);
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`LocalChannel: Error in ${event} callback:`, error);
                }
            });
        }
    }
}

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
                
                // Check if we're in local testing mode
                const isLocalTesting = CONFIG.network.localTestingMode === true;
                
                if (isLocalTesting) {
                    // Special configuration for local testing (same machine)
                    console.info('PeerJSConnection: Using LOCAL TESTING MODE configuration');
                    const options = this.config.localTestingOptions || {};
                    console.debug('PeerJSConnection: Using local testing options:', options);
                    
                    this.peer = new Peer(id, options);
                    console.debug('PeerJSConnection: Peer created with local testing config', this.peer);
                    console.warn('PeerJSConnection: LOCAL TESTING MODE is enabled - this will only work on the same machine');
                }
                else if (this.config.usePublicServer) {
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
            // Check if we're in local testing mode
            const isLocalTesting = CONFIG.network.localTestingMode === true;
            
            if (isLocalTesting) {
                console.warn('PeerJSConnection: Using direct local channel for testing');
                // Generate a simple ID for local testing
                const id = this._generateId();
                this.isHost = true;
                this.gameCode = id;
                this.peer = { id: id };  // Simple peer object for compatibility
                
                // Create a LocalChannel for ourselves that browsers can find across windows
                console.info(`PeerJSConnection: Creating host LocalChannel with ID: ${id}`);
                
                // First, check if a channel already exists for this ID (reconnection case)
                let hostChannel;
                if (LocalChannel.channels[id]) {
                    console.log(`PeerJSConnection: Using existing channel for host ${id}`);
                    hostChannel = LocalChannel.channels[id];
                } else {
                    console.log(`PeerJSConnection: Creating new channel for host ${id}`);
                    hostChannel = new LocalChannel(id, null);
                }
                
                this.connection = hostChannel; // Store the channel
                
                // Enable window storage to share state across windows
                try {
                    // Store the game code in localStorage so other windows can find it
                    window.localStorage.setItem('localChannel_hostId', id);
                    console.log(`PeerJSConnection: Stored host ID ${id} in localStorage`);
                } catch (err) {
                    console.warn(`PeerJSConnection: Could not store host ID in localStorage:`, err);
                }
                
                // Set up local channel events
                console.log(`PeerJSConnection: Setting up event handlers for host channel ${id}`);
                
                // Set up the open event handler
                hostChannel.on('open', () => {
                    console.info(`PeerJSConnection: Host local channel opened with ID ${id}`);
                    this.connected = true;
                    
                    // Log the channel status
                    console.log(`PeerJSConnection: Host channel is now open and ready to receive data`);
                    console.log(`PeerJSConnection: Available channels:`, Object.keys(LocalChannel.channels));
                    
                    // Notify connection callback to indicate "self-connection" is ready
                    if (this.connectCallback) {
                        console.debug('PeerJSConnection: Executing host connect callback');
                        this.connectCallback(id);
                    }
                });
                
                // This is the most important handler - where the client's join message will be received
                hostChannel.on('data', (data) => {
                    console.info(`PeerJSConnection: Host received data on local channel:`, data);
                    
                    // For debugging - log all channels after receiving data
                    console.debug('LocalChannel: All channels after receiving data:', Object.keys(LocalChannel.channels));
                    
                    // Check if we received join data and store the client's ID for future messaging
                    if (data && data.type === 'join' && data.playerInfo) {
                        console.info(`PeerJSConnection: Join message received, storing client info:`, data.playerInfo);
                        
                        // We would normally get this from the connection object
                        // But for LocalChannel, we need to extract it
                        if (data.playerInfo.clientId) {
                            this.clientPeerId = data.playerInfo.clientId;
                            console.info(`PeerJSConnection: Stored client ID: ${this.clientPeerId}`);
                            
                            // Update the remote channel relationship
                            if (LocalChannel.channels[id].remotePeerId === null) {
                                LocalChannel.channels[id].remotePeerId = this.clientPeerId;
                                console.log(`PeerJSConnection: Updated host channel with remotePeerId = ${this.clientPeerId}`);
                            }
                            
                            // Extra debugging - log the channel state
                            const hostChannel = LocalChannel.channels[id];
                            console.log(`PeerJSConnection: Host channel state:`, {
                                id: hostChannel.localPeerId,
                                remotePeerId: hostChannel.remotePeerId,
                                isOpen: hostChannel.isOpen,
                                callbackCounts: {
                                    open: hostChannel.callbacks.open.length,
                                    data: hostChannel.callbacks.data.length,
                                    close: hostChannel.callbacks.close.length,
                                    error: hostChannel.callbacks.error.length
                                }
                            });
                        }
                    }
                    
                    // Pass data to callback
                    if (this.dataCallback) {
                        console.debug('PeerJSConnection: Executing host data callback with data:', data);
                        try {
                            this.dataCallback(data);
                            console.log(`PeerJSConnection: Host data callback completed successfully`);
                        } catch (err) {
                            console.error(`PeerJSConnection: Error in host data callback:`, err);
                        }
                    } else {
                        console.warn('PeerJSConnection: No data callback registered to process message:', data);
                    }
                });
                
                console.info(`PeerJSConnection: Game created with LOCAL TEST mode code: ${id}`);
                return id;
            } else {
                // Standard PeerJS initialization for normal operation
                console.debug('PeerJSConnection: Initializing peer for host');
                const id = await this._initializePeer();
                this.isHost = true;
                this.gameCode = id;
                
                console.info(`PeerJSConnection: Game created successfully with code: ${id}`);
                console.debug('PeerJSConnection: Host mode activated, waiting for connections');
                return id;
            }
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
            // Check if we're in local testing mode
            const isLocalTesting = CONFIG.network.localTestingMode === true;
            
            if (isLocalTesting) {
                console.warn('PeerJSConnection: Using direct local channel for local testing');
                
                // For local testing, create a simple peer ID
                const localId = this._generateId();
                this.isHost = false;
                this.gameCode = code;
                this.peer = { id: localId };  // Simple peer object for compatibility
                
                // Create a direct local channel instead of WebRTC
                console.info(`PeerJSConnection: Creating local test channel from ${localId} to ${code}`);
                
                return new Promise((resolve, reject) => {
                    try {
                        // First, check if we can find the host ID in localStorage
                        const storedHostId = window.localStorage.getItem('localChannel_hostId');
                        if (storedHostId && storedHostId === code) {
                            console.log(`PeerJSConnection: Found matching host ID ${code} in localStorage`);
                        }
                        
                        // Wait a moment to ensure host channel is created and registered
                        setTimeout(() => {
                            console.info(`PeerJSConnection: Checking for host channel before connecting...`);
                            console.log(`LocalChannel: Available channels in client window:`, Object.keys(LocalChannel.channels));
                            
                            // If host channel exists in our window, log its state
                            if (LocalChannel.channels[code]) {
                                console.log(`PeerJSConnection: Host channel ${code} found in client window`);
                                const hostChannel = LocalChannel.channels[code];
                                console.log(`PeerJSConnection: Host channel state:`, {
                                    remotePeerId: hostChannel.remotePeerId,
                                    isOpen: hostChannel.isOpen,
                                    hasCallbacks: {
                                        open: hostChannel.callbacks.open.length > 0,
                                        data: hostChannel.callbacks.data.length > 0,
                                        close: hostChannel.callbacks.close.length > 0,
                                        error: hostChannel.callbacks.error.length > 0
                                    }
                                });
                            } else {
                                console.log(`PeerJSConnection: Host channel ${code} not found in client window, will create placeholder`);
                            }
                            
                            // Create local channel that directly connects to the host
                            console.log(`PeerJSConnection: Creating client channel ${localId} with remote ${code}`);
                            const channel = new LocalChannel(localId, code);
                            this.connection = channel;
                            
                            console.log(`PeerJSConnection: Setting up event handlers for client channel ${localId}`);
                            
                            // Set up local channel events
                            channel.on('open', () => {
                                console.info(`PeerJSConnection: Local channel opened to ${code}`);
                                this.connected = true;
                                
                                // Check if host channel exists, create if missing
                                if (!LocalChannel.channels[code]) {
                                    console.warn(`LocalChannel: Host channel ${code} not found, creating a placeholder`);
                                    const hostChannelPlaceholder = LocalChannel.findOrCreateChannel(code);
                                    
                                    // Set the relationship
                                    hostChannelPlaceholder.remotePeerId = localId;
                                    console.log(`LocalChannel: Set placeholder host channel ${code} remotePeerId to ${localId}`);
                                } else {
                                    console.log(`LocalChannel: Host channel ${code} exists`);
                                    // Update relationship if needed
                                    if (!LocalChannel.channels[code].remotePeerId) {
                                        LocalChannel.channels[code].remotePeerId = localId;
                                        console.log(`LocalChannel: Updated host channel ${code} remotePeerId to ${localId}`);
                                    }
                                }
                                
                                // Print debug info about all channels
                                for (const channelId of Object.keys(LocalChannel.channels)) {
                                    const ch = LocalChannel.channels[channelId];
                                    console.log(`Channel ${channelId} -> ${ch.remotePeerId || 'null'}, isOpen: ${ch.isOpen}, dataHandlers: ${ch.callbacks.data.length}`);
                                }
                                
                                // Handle connection open
                                if (this.connectCallback) {
                                    console.log(`PeerJSConnection: Executing client connect callback for peer ${code}`);
                                    this.connectCallback(code);
                                }
                                
                                resolve();
                            });
                            
                            channel.on('data', (data) => {
                                console.info(`PeerJSConnection: Client received data:`, data);
                                
                                // Pass data to callback
                                if (this.dataCallback) {
                                    console.log(`PeerJSConnection: Executing client data callback`);
                                    try {
                                        this.dataCallback(data);
                                        console.log(`PeerJSConnection: Client data callback completed successfully`);
                                    } catch (err) {
                                        console.error(`PeerJSConnection: Error in client data callback:`, err);
                                    }
                                } else {
                                    console.warn(`PeerJSConnection: No client data callback registered`);
                                }
                            });
                            
                            channel.on('close', () => {
                                console.info(`PeerJSConnection: Local channel closed`);
                                this.connected = false;
                                
                                if (this.disconnectCallback) {
                                    console.log(`PeerJSConnection: Executing client disconnect callback`);
                                    this.disconnectCallback();
                                }
                            });
                            
                            channel.on('error', (err) => {
                                console.error(`PeerJSConnection: Local channel error:`, err);
                                
                                if (this.errorCallback) {
                                    console.log(`PeerJSConnection: Executing client error callback`);
                                    this.errorCallback(err);
                                }
                            });
                        }, 200); // Give more time for initialization
                        
                    } catch (err) {
                        console.error('PeerJSConnection: Error creating local channel:', err);
                        reject(err);
                    }
                });
            }
            
            // Initialize PeerJS for non-local testing
            console.debug('PeerJSConnection: Initializing peer for guest (standard WebRTC)');
            await this._initializePeer();
            this.isHost = false;
            this.gameCode = code;
            
            console.info(`PeerJSConnection: Initialized as guest, connecting to host: ${code}`);
            
            // Connect to the host
            console.debug('PeerJSConnection: Creating data connection to host');
            
            // Enhanced connection options with more debugging and better compatibility
            // Standard connection options for WebRTC
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
                
            // Using standard WebRTC options here 
            // (Local testing mode is handled in the separate path above)
            
            console.debug('PeerJSConnection: Connection options:', connectionOptions);
            
            try {
                this.connection = this.peer.connect(code, connectionOptions);
                
                if (!this.connection) {
                    const error = new Error('Failed to create connection - peer.connect returned null');
                    console.error('PeerJSConnection: ' + error.message);
                    throw error;
                }
                
                console.info(`PeerJSConnection: Standard WebRTC connection created to host: ${code}`);
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
        if (!this.connection) {
            console.error('PeerJSConnection: Cannot send data - no connection object');
            throw new Error('Not connected to a peer');
        }
        
        // Special handling for local testing mode
        const isLocalTesting = CONFIG.network.localTestingMode === true;
        
        if (isLocalTesting) {
            // Use local channel directly
            try {
                console.debug('PeerJSConnection: Sending data via local channel:', data);
                
                if (this.connection.send) {
                    this.connection.send(data);
                    return Promise.resolve();
                } else {
                    console.error('PeerJSConnection: Local channel does not have send method');
                    throw new Error('Local channel implementation error');
                }
            } catch (error) {
                console.error('PeerJSConnection: Error sending data via local channel:', error);
                if (this.errorCallback) this.errorCallback(error);
                throw error;
            }
        } else {
            // Standard WebRTC data channel
            if (!this.connected) {
                console.error('PeerJSConnection: Cannot send data - not connected');
                throw new Error('Not connected to a peer');
            }
            
            try {
                console.debug('PeerJSConnection: Sending data via WebRTC:', data);
                this.connection.send(data);
                return Promise.resolve();
            } catch (error) {
                console.error('PeerJSConnection: Error sending data via WebRTC:', error);
                if (this.errorCallback) this.errorCallback(error);
                throw error;
            }
        }
    }
    
    /**
     * Disconnect from the current game/peer
     * @returns {Promise<void>}
     */
    async disconnect() {
        // Special handling for local testing mode
        const isLocalTesting = CONFIG.network.localTestingMode === true;
        
        console.info('PeerJSConnection: Disconnecting from game');
        
        // Close connection
        if (this.connection) {
            console.debug('PeerJSConnection: Closing connection');
            
            if (isLocalTesting) {
                // LocalChannel close
                if (this.connection.close) {
                    console.debug('PeerJSConnection: Closing local channel');
                    this.connection.close();
                }
            } else {
                // WebRTC connection close
                console.debug('PeerJSConnection: Closing WebRTC connection');
                this.connection.close();
            }
            
            this.connection = null;
        }
        
        // Destroy peer if it's a WebRTC peer
        if (this.peer && this.peer.destroy && !isLocalTesting) {
            console.debug('PeerJSConnection: Destroying peer');
            this.peer.destroy();
        }
        
        // Reset state
        this.peer = null;
        this.connected = false;
        this.gameCode = null;
        this.isHost = false;
        
        console.info('PeerJSConnection: Disconnected successfully');
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