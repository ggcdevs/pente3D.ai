import { GameState, Player, Move, Vector3 } from '@/core';
import { moveSequences, createTestPlayers } from '../fixtures/game-states';

describe('Game Rules Integration', () => {
  let players: Player[];
  let initialState: GameState;

  beforeEach(() => {
    players = createTestPlayers();
    initialState = GameState.createInitialState(7, players);
  });

  describe('complete game scenarios', () => {
    test('plays game to horizontal win', () => {
      let state = initialState;
      
      // Play moves leading to horizontal win
      const moves = [
        Move.create(Vector3.create(0, 0, 0), 'player1'),
        Move.create(Vector3.create(0, 1, 0), 'player2'),
        Move.create(Vector3.create(1, 0, 0), 'player1'),
        Move.create(Vector3.create(1, 1, 0), 'player2'),
        Move.create(Vector3.create(2, 0, 0), 'player1'),
        Move.create(Vector3.create(2, 1, 0), 'player2'),
        Move.create(Vector3.create(3, 0, 0), 'player1'),
        Move.create(Vector3.create(3, 1, 0), 'player2'),
        Move.create(Vector3.create(4, 0, 0), 'player1'), // Win!
      ];

      moves.forEach((move, index) => {
        expect(state.isGameOver).toBe(false);
        state = state.applyMove(move);
      });

      expect(state.isGameOver).toBe(true);
      expect(state.winResult).not.toBeNull();
      expect(state.winResult!.type).toBe('five-in-a-row');
      expect(state.winResult!.winner.id).toBe('player1');
    });

    test('plays game to vertical win', () => {
      let state = initialState;
      
      const moves = [
        Move.create(Vector3.create(0, 0, 0), 'player1'),
        Move.create(Vector3.create(1, 0, 0), 'player2'),
        Move.create(Vector3.create(0, 1, 0), 'player1'),
        Move.create(Vector3.create(1, 1, 0), 'player2'),
        Move.create(Vector3.create(0, 2, 0), 'player1'),
        Move.create(Vector3.create(1, 2, 0), 'player2'),
        Move.create(Vector3.create(0, 3, 0), 'player1'),
        Move.create(Vector3.create(1, 3, 0), 'player2'),
        Move.create(Vector3.create(0, 4, 0), 'player1'), // Win!
      ];

      moves.forEach(move => {
        state = state.applyMove(move);
      });

      expect(state.isGameOver).toBe(true);
      expect(state.winResult!.type).toBe('five-in-a-row');
    });

    test('plays game to diagonal win', () => {
      let state = initialState;
      
      const moves = [
        Move.create(Vector3.create(0, 0, 0), 'player1'),
        Move.create(Vector3.create(1, 0, 0), 'player2'),
        Move.create(Vector3.create(1, 1, 0), 'player1'),
        Move.create(Vector3.create(2, 0, 0), 'player2'),
        Move.create(Vector3.create(2, 2, 0), 'player1'),
        Move.create(Vector3.create(3, 0, 0), 'player2'),
        Move.create(Vector3.create(3, 3, 0), 'player1'),
        Move.create(Vector3.create(0, 1, 0), 'player2'),
        Move.create(Vector3.create(4, 4, 0), 'player1'), // Win!
      ];

      moves.forEach(move => {
        state = state.applyMove(move);
      });

      expect(state.isGameOver).toBe(true);
      expect(state.winResult!.winningLine).not.toBeNull();
    });

    test('plays game to 3D diagonal win', () => {
      let state = initialState;
      
      const moves = [
        Move.create(Vector3.create(0, 0, 0), 'player1'),
        Move.create(Vector3.create(1, 0, 0), 'player2'),
        Move.create(Vector3.create(1, 1, 1), 'player1'),
        Move.create(Vector3.create(2, 0, 0), 'player2'),
        Move.create(Vector3.create(2, 2, 2), 'player1'),
        Move.create(Vector3.create(3, 0, 0), 'player2'),
        Move.create(Vector3.create(3, 3, 3), 'player1'),
        Move.create(Vector3.create(0, 1, 0), 'player2'),
        Move.create(Vector3.create(-1, -1, -1), 'player1'),
        Move.create(Vector3.create(0, 2, 0), 'player2'),
        Move.create(Vector3.create(-2, -2, -2), 'player1'), // Win!
      ];

      moves.forEach(move => {
        state = state.applyMove(move);
      });

      expect(state.isGameOver).toBe(true);
      expect(state.winResult!.type).toBe('five-in-a-row');
    });

    test('plays game to capture win', () => {
      let state = initialState;
      
      // Setup multiple captures to reach 5 capture pairs
      const captureSetups = [
        // First capture
        [Vector3.create(0, 0, 0), Vector3.create(1, 0, 0), Vector3.create(2, 0, 0), Vector3.create(3, 0, 0)],
        // Second capture
        [Vector3.create(0, 1, 0), Vector3.create(1, 1, 0), Vector3.create(2, 1, 0), Vector3.create(3, 1, 0)],
        // Third capture
        [Vector3.create(0, 2, 0), Vector3.create(1, 2, 0), Vector3.create(2, 2, 0), Vector3.create(3, 2, 0)],
        // Fourth capture
        [Vector3.create(0, 0, 1), Vector3.create(1, 0, 1), Vector3.create(2, 0, 1), Vector3.create(3, 0, 1)],
        // Fifth capture
        [Vector3.create(0, 0, 2), Vector3.create(1, 0, 2), Vector3.create(2, 0, 2), Vector3.create(3, 0, 2)],
      ];

      captureSetups.forEach((setup, captureIndex) => {
        // Place pieces: player1, player2, player2, player1
        state = state.applyMove(Move.create(setup[0], 'player1'));
        state = state.applyMove(Move.create(setup[1], 'player2'));
        state = state.applyMove(Move.create(setup[3], 'player1'));
        state = state.applyMove(Move.create(setup[2], 'player2'));
        
        // Check if game is over after 5th capture
        if (captureIndex === 4) {
          expect(state.isGameOver).toBe(true);
          expect(state.winResult!.type).toBe('captures');
          expect(state.winResult!.winner.id).toBe('player1');
        }
      });
    });

    test('handles complex capture sequences', () => {
      let state = initialState;
      
      // Create a scenario with multiple capture opportunities
      state = state
        .applyMove(Move.create(Vector3.create(0, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(1, 0, 0), 'player2'))
        .applyMove(Move.create(Vector3.create(3, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(2, 0, 0), 'player2'))
        .applyMove(Move.create(Vector3.create(0, 1, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(0, 2, 0), 'player2'))
        .applyMove(Move.create(Vector3.create(0, 4, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(0, 3, 0), 'player2'));

      // Both captures should be detected
      const player1 = state.players.find(p => p.id === 'player1')!;
      expect(player1.captureCount).toBe(2); // 4 pieces = 2 pairs
    });

    test('handles near-win blocking', () => {
      let state = initialState;
      
      // Player1 tries to get 5 in a row, player2 blocks
      state = state
        .applyMove(Move.create(Vector3.create(0, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(0, 1, 0), 'player2'))
        .applyMove(Move.create(Vector3.create(1, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(1, 1, 0), 'player2'))
        .applyMove(Move.create(Vector3.create(2, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(2, 1, 0), 'player2'))
        .applyMove(Move.create(Vector3.create(3, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(4, 0, 0), 'player2')); // Block!

      expect(state.isGameOver).toBe(false);
      
      // Player1 must find another way
      state = state.applyMove(Move.create(Vector3.create(-1, 0, 0), 'player1'));
      
      expect(state.isGameOver).toBe(true); // Win with 5 in a row
    });

    test('manages multiple threat positions', () => {
      let state = initialState;
      
      // Create multiple threats
      state = state
        // Horizontal threat
        .applyMove(Move.create(Vector3.create(0, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(0, 1, 0), 'player2'))
        .applyMove(Move.create(Vector3.create(1, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(1, 1, 0), 'player2'))
        .applyMove(Move.create(Vector3.create(2, 0, 0), 'player1'))
        // Vertical threat
        .applyMove(Move.create(Vector3.create(0, 2, 0), 'player2'))
        .applyMove(Move.create(Vector3.create(0, 3, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(1, 2, 0), 'player2'));

      // Player1 has threats at (3,0,0) and (0,4,0)
      const legalMoves = state.getLegalMoves();
      expect(legalMoves.some(m => m.equals(Vector3.create(3, 0, 0)))).toBe(true);
      expect(legalMoves.some(m => m.equals(Vector3.create(0, 4, 0)))).toBe(true);
    });

    test('completes 50-move game', () => {
      let state = initialState;
      const moveCount = 50;
      let movesPlayed = 0;

      // Play moves in a pattern that avoids quick wins
      for (let z = 0; z < 3 && movesPlayed < moveCount; z++) {
        for (let y = 0; y < 3 && movesPlayed < moveCount; y++) {
          for (let x = 0; x < 3 && movesPlayed < moveCount; x++) {
            if ((x + y + z) % 3 === 0) continue; // Skip some positions
            
            const player = state.getCurrentPlayer();
            const move = Move.create(Vector3.create(x, y, z), player.id);
            
            if (state.isValidMove(move)) {
              state = state.applyMove(move);
              movesPlayed++;
              
              if (state.isGameOver) break;
            }
          }
        }
      }

      expect(state.moveHistory.length).toBeGreaterThanOrEqual(30);
      expect(state.board.getPieceCount()).toBe(state.moveHistory.length);
    });

    test('handles draw conditions', () => {
      // In 3D Pente, draws are extremely rare, but we can test board filling
      let state = initialState;
      let moveCount = 0;
      const maxMoves = 7 * 7 * 7; // 343 positions

      // Try to fill the board
      for (let x = -3; x <= 3; x++) {
        for (let y = -3; y <= 3; y++) {
          for (let z = -3; z <= 3; z++) {
            const pos = Vector3.create(x, y, z);
            const player = state.getCurrentPlayer();
            const move = Move.create(pos, player.id);
            
            if (state.isValidMove(move) && !state.isGameOver) {
              state = state.applyMove(move);
              moveCount++;
            }
          }
        }
      }

      // Game should end before board is full (someone will win)
      expect(state.isGameOver || moveCount === maxMoves).toBe(true);
    });

    test('validates tournament rules', () => {
      let state = initialState;
      
      // Tournament rules might include:
      // 1. Proper turn alternation
      // 2. Legal moves only
      // 3. Correct win detection
      
      const tournament = {
        moveTimeLimit: 30000, // 30 seconds per move
        totalTimeLimit: 1800000, // 30 minutes per player
      };

      // Simulate tournament play
      const startTime = Date.now();
      
      for (let i = 0; i < 20; i++) {
        const player = state.getCurrentPlayer();
        const moveStartTime = Date.now();
        
        // Find a legal move
        const legalMoves = state.getLegalMoves();
        if (legalMoves.length === 0 || state.isGameOver) break;
        
        const randomMove = Move.create(
          legalMoves[Math.floor(Math.random() * legalMoves.length)],
          player.id,
          [],
          moveStartTime
        );
        
        state = state.applyMove(randomMove);
        
        const moveTime = Date.now() - moveStartTime;
        expect(moveTime).toBeLessThan(tournament.moveTimeLimit);
      }

      const totalTime = Date.now() - startTime;
      expect(totalTime).toBeLessThan(tournament.totalTimeLimit);
    });

    test('supports different board sizes', () => {
      const boardSizes = [7, 9, 11] as const;
      
      boardSizes.forEach(size => {
        const state = GameState.createInitialState(size, players);
        
        // Play a few moves
        const moves = [
          Move.create(Vector3.create(0, 0, 0), 'player1'),
          Move.create(Vector3.create(1, 0, 0), 'player2'),
          Move.create(Vector3.create(0, 1, 0), 'player1'),
        ];

        let currentState = state;
        moves.forEach(move => {
          if (currentState.isValidMove(move)) {
            currentState = currentState.applyMove(move);
          }
        });

        expect(currentState.board.size).toBe(size);
        expect(currentState.board.getPieceCount()).toBeGreaterThan(0);
      });
    });

    test('handles 3-player games', () => {
      const threePlayers = [
        Player.createLocal('player1', 'white'),
        Player.createLocal('player2', 'black'),
        Player.createLocal('player3', 'red'),
      ];
      
      let state = GameState.createInitialState(7, threePlayers);
      
      // Each player makes a move
      const moves = [
        Move.create(Vector3.create(0, 0, 0), 'player1'),
        Move.create(Vector3.create(1, 0, 0), 'player2'),
        Move.create(Vector3.create(2, 0, 0), 'player3'),
        Move.create(Vector3.create(0, 1, 0), 'player1'),
        Move.create(Vector3.create(1, 1, 0), 'player2'),
        Move.create(Vector3.create(2, 1, 0), 'player3'),
      ];

      moves.forEach((move, index) => {
        expect(state.getCurrentPlayer().id).toBe(threePlayers[index % 3].id);
        state = state.applyMove(move);
      });

      expect(state.moveHistory).toHaveLength(6);
    });

    test('handles 4-player games', () => {
      const fourPlayers = [
        Player.createLocal('player1', 'white'),
        Player.createLocal('player2', 'black'),
        Player.createLocal('player3', 'red'),
        Player.createLocal('player4', 'blue'),
      ];
      
      let state = GameState.createInitialState(9, fourPlayers); // Larger board for 4 players
      
      // Each player makes a move
      for (let round = 0; round < 2; round++) {
        for (let p = 0; p < 4; p++) {
          const player = state.getCurrentPlayer();
          const move = Move.create(
            Vector3.create(p, round, 0),
            player.id
          );
          state = state.applyMove(move);
        }
      }

      expect(state.moveHistory).toHaveLength(8);
      expect(state.getCurrentPlayer().id).toBe('player1'); // Back to first player
    });

    test('maintains consistency throughout', () => {
      let state = initialState;
      
      // Play a complex game with captures and near-wins
      const complexMoves = [
        // Setup capture scenario
        Move.create(Vector3.create(0, 0, 0), 'player1'),
        Move.create(Vector3.create(1, 0, 0), 'player2'),
        Move.create(Vector3.create(3, 0, 0), 'player1'),
        Move.create(Vector3.create(2, 0, 0), 'player2'),
        // Build towards win
        Move.create(Vector3.create(0, 1, 0), 'player1'),
        Move.create(Vector3.create(1, 1, 0), 'player2'),
        Move.create(Vector3.create(0, 2, 0), 'player1'),
        Move.create(Vector3.create(2, 1, 0), 'player2'),
      ];

      complexMoves.forEach((move, index) => {
        const prevPieceCount = state.board.getPieceCount();
        state = state.applyMove(move);
        
        // Verify consistency
        expect(state.moveHistory).toHaveLength(index + 1);
        expect(state.currentPlayerIndex).toBe((index + 1) % 2);
        
        // Piece count should increase unless captures occurred
        const captures = state.moveHistory[state.moveHistory.length - 1].capturedPositions;
        if (captures.length === 0) {
          expect(state.board.getPieceCount()).toBe(prevPieceCount + 1);
        } else {
          expect(state.board.getPieceCount()).toBe(prevPieceCount + 1 - captures.length);
        }
      });
    });

    test('tracks statistics correctly', () => {
      let state = initialState;
      
      // Track various statistics
      const stats = {
        movesPerPlayer: new Map<string, number>(),
        capturesPerPlayer: new Map<string, number>(),
        totalCaptures: 0,
      };

      // Initialize stats
      players.forEach(p => {
        stats.movesPerPlayer.set(p.id, 0);
        stats.capturesPerPlayer.set(p.id, 0);
      });

      // Play game and track stats
      for (let i = 0; i < 20; i++) {
        const player = state.getCurrentPlayer();
        const legalMoves = state.getLegalMoves();
        
        if (legalMoves.length === 0 || state.isGameOver) break;
        
        const move = Move.create(legalMoves[0], player.id);
        const newState = state.applyMove(move);
        
        // Update stats
        stats.movesPerPlayer.set(player.id, (stats.movesPerPlayer.get(player.id) || 0) + 1);
        
        const lastMove = newState.moveHistory[newState.moveHistory.length - 1];
        if (lastMove.capturedPositions.length > 0) {
          const captureCount = lastMove.capturedPositions.length / 2;
          stats.capturesPerPlayer.set(player.id, (stats.capturesPerPlayer.get(player.id) || 0) + captureCount);
          stats.totalCaptures += captureCount;
        }
        
        state = newState;
      }

      // Verify stats match game state
      let totalMoves = 0;
      stats.movesPerPlayer.forEach(count => totalMoves += count);
      expect(totalMoves).toBe(state.moveHistory.length);

      // Verify capture counts
      state.players.forEach(player => {
        expect(player.captureCount).toBe(stats.capturesPerPlayer.get(player.id) || 0);
      });
    });

    test('handles edge case positions', () => {
      let state = initialState;
      
      // Test all corner positions
      const corners = [
        Vector3.create(3, 3, 3),
        Vector3.create(3, 3, -3),
        Vector3.create(3, -3, 3),
        Vector3.create(3, -3, -3),
        Vector3.create(-3, 3, 3),
        Vector3.create(-3, 3, -3),
        Vector3.create(-3, -3, 3),
        Vector3.create(-3, -3, -3),
      ];

      corners.forEach((corner, index) => {
        if (state.isValidMove(Move.create(corner, state.getCurrentPlayer().id))) {
          state = state.applyMove(Move.create(corner, state.getCurrentPlayer().id));
          
          // Verify piece was placed correctly
          expect(state.board.getPieceAt(corner)).not.toBeNull();
        }
      });

      expect(state.board.getPieceCount()).toBeGreaterThan(0);
    });

    test('stress test with random moves', () => {
      let state = initialState;
      const maxMoves = 100;
      let moveCount = 0;

      while (moveCount < maxMoves && !state.isGameOver) {
        const legalMoves = state.getLegalMoves();
        if (legalMoves.length === 0) break;

        // Random move selection
        const randomIndex = Math.floor(Math.random() * legalMoves.length);
        const randomPos = legalMoves[randomIndex];
        const player = state.getCurrentPlayer();
        
        const move = Move.create(randomPos, player.id);
        state = state.applyMove(move);
        moveCount++;

        // Verify state consistency
        expect(state.moveHistory).toHaveLength(moveCount);
        expect(state.board.getPieceCount()).toBeLessThanOrEqual(moveCount);
      }

      // Game should have progressed significantly
      expect(moveCount).toBeGreaterThan(10);
    });

    test('performance: handles long games', () => {
      let state = initialState;
      const startTime = performance.now();
      const moveLimit = 200;

      for (let i = 0; i < moveLimit; i++) {
        const legalMoves = state.getLegalMoves();
        if (legalMoves.length === 0 || state.isGameOver) break;

        const move = Move.create(legalMoves[0], state.getCurrentPlayer().id);
        state = state.applyMove(move);
      }

      const endTime = performance.now();
      const totalTime = endTime - startTime;
      
      // Should handle 200 moves in reasonable time
      expect(totalTime).toBeLessThan(1000); // Less than 1 second
    });

    test('memory: no leaks in long games', () => {
      let state = initialState;
      const initialMemory = process.memoryUsage().heapUsed;

      // Play many moves
      for (let i = 0; i < 100; i++) {
        const legalMoves = state.getLegalMoves();
        if (legalMoves.length === 0 || state.isGameOver) break;

        const move = Move.create(legalMoves[0], state.getCurrentPlayer().id);
        state = state.applyMove(move);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;
      
      // Memory growth should be reasonable (less than 10MB for 100 moves)
      expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024);
    });
  });
});