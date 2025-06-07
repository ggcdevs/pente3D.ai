// Core game types
export type PlayerColor = 'black' | 'white';
export type PieceType = 'normal' | 'temporary';
export type BoardSize = 7 | 9 | 11;

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

export interface IBoard {
  size: BoardSize;
  pieces: Map<string, IPiece>;
}

export interface ILine {
  coords: IVector3[];
  direction: IVector3;
  isComplete: boolean;
}

export interface IWinResult {
  winner: IPlayer | null;
  winningLine: ILine | null;
  winType: 'five-in-a-row' | 'captures' | null;
}

// 3D direction vectors for all 26 directions
export const DIRECTIONS_3D: IVector3[] = [
  // Face directions (6)
  { x: 1, y: 0, z: 0 }, // Right
  { x: -1, y: 0, z: 0 }, // Left
  { x: 0, y: 1, z: 0 }, // Up
  { x: 0, y: -1, z: 0 }, // Down
  { x: 0, y: 0, z: 1 }, // Forward
  { x: 0, y: 0, z: -1 }, // Backward

  // Edge directions (12)
  { x: 1, y: 1, z: 0 }, // Right-Up
  { x: 1, y: -1, z: 0 }, // Right-Down
  { x: -1, y: 1, z: 0 }, // Left-Up
  { x: -1, y: -1, z: 0 }, // Left-Down
  { x: 1, y: 0, z: 1 }, // Right-Forward
  { x: 1, y: 0, z: -1 }, // Right-Backward
  { x: -1, y: 0, z: 1 }, // Left-Forward
  { x: -1, y: 0, z: -1 }, // Left-Backward
  { x: 0, y: 1, z: 1 }, // Up-Forward
  { x: 0, y: 1, z: -1 }, // Up-Backward
  { x: 0, y: -1, z: 1 }, // Down-Forward
  { x: 0, y: -1, z: -1 }, // Down-Backward

  // Corner directions (8)
  { x: 1, y: 1, z: 1 }, // Right-Up-Forward
  { x: 1, y: 1, z: -1 }, // Right-Up-Backward
  { x: 1, y: -1, z: 1 }, // Right-Down-Forward
  { x: 1, y: -1, z: -1 }, // Right-Down-Backward
  { x: -1, y: 1, z: 1 }, // Left-Up-Forward
  { x: -1, y: 1, z: -1 }, // Left-Up-Backward
  { x: -1, y: -1, z: 1 }, // Left-Down-Forward
  { x: -1, y: -1, z: -1 }, // Left-Down-Backward
];

// Utility types
export type Coordinates = [number, number, number];
export type Direction = IVector3;
export type CoordKey = string; // Format: "x,y,z"

// JSON serialization types
export interface BoardJSON {
  size: BoardSize;
  pieces: Record<string, unknown>;
}

export interface PieceJSON {
  coords: IVector3;
  player: unknown;
  isTemporary: boolean;
}

export interface PlayerJSON {
  id: string;
  color: PlayerColor;
  isLocal: boolean;
  connectionId?: string;
  captures: number;
}

export interface MoveJSON {
  coords: IVector3;
  player: unknown;
  timestamp?: number;
  capturedPieces: IVector3[];
}

export interface GameStateJSON {
  board: unknown;
  currentPlayerIndex: number;
  players: unknown[];
  moveHistory: unknown[];
  capturedPieces: Record<string, IVector3[]>;
  rules: unknown;
}

export interface GameJSON {
  version: string;
  metadata: {
    createdAt: string;
    boardSize: BoardSize;
    blackFirst: boolean;
  };
  gameData: {
    states: unknown[];
    currentIndex: number;
  };
}

export interface LineJSON {
  coords: IVector3[];
  direction: IVector3;
}

export interface WinResultJSON {
  winner: unknown;
  winningLine: unknown;
  winType: 'five-in-a-row' | 'captures' | null;
}
