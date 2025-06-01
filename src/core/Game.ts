import { GameState } from './GameState';
import { Move } from './Move';
import { Vector3 } from './Vector3';
import { WinResult } from './WinResult';
import { Player } from './Player';
import type { PlayerColor } from '@/types';

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
    compressionThreshold: 500
  };

  constructor(options: GameOptions = {}) {
    this.options = {
      boardSize: options.boardSize ?? 9,
      blackFirst: options.blackFirst ?? true
    };
    
    const initialState = GameState.createInitialState(
      this.options.boardSize,
      this.options.blackFirst ? 'black' : 'white'
    );
    
    this.history.push(initialState);
    this.currentStateIndex = 0;
  }

  static fromJSON(json: SerializedGame): Game {
    const game = new Game(json.options);
    game.history = json.history;
    game.currentStateIndex = json.currentStateIndex;
    return game;
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

  toJSON(): SerializedGame {
    return {
      currentStateIndex: this.currentStateIndex,
      history: this.history,
      options: this.options
    };
  }

  exportGame(): string {
    return JSON.stringify(this.toJSON(), null, 2);
  }

  static importGame(jsonString: string): Game {
    const data = JSON.parse(jsonString) as SerializedGame;
    return Game.fromJSON(data);
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
    this.eventHandlers.forEach(handler => handler(event));
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
    return moveIndex >= 0 && moveIndex < this.history.length && moveIndex !== this.currentStateIndex;
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
      ...options
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
        winResult: newState.getWinResult()! 
      });
    }

    return true;
  }
}