// Core data structures
export { Vector3 } from './Vector3';
export { Player } from './Player';
export { Move } from './Move';
export { Piece } from './Piece';
export { Board } from './Board';
export { Line } from './Line';
export { WinResult } from './WinResult';

// Game logic
export { GameRules } from './GameRules';
export { GameState } from './GameState';
export { Game } from './Game';

// Re-export types for convenience
export type {
  IVector3,
  IPlayer,
  IMove,
  IPiece,
  IBoard,
  ILine,
  IWinResult,
  PlayerColor,
  PieceType,
  BoardSize,
  Coordinates,
  Direction,
  CoordKey,
} from '@/types';

export { DIRECTIONS_3D } from '@/types';