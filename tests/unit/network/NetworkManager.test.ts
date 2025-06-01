import { NetworkManager, ConnectionStatus, MessageType } from '@/network';
import { Game, Move, Player, Vector3 } from '@/core';
import { MockPeer, MockDataConnection } from '../../../__mocks__/peerjs';

// Mock PeerJS
jest.mock('peerjs');

describe('NetworkManager', () => {
  let game: Game;
  let networkManager: NetworkManager;
  let mockPeer: MockPeer;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Create a new game for testing
    game = new Game({
      boardSize: 7,
    });

    // Create network manager
    networkManager = new NetworkManager(game, {
      reconnectTimeout: 1000,
      pingInterval: 5000,
    });
  });

  afterEach(() => {
    networkManager.dispose();
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      const nm = new NetworkManager(game);
      expect(nm.getStatus()).toBe(ConnectionStatus.DISCONNECTED);
      expect(nm.getConnectionInfo().peerId).toBe('');
      expect(nm.getConnectionInfo().gameCode).toBe('');
      expect(nm.getConnectionInfo().isHost).toBe(false);
      nm.dispose();
    });

    it('should accept custom configuration', () => {
      const nm = new NetworkManager(game, {
        host: 'custom.peerjs.com',
        port: 9000,
        secure: false,
      });
      expect(nm.getStatus()).toBe(ConnectionStatus.DISCONNECTED);
      nm.dispose();
    });
  });

  describe('hostGame', () => {
    it('should generate a game code and initialize as host', async () => {
      const gameCode = await networkManager.hostGame();
      await jest.runAllTimersAsync();
      
      expect(gameCode).toMatch(/^[A-Z0-9]{6}$/);
      expect(networkManager.getConnectionInfo().isHost).toBe(true);
      expect(networkManager.getConnectionInfo().gameCode).toBe(gameCode);
      expect(networkManager.getStatus()).toBe(ConnectionStatus.CONNECTED);
    });

    it('should emit statusChanged event when hosting', async () => {
      const statusChangedSpy = jest.fn();
      networkManager.on('statusChanged', statusChangedSpy);
      
      await networkManager.hostGame();
      
      expect(statusChangedSpy).toHaveBeenCalledWith({
        oldStatus: ConnectionStatus.DISCONNECTED,
        newStatus: ConnectionStatus.CONNECTING,
      });
      expect(statusChangedSpy).toHaveBeenCalledWith({
        oldStatus: ConnectionStatus.CONNECTING,
        newStatus: ConnectionStatus.CONNECTED,
      });
    });

    it('should start ping timer when hosting', async () => {
      await networkManager.hostGame();
      
      // Fast forward to trigger ping
      jest.advanceTimersByTime(5000);
      
      // Ping timer should be active
      expect(networkManager.getStatus()).toBe(ConnectionStatus.CONNECTED);
    });
  });

  describe('joinGame', () => {
    it('should connect to a host using game code', async () => {
      const gameCode = 'ABC123';
      await networkManager.joinGame(gameCode);
      
      expect(networkManager.getConnectionInfo().isHost).toBe(false);
      expect(networkManager.getConnectionInfo().gameCode).toBe(gameCode);
      
      // Wait for connection to establish
      jest.runAllTimers();
      expect(networkManager.getStatus()).toBe(ConnectionStatus.CONNECTED);
    });

    it('should emit connected event when joining', async () => {
      const connectedSpy = jest.fn();
      networkManager.on('connected', connectedSpy);
      
      await networkManager.joinGame('ABC123');
      jest.runAllTimers();
      
      expect(connectedSpy).toHaveBeenCalledWith({
        peerId: 'ABC123',
      });
    });
  });

  describe('message sending', () => {
    beforeEach(async () => {
      await networkManager.hostGame();
      
      // Get the mock peer instance
      mockPeer = (networkManager as any).peer as MockPeer;
      
      // Simulate an incoming connection
      const conn = mockPeer._simulateIncomingConnection('remote-peer');
      conn._simulateOpen();
    });

    it('should send move message', () => {
      const player = game.getCurrentState().getCurrentPlayer();
      const move = new Move(
        new Vector3(3, 3, 3),
        player,
        Date.now()
      );
      
      const connection = (networkManager as any).connection as MockDataConnection;
      const sendSpy = jest.spyOn(connection, 'send');
      
      networkManager.sendMove(move);
      
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.MOVE,
          payload: expect.objectContaining({
            move: move,
            stateHash: game.getCurrentState().generateHash(),
          }),
          timestamp: expect.any(Number),
          sequence: expect.any(Number),
        })
      );
    });

    it('should send undo message', () => {
      const connection = (networkManager as any).connection as MockDataConnection;
      const sendSpy = jest.spyOn(connection, 'send');
      
      networkManager.sendUndo();
      
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.UNDO,
          payload: expect.objectContaining({
            stateHash: game.getCurrentState().generateHash(),
          }),
        })
      );
    });

    it('should send redo message', () => {
      const connection = (networkManager as any).connection as MockDataConnection;
      const sendSpy = jest.spyOn(connection, 'send');
      
      networkManager.sendRedo();
      
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.REDO,
          payload: expect.objectContaining({
            stateHash: game.getCurrentState().generateHash(),
          }),
        })
      );
    });

    it('should send reset message', () => {
      const connection = (networkManager as any).connection as MockDataConnection;
      const sendSpy = jest.spyOn(connection, 'send');
      
      networkManager.sendReset();
      
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.RESET,
          payload: expect.objectContaining({
            stateHash: game.getCurrentState().generateHash(),
          }),
        })
      );
    });

    it('should queue messages when not connected', () => {
      // Disconnect
      const connection = (networkManager as any).connection as MockDataConnection;
      connection.close();
      (networkManager as any).connection = null;
      
      const player = game.getCurrentState().getCurrentPlayer();
      const move = new Move(
        new Vector3(3, 3, 3),
        player,
        Date.now()
      );
      
      // Should not throw
      expect(() => networkManager.sendMove(move)).not.toThrow();
      
      // Message should be queued
      expect((networkManager as any).pendingMessages.length).toBe(1);
    });
  });

  describe('message receiving', () => {
    let connection: MockDataConnection;

    beforeEach(async () => {
      await networkManager.hostGame();
      mockPeer = (networkManager as any).peer as MockPeer;
      connection = mockPeer._simulateIncomingConnection('remote-peer');
      connection._simulateOpen();
    });

    it('should handle move message', () => {
      const moveSpy = jest.fn();
      networkManager.on('move', moveSpy);
      
      const moveMessage = {
        type: MessageType.MOVE,
        payload: {
          move: new Move(
            new Vector3(3, 3, 3),
            game.getCurrentState().players[1],
            Date.now()
          ),
          stateHash: 'hash123',
        },
        timestamp: Date.now(),
        sequence: 1,
      };
      
      connection._simulateData(moveMessage);
      
      expect(moveSpy).toHaveBeenCalledWith(moveMessage.payload);
    });

    it('should handle undo message', () => {
      const undoSpy = jest.fn();
      networkManager.on('undo', undoSpy);
      
      const undoMessage = {
        type: MessageType.UNDO,
        payload: {
          stateHash: 'hash123',
        },
        timestamp: Date.now(),
        sequence: 2,
      };
      
      connection._simulateData(undoMessage);
      
      expect(undoSpy).toHaveBeenCalledWith(undoMessage.payload);
    });

    it('should handle sync request', () => {
      const connection = (networkManager as any).connection as MockDataConnection;
      const sendSpy = jest.spyOn(connection, 'send');
      
      const syncRequest = {
        type: MessageType.SYNC_REQUEST,
        payload: {
          lastKnownHash: 'hash123',
        },
        timestamp: Date.now(),
        sequence: 3,
      };
      
      connection._simulateData(syncRequest);
      
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.SYNC_RESPONSE,
          payload: expect.objectContaining({
            gameState: expect.any(String),
            stateHash: game.getCurrentState().generateHash(),
          }),
        })
      );
    });

    it('should handle sync response', () => {
      const syncSpy = jest.fn();
      networkManager.on('sync', syncSpy);
      
      const syncResponse = {
        type: MessageType.SYNC_RESPONSE,
        payload: {
          gameState: '{}',
          stateHash: 'hash123',
        },
        timestamp: Date.now(),
        sequence: 4,
      };
      
      connection._simulateData(syncResponse);
      
      expect(syncSpy).toHaveBeenCalledWith(syncResponse.payload);
    });

    it('should handle ping message', () => {
      const connection = (networkManager as any).connection as MockDataConnection;
      const sendSpy = jest.spyOn(connection, 'send');
      
      const pingMessage = {
        type: MessageType.PING,
        payload: {
          clientTime: Date.now(),
        },
        timestamp: Date.now(),
        sequence: 5,
      };
      
      connection._simulateData(pingMessage);
      
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.PONG,
          payload: expect.objectContaining({
            clientTime: pingMessage.payload.clientTime,
            serverTime: expect.any(Number),
          }),
        })
      );
    });

    it('should handle pong message and update latency', () => {
      const latencySpy = jest.fn();
      networkManager.on('latency', latencySpy);
      
      const clientTime = Date.now() - 50; // 50ms ago
      const pongMessage = {
        type: MessageType.PONG,
        payload: {
          clientTime: clientTime,
          serverTime: Date.now() - 25, // 25ms ago on server
        },
        timestamp: Date.now(),
        sequence: 6,
      };
      
      connection._simulateData(pongMessage);
      
      expect(latencySpy).toHaveBeenCalled();
      expect(networkManager.getLatency()).toBeGreaterThan(0);
    });

    it('should update last activity on any message', () => {
      const initialActivity = (networkManager as any).connectionInfo.lastActivity;
      
      // Wait a bit
      jest.advanceTimersByTime(100);
      
      connection._simulateData({
        type: MessageType.PING,
        payload: { clientTime: Date.now() },
        timestamp: Date.now(),
        sequence: 7,
      });
      
      expect((networkManager as any).connectionInfo.lastActivity).toBeGreaterThan(initialActivity);
    });
  });

  describe('reconnection', () => {
    beforeEach(async () => {
      await networkManager.hostGame();
      mockPeer = (networkManager as any).peer as MockPeer;
      const connection = mockPeer._simulateIncomingConnection('remote-peer');
      connection._simulateOpen();
    });

    it('should attempt reconnection on disconnect', () => {
      const reconnectingSpy = jest.fn();
      networkManager.on('reconnecting', reconnectingSpy);
      
      // Simulate disconnection
      mockPeer.disconnect();
      
      expect(networkManager.getStatus()).toBe(ConnectionStatus.CONNECTING);
      
      // Advance timer to trigger reconnection
      jest.advanceTimersByTime(1000);
      
      expect(reconnectingSpy).toHaveBeenCalledWith({ attempt: 1 });
    });

    it('should give up after max reconnection attempts', () => {
      const errorSpy = jest.fn();
      networkManager.on('error', errorSpy);
      
      // Set max attempts to 2 for testing
      (networkManager as any).config.maxReconnectAttempts = 2;
      
      // Simulate disconnection
      mockPeer.disconnect();
      
      // Attempt 1
      jest.advanceTimersByTime(1000);
      expect(networkManager.getStatus()).toBe(ConnectionStatus.CONNECTING);
      
      // Attempt 2
      mockPeer.disconnect();
      jest.advanceTimersByTime(1000);
      expect(networkManager.getStatus()).toBe(ConnectionStatus.CONNECTING);
      
      // Should give up
      mockPeer.disconnect();
      expect(networkManager.getStatus()).toBe(ConnectionStatus.ERROR);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Max reconnection attempts reached',
        })
      );
    });

    it('should reset reconnect attempts on successful connection', async () => {
      // Simulate disconnection
      mockPeer.disconnect();
      jest.advanceTimersByTime(1000);
      
      // Reconnect
      const connection = mockPeer._simulateIncomingConnection('remote-peer');
      connection._simulateOpen();
      
      expect((networkManager as any).reconnectAttempts).toBe(0);
      expect(networkManager.getStatus()).toBe(ConnectionStatus.CONNECTED);
    });
  });

  describe('connection info', () => {
    it('should return connection info', async () => {
      const gameCode = await networkManager.hostGame();
      
      const info = networkManager.getConnectionInfo();
      expect(info).toEqual({
        peerId: gameCode,
        gameCode: gameCode,
        isHost: true,
        status: ConnectionStatus.CONNECTED,
        lastActivity: expect.any(Number),
        latency: 0,
      });
    });

    it('should update latency from pong messages', async () => {
      await networkManager.hostGame();
      mockPeer = (networkManager as any).peer as MockPeer;
      const connection = mockPeer._simulateIncomingConnection('remote-peer');
      connection._simulateOpen();
      
      // Simulate pong
      const clientTime = Date.now() - 50;
      connection._simulateData({
        type: MessageType.PONG,
        payload: {
          clientTime: clientTime,
          serverTime: Date.now() - 25,
        },
        timestamp: Date.now(),
        sequence: 1,
      });
      
      expect(networkManager.getLatency()).toBeGreaterThan(0);
      expect(networkManager.getConnectionInfo().latency).toBe(networkManager.getLatency());
    });
  });

  describe('disconnect and cleanup', () => {
    beforeEach(async () => {
      await networkManager.hostGame();
      mockPeer = (networkManager as any).peer as MockPeer;
    });

    it('should disconnect cleanly', () => {
      networkManager.disconnect();
      
      expect(networkManager.getStatus()).toBe(ConnectionStatus.DISCONNECTED);
      expect((networkManager as any).peer).toBeNull();
      expect((networkManager as any).connection).toBeNull();
    });

    it('should clean up timers on disconnect', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      
      networkManager.disconnect();
      
      expect(clearIntervalSpy).toHaveBeenCalled();
      expect((networkManager as any).pingTimer).toBeNull();
    });

    it('should clear pending messages on disconnect', async () => {
      // Queue a message
      (networkManager as any).connection = null;
      const player = game.getCurrentState().getCurrentPlayer();
      networkManager.sendMove(new Move(
        new Vector3(0, 0, 0),
        player,
        Date.now()
      ));
      
      expect((networkManager as any).pendingMessages.length).toBe(1);
      
      networkManager.disconnect();
      
      expect((networkManager as any).pendingMessages.length).toBe(0);
    });

    it('should remove all listeners on dispose', () => {
      const removeAllListenersSpy = jest.spyOn(networkManager, 'removeAllListeners');
      
      networkManager.dispose();
      
      expect(removeAllListenersSpy).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should emit error on peer error', async () => {
      const errorSpy = jest.fn();
      networkManager.on('error', errorSpy);
      
      await networkManager.hostGame();
      mockPeer = (networkManager as any).peer as MockPeer;
      
      const error = new Error('Peer error');
      mockPeer._simulateError(error);
      
      expect(errorSpy).toHaveBeenCalledWith(error);
      expect(networkManager.getStatus()).toBe(ConnectionStatus.ERROR);
    });

    it('should emit error on connection error', async () => {
      const errorSpy = jest.fn();
      networkManager.on('error', errorSpy);
      
      await networkManager.hostGame();
      mockPeer = (networkManager as any).peer as MockPeer;
      const connection = mockPeer._simulateIncomingConnection('remote-peer');
      connection._simulateOpen();
      
      const error = new Error('Connection error');
      connection._simulateError(error);
      
      expect(errorSpy).toHaveBeenCalledWith(error);
    });

    it('should handle send errors gracefully', async () => {
      const errorSpy = jest.fn();
      networkManager.on('error', errorSpy);
      
      await networkManager.hostGame();
      mockPeer = (networkManager as any).peer as MockPeer;
      const connection = mockPeer._simulateIncomingConnection('remote-peer');
      connection._simulateOpen();
      
      // Mock send to throw
      connection.send = jest.fn().mockImplementation(() => {
        throw new Error('Send failed');
      });
      
      const player = game.getCurrentState().getCurrentPlayer();
      networkManager.sendMove(new Move(
        new Vector3(0, 0, 0),
        player,
        Date.now()
      ));
      
      expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Send failed',
      }));
    });
  });

  describe('game code generation', () => {
    it('should generate unique game codes', async () => {
      const codes = new Set<string>();
      
      for (let i = 0; i < 10; i++) {
        const nm = new NetworkManager(game);
        const code = await nm.hostGame();
        codes.add(code);
        nm.dispose();
      }
      
      expect(codes.size).toBe(10);
    });

    it('should generate valid game codes', async () => {
      const code = await networkManager.hostGame();
      
      // Should be 6 characters
      expect(code).toHaveLength(6);
      
      // Should only contain valid characters (no ambiguous ones)
      expect(code).toMatch(/^[A-Z0-9]{6}$/);
      expect(code).not.toMatch(/[IO10]/); // No ambiguous characters
    });
  });

  describe('ping mechanism', () => {
    beforeEach(async () => {
      await networkManager.hostGame();
      mockPeer = (networkManager as any).peer as MockPeer;
      const connection = mockPeer._simulateIncomingConnection('remote-peer');
      connection._simulateOpen();
    });

    it('should send ping messages periodically', () => {
      const connection = (networkManager as any).connection as MockDataConnection;
      const sendSpy = jest.spyOn(connection, 'send');
      
      // Clear previous calls
      sendSpy.mockClear();
      
      // Advance timer to trigger ping
      jest.advanceTimersByTime(5000);
      
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.PING,
          payload: expect.objectContaining({
            clientTime: expect.any(Number),
          }),
        })
      );
    });

    it('should stop ping timer on disconnect', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      
      networkManager.disconnect();
      
      expect(clearIntervalSpy).toHaveBeenCalled();
      expect((networkManager as any).pingTimer).toBeNull();
    });
  });

  describe('message sequencing', () => {
    beforeEach(async () => {
      await networkManager.hostGame();
      mockPeer = (networkManager as any).peer as MockPeer;
      const connection = mockPeer._simulateIncomingConnection('remote-peer');
      connection._simulateOpen();
    });

    it('should increment sequence numbers', () => {
      const connection = (networkManager as any).connection as MockDataConnection;
      const sendSpy = jest.spyOn(connection, 'send');
      
      networkManager.sendUndo();
      networkManager.sendRedo();
      
      const calls = sendSpy.mock.calls;
      expect(calls[0][0].sequence).toBe(1);
      expect(calls[1][0].sequence).toBe(2);
    });

    it('should reset sequence on disconnect', () => {
      networkManager.sendUndo();
      
      networkManager.disconnect();
      
      expect((networkManager as any).messageSequence).toBe(0);
    });
  });
});