import { IWinResult, IPlayer, ILine } from '@/types';
import { Player } from './Player';
import { Line } from './Line';

export class WinResult implements IWinResult {
  public readonly winner: Player | null;
  public readonly winningLine: Line | null;
  public readonly winType: 'five-in-a-row' | 'captures' | null;

  // Compatibility properties
  get type(): 'five-in-a-row' | 'captures' | null {
    return this.winType;
  }

  constructor(
    winner: Player | IPlayer | null = null,
    winningLine: Line | ILine | null = null,
    winType: 'five-in-a-row' | 'captures' | null = null
  ) {
    this.winner = winner 
      ? (winner instanceof Player ? winner : new Player(winner.id, winner.color, winner.isLocal))
      : null;
    
    this.winningLine = winningLine
      ? (winningLine instanceof Line ? winningLine : new Line(winningLine.coords, winningLine.direction))
      : null;
    
    this.winType = winType;

    // Validate consistency
    if (this.winner && !this.winType) {
      throw new Error('Win result must specify win type');
    }
    if (this.winType === 'five-in-a-row' && !this.winningLine) {
      throw new Error('Five-in-a-row win must include winning line');
    }
  }

  // Factory methods
  static noWin(): WinResult {
    return new WinResult();
  }

  static fiveInARow(winner: Player | IPlayer, line: Line | ILine): WinResult {
    return new WinResult(winner, line, 'five-in-a-row');
  }

  static captures(winner: Player | IPlayer): WinResult {
    return new WinResult(winner, null, 'captures');
  }

  // Query methods
  isWin(): boolean {
    return this.winner !== null;
  }

  isFiveInARow(): boolean {
    return this.winType === 'five-in-a-row';
  }

  isCaptures(): boolean {
    return this.winType === 'captures';
  }

  // Utility methods
  toString(): string {
    if (!this.isWin()) {
      return 'WinResult(no winner)';
    }
    return `WinResult(${this.winner!.id} wins by ${this.winType})`;
  }

  toJSON(): IWinResult {
    return {
      winner: this.winner ? this.winner.toJSON() : null,
      winningLine: this.winningLine ? this.winningLine.toJSON() : null,
      winType: this.winType
    };
  }

  equals(other: WinResult | null): boolean {
    if (!other) return false;
    
    const winnersEqual = (this.winner === null && other.winner === null) ||
                        (this.winner !== null && other.winner !== null && this.winner.equals(other.winner));
    
    const linesEqual = (this.winningLine === null && other.winningLine === null) ||
                      (this.winningLine !== null && other.winningLine !== null && this.winningLine.equals(other.winningLine));
    
    return winnersEqual && linesEqual && this.winType === other.winType;
  }

  clone(): WinResult {
    return new WinResult(
      this.winner ? this.winner.clone() : null,
      this.winningLine ? this.winningLine.clone() : null,
      this.winType
    );
  }

  static fromJSON(json: any): WinResult {
    if (!json || typeof json !== 'object') {
      throw new Error('Invalid JSON for WinResult');
    }
    
    return new WinResult(
      json.winner ? Player.fromJSON(json.winner) : null,
      json.winningLine ? Line.fromJSON(json.winningLine) : null,
      json.winType
    );
  }
}