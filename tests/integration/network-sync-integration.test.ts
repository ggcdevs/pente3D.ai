import { NetworkManager, ConnectionStatus } from '@/network';
import { Game, Move, Vector3 } from '@/core';
import { MockPeer, MockDataConnection } from '../../__mocks__/peerjs';

// Mock PeerJS
jest.mock('peerjs');

describe('Network Move Synchronization Integration', () => {
  let hostGame: Game;
  let clientGame: Game;
  let hostNetwork: NetworkManager;
  let clientNetwork: NetworkManager;
  let hostPeer: MockPeer;
  let clientPeer: MockPeer;
  let hostToClientConn: MockDataConnection;
  let clientToHostConn: MockDataConnection;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Create games
    hostGame = new Game({ boardSize: 7 });
    clientGame = new Game({ boardSize: 7 });
    
    // Create network managers
    hostNetwork = new NetworkManager(hostGame, {
      reconnectTimeout: 1000,
      pingInterval: 5000,
      messageTimeout: 5000,
    });
    
    clientNetwork = new NetworkManager(clientGame, {
      reconnectTimeout: 1000,
      pingInterval: 5000,
      messageTimeout: 5000,
    });
  });

  afterEach(() => {
    hostNetwork.dispose();
    clientNetwork.dispose();
    jest.useRealTimers();
  });

  async function setupConnection() {
    // Host creates game
    const gameCode = await hostNetwork.hostGame();
    hostPeer = (hostNetwork as any).peer as MockPeer;
    
    // Client joins game
    await clientNetwork.joinGame(gameCode);
    clientPeer = (clientNetwork as any).peer as MockPeer;
    
    // Simulate connections
    hostToClientConn = hostPeer._simulateIncomingConnection(clientPeer.id);
    clientToHostConn = clientPeer._connections.get(gameCode) as MockDataConnection;
    
    // Cross-wire the connections
    hostToClientConn._peerConnection = clientToHostConn;
    clientToHostConn._peerConnection = hostToClientConn;
    
    // Open connections
    hostToClientConn._simulateOpen();
    clientToHostConn._simulateOpen();
    
    // Allow connections to stabilize
    jest.runAllTimers();
  }

  describe('basic move synchronization', () => {
    beforeEach(async () => {
      await setupConnection();
    });

    it('should synchronize moves between host and client', () => {
      // Host makes a move
      const hostMoveSpy = jest.fn();
      clientNetwork.on('move', (payload) => {
        hostMoveSpy(payload);
        // Apply move to client game
        clientGame.placePiece(payload.move.position);
      });
      
      const move = new Move(
        new Vector3(3, 3, 3),
        hostGame.getCurrentState().getCurrentPlayer(),
        [],
        Date.now()
      );
      
      hostNetwork.sendMove(move);
      hostGame.placePiece(move.position);
      
      // Process messages
      jest.runAllTimers();
      
      // Client should receive the move
      expect(hostMoveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          move: expect.objectContaining({
            position: move.position,
          }),
        })
      );
      
      // Both games should have the same state
      expect(clientGame.getCurrentState().generateHash()).toBe(
        hostGame.getCurrentState().generateHash()
      );
    });

    it('should handle acknowledgments correctly', () => {
      const ackSpy = jest.fn();
      hostNetwork.on('moveAcknowledged', ackSpy);
      
      const move = new Move(
        new Vector3(3, 3, 3),
        hostGame.getCurrentState().getCurrentPlayer(),
        [],
        Date.now()
      );
      
      hostNetwork.sendMove(move);
      
      // Process messages
      jest.runAllTimers();
      
      // Host should receive acknowledgment
      expect(ackSpy).toHaveBeenCalledWith({ sequence: 1 });
      
      // No pending moves should remain
      expect((hostNetwork as any).networkGameState.pendingMoves.size).toBe(0);
    });

    it('should enforce turn validation', () => {
      const rejectSpy = jest.fn();
      clientNetwork.on('moveRejected', rejectSpy);
      
      // It's black's turn (host), but client (white) tries to move
      const whitePlayer = clientGame.getCurrentState().getWhitePlayer();
      const move = new Move(
        new Vector3(3, 3, 3),
        whitePlayer,
        [],
        Date.now()
      );
      
      const result = clientNetwork.sendMove(move);
      
      // Should be rejected locally
      expect(result).toBe(false);
    });

    it('should handle alternating turns correctly', () => {
      const moveSpies = {
        host: jest.fn(),
        client: jest.fn(),
      };
      
      hostNetwork.on('move', moveSpies.host);
      clientNetwork.on('move', moveSpies.client);
      
      // Apply moves to games
      hostNetwork.on('move', (payload) => {
        hostGame.placePiece(payload.move.position);
      });
      clientNetwork.on('move', (payload) => {
        clientGame.placePiece(payload.move.position);
      });
      
      // Host (black) makes first move
      const blackMove = new Move(
        new Vector3(3, 3, 3),
        hostGame.getCurrentState().getCurrentPlayer(),
        [],
        Date.now()
      );
      hostNetwork.sendMove(blackMove);
      hostGame.placePiece(blackMove.position);
      
      jest.runAllTimers();
      
      // Client (white) makes second move
      const whiteMove = new Move(
        new Vector3(4, 4, 4),
        clientGame.getCurrentState().getCurrentPlayer(),
        [],
        Date.now()
      );
      clientNetwork.sendMove(whiteMove);
      clientGame.placePiece(whiteMove.position);
      
      jest.runAllTimers();
      
      // Both players should have received the moves
      expect(moveSpies.client).toHaveBeenCalledTimes(1);
      expect(moveSpies.host).toHaveBeenCalledTimes(1);
      
      // Games should be in sync
      expect(clientGame.getCurrentState().generateHash()).toBe(
        hostGame.getCurrentState().generateHash()
      );
      expect(clientGame.getMoveCount()).toBe(2);
      expect(hostGame.getMoveCount()).toBe(2);
    });
  });

  describe('connection disruption handling', () => {
    beforeEach(async () => {
      await setupConnection();
    });

    it('should queue moves during disconnection', () => {
      // Disconnect
      hostToClientConn.close();
      clientToHostConn.close();
      
      // Host tries to send move while disconnected
      const move = new Move(
        new Vector3(3, 3, 3),
        hostGame.getCurrentState().getCurrentPlayer(),
        [],
        Date.now()
      );
      
      hostNetwork.sendMove(move);
      
      // Move should be pending
      expect((hostNetwork as any).pendingMessages.length).toBe(1);
    });

    it('should handle move timeout and retry', () => {
      const timeoutSpy = jest.fn();
      const syncSpy = jest.spyOn(hostNetwork, 'requestSync');
      hostNetwork.on('moveTimeout', timeoutSpy);
      
      // Temporarily block client from responding
      const originalSimulateData = clientToHostConn._simulateData;
      clientToHostConn._simulateData = jest.fn();
      
      // Send move
      const move = new Move(
        new Vector3(3, 3, 3),
        hostGame.getCurrentState().getCurrentPlayer(),
        [],
        Date.now()
      );
      hostNetwork.sendMove(move);
      
      // Advance time to trigger timeout
      jest.advanceTimersByTime(5000);
      
      expect(timeoutSpy).toHaveBeenCalled();
      expect(syncSpy).toHaveBeenCalled();
      expect((hostNetwork as any).queuedMoves.length).toBe(1);
      
      // Restore connection
      clientToHostConn._simulateData = originalSimulateData;
    });

    it('should resync after reconnection', () => {
      const syncRequestSpy = jest.fn();
      const reconnectSpy = jest.fn();
      
      clientNetwork.on('sync', syncRequestSpy);
      hostNetwork.on('playerReconnected', reconnectSpy);
      
      // Make some moves
      hostGame.placePiece(new Vector3(3, 3, 3));
      clientGame.placePiece(new Vector3(3, 3, 3));
      
      // Simulate disconnection and reconnection
      hostToClientConn.close();
      clientToHostConn.close();
      
      // Reconnect
      hostToClientConn._simulateOpen();
      clientToHostConn._simulateOpen();
      
      // Simulate reconnection message
      hostToClientConn._simulateData({
        type: 'player_reconnected',
        payload: { playerId: clientPeer.id },
        timestamp: Date.now(),
        sequence: 1,
      });
      
      jest.runAllTimers();
      
      expect(reconnectSpy).toHaveBeenCalled();
      
      // Should trigger sync request
      expect((hostNetwork as any).connection.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sync_request',
        })
      );
    });
  });

  describe('state synchronization', () => {
    beforeEach(async () => {
      await setupConnection();
    });

    it('should detect state mismatch and request sync', () => {
      const syncSpy = jest.spyOn(clientNetwork, 'requestSync');
      
      // Artificially create state mismatch
      hostGame.placePiece(new Vector3(3, 3, 3));
      hostGame.placePiece(new Vector3(4, 4, 4));
      
      // Client only knows about first move
      clientGame.placePiece(new Vector3(3, 3, 3));
      
      // Host sends third move
      const move = new Move(
        new Vector3(5, 5, 5),
        hostGame.getCurrentState().getCurrentPlayer(),
        [],
        Date.now()
      );
      
      // Send with wrong state hash from client perspective
      const message = {
        type: 'move',
        payload: {
          move: move,
          stateHash: hostGame.getCurrentState().generateHash(),
          expectedTurn: 'black',
        },
        timestamp: Date.now(),
        sequence: 3,
      };
      
      clientToHostConn._peerConnection?._simulateData(message);
      
      // Client should request sync
      expect(syncSpy).toHaveBeenCalled();
    });

    it('should handle sync response correctly', () => {
      const syncSpy = jest.fn();
      clientNetwork.on('sync', syncSpy);
      
      // Host has more moves
      hostGame.placePiece(new Vector3(3, 3, 3));
      hostGame.placePiece(new Vector3(4, 4, 4));
      
      // Client requests sync
      clientNetwork.requestSync();
      
      jest.runAllTimers();
      
      // Client should receive game state
      expect(syncSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          gameState: expect.any(String),
          stateHash: hostGame.getCurrentState().generateHash(),
        })
      );
    });
  });

  describe('performance and stress testing', () => {
    beforeEach(async () => {
      await setupConnection();
    });

    it('should handle rapid move sequences', () => {
      const moves = [
        new Vector3(3, 3, 3),
        new Vector3(4, 4, 4),
        new Vector3(5, 5, 5),
        new Vector3(3, 4, 3),
        new Vector3(3, 5, 3),
      ];
      
      // Apply moves alternating between players
      moves.forEach((position, index) => {
        const isHostTurn = index % 2 === 0;
        const network = isHostTurn ? hostNetwork : clientNetwork;
        const game = isHostTurn ? hostGame : clientGame;
        
        const move = new Move(
          position,
          game.getCurrentState().getCurrentPlayer(),
          [],
          Date.now()
        );
        
        network.sendMove(move);
        game.placePiece(position);
        
        // Apply to other game
        const otherGame = isHostTurn ? clientGame : hostGame;
        network.on('move', (payload) => {
          otherGame.placePiece(payload.move.position);
        });
        
        jest.runAllTimers();
      });
      
      // Games should remain in sync
      expect(clientGame.getCurrentState().generateHash()).toBe(
        hostGame.getCurrentState().generateHash()
      );
      expect(clientGame.getMoveCount()).toBe(5);
    });

    it('should maintain low latency measurements', () => {
      let latencyMeasurements: number[] = [];
      
      hostNetwork.on('latency', (latency) => {
        latencyMeasurements.push(latency);
      });
      
      // Simulate multiple ping-pong cycles
      for (let i = 0; i < 10; i++) {
        jest.advanceTimersByTime(5000); // Trigger ping
        jest.runAllTimers(); // Process pong
      }
      
      expect(latencyMeasurements.length).toBeGreaterThan(0);
      
      // In mock environment, latency should be very low
      const avgLatency = latencyMeasurements.reduce((a, b) => a + b, 0) / latencyMeasurements.length;
      expect(avgLatency).toBeLessThan(100); // Mock should be fast
    });
  });

  describe('edge cases', () => {
    beforeEach(async () => {
      await setupConnection();
    });

    it('should handle simultaneous moves gracefully', () => {
      // Both players try to move at the same time
      const hostMove = new Move(
        new Vector3(3, 3, 3),
        hostGame.getCurrentState().getCurrentPlayer(),
        [],
        Date.now()
      );
      
      const clientMove = new Move(
        new Vector3(4, 4, 4),
        clientGame.getCurrentState().getWhitePlayer(),
        [],
        Date.now()
      );
      
      // Send both moves
      hostNetwork.sendMove(hostMove);
      clientNetwork.sendMove(clientMove);
      
      jest.runAllTimers();
      
      // Only the valid move (host/black) should be accepted
      expect(hostGame.getMoveCount()).toBe(1);
      expect(clientGame.getMoveCount()).toBe(1);
    });

    it('should handle game ending conditions', () => {
      const gameOverSpy = jest.fn();
      clientNetwork.on('move', (payload) => {
        clientGame.placePiece(payload.move.position);
      });
      
      clientGame.on('gameOver', gameOverSpy);
      
      // Create a winning position for black
      const winningMoves = [
        new Vector3(3, 3, 3), // black
        new Vector3(4, 4, 4), // white
        new Vector3(3, 3, 4), // black
        new Vector3(4, 4, 3), // white
        new Vector3(3, 3, 5), // black
        new Vector3(4, 3, 3), // white
        new Vector3(3, 3, 2), // black
        new Vector3(5, 5, 5), // white
        new Vector3(3, 3, 1), // black - wins!
      ];
      
      winningMoves.forEach((position, index) => {
        const isHostTurn = index % 2 === 0;
        const network = isHostTurn ? hostNetwork : clientNetwork;
        const game = isHostTurn ? hostGame : clientGame;
        
        if (isHostTurn) {
          clientNetwork.on('move', (payload) => {
            clientGame.placePiece(payload.move.position);
          });
        } else {
          hostNetwork.on('move', (payload) => {
            hostGame.placePiece(payload.move.position);
          });
        }
        
        const move = new Move(
          position,
          game.getCurrentState().getCurrentPlayer(),
          [],
          Date.now()
        );
        
        network.sendMove(move);
        game.placePiece(position);
        
        jest.runAllTimers();
      });
      
      // Both games should recognize the win
      expect(hostGame.isGameOver()).toBe(true);
      expect(clientGame.isGameOver()).toBe(true);
      expect(hostGame.getWinner()).toBe('black');
      expect(clientGame.getWinner()).toBe('black');
    });
  });
});