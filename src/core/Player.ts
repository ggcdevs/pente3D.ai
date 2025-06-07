import type { IPlayer, PlayerColor } from '@/types';

export class Player implements IPlayer {
  public readonly id: string;
  public readonly color: PlayerColor;
  public readonly isLocal: boolean;
  private _captures: number;
  public readonly connectionId?: string;

  constructor(id: string, color: PlayerColor, isLocal: boolean = true, connectionId?: string) {
    // Validation
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('Player ID must be a non-empty string');
    }

    if (!['black', 'white'].includes(color)) {
      throw new Error('Player color must be "black" or "white"');
    }

    this.id = id.trim();
    this.color = color;
    this.isLocal = isLocal;
    this._captures = 0;
    this.connectionId = connectionId;
  }

  // Factory methods
  static createLocal(id: string, color: PlayerColor): Player {
    return new Player(id, color, true);
  }

  static createRemote(id: string, color: PlayerColor, connectionId: string): Player {
    return new Player(id, color, false, connectionId);
  }

  // Getters
  get captures(): number {
    return this._captures;
  }

  get captureCount(): number {
    return this._captures;
  }

  getColor(): PlayerColor {
    return this.color;
  }

  getCaptureCount(): number {
    return this._captures;
  }

  // Game actions
  incrementCaptures(amount: number = 1): Player {
    if (amount < 0) {
      throw new Error('Capture increment must be non-negative');
    }

    const newPlayer = this.clone();
    newPlayer._captures = this._captures + amount;
    return newPlayer;
  }

  addCaptures(pairs: number): Player {
    return this.incrementCaptures(pairs);
  }

  resetCaptures(): Player {
    const newPlayer = this.clone();
    newPlayer._captures = 0;
    return newPlayer;
  }

  // Network status
  isConnected(): boolean {
    if (this.isLocal) {
      return true;
    }
    return !!this.connectionId;
  }

  // Utility methods
  equals(other: Player | IPlayer): boolean {
    return this.id === other.id && this.color === other.color;
  }

  toString(): string {
    return `Player(${this.id}, ${this.color}, captures: ${this.captures})`;
  }

  toJSON(): IPlayer {
    return {
      id: this.id,
      color: this.color,
      isLocal: this.isLocal,
      captures: this.captures,
    };
  }

  // Immutability
  clone(): Player {
    const cloned = new Player(this.id, this.color, this.isLocal, this.connectionId);
    cloned._captures = this._captures;
    return cloned;
  }

  // Deserialization
  static fromJSON(json: any): Player {
    if (!json || typeof json !== 'object') {
      throw new Error('Invalid JSON for Player');
    }

    const player = new Player(json.id, json.color, json.isLocal, json.connectionId);
    if (json.captures !== undefined) {
      player._captures = json.captures;
    }
    return player;
  }
}
