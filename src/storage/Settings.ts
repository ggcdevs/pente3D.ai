import { SettingsData } from './StorageManager';

export interface SettingsChangeListener {
  (settings: Settings): void;
}

export class Settings {
  private gridDiagonals: boolean;
  private playerColors: {
    player1: string;
    player2: string;
  };
  private cameraPosition?: {
    x: number;
    y: number;
    z: number;
  };
  private soundEnabled: boolean;
  private animationSpeed: number;
  private listeners: SettingsChangeListener[] = [];

  constructor(data?: Partial<SettingsData>) {
    this.gridDiagonals = data?.gridDiagonals ?? false;
    this.playerColors = data?.playerColors ?? {
      player1: '#000000',
      player2: '#FFFFFF'
    };
    this.cameraPosition = data?.cameraPosition;
    this.soundEnabled = data?.soundEnabled ?? true;
    this.animationSpeed = data?.animationSpeed ?? 1.0;
  }

  getGridDiagonals(): boolean {
    return this.gridDiagonals;
  }

  setGridDiagonals(enabled: boolean): void {
    if (this.gridDiagonals !== enabled) {
      this.gridDiagonals = enabled;
      this.notifyListeners();
    }
  }

  getPlayerColor(player: 1 | 2): string {
    return player === 1 ? this.playerColors.player1 : this.playerColors.player2;
  }

  setPlayerColor(player: 1 | 2, color: string): void {
    const key = player === 1 ? 'player1' : 'player2';
    if (this.playerColors[key] !== color) {
      this.playerColors[key] = color;
      this.notifyListeners();
    }
  }

  getCameraPosition(): { x: number; y: number; z: number } | undefined {
    return this.cameraPosition ? { ...this.cameraPosition } : undefined;
  }

  setCameraPosition(position: { x: number; y: number; z: number } | undefined): void {
    this.cameraPosition = position ? { ...position } : undefined;
    this.notifyListeners();
  }

  getSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  setSoundEnabled(enabled: boolean): void {
    if (this.soundEnabled !== enabled) {
      this.soundEnabled = enabled;
      this.notifyListeners();
    }
  }

  getAnimationSpeed(): number {
    return this.animationSpeed;
  }

  setAnimationSpeed(speed: number): void {
    const clampedSpeed = Math.max(0.1, Math.min(5.0, speed));
    if (this.animationSpeed !== clampedSpeed) {
      this.animationSpeed = clampedSpeed;
      this.notifyListeners();
    }
  }

  reset(): void {
    this.gridDiagonals = false;
    this.playerColors = {
      player1: '#000000',
      player2: '#FFFFFF'
    };
    this.cameraPosition = undefined;
    this.soundEnabled = true;
    this.animationSpeed = 1.0;
    this.notifyListeners();
  }

  addChangeListener(listener: SettingsChangeListener): void {
    this.listeners.push(listener);
  }

  removeChangeListener(listener: SettingsChangeListener): void {
    const index = this.listeners.indexOf(listener);
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  toJSON(): SettingsData {
    return {
      gridDiagonals: this.gridDiagonals,
      playerColors: { ...this.playerColors },
      cameraPosition: this.cameraPosition ? { ...this.cameraPosition } : undefined,
      soundEnabled: this.soundEnabled,
      animationSpeed: this.animationSpeed
    };
  }

  static fromJSON(data: SettingsData): Settings {
    return new Settings(data);
  }

  clone(): Settings {
    return new Settings(this.toJSON());
  }

  equals(other: Settings): boolean {
    return (
      this.gridDiagonals === other.gridDiagonals &&
      this.playerColors.player1 === other.playerColors.player1 &&
      this.playerColors.player2 === other.playerColors.player2 &&
      this.soundEnabled === other.soundEnabled &&
      this.animationSpeed === other.animationSpeed &&
      this.cameraPositionsEqual(this.cameraPosition, other.cameraPosition)
    );
  }

  private cameraPositionsEqual(
    a: { x: number; y: number; z: number } | undefined,
    b: { x: number; y: number; z: number } | undefined
  ): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.x === b.x && a.y === b.y && a.z === b.z;
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this));
  }
}