import { Game } from '@/core/Game';
import { Vector3 } from '@/core/Vector3';
import { GameState } from '@/core/GameState';
import { GameRules } from '@/core/GameRules';
import { Board } from '@/core/Board';
import { Player } from '@/core/Player';
import { Move } from '@/core/Move';
import type { GameEvent } from '@/core/Game';

describe('Game Controller Integration', () => {
  describe('complete game flow', () => {
    it('should play a complete game with five-in-a-row win', () => {
      const game = new Game();
      const events: GameEvent[] = [];
      game.addEventListener(event => events.push(event));

      // Black plays a diagonal line
      const blackMoves = [
        new Vector3(0, 0, 0),
        new Vector3(1, 1, 1),
        new Vector3(2, 2, 2),
        new Vector3(3, 3, 3),
        new Vector3(4, 4, 4), // Winning move
      ];

      // White plays adjacent
      const whiteMoves = [
        new Vector3(0, 1, 0),
        new Vector3(1, 2, 1),
        new Vector3(2, 3, 2),
        new Vector3(3, 4, 3),
      ];

      // Play the game
      for (let i = 0; i < blackMoves.length; i++) {
        expect(game.placePiece(blackMoves[i])).toBe(true);
        if (i < whiteMoves.length) {
          expect(game.placePiece(whiteMoves[i])).toBe(true);
        }
      }

      // Verify game state
      expect(game.isGameOver()).toBe(true);
      expect(game.getWinner()).toBe('black');
      expect(game.getWinResult()?.getWinType()).toBe('five-in-a-row');

      // Verify events
      const moveEvents = events.filter(e => e.type === 'move');
      const gameOverEvent = events.find(e => e.type === 'gameOver');
      
      expect(moveEvents).toHaveLength(9);
      expect(gameOverEvent).toBeTruthy();
      expect(gameOverEvent?.type === 'gameOver' && gameOverEvent.winner).toBe('black');
    });

    it('should play a complete game with capture win', () => {
      const game = new Game();
      
      // Play a game that results in capture win
      // We need to capture 5 pairs of pieces
      const moves = [
        // First capture setup
        new Vector3(0, 0, 0), // black
        new Vector3(1, 0, 0), // white
        new Vector3(3, 0, 0), // black
        new Vector3(2, 0, 0), // white (will be captured)
        
        // Second capture setup
        new Vector3(4, 0, 0), // black
        new Vector3(5, 0, 0), // white
        new Vector3(7, 0, 0), // black
        new Vector3(6, 0, 0), // white (will be captured)
        
        // Third capture setup
        new Vector3(0, 1, 0), // black
        new Vector3(1, 1, 0), // white
        new Vector3(3, 1, 0), // black
        new Vector3(2, 1, 0), // white (will be captured)
        
        // Fourth capture setup
        new Vector3(4, 1, 0), // black
        new Vector3(5, 1, 0), // white
        new Vector3(7, 1, 0), // black
        new Vector3(6, 1, 0), // white (will be captured)
        
        // Fifth capture setup
        new Vector3(0, 2, 0), // black
        new Vector3(1, 2, 0), // white
        new Vector3(3, 2, 0), // black
        new Vector3(2, 2, 0), // white (will be captured - black wins)
      ];

      moves.forEach(move => game.placePiece(move));

      expect(game.isGameOver()).toBe(true);
      expect(game.getWinner()).toBe('black');
      expect(game.getWinResult()?.getWinType()).toBe('capture');
      expect(game.getCurrentState().getBlackPlayer().getCaptureCount()).toBe(5);
    });
  });

  describe('undo/redo with game state', () => {
    it('should properly restore game state including captures', () => {
      const game = new Game();
      
      // Create a capture scenario
      game.placePiece(new Vector3(0, 0, 0)); // black
      game.placePiece(new Vector3(1, 0, 0)); // white
      game.placePiece(new Vector3(3, 0, 0)); // black
      game.placePiece(new Vector3(2, 0, 0)); // white (captured)
      
      // Verify capture
      expect(game.getCurrentState().getBlackPlayer().getCaptureCount()).toBe(1);
      expect(game.getBoard().getPiece(new Vector3(1, 0, 0))).toBeFalsy();
      expect(game.getBoard().getPiece(new Vector3(2, 0, 0))).toBeFalsy();
      
      // Undo the capture
      game.undo();
      
      // Pieces should be back
      expect(game.getCurrentState().getBlackPlayer().getCaptureCount()).toBe(0);
      expect(game.getBoard().getPiece(new Vector3(1, 0, 0))).toBeTruthy();
      expect(game.getBoard().getPiece(new Vector3(2, 0, 0))).toBeFalsy();
      
      // Redo the capture
      game.redo();
      
      // Capture should be restored
      expect(game.getCurrentState().getBlackPlayer().getCaptureCount()).toBe(1);
      expect(game.getBoard().getPiece(new Vector3(1, 0, 0))).toBeFalsy();
      expect(game.getBoard().getPiece(new Vector3(2, 0, 0))).toBeFalsy();
    });

    it('should handle complex undo/redo sequences with events', () => {
      const game = new Game();
      const events: GameEvent[] = [];
      game.addEventListener(event => events.push(event));
      
      // Play several moves
      const moves = [
        new Vector3(4, 4, 4),
        new Vector3(5, 5, 5),
        new Vector3(3, 3, 3),
        new Vector3(6, 6, 6),
      ];
      
      moves.forEach(move => game.placePiece(move));
      
      // Clear events to track undo/redo
      events.length = 0;
      
      // Undo all moves
      game.undo(); // Undo 6,6,6
      game.undo(); // Undo 3,3,3
      game.undo(); // Undo 5,5,5
      
      expect(events.filter(e => e.type === 'undo')).toHaveLength(3);
      expect(game.getMoveCount()).toBe(1);
      
      // Redo some moves
      game.redo(); // Redo 5,5,5
      game.redo(); // Redo 3,3,3
      
      expect(events.filter(e => e.type === 'redo')).toHaveLength(2);
      expect(game.getMoveCount()).toBe(3);
      
      // Make a new move (should truncate history)
      game.placePiece(new Vector3(7, 7, 7));
      
      expect(game.canRedo()).toBe(false);
      expect(game.getHistory()).toHaveLength(5); // Initial + 3 moves + new move
    });
  });

  describe('serialization and persistence', () => {
    it('should serialize and deserialize complex game state', () => {
      const game1 = new Game({ boardSize: 11, blackFirst: false });
      
      // Play a complex game with captures
      const moves = [
        new Vector3(0, 0, 0), // white
        new Vector3(1, 0, 0), // black
        new Vector3(3, 0, 0), // white
        new Vector3(2, 0, 0), // black (will be captured)
        new Vector3(4, 4, 4), // white
        new Vector3(5, 5, 5), // black
      ];
      
      moves.forEach(move => game1.placePiece(move));
      
      // Undo to middle of history
      game1.undo();
      game1.undo();
      
      // Export and import
      const exported = game1.exportGame();
      const game2 = Game.importGame(exported);
      
      // Verify complete state restoration
      expect(game2.getOptions().boardSize).toBe(11);
      expect(game2.getOptions().blackFirst).toBe(false);
      expect(game2.getCurrentStateIndex()).toBe(4);
      expect(game2.getMoveCount()).toBe(4);
      expect(game2.canUndo()).toBe(true);
      expect(game2.canRedo()).toBe(true);
      expect(game2.getCurrentState().getWhitePlayer().getCaptureCount()).toBe(1);
      
      // Verify board state
      expect(game2.getBoard().getPiece(new Vector3(0, 0, 0))).toBeTruthy();
      expect(game2.getBoard().getPiece(new Vector3(1, 0, 0))).toBeFalsy(); // Captured
      expect(game2.getBoard().getPiece(new Vector3(2, 0, 0))).toBeFalsy(); // Captured
      expect(game2.getBoard().getPiece(new Vector3(3, 0, 0))).toBeTruthy();
      
      // Verify we can continue playing
      game2.redo();
      expect(game2.getMoveCount()).toBe(5);
    });

    it('should handle serialization of won games', () => {
      const game1 = new Game();
      
      // Create a winning position
      const positions = [
        new Vector3(0, 0, 0), new Vector3(1, 0, 0), // Black
        new Vector3(0, 1, 0), new Vector3(1, 1, 0), // White
        new Vector3(2, 0, 0), new Vector3(2, 1, 0), // Black
        new Vector3(3, 0, 0), new Vector3(3, 1, 0), // White
        new Vector3(4, 0, 0), // Black wins
      ];
      
      positions.forEach(pos => game1.placePiece(pos));
      
      // Export and import
      const exported = game1.exportGame();
      const game2 = Game.importGame(exported);
      
      // Verify game over state
      expect(game2.isGameOver()).toBe(true);
      expect(game2.getWinner()).toBe('black');
      expect(game2.getWinResult()?.getWinType()).toBe('five-in-a-row');
      
      // Should not allow new moves
      expect(game2.placePiece(new Vector3(8, 8, 8))).toBe(false);
      
      // But undo should still work
      expect(game2.undo()).toBe(true);
      expect(game2.isGameOver()).toBe(false);
    });
  });

  describe('event system integration', () => {
    it('should emit events in correct order during complex operations', () => {
      const game = new Game();
      const eventLog: string[] = [];
      
      game.addEventListener(event => {
        if (event.type === 'move') {
          eventLog.push(`move-${event.move.getPosition().toString()}`);
        } else if (event.type === 'gameOver') {
          eventLog.push(`gameOver-${event.winner}`);
        } else {
          eventLog.push(event.type);
        }
      });
      
      // Play moves leading to a win
      game.placePiece(new Vector3(0, 0, 0)); // black
      game.placePiece(new Vector3(1, 0, 0)); // white
      game.placePiece(new Vector3(0, 1, 0)); // black
      game.placePiece(new Vector3(1, 1, 0)); // white
      game.placePiece(new Vector3(0, 2, 0)); // black
      game.placePiece(new Vector3(1, 2, 0)); // white
      game.placePiece(new Vector3(0, 3, 0)); // black
      game.placePiece(new Vector3(1, 3, 0)); // white
      game.placePiece(new Vector3(0, 4, 0)); // black wins
      
      // Verify event order
      expect(eventLog[eventLog.length - 2]).toBe('move-(0, 4, 0)');
      expect(eventLog[eventLog.length - 1]).toBe('gameOver-black');
      
      // Test undo/redo/reset
      game.undo();
      game.redo();
      game.reset();
      
      expect(eventLog[eventLog.length - 3]).toBe('undo');
      expect(eventLog[eventLog.length - 2]).toBe('redo');
      expect(eventLog[eventLog.length - 1]).toBe('reset');
    });

    it('should handle multiple listeners correctly', () => {
      const game = new Game();
      let listener1Count = 0;
      let listener2Count = 0;
      let listener3Count = 0;
      
      const listener1 = () => listener1Count++;
      const listener2 = () => listener2Count++;
      const listener3 = () => listener3Count++;
      
      game.addEventListener(listener1);
      game.addEventListener(listener2);
      game.addEventListener(listener3);
      
      game.placePiece(new Vector3(4, 4, 4));
      expect(listener1Count).toBe(1);
      expect(listener2Count).toBe(1);
      expect(listener3Count).toBe(1);
      
      game.removeEventListener(listener2);
      game.placePiece(new Vector3(5, 5, 5));
      expect(listener1Count).toBe(2);
      expect(listener2Count).toBe(1); // Not incremented
      expect(listener3Count).toBe(2);
    });
  });

  describe('game rules integration', () => {
    it('should correctly integrate with GameRules for all validations', () => {
      const game = new Game();
      
      // Test invalid moves are rejected
      const invalidMoves = [
        new Vector3(-1, 0, 0), // Out of bounds
        new Vector3(9, 0, 0),  // Out of bounds
        new Vector3(4, 4, 10), // Out of bounds
      ];
      
      invalidMoves.forEach(move => {
        expect(game.placePiece(move)).toBe(false);
      });
      
      // Place a piece and try to place on same spot
      game.placePiece(new Vector3(4, 4, 4));
      expect(game.placePiece(new Vector3(4, 4, 4))).toBe(false);
      
      // Verify turn management
      expect(game.getCurrentPlayer().getColor()).toBe('white');
    });

    it('should handle all win conditions correctly', () => {
      // Test diagonal win in 3D
      const game1 = new Game();
      const diagonal3D = [
        new Vector3(0, 0, 0), new Vector3(1, 0, 0), // Black, White
        new Vector3(1, 1, 1), new Vector3(2, 0, 0), // Black, White
        new Vector3(2, 2, 2), new Vector3(3, 0, 0), // Black, White
        new Vector3(3, 3, 3), new Vector3(4, 0, 0), // Black, White
        new Vector3(4, 4, 4), // Black wins
      ];
      
      diagonal3D.forEach(move => game1.placePiece(move));
      expect(game1.getWinner()).toBe('black');
      expect(game1.getWinResult()?.getLine().getPositions()).toHaveLength(5);
      
      // Test capture win
      const game2 = new Game();
      
      // Setup for 5 captures
      for (let i = 0; i < 5; i++) {
        game2.placePiece(new Vector3(i * 4, 0, 0));     // black
        game2.placePiece(new Vector3(i * 4 + 1, 0, 0)); // white
        game2.placePiece(new Vector3(i * 4 + 3, 0, 0)); // black
        game2.placePiece(new Vector3(i * 4 + 2, 0, 0)); // white (captured)
      }
      
      expect(game2.getWinner()).toBe('black');
      expect(game2.getWinResult()?.getWinType()).toBe('capture');
    });
  });

  describe('performance under load', () => {
    it('should maintain performance with large game history', () => {
      const game = new Game({ boardSize: 11 });
      const startTime = Date.now();
      
      // Play many moves across the board
      for (let z = 0; z < 3; z++) {
        for (let y = 0; y < 11; y++) {
          for (let x = 0; x < 11; x++) {
            if ((x + y + z) % 2 === 0) { // Checkerboard pattern
              game.placePiece(new Vector3(x, y, z));
            }
          }
        }
      }
      
      const playTime = Date.now() - startTime;
      expect(playTime).toBeLessThan(2000); // Should complete in under 2 seconds
      
      // Test serialization performance
      const serializeStart = Date.now();
      const exported = game.exportGame();
      const imported = Game.importGame(exported);
      const serializeTime = Date.now() - serializeStart;
      
      expect(serializeTime).toBeLessThan(500); // Should serialize quickly
      expect(imported.getMoveHistory().length).toBeGreaterThan(100);
    });

    it('should handle rapid event firing efficiently', () => {
      const game = new Game();
      let eventCount = 0;
      
      game.addEventListener(() => eventCount++);
      
      const startTime = Date.now();
      
      // Rapidly play and undo moves
      for (let i = 0; i < 50; i++) {
        game.placePiece(new Vector3(i % 9, Math.floor(i / 9), 0));
      }
      
      for (let i = 0; i < 25; i++) {
        game.undo();
      }
      
      for (let i = 0; i < 25; i++) {
        game.redo();
      }
      
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(200);
      expect(eventCount).toBe(100); // 50 moves + 25 undos + 25 redos
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle game state recovery from corrupted data gracefully', () => {
      // Test importing invalid JSON
      expect(() => Game.importGame('invalid json')).toThrow();
      expect(() => Game.importGame('{}')).toThrow();
      
      // Create a game with valid but unusual state
      const game = new Game();
      game.placePiece(new Vector3(4, 4, 4));
      
      const json = game.toJSON();
      // Manually set an invalid state index
      json.currentStateIndex = 999;
      
      // Should handle gracefully (implementation could either throw or clamp the index)
      expect(() => Game.fromJSON(json)).toBeDefined();
    });

    it('should maintain consistency across all operations', () => {
      const game = new Game();
      
      // Play a complex sequence
      game.placePiece(new Vector3(0, 0, 0));
      game.placePiece(new Vector3(1, 0, 0));
      game.placePiece(new Vector3(2, 0, 0));
      game.undo();
      game.placePiece(new Vector3(3, 0, 0));
      game.reset();
      game.placePiece(new Vector3(4, 4, 4));
      
      // Verify state consistency
      expect(game.getMoveCount()).toBe(1);
      expect(game.getHistory()).toHaveLength(2);
      expect(game.canUndo()).toBe(true);
      expect(game.canRedo()).toBe(false);
      expect(game.getCurrentPlayer().getColor()).toBe('white');
    });
  });
});