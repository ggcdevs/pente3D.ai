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
  | { type: 'gameOver'; winner: PlayerColor; winResult: WinResult };

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

export class Game {
  private history: GameState[] = [];
  private currentStateIndex: number = -1;
  private eventHandlers: Set<GameEventHandler> = new Set();
  private readonly options: Required<GameOptions>;

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
}