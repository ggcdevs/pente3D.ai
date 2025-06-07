import type { ConflictInfo } from '@/network/types';

export class ConflictNotification {
  private element: HTMLDivElement;
  private messageElement: HTMLDivElement;
  private detailsElement: HTMLDivElement;
  private progressElement: HTMLDivElement;
  private closeButton: HTMLButtonElement;
  private autoHideTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.element = this.createElement();
    this.messageElement = this.element.querySelector('.conflict-message') as HTMLDivElement;
    this.detailsElement = this.element.querySelector('.conflict-details') as HTMLDivElement;
    this.progressElement = this.element.querySelector('.conflict-progress') as HTMLDivElement;
    this.closeButton = this.element.querySelector('.conflict-close') as HTMLButtonElement;

    this.setupEventListeners();
    document.body.appendChild(this.element);
  }

  private createElement(): HTMLDivElement {
    const element = document.createElement('div');
    element.className = 'conflict-notification';
    element.innerHTML = `
      <div class="conflict-content">
        <div class="conflict-header">
          <h3>Network Conflict Detected</h3>
          <button class="conflict-close" aria-label="Close">×</button>
        </div>
        <div class="conflict-message"></div>
        <div class="conflict-details"></div>
        <div class="conflict-progress">
          <div class="conflict-progress-bar"></div>
        </div>
      </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      .conflict-notification {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 350px;
        background-color: #2c2c2c;
        border: 2px solid #ff6b6b;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        color: white;
        font-family: Arial, sans-serif;
        z-index: 10000;
        transform: translateX(400px);
        transition: transform 0.3s ease-out;
        opacity: 0.95;
      }

      .conflict-notification.visible {
        transform: translateX(0);
      }

      .conflict-content {
        padding: 20px;
      }

      .conflict-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
      }

      .conflict-header h3 {
        margin: 0;
        font-size: 18px;
        color: #ff6b6b;
      }

      .conflict-close {
        background: none;
        border: none;
        color: #999;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.2s;
      }

      .conflict-close:hover {
        color: white;
      }

      .conflict-message {
        margin-bottom: 10px;
        font-size: 14px;
        line-height: 1.5;
      }

      .conflict-details {
        margin-bottom: 15px;
        font-size: 12px;
        color: #999;
        font-family: monospace;
      }

      .conflict-progress {
        height: 4px;
        background-color: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        overflow: hidden;
      }

      .conflict-progress-bar {
        height: 100%;
        background-color: #4ecdc4;
        width: 0;
        transition: width 0.3s ease-out;
      }

      .conflict-notification.resolving .conflict-progress-bar {
        animation: progress-pulse 1s ease-in-out infinite;
      }

      @keyframes progress-pulse {
        0% { opacity: 1; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
      }

      .conflict-notification.error {
        border-color: #ff4444;
      }

      .conflict-notification.error .conflict-header h3 {
        color: #ff4444;
      }

      .conflict-notification.resolved {
        border-color: #44ff44;
      }

      .conflict-notification.resolved .conflict-header h3 {
        color: #44ff44;
      }
    `;
    document.head.appendChild(style);

    return element;
  }

  private setupEventListeners(): void {
    this.closeButton.addEventListener('click', () => this.hide());
  }

  showConflict(conflict: ConflictInfo): void {
    this.clearAutoHide();

    // Update message based on conflict type
    let message = '';
    switch (conflict.type) {
      case 'state_divergence':
        message = 'Game states have diverged. Resolving conflict...';
        break;
      case 'missing_moves':
        message = 'Some moves appear to be missing. Synchronizing...';
        break;
      case 'invalid_sequence':
        message = 'Move sequence is invalid. Repairing game state...';
        break;
    }

    this.messageElement.textContent = message;
    this.detailsElement.textContent = `Divergence at move ${conflict.divergencePoint}`;

    // Reset progress
    this.progressElement.style.display = 'block';
    const progressBar = this.progressElement.querySelector(
      '.conflict-progress-bar'
    ) as HTMLDivElement;
    progressBar.style.width = '0%';

    // Show notification
    this.element.className = 'conflict-notification visible resolving';

    // Animate progress
    setTimeout(() => {
      progressBar.style.width = '30%';
    }, 100);
  }

  showProgress(progress: number): void {
    const progressBar = this.progressElement.querySelector(
      '.conflict-progress-bar'
    ) as HTMLDivElement;
    progressBar.style.width = `${Math.min(90, progress * 100)}%`;
  }

  showResolution(resolution: 'rollback' | 'sync' | 'retry', success: boolean = true): void {
    const progressBar = this.progressElement.querySelector(
      '.conflict-progress-bar'
    ) as HTMLDivElement;
    progressBar.style.width = '100%';

    if (success) {
      this.element.className = 'conflict-notification visible resolved';

      let message = '';
      switch (resolution) {
        case 'rollback':
          message = 'Conflict resolved: Game rolled back to common state.';
          break;
        case 'sync':
          message = 'Conflict resolved: Game synchronized successfully.';
          break;
        case 'retry':
          message = 'Conflict resolved: Moves retried successfully.';
          break;
      }
      this.messageElement.textContent = message;

      // Auto-hide after 5 seconds
      this.setAutoHide(5000);
    } else {
      this.element.className = 'conflict-notification visible error';
      this.messageElement.textContent = 'Failed to resolve conflict. Please refresh the page.';
    }
  }

  showError(message: string): void {
    this.clearAutoHide();

    this.element.className = 'conflict-notification visible error';
    this.messageElement.textContent = message;
    this.detailsElement.textContent = '';
    this.progressElement.style.display = 'none';
  }

  hide(): void {
    this.clearAutoHide();
    this.element.classList.remove('visible');

    // Reset after animation
    setTimeout(() => {
      this.element.className = 'conflict-notification';
      this.messageElement.textContent = '';
      this.detailsElement.textContent = '';
    }, 300);
  }

  private setAutoHide(delay: number): void {
    this.clearAutoHide();
    this.autoHideTimeout = setTimeout(() => this.hide(), delay);
  }

  private clearAutoHide(): void {
    if (this.autoHideTimeout) {
      clearTimeout(this.autoHideTimeout);
      this.autoHideTimeout = null;
    }
  }

  dispose(): void {
    this.clearAutoHide();
    this.element.remove();
  }
}
