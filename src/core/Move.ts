import type { IMove, IVector3, IPlayer } from '@/types';
import { Vector3 } from './Vector3';
import { Player } from './Player';

export class Move implements IMove {
  public readonly coords: Vector3;
  public readonly player: Player;
  public readonly timestamp: number;
  public readonly capturedPieces: Vector3[];

  constructor(
    coords: Vector3 | IVector3,
    player: Player | IPlayer,
    capturedPieces: (Vector3 | IVector3)[] = [],
    timestamp?: number
  ) {
    // Validation
    if (!coords) {
      throw new Error('Move coordinates are required');
    }

    if (!player) {
      throw new Error('Move player is required');
    }

    // Convert to our types
    this.coords = coords instanceof Vector3 ? coords : Vector3.fromObject(coords);
    this.player =
      player instanceof Player ? player : new Player(player.id, player.color, player.isLocal);

    this.capturedPieces = capturedPieces.map((piece) =>
      piece instanceof Vector3 ? piece : Vector3.fromObject(piece)
    );

    this.timestamp = timestamp || Date.now();

    // Validate captured pieces
    if (this.capturedPieces.length > 0 && this.capturedPieces.length % 2 !== 0) {
      throw new Error('Captured pieces must be in pairs');
    }
  }

  // Factory methods
  static create(
    coords: Vector3 | IVector3,
    playerId: string,
    capturedPieces: (Vector3 | IVector3)[] = [],
    timestamp?: number
  ): Move {
    // Create a minimal player object with just the ID
    const player = Player.createLocal(playerId, 'white');
    return new Move(coords, player, capturedPieces, timestamp);
  }

  static createSimple(coords: Vector3 | IVector3, player: Player | IPlayer): Move {
    return new Move(coords, player);
  }

  static createCapture(
    coords: Vector3 | IVector3,
    player: Player | IPlayer,
    capturedPieces: (Vector3 | IVector3)[]
  ): Move {
    return new Move(coords, player, capturedPieces);
  }

  // Utility methods
  isCapture(): boolean {
    return this.capturedPieces.length > 0;
  }

  getCaptureCount(): number {
    return this.capturedPieces.length;
  }

  getCoords(): Vector3 {
    return this.coords;
  }

  getPlayer(): Player {
    return this.player;
  }

  // Getter properties for compatibility
  get position(): Vector3 {
    return this.coords;
  }

  get playerId(): string {
    return this.player.id;
  }

  get capturedPositions(): Vector3[] {
    return this.capturedPieces;
  }

  getPosition(): Vector3 {
    return this.coords;
  }

  // Validation
  isValid(): boolean {
    try {
      // Basic validation
      if (!this.coords || !this.player) {
        return false;
      }

      // Timestamp validation
      if (this.timestamp <= 0 || this.timestamp > Date.now() + 1000) {
        return false;
      }

      // Capture validation
      if (this.capturedPieces.length % 2 !== 0) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  // Comparison
  equals(other: Move | IMove): boolean {
    return (
      this.coords.equals(other.coords) &&
      this.player.equals(other.player) &&
      this.timestamp === other.timestamp &&
      this.capturedPieces.length === other.capturedPieces.length &&
      this.capturedPieces.every((piece, index) => piece.equals(other.capturedPieces[index]))
    );
  }

  toString(): string {
    const captureInfo = this.isCapture() ? ` (captures ${this.getCaptureCount()})` : '';
    return `Move(${this.coords.toString()}, ${this.player.id}${captureInfo})`;
  }

  toJSON(): IMove {
    return {
      coords: this.coords.toJSON(),
      player: this.player.toJSON(),
      timestamp: this.timestamp,
      capturedPieces: this.capturedPieces.map((piece) => piece.toJSON()),
    };
  }

  // Immutability
  clone(): Move {
    return new Move(
      this.coords.clone(),
      this.player.clone(),
      this.capturedPieces.map((piece) => piece.clone()),
      this.timestamp
    );
  }

  // Deserialization
  static fromJSON(json: any): Move {
    if (!json || typeof json !== 'object') {
      throw new Error('Invalid JSON for Move');
    }

    return new Move(
      Vector3.fromObject(json.coords),
      Player.fromJSON ? Player.fromJSON(json.player) : json.player,
      json.capturedPieces?.map((p: any) => Vector3.fromObject(p)) || [],
      json.timestamp
    );
  }
}
