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