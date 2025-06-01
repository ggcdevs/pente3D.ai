import { NetworkModal, NetworkModalOptions } from '@/ui/NetworkModal';
import { NetworkManager } from '@/network';
import { Game } from '@/core';

// Mock NetworkManager
jest.mock('@/network/NetworkManager');

describe('NetworkModal', () => {
  let modal: NetworkModal;
  let game: Game;
  let options: NetworkModalOptions;
  let mockNetworkStart: jest.Mock;
  let mockCancel: jest.Mock;

  beforeEach(() => {
    // Clear DOM
    document.body.innerHTML = '';
    
    // Create game instance
    game = new Game({ boardSize: 7 });
    
    // Create mock callbacks
    mockNetworkStart = jest.fn();
    mockCancel = jest.fn();
    
    // Create options
    options = {
      game,
      onNetworkStart: mockNetworkStart,
      onCancel: mockCancel
    };
    
    // Create modal
    modal = new NetworkModal(options);
  });

  afterEach(() => {
    modal.destroy();
    jest.clearAllMocks();
  });

  describe('Menu View', () => {
    it('should show menu view by default', () => {
      modal.open();
      
      const menuView = document.querySelector('.network-menu');
      expect(menuView).toBeTruthy();
      
      const hostBtn = document.querySelector('.host-btn');
      const joinBtn = document.querySelector('.join-btn');
      const cancelBtn = document.querySelector('.cancel-network-btn');
      
      expect(hostBtn).toBeTruthy();
      expect(joinBtn).toBeTruthy();
      expect(cancelBtn).toBeTruthy();
    });

    it('should have correct button styling', () => {
      modal.open();
      
      const hostBtn = document.querySelector('.host-btn') as HTMLElement;
      const joinBtn = document.querySelector('.join-btn') as HTMLElement;
      
      expect(hostBtn.style.background).toContain('4CAF50');
      expect(joinBtn.style.background).toContain('2196F3');
    });

    it('should handle cancel button click', () => {
      modal.open();
      
      const cancelBtn = document.querySelector('.cancel-network-btn') as HTMLButtonElement;
      cancelBtn.click();
      
      expect(mockCancel).toHaveBeenCalled();
      expect(document.querySelector('.modal')).toBeFalsy();
    });

    it('should transition to host view on host button click', () => {
      modal.open();
      
      const hostBtn = document.querySelector('.host-btn') as HTMLButtonElement;
      hostBtn.click();
      
      // Should show host view
      const hostView = document.querySelector('.network-host');
      expect(hostView).toBeTruthy();
      
      // Menu should be gone
      const menuView = document.querySelector('.network-menu');
      expect(menuView).toBeFalsy();
    });

    it('should transition to join view on join button click', () => {
      modal.open();
      
      const joinBtn = document.querySelector('.join-btn') as HTMLButtonElement;
      joinBtn.click();
      
      // Should show join view
      const joinView = document.querySelector('.network-join');
      expect(joinView).toBeTruthy();
      
      // Menu should be gone
      const menuView = document.querySelector('.network-menu');
      expect(menuView).toBeFalsy();
    });
  });

  describe('Host View', () => {
    beforeEach(() => {
      modal.open();
      const hostBtn = document.querySelector('.host-btn') as HTMLButtonElement;
      hostBtn.click();
    });

    it('should show loading initially', () => {
      const loadingContainer = document.querySelector('.loading-container');
      const gameCodeContainer = document.querySelector('.game-code-container') as HTMLElement;
      
      expect(loadingContainer).toBeTruthy();
      expect(gameCodeContainer.style.display).toBe('none');
    });

    it('should create NetworkManager and call hostGame', async () => {
      // NetworkManager constructor should have been called
      expect(NetworkManager).toHaveBeenCalledWith(game);
      
      // Get the mock instance
      const mockInstance = (NetworkManager as jest.MockedClass<typeof NetworkManager>).mock.instances[0];
      
      // hostGame should have been called
      expect(mockInstance.hostGame).toHaveBeenCalled();
    });

    it('should display game code after hosting', async () => {
      // Get the mock NetworkManager instance
      const mockInstance = (NetworkManager as jest.MockedClass<typeof NetworkManager>).mock.instances[0];
      
      // Mock hostGame to resolve with a game code
      (mockInstance.hostGame as jest.Mock).mockResolvedValue('ABC123');
      
      // Trigger host again to get the promise to resolve
      const hostBtn = document.querySelector('.back-btn') as HTMLButtonElement;
      hostBtn.click(); // Go back
      
      modal.open();
      const newHostBtn = document.querySelector('.host-btn') as HTMLButtonElement;
      newHostBtn.click();
      
      // Wait for promise to resolve
      await new Promise(resolve => setTimeout(resolve, 0));
      
      const gameCodeContainer = document.querySelector('.game-code-container') as HTMLElement;
      const loadingContainer = document.querySelector('.loading-container') as HTMLElement;
      const codeElement = document.querySelector('.game-code');
      
      expect(loadingContainer.style.display).toBe('none');
      expect(gameCodeContainer.style.display).toBe('block');
      expect(codeElement?.textContent).toBe('ABC123');
    });

    it('should have back button functionality', () => {
      const backBtn = document.querySelector('.back-btn') as HTMLButtonElement;
      expect(backBtn).toBeTruthy();
      
      backBtn.click();
      
      // Should return to menu
      const menuView = document.querySelector('.network-menu');
      const hostView = document.querySelector('.network-host');
      
      expect(menuView).toBeTruthy();
      expect(hostView).toBeFalsy();
    });

    it('should handle copy code button', async () => {
      // Mock clipboard API
      Object.assign(navigator, {
        clipboard: {
          writeText: jest.fn().mockResolvedValue(undefined)
        }
      });
      
      // Setup with game code
      const mockInstance = (NetworkManager as jest.MockedClass<typeof NetworkManager>).mock.instances[0];
      (mockInstance.hostGame as jest.Mock).mockResolvedValue('XYZ789');
      
      // Re-trigger host to get code
      const backBtn = document.querySelector('.back-btn') as HTMLButtonElement;
      backBtn.click();
      modal.open();
      const hostBtn = document.querySelector('.host-btn') as HTMLButtonElement;
      hostBtn.click();
      
      await new Promise(resolve => setTimeout(resolve, 0));
      
      const copyBtn = document.querySelector('.copy-code-btn') as HTMLButtonElement;
      copyBtn.click();
      
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('XYZ789');
    });
  });

  describe('Join View', () => {
    beforeEach(() => {
      modal.open();
      const joinBtn = document.querySelector('.join-btn') as HTMLButtonElement;
      joinBtn.click();
    });

    it('should show game code input', () => {
      const input = document.querySelector('.game-code-input') as HTMLInputElement;
      const joinGameBtn = document.querySelector('.join-game-btn') as HTMLButtonElement;
      
      expect(input).toBeTruthy();
      expect(joinGameBtn).toBeTruthy();
      expect(joinGameBtn.disabled).toBe(true);
    });

    it('should enable join button when valid code entered', () => {
      const input = document.querySelector('.game-code-input') as HTMLInputElement;
      const joinGameBtn = document.querySelector('.join-game-btn') as HTMLButtonElement;
      
      // Enter partial code
      input.value = 'ABC';
      input.dispatchEvent(new Event('input'));
      expect(joinGameBtn.disabled).toBe(true);
      
      // Enter full code
      input.value = 'ABC123';
      input.dispatchEvent(new Event('input'));
      expect(joinGameBtn.disabled).toBe(false);
    });

    it('should convert input to uppercase', () => {
      const input = document.querySelector('.game-code-input') as HTMLInputElement;
      
      input.value = 'abc123';
      input.dispatchEvent(new Event('input'));
      
      const joinGameBtn = document.querySelector('.join-game-btn') as HTMLButtonElement;
      expect(joinGameBtn.disabled).toBe(false); // Should accept lowercase
    });

    it('should handle join button click', async () => {
      const input = document.querySelector('.game-code-input') as HTMLInputElement;
      const joinGameBtn = document.querySelector('.join-game-btn') as HTMLButtonElement;
      
      input.value = 'ABC123';
      input.dispatchEvent(new Event('input'));
      
      joinGameBtn.click();
      
      // Should create NetworkManager and call joinGame
      expect(NetworkManager).toHaveBeenCalledWith(game);
      
      const mockInstance = (NetworkManager as jest.MockedClass<typeof NetworkManager>).mock.instances[0];
      expect(mockInstance.joinGame).toHaveBeenCalledWith('ABC123');
    });

    it('should handle enter key press', () => {
      const input = document.querySelector('.game-code-input') as HTMLInputElement;
      
      input.value = 'ABC123';
      input.dispatchEvent(new Event('input'));
      
      const enterEvent = new KeyboardEvent('keypress', { key: 'Enter' });
      input.dispatchEvent(enterEvent);
      
      // Should call joinGame
      const mockInstance = (NetworkManager as jest.MockedClass<typeof NetworkManager>).mock.instances[0];
      expect(mockInstance.joinGame).toHaveBeenCalledWith('ABC123');
    });

    it('should show error message on join failure', async () => {
      const input = document.querySelector('.game-code-input') as HTMLInputElement;
      const joinGameBtn = document.querySelector('.join-game-btn') as HTMLButtonElement;
      const errorMsg = document.querySelector('.error-message') as HTMLElement;
      
      // Mock joinGame to reject
      const mockInstance = (NetworkManager as jest.MockedClass<typeof NetworkManager>).mock.instances[0];
      (mockInstance.joinGame as jest.Mock).mockRejectedValue(new Error('Connection failed'));
      
      input.value = 'ABC123';
      input.dispatchEvent(new Event('input'));
      joinGameBtn.click();
      
      // Wait for promise to reject
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(errorMsg.textContent).toContain('Connection failed');
      expect(input.disabled).toBe(false);
      expect(joinGameBtn.disabled).toBe(false);
    });

    it('should have back button functionality', () => {
      const backBtn = document.querySelector('.back-btn') as HTMLButtonElement;
      expect(backBtn).toBeTruthy();
      
      backBtn.click();
      
      // Should return to menu
      const menuView = document.querySelector('.network-menu');
      const joinView = document.querySelector('.network-join');
      
      expect(menuView).toBeTruthy();
      expect(joinView).toBeFalsy();
    });
  });

  describe('Connection Handling', () => {
    it('should handle successful connection for host', async () => {
      modal.open();
      const hostBtn = document.querySelector('.host-btn') as HTMLButtonElement;
      hostBtn.click();
      
      const mockInstance = (NetworkManager as jest.MockedClass<typeof NetworkManager>).mock.instances[0];
      (mockInstance.hostGame as jest.Mock).mockResolvedValue('ABC123');
      
      // Wait for host to complete
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Get the connected event handler
      const connectedHandler = (mockInstance.once as jest.Mock).mock.calls
        .find(call => call[0] === 'connected')?.[1];
      
      expect(connectedHandler).toBeTruthy();
      
      // Trigger connection
      connectedHandler();
      
      expect(mockNetworkStart).toHaveBeenCalledWith(mockInstance);
      expect(document.querySelector('.modal')).toBeFalsy();
    });

    it('should handle successful connection for client', async () => {
      modal.open();
      const joinBtn = document.querySelector('.join-btn') as HTMLButtonElement;
      joinBtn.click();
      
      const input = document.querySelector('.game-code-input') as HTMLInputElement;
      const joinGameBtn = document.querySelector('.join-game-btn') as HTMLButtonElement;
      
      input.value = 'ABC123';
      input.dispatchEvent(new Event('input'));
      joinGameBtn.click();
      
      const mockInstance = (NetworkManager as jest.MockedClass<typeof NetworkManager>).mock.instances[0];
      
      // Get the connected event handler
      const connectedHandler = (mockInstance.once as jest.Mock).mock.calls
        .find(call => call[0] === 'connected')?.[1];
      
      expect(connectedHandler).toBeTruthy();
      
      // Trigger connection
      connectedHandler();
      
      expect(mockNetworkStart).toHaveBeenCalledWith(mockInstance);
      expect(document.querySelector('.modal')).toBeFalsy();
    });

    it('should handle connection errors', async () => {
      modal.open();
      const hostBtn = document.querySelector('.host-btn') as HTMLButtonElement;
      hostBtn.click();
      
      const mockInstance = (NetworkManager as jest.MockedClass<typeof NetworkManager>).mock.instances[0];
      (mockInstance.hostGame as jest.Mock).mockResolvedValue('ABC123');
      
      // Wait for host to complete
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Get the error event handler
      const errorHandler = (mockInstance.on as jest.Mock).mock.calls
        .find(call => call[0] === 'error')?.[1];
      
      expect(errorHandler).toBeTruthy();
      
      // Trigger error
      errorHandler(new Error('Network error'));
      
      const statusElement = document.querySelector('.connection-status');
      expect(statusElement?.textContent).toContain('Network error');
    });
  });

  describe('Share Functionality', () => {
    it('should handle share link button with navigator.share', async () => {
      // Mock navigator.share
      Object.assign(navigator, {
        share: jest.fn().mockResolvedValue(undefined)
      });
      
      modal.open();
      const hostBtn = document.querySelector('.host-btn') as HTMLButtonElement;
      hostBtn.click();
      
      const mockInstance = (NetworkManager as jest.MockedClass<typeof NetworkManager>).mock.instances[0];
      (mockInstance.hostGame as jest.Mock).mockResolvedValue('ABC123');
      
      await new Promise(resolve => setTimeout(resolve, 0));
      
      const shareBtn = document.querySelector('.share-link-btn') as HTMLButtonElement;
      shareBtn.click();
      
      expect(navigator.share).toHaveBeenCalledWith({
        title: 'Join my Pente3D game!',
        text: 'Game Code: ABC123',
        url: expect.stringContaining('?join=ABC123')
      });
    });

    it('should fallback to clipboard when navigator.share unavailable', async () => {
      // Remove navigator.share
      Object.assign(navigator, {
        share: undefined,
        clipboard: {
          writeText: jest.fn().mockResolvedValue(undefined)
        }
      });
      
      modal.open();
      const hostBtn = document.querySelector('.host-btn') as HTMLButtonElement;
      hostBtn.click();
      
      const mockInstance = (NetworkManager as jest.MockedClass<typeof NetworkManager>).mock.instances[0];
      (mockInstance.hostGame as jest.Mock).mockResolvedValue('ABC123');
      
      await new Promise(resolve => setTimeout(resolve, 0));
      
      const shareBtn = document.querySelector('.share-link-btn') as HTMLButtonElement;
      shareBtn.click();
      
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('?join=ABC123')
      );
    });
  });

  describe('Cleanup', () => {
    it('should disconnect network manager on destroy', () => {
      modal.open();
      const hostBtn = document.querySelector('.host-btn') as HTMLButtonElement;
      hostBtn.click();
      
      const mockInstance = (NetworkManager as jest.MockedClass<typeof NetworkManager>).mock.instances[0];
      
      modal.destroy();
      
      expect(mockInstance.disconnect).toHaveBeenCalled();
    });

    it('should disconnect when going back from host view', () => {
      modal.open();
      const hostBtn = document.querySelector('.host-btn') as HTMLButtonElement;
      hostBtn.click();
      
      const mockInstance = (NetworkManager as jest.MockedClass<typeof NetworkManager>).mock.instances[0];
      
      const backBtn = document.querySelector('.back-btn') as HTMLButtonElement;
      backBtn.click();
      
      expect(mockInstance.disconnect).toHaveBeenCalled();
    });

    it('should clean up modal elements on destroy', () => {
      modal.open();
      expect(document.querySelector('.modal')).toBeTruthy();
      
      modal.destroy();
      expect(document.querySelector('.modal')).toBeFalsy();
    });
  });
});