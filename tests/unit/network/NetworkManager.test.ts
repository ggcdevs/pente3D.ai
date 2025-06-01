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

    it('should send move message with turn validation', () => {
      const player = game.getCurrentState().getCurrentPlayer();
      const move = new Move(
        new Vector3(3, 3, 3),
        player,
        [],
        Date.now()
      );
      
      const connection = (networkManager as any).connection as MockDataConnection;
      const sendSpy = jest.spyOn(connection, 'send');
      
      const result = networkManager.sendMove(move);
      
      expect(result).toBe(true);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.MOVE,
          payload: expect.objectContaining({
            move: move,
            stateHash: game.getCurrentState().generateHash(),
            expectedTurn: player.getColor(),
          }),
          timestamp: expect.any(Number),
          sequence: expect.any(Number),
        })
      );
    });

    it('should reject move when not player turn', () => {
      // Join as white player (not first turn)
      networkManager.dispose();
      networkManager = new NetworkManager(game);
      
      // Make a move as black first
      game.placePiece(new Vector3(3, 3, 3));
      
      // Now it's white's turn, but try to send as black
      const errorSpy = jest.fn();
      networkManager.on('error', errorSpy);
      
      const blackPlayer = game.getCurrentState().getBlackPlayer();
      const move = new Move(
        new Vector3(4, 4, 4),
        blackPlayer,
        [],
        Date.now()
      );
      
      // Force local player color to black when it's white's turn
      (networkManager as any).networkGameState.localPlayerColor = 'black';
      (networkManager as any).networkGameState.isNetworked = true;
      
      const result = networkManager.sendMove(move);
      
      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Not your turn',
      }));
    });

    it('should store pending moves and set acknowledgment timeout', () => {
      const player = game.getCurrentState().getCurrentPlayer();
      const move = new Move(
        new Vector3(3, 3, 3),
        player,
        [],
        Date.now()
      );
      
      networkManager.sendMove(move);
      
      const pendingMoves = (networkManager as any).networkGameState.pendingMoves;
      expect(pendingMoves.size).toBe(1);
      
      const pendingMove = pendingMoves.get(1);
      expect(pendingMove).toBeDefined();
      expect(pendingMove.acknowledged).toBe(false);
      expect(pendingMove.message.payload.move).toEqual(move);
      
      // Timeout should be set
      expect((networkManager as any).moveAckTimeout).not.toBeNull();
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
        [],
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

    it('should handle move message with validation and acknowledgment', () => {
      const moveSpy = jest.fn();
      networkManager.on('move', moveSpy);
      
      const sendSpy = jest.spyOn(connection, 'send');
      const currentPlayer = game.getCurrentState().getCurrentPlayer();
      
      const moveMessage = {
        type: MessageType.MOVE,
        payload: {
          move: new Move(
            new Vector3(3, 3, 3),
            currentPlayer,
            [],
            Date.now()
          ),
          stateHash: game.getCurrentState().generateHash(),
          expectedTurn: currentPlayer.getColor(),
        },
        timestamp: Date.now(),
        sequence: 1,
      };
      
      connection._simulateData(moveMessage);
      
      // Should send acknowledgment
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.MOVE_ACK,
          payload: expect.objectContaining({
            moveSequence: 1,
            stateHash: game.getCurrentState().generateHash(),
          }),
        })
      );
      
      // Should emit move event
      expect(moveSpy).toHaveBeenCalledWith(moveMessage.payload);
    });

    it('should reject move with wrong turn', () => {
      const sendSpy = jest.spyOn(connection, 'send');
      const currentPlayer = game.getCurrentState().getCurrentPlayer();
      const wrongPlayer = currentPlayer.getColor() === 'black' ? 
        game.getCurrentState().getWhitePlayer() : 
        game.getCurrentState().getBlackPlayer();
      
      const moveMessage = {
        type: MessageType.MOVE,
        payload: {
          move: new Move(
            new Vector3(3, 3, 3),
            wrongPlayer,
            [],
            Date.now()
          ),
          stateHash: game.getCurrentState().generateHash(),
          expectedTurn: wrongPlayer.getColor(), // Wrong turn
        },
        timestamp: Date.now(),
        sequence: 1,
      };
      
      connection._simulateData(moveMessage);
      
      // Should send rejection
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.MOVE_REJECT,
          payload: expect.objectContaining({
            moveSequence: 1,
            reason: 'Turn mismatch',
            correctStateHash: game.getCurrentState().generateHash(),
          }),
        })
      );
    });

    it('should handle move acknowledgment', () => {
      const ackSpy = jest.fn();
      networkManager.on('moveAcknowledged', ackSpy);
      
      // Send a move first
      const move = new Move(
        new Vector3(3, 3, 3),
        game.getCurrentState().getCurrentPlayer(),
        [],
        Date.now()
      );
      networkManager.sendMove(move);
      
      // Simulate acknowledgment
      const ackMessage = {
        type: MessageType.MOVE_ACK,
        payload: {
          moveSequence: 1,
          stateHash: 'hash123',
        },
        timestamp: Date.now(),
        sequence: 2,
      };
      
      connection._simulateData(ackMessage);
      
      // Should clear pending move
      const pendingMoves = (networkManager as any).networkGameState.pendingMoves;
      expect(pendingMoves.size).toBe(0);
      
      // Should emit acknowledgment event
      expect(ackSpy).toHaveBeenCalledWith({ sequence: 1 });
    });

    it('should handle move rejection', () => {
      const rejectSpy = jest.fn();
      const syncSpy = jest.spyOn(networkManager, 'requestSync');
      networkManager.on('moveRejected', rejectSpy);
      
      // Send a move first
      const move = new Move(
        new Vector3(3, 3, 3),
        game.getCurrentState().getCurrentPlayer(),
        [],
        Date.now()
      );
      networkManager.sendMove(move);
      
      // Simulate rejection
      const rejectMessage = {
        type: MessageType.MOVE_REJECT,
        payload: {
          moveSequence: 1,
          reason: 'Invalid move',
          correctStateHash: 'hash123',
        },
        timestamp: Date.now(),
        sequence: 2,
      };
      
      connection._simulateData(rejectMessage);
      
      // Should clear pending move
      const pendingMoves = (networkManager as any).networkGameState.pendingMoves;
      expect(pendingMoves.size).toBe(0);
      
      // Should emit rejection event
      expect(rejectSpy).toHaveBeenCalledWith({
        sequence: 1,
        reason: 'Invalid move',
      });
      
      // Should request sync
      expect(syncSpy).toHaveBeenCalled();
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

    it('should handle player disconnected message', () => {
      const disconnectSpy = jest.fn();
      networkManager.on('playerDisconnected', disconnectSpy);
      
      const disconnectMessage = {
        type: MessageType.PLAYER_DISCONNECTED,
        payload: {
          playerId: 'remote-peer',
        },
        timestamp: Date.now(),
        sequence: 8,
      };
      
      connection._simulateData(disconnectMessage);
      
      expect(disconnectSpy).toHaveBeenCalledWith({ playerId: 'remote-peer' });
      expect(networkManager.getConnectionInfo().opponentConnected).toBe(false);
    });

    it('should handle player reconnected message', () => {
      const reconnectSpy = jest.fn();
      const syncSpy = jest.spyOn(networkManager, 'requestSync');
      networkManager.on('playerReconnected', reconnectSpy);
      
      const reconnectMessage = {
        type: MessageType.PLAYER_RECONNECTED,
        payload: {
          playerId: 'remote-peer',
        },
        timestamp: Date.now(),
        sequence: 9,
      };
      
      connection._simulateData(reconnectMessage);
      
      expect(reconnectSpy).toHaveBeenCalledWith({ playerId: 'remote-peer' });
      expect(networkManager.getConnectionInfo().opponentConnected).toBe(true);
      expect(syncSpy).toHaveBeenCalled();
    });
  });

  describe('move synchronization', () => {
    let connection: MockDataConnection;

    beforeEach(async () => {
      await networkManager.hostGame();
      mockPeer = (networkManager as any).peer as MockPeer;
      connection = mockPeer._simulateIncomingConnection('remote-peer');
      connection._simulateOpen();
    });

    it('should timeout unacknowledged moves', () => {
      const timeoutSpy = jest.fn();
      const syncSpy = jest.spyOn(networkManager, 'requestSync');
      networkManager.on('moveTimeout', timeoutSpy);
      
      // Send a move
      const move = new Move(
        new Vector3(3, 3, 3),
        game.getCurrentState().getCurrentPlayer(),
        [],
        Date.now()
      );
      networkManager.sendMove(move);
      
      // Advance timer to trigger timeout (5000ms by default)
      jest.advanceTimersByTime(5000);
      
      expect(timeoutSpy).toHaveBeenCalledWith({ sequence: 1 });
      expect(syncSpy).toHaveBeenCalled();
      
      // Move should be queued for retry
      expect((networkManager as any).queuedMoves.length).toBe(1);
    });

    it('should clear timeout on acknowledgment', () => {
      const timeoutSpy = jest.fn();
      networkManager.on('moveTimeout', timeoutSpy);
      
      // Send a move
      const move = new Move(
        new Vector3(3, 3, 3),
        game.getCurrentState().getCurrentPlayer(),
        [],
        Date.now()
      );
      networkManager.sendMove(move);
      
      // Send acknowledgment before timeout
      connection._simulateData({
        type: MessageType.MOVE_ACK,
        payload: {
          moveSequence: 1,
          stateHash: 'hash123',
        },
        timestamp: Date.now(),
        sequence: 2,
      });
      
      // Advance timer past timeout
      jest.advanceTimersByTime(5000);
      
      // Timeout should not have fired
      expect(timeoutSpy).not.toHaveBeenCalled();
    });

    it('should process queued moves when turn is available', () => {
      // Queue a move
      const move = new Move(
        new Vector3(3, 3, 3),
        game.getCurrentState().getCurrentPlayer(),
        [],
        Date.now()
      );
      (networkManager as any).queuedMoves.push(move);
      
      const sendSpy = jest.spyOn(connection, 'send');
      
      // Process queued moves
      (networkManager as any).processQueuedMoves();
      
      // Should send the queued move
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.MOVE,
          payload: expect.objectContaining({
            move: move,
          }),
        })
      );
      
      expect((networkManager as any).queuedMoves.length).toBe(0);
    });

    it('should validate state hash on move reception', () => {
      const syncSpy = jest.spyOn(networkManager, 'requestSync');
      
      // Make a move to change state
      game.placePiece(new Vector3(3, 3, 3));
      
      // Receive move with wrong state hash
      const moveMessage = {
        type: MessageType.MOVE,
        payload: {
          move: new Move(
            new Vector3(4, 4, 4),
            game.getCurrentState().getCurrentPlayer(),
            [],
            Date.now()
          ),
          stateHash: 'wrong-hash',
          expectedTurn: game.getCurrentState().getCurrentPlayer().getColor(),
        },
        timestamp: Date.now(),
        sequence: 1,
      };
      
      connection._simulateData(moveMessage);
      
      // Should request sync instead of processing move
      expect(syncSpy).toHaveBeenCalled();
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
        playerColor: 'black',
        opponentConnected: false,
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
        [],
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
        [],
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

  describe('network game state', () => {
    it('should track local player color for host', async () => {
      await networkManager.hostGame();
      
      expect(networkManager.getLocalPlayerColor()).toBe('black');
      expect(networkManager.isNetworked()).toBe(true);
    });

    it('should track local player color for client', async () => {
      await networkManager.joinGame('ABC123');
      
      expect(networkManager.getLocalPlayerColor()).toBe('white');
      expect(networkManager.isNetworked()).toBe(true);
    });

    it('should determine if it is local player turn', async () => {
      await networkManager.hostGame();
      
      // Black plays first, so host should have turn
      expect(networkManager.isLocalPlayerTurn()).toBe(true);
      
      // Make a move
      game.placePiece(new Vector3(3, 3, 3));
      
      // Now it's white's turn, so host should not have turn
      expect(networkManager.isLocalPlayerTurn()).toBe(false);
    });

    it('should track opponent connection status', async () => {
      await networkManager.hostGame();
      mockPeer = (networkManager as any).peer as MockPeer;
      
      expect(networkManager.getConnectionInfo().opponentConnected).toBe(false);
      
      // Simulate connection
      const connection = mockPeer._simulateIncomingConnection('remote-peer');
      connection._simulateOpen();
      
      expect(networkManager.getConnectionInfo().opponentConnected).toBe(true);
    });
  });
});