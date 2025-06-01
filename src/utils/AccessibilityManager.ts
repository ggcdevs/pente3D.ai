import { EventEmitter } from './EventEmitter';
import { Game } from '../core/Game';
import { Vector3 } from '../core/Vector3';
import { Move } from '../core/Move';
import { Player } from '../core/Player';
import { WinResult } from '../core/WinResult';

export interface AccessibilityOptions {
  announceGameEvents: boolean;
  highContrastMode: boolean;
  reducedMotion: boolean;
  keyboardHelp: boolean;
}

export interface AccessibilityEvent {
  focusChanged: { position: Vector3 | null };
  highContrastChanged: { enabled: boolean };
  reducedMotionChanged: { enabled: boolean };
  announcement: { message: string };
}

export class AccessibilityManager extends EventEmitter {
  private game: Game;
  private options: AccessibilityOptions;
  private announcementQueue: string[] = [];
  private currentFocus: Vector3 | null = null;
  private boardSize: number;
  private announcementContainer: HTMLElement | null = null;
  private positionIndicator: HTMLElement | null = null;
  private isProcessingQueue = false;

  constructor(game: Game, options: Partial<AccessibilityOptions> = {}) {
    super();
    this.game = game;
    this.boardSize = game.getBoard().size;
    
    this.options = {
      announceGameEvents: true,
      highContrastMode: false,
      reducedMotion: false,
      keyboardHelp: true,
      ...options
    };

    this.setupAnnouncements();
    this.connectToGameEvents();
    this.initializeFocus();
  }

  private setupAnnouncements(): void {
    // Create announcement container if it doesn't exist
    this.announcementContainer = document.getElementById('game-announcements');
    if (!this.announcementContainer) {
      this.announcementContainer = document.createElement('div');
      this.announcementContainer.id = 'game-announcements';
      this.announcementContainer.className = 'sr-only';
      this.announcementContainer.setAttribute('role', 'status');
      this.announcementContainer.setAttribute('aria-live', 'polite');
      this.announcementContainer.setAttribute('aria-atomic', 'true');
      document.body.appendChild(this.announcementContainer);
    }

    // Create position indicator if it doesn't exist
    this.positionIndicator = document.getElementById('position-indicator');
    if (!this.positionIndicator) {
      this.positionIndicator = document.createElement('div');
      this.positionIndicator.id = 'position-indicator';
      this.positionIndicator.className = 'sr-only';
      this.positionIndicator.setAttribute('role', 'status');
      this.positionIndicator.setAttribute('aria-live', 'assertive');
      document.body.appendChild(this.positionIndicator);
    }
  }

  private connectToGameEvents(): void {
    if (!this.options.announceGameEvents) return;

    this.game.on('move', (event) => {
      this.announceMove(event.move);
    });

    this.game.on('turnChanged', (event) => {
      this.announceTurnChange(event.player);
    });

    this.game.on('gameWon', (event) => {
      this.announceWin(event.winner, event.winResult);
    });

    this.game.on('moveUndone', () => {
      this.announceGameEvent('undo', 'Move undone');
    });

    this.game.on('moveRedone', () => {
      this.announceGameEvent('redo', 'Move redone');
    });

    this.game.on('gameReset', () => {
      this.announceGameEvent('reset', 'Game reset. Black to move.');
    });
  }

  private initializeFocus(): void {
    // Start focus at center of board
    const center = Math.floor(this.boardSize / 2);
    this.currentFocus = new Vector3(center, center, center);
    this.emit('focusChanged', { position: this.currentFocus } as any);
  }

  announceGameEvent(event: string, details?: any): void {
    if (!this.options.announceGameEvents) return;
    
    let message: string;
    if (typeof details === 'string') {
      message = details;
    } else {
      message = this.formatEventDetails(event, details);
    }
    
    this.createAnnouncement(message);
  }

  private formatEventDetails(event: string, details: any): string {
    switch (event) {
      case 'move':
        return details;
      case 'capture':
        return `Captured ${details.count} piece${details.count > 1 ? 's' : ''}`;
      case 'turn':
        return `${details.player}'s turn`;
      default:
        return `${event}: ${JSON.stringify(details)}`;
    }
  }

  setHighContrastMode(enabled: boolean): void {
    this.options.highContrastMode = enabled;
    document.body.classList.toggle('high-contrast', enabled);
    this.emit('highContrastChanged', { enabled } as any);
    
    if (enabled) {
      this.createAnnouncement('High contrast mode enabled');
    } else {
      this.createAnnouncement('High contrast mode disabled');
    }
  }

  setReducedMotion(enabled: boolean): void {
    this.options.reducedMotion = enabled;
    this.emit('reducedMotionChanged', { enabled } as any);
    
    if (enabled) {
      this.createAnnouncement('Animations reduced');
    } else {
      this.createAnnouncement('Animations enabled');
    }
  }

  toggleKeyboardHelp(): void {
    this.options.keyboardHelp = !this.options.keyboardHelp;
    this.createAnnouncement(
      this.options.keyboardHelp ? 'Keyboard help enabled' : 'Keyboard help disabled'
    );
  }

  moveFocus(direction: 'up' | 'down' | 'left' | 'right' | 'forward' | 'backward'): void {
    if (!this.currentFocus) {
      this.initializeFocus();
      return;
    }

    const { x, y, z } = this.currentFocus;
    let newX = x;
    let newY = y;
    let newZ = z;

    switch (direction) {
      case 'up':
        newY = Math.min(y + 1, this.boardSize - 1);
        break;
      case 'down':
        newY = Math.max(y - 1, 0);
        break;
      case 'left':
        newX = Math.max(x - 1, 0);
        break;
      case 'right':
        newX = Math.min(x + 1, this.boardSize - 1);
        break;
      case 'forward':
        newZ = Math.min(z + 1, this.boardSize - 1);
        break;
      case 'backward':
        newZ = Math.max(z - 1, 0);
        break;
    }

    if (newX !== x || newY !== y || newZ !== z) {
      this.currentFocus = new Vector3(newX, newY, newZ);
      this.emit('focusChanged', { position: this.currentFocus } as any);
      this.announceCurrentPosition();
    }
  }

  getCurrentFocusPosition(): Vector3 | null {
    return this.currentFocus;
  }

  selectCurrentPosition(): void {
    if (!this.currentFocus) return;
    
    // This will trigger the game to place a piece at the current focus position
    // The actual piece placement will be handled by the game/input handler
    this.createAnnouncement(`Selected position ${this.positionToText(this.currentFocus)}`);
  }

  announceCurrentPosition(): void {
    if (!this.currentFocus) return;
    
    const positionText = this.positionToText(this.currentFocus);
    const piece = this.game.getBoard().getPieceAt(this.currentFocus);
    
    let announcement = `Position ${positionText}`;
    if (piece) {
      const player = piece.playerId === 'player1' ? 'Black' : 'White';
      announcement += `, occupied by ${player}`;
    } else {
      announcement += ', empty';
    }
    
    // Use position indicator for immediate feedback
    if (this.positionIndicator) {
      this.positionIndicator.textContent = announcement;
    }
  }

  announceBoardState(): void {
    const board = this.game.getBoard();
    const blackPieces = board.getAllPieces().filter((p: any) => p.playerId === 'player1').length;
    const whitePieces = board.getAllPieces().filter((p: any) => p.playerId === 'player2').length;
    
    let announcement = `Board state: ${blackPieces} black pieces, ${whitePieces} white pieces. `;
    // We don't have direct access to both players, so we'll skip capture counts for now
    // announcement += `Black has captured ${players[0].getCaptureCount()} pieces. `;
    // announcement += `White has captured ${players[1].getCaptureCount()} pieces. `;
    announcement += `Move ${this.game.getMoveHistory().length}. `;
    announcement += this.game.getCurrentPlayer().getColor() === 'black' ? 'Black to move.' : 'White to move.';
    
    this.createAnnouncement(announcement);
  }

  announceGameStatus(): void {
    const winner = this.game.getWinner();
    const winResult = this.game.getWinResult();
    
    if (winner) {
      const winnerName = winner === 'black' ? 'Black' : 'White';
      const reason = winResult?.winType === 'five-in-a-row' ? 'five in a row' : 'captures';
      this.createAnnouncement(`Game over. ${winnerName} wins by ${reason}.`);
    } else {
      const currentPlayer = this.game.getCurrentPlayer().getColor() === 'black' ? 'Black' : 'White';
      this.createAnnouncement(`Game in progress. ${currentPlayer} to move.`);
    }
  }

  announceAvailableMoves(): void {
    const board = this.game.getBoard();
    const totalPositions = Math.pow(this.boardSize, 3);
    const occupiedPositions = board.getAllPieces().length;
    const availableMoves = totalPositions - occupiedPositions;
    
    this.createAnnouncement(`${availableMoves} positions available`);
  }

  private announceMove(move: Move): void {
    const position = this.positionToText(move.position);
    const player = move.playerId === 'player1' ? 'Black' : 'White';
    const isCapture = move.isCapture();
    
    let announcement = `${player} placed piece at ${position}`;
    if (isCapture) {
      // We don't have capture count on Move, just that it's a capture
      announcement += `, capturing pieces`;
    }
    
    this.createAnnouncement(announcement);
  }

  private announceTurnChange(player: Player): void {
    const playerName = player.id === 'player1' ? 'Black' : 'White';
    this.createAnnouncement(`${playerName}'s turn`);
  }

  private announceWin(winner: Player, result: WinResult): void {
    const player = winner.id === 'player1' ? 'Black' : 'White';
    const reason = result.winType === 'five-in-a-row' ? 'five in a row' : 'captures';
    
    this.createAnnouncement(`Game over! ${player} wins by ${reason}!`);
  }

  private createAnnouncement(message: string): void {
    this.announcementQueue.push(message);
    this.emit('announcement', { message } as any);
    
    if (!this.isProcessingQueue) {
      this.processAnnouncementQueue();
    }
  }

  private processAnnouncementQueue(): void {
    if (this.announcementQueue.length === 0 || !this.announcementContainer) {
      this.isProcessingQueue = false;
      return;
    }
    
    this.isProcessingQueue = true;
    const message = this.announcementQueue.shift()!;
    
    // Clear previous announcement and set new one
    this.announcementContainer.textContent = message;
    
    // Process next announcement after a short delay
    setTimeout(() => {
      this.processAnnouncementQueue();
    }, 100);
  }

  private positionToText(position: Vector3): string {
    // Convert 0-based indices to 1-based for user-friendly output
    // Also convert to letter-number notation (A1, B2, etc.)
    const x = String.fromCharCode(65 + position.x); // A, B, C, etc.
    const y = position.y + 1;
    const z = position.z + 1;
    return `${x}${y}, level ${z}`;
  }

  dispose(): void {
    // Clear all event listeners
    (this as any).listeners = new Map();
    this.announcementQueue = [];
    
    // Remove created elements
    if (this.announcementContainer && this.announcementContainer.parentNode) {
      this.announcementContainer.parentNode.removeChild(this.announcementContainer);
    }
    if (this.positionIndicator && this.positionIndicator.parentNode) {
      this.positionIndicator.parentNode.removeChild(this.positionIndicator);
    }
  }
}