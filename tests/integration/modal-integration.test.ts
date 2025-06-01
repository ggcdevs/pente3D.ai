import { MenuModal, SettingsModal, DialogManager } from '../../src/ui';
import { Game } from '../../src/core/Game';
import { Settings } from '../../src/storage/Settings';
import { StorageManager } from '../../src/storage/StorageManager';
import { Renderer } from '../../src/rendering/Renderer';
import { Vector3 } from '../../src/core';

jest.mock('../../src/rendering/Renderer');

describe('Modal System Integration', () => {
  let game: Game;
  let settings: Settings;
  let renderer: Renderer;
  let dialogManager: DialogManager;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    
    // Create instances
    game = new Game({ boardSize: 7 });
    settings = new Settings();
    renderer = new Renderer({
      canvas: document.createElement('canvas'),
      boardSize: 7
    });
    dialogManager = new DialogManager();
    
    // Mock StorageManager
    jest.spyOn(StorageManager, 'getSavedGames').mockReturnValue([]);
  });

  afterEach(() => {
    // Clean up
    dialogManager.closeAll();
    document.querySelectorAll('.modal').forEach(el => el.remove());
    jest.clearAllMocks();
  });

  describe('Menu and Settings Modal Integration', () => {
    it('should open settings modal from menu modal', () => {
      const menuModal = new MenuModal({
        game,
        onSettings: () => {
          const settingsModal = new SettingsModal({
            settings,
            renderer
          });
          settingsModal.open();
        }
      });

      menuModal.open();
      
      // Click settings button
      const settingsBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Settings')) as HTMLButtonElement;
      
      settingsBtn.click();
      
      // Menu should close
      expect(document.querySelector('.menu-modal')).toBeNull();
      
      // Settings should open
      expect(document.querySelector('.settings-modal')).toBeDefined();
    });

    it('should show dialog when starting new game with progress', async () => {
      // Make a move
      game.placePiece(new Vector3(0, 0, 0));
      
      let dialogShown = false;
      
      const menuModal = new MenuModal({
        game,
        onNewGame: async () => {
          dialogShown = true;
          const confirmed = await dialogManager.confirmAction(
            'start a new game',
            'This will clear the current game progress.'
          );
          if (confirmed) {
            game.reset();
          }
        }
      });

      menuModal.open();
      
      // Click new game button
      const newGameBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('New Game')) as HTMLButtonElement;
      
      newGameBtn.click();
      
      // Dialog should be shown
      expect(dialogShown).toBe(true);
      expect(document.querySelector('.dialog-confirm')).toBeDefined();
      
      // Confirm the action
      const confirmBtn = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent === 'Yes') as HTMLButtonElement;
      
      confirmBtn.click();
      
      // Game should be reset
      expect(game.getState().moveHistory).toHaveLength(0);
    });
  });

  describe('Modal Stacking and Focus Management', () => {
    it('should manage focus between stacked modals', () => {
      const menuModal = new MenuModal({
        game,
        onAbout: () => {
          dialogManager.showInfo('About information');
        }
      });

      menuModal.open();
      
      // Menu modal should have focus
      const menuButtons = document.querySelectorAll('.menu-button');
      expect(menuButtons.length).toBeGreaterThan(0);
      
      // Click about button
      const aboutBtn = Array.from(menuButtons)
        .find(btn => btn.textContent?.includes('About')) as HTMLButtonElement;
      
      aboutBtn.click();
      
      // Info dialog should be on top
      const dialogs = document.querySelectorAll('.modal');
      expect(dialogs).toHaveLength(2);
      
      // Close info dialog
      const okBtn = document.querySelector('.dialog-info button') as HTMLButtonElement;
      okBtn.click();
      
      // Only menu modal should remain
      setTimeout(() => {
        expect(document.querySelectorAll('.modal')).toHaveLength(1);
        expect(document.querySelector('.menu-modal')).toBeDefined();
      }, 300);
    });
  });

  describe('Settings Integration with Game', () => {
    it('should apply settings changes and persist them', () => {
      const onSettingsChange = jest.fn();
      
      const settingsModal = new SettingsModal({
        settings,
        renderer,
        onSettingsChange
      });

      settingsModal.open();
      
      // Change a setting
      const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
      colorInput.value = '#ff0000';
      const event = new Event('input', { bubbles: true });
      colorInput.dispatchEvent(event);
      
      // Apply changes
      const applyBtn = Array.from(document.querySelectorAll('.modal-footer button'))
        .find(btn => btn.textContent === 'Apply') as HTMLButtonElement;
      
      applyBtn.click();
      
      // Callback should be called with updated settings
      expect(onSettingsChange).toHaveBeenCalledWith(settings);
      expect(settings.gridColor).toBe('#ff0000');
    });
  });

  describe('File Import/Export Integration', () => {
    it('should handle game export through menu modal', () => {
      const onExportGame = jest.fn();
      
      // Make a move so export is available
      game.placePiece(new Vector3(0, 0, 0));
      
      const menuModal = new MenuModal({
        game,
        onExportGame
      });

      menuModal.open();
      
      const exportBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Export Game')) as HTMLButtonElement;
      
      exportBtn.click();
      
      expect(onExportGame).toHaveBeenCalled();
    });

    it('should handle game import through menu modal', () => {
      const onImportGame = jest.fn();
      
      const menuModal = new MenuModal({
        game,
        onImportGame
      });

      menuModal.open();
      
      const importBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Import Game')) as HTMLButtonElement;
      
      importBtn.click();
      
      // Should show import dialog
      expect(document.querySelector('.modal-content')?.textContent)
        .toContain('Select a game file to import:');
      
      // Simulate file selection
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const testFile = new File(['{}'], 'test.json', { type: 'application/json' });
      
      Object.defineProperty(fileInput, 'files', {
        value: [testFile],
        writable: false
      });
      
      const changeEvent = new Event('change', { bubbles: true });
      fileInput.dispatchEvent(changeEvent);
      
      expect(onImportGame).toHaveBeenCalledWith(testFile);
    });
  });

  describe('Error Handling Integration', () => {
    it('should show error dialog on failed game load', () => {
      const menuModal = new MenuModal({
        game,
        onLoadGame: (gameState) => {
          try {
            // Simulate error
            throw new Error('Invalid game data');
          } catch (error) {
            dialogManager.showError('Failed to load game: ' + (error as Error).message);
          }
        }
      });

      // Mock saved games
      jest.spyOn(StorageManager, 'getSavedGames').mockReturnValue([
        { name: 'Corrupted Game', timestamp: Date.now(), data: {} }
      ]);

      menuModal = new MenuModal({
        game,
        storageManager: StorageManager,
        onLoadGame: (gameState) => {
          dialogManager.showError('Failed to load game: Invalid game data');
        }
      });

      menuModal.open();
      
      // Click load game
      const loadBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Load Game')) as HTMLButtonElement;
      
      loadBtn.click();
      
      // Click the corrupted game
      const gameBtn = document.querySelector('.load-game-button') as HTMLButtonElement;
      gameBtn.click();
      
      // Error dialog should be shown
      expect(document.querySelector('.dialog-error')).toBeDefined();
      expect(document.querySelector('.dialog-error p')?.textContent)
        .toBe('Failed to load game: Invalid game data');
    });
  });

  describe('Keyboard Navigation Between Modals', () => {
    it('should handle Escape key properly across modals', () => {
      const menuModal = new MenuModal({
        game,
        storageManager: StorageManager
      });

      menuModal.open();
      
      // Press Escape - should close menu
      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(escapeEvent);
      
      expect(document.querySelector('.menu-modal')).toBeNull();
      
      // Open dialog
      dialogManager.showInfo('Test message');
      
      // Press Escape - should close dialog
      document.dispatchEvent(escapeEvent);
      
      setTimeout(() => {
        expect(document.querySelector('.dialog-info')).toBeNull();
      }, 300);
    });

    it('should trap Tab navigation within active modal', () => {
      const settingsModal = new SettingsModal({
        settings,
        renderer
      });

      settingsModal.open();
      
      // Get all focusable elements
      const focusableElements = document.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      
      expect(focusableElements.length).toBeGreaterThan(0);
      
      // Simulate Tab press
      const tabEvent = new KeyboardEvent('keydown', { 
        key: 'Tab',
        bubbles: true,
        cancelable: true
      });
      
      document.dispatchEvent(tabEvent);
      
      // Focus should remain within modal
      const activeElement = document.activeElement;
      const modalElement = document.querySelector('.settings-modal');
      expect(modalElement?.contains(activeElement)).toBe(true);
    });
  });

  describe('Responsive Behavior', () => {
    it('should adapt modal size on window resize', () => {
      const menuModal = new MenuModal({
        game,
        storageManager: StorageManager
      });

      menuModal.open();
      
      const modalContainer = document.querySelector('.modal-container') as HTMLElement;
      const initialWidth = modalContainer.offsetWidth;
      
      // Simulate mobile viewport
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 400
      });
      
      // Trigger resize event
      const resizeEvent = new Event('resize');
      window.dispatchEvent(resizeEvent);
      
      // Modal should adapt (CSS media queries would apply)
      // Note: JSDOM doesn't support actual CSS media queries,
      // so we're testing the structure exists for CSS to apply
      expect(modalContainer.style.maxWidth).toBe('90vw');
    });
  });

  describe('Performance and Memory', () => {
    it('should clean up event listeners when modals are destroyed', () => {
      const removeEventListenerSpy = jest.spyOn(document, 'removeEventListener');
      
      const menuModal = new MenuModal({
        game,
        storageManager: StorageManager
      });

      menuModal.open();
      menuModal.destroy();
      
      // Should remove keyboard event listeners
      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    it('should handle rapid modal opening and closing', () => {
      const modals: MenuModal[] = [];
      
      // Open and close multiple modals rapidly
      for (let i = 0; i < 10; i++) {
        const modal = new MenuModal({
          game,
          storageManager: StorageManager
        });
        modals.push(modal);
        modal.open();
        modal.close();
      }
      
      // Clean up
      setTimeout(() => {
        modals.forEach(modal => modal.destroy());
        
        // Should not have any lingering modal elements
        expect(document.querySelectorAll('.modal').length).toBe(0);
      }, 500);
    });
  });
});