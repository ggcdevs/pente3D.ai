import { GameRules, Board, Move, Player, Vector3, Line, WinResult, Piece } from '@/core';
import { createTestPlayers, createTestBoard, gameStates } from '../../fixtures/game-states';

describe('GameRules', () => {
  let board: Board;
  let players: Player[];
  let currentPlayer: Player;
  let moveHistory: Move[];

  beforeEach(() => {
    board = createTestBoard(7);
    players = createTestPlayers();
    currentPlayer = players[0];
    moveHistory = [];
  });

  describe('isValidMove', () => {
    test('accepts valid move on empty position', () => {
      const move = Move.create(Vector3.create(0, 0, 0), currentPlayer.id);
      expect(GameRules.isValidMove(board, move, currentPlayer, moveHistory)).toBe(true);
    });

    test('rejects move on occupied position', () => {
      board = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), currentPlayer.id);
      expect(GameRules.isValidMove(board, move, currentPlayer, moveHistory)).toBe(false);
    });

    test('rejects move outside board bounds', () => {
      const move = Move.create(Vector3.create(10, 0, 0), currentPlayer.id);
      expect(GameRules.isValidMove(board, move, currentPlayer, moveHistory)).toBe(false);
    });

    test('rejects move with wrong player turn', () => {
      const move = Move.create(Vector3.create(0, 0, 0), 'player2');
      expect(GameRules.isValidMove(board, move, currentPlayer, moveHistory)).toBe(false);
    });

    test('accepts first move from first player', () => {
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      expect(GameRules.isValidMove(board, move, players[0], [])).toBe(true);
    });

    test('enforces alternating turns', () => {
      moveHistory = [Move.create(Vector3.create(0, 0, 0), 'player1')];
      const move = Move.create(Vector3.create(1, 0, 0), 'player2');
      expect(GameRules.isValidMove(board, move, players[1], moveHistory)).toBe(true);
    });

    test('rejects move with mismatched player ID', () => {
      const move = Move.create(Vector3.create(0, 0, 0), 'wrongPlayer');
      expect(GameRules.isValidMove(board, move, currentPlayer, moveHistory)).toBe(false);
    });

    test('handles empty move history', () => {
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      expect(GameRules.isValidMove(board, move, players[0], [])).toBe(true);
    });

    test('validates moves at board edges', () => {
      const move = Move.create(Vector3.create(3, 3, 3), currentPlayer.id);
      expect(GameRules.isValidMove(board, move, currentPlayer, moveHistory)).toBe(true);
    });

    test('validates moves at board corners', () => {
      const move = Move.create(Vector3.create(-3, -3, -3), currentPlayer.id);
      expect(GameRules.isValidMove(board, move, currentPlayer, moveHistory)).toBe(true);
    });

    test('rejects negative coordinates beyond bounds', () => {
      const move = Move.create(Vector3.create(-5, 0, 0), currentPlayer.id);
      expect(GameRules.isValidMove(board, move, currentPlayer, moveHistory)).toBe(false);
    });

    test('rejects coordinates beyond board size', () => {
      const move = Move.create(Vector3.create(4, 4, 4), currentPlayer.id);
      expect(GameRules.isValidMove(board, move, currentPlayer, moveHistory)).toBe(false);
    });

    test('accepts move after captures', () => {
      moveHistory = [
        Move.create(Vector3.create(0, 0, 0), 'player1', [Vector3.create(1, 0, 0), Vector3.create(2, 0, 0)])
      ];
      const move = Move.create(Vector3.create(1, 1, 0), 'player2');
      expect(GameRules.isValidMove(board, move, players[1], moveHistory)).toBe(true);
    });

    test('maintains turn order after captures', () => {
      board = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      moveHistory = [
        Move.create(Vector3.create(0, 0, 0), 'player1', [Vector3.create(1, 0, 0), Vector3.create(2, 0, 0)])
      ];
      const move = Move.create(Vector3.create(1, 0, 0), 'player2');
      expect(GameRules.isValidMove(board, move, players[1], moveHistory)).toBe(true);
    });

    test('handles null/undefined inputs gracefully', () => {
      expect(GameRules.isValidMove(board, null as any, currentPlayer, moveHistory)).toBe(false);
    });
  });

  describe('detectCaptures', () => {
    test('detects horizontal capture (positive X)', () => {
      // Setup: place opponent pieces and the closing piece (but NOT the capturing piece)
      board = board
        .placePieceByPlayer(Vector3.create(1, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(2, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(3, 0, 0), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(2);
      expect(captures).toContainEqual(Vector3.create(1, 0, 0));
      expect(captures).toContainEqual(Vector3.create(2, 0, 0));
    });

    test('detects horizontal capture (negative X)', () => {
      // Setup: place opponent pieces and the closing piece (but NOT the capturing piece)
      board = board
        .placePieceByPlayer(Vector3.create(-1, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(-2, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(-3, 0, 0), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(2);
      expect(captures).toContainEqual(Vector3.create(-1, 0, 0));
      expect(captures).toContainEqual(Vector3.create(-2, 0, 0));
    });

    test('detects vertical capture (positive Y)', () => {
      // Setup: place opponent pieces and the closing piece (but NOT the capturing piece)
      board = board
        .placePieceByPlayer(Vector3.create(0, 1, 0), 'player2')
        .placePieceByPlayer(Vector3.create(0, 2, 0), 'player2')
        .placePieceByPlayer(Vector3.create(0, 3, 0), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(2);
    });

    test('detects vertical capture (negative Y)', () => {
      // Setup: place opponent pieces and the closing piece (but NOT the capturing piece)
      board = board
        .placePieceByPlayer(Vector3.create(0, -1, 0), 'player2')
        .placePieceByPlayer(Vector3.create(0, -2, 0), 'player2')
        .placePieceByPlayer(Vector3.create(0, -3, 0), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(2);
    });

    test('detects depth capture (positive Z)', () => {
      // Setup: place opponent pieces and the closing piece (but NOT the capturing piece)
      board = board
        .placePieceByPlayer(Vector3.create(0, 0, 1), 'player2')
        .placePieceByPlayer(Vector3.create(0, 0, 2), 'player2')
        .placePieceByPlayer(Vector3.create(0, 0, 3), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(2);
    });

    test('detects depth capture (negative Z)', () => {
      // Setup: place opponent pieces and the closing piece (but NOT the capturing piece)
      board = board
        .placePieceByPlayer(Vector3.create(0, 0, -1), 'player2')
        .placePieceByPlayer(Vector3.create(0, 0, -2), 'player2')
        .placePieceByPlayer(Vector3.create(0, 0, -3), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(2);
    });

    test('detects diagonal capture (XY plane)', () => {
      // Setup: place opponent pieces and the closing piece (but NOT the capturing piece)
      board = board
        .placePieceByPlayer(Vector3.create(1, 1, 0), 'player2')
        .placePieceByPlayer(Vector3.create(2, 2, 0), 'player2')
        .placePieceByPlayer(Vector3.create(3, 3, 0), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(2);
    });

    test('detects diagonal capture (XZ plane)', () => {
      // Setup: place opponent pieces and the closing piece (but NOT the capturing piece)
      board = board
        .placePieceByPlayer(Vector3.create(1, 0, 1), 'player2')
        .placePieceByPlayer(Vector3.create(2, 0, 2), 'player2')
        .placePieceByPlayer(Vector3.create(3, 0, 3), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(2);
    });

    test('detects diagonal capture (YZ plane)', () => {
      // Setup: place opponent pieces and the closing piece (but NOT the capturing piece)
      board = board
        .placePieceByPlayer(Vector3.create(0, 1, 1), 'player2')
        .placePieceByPlayer(Vector3.create(0, 2, 2), 'player2')
        .placePieceByPlayer(Vector3.create(0, 3, 3), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(2);
    });

    test('detects 3D diagonal capture (all positive)', () => {
      // Setup: place opponent pieces and the closing piece (but NOT the capturing piece)
      board = board
        .placePieceByPlayer(Vector3.create(1, 1, 1), 'player2')
        .placePieceByPlayer(Vector3.create(2, 2, 2), 'player2')
        .placePieceByPlayer(Vector3.create(3, 3, 3), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(2);
    });

    test('detects 3D diagonal capture (mixed signs)', () => {
      // Setup: place opponent pieces and the closing piece (but NOT the capturing piece)
      board = board
        .placePieceByPlayer(Vector3.create(1, -1, 1), 'player2')
        .placePieceByPlayer(Vector3.create(2, -2, 2), 'player2')
        .placePieceByPlayer(Vector3.create(3, -3, 3), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(2);
    });

    test('detects multiple captures in one move', () => {
      // Setup captures in two directions (but NOT the capturing piece)
      board = board
        // X direction capture
        .placePieceByPlayer(Vector3.create(1, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(2, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(3, 0, 0), 'player1')
        // Y direction capture
        .placePieceByPlayer(Vector3.create(0, 1, 0), 'player2')
        .placePieceByPlayer(Vector3.create(0, 2, 0), 'player2')
        .placePieceByPlayer(Vector3.create(0, 3, 0), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(4);
    });

    test('detects captures at board edges', () => {
      // Setup: place opponent pieces and the closing piece (but NOT the capturing piece)
      board = board
        .placePieceByPlayer(Vector3.create(2, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(1, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(3, 0, 0), 'player1');
      const move = Move.create(Vector3.create(3, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(2);
    });

    test('detects captures at board corners', () => {
      // Setup: place opponent pieces and the closing piece (but NOT the capturing piece)
      board = board
        .placePieceByPlayer(Vector3.create(2, 2, 2), 'player2')
        .placePieceByPlayer(Vector3.create(1, 1, 1), 'player2')
        .placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(3, 3, 3), 'player1');
      const move = Move.create(Vector3.create(3, 3, 3), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(2);
    });

    test('does not detect incomplete patterns', () => {
      // Setup: place opponent pieces but missing the closing piece
      board = board
        .placePieceByPlayer(Vector3.create(1, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(2, 0, 0), 'player2');
      // Missing the closing player1 piece at (3, 0, 0)
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(0);
    });

    test('does not detect wrong player patterns', () => {
      // Setup: place pieces with wrong player in middle
      board = board
        .placePieceByPlayer(Vector3.create(1, 0, 0), 'player1') // Wrong player
        .placePieceByPlayer(Vector3.create(2, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(3, 0, 0), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(0);
    });

    test('does not detect patterns with gaps', () => {
      // Setup: place pieces with gap
      board = board
        .placePieceByPlayer(Vector3.create(1, 0, 0), 'player2')
        // Gap at (2, 0, 0)
        .placePieceByPlayer(Vector3.create(3, 0, 0), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(0);
    });

    test('handles capturing temporary pieces', () => {
      // Setup: place temporary piece and other pieces (but NOT the capturing piece)
      const player2 = Player.createLocal('player2', 'black');
      const tempPiece = Piece.createTemporary(Vector3.create(1, 0, 0), player2);
      board = board
        .placePiece(tempPiece)
        .placePieceByPlayer(Vector3.create(2, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(3, 0, 0), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(2);
    });

    test('captures all normal pieces in pattern', () => {
      // Setup: place normal pieces (but NOT the capturing piece)
      const player2 = Player.createLocal('player2', 'black');
      const normalPiece = Piece.createNormal(Vector3.create(1, 0, 0), player2);
      board = board
        .placePiece(normalPiece)
        .placePieceByPlayer(Vector3.create(2, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(3, 0, 0), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      // Normal pieces should be capturable
      expect(captures).toHaveLength(2);
    });

    test('detects up to 8 captures from one move', () => {
      // This is theoretical maximum - captures in 8 directions
      // For simplicity, we'll test 4 captures
      // Setup: place pieces for captures in two directions (but NOT the capturing piece)
      board = board
        // X+ capture
        .placePieceByPlayer(Vector3.create(1, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(2, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(3, 0, 0), 'player1')
        // X- capture
        .placePieceByPlayer(Vector3.create(-1, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(-2, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(-3, 0, 0), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(4);
    });

    test('returns empty array when no captures', () => {
      // Create new board with only the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(0);
    });

    test('validates capture positions are in bounds', () => {
      // Edge case where capture pattern extends outside board
      // Setup: place opponent pieces (but NOT the capturing piece)
      board = board
        .placePieceByPlayer(Vector3.create(-2, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(-1, 0, 0), 'player2');
      // Position at (0, 0, 0) would complete capture, but (-4, 0, 0) is out of bounds
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(-3, 0, 0), 'player1');
      const move = Move.create(Vector3.create(-3, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures).toHaveLength(0);
    });

    test('handles captures near board boundaries', () => {
      // Setup: place opponent pieces and closing piece (but NOT the capturing piece)
      board = board
        .placePieceByPlayer(Vector3.create(2, 3, 0), 'player2')
        .placePieceByPlayer(Vector3.create(3, 3, 0), 'player2')
        .placePieceByPlayer(Vector3.create(-3, 3, 0), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(1, 3, 0), 'player1');
      const move = Move.create(Vector3.create(1, 3, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      expect(captures.some(c => c.equals(Vector3.create(2, 3, 0)))).toBe(true);
    });

    test('correctly identifies capturable pieces', () => {
      // Setup: place opponent pieces and closing piece (but NOT the capturing piece)
      board = board
        .placePieceByPlayer(Vector3.create(1, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(2, 0, 0), 'player2')
        .placePieceByPlayer(Vector3.create(3, 0, 0), 'player1');
      
      // Create new board with the capturing piece placed
      const boardWithMove = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1');
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      const captures = GameRules.detectCaptures(boardWithMove, move);
      
      captures.forEach(pos => {
        const piece = boardWithMove.getPieceAt(pos);
        expect(piece).not.toBeNull();
        expect(piece!.playerId).toBe('player2');
      });
    });

    test('performance: processes captures quickly', () => {
      // Fill board with many pieces
      for (let x = -2; x <= 2; x++) {
        for (let y = -2; y <= 2; y++) {
          const playerId = (x + y) % 2 === 0 ? 'player1' : 'player2';
          board = board.placePieceByPlayer(Vector3.create(x, y, 0), playerId);
        }
      }
      
      const start = performance.now();
      const move = Move.create(Vector3.create(0, 0, 0), 'player1');
      GameRules.detectCaptures(board, move);
      const end = performance.now();
      
      expect(end - start).toBeLessThan(2); // Should be under 2ms
    });
  });

  describe('checkFiveInARow', () => {
    test('detects horizontal win (X axis)', () => {
      for (let i = -2; i <= 2; i++) {
        board = board.placePieceByPlayer(Vector3.create(i, 0, 0), 'player1');
      }
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).not.toBeNull();
      expect(line!.positions).toHaveLength(5);
    });

    test('detects vertical win (Y axis)', () => {
      for (let i = -2; i <= 2; i++) {
        board = board.placePieceByPlayer(Vector3.create(0, i, 0), 'player1');
      }
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).not.toBeNull();
      expect(line!.positions).toHaveLength(5);
    });

    test('detects depth win (Z axis)', () => {
      for (let i = -2; i <= 2; i++) {
        board = board.placePieceByPlayer(Vector3.create(0, 0, i), 'player1');
      }
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).not.toBeNull();
      expect(line!.positions).toHaveLength(5);
    });

    test('detects diagonal win in XY plane', () => {
      for (let i = -2; i <= 2; i++) {
        board = board.placePieceByPlayer(Vector3.create(i, i, 0), 'player1');
      }
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).not.toBeNull();
      expect(line!.positions).toHaveLength(5);
    });

    test('detects diagonal win in XZ plane', () => {
      for (let i = -2; i <= 2; i++) {
        board = board.placePieceByPlayer(Vector3.create(i, 0, i), 'player1');
      }
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).not.toBeNull();
      expect(line!.positions).toHaveLength(5);
    });

    test('detects diagonal win in YZ plane', () => {
      for (let i = -2; i <= 2; i++) {
        board = board.placePieceByPlayer(Vector3.create(0, i, i), 'player1');
      }
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).not.toBeNull();
      expect(line!.positions).toHaveLength(5);
    });

    test('detects 3D diagonal win', () => {
      for (let i = -2; i <= 2; i++) {
        board = board.placePieceByPlayer(Vector3.create(i, i, i), 'player1');
      }
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).not.toBeNull();
      expect(line!.positions).toHaveLength(5);
    });

    test('detects exactly 5 in a row', () => {
      for (let i = -2; i <= 2; i++) {
        board = board.placePieceByPlayer(Vector3.create(i, 0, 0), 'player1');
      }
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).not.toBeNull();
      expect(line!.positions).toHaveLength(5);
    });

    test('detects more than 5 in a row', () => {
      for (let i = -3; i <= 3; i++) {
        board = board.placePieceByPlayer(Vector3.create(i, 0, 0), 'player1');
      }
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).not.toBeNull();
      expect(line!.positions.length).toBeGreaterThanOrEqual(5);
    });

    test('does not detect 4 in a row', () => {
      for (let i = -1; i <= 2; i++) {
        board = board.placePieceByPlayer(Vector3.create(i, 0, 0), 'player1');
      }
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).toBeNull();
    });

    test('handles interrupted sequences', () => {
      board = board.placePieceByPlayer(Vector3.create(0, 0, 0), 'player1')
        .placePieceByPlayer(Vector3.create(1, 0, 0), 'player1')
        .placePieceByPlayer(Vector3.create(2, 0, 0), 'player2') // Interruption
        .placePieceByPlayer(Vector3.create(3, 0, 0), 'player1')
        .placePieceByPlayer(Vector3.create(-1, 0, 0), 'player1')
        .placePieceByPlayer(Vector3.create(-2, 0, 0), 'player1');
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).toBeNull();
    });

    test('detects win at board edges', () => {
      for (let i = -1; i <= 3; i++) {
        board = board.placePieceByPlayer(Vector3.create(i, 3, 0), 'player1');
      }
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).not.toBeNull();
    });

    test('detects win at board corners', () => {
      // Diagonal from corner
      const positions = [
        Vector3.create(3, 3, 3),
        Vector3.create(2, 2, 2),
        Vector3.create(1, 1, 1),
        Vector3.create(0, 0, 0),
        Vector3.create(-1, -1, -1)
      ];
      
      positions.forEach(pos => {
        board = board.placePieceByPlayer(pos, 'player1');
      });
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).not.toBeNull();
    });

    test('optimizes search with last move hint', () => {
      for (let i = -2; i <= 2; i++) {
        board = board.placePieceByPlayer(Vector3.create(i, 0, 0), 'player1');
      }
      
      const lastMove = Move.create(Vector3.create(0, 0, 0), 'player1');
      const line = GameRules.checkFiveInARow(board, players[0], lastMove);
      expect(line).not.toBeNull();
    });

    test('finds win without last move hint', () => {
      for (let i = -2; i <= 2; i++) {
        board = board.placePieceByPlayer(Vector3.create(i, 0, 0), 'player1');
      }
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).not.toBeNull();
    });

    test('handles multiple potential wins', () => {
      // Create two 5-in-a-row patterns
      for (let i = -2; i <= 2; i++) {
        board = board.placePieceByPlayer(Vector3.create(i, 0, 0), 'player1');
        board = board.placePieceByPlayer(Vector3.create(0, i, 0), 'player1');
      }
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).not.toBeNull();
      expect(line!.positions).toHaveLength(5);
    });

    test('returns longest winning line', () => {
      // Create 6 in a row
      for (let i = -2; i <= 3; i++) {
        board = board.placePieceByPlayer(Vector3.create(i, 0, 0), 'player1');
      }
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).not.toBeNull();
      expect(line!.positions.length).toBeGreaterThanOrEqual(5);
    });

    test('ignores opponent pieces in line', () => {
      for (let i = -2; i <= 2; i++) {
        board = board.placePieceByPlayer(Vector3.create(i, 0, 0), 'player1');
      }
      board = board.placePieceByPlayer(Vector3.create(0, 1, 0), 'player2');
      
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).not.toBeNull();
    });

    test('performance: quick win detection', () => {
      for (let i = -2; i <= 2; i++) {
        board = board.placePieceByPlayer(Vector3.create(i, 0, 0), 'player1');
      }
      
      const start = performance.now();
      GameRules.checkFiveInARow(board, players[0], null);
      const end = performance.now();
      
      expect(end - start).toBeLessThan(5); // Should be under 5ms
    });

    test('handles empty board correctly', () => {
      const line = GameRules.checkFiveInARow(board, players[0], null);
      expect(line).toBeNull();
    });
  });

  describe('hasWonByCaptures', () => {
    test('detects win with exactly 5 captures', () => {
      const player = players[0].addCaptures(5);
      expect(GameRules.hasWonByCaptures(player)).toBe(true);
    });

    test('detects win with more than 5 captures', () => {
      const player = players[0].addCaptures(7);
      expect(GameRules.hasWonByCaptures(player)).toBe(true);
    });

    test('does not trigger with 4 captures', () => {
      const player = players[0].addCaptures(4);
      expect(GameRules.hasWonByCaptures(player)).toBe(false);
    });

    test('counts pair captures correctly', () => {
      // 10 pieces captured = 5 pairs
      const player = players[0].addCaptures(5);
      expect(GameRules.hasWonByCaptures(player)).toBe(true);
    });

    test('handles player with no captures', () => {
      expect(GameRules.hasWonByCaptures(players[0])).toBe(false);
    });

    test('updates capture count accurately', () => {
      let player = players[0];
      expect(GameRules.hasWonByCaptures(player)).toBe(false);
      
      player = player.addCaptures(3);
      expect(GameRules.hasWonByCaptures(player)).toBe(false);
      
      player = player.addCaptures(2);
      expect(GameRules.hasWonByCaptures(player)).toBe(true);
    });

    test('distinguishes between players captures', () => {
      const player1 = players[0].addCaptures(5);
      const player2 = players[1].addCaptures(3);
      
      expect(GameRules.hasWonByCaptures(player1)).toBe(true);
      expect(GameRules.hasWonByCaptures(player2)).toBe(false);
    });

    test('handles capture count edge cases', () => {
      const player = players[0].addCaptures(100);
      expect(GameRules.hasWonByCaptures(player)).toBe(true);
    });

    test('validates capture win state', () => {
      const player = players[0].addCaptures(5);
      const winResult = new WinResult(player, 'captures');
      expect(winResult.type).toBe('captures');
    });

    test('performance: instant capture check', () => {
      const player = players[0].addCaptures(5);
      
      const start = performance.now();
      GameRules.hasWonByCaptures(player);
      const end = performance.now();
      
      expect(end - start).toBeLessThan(1); // Should be instant
    });
  });

  describe('getCurrentPlayer', () => {
    test('returns first player for empty history', () => {
      const current = GameRules.getCurrentPlayer(players, []);
      expect(current).toBe(players[0]);
    });

    test('alternates between two players', () => {
      let history: Move[] = [];
      
      expect(GameRules.getCurrentPlayer(players, history)).toBe(players[0]);
      
      history = [Move.create(Vector3.create(0, 0, 0), 'player1')];
      expect(GameRules.getCurrentPlayer(players, history)).toBe(players[1]);
      
      history.push(Move.create(Vector3.create(1, 0, 0), 'player2'));
      expect(GameRules.getCurrentPlayer(players, history)).toBe(players[0]);
    });

    test('handles three player games', () => {
      const threePlayers = [
        Player.createLocal('player1', 'white'),
        Player.createLocal('player2', 'black'),
        Player.createLocal('player3', 'red')
      ];
      
      let history: Move[] = [];
      expect(GameRules.getCurrentPlayer(threePlayers, history)).toBe(threePlayers[0]);
      
      history = [Move.create(Vector3.create(0, 0, 0), 'player1')];
      expect(GameRules.getCurrentPlayer(threePlayers, history)).toBe(threePlayers[1]);
      
      history.push(Move.create(Vector3.create(1, 0, 0), 'player2'));
      expect(GameRules.getCurrentPlayer(threePlayers, history)).toBe(threePlayers[2]);
      
      history.push(Move.create(Vector3.create(2, 0, 0), 'player3'));
      expect(GameRules.getCurrentPlayer(threePlayers, history)).toBe(threePlayers[0]);
    });

    test('handles four player games', () => {
      const fourPlayers = [
        Player.createLocal('player1', 'white'),
        Player.createLocal('player2', 'black'),
        Player.createLocal('player3', 'red'),
        Player.createLocal('player4', 'blue')
      ];
      
      const history = [
        Move.create(Vector3.create(0, 0, 0), 'player1'),
        Move.create(Vector3.create(1, 0, 0), 'player2'),
        Move.create(Vector3.create(2, 0, 0), 'player3')
      ];
      
      expect(GameRules.getCurrentPlayer(fourPlayers, history)).toBe(fourPlayers[3]);
    });

    test('maintains order after captures', () => {
      const history = [
        Move.create(Vector3.create(0, 0, 0), 'player1', [Vector3.create(1, 0, 0)])
      ];
      
      expect(GameRules.getCurrentPlayer(players, history)).toBe(players[1]);
    });

    test('cycles through all players', () => {
      const history: Move[] = [];
      
      for (let i = 0; i < 10; i++) {
        const current = GameRules.getCurrentPlayer(players, history);
        expect(current).toBe(players[i % 2]);
        history.push(Move.create(Vector3.create(i, 0, 0), current.id));
      }
    });

    test('handles single player edge case', () => {
      const singlePlayer = [Player.createLocal('player1', 'white')];
      
      expect(GameRules.getCurrentPlayer(singlePlayer, [])).toBe(singlePlayer[0]);
      expect(GameRules.getCurrentPlayer(singlePlayer, [
        Move.create(Vector3.create(0, 0, 0), 'player1')
      ])).toBe(singlePlayer[0]);
    });

    test('throws error for empty player array', () => {
      expect(() => GameRules.getCurrentPlayer([], [])).toThrow('No players provided');
    });

    test('validates player array integrity', () => {
      const history = [Move.create(Vector3.create(0, 0, 0), 'player1')];
      const current = GameRules.getCurrentPlayer(players, history);
      
      expect(players.includes(current)).toBe(true);
    });

    test('performance: instant player lookup', () => {
      const history = Array(100).fill(null).map((_, i) => 
        Move.create(Vector3.create(i, 0, 0), players[i % 2].id)
      );
      
      const start = performance.now();
      GameRules.getCurrentPlayer(players, history);
      const end = performance.now();
      
      expect(end - start).toBeLessThan(1);
    });
  });
});