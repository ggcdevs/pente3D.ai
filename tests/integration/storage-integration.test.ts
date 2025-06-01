import { Game } from '@/core/Game';
import { StorageManager, Settings } from '@/storage';
import { Vector3 } from '@/core/Vector3';

describe('Storage Integration Tests', () => {
  let mockLocalStorage: { [key: string]: string };

  beforeEach(() => {
    mockLocalStorage = {};
    
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn((key) => mockLocalStorage[key] || null),
        setItem: jest.fn((key, value) => {
          mockLocalStorage[key] = value;
        }),
        removeItem: jest.fn((key) => {
          delete mockLocalStorage[key];
        }),
        clear: jest.fn(() => {
          mockLocalStorage = {};
        })
      },
      writable: true
    });

    // Mock navigator.storage.estimate
    Object.defineProperty(navigator, 'storage', {
      value: {
        estimate: jest.fn().mockResolvedValue({
          usage: 1000,
          quota: 10000
        })
      },
      writable: true,
      configurable: true
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Auto-save functionality', () => {
    it('should automatically save game state after each move', () => {
      const game = new Game({ boardSize: 7 });
      const settings = new Settings();
      
      // Set up auto-save
      game.on('move', () => {
        StorageManager.save(game, settings);
      });
      
      // Make a move
      game.placePiece(new Vector3(3, 3, 3));
      
      // Verify save was called
      expect(localStorage.setItem).toHaveBeenCalled();
      
      // Load the game and verify state
      const loadedGame = StorageManager.loadGame();
      expect(loadedGame).toBeTruthy();
      expect(loadedGame?.getCurrentState().getPieces()).toHaveLength(1);
      expect(loadedGame?.getCurrentState().getMoveHistory()).toHaveLength(1);
    });

    it('should save after undo operations', () => {
      const game = new Game({ boardSize: 7 });
      const settings = new Settings();
      
      // Set up auto-save
      game.on('undo', () => {
        StorageManager.save(game, settings);
      });
      
      // Make moves
      game.placePiece(new Vector3(3, 3, 3));
      game.placePiece(new Vector3(4, 4, 4));
      
      // Undo
      game.undo();
      
      // Verify save was called
      expect(localStorage.setItem).toHaveBeenCalled();
      
      // Load and verify
      const loadedGame = StorageManager.loadGame();
      expect(loadedGame?.getCurrentState().getPieces()).toHaveLength(1);
    });

    it('should save after redo operations', () => {
      const game = new Game({ boardSize: 7 });
      const settings = new Settings();
      
      // Set up auto-save
      game.on('redo', () => {
        StorageManager.save(game, settings);
      });
      
      // Make moves and undo
      game.placePiece(new Vector3(3, 3, 3));
      game.placePiece(new Vector3(4, 4, 4));
      game.undo();
      
      // Redo
      game.redo();
      
      // Verify save was called
      expect(localStorage.setItem).toHaveBeenCalled();
      
      // Load and verify
      const loadedGame = StorageManager.loadGame();
      expect(loadedGame?.getCurrentState().getPieces()).toHaveLength(2);
    });

    it('should save after reset', () => {
      const game = new Game({ boardSize: 7 });
      const settings = new Settings();
      
      // Set up auto-save
      game.on('reset', () => {
        StorageManager.save(game, settings);
      });
      
      // Make moves
      game.placePiece(new Vector3(3, 3, 3));
      game.placePiece(new Vector3(4, 4, 4));
      
      // Reset
      game.reset();
      
      // Verify save was called
      expect(localStorage.setItem).toHaveBeenCalled();
      
      // Load and verify
      const loadedGame = StorageManager.loadGame();
      expect(loadedGame?.getCurrentState().getPieces()).toHaveLength(0);
    });
  });

  describe('Game restoration', () => {
    it('should restore complete game state', () => {
      const originalGame = new Game({ boardSize: 9 });
      const settings = new Settings();
      
      // Make several moves
      originalGame.placePiece(new Vector3(4, 4, 4));
      originalGame.placePiece(new Vector3(3, 3, 3));
      originalGame.placePiece(new Vector3(5, 5, 5));
      
      // Save the game
      StorageManager.save(originalGame, settings);
      
      // Load the game
      const restoredGame = StorageManager.loadGame();
      
      expect(restoredGame).toBeTruthy();
      expect(restoredGame?.getBoardSize()).toBe(9);
      expect(restoredGame?.getCurrentState().getPieces()).toHaveLength(3);
      expect(restoredGame?.getCurrentState().getMoveNumber()).toBe(3);
      expect(restoredGame?.getCurrentState().getCurrentPlayer().getId()).toBe(2);
    });

    it('should restore game with history', () => {
      const originalGame = new Game({ boardSize: 7 });
      const settings = new Settings();
      
      // Make moves and create history
      originalGame.placePiece(new Vector3(3, 3, 3));
      originalGame.placePiece(new Vector3(4, 4, 4));
      originalGame.undo();
      originalGame.placePiece(new Vector3(2, 2, 2));
      
      // Save
      StorageManager.save(originalGame, settings);
      
      // Load
      const restoredGame = StorageManager.loadGame();
      
      expect(restoredGame).toBeTruthy();
      expect(restoredGame?.canRedo()).toBe(false);
      expect(restoredGame?.canUndo()).toBe(true);
      expect(restoredGame?.getHistoryLength()).toBe(3);
    });

    it('should handle corrupted save gracefully', () => {
      // Save corrupted data
      mockLocalStorage['pente3d_data'] = JSON.stringify({
        version: 1,
        games: [{
          id: 'current',
          state: { invalid: 'data' },
          timestamp: Date.now()
        }],
        settings: {}
      });
      
      // Should return null, not throw
      const restoredGame = StorageManager.loadGame();
      expect(restoredGame).toBeNull();
    });
  });

  describe('Settings persistence', () => {
    it('should persist settings changes', () => {
      const settings = new Settings();
      const game = new Game({ boardSize: 7 });
      
      // Change settings
      settings.setGridDiagonals(true);
      settings.setPlayerColor(1, '#FF0000');
      settings.setPlayerColor(2, '#0000FF');
      settings.setSoundEnabled(false);
      settings.setAnimationSpeed(2.0);
      settings.setCameraPosition({ x: 10, y: 20, z: 30 });
      
      // Save
      StorageManager.save(game, settings);
      
      // Load and verify
      const loadedSettings = StorageManager.loadSettings();
      
      expect(loadedSettings.getGridDiagonals()).toBe(true);
      expect(loadedSettings.getPlayerColor(1)).toBe('#FF0000');
      expect(loadedSettings.getPlayerColor(2)).toBe('#0000FF');
      expect(loadedSettings.getSoundEnabled()).toBe(false);
      expect(loadedSettings.getAnimationSpeed()).toBe(2.0);
      expect(loadedSettings.getCameraPosition()).toEqual({ x: 10, y: 20, z: 30 });
    });

    it('should notify listeners when settings change', () => {
      const settings = new Settings();
      const game = new Game({ boardSize: 7 });
      const saveListener = jest.fn();
      
      // Mock save
      settings.addChangeListener(() => {
        saveListener();
        StorageManager.save(game, settings);
      });
      
      // Change setting
      settings.setGridDiagonals(true);
      
      expect(saveListener).toHaveBeenCalled();
      expect(localStorage.setItem).toHaveBeenCalled();
    });
  });

  describe('Multiple saved games', () => {
    it('should manage multiple saved games', () => {
      const game1 = new Game({ boardSize: 7 });
      const game2 = new Game({ boardSize: 9 });
      const game3 = new Game({ boardSize: 11 });
      
      // Save multiple games
      game1.placePiece(new Vector3(3, 3, 3));
      const id1 = StorageManager.saveGame(game1, 'Small Board Game');
      
      game2.placePiece(new Vector3(4, 4, 4));
      game2.placePiece(new Vector3(5, 5, 5));
      const id2 = StorageManager.saveGame(game2, 'Medium Board Game');
      
      game3.placePiece(new Vector3(5, 5, 5));
      game3.placePiece(new Vector3(6, 6, 6));
      game3.placePiece(new Vector3(7, 7, 7));
      const id3 = StorageManager.saveGame(game3, 'Large Board Game');
      
      // List saved games
      const savedGames = StorageManager.listSavedGames();
      expect(savedGames).toHaveLength(3);
      
      // Load specific games
      const loaded1 = StorageManager.loadSavedGame(id1);
      expect(loaded1?.getBoardSize()).toBe(7);
      expect(loaded1?.getCurrentState().getPieces()).toHaveLength(1);
      
      const loaded2 = StorageManager.loadSavedGame(id2);
      expect(loaded2?.getBoardSize()).toBe(9);
      expect(loaded2?.getCurrentState().getPieces()).toHaveLength(2);
      
      const loaded3 = StorageManager.loadSavedGame(id3);
      expect(loaded3?.getBoardSize()).toBe(11);
      expect(loaded3?.getCurrentState().getPieces()).toHaveLength(3);
    });

    it('should handle game deletion', () => {
      const game = new Game({ boardSize: 7 });
      
      const id1 = StorageManager.saveGame(game, 'Game 1');
      const id2 = StorageManager.saveGame(game, 'Game 2');
      const id3 = StorageManager.saveGame(game, 'Game 3');
      
      expect(StorageManager.listSavedGames()).toHaveLength(3);
      
      StorageManager.deleteSavedGame(id2);
      
      const remaining = StorageManager.listSavedGames();
      expect(remaining).toHaveLength(2);
      expect(remaining.find(g => g.id === id2)).toBeUndefined();
    });
  });

  describe('Performance', () => {
    it('should save and load large games efficiently', () => {
      const game = new Game({ boardSize: 11 });
      const settings = new Settings();
      
      // Make many moves
      const positions = [];
      for (let x = 0; x < 11; x++) {
        for (let y = 0; y < 11; y++) {
          positions.push(new Vector3(x, y, 5));
        }
      }
      
      // Shuffle and play first 50 moves
      positions.sort(() => Math.random() - 0.5);
      positions.slice(0, 50).forEach(pos => {
        game.placePiece(pos);
      });
      
      const saveStart = performance.now();
      StorageManager.save(game, settings);
      const saveTime = performance.now() - saveStart;
      
      const loadStart = performance.now();
      const loaded = StorageManager.loadGame();
      const loadTime = performance.now() - loadStart;
      
      expect(loaded?.getCurrentState().getPieces()).toHaveLength(50);
      expect(saveTime).toBeLessThan(100); // Should save in less than 100ms
      expect(loadTime).toBeLessThan(100); // Should load in less than 100ms
    });

    it('should handle storage size efficiently', () => {
      const game = new Game({ boardSize: 7 });
      
      // Save many games
      for (let i = 0; i < 15; i++) {
        game.placePiece(new Vector3(i % 7, Math.floor(i / 7) % 7, 0));
        StorageManager.saveGame(game, `Game ${i}`);
      }
      
      // Should only keep the limit (10 + current = 11 max)
      const data = JSON.parse(mockLocalStorage['pente3d_data']);
      expect(data.games.length).toBeLessThanOrEqual(11);
      
      // Size should be reasonable
      const size = StorageManager.getStorageSize();
      expect(size).toBeLessThan(100000); // Less than 100KB
    });
  });
});