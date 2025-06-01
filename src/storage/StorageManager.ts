import { Game } from '@/core/Game';
import { Settings } from './Settings';

export interface StorageData {
  version: number;
  games: SavedGame[];
  settings: SettingsData;
}

export interface SavedGame {
  id: string;
  state: any;
  timestamp: number;
  name?: string;
}

export interface SettingsData {
  gridDiagonals: boolean;
  playerColors: {
    player1: string;
    player2: string;
  };
  cameraPosition?: {
    x: number;
    y: number;
    z: number;
  };
  soundEnabled: boolean;
  animationSpeed: number;
}

export class StorageManager {
  private static readonly STORAGE_KEY = 'pente3d_data';
  private static readonly CURRENT_VERSION = 1;
  private static readonly MAX_SAVED_GAMES = 10;
  private static readonly STORAGE_QUOTA_WARNING = 0.8;

  static save(game: Game, settings: Settings): void {
    try {
      const data = this.loadData();
      
      const savedGame: SavedGame = {
        id: 'current',
        state: game.toJSON(),
        timestamp: Date.now(),
        name: 'Current Game'
      };
      
      const existingIndex = data.games.findIndex(g => g.id === 'current');
      if (existingIndex >= 0) {
        data.games[existingIndex] = savedGame;
      } else {
        data.games.unshift(savedGame);
      }
      
      this.enforceGameLimit(data);
      
      data.settings = settings.toJSON();
      
      const serialized = JSON.stringify(data);
      localStorage.setItem(this.STORAGE_KEY, serialized);
      
      this.checkStorageQuota();
    } catch (error) {
      console.error('Failed to save game:', error);
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        this.handleQuotaExceeded();
      }
    }
  }

  static loadGame(): Game | null {
    try {
      const data = this.loadData();
      const currentGame = data.games.find(g => g.id === 'current');
      
      if (!currentGame) {
        return null;
      }
      
      return Game.fromJSON(currentGame.state);
    } catch (error) {
      console.error('Failed to load game:', error);
      return null;
    }
  }

  static loadSettings(): Settings {
    try {
      const data = this.loadData();
      return Settings.fromJSON(data.settings);
    } catch (error) {
      console.error('Failed to load settings:', error);
      return new Settings();
    }
  }

  static saveGame(game: Game, name: string): string {
    try {
      const data = this.loadData();
      
      const id = `game_${Date.now()}`;
      const savedGame: SavedGame = {
        id,
        state: game.toJSON(),
        timestamp: Date.now(),
        name
      };
      
      data.games.push(savedGame);
      this.enforceGameLimit(data);
      
      const serialized = JSON.stringify(data);
      localStorage.setItem(this.STORAGE_KEY, serialized);
      
      return id;
    } catch (error) {
      console.error('Failed to save named game:', error);
      throw error;
    }
  }

  static listSavedGames(): SavedGame[] {
    try {
      const data = this.loadData();
      return data.games.filter(g => g.id !== 'current');
    } catch (error) {
      console.error('Failed to list saved games:', error);
      return [];
    }
  }

  static loadSavedGame(id: string): Game | null {
    try {
      const data = this.loadData();
      const savedGame = data.games.find(g => g.id === id);
      
      if (!savedGame) {
        return null;
      }
      
      return Game.fromJSON(savedGame.state);
    } catch (error) {
      console.error('Failed to load saved game:', error);
      return null;
    }
  }

  static deleteSavedGame(id: string): void {
    try {
      const data = this.loadData();
      data.games = data.games.filter(g => g.id !== id);
      
      const serialized = JSON.stringify(data);
      localStorage.setItem(this.STORAGE_KEY, serialized);
    } catch (error) {
      console.error('Failed to delete saved game:', error);
    }
  }

  static clearAll(): void {
    localStorage.removeItem(this.STORAGE_KEY);
  }

  static getStorageSize(): number {
    const data = localStorage.getItem(this.STORAGE_KEY);
    return data ? new Blob([data]).size : 0;
  }

  static async getStorageQuota(): Promise<{ usage: number; quota: number }> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate();
        return {
          usage: estimate.usage || 0,
          quota: estimate.quota || 0
        };
      } catch {
        return { usage: 0, quota: 0 };
      }
    }
    return { usage: 0, quota: 0 };
  }

  private static loadData(): StorageData {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) {
        return this.createEmptyData();
      }
      
      const data = JSON.parse(stored);
      
      if (data.version !== this.CURRENT_VERSION) {
        return this.migrateData(data);
      }
      
      return data;
    } catch (error) {
      console.error('Failed to parse storage data:', error);
      return this.createEmptyData();
    }
  }

  private static createEmptyData(): StorageData {
    return {
      version: this.CURRENT_VERSION,
      games: [],
      settings: new Settings().toJSON()
    };
  }

  private static migrateData(oldData: any): StorageData {
    console.log('Migrating storage data from version', oldData.version);
    
    const newData = this.createEmptyData();
    
    if (oldData.games && Array.isArray(oldData.games)) {
      newData.games = oldData.games.filter((game: any) => {
        try {
          return game && game.state && game.id;
        } catch {
          return false;
        }
      });
    }
    
    if (oldData.settings) {
      try {
        newData.settings = Settings.fromJSON(oldData.settings).toJSON();
      } catch {
        console.warn('Failed to migrate settings, using defaults');
      }
    }
    
    return newData;
  }

  private static enforceGameLimit(data: StorageData): void {
    const nonCurrentGames = data.games.filter(g => g.id !== 'current');
    if (nonCurrentGames.length > this.MAX_SAVED_GAMES) {
      nonCurrentGames.sort((a, b) => b.timestamp - a.timestamp);
      const toKeep = nonCurrentGames.slice(0, this.MAX_SAVED_GAMES);
      const current = data.games.find(g => g.id === 'current');
      data.games = current ? [current, ...toKeep] : toKeep;
    }
  }

  private static async checkStorageQuota(): Promise<void> {
    const quota = await this.getStorageQuota();
    if (quota.quota > 0) {
      const usageRatio = quota.usage / quota.quota;
      if (usageRatio > this.STORAGE_QUOTA_WARNING) {
        console.warn(`Storage usage is at ${(usageRatio * 100).toFixed(1)}% of quota`);
      }
    }
  }

  private static handleQuotaExceeded(): void {
    const data = this.loadData();
    
    const nonCurrentGames = data.games.filter(g => g.id !== 'current');
    if (nonCurrentGames.length > 1) {
      nonCurrentGames.sort((a, b) => a.timestamp - b.timestamp);
      data.games = data.games.filter(g => g.id !== nonCurrentGames[0].id);
      
      try {
        const serialized = JSON.stringify(data);
        localStorage.setItem(this.STORAGE_KEY, serialized);
        console.log('Removed oldest saved game to free up space');
      } catch (error) {
        console.error('Failed to free up storage space:', error);
      }
    }
  }
}