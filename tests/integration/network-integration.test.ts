import { NetworkManager, ConnectionStatus, MessageType } from '@/network';
import { Game, Move, Player, Vector3 } from '@/core';
import { MockPeer, MockDataConnection } from '../../__mocks__/peerjs';

// Mock PeerJS
jest.mock('peerjs');

describe('Network Integration Tests', () => {
  let hostGame: Game;
  let clientGame: Game;
  let hostNetwork: NetworkManager;
  let clientNetwork: NetworkManager;
  let hostPeer: MockPeer;
  let clientPeer: MockPeer;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Create games for host and client
    hostGame = new Game({ boardSize: 7 });
    clientGame = new Game({ boardSize: 7 });
    
    // Create network managers
    hostNetwork = new NetworkManager(hostGame, {
      reconnectTimeout: 1000,
      pingInterval: 5000,
    });
    
    clientNetwork = new NetworkManager(clientGame, {
      reconnectTimeout: 1000,
      pingInterval: 5000,
    });
  });

  afterEach(() => {
    hostNetwork.dispose();
    clientNetwork.dispose();
    jest.useRealTimers();
  });

  describe('host and client connection', () => {
    it('should establish connection between host and client', async () => {
      // Host creates game
      const gameCode = await hostNetwork.hostGame();
      hostPeer = (hostNetwork as any).peer as MockPeer;
      
      // Client joins game
      await clientNetwork.joinGame(gameCode);
      clientPeer = (clientNetwork as any).peer as MockPeer;
      
      // Simulate connection establishment
      const hostConn = hostPeer._simulateIncomingConnection(clientPeer.id);
      hostConn._simulateOpen();
      
      // Wait for connections to establish
      jest.runAllTimers();
      
      expect(hostNetwork.getStatus()).toBe(ConnectionStatus.CONNECTED);
      expect(clientNetwork.getStatus()).toBe(ConnectionStatus.CONNECTED);
    });

    it('should emit connected events on both sides', async () => {
      const hostConnectedSpy = jest.fn();
      const clientConnectedSpy = jest.fn();
      
      hostNetwork.on('connected', hostConnectedSpy);
      clientNetwork.on('connected', clientConnectedSpy);
      
      // Establish connection
      const gameCode = await hostNetwork.hostGame();
      await clientNetwork.joinGame(gameCode);
      
      hostPeer = (hostNetwork as any).peer as MockPeer;
      clientPeer = (clientNetwork as any).peer as MockPeer;
      
      const hostConn = hostPeer._simulateIncomingConnection(clientPeer.id);
      hostConn._simulateOpen();
      
      jest.runAllTimers();
      
      expect(hostConnectedSpy).toHaveBeenCalled();
      expect(clientConnectedSpy).toHaveBeenCalled();
    });
  });

  describe('move synchronization', () => {
    let hostConn: MockDataConnection;
    let clientConn: MockDataConnection;

    beforeEach(async () => {
      // Establish connection
      const gameCode = await hostNetwork.hostGame();
      await clientNetwork.joinGame(gameCode);
      
      hostPeer = (hostNetwork as any).peer as MockPeer;
      clientPeer = (clientNetwork as any).peer as MockPeer;
      
      hostConn = hostPeer._simulateIncomingConnection(clientPeer.id);
      hostConn._simulateOpen();
      
      clientConn = clientPeer.connections.values().next().value;
      if (clientConn) {
        clientConn._simulateOpen();
      }
      
      jest.runAllTimers();
    });

    it('should synchronize moves between host and client', () => {
      const clientMoveSpy = jest.fn();
      clientNetwork.on('move', clientMoveSpy);
      
      // Host makes a move
      const move = new Move(
        new Vector3(3, 3, 3),
        hostGame.getCurrentPlayer(),
        Date.now()
      );
      
      hostGame.placePiece(move.position);
      hostNetwork.sendMove(move);
      
      // Simulate message delivery
      const sentMessage = (hostConn.send as jest.Mock).mock.calls[0][0];
      clientConn._simulateData(sentMessage);
      
      expect(clientMoveSpy).toHaveBeenCalledWith({
        move: expect.objectContaining({
          position: move.position,
          player: move.player,
        }),
        stateHash: hostGame.getCurrentState().generateHash(),
      });
    });

    it('should synchronize undo operations', () => {
      const clientUndoSpy = jest.fn();
      clientNetwork.on('undo', clientUndoSpy);
      
      // Make a move first
      hostGame.placePiece(new Vector3(3, 3, 3));
      clientGame.placePiece(new Vector3(3, 3, 3));
      
      // Host undoes
      hostGame.undo();
      hostNetwork.sendUndo();
      
      // Simulate message delivery
      const sentMessage = (hostConn.send as jest.Mock).mock.calls[0][0];
      clientConn._simulateData(sentMessage);
      
      expect(clientUndoSpy).toHaveBeenCalledWith({
        stateHash: hostGame.getCurrentState().generateHash(),
      });
    });

    it('should synchronize redo operations', () => {
      const clientRedoSpy = jest.fn();
      clientNetwork.on('redo', clientRedoSpy);
      
      // Make a move and undo
      hostGame.placePiece(new Vector3(3, 3, 3));
      clientGame.placePiece(new Vector3(3, 3, 3));
      hostGame.undo();
      clientGame.undo();
      
      // Host redoes
      hostGame.redo();
      hostNetwork.sendRedo();
      
      // Simulate message delivery
      const sentMessage = (hostConn.send as jest.Mock).mock.calls[0][0];
      clientConn._simulateData(sentMessage);
      
      expect(clientRedoSpy).toHaveBeenCalledWith({
        stateHash: hostGame.getCurrentState().generateHash(),
      });
    });

    it('should synchronize reset operations', () => {
      const clientResetSpy = jest.fn();
      clientNetwork.on('reset', clientResetSpy);
      
      // Make some moves
      hostGame.placePiece(new Vector3(3, 3, 3));
      clientGame.placePiece(new Vector3(3, 3, 3));
      
      // Host resets
      hostGame.reset();
      hostNetwork.sendReset();
      
      // Simulate message delivery
      const sentMessage = (hostConn.send as jest.Mock).mock.calls[0][0];
      clientConn._simulateData(sentMessage);
      
      expect(clientResetSpy).toHaveBeenCalledWith({
        stateHash: hostGame.getCurrentState().generateHash(),
      });
    });
  });

  describe('state synchronization', () => {
    let hostConn: MockDataConnection;
    let clientConn: MockDataConnection;

    beforeEach(async () => {
      // Establish connection
      const gameCode = await hostNetwork.hostGame();
      await clientNetwork.joinGame(gameCode);
      
      hostPeer = (hostNetwork as any).peer as MockPeer;
      clientPeer = (clientNetwork as any).peer as MockPeer;
      
      hostConn = hostPeer._simulateIncomingConnection(clientPeer.id);
      hostConn._simulateOpen();
      
      clientConn = clientPeer.connections.values().next().value;
      if (clientConn) {
        clientConn._simulateOpen();
      }
      
      jest.runAllTimers();
    });

    it('should handle sync requests', () => {
      // Client requests sync
      clientNetwork.requestSync();
      
      // Get the sync request message
      const syncRequest = (clientConn.send as jest.Mock).mock.calls[0][0];
      
      // Clear send spy
      (hostConn.send as jest.Mock).mockClear();
      
      // Host receives sync request
      hostConn._simulateData(syncRequest);
      
      // Host should send sync response
      expect(hostConn.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.SYNC_RESPONSE,
          payload: expect.objectContaining({
            gameState: JSON.stringify(hostGame.toJSON()),
            stateHash: hostGame.getCurrentState().generateHash(),
          }),
        })
      );
    });

    it('should handle sync responses', () => {
      const clientSyncSpy = jest.fn();
      clientNetwork.on('sync', clientSyncSpy);
      
      // Make moves on host only
      hostGame.placePiece(new Vector3(3, 3, 3));
      hostGame.placePiece(new Vector3(4, 4, 4));
      
      // Client requests sync
      clientNetwork.requestSync();
      
      // Get sync request and simulate host response
      const syncRequest = (clientConn.send as jest.Mock).mock.calls[0][0];
      hostConn._simulateData(syncRequest);
      
      // Get sync response from host
      const syncResponse = (hostConn.send as jest.Mock).mock.calls[0][0];
      
      // Client receives sync response
      clientConn._simulateData(syncResponse);
      
      expect(clientSyncSpy).toHaveBeenCalledWith({
        gameState: JSON.stringify(hostGame.toJSON()),
        stateHash: hostGame.getCurrentState().generateHash(),
      });
    });
  });

  describe('latency measurement', () => {
    let hostConn: MockDataConnection;
    let clientConn: MockDataConnection;

    beforeEach(async () => {
      // Establish connection
      const gameCode = await hostNetwork.hostGame();
      await clientNetwork.joinGame(gameCode);
      
      hostPeer = (hostNetwork as any).peer as MockPeer;
      clientPeer = (clientNetwork as any).peer as MockPeer;
      
      hostConn = hostPeer._simulateIncomingConnection(clientPeer.id);
      hostConn._simulateOpen();
      
      clientConn = clientPeer.connections.values().next().value;
      if (clientConn) {
        clientConn._simulateOpen();
      }
      
      jest.runAllTimers();
    });

    it('should measure latency through ping/pong', () => {
      const hostLatencySpy = jest.fn();
      hostNetwork.on('latency', hostLatencySpy);
      
      // Clear previous calls
      (hostConn.send as jest.Mock).mockClear();
      
      // Trigger ping from host
      jest.advanceTimersByTime(5000);
      
      // Get ping message
      const pingMessage = (hostConn.send as jest.Mock).mock.calls[0][0];
      expect(pingMessage.type).toBe(MessageType.PING);
      
      // Client receives ping and responds with pong
      clientConn._simulateData(pingMessage);
      
      // Get pong response
      const pongMessage = (clientConn.send as jest.Mock).mock.calls[
        (clientConn.send as jest.Mock).mock.calls.length - 1
      ][0];
      expect(pongMessage.type).toBe(MessageType.PONG);
      
      // Simulate 50ms delay
      jest.advanceTimersByTime(50);
      
      // Host receives pong
      hostConn._simulateData(pongMessage);
      
      expect(hostLatencySpy).toHaveBeenCalled();
      expect(hostNetwork.getLatency()).toBeGreaterThan(0);
    });

    it('should update latency in connection info', () => {
      // Clear previous calls
      (hostConn.send as jest.Mock).mockClear();
      
      // Trigger ping
      jest.advanceTimersByTime(5000);
      
      const pingMessage = (hostConn.send as jest.Mock).mock.calls[0][0];
      clientConn._simulateData(pingMessage);
      
      const pongMessage = (clientConn.send as jest.Mock).mock.calls[
        (clientConn.send as jest.Mock).mock.calls.length - 1
      ][0];
      
      jest.advanceTimersByTime(30);
      hostConn._simulateData(pongMessage);
      
      const info = hostNetwork.getConnectionInfo();
      expect(info.latency).toBeGreaterThan(0);
      expect(info.latency).toBe(hostNetwork.getLatency());
    });
  });

  describe('reconnection scenarios', () => {
    let hostConn: MockDataConnection;

    beforeEach(async () => {
      // Establish connection
      const gameCode = await hostNetwork.hostGame();
      await clientNetwork.joinGame(gameCode);
      
      hostPeer = (hostNetwork as any).peer as MockPeer;
      clientPeer = (clientNetwork as any).peer as MockPeer;
      
      hostConn = hostPeer._simulateIncomingConnection(clientPeer.id);
      hostConn._simulateOpen();
      
      jest.runAllTimers();
    });

    it('should handle temporary disconnection', () => {
      const hostReconnectingSpy = jest.fn();
      hostNetwork.on('reconnecting', hostReconnectingSpy);
      
      // Simulate disconnection
      hostPeer.disconnect();
      
      expect(hostNetwork.getStatus()).toBe(ConnectionStatus.CONNECTING);
      
      // Wait for reconnection attempt
      jest.advanceTimersByTime(1000);
      
      expect(hostReconnectingSpy).toHaveBeenCalledWith({ attempt: 1 });
      
      // Simulate successful reconnection
      hostPeer.reconnect();
      const newConn = hostPeer._simulateIncomingConnection(clientPeer.id);
      newConn._simulateOpen();
      
      expect(hostNetwork.getStatus()).toBe(ConnectionStatus.CONNECTED);
    });

    it('should queue messages during disconnection', () => {
      // Disconnect
      hostConn.close();
      (hostNetwork as any).connection = null;
      
      // Try to send move while disconnected
      const move = new Move(
        new Vector3(3, 3, 3),
        hostGame.getCurrentPlayer(),
        Date.now()
      );
      
      hostNetwork.sendMove(move);
      
      // Message should be queued
      expect((hostNetwork as any).pendingMessages.length).toBe(1);
      
      // Reconnect
      const newConn = hostPeer._simulateIncomingConnection(clientPeer.id);
      newConn._simulateOpen();
      
      // Message should be sent
      expect((newConn.send as jest.Mock).mock.calls.length).toBeGreaterThan(0);
      expect((hostNetwork as any).pendingMessages.length).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle connection rejection', async () => {
      // Host creates game
      const gameCode = await hostNetwork.hostGame();
      hostPeer = (hostNetwork as any).peer as MockPeer;
      
      // First client connects
      await clientNetwork.joinGame(gameCode);
      const firstConn = hostPeer._simulateIncomingConnection('client1');
      firstConn._simulateOpen();
      
      // Second client tries to connect
      const secondNetwork = new NetworkManager(
        new Game({
          boardSize: 7,
        })
      );
      
      await secondNetwork.joinGame(gameCode);
      const secondConn = hostPeer._simulateIncomingConnection('client2');
      
      // Connection should be rejected
      const closeSpy = jest.spyOn(secondConn, 'close');
      (hostNetwork as any).handleIncomingConnection(secondConn);
      
      expect(closeSpy).toHaveBeenCalled();
      
      secondNetwork.dispose();
    });

    it('should handle malformed messages gracefully', async () => {
      // Establish connection
      const gameCode = await hostNetwork.hostGame();
      hostPeer = (hostNetwork as any).peer as MockPeer;
      const conn = hostPeer._simulateIncomingConnection('client');
      conn._simulateOpen();
      
      // Send malformed message
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      conn._simulateData({
        type: 'unknown_type',
        payload: {},
        timestamp: Date.now(),
        sequence: 1,
      });
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Unknown message type:',
        'unknown_type'
      );
      
      consoleWarnSpy.mockRestore();
    });
  });

  describe('performance', () => {
    it('should handle rapid message sending', async () => {
      // Establish connection
      const gameCode = await hostNetwork.hostGame();
      await clientNetwork.joinGame(gameCode);
      
      hostPeer = (hostNetwork as any).peer as MockPeer;
      const hostConn = hostPeer._simulateIncomingConnection(clientPeer.id);
      hostConn._simulateOpen();
      
      jest.runAllTimers();
      
      // Send many messages rapidly
      const sendCount = 100;
      const startTime = Date.now();
      
      for (let i = 0; i < sendCount; i++) {
        const move = new Move(
          new Vector3(i % 7, Math.floor(i / 7) % 7, 0),
          hostGame.getCurrentPlayer(),
          Date.now()
        );
        hostNetwork.sendMove(move);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete quickly (< 100ms for 100 messages)
      expect(duration).toBeLessThan(100);
      
      // All messages should be sent
      expect((hostConn.send as jest.Mock).mock.calls.length).toBe(sendCount);
    });

    it('should maintain reasonable memory usage', async () => {
      // This is a placeholder for memory testing
      // In a real environment, you would use memory profiling tools
      
      // Establish connection
      const gameCode = await hostNetwork.hostGame();
      await clientNetwork.joinGame(gameCode);
      
      hostPeer = (hostNetwork as any).peer as MockPeer;
      const hostConn = hostPeer._simulateIncomingConnection(clientPeer.id);
      hostConn._simulateOpen();
      
      // Make many moves
      for (let i = 0; i < 50; i++) {
        const move = new Move(
          new Vector3(i % 7, Math.floor(i / 7) % 7, 0),
          hostGame.getCurrentPlayer(),
          Date.now()
        );
        
        if (hostGame.placePiece(move.position)) {
          hostNetwork.sendMove(move);
        }
      }
      
      // Verify no memory leaks in pending messages
      expect((hostNetwork as any).pendingMessages.length).toBe(0);
      
      // Verify sequence number doesn't overflow
      expect((hostNetwork as any).messageSequence).toBeLessThan(Number.MAX_SAFE_INTEGER);
    });
  });
});