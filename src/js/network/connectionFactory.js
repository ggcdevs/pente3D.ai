import { PeerJSConnection } from './peerJSConnection.js';
// Future imports will go here
// import { WebTorrentConnection } from './webTorrentConnection.js';

/**
 * Creates a connection instance based on the specified type
 * @param {string} type - The type of connection to create
 * @param {Object} config - Configuration for the connection
 * @returns {ConnectionInterface} A connection instance
 */
export function createConnection(type = 'peerjs', config = {}) {
    switch (type.toLowerCase()) {
        case 'peerjs':
            return new PeerJSConnection(config.peerjs || {});
        // Future connection types
        // case 'webtorrent':
        //     return new WebTorrentConnection(config.webtorrent || {});
        // case 'local':
        //     return new LocalNetworkConnection(config.local || {});
        default:
            throw new Error(`Connection type '${type}' not supported`);
    }
}