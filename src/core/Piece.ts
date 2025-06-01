import { IPiece, IVector3, IPlayer, PieceType } from '@/types';
import { Vector3 } from './Vector3';
import { Player } from './Player';

export class Piece implements IPiece {
  public readonly coords: Vector3;
  public readonly player: Player;
  public readonly isTemporary: boolean;
  public readonly placedAt: number;

  constructor(
    coords: Vector3 | IVector3,
    player: Player | IPlayer,
    isTemporary: boolean = false,
    placedAt?: number
  ) {
    // Validation
    if (!coords) {
      throw new Error('Piece coordinates are required');
    }
    
    if (!player) {
      throw new Error('Piece player is required');
    }

    // Convert to our types
    this.coords = coords instanceof Vector3 ? coords : Vector3.fromObject(coords);
    this.player = player instanceof Player ? player : new Player(
      player.id, 
      player.color, 
      player.isLocal
    );
    
    this.isTemporary = isTemporary;
    this.placedAt = placedAt || Date.now();
  }

  // Factory methods
  static createNormal(coords: Vector3 | IVector3, player: Player | IPlayer): Piece {
    return new Piece(coords, player, false);
  }

  static createTemporary(coords: Vector3 | IVector3, player: Player | IPlayer): Piece {
    return new Piece(coords, player, true);
  }

  // Getters
  getCoords(): Vector3 {
    return this.coords;
  }

  getPlayer(): Player {
    return this.player;
  }

  getType(): PieceType {
    return this.isTemporary ? 'temporary' : 'normal';
  }

  // State queries
  isPermanent(): boolean {
    return !this.isTemporary;
  }

  belongsTo(player: Player | IPlayer): boolean {
    return this.player.equals(player);
  }

  isAt(coords: Vector3 | IVector3): boolean {
    return this.coords.equals(coords);
  }

  // Transformations
  makeTemporary(): Piece {
    if (this.isTemporary) {
      return this;
    }
    return new Piece(this.coords, this.player, true, this.placedAt);
  }

  makePermanent(): Piece {
    if (!this.isTemporary) {
      return this;
    }
    return new Piece(this.coords, this.player, false, Date.now());
  }

  moveTo(newCoords: Vector3 | IVector3): Piece {
    const coords = newCoords instanceof Vector3 ? newCoords : Vector3.fromObject(newCoords);
    return new Piece(coords, this.player, this.isTemporary, this.placedAt);
  }

  // Validation
  isValid(): boolean {
    try {
      // Basic validation
      if (!this.coords || !this.player) {
        return false;
      }

      // Timestamp validation
      if (this.placedAt <= 0 || this.placedAt > Date.now() + 1000) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  // Comparison
  equals(other: Piece | IPiece): boolean {
    return (
      this.coords.equals(other.coords) &&
      this.player.equals(other.player) &&
      this.isTemporary === other.isTemporary
    );
  }

  toString(): string {
    const type = this.isTemporary ? 'temporary' : 'permanent';
    return `Piece(${this.coords.toString()}, ${this.player.id}, ${type})`;
  }

  toJSON(): IPiece {
    return {
      coords: this.coords.toJSON(),
      player: this.player.toJSON(),
      isTemporary: this.isTemporary,
    };
  }

  // Immutability
  clone(): Piece {
    return new Piece(
      this.coords.clone(),
      this.player.clone(),
      this.isTemporary,
      this.placedAt
    );
  }
}