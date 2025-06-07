import { Board } from './Board';
import { Move } from './Move';
import { Player } from './Player';
import { Vector3 } from './Vector3';
import { Line } from './Line';
import { WinResult } from './WinResult';

/**
 * Handles all game rule validation and detection logic for 3D Pente
 */
export class GameRules {
  static readonly WIN_LENGTH = 5;
  static readonly CAPTURE_LENGTH = 2;
  static readonly CAPTURES_TO_WIN = 5;

  /**
   * Validates if a move is legal
   * @param board Current board state
   * @param move Move to validate
   * @param currentPlayer Player attempting the move
   * @param moveHistory Previous moves in the game
   * @returns true if move is valid
   */
  static isValidMove(
    board: Board,
    move: Move,
    currentPlayer: Player,
    moveHistory: Move[]
  ): boolean {
    // Null check
    if (!move) {
      return false;
    }

    // Check if position is within bounds
    if (!board.isInBounds(move.position)) {
      return false;
    }

    // Check if position is empty
    if (board.getPieceAt(move.position) !== null) {
      return false;
    }

    // Check if it's the correct player's turn
    const expectedPlayer = this.getCurrentPlayer([currentPlayer], moveHistory);
    if (!this.isCorrectPlayer(move, expectedPlayer)) {
      return false;
    }

    return true;
  }

  /**
   * Detects captures resulting from a move
   * @param board Board state after the move
   * @param move The move that was just made
   * @returns Array of captured piece positions
   */
  static detectCaptures(board: Board, move: Move): Vector3[] {
    const captures: Vector3[] = [];
    const piece = board.getPieceAt(move.position);

    if (!piece) {
      return captures;
    }

    // Get all 26 directions in 3D space
    const directions = this.get3DDirections();

    // Check each direction for capture pattern
    for (const dir of directions) {
      const capturedPositions = this.checkCaptureInDirection(
        board,
        move.position,
        dir,
        piece.player.id
      );
      captures.push(...capturedPositions);
    }

    return captures;
  }

  /**
   * Checks if the game has been won
   * @param board Current board state
   * @param players Array of players in the game
   * @param lastMove The most recent move
   * @returns WinResult if game is won, null otherwise
   */
  static checkWinConditions(
    board: Board,
    players: Player[],
    lastMove: Move | null
  ): WinResult | null {
    // Check for 5-in-a-row win
    for (const player of players) {
      const winningLine = this.checkFiveInARow(board, player, lastMove);
      if (winningLine) {
        return new WinResult(player, winningLine, 'five-in-a-row');
      }
    }

    // Check for capture win
    for (const player of players) {
      if (this.hasWonByCaptures(player)) {
        return new WinResult(player, null, 'captures');
      }
    }

    return null;
  }

  /**
   * Checks for 5-in-a-row win
   * @param board Current board state
   * @param player Player to check for
   * @param lastMove Optional last move for optimization
   * @returns Winning line if found, null otherwise
   */
  static checkFiveInARow(board: Board, player: Player, lastMove: Move | null): Line | null {
    const positions = lastMove ? [lastMove.position] : this.getAllPlayerPositions(board, player.id);

    for (const pos of positions) {
      const lines = this.getLinesFromPosition(board, pos, player.id);
      for (const line of lines) {
        if (line.positions.length >= this.WIN_LENGTH) {
          return line;
        }
      }
    }

    return null;
  }

  /**
   * Checks if a player has won by captures
   * @param player Player to check
   * @returns true if player has captured enough pairs
   */
  static hasWonByCaptures(player: Player): boolean {
    return player.captureCount >= this.CAPTURES_TO_WIN;
  }

  /**
   * Gets the current player based on move history
   * @param players Array of players
   * @param moveHistory Previous moves
   * @returns Current player
   */
  static getCurrentPlayer(players: Player[], moveHistory: Move[]): Player {
    if (players.length === 0) {
      throw new Error('No players provided');
    }

    const moveCount = moveHistory.length;
    const currentIndex = moveCount % players.length;
    return players[currentIndex];
  }

  /**
   * Validates player order
   * @param move Move to validate
   * @param currentPlayer Expected current player
   * @returns true if player is correct
   */
  static isCorrectPlayer(move: Move, currentPlayer: Player): boolean {
    return move.playerId === currentPlayer.id;
  }

  /**
   * Gets all 26 3D directions
   * @returns Array of direction vectors
   */
  private static get3DDirections(): Vector3[] {
    const directions: Vector3[] = [];

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue;
          directions.push(Vector3.create(x, y, z));
        }
      }
    }

    return directions;
  }

  /**
   * Checks for capture pattern in a direction
   * @param board Board state
   * @param position Starting position
   * @param direction Direction to check
   * @param playerId Player making the move
   * @returns Captured positions
   */
  private static checkCaptureInDirection(
    board: Board,
    position: Vector3,
    direction: Vector3,
    playerId: string
  ): Vector3[] {
    const captures: Vector3[] = [];

    // Check pattern: [current][opponent][opponent][player]
    const pos1 = position.add(direction);
    const pos2 = pos1.add(direction);
    const pos3 = pos2.add(direction);

    // Validate all positions are in bounds
    if (!board.isInBounds(pos1) || !board.isInBounds(pos2) || !board.isInBounds(pos3)) {
      return captures;
    }

    const piece1 = board.getPieceAt(pos1);
    const piece2 = board.getPieceAt(pos2);
    const piece3 = board.getPieceAt(pos3);

    // Check if pattern matches
    if (
      piece1 &&
      piece2 &&
      piece3 &&
      piece1.player.id !== playerId &&
      piece2.player.id !== playerId &&
      piece2.player.id === piece1.player.id &&
      piece3.player.id === playerId
    ) {
      captures.push(pos1, pos2);
    }

    return captures;
  }

  /**
   * Gets all positions occupied by a player
   * @param board Board state
   * @param playerId Player ID
   * @returns Array of positions
   */
  private static getAllPlayerPositions(board: Board, playerId: string): Vector3[] {
    const positions: Vector3[] = [];
    const halfSize = Math.floor(board.size / 2);

    for (let x = -halfSize; x <= halfSize; x++) {
      for (let y = -halfSize; y <= halfSize; y++) {
        for (let z = -halfSize; z <= halfSize; z++) {
          const pos = Vector3.create(x, y, z);
          const piece = board.getPieceAt(pos);
          if (piece && piece.player.id === playerId) {
            positions.push(pos);
          }
        }
      }
    }

    return positions;
  }

  /**
   * Gets all lines from a position for a player
   * @param board Board state
   * @param position Starting position
   * @param playerId Player ID
   * @returns Array of lines
   */
  private static getLinesFromPosition(board: Board, position: Vector3, playerId: string): Line[] {
    const lines: Line[] = [];
    const directions = this.get3DDirections();

    // Only check half the directions (positive ones) to avoid duplicates
    const halfDirections = directions.filter(
      (dir) => dir.x > 0 || (dir.x === 0 && dir.y > 0) || (dir.x === 0 && dir.y === 0 && dir.z > 0)
    );

    for (const dir of halfDirections) {
      const line = this.buildLineInDirection(board, position, dir, playerId);
      if (line.positions.length > 0) {
        lines.push(line);
      }
    }

    return lines;
  }

  /**
   * Builds a line in both directions from a position
   * @param board Board state
   * @param position Starting position
   * @param direction Direction vector
   * @param playerId Player ID
   * @returns Line object
   */
  private static buildLineInDirection(
    board: Board,
    position: Vector3,
    direction: Vector3,
    playerId: string
  ): Line {
    const positions: Vector3[] = [];

    // Go backwards first
    const negDir = direction.multiply(-1);
    let currentPos = position.add(negDir);

    while (board.isInBounds(currentPos)) {
      const piece = board.getPieceAt(currentPos);
      if (piece && piece.player.id === playerId) {
        positions.unshift(currentPos);
        currentPos = currentPos.add(negDir);
      } else {
        break;
      }
    }

    // Add the starting position
    positions.push(position);

    // Go forwards
    currentPos = position.add(direction);

    while (board.isInBounds(currentPos)) {
      const piece = board.getPieceAt(currentPos);
      if (piece && piece.player.id === playerId) {
        positions.push(currentPos);
        currentPos = currentPos.add(direction);
      } else {
        break;
      }
    }

    return new Line(positions, direction);
  }
}
