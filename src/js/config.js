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
        
        // Special local testing mode for same-machine connections
        // Set this to true when testing two instances on the same computer
        localTestingMode: true,
        
        // PeerJS specific settings
        peerjs: {
            usePublicServer: true,
            // Connection options
            options: {
                debug: 3, // Log level (0=disabled, 1=errors, 2=warnings, 3=all)
                secure: true, // Use secure connection
                config: {
                    // ICE server configuration - adding more STUN servers and TURN servers
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' },
                        { urls: 'stun:stun3.l.google.com:19302' },
                        { urls: 'stun:stun4.l.google.com:19302' },
                        // Free TURN servers from Twilio (limited but free)
                        { 
                            urls: 'turn:global.turn.twilio.com:3478?transport=udp',
                            username: 'f4b4035eaa76f4a55de5f4351567653ee4ff6fa97b50b6b334fcc1be9c27212d',
                            credential: 'w1uxM55V9yVoqyVFjt+mxDBV0F87AUCemaYVQGxsPLw='
                        },
                        {
                            urls: 'turn:global.turn.twilio.com:3478?transport=tcp',
                            username: 'f4b4035eaa76f4a55de5f4351567653ee4ff6fa97b50b6b334fcc1be9c27212d',
                            credential: 'w1uxM55V9yVoqyVFjt+mxDBV0F87AUCemaYVQGxsPLw='
                        }
                    ],
                    iceCandidatePoolSize: 10,
                    iceTransportPolicy: 'all'
                }
            },
            
            // Local testing options - used only when localTestingMode is true
            localTestingOptions: {
                // Special configuration for testing on the same machine 
                // This uses a data channel directly without ICE
                debug: 3,
                // This configuration allows WebRTC to connect to itself on the same machine
                config: {
                    iceServers: [],  // No ICE servers needed for local testing
                    iceTransportPolicy: 'relay', // Force relay
                    // Setting for Chrome that helps with local connections
                    // This disables the use of mDNS which can cause issues with local testing
                    sdpSemantics: 'unified-plan',
                    rtcpMuxPolicy: 'require'
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