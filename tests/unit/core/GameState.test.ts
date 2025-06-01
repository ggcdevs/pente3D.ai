import { GameState, Board, Player, Move, Vector3, WinResult } from '@/core';
import { createTestPlayers, createTestBoard, gameStates, applyMoveSequence } from '../../fixtures/game-states';

describe('GameState', () => {
  let board: Board;
  let players: Player[];
  let gameState: GameState;

  beforeEach(() => {
    board = createTestBoard(7);
    players = createTestPlayers();
    gameState = GameState.createInitialState(7, players);
  });

  describe('constructor and creation', () => {
    test('creates initial state with empty board', () => {
      expect(gameState.board.getPieceCount()).toBe(0);
      expect(gameState.board.size).toBe(7);
    });

    test('creates state with specified board size', () => {
      const state9 = GameState.createInitialState(9, players);
      expect(state9.board.size).toBe(9);
      
      const state11 = GameState.createInitialState(11, players);
      expect(state11.board.size).toBe(11);
    });

    test('initializes with provided players', () => {
      expect(gameState.players).toHaveLength(2);
      expect(gameState.players[0].id).toBe('player1');
      expect(gameState.players[1].id).toBe('player2');
    });

    test('sets first player as current', () => {
      expect(gameState.getCurrentPlayer()).toBe(players[0]);
      expect(gameState.currentPlayerIndex).toBe(0);
    });

    test('initializes empty move history', () => {
      expect(gameState.moveHistory).toHaveLength(0);
    });

    test('sets game as not over initially', () => {
      expect(gameState.isGameOver).toBe(false);
      expect(gameState.winResult).toBeNull();
    });

    test('has no win result initially', () => {
      expect(gameState.winResult).toBeNull();
    });

    test('validates minimum player count', () => {
      expect(() => new GameState(board, [players[0]])).toThrow('Game requires at least 2 players');
    });

    test('validates maximum player count', () => {
      const fivePlayers = [
        ...players,
        Player.createLocal('p3', 'red'),
        Player.createLocal('p4', 'blue'),
        Player.createLocal('p5', 'green')
      ];
      expect(() => new GameState(board, fivePlayers)).toThrow('Game supports maximum 4 players');
    });

    test('validates board size', () => {
      expect(() => GameState.createInitialState(8, players)).toThrow('Board size must be 7, 9, or 11');
    });

    test('creates immutable state', () => {
      const originalPlayers = [...gameState.players];
      const originalHistory = [...gameState.moveHistory];
      
      // Try to modify (should not affect original)
      gameState.players.push(Player.createLocal('p3', 'red'));
      gameState.moveHistory.push(Move.create(Vector3.create(0, 0, 0), 'player1'));
      
      expect(gameState.players).toHaveLength(2);
      expect(gameState.moveHistory).toHaveLength(0);
    });

    test('preserves player order', () => {
      const orderedPlayers = [
        Player.createLocal('alpha', 'white'),
        Player.createLocal('beta', 'black'),
        Player.createLocal('gamma', 'red')
      ];
      const state = new GameState(board, orderedPlayers);
      
      expect(state.players[0].id).toBe('alpha');
      expect(state.players[1].id).toBe('beta');
      expect(state.players[2].id).toBe('gamma');
    });

    test('handles custom starting positions', () => {
      const customBoard = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const state = new GameState(customBoard, players);
      
      expect(state.board.getPieceCount()).toBe(1);
      expect(state.board.getPieceAt(Vector3.create(0, 0, 0))?.playerId).toBe('player1');
    });

    test('factory method creates valid state', () => {
      const state = GameState.createInitialState(7, players);
      
      expect(state).toBeInstanceOf(GameState);
      expect(state.board).toBeInstanceOf(Board);
      expect(state.players).toHaveLength(2);
    });

    test('throws on invalid construction params', () => {
      expect(() => new GameState(board, players, [], -1)).toThrow('Invalid current player index');
      expect(() => new GameState(board, players, [], 5)).toThrow('Invalid current player index');
    });
  });

  describe('applyMove', () => {
    test('applies valid move successfully', () => {
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const newState = gameState.applyMove(move);
      
      expect(newState.board.getPieceAt(Vector3.create(0, 0, 0))?.playerId).toBe('player1');
    });

    test('returns new state instance', () => {
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const newState = gameState.applyMove(move);
      
      expect(newState).not.toBe(gameState);
      expect(newState).toBeInstanceOf(GameState);
    });

    test('preserves immutability of original', () => {
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const originalPieceCount = gameState.board.getPieceCount();
      
      gameState.applyMove(move);
      
      expect(gameState.board.getPieceCount()).toBe(originalPieceCount);
    });

    test('updates board with new piece', () => {
      const move = Move.create(Vector3.create(1, 2, 3), 'player1');
      const newState = gameState.applyMove(move);
      
      const piece = newState.board.getPieceAt(Vector3.create(1, 2, 3));
      expect(piece).not.toBeNull();
      expect(piece!.playerId).toBe('player1');
    });

    test('adds move to history', () => {
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const newState = gameState.applyMove(move);
      
      expect(newState.moveHistory).toHaveLength(1);
      expect(newState.moveHistory[0]).toEqual(move);
    });

    test('advances current player', () => {
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const newState = gameState.applyMove(move);
      
      expect(newState.getCurrentPlayer().id).toBe('player2');
      expect(newState.currentPlayerIndex).toBe(1);
    });

    test('detects and applies captures', () => {
      // Setup capture scenario
      let state = gameState
        .applyMove(Move.create(Vector3.create(0, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(1, 0, 0), 'player2'))
        .applyMove(Move.create(Vector3.create(4, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(2, 0, 0), 'player2'));
      
      // This move should capture
      const captureMove = Move.create(Vector3.create(3, 0, 0), 'player1');
      const newState = state.applyMove(captureMove);
      
      // Check captures occurred
      expect(newState.board.getPieceAt(Vector3.create(1, 0, 0))).toBeNull();
      expect(newState.board.getPieceAt(Vector3.create(2, 0, 0))).toBeNull();
    });

    test('updates player capture counts', () => {
      // Setup capture scenario
      let state = gameState
        .applyMove(Move.create(Vector3.create(0, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(1, 0, 0), 'player2'))
        .applyMove(Move.create(Vector3.create(4, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(2, 0, 0), 'player2'));
      
      const captureMove = Move.create(Vector3.create(3, 0, 0), 'player1');
      const newState = state.applyMove(captureMove);
      
      const player1 = newState.players.find(p => p.id === 'player1')!;
      expect(player1.captureCount).toBe(1); // 2 pieces = 1 pair
    });

    test('detects win conditions', () => {
      // Setup near-win scenario
      let state = gameState;
      for (let i = 0; i < 4; i++) {
        state = state
          .applyMove(Move.create(Vector3.create(i, 0, 0), 'player1'))
          .applyMove(Move.create(Vector3.create(i, 1, 0), 'player2'));
      }
      
      // Winning move
      const winMove = Move.create(Vector3.create(4, 0, 0), 'player1');
      const winState = state.applyMove(winMove);
      
      expect(winState.isGameOver).toBe(true);
      expect(winState.winResult).not.toBeNull();
      expect(winState.winResult!.winner.id).toBe('player1');
    });

    test('sets game over on win', () => {
      // Create a winning position
      let state = gameState;
      for (let i = 0; i < 4; i++) {
        state = state
          .applyMove(Move.create(Vector3.create(i, 0, 0), 'player1'))
          .applyMove(Move.create(Vector3.create(i, 1, 0), 'player2'));
      }
      
      const winMove = Move.create(Vector3.create(4, 0, 0), 'player1');
      const winState = state.applyMove(winMove);
      
      expect(winState.isGameOver).toBe(true);
    });

    test('sets win result correctly', () => {
      // Win by captures
      let state = gameState;
      const player1 = state.players[0].addCaptures(4);
      state = new GameState(state.board, [player1, state.players[1]], state.moveHistory);
      
      // One more capture to win
      state = state
        .applyMove(Move.create(Vector3.create(0, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(1, 0, 0), 'player2'))
        .applyMove(Move.create(Vector3.create(4, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(2, 0, 0), 'player2'));
      
      const winMove = Move.create(Vector3.create(3, 0, 0), 'player1');
      const winState = state.applyMove(winMove);
      
      expect(winState.winResult).not.toBeNull();
      expect(winState.winResult!.type).toBe('captures');
    });

    test('throws on invalid move', () => {
      const invalidMove = Move.create(Vector3.create(10, 10, 10), 'player1');
      expect(() => gameState.applyMove(invalidMove)).toThrow('Invalid move');
    });

    test('throws on game already over', () => {
      const winResult = new WinResult(players[0], 'five-in-a-row');
      const finishedGame = new GameState(board, players, [], 0, winResult);
      
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      expect(() => finishedGame.applyMove(move)).toThrow('Cannot make moves after game is over');
    });

    test('validates move coordinates', () => {
      const outOfBoundsMove = Move.create(Vector3.create(5, 5, 5), 'player1');
      expect(() => gameState.applyMove(outOfBoundsMove)).toThrow('Invalid move');
    });

    test('validates current player', () => {
      const wrongPlayerMove = Move.create(Vector3.create(0, 0, 0), 'player2');
      expect(() => gameState.applyMove(wrongPlayerMove)).toThrow('Invalid move');
    });

    test('handles capture at board edge', () => {
      let state = gameState
        .applyMove(Move.create(Vector3.create(3, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(2, 0, 0), 'player2'))
        .applyMove(Move.create(Vector3.create(-3, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(1, 0, 0), 'player2'));
      
      const captureMove = Move.create(Vector3.create(0, 0, 0), 'player1');
      const newState = state.applyMove(captureMove);
      
      expect(newState.board.getPieceAt(Vector3.create(1, 0, 0))).toBeNull();
      expect(newState.board.getPieceAt(Vector3.create(2, 0, 0))).toBeNull();
    });

    test('handles multiple captures', () => {
      // Setup multiple capture scenario
      let state = gameState
        // X-axis capture setup
        .applyMove(Move.create(Vector3.create(0, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(1, 0, 0), 'player2'))
        .applyMove(Move.create(Vector3.create(4, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(2, 0, 0), 'player2'))
        // Y-axis capture setup
        .applyMove(Move.create(Vector3.create(0, 1, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(3, 1, 0), 'player2'))
        .applyMove(Move.create(Vector3.create(0, 4, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(3, 2, 0), 'player2'));
      
      // Place piece that captures in both directions
      state = state.applyMove(Move.create(Vector3.create(3, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(-1, -1, 0), 'player2')); // Dummy move
      
      const multiCaptureMove = Move.create(Vector3.create(3, 3, 0), 'player1');
      const newState = state.applyMove(multiCaptureMove);
      
      // Check both captures occurred
      expect(newState.board.getPieceAt(Vector3.create(3, 1, 0))).toBeNull();
      expect(newState.board.getPieceAt(Vector3.create(3, 2, 0))).toBeNull();
    });

    test('maintains state consistency', () => {
      let state = gameState;
      
      // Apply several moves
      for (let i = 0; i < 10; i++) {
        const player = state.getCurrentPlayer();
        const move = Move.create(Vector3.create(i % 3, Math.floor(i / 3), 0), player.id);
        state = state.applyMove(move);
        
        // Verify consistency
        expect(state.moveHistory).toHaveLength(i + 1);
        expect(state.board.getPieceCount()).toBe(i + 1);
        expect(state.currentPlayerIndex).toBe((i + 1) % 2);
      }
    });

    test('preserves move timestamps', () => {
      const timestamp = Date.now();
      const move = Move.create(Vector3.create(0, 0, 0), 'player1', [], timestamp);
      const newState = gameState.applyMove(move);
      
      expect(newState.moveHistory[0].timestamp).toBe(timestamp);
    });

    test('performance: applies move quickly', () => {
      const start = performance.now();
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      gameState.applyMove(move);
      const end = performance.now();
      
      expect(end - start).toBeLessThan(5); // Should be under 5ms
    });
  });

  describe('state queries', () => {
    test('getCurrentPlayer returns correct player', () => {
      expect(gameState.getCurrentPlayer()).toBe(players[0]);
      
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const newState = gameState.applyMove(move);
      expect(newState.getCurrentPlayer()).toBe(players[1]);
    });

    test('isValidMove checks all rules', () => {
      const validMove = Move.create(Vector3.create(0, 0, 0), 'player1');
      expect(gameState.isValidMove(validMove)).toBe(true);
      
      const invalidMove = Move.create(Vector3.create(0, 0, 0), 'player2');
      expect(gameState.isValidMove(invalidMove)).toBe(false);
    });

    test('correctly reports game over state', () => {
      expect(gameState.isGameOver).toBe(false);
      
      const winResult = new WinResult(players[0], 'five-in-a-row');
      const finishedGame = new GameState(board, players, [], 0, winResult);
      expect(finishedGame.isGameOver).toBe(true);
    });

    test('provides access to move history', () => {
      let state = gameState;
      const moves: Move[] = [];
      
      for (let i = 0; i < 5; i++) {
        const player = state.getCurrentPlayer();
        const move = Move.create(Vector3.create(i, 0, 0), player.id);
        moves.push(move);
        state = state.applyMove(move);
      }
      
      expect(state.moveHistory).toHaveLength(5);
      moves.forEach((move, i) => {
        expect(state.moveHistory[i]).toEqual(move);
      });
    });

    test('provides current board state', () => {
      const move = Move.create(Vector3.create(1, 2, 3), 'player1');
      const newState = gameState.applyMove(move);
      
      expect(newState.board.getPieceAt(Vector3.create(1, 2, 3))).not.toBeNull();
      expect(newState.board.getPieceCount()).toBe(1);
    });

    test('tracks player statistics', () => {
      // Create state with captures
      const player1WithCaptures = players[0].addCaptures(3);
      const stateWithCaptures = new GameState(
        board,
        [player1WithCaptures, players[1]],
        []
      );
      
      expect(stateWithCaptures.players[0].captureCount).toBe(3);
    });

    test('calculates legal moves', () => {
      const legalMoves = gameState.getLegalMoves();
      
      expect(legalMoves.length).toBeGreaterThan(0);
      expect(legalMoves.length).toBe(7 * 7 * 7); // All positions on empty 7x7x7 board
    });

    test('identifies check/threat positions', () => {
      // Setup near-win
      let state = gameState;
      for (let i = 0; i < 4; i++) {
        state = state
          .applyMove(Move.create(Vector3.create(i, 0, 0), 'player1'))
          .applyMove(Move.create(Vector3.create(i, 1, 0), 'player2'));
      }
      
      // Position [4, 0, 0] is a winning threat
      const legalMoves = state.getLegalMoves();
      expect(legalMoves.some(pos => pos.equals(Vector3.create(4, 0, 0)))).toBe(true);
    });

    test('provides undo capability', () => {
      let state = gameState
        .applyMove(Move.create(Vector3.create(0, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(1, 0, 0), 'player2'));
      
      const undoneState = state.undoLastMove();
      
      expect(undoneState).not.toBeNull();
      expect(undoneState!.moveHistory).toHaveLength(1);
      expect(undoneState!.getCurrentPlayer().id).toBe('player2');
    });

    test('supports state analysis', () => {
      // The state object provides all necessary information for analysis
      expect(gameState.board).toBeDefined();
      expect(gameState.players).toBeDefined();
      expect(gameState.moveHistory).toBeDefined();
      expect(gameState.currentPlayerIndex).toBeDefined();
      expect(gameState.winResult).toBeDefined();
    });
  });

  describe('generateHash', () => {
    test('generates consistent hash for same state', () => {
      const hash1 = gameState.generateHash();
      const hash2 = gameState.generateHash();
      
      expect(hash1).toBe(hash2);
    });

    test('generates different hash for different boards', () => {
      const hash1 = gameState.generateHash();
      
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const newState = gameState.applyMove(move);
      const hash2 = newState.generateHash();
      
      expect(hash1).not.toBe(hash2);
    });

    test('includes player state in hash', () => {
      const hash1 = gameState.generateHash();
      
      const playerWithCaptures = players[0].addCaptures(1);
      const stateWithCaptures = new GameState(
        board,
        [playerWithCaptures, players[1]],
        []
      );
      const hash2 = stateWithCaptures.generateHash();
      
      expect(hash1).not.toBe(hash2);
    });

    test('includes move history in hash', () => {
      const hash1 = gameState.generateHash();
      
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const stateWithHistory = new GameState(board, players, [move]);
      const hash2 = stateWithHistory.generateHash();
      
      expect(hash1).not.toBe(hash2);
    });

    test('includes current player in hash', () => {
      const state1 = new GameState(board, players, [], 0);
      const state2 = new GameState(board, players, [], 1);
      
      expect(state1.generateHash()).not.toBe(state2.generateHash());
    });

    test('handles empty board state', () => {
      const hash = gameState.generateHash();
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
    });

    test('handles full board state', () => {
      let state = gameState;
      
      // Fill board partially
      for (let i = 0; i < 20; i++) {
        const player = state.getCurrentPlayer();
        const x = i % 3;
        const y = Math.floor(i / 3) % 3;
        const z = Math.floor(i / 9);
        const move = Move.create(Vector3.create(x, y, z), player.id);
        
        if (state.isValidMove(move)) {
          state = state.applyMove(move);
        }
      }
      
      const hash = state.generateHash();
      expect(hash).toBeTruthy();
    });

    test('is deterministic across runs', () => {
      const state1 = GameState.createInitialState(7, players);
      const state2 = GameState.createInitialState(7, players);
      
      expect(state1.generateHash()).toBe(state2.generateHash());
    });

    test('is unique for different positions', () => {
      const hashes = new Set<string>();
      let state = gameState;
      
      for (let i = 0; i < 10; i++) {
        hashes.add(state.generateHash());
        const player = state.getCurrentPlayer();
        const move = Move.create(Vector3.create(i % 3, Math.floor(i / 3), 0), player.id);
        if (state.isValidMove(move)) {
          state = state.applyMove(move);
        }
      }
      
      expect(hashes.size).toBeGreaterThan(5); // Should have multiple unique hashes
    });

    test('is unique for different capture counts', () => {
      const state1 = gameState;
      const player1WithCaptures = players[0].addCaptures(1);
      const state2 = new GameState(board, [player1WithCaptures, players[1]], []);
      
      expect(state1.generateHash()).not.toBe(state2.generateHash());
    });

    test('handles hash collisions gracefully', () => {
      // Create many states and check for uniqueness
      const hashes = new Set<string>();
      
      for (let i = 0; i < 50; i++) {
        const move = Move.create(Vector3.create(i % 7, Math.floor(i / 7) % 7, 0), 'player1');
        const state = new GameState(board, players, [move]);
        hashes.add(state.generateHash());
      }
      
      // Should have mostly unique hashes (some collisions acceptable)
      expect(hashes.size).toBeGreaterThan(40);
    });

    test('performance: generates hash quickly', () => {
      const start = performance.now();
      gameState.generateHash();
      const end = performance.now();
      
      expect(end - start).toBeLessThan(10); // Should be under 10ms
    });

    test('works with all board sizes', () => {
      const sizes = [7, 9, 11] as const;
      const hashes = new Set<string>();
      
      sizes.forEach(size => {
        const state = GameState.createInitialState(size, players);
        hashes.add(state.generateHash());
      });
      
      expect(hashes.size).toBe(3); // Different sizes should have different hashes
    });

    test('maintains hash after serialization', () => {
      const originalHash = gameState.generateHash();
      const json = gameState.toJSON();
      const reconstructed = GameState.fromJSON(json);
      
      expect(reconstructed.generateHash()).toBe(originalHash);
    });

    test('validates hash format', () => {
      const hash = gameState.generateHash();
      
      expect(hash).toMatch(/^-?[0-9a-f]+$/); // Hexadecimal format
      expect(hash.length).toBeGreaterThan(0);
    });
  });

  describe('equals and clone', () => {
    test('equals returns true for identical states', () => {
      const state1 = GameState.createInitialState(7, players);
      const state2 = GameState.createInitialState(7, players);
      
      expect(state1.equals(state2)).toBe(true);
    });

    test('equals returns false for different boards', () => {
      const state1 = gameState;
      const state2 = gameState.applyMove(Move.create(Vector3.create(0, 0, 0), 'player1'));
      
      expect(state1.equals(state2)).toBe(false);
    });

    test('equals returns false for different players', () => {
      const state1 = gameState;
      const differentPlayers = [
        Player.createLocal('alice', 'white'),
        Player.createLocal('bob', 'black')
      ];
      const state2 = new GameState(board, differentPlayers);
      
      expect(state1.equals(state2)).toBe(false);
    });

    test('equals returns false for different history', () => {
      const state1 = gameState;
      const state2 = new GameState(board, players, [
        Move.create(Vector3.create(0, 0, 0), 'player1')
      ]);
      
      expect(state1.equals(state2)).toBe(false);
    });

    test('equals handles null/undefined', () => {
      expect(gameState.equals(null)).toBe(false);
      expect(gameState.equals(undefined)).toBe(false);
    });

    test('clone creates identical copy', () => {
      const clone = gameState.clone();
      
      expect(clone.equals(gameState)).toBe(true);
      expect(clone).not.toBe(gameState);
    });

    test('clone preserves all properties', () => {
      let state = gameState
        .applyMove(Move.create(Vector3.create(0, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(1, 0, 0), 'player2'));
      
      const clone = state.clone();
      
      expect(clone.board.getPieceCount()).toBe(state.board.getPieceCount());
      expect(clone.players).toHaveLength(state.players.length);
      expect(clone.moveHistory).toHaveLength(state.moveHistory.length);
      expect(clone.currentPlayerIndex).toBe(state.currentPlayerIndex);
    });

    test('clone creates independent instance', () => {
      const clone = gameState.clone();
      
      // Modify clone
      const newClone = clone.applyMove(Move.create(Vector3.create(0, 0, 0), 'player1'));
      
      // Original should be unchanged
      expect(gameState.board.getPieceCount()).toBe(0);
      expect(newClone.board.getPieceCount()).toBe(1);
    });

    test('clone maintains immutability', () => {
      const clone = gameState.clone();
      
      // Try to modify clone's arrays (should not affect original)
      clone.players.push(Player.createLocal('p3', 'red'));
      clone.moveHistory.push(Move.create(Vector3.create(0, 0, 0), 'player1'));
      
      expect(gameState.players).toHaveLength(2);
      expect(gameState.moveHistory).toHaveLength(0);
    });

    test('performance: clones efficiently', () => {
      // Create complex state
      let state = gameState;
      for (let i = 0; i < 20; i++) {
        const player = state.getCurrentPlayer();
        const move = Move.create(Vector3.create(i % 3, Math.floor(i / 3) % 3, 0), player.id);
        if (state.isValidMove(move)) {
          state = state.applyMove(move);
        }
      }
      
      const start = performance.now();
      state.clone();
      const end = performance.now();
      
      expect(end - start).toBeLessThan(5); // Should be under 5ms
    });
  });

  describe('JSON serialization', () => {
    test('serializes all state properties', () => {
      const json = gameState.toJSON();
      
      expect(json).toHaveProperty('board');
      expect(json).toHaveProperty('players');
      expect(json).toHaveProperty('moveHistory');
      expect(json).toHaveProperty('currentPlayerIndex');
      expect(json).toHaveProperty('winResult');
      expect(json).toHaveProperty('isGameOver');
    });

    test('deserializes to identical state', () => {
      const json = gameState.toJSON();
      const reconstructed = GameState.fromJSON(json);
      
      expect(reconstructed.equals(gameState)).toBe(true);
    });

    test('handles empty game state', () => {
      const json = gameState.toJSON();
      const reconstructed = GameState.fromJSON(json);
      
      expect(reconstructed.board.getPieceCount()).toBe(0);
      expect(reconstructed.moveHistory).toHaveLength(0);
    });

    test('handles complex game state', () => {
      // Create complex state
      let state = gameState;
      for (let i = 0; i < 10; i++) {
        const player = state.getCurrentPlayer();
        const move = Move.create(Vector3.create(i % 3, Math.floor(i / 3), 0), player.id);
        if (state.isValidMove(move)) {
          state = state.applyMove(move);
        }
      }
      
      const json = state.toJSON();
      const reconstructed = GameState.fromJSON(json);
      
      expect(reconstructed.equals(state)).toBe(true);
    });

    test('preserves move history', () => {
      let state = gameState
        .applyMove(Move.create(Vector3.create(0, 0, 0), 'player1'))
        .applyMove(Move.create(Vector3.create(1, 0, 0), 'player2'));
      
      const json = state.toJSON();
      const reconstructed = GameState.fromJSON(json);
      
      expect(reconstructed.moveHistory).toHaveLength(2);
      expect(reconstructed.moveHistory[0].position.equals(Vector3.create(0, 0, 0))).toBe(true);
    });

    test('preserves player statistics', () => {
      const playerWithCaptures = players[0].addCaptures(3);
      const state = new GameState(board, [playerWithCaptures, players[1]]);
      
      const json = state.toJSON();
      const reconstructed = GameState.fromJSON(json);
      
      expect(reconstructed.players[0].captureCount).toBe(3);
    });

    test('preserves win conditions', () => {
      const winResult = new WinResult(players[0], 'five-in-a-row');
      const state = new GameState(board, players, [], 0, winResult);
      
      const json = state.toJSON();
      const reconstructed = GameState.fromJSON(json);
      
      expect(reconstructed.isGameOver).toBe(true);
      expect(reconstructed.winResult).not.toBeNull();
      expect(reconstructed.winResult!.type).toBe('five-in-a-row');
    });

    test('validates JSON structure', () => {
      expect(() => GameState.fromJSON(null)).toThrow('Invalid JSON for GameState');
      expect(() => GameState.fromJSON('string')).toThrow('Invalid JSON for GameState');
      expect(() => GameState.fromJSON(123)).toThrow('Invalid JSON for GameState');
    });

    test('handles malformed JSON gracefully', () => {
      const badJson = { board: null, players: [] };
      expect(() => GameState.fromJSON(badJson)).toThrow();
    });

    test('round-trip maintains equality', () => {
      let state = gameState;
      
      // Make some moves
      for (let i = 0; i < 5; i++) {
        const player = state.getCurrentPlayer();
        const move = Move.create(Vector3.create(i, 0, 0), player.id);
        state = state.applyMove(move);
      }
      
      const json = state.toJSON();
      const reconstructed = GameState.fromJSON(json);
      const json2 = reconstructed.toJSON();
      
      expect(JSON.stringify(json)).toBe(JSON.stringify(json2));
    });
  });
});