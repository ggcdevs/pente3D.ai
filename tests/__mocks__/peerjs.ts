import { EventEmitter } from 'events';

export class MockDataConnection extends EventEmitter {
  peer: string;
  open = false;
  reliable = true;
  serialization = 'json';

  constructor(peer: string) {
    super();
    this.peer = peer;
  }

  send(data: any): void {
    if (!this.open) {
      throw new Error('Connection is not open');
    }
    // Simulate successful send
  }

  close(): void {
    this.open = false;
    this.emit('close');
  }

  // Simulate opening the connection
  _simulateOpen(): void {
    this.open = true;
    this.emit('open');
  }

  // Simulate receiving data
  _simulateData(data: any): void {
    this.emit('data', data);
  }

  // Simulate error
  _simulateError(error: Error): void {
    this.emit('error', error);
  }
}

export class MockPeer extends EventEmitter {
  id: string;
  open = false;
  destroyed = false;
  disconnected = false;
  connections: Map<string, MockDataConnection> = new Map();

  constructor(id?: string, options?: any) {
    super();
    this.id = id || `mock-peer-${Math.random().toString(36).substr(2, 9)}`;
    
    // Simulate peer opening
    setTimeout(() => {
      if (!this.destroyed) {
        this.open = true;
        this.emit('open', this.id);
      }
    }, 10);
  }

  connect(peer: string, options?: any): MockDataConnection {
    if (!this.open) {
      throw new Error('Peer is not open');
    }

    const conn = new MockDataConnection(peer);
    this.connections.set(peer, conn);
    
    // Simulate connection opening
    setTimeout(() => {
      conn._simulateOpen();
    }, 10);
    
    return conn;
  }

  destroy(): void {
    this.destroyed = true;
    this.open = false;
    
    // Close all connections
    this.connections.forEach(conn => conn.close());
    this.connections.clear();
    
    this.emit('close');
  }

  reconnect(): void {
    if (!this.disconnected) {
      return;
    }
    
    this.disconnected = false;
    this.emit('open', this.id);
  }

  disconnect(): void {
    this.disconnected = true;
    this.emit('disconnected');
  }

  // Mock methods for testing
  _simulateIncomingConnection(peerId: string): MockDataConnection {
    const conn = new MockDataConnection(peerId);
    this.connections.set(peerId, conn);
    this.emit('connection', conn);
    return conn;
  }

  _simulateError(error: Error): void {
    this.emit('error', error);
  }
}

// Default export to match PeerJS
const Peer = MockPeer;

module.exports = Peer;
module.exports.default = Peer;