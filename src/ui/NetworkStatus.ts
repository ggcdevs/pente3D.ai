import { NetworkManager, ConnectionStatus } from '@/network';

export class NetworkStatus {
  private container: HTMLElement;
  private statusElement: HTMLElement;
  private latencyElement: HTMLElement;
  private playerColorElement: HTMLElement;
  private turnIndicatorElement: HTMLElement;
  private networkManager: NetworkManager | null = null;
  private updateInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.container = this.createContainer();
    this.statusElement = this.createStatusElement();
    this.latencyElement = this.createLatencyElement();
    this.playerColorElement = this.createPlayerColorElement();
    this.turnIndicatorElement = this.createTurnIndicatorElement();
    
    this.container.appendChild(this.statusElement);
    this.container.appendChild(this.latencyElement);
    this.container.appendChild(this.playerColorElement);
    this.container.appendChild(this.turnIndicatorElement);
    
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
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 10px 15px;
      border-radius: 5px;
      font-size: 14px;
      z-index: 1000;
      min-width: 200px;
    `;
    document.body.appendChild(container);
    return container;
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
      padding: 5px;
      border-radius: 3px;
      margin-top: 5px;
    `;
    return element;
  }

  setNetworkManager(networkManager: NetworkManager): void {
    this.networkManager = networkManager;
    this.setupEventListeners();
    this.show();
    this.startUpdateInterval();
  }

  private setupEventListeners(): void {
    if (!this.networkManager) return;

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
    this.updateLatency();
    this.updatePlayerColor();
    this.updateTurnIndicator();
  }

  private updateStatus(): void {
    if (!this.networkManager) return;

    const info = this.networkManager.getConnectionInfo();
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

  private updateLatency(): void {
    if (!this.networkManager) return;

    const latency = this.networkManager.getLatency();
    const latencyText = latency > 0 ? `${latency}ms` : 'measuring...';
    const latencyColor = this.getLatencyColor(latency);
    
    this.latencyElement.innerHTML = `
      <span style="color: ${latencyColor}">Ping: ${latencyText}</span>
    `;
  }

  private updatePlayerColor(): void {
    if (!this.networkManager) return;

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
    if (!this.networkManager) return;

    const isYourTurn = this.networkManager.isLocalPlayerTurn();
    const info = this.networkManager.getConnectionInfo();
    
    if (info.opponentConnected) {
      if (isYourTurn) {
        this.turnIndicatorElement.style.backgroundColor = '#4CAF50';
        this.turnIndicatorElement.style.color = 'white';
        this.turnIndicatorElement.textContent = 'YOUR TURN';
      } else {
        this.turnIndicatorElement.style.backgroundColor = '#666';
        this.turnIndicatorElement.style.color = '#ccc';
        this.turnIndicatorElement.textContent = "Opponent's turn";
      }
    } else {
      this.turnIndicatorElement.style.backgroundColor = '#ff9800';
      this.turnIndicatorElement.style.color = 'white';
      this.turnIndicatorElement.textContent = 'Waiting for opponent...';
    }
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
    if (latency === 0) return '#999';
    if (latency < 50) return '#4CAF50';
    if (latency < 150) return '#ff9800';
    return '#f44336';
  }

  show(): void {
    this.container.style.display = 'block';
  }

  hide(): void {
    this.container.style.display = 'none';
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