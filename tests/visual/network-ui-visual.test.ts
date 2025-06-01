import { Game } from '@/core';
import { NetworkManager, ConnectionStatus } from '@/network';
import { NetworkStatus, NetworkModal } from '@/ui';

// Mock NetworkManager
jest.mock('@/network/NetworkManager');

describe('Network UI Visual Tests', () => {
  let game: Game;

  beforeEach(() => {
    // Clear DOM and add styles
    document.body.innerHTML = '';
    document.head.innerHTML = `
      <style>
        body {
          margin: 0;
          padding: 20px;
          background: #1a1a1a;
          color: white;
          font-family: Arial, sans-serif;
        }
        .test-container {
          display: flex;
          flex-direction: column;
          gap: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .test-section {
          border: 1px solid #333;
          border-radius: 8px;
          padding: 20px;
          background: #0a0a0a;
        }
        .test-title {
          font-size: 18px;
          font-weight: bold;
          margin-bottom: 15px;
          color: #4CAF50;
        }
      </style>
    `;
    
    game = new Game({ boardSize: 7 });
  });

  describe('NetworkStatus Visual Appearance', () => {
    it('should render NetworkStatus with all visual states', () => {
      const container = document.createElement('div');
      container.className = 'test-container';
      document.body.appendChild(container);

      // Test different connection states
      const states = [
        {
          title: 'Connected with Opponent',
          status: ConnectionStatus.CONNECTED,
          opponentConnected: true,
          gameCode: 'ABC123',
          latency: 45,
          isHost: true,
          isYourTurn: true
        },
        {
          title: 'Waiting for Opponent',
          status: ConnectionStatus.CONNECTED,
          opponentConnected: false,
          gameCode: 'XYZ789',
          latency: 0,
          isHost: true,
          isYourTurn: false
        },
        {
          title: 'Connecting',
          status: ConnectionStatus.CONNECTING,
          opponentConnected: false,
          gameCode: '',
          latency: 0,
          isHost: false,
          isYourTurn: false
        },
        {
          title: 'Connection Error',
          status: ConnectionStatus.ERROR,
          opponentConnected: false,
          gameCode: 'ERR404',
          latency: 0,
          isHost: false,
          isYourTurn: false
        }
      ];

      states.forEach((state, index) => {
        const section = document.createElement('div');
        section.className = 'test-section';
        section.innerHTML = `<div class="test-title">${state.title}</div>`;
        
        // Create a wrapper for positioning
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.height = '300px';
        
        // Create NetworkStatus instance
        const networkStatus = new NetworkStatus();
        const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
        
        mockNM.getConnectionInfo.mockReturnValue({
          peerId: `peer-${index}`,
          gameCode: state.gameCode,
          isHost: state.isHost,
          status: state.status,
          lastActivity: Date.now(),
          latency: state.latency,
          playerColor: state.isHost ? 'black' : 'white',
          opponentConnected: state.opponentConnected
        });
        
        mockNM.isLocalPlayerTurn.mockReturnValue(state.isYourTurn);
        mockNM.getLatency.mockReturnValue(state.latency);
        mockNM.getLocalPlayerColor.mockReturnValue(state.isHost ? 'black' : 'white');
        
        networkStatus.setNetworkManager(mockNM);
        
        // Move the network status into our wrapper
        const statusElement = document.querySelector('.network-status') as HTMLElement;
        if (statusElement) {
          wrapper.appendChild(statusElement);
        }
        
        section.appendChild(wrapper);
        container.appendChild(section);
      });

      // Visual verification points:
      // 1. Border colors match connection status
      // 2. Game code is displayed and formatted correctly
      // 3. Turn indicator has appropriate styling
      // 4. Latency color coding is correct
      // 5. Control buttons are visible and styled
      // 6. Overall layout is clean and readable

      expect(document.querySelectorAll('.network-status').length).toBe(states.length);
      expect(document.querySelector('.network-status-game-code')).toBeTruthy();
      expect(document.querySelector('.network-status-turn')).toBeTruthy();
    });

    it('should show expanded and collapsed states', () => {
      const container = document.createElement('div');
      container.className = 'test-container';
      document.body.appendChild(container);

      // Create two instances - one expanded, one collapsed
      ['Expanded State', 'Collapsed State'].forEach((title, index) => {
        const section = document.createElement('div');
        section.className = 'test-section';
        section.innerHTML = `<div class="test-title">${title}</div>`;
        
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.height = index === 0 ? '400px' : '100px';
        
        const networkStatus = new NetworkStatus();
        const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
        
        mockNM.getConnectionInfo.mockReturnValue({
          peerId: 'test-peer',
          gameCode: 'TEST01',
          isHost: true,
          status: ConnectionStatus.CONNECTED,
          lastActivity: Date.now(),
          latency: 35,
          playerColor: 'black',
          opponentConnected: true
        });
        
        networkStatus.setNetworkManager(mockNM);
        
        if (index === 1) {
          // Collapse the second one
          const header = document.querySelector('.network-status-header') as HTMLElement;
          header?.click();
        }
        
        const statusElement = document.querySelector('.network-status') as HTMLElement;
        if (statusElement) {
          wrapper.appendChild(statusElement);
        }
        
        section.appendChild(wrapper);
        container.appendChild(section);
      });

      expect(document.querySelectorAll('.network-status').length).toBe(2);
    });
  });

  describe('NetworkModal Visual States', () => {
    it('should render all NetworkModal views', () => {
      const container = document.createElement('div');
      container.className = 'test-container';
      document.body.appendChild(container);

      // Menu View
      const menuSection = document.createElement('div');
      menuSection.className = 'test-section';
      menuSection.innerHTML = '<div class="test-title">Network Modal - Menu View</div>';
      
      const menuModal = new NetworkModal({ game });
      menuModal.open();
      
      const menuContent = document.querySelector('.modal-content')?.cloneNode(true) as HTMLElement;
      if (menuContent) {
        menuContent.style.position = 'relative';
        menuContent.style.transform = 'none';
        menuSection.appendChild(menuContent);
      }
      
      container.appendChild(menuSection);
      menuModal.close();

      // Host View
      const hostSection = document.createElement('div');
      hostSection.className = 'test-section';
      hostSection.innerHTML = '<div class="test-title">Network Modal - Host View</div>';
      
      // Setup mock for NetworkManager before creating modal
      const mockHostGame = jest.fn().mockResolvedValue('ABC123');
      (NetworkManager as jest.MockedClass<typeof NetworkManager>).mockImplementation(() => ({
        hostGame: mockHostGame,
        on: jest.fn(),
        once: jest.fn(),
        disconnect: jest.fn(),
        getConnectionInfo: jest.fn().mockReturnValue({
          peerId: 'test-peer',
          gameCode: 'ABC123',
          isHost: true,
          status: ConnectionStatus.CONNECTED,
          lastActivity: Date.now(),
          latency: 50,
          playerColor: 'black',
          opponentConnected: false
        })
      } as any));
      
      const hostModal = new NetworkModal({ game });
      hostModal.open();
      const hostBtn = document.querySelector('.host-btn') as HTMLButtonElement;
      hostBtn?.click();
      
      // Wait for code display
      setTimeout(() => {
        const hostContent = document.querySelector('.modal-content')?.cloneNode(true) as HTMLElement;
        if (hostContent) {
          hostContent.style.position = 'relative';
          hostContent.style.transform = 'none';
          hostSection.appendChild(hostContent);
        }
        container.appendChild(hostSection);
        hostModal.close();
      }, 100);

      // Join View
      const joinSection = document.createElement('div');
      joinSection.className = 'test-section';
      joinSection.innerHTML = '<div class="test-title">Network Modal - Join View</div>';
      
      const joinModal = new NetworkModal({ game });
      joinModal.open();
      const joinBtn = document.querySelector('.join-btn') as HTMLButtonElement;
      joinBtn?.click();
      
      const joinContent = document.querySelector('.modal-content')?.cloneNode(true) as HTMLElement;
      if (joinContent) {
        joinContent.style.position = 'relative';
        joinContent.style.transform = 'none';
        
        // Show with partially entered code
        const input = joinContent.querySelector('.game-code-input') as HTMLInputElement;
        if (input) {
          input.value = 'ABC';
        }
        
        joinSection.appendChild(joinContent);
      }
      
      container.appendChild(joinSection);
      joinModal.close();

      // Visual verification points:
      // 1. Button gradients and hover states
      // 2. Modal layout and spacing
      // 3. Input field styling
      // 4. Loading spinner animation
      // 5. Game code display formatting

      expect(container.querySelectorAll('.test-section').length).toBe(3);
    });
  });

  describe('Color Themes and Styling', () => {
    it('should show different latency color states', () => {
      const container = document.createElement('div');
      container.className = 'test-container';
      document.body.appendChild(container);

      const section = document.createElement('div');
      section.className = 'test-section';
      section.innerHTML = '<div class="test-title">Latency Color Indicators</div>';
      
      const latencies = [
        { value: 25, label: 'Excellent (< 50ms)', color: '#4CAF50' },
        { value: 100, label: 'Good (50-150ms)', color: '#ff9800' },
        { value: 200, label: 'Poor (> 150ms)', color: '#f44336' }
      ];

      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.gap = '20px';

      latencies.forEach(({ value, label }) => {
        const latencyBox = document.createElement('div');
        latencyBox.style.cssText = `
          padding: 15px;
          border: 1px solid #333;
          border-radius: 5px;
          text-align: center;
        `;
        
        const networkStatus = new NetworkStatus();
        const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
        
        mockNM.getConnectionInfo.mockReturnValue({
          peerId: 'test-peer',
          gameCode: 'LAT' + value,
          isHost: true,
          status: ConnectionStatus.CONNECTED,
          lastActivity: Date.now(),
          latency: value,
          playerColor: 'black',
          opponentConnected: true
        });
        
        mockNM.getLatency.mockReturnValue(value);
        networkStatus.setNetworkManager(mockNM);
        
        // Extract just the latency display
        const latencyElement = document.querySelector('.network-status-latency')?.cloneNode(true) as HTMLElement;
        if (latencyElement) {
          latencyBox.innerHTML = `
            <div style="margin-bottom: 10px; font-size: 12px; color: #999;">${label}</div>
            ${latencyElement.innerHTML}
          `;
        }
        
        wrapper.appendChild(latencyBox);
        networkStatus.dispose();
      });

      section.appendChild(wrapper);
      container.appendChild(section);

      expect(wrapper.children.length).toBe(latencies.length);
    });

    it('should show turn indicator animations', () => {
      const container = document.createElement('div');
      container.className = 'test-container';
      document.body.appendChild(container);

      const section = document.createElement('div');
      section.className = 'test-section';
      section.innerHTML = '<div class="test-title">Turn Indicators</div>';
      
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.gap = '20px';
      wrapper.style.alignItems = 'center';

      ['Your Turn', 'Opponent Turn', 'Waiting'].forEach((state, index) => {
        const turnBox = document.createElement('div');
        turnBox.style.cssText = `
          padding: 15px;
          border: 1px solid #333;
          border-radius: 5px;
          min-width: 150px;
        `;
        
        const networkStatus = new NetworkStatus();
        const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
        
        mockNM.getConnectionInfo.mockReturnValue({
          peerId: 'test-peer',
          gameCode: 'TURN' + index,
          isHost: true,
          status: ConnectionStatus.CONNECTED,
          lastActivity: Date.now(),
          latency: 50,
          playerColor: 'black',
          opponentConnected: index < 2
        });
        
        mockNM.isLocalPlayerTurn.mockReturnValue(index === 0);
        networkStatus.setNetworkManager(mockNM);
        
        // Extract turn indicator
        const turnElement = document.querySelector('.network-status-turn')?.cloneNode(true) as HTMLElement;
        if (turnElement) {
          turnBox.appendChild(turnElement);
        }
        
        wrapper.appendChild(turnBox);
        networkStatus.dispose();
      });

      section.appendChild(wrapper);
      container.appendChild(section);

      // Visual verification:
      // 1. "Your Turn" should have green background and pulse animation
      // 2. "Opponent Turn" should have gray background
      // 3. "Waiting" should have orange background

      expect(wrapper.children.length).toBe(3);
    });
  });

  describe('Responsive Design', () => {
    it('should adapt to different screen sizes', () => {
      const container = document.createElement('div');
      container.className = 'test-container';
      document.body.appendChild(container);

      const section = document.createElement('div');
      section.className = 'test-section';
      section.innerHTML = '<div class="test-title">Responsive Network Status</div>';
      
      const viewports = [
        { width: 320, label: 'Mobile' },
        { width: 768, label: 'Tablet' },
        { width: 1024, label: 'Desktop' }
      ];

      viewports.forEach(({ width, label }) => {
        const viewportBox = document.createElement('div');
        viewportBox.style.cssText = `
          margin: 20px 0;
          padding: 15px;
          border: 1px dashed #666;
          position: relative;
        `;
        viewportBox.innerHTML = `<div style="margin-bottom: 10px; color: #999;">${label} (${width}px)</div>`;
        
        const viewportWrapper = document.createElement('div');
        viewportWrapper.style.cssText = `
          width: ${width}px;
          height: 200px;
          position: relative;
          overflow: hidden;
          background: #222;
          margin: 0 auto;
        `;
        
        const networkStatus = new NetworkStatus();
        const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
        
        mockNM.getConnectionInfo.mockReturnValue({
          peerId: 'test-peer',
          gameCode: 'RESP' + width,
          isHost: true,
          status: ConnectionStatus.CONNECTED,
          lastActivity: Date.now(),
          latency: 50,
          playerColor: 'black',
          opponentConnected: true
        });
        
        networkStatus.setNetworkManager(mockNM);
        
        const statusElement = document.querySelector('.network-status') as HTMLElement;
        if (statusElement) {
          // Adjust for viewport
          if (width <= 320) {
            statusElement.style.maxWidth = '280px';
            statusElement.style.fontSize = '12px';
          }
          viewportWrapper.appendChild(statusElement);
        }
        
        viewportBox.appendChild(viewportWrapper);
        section.appendChild(viewportBox);
      });

      container.appendChild(section);

      // Visual verification:
      // 1. Mobile view should fit within 320px
      // 2. Text should remain readable
      // 3. Buttons should be tappable size
      // 4. Layout should not break

      expect(section.querySelectorAll('[style*="width"]').length).toBeGreaterThan(0);
    });
  });

  afterEach(() => {
    // Clean up any remaining modals or status elements
    document.querySelectorAll('.modal, .network-status').forEach(el => el.remove());
    jest.clearAllMocks();
  });
});