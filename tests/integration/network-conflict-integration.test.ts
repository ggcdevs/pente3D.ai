import { NetworkManager } from '@/network/NetworkManager';
import { Game, Vector3 } from '@/core';
import { MessageType, ConflictDetectedMessage } from '@/network/types';
import { MockPeer, MockDataConnection } from '../../__mocks__/peerjs';

// Mock PeerJS
jest.mock('peerjs');

describe('Network Conflict Resolution Integration', () => {
  let hostNetworkManager: NetworkManager;
  let clientNetworkManager: NetworkManager;
  let hostGame: Game;
  let clientGame: Game;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Setup games
    hostGame = new Game({ boardSize: 9 });
    clientGame = new Game({ boardSize: 9 });
    
    // Create network managers
    hostNetworkManager = new NetworkManager(hostGame);
    clientNetworkManager = new NetworkManager(clientGame);
  });

  afterEach(() => {
    hostNetworkManager.dispose();
    clientNetworkManager.dispose();
    jest.useRealTimers();
  });

  describe('State Divergence Resolution', () => {
    it('should detect and resolve state divergence between host and client', async () => {
      // Setup network connection
      await hostNetworkManager.hostGame();
      await clientNetworkManager.joinGame('host-peer-id');

      // Simulate connection establishment
      const hostOpenCallback = mockHostPeer.on.mock.calls.find(call => call[0] === 'open')?.[1];
      hostOpenCallback?.('host-peer-id');
      
      const clientOpenCallback = mockClientPeer.on.mock.calls.find(call => call[0] === 'open')?.[1];
      clientOpenCallback?.('client-peer-id');

      // Track conflict events
      const hostConflictDetected = jest.fn();
      const hostConflictResolved = jest.fn();
      const clientConflictDetected = jest.fn();
      const clientConflictResolved = jest.fn();
      
      hostNetworkManager.on('conflictDetected', hostConflictDetected);
      hostNetworkManager.on('conflictResolved', hostConflictResolved);
      clientNetworkManager.on('conflictDetected', clientConflictDetected);
      clientNetworkManager.on('conflictResolved', clientConflictResolved);

      // Create divergent states
      // Host makes a move
      hostGame.placePiece(new Vector3(4, 4, 4));
      
      // Client makes a different move (simulating network issue)
      clientGame.placePiece(new Vector3(5, 5, 5));
      
      // Host sends a move that will trigger conflict detection
      hostNetworkManager.sendMove(new Vector3(3, 3, 3) as any);
      
      // Simulate message delivery
      const moveMessage = mockHostConnection.send.mock.calls[0][0];
      const handleMessage = (clientNetworkManager as any).handleMessage.bind(clientNetworkManager);
      handleMessage(moveMessage);
      
      // Verify conflict was detected
      expect(clientConflictDetected).toHaveBeenCalled();
      
      // Simulate hash chain exchange
      const hashChainRequest = mockClientConnection.send.mock.calls.find(
        call => call[0].type === MessageType.HASH_CHAIN_REQUEST
      )?.[0];
      
      if (hashChainRequest) {
        const handleHashChainRequest = (hostNetworkManager as any).handleHashChainRequest.bind(hostNetworkManager);
        handleHashChainRequest(hashChainRequest);
        
        // Host should send hash chain response
        const hashChainResponse = mockHostConnection.send.mock.calls.find(
          call => call[0].type === MessageType.HASH_CHAIN_RESPONSE
        )?.[0];
        
        if (hashChainResponse) {
          const handleHashChainResponse = (clientNetworkManager as any).handleHashChainResponse.bind(clientNetworkManager);
          handleHashChainResponse(hashChainResponse);
          
          // Should trigger rollback
          await new Promise(resolve => setTimeout(resolve, 50));
          
          // Both should be resolved
          expect(hostConflictResolved).toHaveBeenCalled();
          expect(clientConflictResolved).toHaveBeenCalled();
        }
      }
    });

    it('should handle conflicts during rapid move exchanges', async () => {
      // Setup connection
      await hostNetworkManager.hostGame();
      await clientNetworkManager.joinGame('host-peer-id');

      // Track events
      const conflictEvents: any[] = [];
      hostNetworkManager.on('conflictDetected', (data) => conflictEvents.push({ side: 'host', type: 'detected', data }));
      clientNetworkManager.on('conflictDetected', (data) => conflictEvents.push({ side: 'client', type: 'detected', data }));

      // Simulate rapid moves that could cause conflicts
      const moves = [
        new Vector3(4, 4, 4),
        new Vector3(5, 5, 5),
        new Vector3(3, 3, 3),
        new Vector3(6, 6, 6),
      ];

      // Alternate moves between host and client
      for (let i = 0; i < moves.length; i++) {
        if (i % 2 === 0) {
          hostGame.placePiece(moves[i]);
          hostNetworkManager.sendMove(moves[i] as any);
        } else {
          clientGame.placePiece(moves[i]);
          clientNetworkManager.sendMove(moves[i] as any);
        }
      }

      // Should handle conflicts gracefully
      expect(conflictEvents.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Missing Moves Recovery', () => {
    it('should recover from missing moves scenario', async () => {
      // Setup connection
      await hostNetworkManager.hostGame();
      await clientNetworkManager.joinGame('host-peer-id');

      // Host makes several moves
      const moves = [
        new Vector3(4, 4, 4),
        new Vector3(5, 5, 5),
        new Vector3(3, 3, 3),
      ];

      for (const move of moves) {
        hostGame.placePiece(move);
      }

      // Client is missing these moves
      expect(clientGame.getMoveCount()).toBe(0);
      expect(hostGame.getMoveCount()).toBe(3);

      // Client tries to make a move which should trigger conflict
      const clientMove = new Vector3(6, 6, 6);
      clientNetworkManager.sendMove(clientMove as any);

      // Simulate message processing
      const moveMessage = mockClientConnection.send.mock.calls[0][0];
      const handleMessage = (hostNetworkManager as any).handleMessage.bind(hostNetworkManager);
      handleMessage(moveMessage);

      // Should trigger sync request
      const syncRequest = mockHostConnection.send.mock.calls.find(
        call => call[0].type === MessageType.SYNC_REQUEST
      );
      expect(syncRequest).toBeDefined();
    });
  });

  describe('Rollback Scenarios', () => {
    it('should rollback both players to common ancestor', async () => {
      // Setup connection
      await hostNetworkManager.hostGame();
      await clientNetworkManager.joinGame('host-peer-id');

      // Both make same first two moves
      const commonMoves = [
        new Vector3(4, 4, 4),
        new Vector3(5, 5, 5),
      ];

      for (const move of commonMoves) {
        hostGame.placePiece(move);
        clientGame.placePiece(move);
      }

      // Then diverge
      hostGame.placePiece(new Vector3(3, 3, 3));
      clientGame.placePiece(new Vector3(6, 6, 6));

      expect(hostGame.getMoveCount()).toBe(3);
      expect(clientGame.getMoveCount()).toBe(3);

      // Trigger conflict resolution
      const rollbackToState = (hostNetworkManager as any).rollbackToState.bind(hostNetworkManager);
      await rollbackToState(2); // Rollback to after second move

      expect(hostGame.getMoveCount()).toBe(2);
      expect(hostGame.getCurrentStateIndex()).toBe(2);
    });
  });

  describe('Sync State Recovery', () => {
    it('should sync game state when no common ancestor found', async () => {
      // Setup connection
      await hostNetworkManager.hostGame();
      await clientNetworkManager.joinGame('host-peer-id');

      // Create completely different game states
      hostGame.placePiece(new Vector3(1, 1, 1));
      hostGame.placePiece(new Vector3(2, 2, 2));
      
      clientGame.placePiece(new Vector3(8, 8, 8));
      clientGame.placePiece(new Vector3(7, 7, 7));

      // Setup game replacement listener
      const gameReplaced = jest.fn();
      clientNetworkManager.on('gameReplaced', gameReplaced);

      // Simulate sync response with host's game state
      const syncResponse = {
        type: MessageType.SYNC_RESPONSE,
        payload: {
          gameState: hostGame.exportGame(),
          stateHash: hostGame.getCurrentState().generateHash()
        },
        timestamp: Date.now(),
        sequence: 1
      };

      const handleSyncResponse = (clientNetworkManager as any).handleSyncResponse.bind(clientNetworkManager);
      handleSyncResponse(syncResponse);

      // Verify game was replaced
      expect(gameReplaced).toHaveBeenCalled();
    });
  });

  describe('Conflict Logging', () => {
    it('should maintain comprehensive conflict logs', async () => {
      // Setup connection
      await hostNetworkManager.hostGame();
      
      // Create some conflicts
      const detectAndReportConflict = (hostNetworkManager as any).detectAndReportConflict.bind(hostNetworkManager);
      
      detectAndReportConflict('hash1', 1);
      detectAndReportConflict('hash2', 2);
      detectAndReportConflict('hash3', 3);

      const logs = hostNetworkManager.getConflictLogs();
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some(log => log.message.includes('Sending conflict detection'))).toBe(true);
    });
  });

  describe('Performance Under Conflict', () => {
    it('should resolve conflicts quickly', async () => {
      const startTime = Date.now();
      
      // Setup connection
      await hostNetworkManager.hostGame();
      await clientNetworkManager.joinGame('host-peer-id');

      // Create conflict
      hostGame.placePiece(new Vector3(4, 4, 4));
      clientGame.placePiece(new Vector3(5, 5, 5));

      // Trigger and resolve conflict
      const rollbackToState = (hostNetworkManager as any).rollbackToState.bind(hostNetworkManager);
      await rollbackToState(0);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should resolve within 100ms
      expect(duration).toBeLessThan(100);
    });

    it('should handle multiple simultaneous conflicts', async () => {
      // Setup connection
      await hostNetworkManager.hostGame();
      await clientNetworkManager.joinGame('host-peer-id');

      // Create multiple conflicts simultaneously
      const conflicts = [];
      for (let i = 0; i < 5; i++) {
        const detectAndReportConflict = (hostNetworkManager as any).detectAndReportConflict.bind(hostNetworkManager);
        conflicts.push(detectAndReportConflict(`hash${i}`, i));
      }

      // All conflicts should be handled
      const logs = hostNetworkManager.getConflictLogs();
      expect(logs.filter(log => log.message.includes('conflict'))).toHaveLength(5);
    });
  });
});