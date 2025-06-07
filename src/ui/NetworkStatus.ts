import { ConnectionStatus, type NetworkManager } from '@/network';
import { logger } from '@/utils';

export class NetworkStatus {
  private container: HTMLElement;
  private statusElement: HTMLElement;
  private latencyElement: HTMLElement;
  private playerColorElement: HTMLElement;
  private turnIndicatorElement: HTMLElement;
  private gameCodeElement: HTMLElement;
  private connectionControlsElement: HTMLElement;
  private spectatorIndicatorElement: HTMLElement;
  private networkManager: NetworkManager | null = null;
  private updateInterval: NodeJS.Timeout | null = null;
  private isExpanded = false;

  constructor() {
    this.container = this.createContainer();
    this.statusElement = this.createStatusElement();
    this.latencyElement = this.createLatencyElement();
    this.playerColorElement = this.createPlayerColorElement();
    this.turnIndicatorElement = this.createTurnIndicatorElement();
    this.gameCodeElement = this.createGameCodeElement();
    this.connectionControlsElement = this.createConnectionControlsElement();
    this.spectatorIndicatorElement = this.createSpectatorIndicatorElement();

    // Create header with expand/collapse button
    const header = this.createHeader();
    this.container.appendChild(header);

    // Create content container
    const content = document.createElement('div');
    content.className = 'network-status-content';
    content.appendChild(this.statusElement);
    content.appendChild(this.gameCodeElement);
    content.appendChild(this.latencyElement);
    content.appendChild(this.playerColorElement);
    content.appendChild(this.spectatorIndicatorElement);
    content.appendChild(this.turnIndicatorElement);
    content.appendChild(this.connectionControlsElement);

    this.container.appendChild(content);

    // Initially hidden
    this.hide();
  }

  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'network-status';
    container.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      border-radius: 8px;
      font-size: 14px;
      z-index: 1000;
      min-width: 250px;
      max-width: 350px;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      transition: all 0.3s ease;
    `;
    document.body.appendChild(container);
    return container;
  }

  private createHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'network-status-header';
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 15px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
      cursor: pointer;
    `;

    const title = document.createElement('span');
    title.textContent = '🌐 Network Game';
    title.style.fontWeight = 'bold';

    const expandButton = document.createElement('button');
    expandButton.className = 'expand-button';
    expandButton.style.cssText = `
      background: none;
      border: none;
      color: white;
      font-size: 18px;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.3s ease;
    `;
    expandButton.textContent = '▼';

    header.appendChild(title);
    header.appendChild(expandButton);

    header.addEventListener('click', () => this.toggleExpanded());

    return header;
  }

  private createStatusElement(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'network-status-connection';
    element.style.cssText = `
      display: flex;
      align-items: center;
      margin-bottom: 5px;
    `;
    return element;
  }

  private createLatencyElement(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'network-status-latency';
    element.style.cssText = `
      font-size: 12px;
      opacity: 0.8;
      margin-bottom: 5px;
    `;
    return element;
  }

  private createPlayerColorElement(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'network-status-player';
    element.style.cssText = `
      display: flex;
      align-items: center;
      margin-bottom: 5px;
    `;
    return element;
  }

  private createTurnIndicatorElement(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'network-status-turn';
    element.style.cssText = `
      font-weight: bold;
      text-align: center;
      padding: 8px;
      border-radius: 5px;
      margin: 10px 0;
      transition: all 0.3s ease;
    `;
    return element;
  }

  private createGameCodeElement(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'network-status-game-code';
    element.style.cssText = `
      margin: 10px 0;
      padding: 10px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 5px;
      text-align: center;
    `;
    return element;
  }

  private createConnectionControlsElement(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'network-status-controls';
    element.style.cssText = `
      margin-top: 10px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    `;
    return element;
  }

  private createSpectatorIndicatorElement(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'network-status-spectator';
    element.style.cssText = `
      display: none;
      margin: 5px 0;
      padding: 5px;
      background: rgba(255, 165, 0, 0.2);
      border-radius: 3px;
      text-align: center;
      font-size: 12px;
    `;
    element.innerHTML = '👁️ Spectator Mode';
    return element;
  }

  private toggleExpanded(): void {
    this.isExpanded = !this.isExpanded;
    const content = this.container.querySelector('.network-status-content') as HTMLElement;
    const expandButton = this.container.querySelector('.expand-button') as HTMLElement;

    if (this.isExpanded) {
      content.style.display = 'block';
      expandButton.style.transform = 'rotate(180deg)';
      this.container.style.minHeight = 'auto';
    } else {
      content.style.display = 'none';
      expandButton.style.transform = 'rotate(0deg)';
      this.container.style.minHeight = '50px';
    }
  }

  setNetworkManager(networkManager: NetworkManager): void {
    this.networkManager = networkManager;
    this.setupEventListeners();
    this.show();
    this.startUpdateInterval();
    this.updateAll();

    // Expand by default when networked
    this.isExpanded = true;
    const content = this.container.querySelector('.network-status-content') as HTMLElement;
    if (content) {
      content.style.display = 'block';
    }
  }

  private setupEventListeners(): void {
    if (!this.networkManager) {
      return;
    }

    this.networkManager.on('statusChanged', () => this.updateStatus());
    this.networkManager.on('latency', () => this.updateLatency());
    this.networkManager.on('connected', () => this.updateAll());
    this.networkManager.on('playerDisconnected', () => this.updateStatus());
    this.networkManager.on('playerReconnected', () => this.updateStatus());
    this.networkManager.on('move', () => this.updateTurnIndicator());
    this.networkManager.on('moveAcknowledged', () => this.updateTurnIndicator());
  }

  private startUpdateInterval(): void {
    this.updateInterval = setInterval(() => {
      this.updateAll();
    }, 1000);
  }

  private updateAll(): void {
    this.updateStatus();
    this.updateGameCode();
    this.updateLatency();
    this.updatePlayerColor();
    this.updateTurnIndicator();
    this.updateConnectionControls();
    this.updateSpectatorIndicator();
  }

  private updateStatus(): void {
    if (!this.networkManager) {
      return;
    }

    const info = this.networkManager.getConnectionInfo();
    if (!info) {
      return;
    }

    const statusIcon = this.getStatusIcon(info.status);
    const statusText = this.getStatusText(info.status, info.opponentConnected);

    this.statusElement.innerHTML = `
      <span style="margin-right: 8px; font-size: 16px;">${statusIcon}</span>
      <span>${statusText}</span>
    `;

    // Update container border color based on status
    const borderColor = this.getStatusColor(info.status);
    this.container.style.border = `2px solid ${borderColor}`;
  }

  private updateGameCode(): void {
    if (!this.networkManager) {
      return;
    }

    const info = this.networkManager.getConnectionInfo();
    if (!info) {
      return;
    }

    if (info.gameCode) {
      this.gameCodeElement.innerHTML = `
        <div style="font-size: 12px; opacity: 0.8; margin-bottom: 5px;">Game Code</div>
        <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
          <code style="font-size: 20px; font-weight: bold; letter-spacing: 2px;">${info.gameCode}</code>
          <button class="copy-code-btn" style="
            background: rgba(255, 255, 255, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.3);
            color: white;
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s ease;
          " title="Copy game code">📋 Copy</button>
        </div>
      `;

      // Add copy functionality
      const copyBtn = this.gameCodeElement.querySelector('.copy-code-btn') as HTMLButtonElement;
      if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(info.gameCode);
            copyBtn.textContent = '✓ Copied!';
            copyBtn.style.background = 'rgba(76, 175, 80, 0.3)';
            setTimeout(() => {
              copyBtn.textContent = '📋 Copy';
              copyBtn.style.background = 'rgba(255, 255, 255, 0.2)';
            }, 2000);
          } catch (err) {
            logger.error('Failed to copy', err as Error);
          }
        });
      }

      this.gameCodeElement.style.display = 'block';
    } else {
      this.gameCodeElement.style.display = 'none';
    }
  }

  private updateLatency(): void {
    if (!this.networkManager) {
      return;
    }

    const latency = this.networkManager.getLatency();
    const latencyText = latency > 0 ? `${latency}ms` : 'measuring...';
    const latencyColor = this.getLatencyColor(latency);

    this.latencyElement.innerHTML = `
      <span style="color: ${latencyColor}">Ping: ${latencyText}</span>
    `;
  }

  private updatePlayerColor(): void {
    if (!this.networkManager) {
      return;
    }

    const color = this.networkManager.getLocalPlayerColor();
    if (color) {
      const colorEmoji = color === 'black' ? '⚫' : '⚪';
      this.playerColorElement.innerHTML = `
        <span style="margin-right: 5px;">You are:</span>
        <span style="font-size: 18px;">${colorEmoji}</span>
        <span style="margin-left: 5px;">${color}</span>
      `;
    }
  }

  private updateTurnIndicator(): void {
    if (!this.networkManager) {
      return;
    }

    const isYourTurn = this.networkManager.isLocalPlayerTurn();
    const info = this.networkManager.getConnectionInfo();
    if (!info) {
      return;
    }

    if (info.opponentConnected) {
      if (isYourTurn) {
        this.turnIndicatorElement.style.backgroundColor = '#4CAF50';
        this.turnIndicatorElement.style.color = 'white';
        this.turnIndicatorElement.textContent = '🌟 YOUR TURN';
        this.turnIndicatorElement.style.animation = 'pulse 1.5s infinite';
      } else {
        this.turnIndicatorElement.style.backgroundColor = '#666';
        this.turnIndicatorElement.style.color = '#ccc';
        this.turnIndicatorElement.textContent = "⏳ Opponent's turn";
        this.turnIndicatorElement.style.animation = 'none';
      }
    } else {
      this.turnIndicatorElement.style.backgroundColor = '#ff9800';
      this.turnIndicatorElement.style.color = 'white';
      this.turnIndicatorElement.textContent = '⏳ Waiting for opponent...';
      this.turnIndicatorElement.style.animation = 'none';
    }
  }

  private updateConnectionControls(): void {
    if (!this.networkManager) {
      return;
    }

    const info = this.networkManager.getConnectionInfo();
    if (!info) {
      return;
    }

    this.connectionControlsElement.innerHTML = '';

    // Add disconnect button if connected
    if (info.status === ConnectionStatus.CONNECTED) {
      const disconnectBtn = document.createElement('button');
      disconnectBtn.className = 'network-control-btn';
      disconnectBtn.style.cssText = `
        background: rgba(244, 67, 54, 0.2);
        border: 1px solid rgba(244, 67, 54, 0.5);
        color: #ff6b6b;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s ease;
        flex: 1;
      `;
      disconnectBtn.textContent = '🔌 Disconnect';
      disconnectBtn.addEventListener('click', () => {
        this.networkManager?.disconnect();
      });
      this.connectionControlsElement.appendChild(disconnectBtn);
    }

    // Add reconnect button if disconnected with error
    if (info.status === ConnectionStatus.ERROR || info.status === ConnectionStatus.DISCONNECTED) {
      const reconnectBtn = document.createElement('button');
      reconnectBtn.className = 'network-control-btn';
      reconnectBtn.style.cssText = `
        background: rgba(76, 175, 80, 0.2);
        border: 1px solid rgba(76, 175, 80, 0.5);
        color: #81c784;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s ease;
        flex: 1;
      `;
      reconnectBtn.textContent = '🔁 Reconnect';
      reconnectBtn.addEventListener('click', () => {
        // Attempt to reconnect
        if (info.isHost) {
          this.networkManager?.hostGame();
        } else {
          this.networkManager?.joinGame(info.gameCode);
        }
      });
      this.connectionControlsElement.appendChild(reconnectBtn);
    }

    // Add share button if host and connected
    if (info.isHost && info.gameCode && info.status === ConnectionStatus.CONNECTED) {
      const shareBtn = document.createElement('button');
      shareBtn.className = 'network-control-btn';
      shareBtn.style.cssText = `
        background: rgba(33, 150, 243, 0.2);
        border: 1px solid rgba(33, 150, 243, 0.5);
        color: #64b5f6;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s ease;
        flex: 1;
      `;
      shareBtn.textContent = '🔗 Share Link';
      shareBtn.addEventListener('click', async () => {
        const shareUrl = `${window.location.origin}${window.location.pathname}?join=${info.gameCode}`;
        try {
          if (navigator.share) {
            await navigator.share({
              title: 'Join my Pente3D game!',
              text: `Game Code: ${info.gameCode}`,
              url: shareUrl,
            });
          } else {
            await navigator.clipboard.writeText(shareUrl);
            shareBtn.textContent = '✓ Link Copied!';
            setTimeout(() => {
              shareBtn.textContent = '🔗 Share Link';
            }, 2000);
          }
        } catch (err) {
          logger.error('Failed to share', err as Error);
        }
      });
      this.connectionControlsElement.appendChild(shareBtn);
    }
  }

  private updateSpectatorIndicator(): void {
    if (!this.networkManager) {
      return;
    }

    // For now, hide spectator mode as it's not implemented
    // This will be updated when spectator mode is added
    this.spectatorIndicatorElement.style.display = 'none';
  }

  private getStatusIcon(status: ConnectionStatus): string {
    switch (status) {
      case ConnectionStatus.CONNECTED:
        return '🟢';
      case ConnectionStatus.CONNECTING:
        return '🟡';
      case ConnectionStatus.ERROR:
        return '🔴';
      case ConnectionStatus.DISCONNECTED:
      default:
        return '⚫';
    }
  }

  private getStatusText(status: ConnectionStatus, opponentConnected: boolean): string {
    switch (status) {
      case ConnectionStatus.CONNECTED:
        return opponentConnected ? 'Connected' : 'Waiting for opponent';
      case ConnectionStatus.CONNECTING:
        return 'Connecting...';
      case ConnectionStatus.ERROR:
        return 'Connection error';
      case ConnectionStatus.DISCONNECTED:
      default:
        return 'Disconnected';
    }
  }

  private getStatusColor(status: ConnectionStatus): string {
    switch (status) {
      case ConnectionStatus.CONNECTED:
        return '#4CAF50';
      case ConnectionStatus.CONNECTING:
        return '#ff9800';
      case ConnectionStatus.ERROR:
        return '#f44336';
      case ConnectionStatus.DISCONNECTED:
      default:
        return '#666';
    }
  }

  private getLatencyColor(latency: number): string {
    if (latency === 0) {
      return '#999';
    }
    if (latency < 50) {
      return '#4CAF50';
    }
    if (latency < 150) {
      return '#ff9800';
    }
    return '#f44336';
  }

  show(): void {
    this.container.style.display = 'block';
    // Add pulse animation styles if not already added
    if (!document.getElementById('network-status-styles')) {
      const style = document.createElement('style');
      style.id = 'network-status-styles';
      style.textContent = `
        @keyframes pulse {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.05); }
          100% { opacity: 1; transform: scale(1); }
        }
        .network-control-btn:hover {
          filter: brightness(1.2);
          transform: translateY(-1px);
        }
        .network-status-content {
          padding: 15px;
          display: none;
        }
        .copy-code-btn:hover {
          background: rgba(255, 255, 255, 0.3) !important;
        }
      `;
      document.head.appendChild(style);
    }
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  isShown(): boolean {
    return this.container.style.display !== 'none';
  }

  dispose(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
