/**
 * ConnectionInterface - Abstract interface for network connections
 * All connection implementations must implement these methods
 */
export class ConnectionInterface {
    /**
     * Create a new game as the host
     * @returns {Promise<string>} Game code that can be shared with others
     */
    async createGame() { 
        throw new Error("Method 'createGame()' not implemented"); 
    }
    
    /**
     * Join an existing game as a guest
     * @param {string} code - The game code provided by the host
     * @returns {Promise<void>}
     */
    async joinGame(code) { 
        throw new Error("Method 'joinGame()' not implemented"); 
    }
    
    /**
     * Register callback to be called when connected to peer
     * @param {Function} callback - Function(peerId) to call on connection
     */
    onConnect(callback) { 
        throw new Error("Method 'onConnect()' not implemented"); 
    }
    
    /**
     * Register callback to be called when disconnected from peer
     * @param {Function} callback - Function() to call on disconnection
     */
    onDisconnect(callback) { 
        throw new Error("Method 'onDisconnect()' not implemented"); 
    }
    
    /**
     * Register callback to be called when data is received
     * @param {Function} callback - Function(data) to call when data is received
     */
    onData(callback) { 
        throw new Error("Method 'onData()' not implemented"); 
    }
    
    /**
     * Register callback to be called when an error occurs
     * @param {Function} callback - Function(error) to call on error
     */
    onError(callback) { 
        throw new Error("Method 'onError()' not implemented"); 
    }
    
    /**
     * Send data to the connected peer
     * @param {any} data - Data to send (will be serialized as JSON)
     * @returns {Promise<void>}
     */
    async sendData(data) { 
        throw new Error("Method 'sendData()' not implemented"); 
    }
    
    /**
     * Disconnect from the current game/peer
     * @returns {Promise<void>}
     */
    async disconnect() { 
        throw new Error("Method 'disconnect()' not implemented"); 
    }
    
    /**
     * Check if currently connected to a peer
     * @returns {boolean} True if connected
     */
    isConnected() { 
        throw new Error("Method 'isConnected()' not implemented"); 
    }
    
    /**
     * Get connection info (implementation specific)
     * @returns {Object} Connection details
     */
    getConnectionInfo() {
        throw new Error("Method 'getConnectionInfo()' not implemented");
    }
}