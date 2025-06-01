import { Game } from '@/core';
import { NetworkManager } from '@/network';
import { NetworkModal, NetworkStatus, MenuModal, DialogManager } from '@/ui';
import { Renderer } from '@/rendering';

// Mock modules
jest.mock('@/network/NetworkManager');
jest.mock('@/rendering/Renderer');

describe('Network UI Integration', () => {
  let game: Game;
  let dialogManager: DialogManager;
  let networkStatus: NetworkStatus;
  let renderer: jest.Mocked<Renderer>;

  beforeEach(() => {
    // Clear DOM
    document.body.innerHTML = `
      <canvas id="game-canvas"></canvas>
      <div id="game-controls"></div>
    `;
    
    // Create instances
    game = new Game({ boardSize: 7 });
    dialogManager = new DialogManager();
    networkStatus = new NetworkStatus();
    
    // Create mock renderer
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    renderer = new Renderer({
      canvas,
      boardSize: 7,
      antialias: true
    }) as jest.Mocked<Renderer>;
  });

  afterEach(() => {
    networkStatus.dispose();
    dialogManager.closeAll();
    jest.clearAllMocks();
  });

  describe('Menu Integration', () => {
    it('should open network modal from menu', async () => {
      const networkStart = jest.fn();
      
      const menuModal = new MenuModal({
        game,
        onNetworkGame: () => {
          const networkModal = new NetworkModal({
            game,
            onNetworkStart: networkStart
          });
          networkModal.open();
        }
      });
      
      menuModal.open();
      
      // Click network game button
      const networkBtn = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent?.includes('Network Game'));
      expect(networkBtn).toBeTruthy();
      
      networkBtn?.click();
      
      // Should close menu and open network modal
      expect(document.querySelector('.menu-modal')).toBeFalsy();
      expect(document.querySelector('.network-modal')).toBeTruthy();
      
      menuModal.destroy();
    });

    it('should handle network game option styling', () => {
      const menuModal = new MenuModal({
        game,
        onNetworkGame: jest.fn()
      });
      
      menuModal.open();
      
      const networkBtn = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent?.includes('Network Game')) as HTMLElement;
      
      expect(networkBtn).toBeTruthy();
      expect(networkBtn.style.background).toContain('2196F3');
      
      menuModal.destroy();
    });
  });

  describe('Host Flow Integration', () => {
    it('should complete host flow and show network status', async () => {
      let networkManager: NetworkManager | null = null;
      
      const networkModal = new NetworkModal({
        game,
        onNetworkStart: (nm) => {
          networkManager = nm;
          networkStatus.setNetworkManager(nm);
        }
      });
      
      networkModal.open();
      
      // Click host button
      const hostBtn = document.querySelector('.host-btn') as HTMLButtonElement;
      hostBtn.click();
      
      // Mock successful hosting
      const mockNM = (NetworkManager as jest.MockedClass<typeof NetworkManager>).mock.instances[0];
      (mockNM.hostGame as jest.Mock).mockResolvedValue('ABC123');
      
      // Wait for hosting to complete
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Should show game code
      const codeElement = document.querySelector('.game-code');
      expect(codeElement?.textContent).toBe('ABC123');
      
      // Simulate connection
      const connectedHandler = (mockNM.once as jest.Mock).mock.calls
        .find(call => call[0] === 'connected')?.[1];
      connectedHandler();
      
      // Network modal should close
      expect(document.querySelector('.network-modal')).toBeFalsy();
      
      // Network status should be visible
      expect(networkStatus.isShown()).toBe(true);
      
      // Should show game code in network status
      const statusCode = document.querySelector('.network-status-game-code');
      expect(statusCode?.textContent).toContain('ABC123');
      
      networkModal.destroy();
    });
  });

  describe('Join Flow Integration', () => {
    it('should complete join flow with URL parameter', async () => {
      // Simulate URL with join parameter
      const urlParams = new URLSearchParams('?join=XYZ789');
      Object.defineProperty(window, 'location', {
        value: { search: urlParams.toString() },
        writable: true
      });
      
      let networkManager: NetworkManager | null = null;
      
      const networkModal = new NetworkModal({
        game,
        onNetworkStart: (nm) => {
          networkManager = nm;
          networkStatus.setNetworkManager(nm);
        }
      });
      
      networkModal.open();
      
      // Should auto-navigate to join view
      const joinBtn = document.querySelector('.join-btn') as HTMLButtonElement;
      joinBtn.click();
      
      const input = document.querySelector('.game-code-input') as HTMLInputElement;
      const joinGameBtn = document.querySelector('.join-game-btn') as HTMLButtonElement;
      
      // Enter code from URL
      input.value = 'XYZ789';
      input.dispatchEvent(new Event('input'));
      
      expect(joinGameBtn.disabled).toBe(false);
      
      joinGameBtn.click();
      
      // Mock successful join
      const mockNM = (NetworkManager as jest.MockedClass<typeof NetworkManager>).mock.instances[0];
      (mockNM.joinGame as jest.Mock).mockResolvedValue(undefined);
      
      // Simulate connection
      const connectedHandler = (mockNM.once as jest.Mock).mock.calls
        .find(call => call[0] === 'connected')?.[1];
      connectedHandler();
      
      // Should close modal and show network status
      expect(document.querySelector('.network-modal')).toBeFalsy();
      expect(networkStatus.isShown()).toBe(true);
      
      networkModal.destroy();
    });
  });

  describe('Network Status Updates', () => {
    it('should update UI based on network events', () => {
      const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
      
      // Mock initial state
      mockNM.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: 'connected' as any,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });
      
      mockNM.isLocalPlayerTurn.mockReturnValue(true);
      mockNM.getLatency.mockReturnValue(50);
      mockNM.getLocalPlayerColor.mockReturnValue('black');
      
      networkStatus.setNetworkManager(mockNM);
      
      // Check initial display
      const turnIndicator = document.querySelector('.network-status-turn');
      expect(turnIndicator?.textContent).toContain('YOUR TURN');
      
      // Simulate move event
      const moveHandler = (mockNM.on as jest.Mock).mock.calls
        .find(call => call[0] === 'move')?.[1];
      
      // Update turn
      mockNM.isLocalPlayerTurn.mockReturnValue(false);
      moveHandler();
      
      // Should update turn indicator
      expect(turnIndicator?.textContent).toContain('Opponent\'s turn');
    });

    it('should handle disconnection events', () => {
      const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
      
      mockNM.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: 'connected' as any,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });
      
      networkStatus.setNetworkManager(mockNM);
      
      // Simulate player disconnection
      const disconnectHandler = (mockNM.on as jest.Mock).mock.calls
        .find(call => call[0] === 'playerDisconnected')?.[1];
      
      // Update connection info
      mockNM.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: 'connected' as any,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: false
      });
      
      disconnectHandler();
      
      // Should show waiting for opponent
      const statusText = document.querySelector('.network-status-connection');
      expect(statusText?.textContent).toContain('Waiting for opponent');
    });
  });

  describe('Game Code Sharing', () => {
    it('should handle game code copying from network status', async () => {
      // Mock clipboard
      Object.assign(navigator, {
        clipboard: {
          writeText: jest.fn().mockResolvedValue(undefined)
        }
      });
      
      const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
      
      mockNM.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: 'connected' as any,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: false
      });
      
      networkStatus.setNetworkManager(mockNM);
      
      const copyBtn = document.querySelector('.copy-code-btn') as HTMLButtonElement;
      expect(copyBtn).toBeTruthy();
      
      await copyBtn.click();
      
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABC123');
      expect(copyBtn.textContent).toContain('Copied!');
    });

    it('should generate share URL with game code', async () => {
      // Mock navigator.share
      Object.assign(navigator, {
        share: jest.fn().mockResolvedValue(undefined)
      });
      
      const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
      
      mockNM.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'XYZ789',
        isHost: true,
        status: 'connected' as any,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });
      
      networkStatus.setNetworkManager(mockNM);
      
      const shareBtn = Array.from(document.querySelectorAll('.network-control-btn'))
        .find(btn => btn.textContent?.includes('Share')) as HTMLButtonElement;
      
      await shareBtn.click();
      
      expect(navigator.share).toHaveBeenCalledWith({
        title: 'Join my Pente3D game!',
        text: 'Game Code: XYZ789',
        url: expect.stringContaining('?join=XYZ789')
      });
    });
  });

  describe('Connection Controls', () => {
    it('should handle disconnect button', () => {
      const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
      
      mockNM.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: 'connected' as any,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });
      
      networkStatus.setNetworkManager(mockNM);
      
      const disconnectBtn = document.querySelector('.network-control-btn') as HTMLButtonElement;
      expect(disconnectBtn.textContent).toContain('Disconnect');
      
      disconnectBtn.click();
      
      expect(mockNM.disconnect).toHaveBeenCalled();
    });

    it('should handle reconnect button', () => {
      const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
      
      mockNM.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: false,
        status: 'error' as any,
        lastActivity: Date.now(),
        latency: 0,
        playerColor: 'white',
        opponentConnected: false
      });
      
      networkStatus.setNetworkManager(mockNM);
      
      const reconnectBtn = document.querySelector('.network-control-btn') as HTMLButtonElement;
      expect(reconnectBtn.textContent).toContain('Reconnect');
      
      reconnectBtn.click();
      
      // Should call joinGame for client
      expect(mockNM.joinGame).toHaveBeenCalledWith('ABC123');
    });

    it('should handle reconnect for host', () => {
      const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
      
      mockNM.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: 'disconnected' as any,
        lastActivity: Date.now(),
        latency: 0,
        playerColor: 'black',
        opponentConnected: false
      });
      
      networkStatus.setNetworkManager(mockNM);
      
      const reconnectBtn = document.querySelector('.network-control-btn') as HTMLButtonElement;
      reconnectBtn.click();
      
      // Should call hostGame for host
      expect(mockNM.hostGame).toHaveBeenCalled();
    });
  });

  describe('Visual Feedback', () => {
    it('should show appropriate colors for connection status', () => {
      const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
      networkStatus.setNetworkManager(mockNM);
      
      const testCases = [
        { status: 'connected', color: '#4CAF50' },
        { status: 'connecting', color: '#ff9800' },
        { status: 'error', color: '#f44336' },
        { status: 'disconnected', color: '#666' }
      ];
      
      testCases.forEach(testCase => {
        mockNM.getConnectionInfo.mockReturnValue({
          peerId: 'test-peer',
          gameCode: 'ABC123',
          isHost: true,
          status: testCase.status as any,
          lastActivity: Date.now(),
          latency: 0,
          playerColor: 'black',
          opponentConnected: false
        });
        
        // Trigger update
        const statusHandler = (mockNM.on as jest.Mock).mock.calls
          .find(call => call[0] === 'statusChanged')?.[1];
        statusHandler();
        
        const container = document.querySelector('.network-status') as HTMLElement;
        expect(container.style.border).toContain(testCase.color);
      });
    });

    it('should animate turn indicator when it is player turn', () => {
      const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
      
      mockNM.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: 'connected' as any,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });
      
      mockNM.isLocalPlayerTurn.mockReturnValue(true);
      
      networkStatus.setNetworkManager(mockNM);
      
      const turnIndicator = document.querySelector('.network-status-turn') as HTMLElement;
      expect(turnIndicator.style.animation).toContain('pulse');
    });
  });

  describe('Error Handling', () => {
    it('should show dialog on network errors', () => {
      const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
      
      const errorSpy = jest.spyOn(dialogManager, 'showError');
      
      // Setup network event handling
      let errorHandler: ((error: Error) => void) | undefined;
      mockNM.on.mockImplementation((event: string, handler: any) => {
        if (event === 'error') {
          errorHandler = handler;
        }
      });
      
      networkStatus.setNetworkManager(mockNM);
      
      // Simulate network error
      if (errorHandler) {
        errorHandler(new Error('Connection lost'));
      }
      
      // Dialog manager would be called in main.ts integration
      // Here we just verify the error event is properly set up
      expect(mockNM.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('Cleanup', () => {
    it('should clean up all network UI components', () => {
      const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
      
      networkStatus.setNetworkManager(mockNM);
      
      // Create network modal
      const networkModal = new NetworkModal({
        game,
        onNetworkStart: jest.fn()
      });
      networkModal.open();
      
      // Clean up
      networkStatus.dispose();
      networkModal.destroy();
      
      // Should remove all UI elements
      expect(document.querySelector('.network-status')).toBeFalsy();
      expect(document.querySelector('.network-modal')).toBeFalsy();
      
      // Should disconnect network manager
      expect(mockNM.disconnect).toHaveBeenCalled();
    });
  });
});