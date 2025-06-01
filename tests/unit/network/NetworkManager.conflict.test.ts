import { NetworkManager } from '@/network/NetworkManager';
import { Game, Vector3 } from '@/core';
import { 
  ConflictInfo,
  MessageType,
  ConflictDetectedMessage,
  ConflictResolutionMessage,
  HashChainRequestMessage,
  HashChainResponseMessage,
} from '@/network/types';
import { MockPeer, MockDataConnection } from '../../../__mocks__/peerjs';

// Mock PeerJS
jest.mock('peerjs');

describe('NetworkManager - Conflict Resolution', () => {
  let networkManager: NetworkManager;
  let game: Game;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup game
    game = new Game({ boardSize: 9 });
    
    // Create network manager
    networkManager = new NetworkManager(game);
  });

  afterEach(() => {
    networkManager.dispose();
  });

  describe('Conflict Detection', () => {
    it('should detect state divergence conflict', () => {
      // Make a move locally to have a non-zero move count
      game.placePiece(new Vector3(4, 4, 4));
      
      // Setup conflict detection spy
      const conflictDetectedSpy = jest.fn();
      networkManager.on('conflictDetected', conflictDetectedSpy);
      
      // Mock the connection for the test
      (networkManager as any).connection = {
        open: true,
        send: jest.fn(),
        close: jest.fn()
      };
      
      // Test conflict detection directly
      const detectAndReportConflict = (networkManager as any).detectAndReportConflict.bind(networkManager);
      detectAndReportConflict('different-hash', game.getCurrentStateIndex());
      
      // Verify conflict was detected
      expect(conflictDetectedSpy).toHaveBeenCalled();
      const conflictInfo = conflictDetectedSpy.mock.calls[0][0] as ConflictInfo;
      expect(conflictInfo.type).toBe('state_divergence');
    });

    it('should detect missing moves conflict', () => {
      const detectConflict = (networkManager as any).detectConflict.bind(networkManager);
      
      // Current state is at index 0 (initial state)
      const conflict = detectConflict('some-hash', 5); // Remote is at index 5
      
      expect(conflict).not.toBeNull();
      expect(conflict.type).toBe('missing_moves');
      expect(conflict.divergencePoint).toBe(0);
    });

    it('should detect invalid sequence conflict', () => {
      const detectConflict = (networkManager as any).detectConflict.bind(networkManager);
      
      // Make some moves to advance the game to index 2
      game.placePiece(new Vector3(4, 4, 4));
      game.placePiece(new Vector3(5, 5, 5));
      
      // Remote is behind us by more than 1 (remote at 0, we're at 2)
      // This is invalid sequence since remoteMoveIndex < localIndex - 1
      const conflict = detectConflict('some-hash', 0);
      
      expect(conflict).not.toBeNull();
      expect(conflict!.type).toBe('invalid_sequence');
    });

    it('should not detect conflict when hashes match', () => {
      const detectConflict = (networkManager as any).detectConflict.bind(networkManager);
      const currentHash = game.getCurrentState().generateHash();
      
      const conflict = detectConflict(currentHash, 0);
      
      expect(conflict).toBeNull();
    });
  });

  describe('Hash Chain Management', () => {
    it('should update hash chain when moves are made', () => {
      const updateHashChain = (networkManager as any).updateHashChain.bind(networkManager);
      const networkGameState = (networkManager as any).networkGameState;
      
      // Initial hash chain should be empty
      expect(networkGameState.hashChain).toHaveLength(0);
      
      // Update hash chain
      updateHashChain();
      
      // Should have one entry
      expect(networkGameState.hashChain).toHaveLength(1);
      expect(networkGameState.hashChain[0]).toMatchObject({
        index: 0,
        hash: expect.any(String),
        moveCount: 0
      });
      
      // Make a move and update again
      game.placePiece(new Vector3(4, 4, 4));
      updateHashChain();
      
      expect(networkGameState.hashChain).toHaveLength(2);
      expect(networkGameState.hashChain[1].moveCount).toBe(1);
    });

    it('should limit hash chain size to 50 entries', () => {
      const updateHashChain = (networkManager as any).updateHashChain.bind(networkManager);
      const networkGameState = (networkManager as any).networkGameState;
      
      // Add 60 entries
      for (let i = 0; i < 60; i++) {
        updateHashChain();
        // Modify hash chain to simulate different hashes
        if (networkGameState.hashChain.length > 0) {
          networkGameState.hashChain[networkGameState.hashChain.length - 1].hash = `hash-${i}`;
        }
      }
      
      // Should only keep last 50
      expect(networkGameState.hashChain).toHaveLength(50);
      expect(networkGameState.hashChain[0].hash).toBe('hash-10'); // First kept is hash-10
      expect(networkGameState.hashChain[49].hash).toBe('hash-59'); // Last is hash-59
    });
  });

  describe('Common Ancestor Finding', () => {
    it('should find common ancestor in hash chains', () => {
      const findCommonAncestor = (networkManager as any).findCommonAncestor.bind(networkManager);
      const networkGameState = (networkManager as any).networkGameState;
      
      // Setup local hash chain
      networkGameState.hashChain = [
        { index: 0, hash: 'hash-0', moveCount: 0 },
        { index: 1, hash: 'hash-1', moveCount: 1 },
        { index: 2, hash: 'hash-2', moveCount: 2 },
        { index: 3, hash: 'hash-3-local', moveCount: 3 },
        { index: 4, hash: 'hash-4-local', moveCount: 4 },
      ];
      
      // Remote hash chain diverges after index 2
      const remoteHashChain = [
        { index: 0, hash: 'hash-0', moveCount: 0 },
        { index: 1, hash: 'hash-1', moveCount: 1 },
        { index: 2, hash: 'hash-2', moveCount: 2 },
        { index: 3, hash: 'hash-3-remote', moveCount: 3 },
        { index: 4, hash: 'hash-4-remote', moveCount: 4 },
      ];
      
      const commonIndex = findCommonAncestor(remoteHashChain);
      expect(commonIndex).toBe(2);
    });

    it('should return -1 when no common ancestor found', () => {
      const findCommonAncestor = (networkManager as any).findCommonAncestor.bind(networkManager);
      const networkGameState = (networkManager as any).networkGameState;
      
      // Completely different hash chains
      networkGameState.hashChain = [
        { index: 0, hash: 'hash-0-local', moveCount: 0 },
        { index: 1, hash: 'hash-1-local', moveCount: 1 },
      ];
      
      const remoteHashChain = [
        { index: 0, hash: 'hash-0-remote', moveCount: 0 },
        { index: 1, hash: 'hash-1-remote', moveCount: 1 },
      ];
      
      const commonIndex = findCommonAncestor(remoteHashChain);
      expect(commonIndex).toBe(-1);
    });
  });

  describe('Rollback Functionality', () => {
    it('should rollback to specified state', async () => {
      const rollbackToState = (networkManager as any).rollbackToState.bind(networkManager);
      
      // Make some moves - game starts at index 0
      game.placePiece(new Vector3(4, 4, 4)); // Now at index 1
      game.placePiece(new Vector3(5, 5, 5)); // Now at index 2
      
      expect(game.getCurrentStateIndex()).toBe(2);
      
      // Rollback to index 1
      const success = await rollbackToState(1);
      
      expect(success).toBe(true);
      expect(game.getCurrentStateIndex()).toBe(1);
    });

    it('should clear pending moves after rollback', async () => {
      const rollbackToState = (networkManager as any).rollbackToState.bind(networkManager);
      const networkGameState = (networkManager as any).networkGameState;
      
      // Add some pending moves
      networkGameState.pendingMoves.set(1, { 
        message: {} as any, 
        timestamp: Date.now(), 
        acknowledged: false 
      });
      
      await rollbackToState(0);
      
      expect(networkGameState.pendingMoves.size).toBe(0);
    });

    it('should handle rollback failure', async () => {
      const rollbackToState = (networkManager as any).rollbackToState.bind(networkManager);
      
      // Try to rollback to invalid index
      const success = await rollbackToState(-1);
      
      expect(success).toBe(false);
    });
  });

  describe('Conflict Logging', () => {
    it('should log conflicts with proper formatting', () => {
      const logConflict = (networkManager as any).logConflict.bind(networkManager);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      logConflict('info', 'Test message', { data: 'test' });
      
      expect(consoleSpy).toHaveBeenCalledWith(
        '[NetworkManager Conflict] Test message',
        { data: 'test' }
      );
      
      const logs = networkManager.getConflictLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        type: 'info',
        message: 'Test message',
        data: { data: 'test' },
        timestamp: expect.any(Number)
      });
      
      consoleSpy.mockRestore();
    });

    it('should limit log size to maxLogSize', () => {
      const logConflict = (networkManager as any).logConflict.bind(networkManager);
      const maxLogSize = (networkManager as any).maxLogSize;
      
      // Add more logs than the limit
      for (let i = 0; i < maxLogSize + 10; i++) {
        logConflict('info', `Message ${i}`);
      }
      
      const logs = networkManager.getConflictLogs();
      expect(logs).toHaveLength(maxLogSize);
      expect(logs[0].message).toBe(`Message 10`); // First 10 should be removed
    });
  });

  describe('Message Handlers', () => {
    beforeEach(() => {
      // Mock the connection for message sending tests
      (networkManager as any).connection = {
        open: true,
        send: jest.fn(),
        close: jest.fn()
      };
    });

    it('should handle CONFLICT_DETECTED message', () => {
      const handleConflictDetected = (networkManager as any).handleConflictDetected.bind(networkManager);
      const conflictDetectedSpy = jest.fn();
      networkManager.on('conflictDetected', conflictDetectedSpy);
      
      const message: ConflictDetectedMessage = {
        type: MessageType.CONFLICT_DETECTED,
        payload: {
          localStateHash: 'local-hash',
          remoteStateHash: 'remote-hash',
          moveIndex: 5,
          conflictType: 'state_divergence'
        },
        timestamp: Date.now(),
        sequence: 1
      };
      
      handleConflictDetected(message);
      
      expect(conflictDetectedSpy).toHaveBeenCalled();
      const networkGameState = (networkManager as any).networkGameState;
      expect(networkGameState.conflictResolutionInProgress).toBe(true);
    });

    it('should handle CONFLICT_RESOLUTION message with rollback', (done) => {
      const handleConflictResolution = (networkManager as any).handleConflictResolution.bind(networkManager);
      
      networkManager.on('conflictResolved', (data) => {
        expect(data).toEqual({
          resolution: 'rollback',
          targetIndex: 0
        });
        done();
      });
      
      const message: ConflictResolutionMessage = {
        type: MessageType.CONFLICT_RESOLUTION,
        payload: {
          resolution: 'rollback',
          targetStateHash: 'target-hash',
          targetMoveIndex: 0
        },
        timestamp: Date.now(),
        sequence: 1
      };
      
      handleConflictResolution(message);
    });

    it('should handle HASH_CHAIN_REQUEST message', () => {
      const handleHashChainRequest = (networkManager as any).handleHashChainRequest.bind(networkManager);
      
      // Make some moves to create history
      game.placePiece(new Vector3(4, 4, 4));
      game.placePiece(new Vector3(5, 5, 5));
      
      const message: HashChainRequestMessage = {
        type: MessageType.HASH_CHAIN_REQUEST,
        payload: {
          fromIndex: 0,
          toIndex: 2
        },
        timestamp: Date.now(),
        sequence: 1
      };
      
      handleHashChainRequest(message);
      
      // Check that response was sent
      const mockConnection = (networkManager as any).connection;
      expect(mockConnection.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.HASH_CHAIN_RESPONSE,
          payload: expect.objectContaining({
            hashChain: expect.arrayContaining([
              expect.objectContaining({ index: 0, moveCount: 0 }),
              expect.objectContaining({ index: 1, moveCount: 1 }),
              expect.objectContaining({ index: 2, moveCount: 2 })
            ])
          })
        })
      );
    });

    it('should handle HASH_CHAIN_RESPONSE message', () => {
      const handleHashChainResponse = (networkManager as any).handleHashChainResponse.bind(networkManager);
      const networkGameState = (networkManager as any).networkGameState;
      
      // Setup local hash chain
      networkGameState.hashChain = [
        { index: 0, hash: 'hash-0', moveCount: 0 },
        { index: 1, hash: 'hash-1', moveCount: 1 }
      ];
      
      const message: HashChainResponseMessage = {
        type: MessageType.HASH_CHAIN_RESPONSE,
        payload: {
          hashChain: [
            { index: 0, hash: 'hash-0', moveCount: 0 },
            { index: 1, hash: 'hash-1', moveCount: 1 },
            { index: 2, hash: 'hash-2', moveCount: 2 }
          ]
        },
        timestamp: Date.now(),
        sequence: 1
      };
      
      handleHashChainResponse(message);
      
      // Should send rollback resolution
      const mockConnection = (networkManager as any).connection;
      expect(mockConnection.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.CONFLICT_RESOLUTION,
          payload: expect.objectContaining({
            resolution: 'rollback',
            targetMoveIndex: 1
          })
        })
      );
    });
  });

  describe('detectAndReportConflict', () => {
    beforeEach(() => {
      // Mock the connection for message sending tests
      (networkManager as any).connection = {
        open: true,
        send: jest.fn(),
        close: jest.fn()
      };
    });

    it('should send conflict detection message when conflict found', () => {
      const detectAndReportConflict = (networkManager as any).detectAndReportConflict.bind(networkManager);
      const mockConnection = (networkManager as any).connection;
      
      detectAndReportConflict('different-hash', 0);
      
      expect(mockConnection.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.CONFLICT_DETECTED,
          payload: expect.objectContaining({
            conflictType: 'state_divergence'
          })
        })
      );
    });

    it('should not send conflict message if resolution already in progress', () => {
      const detectAndReportConflict = (networkManager as any).detectAndReportConflict.bind(networkManager);
      const networkGameState = (networkManager as any).networkGameState;
      
      networkGameState.conflictResolutionInProgress = true;
      const mockConnection = (networkManager as any).connection;
      
      detectAndReportConflict('different-hash', 0);
      
      expect(mockConnection.send).not.toHaveBeenCalled();
    });
  });
});