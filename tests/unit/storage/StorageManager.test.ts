import { StorageManager } from '@/storage/StorageManager';
import { Settings } from '@/storage/Settings';
import { Game } from '@/core/Game';

describe('StorageManager', () => {
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

  describe('save and loadGame', () => {
    it('should save and load a game', () => {
      const game = new Game({ boardSize: 7 });
      const settings = new Settings();

      StorageManager.save(game, settings);
      
      expect(localStorage.setItem).toHaveBeenCalled();
      const savedData = JSON.parse(mockLocalStorage['pente3d_data']);
      
      expect(savedData.version).toBe(1);
      expect(savedData.games).toHaveLength(1);
      expect(savedData.games[0].id).toBe('current');
      expect(savedData.settings).toBeDefined();
    });

    it('should load a saved game', () => {
      const game = new Game({ boardSize: 7 });
      const settings = new Settings();
      
      StorageManager.save(game, settings);
      const loadedGame = StorageManager.loadGame();
      
      expect(loadedGame).toBeTruthy();
      expect(loadedGame?.getBoardSize()).toBe(7);
    });

    it('should return null when no game is saved', () => {
      const loadedGame = StorageManager.loadGame();
      expect(loadedGame).toBeNull();
    });

    it('should handle corrupted save data gracefully', () => {
      mockLocalStorage['pente3d_data'] = 'invalid json';
      
      const loadedGame = StorageManager.loadGame();
      expect(loadedGame).toBeNull();
    });

    it('should update existing current game', () => {
      const game1 = new Game({ boardSize: 7 });
      const game2 = new Game({ boardSize: 9 });
      const settings = new Settings();

      StorageManager.save(game1, settings);
      StorageManager.save(game2, settings);

      const savedData = JSON.parse(mockLocalStorage['pente3d_data']);
      expect(savedData.games).toHaveLength(1);
      expect(savedData.games[0].state.boardSize).toBe(9);
    });
  });

  describe('loadSettings', () => {
    it('should load saved settings', () => {
      const settings = new Settings({
        gridDiagonals: true,
        soundEnabled: false,
        animationSpeed: 2.0
      });
      const game = new Game({ boardSize: 7 });
      
      StorageManager.save(game, settings);
      const loadedSettings = StorageManager.loadSettings();
      
      expect(loadedSettings.getGridDiagonals()).toBe(true);
      expect(loadedSettings.getSoundEnabled()).toBe(false);
      expect(loadedSettings.getAnimationSpeed()).toBe(2.0);
    });

    it('should return default settings when none are saved', () => {
      const loadedSettings = StorageManager.loadSettings();
      
      expect(loadedSettings.getGridDiagonals()).toBe(false);
      expect(loadedSettings.getSoundEnabled()).toBe(true);
      expect(loadedSettings.getAnimationSpeed()).toBe(1.0);
    });
  });

  describe('saveGame and listSavedGames', () => {
    it('should save a named game', () => {
      const game = new Game({ boardSize: 7 });
      const id = StorageManager.saveGame(game, 'Test Game');
      
      expect(id).toMatch(/^game_\d+$/);
      
      const savedGames = StorageManager.listSavedGames();
      expect(savedGames).toHaveLength(1);
      expect(savedGames[0].name).toBe('Test Game');
    });

    it('should not include current game in saved games list', () => {
      const game = new Game({ boardSize: 7 });
      const settings = new Settings();
      
      StorageManager.save(game, settings);
      StorageManager.saveGame(game, 'Named Game');
      
      const savedGames = StorageManager.listSavedGames();
      expect(savedGames).toHaveLength(1);
      expect(savedGames[0].name).toBe('Named Game');
    });

    it('should enforce game limit', () => {
      const game = new Game({ boardSize: 7 });
      
      // Save more than the limit (10)
      for (let i = 0; i < 12; i++) {
        StorageManager.saveGame(game, `Game ${i}`);
      }
      
      const savedGames = StorageManager.listSavedGames();
      expect(savedGames.length).toBeLessThanOrEqual(10);
    });
  });

  describe('loadSavedGame and deleteSavedGame', () => {
    it('should load a specific saved game', () => {
      const game = new Game({ boardSize: 9 });
      const id = StorageManager.saveGame(game, 'Test Game');
      
      const loadedGame = StorageManager.loadSavedGame(id);
      expect(loadedGame).toBeTruthy();
      expect(loadedGame?.getBoardSize()).toBe(9);
    });

    it('should return null for non-existent game id', () => {
      const loadedGame = StorageManager.loadSavedGame('non_existent_id');
      expect(loadedGame).toBeNull();
    });

    it('should delete a saved game', () => {
      const game = new Game({ boardSize: 7 });
      const id = StorageManager.saveGame(game, 'Test Game');
      
      StorageManager.deleteSavedGame(id);
      
      const savedGames = StorageManager.listSavedGames();
      expect(savedGames).toHaveLength(0);
    });
  });

  describe('clearAll', () => {
    it('should clear all storage data', () => {
      const game = new Game({ boardSize: 7 });
      const settings = new Settings();
      
      StorageManager.save(game, settings);
      StorageManager.clearAll();
      
      expect(localStorage.removeItem).toHaveBeenCalledWith('pente3d_data');
      expect(mockLocalStorage['pente3d_data']).toBeUndefined();
    });
  });

  describe('storage size and quota', () => {
    it('should calculate storage size', () => {
      const game = new Game({ boardSize: 7 });
      const settings = new Settings();
      
      StorageManager.save(game, settings);
      const size = StorageManager.getStorageSize();
      
      expect(size).toBeGreaterThan(0);
    });

    it('should get storage quota', async () => {
      const quota = await StorageManager.getStorageQuota();
      
      expect(quota.usage).toBe(1000);
      expect(quota.quota).toBe(10000);
    });

    it('should handle quota exceeded error', () => {
      const game = new Game({ boardSize: 7 });
      const settings = new Settings();
      
      // Save some games first
      StorageManager.saveGame(game, 'Game 1');
      StorageManager.saveGame(game, 'Game 2');
      
      // Mock quota exceeded error
      (localStorage.setItem as jest.Mock).mockImplementationOnce(() => {
        const error = new DOMException('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      });
      
      // This should not throw, but handle the error gracefully
      expect(() => StorageManager.save(game, settings)).not.toThrow();
    });
  });

  describe('data migration', () => {
    it('should migrate old data format', () => {
      // Simulate old format data
      const oldData = {
        version: 0,
        games: [
          {
            id: 'old_game',
            state: { boardSize: 7 },
            timestamp: Date.now()
          }
        ],
        settings: {
          gridDiagonals: true
        }
      };
      
      mockLocalStorage['pente3d_data'] = JSON.stringify(oldData);
      
      const settings = StorageManager.loadSettings();
      expect(settings.getGridDiagonals()).toBe(true);
      
      const games = StorageManager.listSavedGames();
      expect(games.length).toBeGreaterThan(0);
    });

    it('should handle invalid games during migration', () => {
      const oldData = {
        version: 0,
        games: [
          { id: 'valid', state: { boardSize: 7 }, timestamp: Date.now() },
          { id: 'invalid' }, // Missing state
          null, // Null game
          { state: { boardSize: 7 } } // Missing id
        ],
        settings: {}
      };
      
      mockLocalStorage['pente3d_data'] = JSON.stringify(oldData);
      
      const games = StorageManager.listSavedGames();
      expect(games).toHaveLength(1);
      expect(games[0].id).toBe('valid');
    });
  });

  describe('error handling', () => {
    it('should handle localStorage not available', () => {
      (localStorage.getItem as jest.Mock).mockImplementation(() => {
        throw new Error('localStorage not available');
      });
      
      const game = StorageManager.loadGame();
      expect(game).toBeNull();
    });

    it('should handle JSON parse errors', () => {
      mockLocalStorage['pente3d_data'] = '{invalid json}';
      
      const settings = StorageManager.loadSettings();
      expect(settings).toBeTruthy();
      expect(settings.getGridDiagonals()).toBe(false); // Default value
    });

    it('should continue after save errors', () => {
      const game = new Game({ boardSize: 7 });
      const settings = new Settings();
      
      (localStorage.setItem as jest.Mock).mockImplementation(() => {
        throw new Error('Storage error');
      });
      
      // Should not throw
      expect(() => StorageManager.save(game, settings)).not.toThrow();
    });
  });
});