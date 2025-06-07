import { GameState } from './GameState';
import { Move } from './Move';
import { Vector3 } from './Vector3';
import { WinResult } from './WinResult';
import { Player } from './Player';
import type { PlayerColor } from '@/types';
import { logger } from '@/utils';

export type GameEvent =
  | { type: 'move'; move: Move; state: GameState }
  | { type: 'undo'; state: GameState }
  | { type: 'redo'; state: GameState }
  | { type: 'reset'; state: GameState }
  | { type: 'gameOver'; winner: PlayerColor; winResult: WinResult }
  | { type: 'historyNavigate'; state: GameState; moveIndex: number };

export type GameEventHandler = (event: GameEvent) => void;

export interface GameOptions {
  boardSize?: number;
  blackFirst?: boolean;
}

export interface SerializedGame {
  currentStateIndex: number;
  history: GameState[];
  options: GameOptions;
}

export interface ExportedGame {
  version: string;
  metadata: {
    exportedAt: string;
    gameName?: string;
    description?: string;
    boardSize: number;
    blackFirst: boolean;
    moveCount: number;
    winner: PlayerColor | null;
    winType?: 'five-in-a-row' | 'captures';
    captureCount: {
      black: number;
      white: number;
    };
  };
  gameData: {
    options: GameOptions;
    history: any[];
    currentStateIndex: number;
    compressionOptions?: HistoryCompressionOptions;
  };
}

export interface ExportedGameCollection {
  version: string;
  exportedAt: string;
  games: ExportedGame[];
}

export interface HistoryCompressionOptions {
  maxHistorySize?: number;
  compressionThreshold?: number;
}

export class Game {
  private history: GameState[] = [];
  private currentStateIndex: number = -1;
  private eventHandlers: Set<GameEventHandler> = new Set();
  private readonly options: Required<GameOptions>;
  private compressionOptions: HistoryCompressionOptions = {
    maxHistorySize: 1000,
    compressionThreshold: 500,
  };

  constructor(options: GameOptions = {}) {
    this.options = {
      boardSize: options.boardSize ?? 9,
      blackFirst: options.blackFirst ?? true,
    };

    const initialState = GameState.createInitialState(
      this.options.boardSize,
      this.options.blackFirst ? 'black' : 'white'
    );

    this.history.push(initialState);
    this.currentStateIndex = 0;
  }

  getCurrentState(): GameState {
    return this.history[this.currentStateIndex];
  }

  getHistory(): ReadonlyArray<GameState> {
    return this.history;
  }

  getCurrentStateIndex(): number {
    return this.currentStateIndex;
  }

  canUndo(): boolean {
    return this.currentStateIndex > 0;
  }

  canRedo(): boolean {
    return this.currentStateIndex < this.history.length - 1;
  }

  isGameOver(): boolean {
    return this.getCurrentState().getWinner() !== null;
  }

  getWinner(): PlayerColor | null {
    return this.getCurrentState().getWinner();
  }

  getWinResult(): WinResult | null {
    return this.getCurrentState().getWinResult();
  }

  placePiece(position: Vector3): boolean {
    const result = this.placePieceInternal(position);
    if (result) {
      this.compressHistory();
    }
    return result;
  }

  undo(): boolean {
    if (!this.canUndo()) {
      return false;
    }

    this.currentStateIndex--;
    const state = this.getCurrentState();
    this.emit({ type: 'undo', state });
    return true;
  }

  redo(): boolean {
    if (!this.canRedo()) {
      return false;
    }

    this.currentStateIndex++;
    const state = this.getCurrentState();
    this.emit({ type: 'redo', state });
    return true;
  }

  reset(): void {
    const initialState = GameState.createInitialState(
      this.options.boardSize,
      this.options.blackFirst ? 'black' : 'white'
    );

    this.history = [initialState];
    this.currentStateIndex = 0;

    this.emit({ type: 'reset', state: initialState });
  }

  exportGame(gameName?: string, description?: string): string {
    const currentState = this.getCurrentState();
    const exportData: ExportedGame = {
      version: '1.0.0',
      metadata: {
        exportedAt: new Date().toISOString(),
        gameName,
        description,
        boardSize: this.options.boardSize,
        blackFirst: this.options.blackFirst,
        moveCount: currentState.getMoveCount(),
        winner: currentState.getWinner(),
        winType: currentState.getWinResult()?.type as 'five-in-a-row' | 'captures' | undefined,
        captureCount: {
          black: currentState.getBlackPlayer().getCaptureCount(),
          white: currentState.getWhitePlayer().getCaptureCount(),
        },
      },
      gameData: {
        options: this.options,
        history: this.history.map((state) => state.toJSON()),
        currentStateIndex: this.currentStateIndex,
        compressionOptions: this.compressionOptions,
      },
    };
    return JSON.stringify(exportData, null, 2);
  }

  static importGame(jsonString: string): Game {
    try {
      const data = JSON.parse(jsonString);

      // Check if it's the new format
      if (data.version && data.metadata && data.gameData) {
        return Game.importFromExportedGame(data as ExportedGame);
      }

      // Fallback to old format
      return Game.fromJSON(data as SerializedGame);
    } catch (error) {
      throw new Error(
        `Failed to import game: ${error instanceof Error ? error.message : 'Invalid JSON'}`
      );
    }
  }

  private static importFromExportedGame(data: ExportedGame): Game {
    // Validate version compatibility
    const [major] = data.version.split('.').map(Number);
    if (major > 1) {
      throw new Error(
        `Unsupported game version: ${data.version}. This version supports up to 1.x.x`
      );
    }

    // Validate required fields
    if (
      !data.gameData ||
      !data.gameData.history ||
      typeof data.gameData.currentStateIndex !== 'number'
    ) {
      throw new Error('Invalid game data: missing required fields');
    }

    const game = new Game(data.gameData.options);

    // Restore history
    try {
      game.history = data.gameData.history.map((stateData: any) => GameState.fromJSON(stateData));
      game.currentStateIndex = data.gameData.currentStateIndex;

      // Validate state index
      if (game.currentStateIndex < 0 || game.currentStateIndex >= game.history.length) {
        throw new Error('Invalid current state index');
      }

      // Restore compression options
      if (data.gameData.compressionOptions) {
        game.compressionOptions = data.gameData.compressionOptions;
      }

      // Validate metadata matches actual game state
      const currentState = game.getCurrentState();
      if (data.metadata.moveCount !== currentState.getMoveCount()) {
        logger.warn('Metadata move count does not match actual game state', {
          metadataMoves: json.metadata?.totalMoves,
          actualMoves: game.getState().getMoveHistory().length,
        });
      }

      return game;
    } catch (error) {
      throw new Error(
        `Failed to restore game state: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // Event handling
  addEventListener(handler: GameEventHandler): void {
    this.eventHandlers.add(handler);
  }

  // Alias for addEventListener to match common event pattern
  on(event: string, handler: (data: any) => void): void {
    // Create a wrapper that filters by event type
    const wrapper: GameEventHandler = (gameEvent) => {
      if (event === 'move' && gameEvent.type === 'move') {
        handler({ move: gameEvent.move, state: gameEvent.state });
      } else if (event === 'gameOver' && gameEvent.type === 'gameOver') {
        handler({ winner: gameEvent.winner, winType: gameEvent.winResult.type });
      } else if (event === gameEvent.type) {
        handler(gameEvent);
      }
    };
    this.eventHandlers.add(wrapper);
  }

  removeEventListener(handler: GameEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  private emit(event: GameEvent): void {
    this.eventHandlers.forEach((handler) => handler(event));
  }

  // Helper methods for UI
  getCurrentPlayer(): Player {
    return this.getCurrentState().getCurrentPlayer();
  }

  getMoveCount(): number {
    return this.getCurrentState().getMoveCount();
  }

  getBoard() {
    return this.getCurrentState().getBoard();
  }

  getMoveHistory(): ReadonlyArray<Move> {
    return this.getCurrentState().getMoveHistory();
  }

  getOptions(): Readonly<Required<GameOptions>> {
    return this.options;
  }

  // Enhanced history navigation
  goToMove(moveIndex: number): boolean {
    if (moveIndex < 0 || moveIndex >= this.history.length) {
      return false;
    }

    const previousIndex = this.currentStateIndex;
    this.currentStateIndex = moveIndex;
    const state = this.getCurrentState();

    // Validate the state before applying
    if (!this.validateState(state)) {
      this.currentStateIndex = previousIndex;
      return false;
    }

    this.emit({ type: 'historyNavigate', state, moveIndex });
    return true;
  }

  getHistoryLength(): number {
    return this.history.length;
  }

  canGoToMove(moveIndex: number): boolean {
    return (
      moveIndex >= 0 && moveIndex < this.history.length && moveIndex !== this.currentStateIndex
    );
  }

  // State validation
  private validateState(state: GameState): boolean {
    try {
      // Validate board size matches
      if (state.getBoard().getSize() !== this.options.boardSize) {
        return false;
      }

      // Validate move count matches history position (index 0 = 0 moves, index 1 = 1 move, etc)
      const historyIndex = this.history.indexOf(state);
      if (historyIndex !== -1 && state.getMoveCount() !== historyIndex) {
        return false;
      }

      // Validate player captures are non-negative
      const players = [state.getBlackPlayer(), state.getWhitePlayer()];
      for (const player of players) {
        if (player.getCaptureCount() < 0) {
          return false;
        }
      }

      // Validate hash consistency - skip this for now as hash might change

      return true;
    } catch {
      return false;
    }
  }

  // History compression
  setCompressionOptions(options: HistoryCompressionOptions): void {
    this.compressionOptions = {
      ...this.compressionOptions,
      ...options,
    };
  }

  private compressHistory(): void {
    if (this.history.length <= (this.compressionOptions.compressionThreshold ?? 500)) {
      return;
    }

    const maxSize = this.compressionOptions.maxHistorySize ?? 1000;
    if (this.history.length <= maxSize) {
      return;
    }

    // Keep first state and recent states
    const keepCount = Math.floor(maxSize * 0.8); // Keep 80% of max size
    const startOffset = Math.floor(keepCount * 0.1); // Keep 10% from start

    const newHistory: GameState[] = [];

    // Always keep the initial state
    newHistory.push(this.history[0]);

    // Keep some early game states (for analysis)
    for (let i = 1; i < startOffset && i < this.history.length; i += 2) {
      newHistory.push(this.history[i]);
    }

    // Keep all recent states
    const recentStart = this.history.length - (keepCount - newHistory.length);
    for (let i = recentStart; i < this.history.length; i++) {
      newHistory.push(this.history[i]);
    }

    // Adjust current index
    const oldState = this.history[this.currentStateIndex];
    const newIndex = newHistory.indexOf(oldState);

    if (newIndex !== -1) {
      this.currentStateIndex = newIndex;
    } else {
      // Find closest state
      this.currentStateIndex = newHistory.length - 1;
    }

    this.history = newHistory;
  }

  private placePieceInternal(position: Vector3): boolean {
    const currentState = this.getCurrentState();

    // Check if game is already over
    if (this.isGameOver()) {
      return false;
    }

    // Create the move
    const move = new Move(
      position,
      currentState.getCurrentPlayer(),
      [], // No captured pieces yet
      Date.now()
    );

    // Validate the move
    if (!currentState.isValidMove(move)) {
      return false;
    }

    // Apply the move to create new state
    const newState = currentState.applyMove(move);

    // Truncate any states after current index (for redo history)
    this.history = this.history.slice(0, this.currentStateIndex + 1);

    // Add the new state
    this.history.push(newState);
    this.currentStateIndex++;

    // Emit move event
    this.emit({ type: 'move', move, state: newState });

    // Check for game over
    if (newState.getWinner()) {
      this.emit({
        type: 'gameOver',
        winner: newState.getWinner()!,
        winResult: newState.getWinResult()!,
      });
    }

    return true;
  }

  // Serialization
  toJSON(): any {
    return {
      boardSize: this.options.boardSize,
      blackFirst: this.options.blackFirst,
      history: this.history.map((state) => state.toJSON()),
      currentStateIndex: this.currentStateIndex,
      compressionOptions: this.compressionOptions,
    };
  }

  static fromJSON(json: any): Game {
    const game = new Game({
      boardSize: json.boardSize,
      blackFirst: json.blackFirst,
    });

    // Restore history
    game.history = json.history.map((stateData: any) => GameState.fromJSON(stateData));
    game.currentStateIndex = json.currentStateIndex;

    // Restore compression options
    if (json.compressionOptions) {
      game.compressionOptions = json.compressionOptions;
    }

    return game;
  }

  // Batch export/import
  static exportGames(games: { game: Game; name?: string; description?: string }[]): string {
    const collection: ExportedGameCollection = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      games: games.map(({ game, name, description }) => {
        const exported = JSON.parse(game.exportGame(name, description)) as ExportedGame;
        return exported;
      }),
    };
    return JSON.stringify(collection, null, 2);
  }

  static importGames(jsonString: string): { game: Game; metadata: ExportedGame['metadata'] }[] {
    try {
      const data = JSON.parse(jsonString);

      // Check if it's a collection
      if (data.version && data.games && Array.isArray(data.games)) {
        const collection = data as ExportedGameCollection;

        // Validate version
        const [major] = collection.version.split('.').map(Number);
        if (major > 1) {
          throw new Error(`Unsupported collection version: ${collection.version}`);
        }

        return collection.games.map((gameData, index) => {
          try {
            const game = Game.importFromExportedGame(gameData);
            return { game, metadata: gameData.metadata };
          } catch (error) {
            throw new Error(
              `Failed to import game ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        });
      }

      // Single game - try to import it
      const game = Game.importGame(jsonString);
      const metadata = data.metadata || {
        exportedAt: new Date().toISOString(),
        boardSize: game.getOptions().boardSize,
        blackFirst: game.getOptions().blackFirst,
        moveCount: game.getMoveCount(),
        winner: game.getWinner(),
        captureCount: {
          black: game.getCurrentState().getBlackPlayer().getCaptureCount(),
          white: game.getCurrentState().getWhitePlayer().getCaptureCount(),
        },
      };
      return [{ game, metadata }];
    } catch (error) {
      throw new Error(
        `Failed to import games: ${error instanceof Error ? error.message : 'Invalid JSON'}`
      );
    }
  }
}
