import { Modal } from './Modal';
import { NetworkManager } from '@/network';
import { Game } from '@/core';

export interface NetworkModalOptions {
  game: Game;
  onNetworkStart?: (networkManager: NetworkManager) => void;
  onCancel?: () => void;
}

export class NetworkModal extends Modal {
  private game: Game;
  private networkManager: NetworkManager | null = null;
  private onNetworkStart?: (networkManager: NetworkManager) => void;
  private onCancel?: () => void;
  // @ts-ignore - Used for tracking modal state
  private currentView: 'menu' | 'host' | 'join' = 'menu';

  constructor(options: NetworkModalOptions) {
    super({
      title: '🌐 Network Game',
      className: 'network-modal'
    });

    this.game = options.game;
    this.onNetworkStart = options.onNetworkStart;
    this.onCancel = options.onCancel;
  }

  protected render(): void {
    this.setupContent();
    this.setupNetworkEventListeners();
  }

  private setupContent(): void {
    this.showMenuView();
  }

  private showMenuView(): void {
    this.currentView = 'menu';
    this.setTitle('🌐 Network Game');
    
    this.content.innerHTML = `
      <div class="network-menu">
        <div style="text-align: center; margin-bottom: 20px;">
          <p style="color: #999; margin: 0;">Play Pente3D with friends online!</p>
        </div>
        
        <div class="network-options" style="display: flex; flex-direction: column; gap: 15px;">
          <button class="network-option host-btn" style="
            background: linear-gradient(135deg, #4CAF50, #45a049);
            color: white;
            border: none;
            padding: 20px;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
          ">
            <span style="font-size: 32px;">🏠</span>
            <span style="font-size: 18px; font-weight: bold;">Host Game</span>
            <span style="font-size: 14px; opacity: 0.9;">Create a new game and invite a friend</span>
          </button>
          
          <button class="network-option join-btn" style="
            background: linear-gradient(135deg, #2196F3, #1976D2);
            color: white;
            border: none;
            padding: 20px;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
          ">
            <span style="font-size: 32px;">🔗</span>
            <span style="font-size: 18px; font-weight: bold;">Join Game</span>
            <span style="font-size: 14px; opacity: 0.9;">Enter a game code to join</span>
          </button>
        </div>
        
        <div style="margin-top: 20px; text-align: center;">
          <button class="cancel-network-btn" style="
            background: none;
            border: 1px solid #666;
            color: #999;
            padding: 8px 20px;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
          ">Cancel</button>
        </div>
      </div>
    `;

    // Add hover effects
    const style = document.createElement('style');
    style.textContent = `
      .network-option:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        filter: brightness(1.1);
      }
      .cancel-network-btn:hover {
        border-color: #999;
        color: #ccc;
      }
    `;
    this.content.appendChild(style);
  }

  private showHostView(): void {
    this.currentView = 'host';
    this.setTitle('🏠 Host Game');
    
    this.content.innerHTML = `
      <div class="network-host">
        <div class="loading-container" style="text-align: center; padding: 40px;">
          <div class="spinner" style="
            width: 50px;
            height: 50px;
            border: 3px solid #333;
            border-top-color: #4CAF50;
            border-radius: 50%;
            margin: 0 auto 20px;
            animation: spin 1s linear infinite;
          "></div>
          <p style="color: #999; margin: 10px 0;">Setting up game...</p>
          <p class="status-text" style="color: #666; font-size: 14px;"></p>
        </div>
        
        <div class="game-code-container" style="display: none; text-align: center; padding: 20px;">
          <p style="color: #999; margin-bottom: 20px;">Share this code with your friend:</p>
          <div style="background: #1a1a1a; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <code class="game-code" style="
              font-size: 36px;
              font-weight: bold;
              letter-spacing: 4px;
              color: #4CAF50;
            "></code>
          </div>
          <button class="copy-code-btn" style="
            background: #4CAF50;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 10px;
            transition: all 0.2s ease;
          ">📋 Copy Code</button>
          <button class="share-link-btn" style="
            background: #2196F3;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
          ">🔗 Share Link</button>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #333;">
            <p style="color: #666; font-size: 14px;">Waiting for opponent to join...</p>
            <div class="connection-status" style="margin-top: 10px;"></div>
          </div>
        </div>
        
        <div style="position: absolute; bottom: 20px; left: 20px;">
          <button class="back-btn" style="
            background: none;
            border: 1px solid #666;
            color: #999;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
          ">← Back</button>
        </div>
      </div>
      
      <style>
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .copy-code-btn:hover, .share-link-btn:hover {
          filter: brightness(1.1);
          transform: translateY(-1px);
        }
      </style>
    `;
  }

  private showJoinView(): void {
    this.currentView = 'join';
    this.setTitle('🔗 Join Game');
    
    this.content.innerHTML = `
      <div class="network-join">
        <div style="text-align: center; padding: 20px;">
          <p style="color: #999; margin-bottom: 20px;">Enter the game code:</p>
          <input type="text" class="game-code-input" placeholder="ABC123" style="
            background: #1a1a1a;
            border: 2px solid #333;
            color: white;
            padding: 15px;
            font-size: 24px;
            text-align: center;
            letter-spacing: 3px;
            text-transform: uppercase;
            border-radius: 8px;
            width: 100%;
            max-width: 200px;
            margin-bottom: 20px;
            transition: all 0.2s ease;
          " maxlength="6" />
          
          <div class="error-message" style="
            color: #f44336;
            font-size: 14px;
            margin-bottom: 10px;
            min-height: 20px;
          "></div>
          
          <button class="join-game-btn" style="
            background: #2196F3;
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            transition: all 0.2s ease;
          " disabled>Join Game</button>
          
          <div class="connection-status" style="margin-top: 20px;"></div>
        </div>
        
        <div style="position: absolute; bottom: 20px; left: 20px;">
          <button class="back-btn" style="
            background: none;
            border: 1px solid #666;
            color: #999;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
          ">← Back</button>
        </div>
      </div>
      
      <style>
        .game-code-input:focus {
          outline: none;
          border-color: #2196F3;
        }
        .game-code-input::placeholder {
          color: #666;
        }
        .join-game-btn:not(:disabled):hover {
          background: #1976D2;
          transform: translateY(-1px);
        }
        .join-game-btn:disabled {
          background: #666;
          cursor: not-allowed;
          opacity: 0.5;
        }
      </style>
    `;
    
    // Focus the input
    const input = this.content.querySelector('.game-code-input') as HTMLInputElement;
    if (input) {
      setTimeout(() => input.focus(), 100);
    }
  }

  private setupNetworkEventListeners(): void {
    this.content.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      
      if (target.classList.contains('host-btn') || target.closest('.host-btn')) {
        this.handleHostGame();
      } else if (target.classList.contains('join-btn') || target.closest('.join-btn')) {
        this.showJoinView();
        this.setupJoinListeners();
      } else if (target.classList.contains('cancel-network-btn')) {
        this.handleCancel();
      } else if (target.classList.contains('back-btn')) {
        this.handleBack();
      } else if (target.classList.contains('copy-code-btn')) {
        this.handleCopyCode();
      } else if (target.classList.contains('share-link-btn')) {
        this.handleShareLink();
      }
    });
  }

  private setupJoinListeners(): void {
    const input = this.content.querySelector('.game-code-input') as HTMLInputElement;
    const joinBtn = this.content.querySelector('.join-game-btn') as HTMLButtonElement;
    const errorMsg = this.content.querySelector('.error-message') as HTMLElement;
    
    if (input && joinBtn) {
      input.addEventListener('input', () => {
        const code = input.value.trim().toUpperCase();
        joinBtn.disabled = code.length !== 6;
        errorMsg.textContent = '';
      });
      
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !joinBtn.disabled) {
          this.handleJoinGame();
        }
      });
      
      joinBtn.addEventListener('click', () => {
        this.handleJoinGame();
      });
    }
  }

  private async handleHostGame(): Promise<void> {
    this.showHostView();
    
    // Create network manager
    this.networkManager = new NetworkManager(this.game);
    
    try {
      const gameCode = await this.networkManager.hostGame();
      
      // Show game code
      const codeContainer = this.content.querySelector('.game-code-container') as HTMLElement;
      const loadingContainer = this.content.querySelector('.loading-container') as HTMLElement;
      const codeElement = this.content.querySelector('.game-code') as HTMLElement;
      
      if (codeContainer && loadingContainer && codeElement) {
        loadingContainer.style.display = 'none';
        codeContainer.style.display = 'block';
        codeElement.textContent = gameCode;
      }
      
      // Listen for connection
      let connectedHandler: (() => void) | null = null;
      connectedHandler = () => {
        this.handleConnectionSuccess();
        // Remove handler after first call
        if (connectedHandler && this.networkManager) {
          this.networkManager.off('connected', connectedHandler);
        }
      };
      this.networkManager.on('connected', connectedHandler);
      
      this.networkManager.on('error', (error: Error) => {
        this.showError(error.message);
      });
    } catch (error) {
      this.showError('Failed to create game: ' + (error as Error).message);
    }
  }

  private async handleJoinGame(): Promise<void> {
    const input = this.content.querySelector('.game-code-input') as HTMLInputElement;
    const errorMsg = this.content.querySelector('.error-message') as HTMLElement;
    const joinBtn = this.content.querySelector('.join-game-btn') as HTMLButtonElement;
    
    if (!input) return;
    
    const gameCode = input.value.trim().toUpperCase();
    if (gameCode.length !== 6) {
      errorMsg.textContent = 'Please enter a valid 6-character code';
      return;
    }
    
    // Disable input and button
    input.disabled = true;
    joinBtn.disabled = true;
    joinBtn.textContent = 'Connecting...';
    
    // Create network manager
    this.networkManager = new NetworkManager(this.game);
    
    try {
      await this.networkManager.joinGame(gameCode);
      
      // Listen for connection
      let connectedHandler: (() => void) | null = null;
      connectedHandler = () => {
        this.handleConnectionSuccess();
        // Remove handler after first call
        if (connectedHandler && this.networkManager) {
          this.networkManager.off('connected', connectedHandler);
        }
      };
      this.networkManager.on('connected', connectedHandler);
      
      this.networkManager.on('error', (error: Error) => {
        this.showError(error.message);
        input.disabled = false;
        joinBtn.disabled = false;
        joinBtn.textContent = 'Join Game';
      });
    } catch (error) {
      errorMsg.textContent = 'Failed to join game: ' + (error as Error).message;
      input.disabled = false;
      joinBtn.disabled = false;
      joinBtn.textContent = 'Join Game';
    }
  }

  private handleConnectionSuccess(): void {
    if (this.networkManager && this.onNetworkStart) {
      this.onNetworkStart(this.networkManager);
      this.close();
    }
  }

  private async handleCopyCode(): Promise<void> {
    const codeElement = this.content.querySelector('.game-code') as HTMLElement;
    const copyBtn = this.content.querySelector('.copy-code-btn') as HTMLButtonElement;
    
    if (codeElement && copyBtn) {
      const code = codeElement.textContent || '';
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => {
          copyBtn.textContent = '📋 Copy Code';
        }, 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    }
  }

  private async handleShareLink(): Promise<void> {
    const codeElement = this.content.querySelector('.game-code') as HTMLElement;
    const shareBtn = this.content.querySelector('.share-link-btn') as HTMLButtonElement;
    
    if (codeElement && shareBtn) {
      const code = codeElement.textContent || '';
      const shareUrl = `${window.location.origin}${window.location.pathname}?join=${code}`;
      
      try {
        if (navigator.share) {
          await navigator.share({
            title: 'Join my Pente3D game!',
            text: `Game Code: ${code}`,
            url: shareUrl
          });
        } else {
          await navigator.clipboard.writeText(shareUrl);
          shareBtn.textContent = '✓ Link Copied!';
          setTimeout(() => {
            shareBtn.textContent = '🔗 Share Link';
          }, 2000);
        }
      } catch (err) {
        console.error('Failed to share:', err);
      }
    }
  }

  private handleBack(): void {
    if (this.networkManager) {
      this.networkManager.disconnect();
      this.networkManager = null;
    }
    this.showMenuView();
  }

  private handleCancel(): void {
    if (this.networkManager) {
      this.networkManager.disconnect();
      this.networkManager = null;
    }
    if (this.onCancel) {
      this.onCancel();
    }
    this.close();
  }

  private showError(message: string): void {
    const statusElement = this.content.querySelector('.connection-status') as HTMLElement;
    if (statusElement) {
      statusElement.innerHTML = `<p style="color: #f44336; font-size: 14px;">❌ ${message}</p>`;
    }
  }

  destroy(): void {
    if (this.networkManager) {
      this.networkManager.disconnect();
      this.networkManager = null;
    }
    super.destroy();
  }
}