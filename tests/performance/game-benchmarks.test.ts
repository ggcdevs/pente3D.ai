/**
 * Performance benchmarks for core game operations
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { 
  suite, 
  benchmark, 
  PerformanceAssertions, 
  PerformanceUtils,
  BenchmarkResult 
} from '@/tests/helpers/performance';
import { 
  BoardBuilder, 
  GameBuilder, 
  TestDataFactory,
  RandomScenarios 
} from '@/tests/helpers/builders';
import { Game, Board, Vector3, GameRules } from '@/core';

describe('Game Performance Benchmarks', () => {
  let baselineResults: Map<string, BenchmarkResult>;

  beforeEach(() => {
    baselineResults = new Map();
  });

  describe('Board Operations', () => {
    it('should benchmark piece placement', async () => {
      const boardSuite = suite('Board Operations', { samples: 1000, warmup: 100 });

      // Small board
      boardSuite.add('Place piece - 7x7 board', () => {
        const board = new Board(7);
        board.placePiece(Vector3.create(0, 0, 0), TestDataFactory.createTestPlayers().black);
      });

      // Medium board
      boardSuite.add('Place piece - 13x13 board', () => {
        const board = new Board(13);
        board.placePiece(Vector3.create(0, 0, 0), TestDataFactory.createTestPlayers().black);
      });

      // Large board
      boardSuite.add('Place piece - 19x19 board', () => {
        const board = new Board(19);
        board.placePiece(Vector3.create(0, 0, 0), TestDataFactory.createTestPlayers().black);
      });

      // With many existing pieces
      boardSuite.add('Place piece - crowded board', () => {
        const board = RandomScenarios.randomPosition({ 
          pieceCount: 50, 
          boardSize: 13 
        });
        board.placePiece(Vector3.create(5, 5, 0), TestDataFactory.createTestPlayers().black);
      });

      const results = await boardSuite.run();
      
      // Assert performance requirements
      const smallBoardResult = results.get('Place piece - 7x7 board')!;
      expect(smallBoardResult.mean).toBeLessThan(0.1); // Should be under 0.1ms
      expect(smallBoardResult.opsPerSecond).toBeGreaterThan(10000); // 10k+ ops/sec
    });

    it('should benchmark piece lookup', async () => {
      const { black, white } = TestDataFactory.createTestPlayers();
      
      // Create boards with different fill levels
      const emptyBoard = new Board(13);
      const sparseBoard = RandomScenarios.randomPosition({ pieceCount: 20, boardSize: 13 });
      const denseBoard = RandomScenarios.randomPosition({ pieceCount: 100, boardSize: 13 });

      const lookupSuite = suite('Piece Lookup', { samples: 10000 });

      lookupSuite.add('Lookup - empty board', () => {
        emptyBoard.getPieceAt({ x: 0, y: 0, z: 0 });
      });

      lookupSuite.add('Lookup - sparse board', () => {
        sparseBoard.getPieceAt({ x: 0, y: 0, z: 0 });
      });

      lookupSuite.add('Lookup - dense board', () => {
        denseBoard.getPieceAt({ x: 0, y: 0, z: 0 });
      });

      const results = await lookupSuite.run();
      
      // Lookups should be O(1) - similar performance regardless of board state
      const emptyResult = results.get('Lookup - empty board')!;
      const denseResult = results.get('Lookup - dense board')!;
      
      const performanceDiff = Math.abs(denseResult.mean - emptyResult.mean);
      expect(performanceDiff).toBeLessThan(0.01); // Less than 0.01ms difference
    });

    it('should benchmark getAllPieces', async () => {
      const suite = new BenchmarkSuite('Get All Pieces', { samples: 1000 });

      for (const pieceCount of [10, 50, 100, 200]) {
        const board = RandomScenarios.randomPosition({ 
          pieceCount, 
          boardSize: 19 
        });

        suite.add(`getAllPieces - ${pieceCount} pieces`, () => {
          board.getAllPieces();
        });
      }

      const results = await suite.run();
      
      // Performance should scale linearly with piece count
      const result10 = results.get('getAllPieces - 10 pieces')!;
      const result100 = results.get('getAllPieces - 100 pieces')!;
      
      const scalingFactor = result100.mean / result10.mean;
      expect(scalingFactor).toBeLessThan(15); // Should be roughly 10x, allow some overhead
    });
  });

  describe('Game Rules Performance', () => {
    it('should benchmark win detection', async () => {
      const rules = new GameRules();
      const winSuite = suite('Win Detection', { samples: 1000 });

      // No win - empty board
      const emptyBoard = new Board(13);
      winSuite.add('Check win - empty board', () => {
        rules.checkWin(emptyBoard, Vector3.create(0, 0, 0));
      });

      // No win - complex position
      const complexBoard = TestDataFactory.createComplexPosition();
      winSuite.add('Check win - complex position', () => {
        rules.checkWin(complexBoard, Vector3.create(0, 0, 0));
      });

      // Win exists
      const winBoard = TestDataFactory.createWinningBoard();
      winSuite.add('Check win - winning position', () => {
        rules.checkWin(winBoard, Vector3.create(2, 0, 0));
      });

      const results = await winSuite.run();
      
      // All win checks should be fast
      for (const [_, result] of results) {
        expect(result.mean).toBeLessThan(1); // Under 1ms
        expect(result.percentile95).toBeLessThan(2); // 95% under 2ms
      }
    });

    it('should benchmark capture detection', async () => {
      const rules = new GameRules();
      const { black, white } = TestDataFactory.createTestPlayers();
      
      const captureSuite = suite('Capture Detection', { samples: 2000 });

      // Board with potential captures
      const captureBoard = new BoardBuilder()
        .withSize(13)
        .withPiece(0, 0, 0, black)
        .withPiece(1, 0, 0, white)
        .withPiece(2, 0, 0, white)
        .build();

      captureSuite.add('Check captures - potential capture', () => {
        rules.checkCaptures(captureBoard, Vector3.create(3, 0, 0), black);
      });

      // Board with no captures possible
      const noCapBoard = TestDataFactory.createTestBoard();
      captureSuite.add('Check captures - no captures', () => {
        rules.checkCaptures(noCapBoard, Vector3.create(5, 5, 0), black);
      });

      const results = await captureSuite.run();
      
      // Capture detection should be fast
      expect(results.get('Check captures - potential capture')!.mean).toBeLessThan(0.5);
      expect(results.get('Check captures - no captures')!.mean).toBeLessThan(0.2);
    });

    it('should benchmark valid moves generation', async () => {
      const rules = new GameRules();
      
      await PerformanceAssertions.assertCompleteWithin(
        () => {
          const board = RandomScenarios.randomPosition({ 
            pieceCount: 100, 
            boardSize: 19 
          });
          const validMoves = rules.getValidMoves(board);
          expect(validMoves.length).toBeGreaterThan(0);
        },
        50, // Should complete within 50ms
        'Valid moves generation took too long'
      );
    });
  });

  describe('Game State Operations', () => {
    it('should benchmark move execution', async () => {
      const moveSuite = suite('Move Execution', { samples: 500 });

      // Simple move
      moveSuite.add('Execute move - empty board', () => {
        const game = new Game({ boardSize: 13 });
        game.placePiece(Vector3.create(0, 0, 0));
      });

      // Move with history
      const gameWithHistory = TestDataFactory.createGameInProgress(20);
      moveSuite.add('Execute move - with history', () => {
        const game = TestDataFactory.createGameInProgress(20);
        game.placePiece(Vector3.create(5, 5, 0));
      });

      const results = await moveSuite.run();
      
      // Move execution should be consistently fast
      expect(results.get('Execute move - empty board')!.mean).toBeLessThan(1);
      expect(results.get('Execute move - with history')!.mean).toBeLessThan(2);
    });

    it('should benchmark undo/redo operations', async () => {
      const game = TestDataFactory.createGameInProgress(10);
      
      const undoRedoSuite = suite('Undo/Redo', { samples: 1000 });

      undoRedoSuite.add('Undo move', () => {
        game.undo();
        game.redo(); // Reset for next iteration
      });

      undoRedoSuite.add('Redo move', () => {
        game.undo(); // Setup
        game.redo();
      });

      const results = await undoRedoSuite.run();
      
      // Undo/redo should be very fast
      expect(results.get('Undo move')!.mean).toBeLessThan(0.1);
      expect(results.get('Redo move')!.mean).toBeLessThan(0.1);
    });

    it('should benchmark game serialization', async () => {
      const serializeSuite = suite('Serialization', { samples: 100 });

      // Small game
      const smallGame = TestDataFactory.createGameInProgress(5);
      serializeSuite.add('Serialize - small game', () => {
        smallGame.exportGame();
      });

      // Large game
      const largeGame = TestDataFactory.createGameInProgress(100);
      serializeSuite.add('Serialize - large game', () => {
        largeGame.exportGame();
      });

      const results = await serializeSuite.run();
      
      // Serialization should scale reasonably
      expect(results.get('Serialize - small game')!.mean).toBeLessThan(5);
      expect(results.get('Serialize - large game')!.mean).toBeLessThan(20);
    });
  });

  describe('Memory Performance', () => {
    it('should measure memory usage for large boards', async () => {
      const memoryTest = async () => {
        const boards: Board[] = [];
        
        // Create 100 large boards
        for (let i = 0; i < 100; i++) {
          boards.push(new Board(19));
        }
        
        return boards;
      };

      await PerformanceAssertions.assertMemoryUsage(
        memoryTest,
        50 * 1024 * 1024, // 50MB limit
        'Board creation used too much memory'
      );
    });

    it('should measure memory for game with long history', async () => {
      const memoryTest = async () => {
        const game = new Game({ boardSize: 19 });
        
        // Play 200 moves
        for (let i = 0; i < 200; i++) {
          const x = (i % 19) - 9;
          const y = Math.floor(i / 19) - 9;
          try {
            game.placePiece(Vector3.create(x, y, 0));
          } catch {
            // Ignore invalid moves
          }
        }
        
        return game;
      };

      const { result, memoryDelta } = await PerformanceUtils.profileMemory(memoryTest);
      
      console.log(`Game with 200 moves used: ${PerformanceUtils.formatBytes(memoryDelta)}`);
      expect(memoryDelta).toBeLessThan(10 * 1024 * 1024); // Less than 10MB
    });
  });

  describe('Stress Tests', () => {
    it('should handle rapid successive operations', async () => {
      const game = new Game({ boardSize: 13 });
      const timer = PerformanceUtils.createTimer();
      
      timer.start();
      
      // Perform 1000 operations rapidly
      for (let i = 0; i < 1000; i++) {
        const x = (i % 10) - 5;
        const y = Math.floor(i / 10) % 10 - 5;
        
        try {
          game.placePiece(Vector3.create(x, y, 0));
          if (i % 3 === 0) game.undo();
          if (i % 5 === 0) game.redo();
          if (i % 7 === 0) game.getCurrentState();
        } catch {
          // Ignore errors from invalid operations
        }
      }
      
      const totalTime = timer.stop();
      expect(totalTime).toBeLessThan(100); // Should complete in under 100ms
      
      const opsPerSecond = 1000 / (totalTime / 1000);
      expect(opsPerSecond).toBeGreaterThan(10000); // 10k+ ops/sec
    });

    it('should maintain performance with many concurrent games', async () => {
      const concurrentSuite = suite('Concurrent Games', { samples: 50 });
      
      concurrentSuite.add('10 concurrent games', () => {
        const games: Game[] = [];
        for (let i = 0; i < 10; i++) {
          games.push(new Game({ boardSize: 13 }));
          games[i].placePiece(Vector3.create(0, 0, 0));
        }
      });

      concurrentSuite.add('50 concurrent games', () => {
        const games: Game[] = [];
        for (let i = 0; i < 50; i++) {
          games.push(new Game({ boardSize: 13 }));
          games[i].placePiece(Vector3.create(0, 0, 0));
        }
      });

      const results = await concurrentSuite.run();
      
      // Performance should scale linearly
      const time10 = results.get('10 concurrent games')!.mean;
      const time50 = results.get('50 concurrent games')!.mean;
      
      expect(time50 / time10).toBeLessThan(6); // Should be ~5x, allow some overhead
    });
  });

  describe('Performance Regression Tests', () => {
    it('should detect performance regressions', async () => {
      // Simulate baseline performance
      const baselineBench = benchmark('baseline operation');
      const baseline = await baselineBench.run(() => {
        const board = new Board(13);
        board.placePiece(Vector3.create(0, 0, 0), TestDataFactory.createTestPlayers().black);
      });

      // Simulate current performance (artificially slower)
      const currentBench = benchmark('current operation');
      const current = await currentBench.run(() => {
        const board = new Board(13);
        // Add artificial delay to simulate regression
        for (let i = 0; i < 100; i++) {
          Math.sqrt(i);
        }
        board.placePiece(Vector3.create(0, 0, 0), TestDataFactory.createTestPlayers().black);
      });

      // This should detect the regression
      expect(() => {
        PerformanceAssertions.assertNoRegression(current, baseline, 10);
      }).toThrow(/Performance regression detected/);
    });
  });
});