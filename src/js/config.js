/**
 * Game configuration
 * Central place for configurable parameters
 */
export const CONFIG = {
    game: {
        boardSize: 9,
        nodeSpacing: 1.0
    },
    network: {
        // Change this to switch connection types: 'peerjs', 'webtorrent', etc.
        connectionType: 'peerjs',
        debug: true, // Set to false in production
        
        // PeerJS specific settings
        peerjs: {
            usePublicServer: true,
            // Connection options
            options: {
                debug: 3, // Log level (0=disabled, 1=errors, 2=warnings, 3=all)
                secure: true, // Use secure connection
                config: {
                    // ICE server configuration
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' }
                    ]
                }
            },
            // Custom server settings (only used if usePublicServer is false)
            customServer: {
                host: 'localhost',
                port: 9000,
                path: '/peerjs',
                secure: false
            }
        },
        
        // WebTorrent specific settings (for future implementation)
        webtorrent: {
            // Future settings
        }
    },
    ui: {
        animations: true,
        sounds: true
    }
};