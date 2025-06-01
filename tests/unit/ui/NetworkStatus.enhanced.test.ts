import { NetworkStatus } from '@/ui/NetworkStatus';
import { NetworkManager, ConnectionStatus } from '@/network';
import { Game } from '@/core';

// Mock NetworkManager
jest.mock('@/network/NetworkManager');

describe('NetworkStatus Enhanced', () => {
  let networkStatus: NetworkStatus;
  let networkManager: jest.Mocked<NetworkManager>;
  let game: Game;

  beforeEach(() => {
    // Clear DOM
    document.body.innerHTML = '';
    
    // Create instances
    game = new Game({ boardSize: 7 });
    networkManager = new NetworkManager(game) as jest.Mocked<NetworkManager>;
    networkStatus = new NetworkStatus();
  });

  afterEach(() => {
    networkStatus.dispose();
    jest.clearAllMocks();
  });

  describe('UI Structure', () => {
    it('should create all required UI elements', () => {
      const container = document.querySelector('.network-status');
      expect(container).toBeTruthy();

      const header = container?.querySelector('.network-status-header');
      expect(header).toBeTruthy();

      const content = container?.querySelector('.network-status-content');
      expect(content).toBeTruthy();

      const statusElement = container?.querySelector('.network-status-connection');
      expect(statusElement).toBeTruthy();

      const gameCodeElement = container?.querySelector('.network-status-game-code');
      expect(gameCodeElement).toBeTruthy();

      const controlsElement = container?.querySelector('.network-status-controls');
      expect(controlsElement).toBeTruthy();
    });

    it('should have expand/collapse functionality', () => {
      const header = document.querySelector('.network-status-header') as HTMLElement;
      const content = document.querySelector('.network-status-content') as HTMLElement;
      const expandButton = document.querySelector('.expand-button') as HTMLElement;

      expect(header).toBeTruthy();
      expect(content).toBeTruthy();
      expect(expandButton).toBeTruthy();

      // Should be collapsed initially (content is initially hidden via CSS)
      // The display might be empty string initially
      expect(content.style.display).not.toBe('block');

      // Click to expand
      header.click();
      
      // Content should be visible after expanding
      networkStatus.setNetworkManager(networkManager);
      const contentAfter = document.querySelector('.network-status-content') as HTMLElement;
      expect(contentAfter.style.display).toBe('block');
    });
  });

  describe('Game Code Display', () => {
    it('should display game code when available', () => {
      networkManager.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: ConnectionStatus.CONNECTED,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });

      networkStatus.setNetworkManager(networkManager);

      const gameCodeElement = document.querySelector('.network-status-game-code');
      expect(gameCodeElement).toBeTruthy();
      expect(gameCodeElement?.textContent).toContain('ABC123');
    });

    it('should have copy functionality for game code', () => {
      // Mock clipboard API
      Object.assign(navigator, {
        clipboard: {
          writeText: jest.fn().mockResolvedValue(undefined)
        }
      });

      networkManager.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'XYZ789',
        isHost: true,
        status: ConnectionStatus.CONNECTED,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });

      networkStatus.setNetworkManager(networkManager);

      const copyBtn = document.querySelector('.copy-code-btn') as HTMLButtonElement;
      expect(copyBtn).toBeTruthy();

      copyBtn.click();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('XYZ789');
    });

    it('should hide game code when not available', () => {
      networkManager.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: '',
        isHost: false,
        status: ConnectionStatus.CONNECTING,
        lastActivity: Date.now(),
        latency: 0,
        playerColor: undefined,
        opponentConnected: false
      });

      networkStatus.setNetworkManager(networkManager);

      const gameCodeElement = document.querySelector('.network-status-game-code') as HTMLElement;
      expect(gameCodeElement?.style.display).toBe('none');
    });
  });

  describe('Connection Controls', () => {
    it('should show disconnect button when connected', () => {
      networkManager.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: ConnectionStatus.CONNECTED,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });

      networkStatus.setNetworkManager(networkManager);

      const disconnectBtn = document.querySelector('.network-control-btn');
      expect(disconnectBtn).toBeTruthy();
      expect(disconnectBtn?.textContent).toContain('Disconnect');
    });

    it('should show reconnect button when disconnected', () => {
      networkManager.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: ConnectionStatus.ERROR,
        lastActivity: Date.now(),
        latency: 0,
        playerColor: 'black',
        opponentConnected: false
      });

      networkStatus.setNetworkManager(networkManager);

      const reconnectBtn = document.querySelector('.network-control-btn');
      expect(reconnectBtn).toBeTruthy();
      expect(reconnectBtn?.textContent).toContain('Reconnect');
    });

    it('should show share button for host when connected', () => {
      networkManager.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: ConnectionStatus.CONNECTED,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });

      networkStatus.setNetworkManager(networkManager);

      const shareBtn = Array.from(document.querySelectorAll('.network-control-btn'))
        .find(btn => btn.textContent?.includes('Share'));
      expect(shareBtn).toBeTruthy();
    });

    it('should handle disconnect button click', () => {
      networkManager.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: ConnectionStatus.CONNECTED,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });

      networkStatus.setNetworkManager(networkManager);

      const disconnectBtn = document.querySelector('.network-control-btn') as HTMLButtonElement;
      disconnectBtn.click();

      expect(networkManager.disconnect).toHaveBeenCalled();
    });
  });

  describe('Status Updates', () => {
    it('should show correct status icon and text', () => {
      const testCases = [
        { 
          status: ConnectionStatus.CONNECTED, 
          opponentConnected: true,
          expectedIcon: '🟢',
          expectedText: 'Connected'
        },
        { 
          status: ConnectionStatus.CONNECTED, 
          opponentConnected: false,
          expectedIcon: '🟢',
          expectedText: 'Waiting for opponent'
        },
        { 
          status: ConnectionStatus.CONNECTING, 
          opponentConnected: false,
          expectedIcon: '🟡',
          expectedText: 'Connecting...'
        },
        { 
          status: ConnectionStatus.ERROR, 
          opponentConnected: false,
          expectedIcon: '🔴',
          expectedText: 'Connection error'
        }
      ];

      testCases.forEach(testCase => {
        networkManager.getConnectionInfo.mockReturnValue({
          peerId: 'test-peer',
          gameCode: 'ABC123',
          isHost: true,
          status: testCase.status,
          lastActivity: Date.now(),
          latency: 50,
          playerColor: 'black',
          opponentConnected: testCase.opponentConnected
        });

        networkStatus.setNetworkManager(networkManager);

        const statusElement = document.querySelector('.network-status-connection');
        expect(statusElement?.textContent).toContain(testCase.expectedIcon);
        expect(statusElement?.textContent).toContain(testCase.expectedText);
      });
    });

    it('should update border color based on status', () => {
      networkManager.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: ConnectionStatus.CONNECTED,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });

      networkStatus.setNetworkManager(networkManager);

      const container = document.querySelector('.network-status') as HTMLElement;
      expect(container.style.border).toContain('rgb(76, 175, 80)'); // #4CAF50 in RGB
    });
  });

  describe('Turn Indicator', () => {
    it('should show "YOUR TURN" when it is local player turn', () => {
      networkManager.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: ConnectionStatus.CONNECTED,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });
      networkManager.isLocalPlayerTurn.mockReturnValue(true);

      networkStatus.setNetworkManager(networkManager);

      const turnIndicator = document.querySelector('.network-status-turn');
      expect(turnIndicator?.textContent).toContain('YOUR TURN');
      expect((turnIndicator as HTMLElement).style.backgroundColor).toBe('rgb(76, 175, 80)'); // #4CAF50
    });

    it('should show "Opponent\'s turn" when not local player turn', () => {
      networkManager.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: ConnectionStatus.CONNECTED,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });
      networkManager.isLocalPlayerTurn.mockReturnValue(false);

      networkStatus.setNetworkManager(networkManager);

      const turnIndicator = document.querySelector('.network-status-turn');
      expect(turnIndicator?.textContent).toContain('Opponent\'s turn');
      expect((turnIndicator as HTMLElement).style.backgroundColor).toBe('rgb(102, 102, 102)'); // #666
    });
  });

  describe('Latency Display', () => {
    it('should display latency when available', () => {
      networkManager.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: ConnectionStatus.CONNECTED,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });
      networkManager.getLatency.mockReturnValue(42);

      networkStatus.setNetworkManager(networkManager);

      const latencyElement = document.querySelector('.network-status-latency');
      expect(latencyElement?.textContent).toContain('42ms');
    });

    it('should show "measuring..." when latency is 0', () => {
      networkManager.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: ConnectionStatus.CONNECTED,
        lastActivity: Date.now(),
        latency: 0,
        playerColor: 'black',
        opponentConnected: true
      });
      networkManager.getLatency.mockReturnValue(0);

      networkStatus.setNetworkManager(networkManager);

      const latencyElement = document.querySelector('.network-status-latency');
      expect(latencyElement?.textContent).toContain('measuring...');
    });

    it('should use appropriate color based on latency', () => {
      const testCases = [
        { latency: 30, expectedColor: 'rgb(76, 175, 80)' },  // Good (green) #4CAF50
        { latency: 100, expectedColor: 'rgb(255, 152, 0)' }, // Medium (orange) #ff9800
        { latency: 200, expectedColor: 'rgb(244, 67, 54)' }  // Bad (red) #f44336
      ];

      testCases.forEach(testCase => {
        networkManager.getLatency.mockReturnValue(testCase.latency);
        networkManager.getConnectionInfo.mockReturnValue({
          peerId: 'test-peer',
          gameCode: 'ABC123',
          isHost: true,
          status: ConnectionStatus.CONNECTED,
          lastActivity: Date.now(),
          latency: testCase.latency,
          playerColor: 'black',
          opponentConnected: true
        });

        networkStatus.setNetworkManager(networkManager);

        const latencyElement = document.querySelector('.network-status-latency span') as HTMLElement;
        expect(latencyElement.style.color).toBe(testCase.expectedColor);
      });
    });
  });

  describe('Event Handling', () => {
    it('should update on status change', () => {
      networkStatus.setNetworkManager(networkManager);

      // Trigger status change event
      const statusChangedHandler = (networkManager.on as jest.Mock).mock.calls
        .find(call => call[0] === 'statusChanged')?.[1];
      
      expect(statusChangedHandler).toBeTruthy();
      
      // Update mock return value
      networkManager.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: ConnectionStatus.ERROR,
        lastActivity: Date.now(),
        latency: 0,
        playerColor: 'black',
        opponentConnected: false
      });

      // Call the handler
      statusChangedHandler();

      // Check if UI updated
      const statusElement = document.querySelector('.network-status-connection');
      expect(statusElement?.textContent).toContain('Connection error');
    });

    it('should update on move events', () => {
      networkStatus.setNetworkManager(networkManager);

      // Get move event handler
      const moveHandler = (networkManager.on as jest.Mock).mock.calls
        .find(call => call[0] === 'move')?.[1];
      
      expect(moveHandler).toBeTruthy();

      // Update turn status
      networkManager.isLocalPlayerTurn.mockReturnValue(false);

      // Call the handler
      moveHandler();

      // Check if turn indicator updated
      const turnIndicator = document.querySelector('.network-status-turn');
      expect(turnIndicator).toBeTruthy();
      // Text content might include emoji, so just check it's not YOUR TURN
      expect(turnIndicator?.textContent).not.toContain('YOUR TURN');
    });
  });

  describe('Share Functionality', () => {
    it('should handle share link button click with navigator.share', async () => {
      // Mock navigator.share
      Object.assign(navigator, {
        share: jest.fn().mockResolvedValue(undefined)
      });

      networkManager.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: ConnectionStatus.CONNECTED,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });

      networkStatus.setNetworkManager(networkManager);

      const shareBtn = Array.from(document.querySelectorAll('.network-control-btn'))
        .find(btn => btn.textContent?.includes('Share')) as HTMLButtonElement;
      
      await shareBtn.click();

      expect(navigator.share).toHaveBeenCalledWith({
        title: 'Join my Pente3D game!',
        text: 'Game Code: ABC123',
        url: expect.stringContaining('?join=ABC123')
      });
    });

    it('should fallback to clipboard when navigator.share is not available', async () => {
      // Remove navigator.share
      Object.assign(navigator, {
        share: undefined,
        clipboard: {
          writeText: jest.fn().mockResolvedValue(undefined)
        }
      });

      networkManager.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'XYZ789',
        isHost: true,
        status: ConnectionStatus.CONNECTED,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });

      networkStatus.setNetworkManager(networkManager);

      const shareBtn = Array.from(document.querySelectorAll('.network-control-btn'))
        .find(btn => btn.textContent?.includes('Share')) as HTMLButtonElement;
      
      await shareBtn.click();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('?join=XYZ789')
      );
    });
  });

  describe('Visibility', () => {
    it('should be hidden initially', () => {
      const container = document.querySelector('.network-status') as HTMLElement;
      expect(container.style.display).toBe('none');
    });

    it('should show when network manager is set', () => {
      networkStatus.setNetworkManager(networkManager);
      const container = document.querySelector('.network-status') as HTMLElement;
      expect(container.style.display).toBe('block');
    });

    it('should hide when hide() is called', () => {
      networkStatus.setNetworkManager(networkManager);
      networkStatus.hide();
      const container = document.querySelector('.network-status') as HTMLElement;
      expect(container.style.display).toBe('none');
    });

    it('should report visibility correctly', () => {
      expect(networkStatus.isShown()).toBe(false);
      
      networkStatus.setNetworkManager(networkManager);
      expect(networkStatus.isShown()).toBe(true);
      
      networkStatus.hide();
      expect(networkStatus.isShown()).toBe(false);
    });
  });

  describe('Cleanup', () => {
    it('should clean up interval on dispose', () => {
      jest.useFakeTimers();
      
      networkStatus.setNetworkManager(networkManager);
      
      // Should have created an interval
      expect(jest.getTimerCount()).toBeGreaterThan(0);
      
      networkStatus.dispose();
      
      // Should have cleared the interval
      jest.runOnlyPendingTimers();
      expect(jest.getTimerCount()).toBe(0);
      
      jest.useRealTimers();
    });

    it('should remove DOM elements on dispose', () => {
      networkStatus.setNetworkManager(networkManager);
      
      expect(document.querySelector('.network-status')).toBeTruthy();
      
      networkStatus.dispose();
      
      expect(document.querySelector('.network-status')).toBeFalsy();
    });
  });
});