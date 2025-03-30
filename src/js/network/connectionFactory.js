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
    console.info(`ConnectionFactory: Creating connection of type: ${type}`);
    
    switch (type.toLowerCase()) {
        case 'peerjs':
            console.debug('ConnectionFactory: Instantiating PeerJSConnection with config:', config.peerjs || {});
            return new PeerJSConnection(config.peerjs || {});
        // Future connection types
        // case 'webtorrent':
        //     console.debug('ConnectionFactory: Instantiating WebTorrentConnection with config:', config.webtorrent || {});
        //     return new WebTorrentConnection(config.webtorrent || {});
        // case 'local':
        //     console.debug('ConnectionFactory: Instantiating LocalNetworkConnection with config:', config.local || {});
        //     return new LocalNetworkConnection(config.local || {});
        default:
            console.error(`ConnectionFactory: Connection type '${type}' not supported`);
            throw new Error(`Connection type '${type}' not supported`);
    }
}