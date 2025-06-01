import { NetworkManager } from '@/network/NetworkManager';
import { Game, Vector3 } from '@/core';
import { MockPeer, MockDataConnection } from '../../__mocks__/peerjs';

// Mock PeerJS
jest.mock('peerjs');

describe('Network Conflict Resolution Performance', () => {
  let networkManager: NetworkManager;
  let game: Game;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Setup game
    game = new Game({ boardSize: 9 });
    
    // Create network manager
    networkManager = new NetworkManager(game);
  });

  afterEach(() => {
    networkManager.dispose();
    jest.useRealTimers();
  });

  describe('Hash Chain Performance', () => {
    it('should update hash chain efficiently', () => {
      const updateHashChain = (networkManager as any).updateHashChain.bind(networkManager);
      const iterations = 1000;
      
      const startTime = performance.now();
      
      for (let i = 0; i < iterations; i++) {
        updateHashChain();
      }
      
      const endTime = performance.now();
      const avgTime = (endTime - startTime) / iterations;
      
      // Should update hash chain in less than 0.1ms on average
      expect(avgTime).toBeLessThan(0.1);
    });

    it('should maintain hash chain size limit efficiently', () => {
      const updateHashChain = (networkManager as any).updateHashChain.bind(networkManager);
      const networkGameState = (networkManager as any).networkGameState;
      
      // Fill hash chain beyond limit
      const startTime = performance.now();
      
      for (let i = 0; i < 100; i++) {
        updateHashChain();
        // Modify to ensure different hashes
        if (networkGameState.hashChain.length > 0) {
          networkGameState.hashChain[networkGameState.hashChain.length - 1].hash = `hash-${i}`;
        }
      }
      
      const endTime = performance.now();
      
      // Should maintain size limit efficiently
      expect(networkGameState.hashChain.length).toBe(50);
      expect(endTime - startTime).toBeLessThan(10); // Should complete in under 10ms
    });
  });

  describe('Common Ancestor Finding Performance', () => {
    it('should find common ancestor quickly in large hash chains', () => {
      const findCommonAncestor = (networkManager as any).findCommonAncestor.bind(networkManager);
      const networkGameState = (networkManager as any).networkGameState;
      
      // Create large hash chains
      const chainSize = 50;
      networkGameState.hashChain = [];
      const remoteHashChain = [];
      
      // Build matching chains up to divergence point
      for (let i = 0; i < chainSize; i++) {
        const hash = i < 25 ? `common-hash-${i}` : `local-hash-${i}`;
        networkGameState.hashChain.push({
          index: i,
          hash: hash,
          moveCount: i
        });
        
        remoteHashChain.push({
          index: i,
          hash: i < 25 ? `common-hash-${i}` : `remote-hash-${i}`,
          moveCount: i
        });
      }
      
      const startTime = performance.now();
      const commonIndex = findCommonAncestor(remoteHashChain);
      const endTime = performance.now();
      
      expect(commonIndex).toBe(24);
      expect(endTime - startTime).toBeLessThan(5); // Should find in under 5ms
    });

    it('should handle worst-case scenario efficiently', () => {
      const findCommonAncestor = (networkManager as any).findCommonAncestor.bind(networkManager);
      const networkGameState = (networkManager as any).networkGameState;
      
      // Worst case: no common ancestor
      networkGameState.hashChain = Array(50).fill(null).map((_, i) => ({
        index: i,
        hash: `local-${i}`,
        moveCount: i
      }));
      
      const remoteHashChain = Array(50).fill(null).map((_, i) => ({
        index: i,
        hash: `remote-${i}`,
        moveCount: i
      }));
      
      const startTime = performance.now();
      const commonIndex = findCommonAncestor(remoteHashChain);
      const endTime = performance.now();
      
      expect(commonIndex).toBe(-1);
      expect(endTime - startTime).toBeLessThan(5); // Even worst case should be fast
    });
  });

  describe('Rollback Performance', () => {
    it('should rollback quickly for reasonable game histories', async () => {
      // Create a game with many moves
      for (let i = 0; i < 50; i++) {
        const x = i % 9;
        const y = Math.floor(i / 9) % 9;
        const z = Math.floor(i / 81) % 9;
        if (game.placePiece(new Vector3(x, y, z))) {
          // Move was valid
        }
      }
      
      const rollbackToState = (networkManager as any).rollbackToState.bind(networkManager);
      
      const startTime = performance.now();
      await rollbackToState(25); // Rollback to middle
      const endTime = performance.now();
      
      expect(game.getCurrentStateIndex()).toBe(25);
      expect(endTime - startTime).toBeLessThan(10); // Should rollback in under 10ms
    });

    it('should clear pending moves efficiently during rollback', async () => {
      const rollbackToState = (networkManager as any).rollbackToState.bind(networkManager);
      const networkGameState = (networkManager as any).networkGameState;
      
      // Add many pending moves
      for (let i = 0; i < 100; i++) {
        networkGameState.pendingMoves.set(i, {
          message: {} as any,
          timestamp: Date.now(),
          acknowledged: false
        });
      }
      
      const startTime = performance.now();
      await rollbackToState(0);
      const endTime = performance.now();
      
      expect(networkGameState.pendingMoves.size).toBe(0);
      expect(endTime - startTime).toBeLessThan(5); // Should clear quickly
    });
  });

  describe('Conflict Detection Performance', () => {
    it('should detect conflicts quickly', () => {
      const detectConflict = (networkManager as any).detectConflict.bind(networkManager);
      const iterations = 1000;
      
      const startTime = performance.now();
      
      for (let i = 0; i < iterations; i++) {
        detectConflict('different-hash', i % 10);
      }
      
      const endTime = performance.now();
      const avgTime = (endTime - startTime) / iterations;
      
      // Should detect conflicts in microseconds
      expect(avgTime).toBeLessThan(0.01); // Less than 0.01ms per detection
    });
  });

  describe('Logging Performance', () => {
    it('should log conflicts without performance impact', () => {
      const logConflict = (networkManager as any).logConflict.bind(networkManager);
      const iterations = 1000;
      
      // Mock console to prevent actual logging
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const startTime = performance.now();
      
      for (let i = 0; i < iterations; i++) {
        logConflict('info', `Test message ${i}`, { index: i });
      }
      
      const endTime = performance.now();
      const avgTime = (endTime - startTime) / iterations;
      
      // Should log efficiently
      expect(avgTime).toBeLessThan(0.1); // Less than 0.1ms per log
      
      // Should maintain log size limit
      const logs = networkManager.getConflictLogs();
      expect(logs.length).toBe(100); // maxLogSize
      
      consoleSpy.mockRestore();
    });
  });

  describe('Message Processing Performance', () => {
    it('should process conflict messages quickly', () => {
      const handleConflictDetected = (networkManager as any).handleConflictDetected.bind(networkManager);
      
      const message = {
        type: 'conflict_detected',
        payload: {
          localStateHash: 'local-hash',
          remoteStateHash: 'remote-hash',
          moveIndex: 5,
          conflictType: 'state_divergence'
        },
        timestamp: Date.now(),
        sequence: 1
      };
      
      const startTime = performance.now();
      
      for (let i = 0; i < 100; i++) {
        handleConflictDetected(message);
      }
      
      const endTime = performance.now();
      const avgTime = (endTime - startTime) / 100;
      
      // Should handle messages quickly
      expect(avgTime).toBeLessThan(1); // Less than 1ms per message
    });
  });

  describe('Memory Usage', () => {
    it('should not leak memory during conflict resolution', () => {
      const updateHashChain = (networkManager as any).updateHashChain.bind(networkManager);
      const networkGameState = (networkManager as any).networkGameState;
      
      // Initial memory baseline
      const initialHashChainLength = networkGameState.hashChain.length;
      
      // Perform many operations
      for (let i = 0; i < 1000; i++) {
        updateHashChain();
      }
      
      // Hash chain should be limited
      expect(networkGameState.hashChain.length).toBeLessThanOrEqual(50);
      
      // Clear and check cleanup
      networkManager.dispose();
      
      // After disposal, internal state should be cleared
      expect((networkManager as any).conflictLogs).toEqual([]);
    });
  });

  describe('Concurrent Conflict Resolution', () => {
    it('should handle multiple conflicts efficiently', async () => {
      const detectAndReportConflict = (networkManager as any).detectAndReportConflict.bind(networkManager);
      
      const startTime = performance.now();
      
      // Simulate multiple conflicts
      const conflicts = [];
      for (let i = 0; i < 10; i++) {
        conflicts.push(detectAndReportConflict(`hash-${i}`, i));
      }
      
      const endTime = performance.now();
      
      // Should handle all conflicts quickly
      expect(endTime - startTime).toBeLessThan(10); // Under 10ms for 10 conflicts
      
      // Check that all conflicts were logged
      const logs = networkManager.getConflictLogs();
      expect(logs.filter(log => log.message.includes('Sending conflict detection'))).toHaveLength(10);
    });
  });
});