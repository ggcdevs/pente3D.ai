import { MenuModal, MenuModalOptions } from '../../../src/ui/MenuModal';
import { Game } from '../../../src/core/Game';
import { GameState } from '../../../src/core/GameState';
import { StorageManager } from '../../../src/storage/StorageManager';
import { Vector3 } from '../../../src/core';

jest.mock('../../../src/storage/StorageManager');

describe('MenuModal', () => {
  let menuModal: MenuModal;
  let game: Game;
  let storageManager: StorageManager;
  let options: MenuModalOptions;
  
  const mockCallbacks = {
    onNewGame: jest.fn(),
    onLoadGame: jest.fn(),
    onSaveGame: jest.fn(),
    onExportGame: jest.fn(),
    onImportGame: jest.fn(),
    onSettings: jest.fn(),
    onAbout: jest.fn()
  };

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    
    // Create game instance
    game = new Game({ boardSize: 7 });
    
    // Mock StorageManager
    (StorageManager.getSavedGames as jest.Mock).mockReturnValue([]);
    
    // Create options
    options = {
      game,
      storageManager: StorageManager,
      ...mockCallbacks
    };
    
    menuModal = new MenuModal(options);
    
    // Clear all mocks
    Object.values(mockCallbacks).forEach(mock => mock.mockClear());
  });

  afterEach(() => {
    menuModal.destroy();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create menu modal with correct title', () => {
      expect(menuModal).toBeDefined();
      expect((menuModal as any).options.title).toBe('Game Menu');
    });

    it('should store game and storage manager references', () => {
      expect((menuModal as any).game).toBe(game);
      expect((menuModal as any).storageManager).toBe(StorageManager);
    });
  });

  describe('render', () => {
    it('should render basic menu options', () => {
      menuModal.open();
      
      const buttons = document.querySelectorAll('.menu-button');
      const buttonTexts = Array.from(buttons).map(btn => btn.textContent);
      
      expect(buttonTexts).toContain('🎮 New Game');
      expect(buttonTexts).toContain('📥 Import Game');
      expect(buttonTexts).toContain('⚙️ Settings');
      expect(buttonTexts).toContain('ℹ️ About');
    });

    it('should show Continue Game when game is in progress', () => {
      // Make a move
      game.placePiece(new Vector3(0, 0, 0));
      
      menuModal = new MenuModal(options);
      menuModal.open();
      
      const buttons = document.querySelectorAll('.menu-button');
      const buttonTexts = Array.from(buttons).map(btn => btn.textContent);
      
      expect(buttonTexts).toContain('▶️ Continue Game');
    });

    it('should show Save Game when game is in progress', () => {
      // Make a move
      game.placePiece(new Vector3(0, 0, 0));
      
      menuModal = new MenuModal(options);
      menuModal.open();
      
      const buttons = document.querySelectorAll('.menu-button');
      const buttonTexts = Array.from(buttons).map(btn => btn.textContent);
      
      expect(buttonTexts).toContain('💾 Save Game');
    });

    it('should show Export Game when game is in progress', () => {
      // Make a move
      game.placePiece(new Vector3(0, 0, 0));
      
      menuModal = new MenuModal(options);
      menuModal.open();
      
      const buttons = document.querySelectorAll('.menu-button');
      const buttonTexts = Array.from(buttons).map(btn => btn.textContent);
      
      expect(buttonTexts).toContain('📤 Export Game');
    });

    it('should show Load Game when saved games exist', () => {
      (StorageManager.getSavedGames as jest.Mock).mockReturnValue([
        { name: 'Test Game', timestamp: Date.now(), data: {} }
      ]);
      
      menuModal = new MenuModal(options);
      menuModal.open();
      
      const buttons = document.querySelectorAll('.menu-button');
      const buttonTexts = Array.from(buttons).map(btn => btn.textContent);
      
      expect(buttonTexts).toContain('📂 Load Game');
    });
  });

  describe('button interactions', () => {
    beforeEach(() => {
      menuModal.open();
    });

    it('should call onNewGame and close modal', () => {
      const newGameBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('New Game')) as HTMLButtonElement;
      
      newGameBtn.click();
      
      expect(mockCallbacks.onNewGame).toHaveBeenCalled();
      expect((menuModal as any).isOpen).toBe(false);
    });

    it('should close modal on Continue Game', () => {
      game.placePiece(new Vector3(0, 0, 0));
      menuModal = new MenuModal(options);
      menuModal.open();
      
      const continueBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Continue Game')) as HTMLButtonElement;
      
      continueBtn.click();
      
      expect((menuModal as any).isOpen).toBe(false);
    });

    it('should call onSettings and close modal', () => {
      const settingsBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Settings')) as HTMLButtonElement;
      
      settingsBtn.click();
      
      expect(mockCallbacks.onSettings).toHaveBeenCalled();
      expect((menuModal as any).isOpen).toBe(false);
    });

    it('should call onAbout without closing modal', () => {
      const aboutBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('About')) as HTMLButtonElement;
      
      aboutBtn.click();
      
      expect(mockCallbacks.onAbout).toHaveBeenCalled();
      expect((menuModal as any).isOpen).toBe(true);
    });
  });

  describe('load game menu', () => {
    beforeEach(() => {
      (StorageManager.getSavedGames as jest.Mock).mockReturnValue([
        {
          name: 'Game 1',
          timestamp: Date.now(),
          data: { moveHistory: [1, 2, 3] }
        },
        {
          name: 'Game 2',
          timestamp: Date.now() - 86400000, // Yesterday
          data: { moveHistory: [1, 2] }
        }
      ]);
      
      menuModal = new MenuModal(options);
      menuModal.open();
    });

    it('should show saved games list', () => {
      const loadBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Load Game')) as HTMLButtonElement;
      
      loadBtn.click();
      
      const gameButtons = document.querySelectorAll('.load-game-button');
      expect(gameButtons).toHaveLength(2);
      
      const gameInfo = Array.from(gameButtons).map(btn => btn.textContent);
      expect(gameInfo[0]).toContain('Game 1');
      expect(gameInfo[0]).toContain('Moves: 3');
      expect(gameInfo[1]).toContain('Game 2');
      expect(gameInfo[1]).toContain('Moves: 2');
    });

    it('should call onLoadGame with selected game data', () => {
      const loadBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Load Game')) as HTMLButtonElement;
      
      loadBtn.click();
      
      const gameButtons = document.querySelectorAll('.load-game-button');
      (gameButtons[0] as HTMLButtonElement).click();
      
      expect(mockCallbacks.onLoadGame).toHaveBeenCalledWith({ moveHistory: [1, 2, 3] });
      expect((menuModal as any).isOpen).toBe(false);
    });

    it('should have back button to return to main menu', () => {
      const loadBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Load Game')) as HTMLButtonElement;
      
      loadBtn.click();
      
      const backBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Back')) as HTMLButtonElement;
      
      expect(backBtn).toBeDefined();
      
      backBtn.click();
      
      // Should be back at main menu
      const newGameBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('New Game'));
      expect(newGameBtn).toBeDefined();
    });
  });

  describe('save game', () => {
    beforeEach(() => {
      game.placePiece(new Vector3(0, 0, 0));
      menuModal = new MenuModal(options);
      menuModal.open();
    });

    it('should call onSaveGame and show confirmation', () => {
      const saveBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Save Game')) as HTMLButtonElement;
      
      saveBtn.click();
      
      expect(mockCallbacks.onSaveGame).toHaveBeenCalled();
      
      // Should show confirmation message
      const content = document.querySelector('.modal-content');
      expect(content?.textContent).toContain('Game saved successfully!');
    });

    it('should close modal on confirmation OK', () => {
      const saveBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Save Game')) as HTMLButtonElement;
      
      saveBtn.click();
      
      const okBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('OK')) as HTMLButtonElement;
      
      okBtn.click();
      
      expect((menuModal as any).isOpen).toBe(false);
    });
  });

  describe('export game', () => {
    beforeEach(() => {
      game.placePiece(new Vector3(0, 0, 0));
      menuModal = new MenuModal(options);
      menuModal.open();
    });

    it('should call onExportGame and close modal', () => {
      const exportBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Export Game')) as HTMLButtonElement;
      
      exportBtn.click();
      
      expect(mockCallbacks.onExportGame).toHaveBeenCalled();
      expect((menuModal as any).isOpen).toBe(false);
    });
  });

  describe('import game', () => {
    beforeEach(() => {
      menuModal.open();
    });

    it('should show import dialog', () => {
      const importBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Import Game')) as HTMLButtonElement;
      
      importBtn.click();
      
      const content = document.querySelector('.modal-content');
      expect(content?.textContent).toContain('Select a game file to import:');
      
      const chooseFileBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Choose File'));
      expect(chooseFileBtn).toBeDefined();
    });

    it('should trigger file input on Choose File click', () => {
      const importBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Import Game')) as HTMLButtonElement;
      
      importBtn.click();
      
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const clickSpy = jest.spyOn(fileInput, 'click');
      
      const chooseFileBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Choose File')) as HTMLButtonElement;
      
      chooseFileBtn.click();
      
      expect(clickSpy).toHaveBeenCalled();
    });

    it('should call onImportGame when file is selected', () => {
      const importBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Import Game')) as HTMLButtonElement;
      
      importBtn.click();
      
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const testFile = new File(['{}'], 'test.json', { type: 'application/json' });
      
      // Simulate file selection
      Object.defineProperty(fileInput, 'files', {
        value: [testFile],
        writable: false
      });
      
      const changeEvent = new Event('change', { bubbles: true });
      fileInput.dispatchEvent(changeEvent);
      
      expect(mockCallbacks.onImportGame).toHaveBeenCalledWith(testFile);
      expect((menuModal as any).isOpen).toBe(false);
    });

    it('should have back button in import dialog', () => {
      const importBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Import Game')) as HTMLButtonElement;
      
      importBtn.click();
      
      const backBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('Back')) as HTMLButtonElement;
      
      expect(backBtn).toBeDefined();
      
      backBtn.click();
      
      // Should be back at main menu
      const newGameBtn = Array.from(document.querySelectorAll('.menu-button'))
        .find(btn => btn.textContent?.includes('New Game'));
      expect(newGameBtn).toBeDefined();
    });
  });

  describe('button styling', () => {
    it('should apply hover styles', () => {
      menuModal.open();
      
      const button = document.querySelector('.menu-button') as HTMLButtonElement;
      const initialBg = button.style.backgroundColor;
      
      // Simulate mouseenter
      const mouseenterEvent = new MouseEvent('mouseenter', { bubbles: true });
      button.dispatchEvent(mouseenterEvent);
      
      expect(button.style.backgroundColor).not.toBe(initialBg);
      
      // Simulate mouseleave
      const mouseleaveEvent = new MouseEvent('mouseleave', { bubbles: true });
      button.dispatchEvent(mouseleaveEvent);
      
      expect(button.style.backgroundColor).toBe(initialBg);
    });
  });
});