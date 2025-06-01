// Core game types
export type PlayerColor = 'black' | 'white';
export type PieceType = 'normal' | 'temporary';

// Game state types
export interface IVector3 {
  x: number;
  y: number;
  z: number;
}

export interface IPlayer {
  id: string;
  color: PlayerColor;
  isLocal: boolean;
  captures: number;
}

export interface IMove {
  coords: IVector3;
  player: IPlayer;
  timestamp: number;
  capturedPieces: IVector3[];
}

export interface IPiece {
  coords: IVector3;
  player: IPlayer;
  isTemporary: boolean;
}

// Utility types
export type Coordinates = [number, number, number];
export type Direction = IVector3;