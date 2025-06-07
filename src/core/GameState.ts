import { Board } from './Board';
import { Player } from './Player';
import { Move } from './Move';
import { Piece } from './Piece';
import { WinResult } from './WinResult';
import { GameRules } from './GameRules';
import { Vector3 } from './Vector3';
import type { BoardSize, PlayerColor } from '@/types';

/**
 * Immutable representation of the complete game state
 */
export class GameState {
  readonly board: Board;
  readonly players: Player[];
  readonly moveHistory: Move[];
  readonly currentPlayerIndex: number;
  readonly winResult: WinResult | null;
  readonly isGameOver: boolean;

  constructor(
    board: Board,
    players: Player[],
    moveHistory: Move[] = [],
    currentPlayerIndex: number = 0,
    winResult: WinResult | null = null
  ) {
    if (players.length < 2) {
      throw new Error('Game requires at least 2 players');
    }
    if (players.length > 4) {
      throw new Error('Game supports maximum 4 players');
    }
    if (currentPlayerIndex < 0 || currentPlayerIndex >= players.length) {
      throw new Error('Invalid current player index');
    }

    this.board = board;
    this.players = [...players]; // Defensive copy
    this.moveHistory = [...moveHistory]; // Defensive copy
    this.currentPlayerIndex = currentPlayerIndex;
    this.winResult = winResult;
    this.isGameOver = winResult !== null;
  }

  /**
   * Creates initial game state
   * @param boardSize Size of the board
   * @param playersOrFirstPlayer Array of players or first player color
   * @returns New game state
   */
  static createInitialState(
    boardSize: number,
    playersOrFirstPlayer: Player[] | 'black' | 'white'
  ): GameState {
    if (typeof playersOrFirstPlayer === 'string') {
      const blackPlayer = new Player('player1', 'black');
      const whitePlayer = new Player('player2', 'white');
      const players = [blackPlayer, whitePlayer];
      const board = Board.createEmpty(boardSize as BoardSize);
      const currentPlayerIndex = playersOrFirstPlayer === 'black' ? 0 : 1;
      return new GameState(board, players, [], currentPlayerIndex);
    } else {
      const board = Board.createEmpty(boardSize as BoardSize);
      return new GameState(board, playersOrFirstPlayer);
    }
  }

  /**
   * Applies a move to create new state
   * @param move Move to apply
   * @returns New game state or throws if invalid
   */
  applyMove(move: Move): GameState {
    if (this.isGameOver) {
      throw new Error('Cannot make moves after game is over');
    }

    // Validate the move
    if (!this.isValidMove(move)) {
      throw new Error('Invalid move');
    }

    // Apply the move to the board
    const piece = Piece.createNormal(move.position, move.player);
    let newBoard = this.board.placePiece(piece);

    // Detect captures
    const captures = GameRules.detectCaptures(newBoard, move);

    // Apply captures and update player stats
    const updatedPlayers = [...this.players];
    if (captures.length > 0) {
      // Remove captured pieces
      for (const capturePos of captures) {
        newBoard = newBoard.removePiece(capturePos);
      }

      // Update capture count for the current player
      const currentPlayer = this.getCurrentPlayer();
      const playerIndex = this.players.findIndex((p) => p.id === currentPlayer.id);
      updatedPlayers[playerIndex] = currentPlayer.addCaptures(captures.length / 2);

      // Create move with captures
      move = Move.create(move.position, move.playerId, captures, move.timestamp);
    }

    // Add move to history
    const newHistory = [...this.moveHistory, move];

    // Check win conditions
    const winResult = GameRules.checkWinConditions(newBoard, updatedPlayers, move);

    // Calculate next player index
    const nextPlayerIndex = winResult
      ? this.currentPlayerIndex // Game over, don't advance
      : (this.currentPlayerIndex + 1) % this.players.length;

    return new GameState(newBoard, updatedPlayers, newHistory, nextPlayerIndex, winResult);
  }

  /**
   * Gets the current player
   * @returns Current player
   */
  getCurrentPlayer(): Player {
    return this.players[this.currentPlayerIndex];
  }

  /**
   * Gets the winner of the game
   * @returns Winner's color or null if game not over
   */
  getWinner(): PlayerColor | null {
    return this.winResult?.getWinner() ?? null;
  }

  /**
   * Gets the win result
   * @returns Win result or null if game not over
   */
  getWinResult(): WinResult | null {
    return this.winResult;
  }

  /**
   * Gets the black player
   * @returns Black player
   */
  getBlackPlayer(): Player {
    const blackPlayer = this.players.find((p) => p.getColor() === 'black');
    if (!blackPlayer) {
      throw new Error('Black player not found');
    }
    return blackPlayer;
  }

  /**
   * Gets the white player
   * @returns White player
   */
  getWhitePlayer(): Player {
    const whitePlayer = this.players.find((p) => p.getColor() === 'white');
    if (!whitePlayer) {
      throw new Error('White player not found');
    }
    return whitePlayer;
  }

  /**
   * Gets the number of moves played
   * @returns Move count
   */
  getMoveCount(): number {
    return this.moveHistory.length;
  }

  /**
   * Gets the move history
   * @returns Readonly array of moves
   */
  getMoveHistory(): ReadonlyArray<Move> {
    return this.moveHistory;
  }

  /**
   * Gets the board
   * @returns The game board
   */
  getBoard(): Board {
    return this.board;
  }

  /**
   * Checks if a move is valid
   * @param move Move to validate
   * @returns true if valid
   */
  isValidMove(move: Move): boolean {
    return GameRules.isValidMove(this.board, move, this.getCurrentPlayer(), this.moveHistory);
  }

  /**
   * Generates a hash of the game state
   * @returns Hash string
   */
  generateHash(): string {
    const components = [
      // Board state
      this.board.toJSON(),
      // Player states (including captures)
      this.players.map((p) => ({ id: p.id, captures: p.captureCount })),
      // Move history (simplified)
      this.moveHistory.map((m) => ({
        pos: [m.position.x, m.position.y, m.position.z],
        player: m.playerId,
        captures: m.capturedPositions.length,
      })),
      // Current player
      this.currentPlayerIndex,
      // Win state
      this.winResult ? this.winResult.type : null,
    ];

    // Simple hash using JSON stringify
    // In production, use a proper hash function like SHA-256
    const jsonString = JSON.stringify(components);

    // Simple hash algorithm for demonstration
    let hash = 0;
    for (let i = 0; i < jsonString.length; i++) {
      const char = jsonString.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return hash.toString(16);
  }

  /**
   * Checks equality with another state
   * @param other Other game state
   * @returns true if states are equal
   */
  equals(other: GameState | null | undefined): boolean {
    if (!other) {
      return false;
    }
    if (this === other) {
      return true;
    }

    // Compare all properties
    return (
      this.board.equals(other.board) &&
      this.players.length === other.players.length &&
      this.players.every((p, i) => p.equals(other.players[i])) &&
      this.moveHistory.length === other.moveHistory.length &&
      this.moveHistory.every((m, i) => m.equals(other.moveHistory[i])) &&
      this.currentPlayerIndex === other.currentPlayerIndex &&
      ((this.winResult === null && other.winResult === null) ||
        (this.winResult !== null &&
          other.winResult !== null &&
          this.winResult.equals(other.winResult)))
    );
  }

  /**
   * Creates a deep clone
   * @returns Cloned game state
   */
  clone(): GameState {
    return new GameState(
      this.board.clone(),
      this.players.map((p) => p.clone()),
      this.moveHistory.map((m) => m.clone()),
      this.currentPlayerIndex,
      this.winResult ? this.winResult.clone() : null
    );
  }

  /**
   * Serializes to JSON
   * @returns JSON representation
   */
  toJSON(): object {
    return {
      board: this.board.toJSON(),
      players: this.players.map((p) => p.toJSON()),
      moveHistory: this.moveHistory.map((m) => m.toJSON()),
      currentPlayerIndex: this.currentPlayerIndex,
      winResult: this.winResult ? this.winResult.toJSON() : null,
      isGameOver: this.isGameOver,
    };
  }

  /**
   * Creates from JSON
   * @param json JSON object
   * @returns New game state
   */
  static fromJSON(json: any): GameState {
    if (!json || typeof json !== 'object') {
      throw new Error('Invalid JSON for GameState');
    }

    const board = Board.fromJSON(json.board);
    const players = json.players.map((p: any) => Player.fromJSON(p));
    const moveHistory = json.moveHistory.map((m: any) => Move.fromJSON(m));
    const winResult = json.winResult ? WinResult.fromJSON(json.winResult) : null;

    return new GameState(board, players, moveHistory, json.currentPlayerIndex, winResult);
  }

  /**
   * Gets all legal moves for the current player
   * @returns Array of legal positions
   */
  getLegalMoves(): Vector3[] {
    if (this.isGameOver) {
      return [];
    }

    const legalMoves: Vector3[] = [];
    const currentPlayer = this.getCurrentPlayer();
    const halfSize = Math.floor(this.board.size / 2);

    for (let x = -halfSize; x <= halfSize; x++) {
      for (let y = -halfSize; y <= halfSize; y++) {
        for (let z = -halfSize; z <= halfSize; z++) {
          const pos = Vector3.create(x, y, z);
          const move = Move.create(pos, currentPlayer.id);

          if (this.isValidMove(move)) {
            legalMoves.push(pos);
          }
        }
      }
    }

    return legalMoves;
  }

  /**
   * Creates a new state by undoing the last move
   * @returns New state with last move undone, or null if no moves
   */
  undoLastMove(): GameState | null {
    if (this.moveHistory.length === 0) {
      return null;
    }

    // Rebuild the game from scratch up to n-1 moves
    let state = GameState.createInitialState(this.board.size, this.players);

    for (let i = 0; i < this.moveHistory.length - 1; i++) {
      const move = this.moveHistory[i];
      state = state.applyMove(Move.create(move.position, move.playerId));
    }

    return state;
  }
}
