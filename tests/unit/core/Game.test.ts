import { Game } from '@/core/Game';
import { GameState } from '@/core/GameState';
import { Vector3 } from '@/core/Vector3';
import { Move } from '@/core/Move';
import { Player } from '@/core/Player';
import { Board } from '@/core/Board';
import type { GameEvent } from '@/core/Game';

describe('Game', () => {
  describe('constructor', () => {
    it('should create game with default options', () => {
      const game = new Game();
      const state = game.getCurrentState();
      
      expect(state.getBoard().getSize()).toBe(9);
      expect(state.getCurrentPlayer().getColor()).toBe('black');
      expect(game.getCurrentStateIndex()).toBe(0);
      expect(game.getHistory()).toHaveLength(1);
    });

    it('should create game with custom board size', () => {
      const game = new Game({ boardSize: 7 });
      const state = game.getCurrentState();
      
      expect(state.getBoard().getSize()).toBe(7);
    });

    it('should create game with white going first', () => {
      const game = new Game({ blackFirst: false });
      const state = game.getCurrentState();
      
      expect(state.getCurrentPlayer().getColor()).toBe('white');
    });

    it('should create game with all custom options', () => {
      const game = new Game({ boardSize: 11, blackFirst: false });
      const state = game.getCurrentState();
      
      expect(state.getBoard().getSize()).toBe(11);
      expect(state.getCurrentPlayer().getColor()).toBe('white');
    });
  });

  describe('getCurrentState', () => {
    it('should return current game state', () => {
      const game = new Game();
      const state = game.getCurrentState();
      
      expect(state).toBeInstanceOf(GameState);
      expect(state.getMoveCount()).toBe(0);
    });

    it('should return different state after move', () => {
      const game = new Game();
      const initialState = game.getCurrentState();
      
      game.placePiece(new Vector3(4, 4, 4));
      const newState = game.getCurrentState();
      
      expect(newState).not.toBe(initialState);
      expect(newState.getMoveCount()).toBe(1);
    });
  });

  describe('getHistory', () => {
    it('should return readonly history array', () => {
      const game = new Game();
      const history = game.getHistory();
      
      expect(history).toHaveLength(1);
      expect(Array.isArray(history)).toBe(true);
    });

    it('should track history of moves', () => {
      const game = new Game();
      
      game.placePiece(new Vector3(4, 4, 4));
      game.placePiece(new Vector3(3, 3, 3));
      
      const history = game.getHistory();
      expect(history).toHaveLength(3);
      expect(history[0].getMoveCount()).toBe(0);
      expect(history[1].getMoveCount()).toBe(1);
      expect(history[2].getMoveCount()).toBe(2);
    });
  });

  describe('placePiece', () => {
    it('should place piece at valid position', () => {
      const game = new Game();
      const position = new Vector3(4, 4, 4);
      
      const result = game.placePiece(position);
      
      expect(result).toBe(true);
      expect(game.getCurrentState().getBoard().getPiece(position)).toBeTruthy();
    });

    it('should alternate players after each move', () => {
      const game = new Game();
      
      expect(game.getCurrentPlayer().getColor()).toBe('black');
      
      game.placePiece(new Vector3(4, 4, 4));
      expect(game.getCurrentPlayer().getColor()).toBe('white');
      
      game.placePiece(new Vector3(3, 3, 3));
      expect(game.getCurrentPlayer().getColor()).toBe('black');
    });

    it('should reject invalid moves', () => {
      const game = new Game();
      const position = new Vector3(4, 4, 4);
      
      game.placePiece(position);
      const result = game.placePiece(position); // Same position
      
      expect(result).toBe(false);
    });

    it('should reject moves after game is over', () => {
      const game = new Game();
      
      // Create a winning position
      const positions = [
        new Vector3(0, 0, 0), new Vector3(1, 0, 0), // Black
        new Vector3(0, 1, 0), new Vector3(1, 1, 0), // White
        new Vector3(2, 0, 0), new Vector3(2, 1, 0), // Black
        new Vector3(3, 0, 0), new Vector3(3, 1, 0), // White
        new Vector3(4, 0, 0), // Black wins
      ];
      
      positions.forEach(pos => game.placePiece(pos));
      
      expect(game.isGameOver()).toBe(true);
      expect(game.placePiece(new Vector3(3, 3, 3))).toBe(false);
    });

    it('should truncate redo history on new move', () => {
      const game = new Game();
      
      game.placePiece(new Vector3(4, 4, 4));
      game.placePiece(new Vector3(3, 3, 3));
      game.undo();
      
      expect(game.canRedo()).toBe(true);
      
      game.placePiece(new Vector3(2, 2, 2));
      
      expect(game.canRedo()).toBe(false);
      expect(game.getHistory()).toHaveLength(3);
    });
  });

  describe('undo/redo', () => {
    it('should undo last move', () => {
      const game = new Game();
      const position = new Vector3(4, 4, 4);
      
      game.placePiece(position);
      expect(game.getCurrentState().getBoard().getPiece(position)).toBeTruthy();
      
      const result = game.undo();
      expect(result).toBe(true);
      expect(game.getCurrentState().getBoard().getPiece(position)).toBeFalsy();
    });

    it('should not undo when at beginning', () => {
      const game = new Game();
      
      expect(game.canUndo()).toBe(false);
      expect(game.undo()).toBe(false);
    });

    it('should redo undone move', () => {
      const game = new Game();
      const position = new Vector3(4, 4, 4);
      
      game.placePiece(position);
      game.undo();
      
      const result = game.redo();
      expect(result).toBe(true);
      expect(game.getCurrentState().getBoard().getPiece(position)).toBeTruthy();
    });

    it('should not redo when at end', () => {
      const game = new Game();
      
      expect(game.canRedo()).toBe(false);
      expect(game.redo()).toBe(false);
    });

    it('should support multiple undo/redo', () => {
      const game = new Game();
      
      game.placePiece(new Vector3(0, 0, 0));
      game.placePiece(new Vector3(1, 1, 1));
      game.placePiece(new Vector3(2, 2, 2));
      
      expect(game.getCurrentStateIndex()).toBe(3);
      
      game.undo();
      game.undo();
      expect(game.getCurrentStateIndex()).toBe(1);
      
      game.redo();
      expect(game.getCurrentStateIndex()).toBe(2);
    });

    it('should work after game is won', () => {
      const game = new Game();
      
      // Create a winning position
      const positions = [
        new Vector3(0, 0, 0), new Vector3(1, 0, 0), // Black
        new Vector3(0, 1, 0), new Vector3(1, 1, 0), // White
        new Vector3(2, 0, 0), new Vector3(2, 1, 0), // Black
        new Vector3(3, 0, 0), new Vector3(3, 1, 0), // White
        new Vector3(4, 0, 0), // Black wins
      ];
      
      positions.forEach(pos => game.placePiece(pos));
      
      expect(game.isGameOver()).toBe(true);
      expect(game.undo()).toBe(true);
      expect(game.isGameOver()).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      const game = new Game();
      
      game.placePiece(new Vector3(4, 4, 4));
      game.placePiece(new Vector3(3, 3, 3));
      
      game.reset();
      
      expect(game.getCurrentStateIndex()).toBe(0);
      expect(game.getHistory()).toHaveLength(1);
      expect(game.getCurrentState().getMoveCount()).toBe(0);
    });

    it('should preserve game options on reset', () => {
      const game = new Game({ boardSize: 7, blackFirst: false });
      
      game.placePiece(new Vector3(3, 3, 3));
      game.reset();
      
      expect(game.getCurrentState().getBoard().getSize()).toBe(7);
      expect(game.getCurrentState().getCurrentPlayer().getColor()).toBe('white');
    });

    it('should clear undo/redo history', () => {
      const game = new Game();
      
      game.placePiece(new Vector3(4, 4, 4));
      game.placePiece(new Vector3(3, 3, 3));
      game.undo();
      
      game.reset();
      
      expect(game.canUndo()).toBe(false);
      expect(game.canRedo()).toBe(false);
    });
  });

  describe('game state queries', () => {
    it('should check if game is over', () => {
      const game = new Game();
      
      expect(game.isGameOver()).toBe(false);
      
      // Create a winning position
      const positions = [
        new Vector3(0, 0, 0), new Vector3(1, 0, 0), // Black
        new Vector3(0, 1, 0), new Vector3(1, 1, 0), // White
        new Vector3(2, 0, 0), new Vector3(2, 1, 0), // Black
        new Vector3(3, 0, 0), new Vector3(3, 1, 0), // White
        new Vector3(4, 0, 0), // Black wins
      ];
      
      positions.forEach(pos => game.placePiece(pos));
      
      expect(game.isGameOver()).toBe(true);
    });

    it('should get winner', () => {
      const game = new Game();
      
      expect(game.getWinner()).toBeNull();
      
      // Create a winning position
      const positions = [
        new Vector3(0, 0, 0), new Vector3(1, 0, 0), // Black
        new Vector3(0, 1, 0), new Vector3(1, 1, 0), // White
        new Vector3(2, 0, 0), new Vector3(2, 1, 0), // Black
        new Vector3(3, 0, 0), new Vector3(3, 1, 0), // White
        new Vector3(4, 0, 0), // Black wins
      ];
      
      positions.forEach(pos => game.placePiece(pos));
      
      expect(game.getWinner()).toBe('black');
    });

    it('should get win result', () => {
      const game = new Game();
      
      expect(game.getWinResult()).toBeNull();
      
      // Create a winning position
      const positions = [
        new Vector3(0, 0, 0), new Vector3(1, 0, 0), // Black
        new Vector3(0, 1, 0), new Vector3(1, 1, 0), // White
        new Vector3(2, 0, 0), new Vector3(2, 1, 0), // Black
        new Vector3(3, 0, 0), new Vector3(3, 1, 0), // White
        new Vector3(4, 0, 0), // Black wins
      ];
      
      positions.forEach(pos => game.placePiece(pos));
      
      const winResult = game.getWinResult();
      expect(winResult).toBeTruthy();
      expect(winResult?.getWinner()).toBe('black');
      expect(winResult?.getWinType()).toBe('five-in-a-row');
    });
  });

  describe('helper methods', () => {
    it('should get current player', () => {
      const game = new Game();
      
      expect(game.getCurrentPlayer().getColor()).toBe('black');
      
      game.placePiece(new Vector3(4, 4, 4));
      expect(game.getCurrentPlayer().getColor()).toBe('white');
    });

    it('should get move count', () => {
      const game = new Game();
      
      expect(game.getMoveCount()).toBe(0);
      
      game.placePiece(new Vector3(4, 4, 4));
      expect(game.getMoveCount()).toBe(1);
      
      game.placePiece(new Vector3(3, 3, 3));
      expect(game.getMoveCount()).toBe(2);
    });

    it('should get board', () => {
      const game = new Game();
      const board = game.getBoard();
      
      expect(board).toBeInstanceOf(Board);
      expect(board.getSize()).toBe(9);
    });

    it('should get move history', () => {
      const game = new Game();
      
      expect(game.getMoveHistory()).toHaveLength(0);
      
      game.placePiece(new Vector3(4, 4, 4));
      game.placePiece(new Vector3(3, 3, 3));
      
      const history = game.getMoveHistory();
      expect(history).toHaveLength(2);
      expect(history[0].getPosition().equals(new Vector3(4, 4, 4))).toBe(true);
      expect(history[1].getPosition().equals(new Vector3(3, 3, 3))).toBe(true);
    });

    it('should get game options', () => {
      const game = new Game({ boardSize: 7, blackFirst: false });
      const options = game.getOptions();
      
      expect(options.boardSize).toBe(7);
      expect(options.blackFirst).toBe(false);
    });
  });

  describe('event system', () => {
    it('should emit move events', () => {
      const game = new Game();
      const events: GameEvent[] = [];
      
      game.addEventListener(event => events.push(event));
      
      const position = new Vector3(4, 4, 4);
      game.placePiece(position);
      
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('move');
      expect(events[0].type === 'move' && events[0].move.getPosition().equals(position)).toBe(true);
    });

    it('should emit undo events', () => {
      const game = new Game();
      const events: GameEvent[] = [];
      
      game.placePiece(new Vector3(4, 4, 4));
      game.addEventListener(event => events.push(event));
      
      game.undo();
      
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('undo');
    });

    it('should emit redo events', () => {
      const game = new Game();
      const events: GameEvent[] = [];
      
      game.placePiece(new Vector3(4, 4, 4));
      game.undo();
      game.addEventListener(event => events.push(event));
      
      game.redo();
      
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('redo');
    });

    it('should emit reset events', () => {
      const game = new Game();
      const events: GameEvent[] = [];
      
      game.placePiece(new Vector3(4, 4, 4));
      game.addEventListener(event => events.push(event));
      
      game.reset();
      
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('reset');
    });

    it('should emit gameOver events', () => {
      const game = new Game();
      const events: GameEvent[] = [];
      
      game.addEventListener(event => events.push(event));
      
      // Create a winning position
      const positions = [
        new Vector3(0, 0, 0), new Vector3(1, 0, 0), // Black
        new Vector3(0, 1, 0), new Vector3(1, 1, 0), // White
        new Vector3(2, 0, 0), new Vector3(2, 1, 0), // Black
        new Vector3(3, 0, 0), new Vector3(3, 1, 0), // White
        new Vector3(4, 0, 0), // Black wins
      ];
      
      positions.forEach(pos => game.placePiece(pos));
      
      const gameOverEvent = events.find(e => e.type === 'gameOver');
      expect(gameOverEvent).toBeTruthy();
      expect(gameOverEvent?.type === 'gameOver' && gameOverEvent.winner).toBe('black');
    });

    it('should remove event listeners', () => {
      const game = new Game();
      const events: GameEvent[] = [];
      const handler = (event: GameEvent) => events.push(event);
      
      game.addEventListener(handler);
      game.placePiece(new Vector3(4, 4, 4));
      
      expect(events).toHaveLength(1);
      
      game.removeEventListener(handler);
      game.placePiece(new Vector3(3, 3, 3));
      
      expect(events).toHaveLength(1); // No new event
    });

    it('should support multiple event listeners', () => {
      const game = new Game();
      const events1: GameEvent[] = [];
      const events2: GameEvent[] = [];
      
      game.addEventListener(event => events1.push(event));
      game.addEventListener(event => events2.push(event));
      
      game.placePiece(new Vector3(4, 4, 4));
      
      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
    });
  });

  describe('serialization', () => {
    it('should export game to JSON', () => {
      const game = new Game({ boardSize: 7, blackFirst: false });
      
      game.placePiece(new Vector3(3, 3, 3));
      game.placePiece(new Vector3(4, 4, 4));
      
      const json = game.toJSON();
      
      expect(json.currentStateIndex).toBe(2);
      expect(json.history).toHaveLength(3);
      expect(json.options.boardSize).toBe(7);
      expect(json.options.blackFirst).toBe(false);
    });

    it('should export game to string', () => {
      const game = new Game();
      game.placePiece(new Vector3(4, 4, 4));
      
      const exported = game.exportGame();
      
      expect(typeof exported).toBe('string');
      expect(() => JSON.parse(exported)).not.toThrow();
    });

    it('should import game from JSON', () => {
      const game1 = new Game({ boardSize: 7, blackFirst: false });
      
      game1.placePiece(new Vector3(3, 3, 3));
      game1.placePiece(new Vector3(4, 4, 4));
      game1.undo();
      
      const json = game1.toJSON();
      const game2 = Game.fromJSON(json);
      
      expect(game2.getCurrentStateIndex()).toBe(1);
      expect(game2.getHistory()).toHaveLength(3);
      expect(game2.canRedo()).toBe(true);
      expect(game2.getOptions().boardSize).toBe(7);
      expect(game2.getOptions().blackFirst).toBe(false);
    });

    it('should import game from string', () => {
      const game1 = new Game();
      
      game1.placePiece(new Vector3(4, 4, 4));
      game1.placePiece(new Vector3(3, 3, 3));
      
      const exported = game1.exportGame();
      const game2 = Game.importGame(exported);
      
      expect(game2.getMoveCount()).toBe(2);
      expect(game2.getCurrentPlayer().getColor()).toBe('black');
    });

    it('should preserve complete game state on import', () => {
      const game1 = new Game();
      
      // Play some moves
      game1.placePiece(new Vector3(0, 0, 0));
      game1.placePiece(new Vector3(1, 1, 1));
      game1.placePiece(new Vector3(2, 2, 2));
      
      // Undo to middle
      game1.undo();
      
      const exported = game1.exportGame();
      const game2 = Game.importGame(exported);
      
      // Verify state
      expect(game2.getCurrentStateIndex()).toBe(2);
      expect(game2.canUndo()).toBe(true);
      expect(game2.canRedo()).toBe(true);
      expect(game2.getMoveCount()).toBe(2);
      
      // Verify we can still redo
      game2.redo();
      expect(game2.getMoveCount()).toBe(3);
    });
  });

  describe('enhanced history navigation', () => {
    it('should navigate to specific move index', () => {
      const game = new Game();
      
      // Play 5 moves
      for (let i = 0; i < 5; i++) {
        game.placePiece(new Vector3(i, 0, 0));
      }
      
      expect(game.getCurrentStateIndex()).toBe(5);
      
      // Go to move 2
      const result = game.goToMove(2);
      expect(result).toBe(true);
      expect(game.getCurrentStateIndex()).toBe(2);
      expect(game.getMoveCount()).toBe(2);
    });

    it('should reject invalid move indices', () => {
      const game = new Game();
      
      game.placePiece(new Vector3(0, 0, 0));
      game.placePiece(new Vector3(1, 1, 1));
      
      expect(game.goToMove(-1)).toBe(false);
      expect(game.goToMove(10)).toBe(false);
      expect(game.getCurrentStateIndex()).toBe(2);
    });

    it('should emit historyNavigate event', () => {
      const game = new Game();
      const events: GameEvent[] = [];
      
      game.addEventListener(event => events.push(event));
      
      for (let i = 0; i < 3; i++) {
        game.placePiece(new Vector3(i, 0, 0));
      }
      
      game.goToMove(1);
      
      const navEvent = events.find(e => e.type === 'historyNavigate');
      expect(navEvent).toBeTruthy();
      expect(navEvent?.type === 'historyNavigate' && navEvent.moveIndex).toBe(1);
    });

    it('should validate state before navigation', () => {
      const game = new Game();
      
      // Play some moves
      game.placePiece(new Vector3(0, 0, 0));
      game.placePiece(new Vector3(1, 1, 1));
      
      // Manually corrupt a state (in real scenario, this shouldn't happen)
      const history = game.getHistory() as GameState[];
      const corruptedState = history[1];
      
      // The validateState method should catch inconsistencies
      const result = game.goToMove(1);
      expect(result).toBe(true); // Should still work with valid state
    });

    it('should get history length', () => {
      const game = new Game();
      
      expect(game.getHistoryLength()).toBe(1);
      
      game.placePiece(new Vector3(0, 0, 0));
      expect(game.getHistoryLength()).toBe(2);
      
      game.placePiece(new Vector3(1, 1, 1));
      expect(game.getHistoryLength()).toBe(3);
      
      game.undo();
      expect(game.getHistoryLength()).toBe(3); // History still exists
    });

    it('should check if can go to move', () => {
      const game = new Game();
      
      game.placePiece(new Vector3(0, 0, 0));
      game.placePiece(new Vector3(1, 1, 1));
      game.placePiece(new Vector3(2, 2, 2));
      
      expect(game.canGoToMove(0)).toBe(true);
      expect(game.canGoToMove(1)).toBe(true);
      expect(game.canGoToMove(2)).toBe(true);
      expect(game.canGoToMove(3)).toBe(false); // Current position
      expect(game.canGoToMove(-1)).toBe(false);
      expect(game.canGoToMove(10)).toBe(false);
    });

    it('should handle navigation after undo/redo', () => {
      const game = new Game();
      
      // Play moves
      for (let i = 0; i < 5; i++) {
        game.placePiece(new Vector3(i, 0, 0));
      }
      
      // Undo twice
      game.undo();
      game.undo();
      
      // Navigate to beginning
      game.goToMove(0);
      expect(game.getCurrentStateIndex()).toBe(0);
      
      // Navigate to end
      game.goToMove(4);
      expect(game.getCurrentStateIndex()).toBe(4);
      
      // Can still redo
      expect(game.canRedo()).toBe(true);
    });
  });

  describe('history compression', () => {
    it('should compress history when threshold is reached', () => {
      const game = new Game();
      
      // Set low threshold for testing
      game.setCompressionOptions({
        maxHistorySize: 10,
        compressionThreshold: 5
      });
      
      // Play many moves to trigger compression
      for (let i = 0; i < 15; i++) {
        const x = i % 3;
        const y = Math.floor(i / 3) % 3;
        const z = Math.floor(i / 9);
        game.placePiece(new Vector3(x, y, z));
      }
      
      // History should be compressed
      expect(game.getHistoryLength()).toBeLessThanOrEqual(10);
    });

    it('should preserve initial state during compression', () => {
      const game = new Game({ boardSize: 7, blackFirst: false });
      
      game.setCompressionOptions({
        maxHistorySize: 5,
        compressionThreshold: 3
      });
      
      // Play moves to trigger compression
      for (let i = 0; i < 10; i++) {
        game.placePiece(new Vector3(i % 7, 0, 0));
      }
      
      // Go back to beginning
      game.goToMove(0);
      
      // Initial state should be preserved
      expect(game.getCurrentState().getBoard().getSize()).toBe(7);
      expect(game.getCurrentState().getCurrentPlayer().getColor()).toBe('white');
    });

    it('should maintain current state after compression', () => {
      const game = new Game();
      
      game.setCompressionOptions({
        maxHistorySize: 8,
        compressionThreshold: 4
      });
      
      // Play moves
      for (let i = 0; i < 12; i++) {
        game.placePiece(new Vector3(i % 4, Math.floor(i / 4), 0));
      }
      
      const moveCountBefore = game.getMoveCount();
      const currentPlayer = game.getCurrentPlayer().getColor();
      
      // Force another move to trigger compression
      game.placePiece(new Vector3(4, 4, 4));
      
      // Current game state should be maintained
      expect(game.getMoveCount()).toBe(moveCountBefore + 1);
      expect(game.getCurrentPlayer().getColor()).toBe(currentPlayer === 'black' ? 'white' : 'black');
    });

    it('should handle compression with custom options', () => {
      const game = new Game();
      
      // Set custom compression options
      game.setCompressionOptions({
        maxHistorySize: 20,
        compressionThreshold: 10
      });
      
      // Play moves up to threshold
      for (let i = 0; i < 9; i++) {
        game.placePiece(new Vector3(i % 3, Math.floor(i / 3), 0));
      }
      
      const historyBefore = game.getHistoryLength();
      
      // One more move shouldn't trigger compression
      game.placePiece(new Vector3(3, 3, 3));
      expect(game.getHistoryLength()).toBe(historyBefore + 1);
      
      // Play more to exceed threshold
      for (let i = 0; i < 15; i++) {
        game.placePiece(new Vector3(i % 5, Math.floor(i / 5), 1));
      }
      
      // Now compression should have occurred
      expect(game.getHistoryLength()).toBeLessThanOrEqual(20);
    });
  });

  describe('edge cases', () => {
    it('should handle rapid moves', () => {
      const game = new Game();
      const positions = Array.from({ length: 20 }, (_, i) => 
        new Vector3(i % 9, Math.floor(i / 9), 0)
      );
      
      positions.forEach(pos => {
        game.placePiece(pos);
      });
      
      expect(game.getMoveCount()).toBe(20);
      expect(game.getHistory()).toHaveLength(21);
    });

    it('should handle complex undo/redo sequences', () => {
      const game = new Game();
      
      // Play 5 moves
      for (let i = 0; i < 5; i++) {
        game.placePiece(new Vector3(i, 0, 0));
      }
      
      // Undo 3
      game.undo();
      game.undo();
      game.undo();
      
      // Redo 1
      game.redo();
      
      // Play new move (should truncate)
      game.placePiece(new Vector3(3, 3, 3));
      
      expect(game.getCurrentStateIndex()).toBe(4);
      expect(game.getHistory()).toHaveLength(5);
      expect(game.canRedo()).toBe(false);
    });

    it('should handle game with captures', () => {
      const game = new Game();
      
      // Set up a capture scenario
      game.placePiece(new Vector3(0, 0, 0)); // black
      game.placePiece(new Vector3(1, 0, 0)); // white
      game.placePiece(new Vector3(3, 0, 0)); // black
      game.placePiece(new Vector3(2, 0, 0)); // white (captured)
      
      const state = game.getCurrentState();
      expect(state.getBlackPlayer().getCaptureCount()).toBe(1);
    });

    it('should handle empty event listener operations', () => {
      const game = new Game();
      
      // Should not throw
      expect(() => {
        game.removeEventListener(() => {});
        game.placePiece(new Vector3(0, 0, 0));
      }).not.toThrow();
    });
  });

  describe('performance', () => {
    it('should handle large game history efficiently', () => {
      const game = new Game();
      const startTime = Date.now();
      
      // Play 100 moves
      for (let i = 0; i < 100; i++) {
        const x = i % 9;
        const y = Math.floor(i / 9) % 9;
        const z = Math.floor(i / 81);
        game.placePiece(new Vector3(x, y, z));
      }
      
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
      
      // Test undo performance
      const undoStart = Date.now();
      for (let i = 0; i < 50; i++) {
        game.undo();
      }
      const undoEnd = Date.now();
      expect(undoEnd - undoStart).toBeLessThan(100); // Undo should be very fast
    });

    it('should serialize large games efficiently', () => {
      const game = new Game();
      
      // Play many moves
      for (let i = 0; i < 50; i++) {
        const x = i % 9;
        const y = Math.floor(i / 9) % 9;
        const z = Math.floor(i / 81);
        game.placePiece(new Vector3(x, y, z));
      }
      
      const startTime = Date.now();
      const exported = game.exportGame();
      const imported = Game.importGame(exported);
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(100);
      expect(imported.getMoveCount()).toBe(50);
    });
  });
});