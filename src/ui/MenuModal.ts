import type { ModalOptions } from './Modal';
import { Modal } from './Modal';
import type { Game } from '../core/Game';
import { StorageManager } from '../storage/StorageManager';

export interface MenuModalOptions extends ModalOptions {
  game: Game;
  onNewGame?: () => void;
  onLoadGame?: (gameState: any) => void;
  onSaveGame?: () => void;
  onExportGame?: () => void;
  onImportGame?: (file: File) => void;
  onSettings?: () => void;
  onAbout?: () => void;
  onNetworkGame?: () => void;
}

export class MenuModal extends Modal {
  private game: Game;
  private menuOptions: MenuModalOptions;

  constructor(options: MenuModalOptions) {
    super({
      title: 'Game Menu',
      className: 'menu-modal',
      ...options,
    });

    this.game = options.game;
    this.menuOptions = options;
  }

  protected render(): void {
    const menuContainer = document.createElement('div');
    menuContainer.className = 'menu-container';
    menuContainer.style.display = 'flex';
    menuContainer.style.flexDirection = 'column';
    menuContainer.style.gap = '10px';

    // New Game button
    const newGameBtn = this.createMenuButton('New Game', '🎮', () => {
      if (this.menuOptions.onNewGame) {
        this.menuOptions.onNewGame();
        this.close();
      }
    });
    menuContainer.appendChild(newGameBtn);

    // Continue Game button (if there's a game in progress)
    const currentState = this.game.getCurrentState();
    if (currentState.moveHistory.length > 0) {
      const continueBtn = this.createMenuButton('Continue Game', '▶️', () => {
        this.close();
      });
      menuContainer.appendChild(continueBtn);
    }

    // Load Game button
    const savedGames = StorageManager.listSavedGames();
    if (savedGames.length > 0) {
      const loadBtn = this.createMenuButton('Load Game', '📂', () => {
        this.showLoadGameMenu();
      });
      menuContainer.appendChild(loadBtn);
    }

    // Save Game button (if there's a game to save)
    if (currentState.moveHistory.length > 0) {
      const saveBtn = this.createMenuButton('Save Game', '💾', () => {
        if (this.menuOptions.onSaveGame) {
          this.menuOptions.onSaveGame();
          this.showSaveConfirmation();
        }
      });
      menuContainer.appendChild(saveBtn);
    }

    // Export Game button
    if (currentState.moveHistory.length > 0) {
      const exportBtn = this.createMenuButton('Export Game', '📤', () => {
        if (this.menuOptions.onExportGame) {
          this.menuOptions.onExportGame();
          this.close();
        }
      });
      menuContainer.appendChild(exportBtn);
    }

    // Import Game button
    const importBtn = this.createMenuButton('Import Game', '📥', () => {
      this.showImportDialog();
    });
    menuContainer.appendChild(importBtn);

    // Divider
    const divider = document.createElement('hr');
    divider.style.cssText =
      'width: 100%; border: none; border-top: 1px solid #333; margin: 10px 0;';
    menuContainer.appendChild(divider);

    // Network Game button
    const networkBtn = this.createMenuButton('Network Game', '🌐', () => {
      if (this.menuOptions.onNetworkGame) {
        this.menuOptions.onNetworkGame();
        this.close();
      }
    });
    networkBtn.style.background = 'linear-gradient(135deg, #2196F3, #1976D2)';
    menuContainer.appendChild(networkBtn);

    // Settings button
    const settingsBtn = this.createMenuButton('Settings', '⚙️', () => {
      if (this.menuOptions.onSettings) {
        this.menuOptions.onSettings();
        this.close();
      }
    });
    menuContainer.appendChild(settingsBtn);

    // About button
    const aboutBtn = this.createMenuButton('About', 'ℹ️', () => {
      if (this.menuOptions.onAbout) {
        this.menuOptions.onAbout();
      }
    });
    menuContainer.appendChild(aboutBtn);

    this.setContent(menuContainer);
  }

  private createMenuButton(text: string, icon: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'menu-button';
    button.style.padding = '15px 20px';
    button.style.fontSize = '1.1rem';
    button.style.backgroundColor = '#3a3a3a';
    button.style.color = '#fff';
    button.style.border = 'none';
    button.style.borderRadius = '6px';
    button.style.cursor = 'pointer';
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.gap = '10px';
    button.style.width = '100%';
    button.style.transition = 'background-color 0.2s';

    const iconSpan = document.createElement('span');
    iconSpan.textContent = icon;
    iconSpan.style.fontSize = '1.3rem';
    button.appendChild(iconSpan);

    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    button.appendChild(textSpan);

    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = '#4a4a4a';
    });

    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = '#3a3a3a';
    });

    button.addEventListener('click', onClick);

    return button;
  }

  private showLoadGameMenu(): void {
    const savedGames = StorageManager.listSavedGames();
    const loadContainer = document.createElement('div');
    loadContainer.style.display = 'flex';
    loadContainer.style.flexDirection = 'column';
    loadContainer.style.gap = '10px';

    const title = document.createElement('h3');
    title.textContent = 'Select a game to load:';
    title.style.color = '#fff';
    title.style.marginBottom = '10px';
    loadContainer.appendChild(title);

    savedGames.forEach((save: any) => {
      const gameBtn = document.createElement('button');
      gameBtn.className = 'load-game-button';
      gameBtn.style.padding = '10px';
      gameBtn.style.backgroundColor = '#3a3a3a';
      gameBtn.style.color = '#fff';
      gameBtn.style.border = 'none';
      gameBtn.style.borderRadius = '4px';
      gameBtn.style.cursor = 'pointer';
      gameBtn.style.textAlign = 'left';
      gameBtn.style.transition = 'background-color 0.2s';

      const gameInfo = document.createElement('div');
      gameInfo.innerHTML = `
        <strong>${save.name}</strong><br>
        <small>Moves: ${save.data.moveHistory?.length || 0} | 
        ${new Date(save.timestamp).toLocaleDateString()}</small>
      `;
      gameBtn.appendChild(gameInfo);

      gameBtn.addEventListener('mouseenter', () => {
        gameBtn.style.backgroundColor = '#4a4a4a';
      });

      gameBtn.addEventListener('mouseleave', () => {
        gameBtn.style.backgroundColor = '#3a3a3a';
      });

      gameBtn.addEventListener('click', () => {
        if (this.menuOptions.onLoadGame) {
          this.menuOptions.onLoadGame(save.data);
          this.close();
        }
      });

      loadContainer.appendChild(gameBtn);
    });

    const backBtn = this.createMenuButton('Back', '←', () => {
      this.render();
    });
    backBtn.style.marginTop = '10px';
    loadContainer.appendChild(backBtn);

    this.setContent(loadContainer);
    this.updateFocusableElements();
  }

  private showSaveConfirmation(): void {
    const confirmContainer = document.createElement('div');
    confirmContainer.style.textAlign = 'center';
    confirmContainer.style.color = '#fff';

    const message = document.createElement('p');
    message.textContent = 'Game saved successfully!';
    message.style.fontSize = '1.2rem';
    message.style.marginBottom = '20px';
    confirmContainer.appendChild(message);

    const okBtn = this.createMenuButton('OK', '✓', () => {
      this.close();
    });
    okBtn.style.maxWidth = '200px';
    okBtn.style.margin = '0 auto';
    confirmContainer.appendChild(okBtn);

    this.setContent(confirmContainer);
    this.updateFocusableElements();
  }

  private showImportDialog(): void {
    const importContainer = document.createElement('div');
    importContainer.style.textAlign = 'center';
    importContainer.style.color = '#fff';

    const message = document.createElement('p');
    message.textContent = 'Select a game file to import:';
    message.style.marginBottom = '20px';
    importContainer.appendChild(message);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';

    const selectBtn = this.createMenuButton('Choose File', '📁', () => {
      fileInput.click();
    });
    selectBtn.style.maxWidth = '200px';
    selectBtn.style.margin = '0 auto 10px';
    importContainer.appendChild(selectBtn);

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file && this.menuOptions.onImportGame) {
        this.menuOptions.onImportGame(file);
        this.close();
      }
    });

    const backBtn = this.createMenuButton('Back', '←', () => {
      this.render();
    });
    backBtn.style.maxWidth = '200px';
    backBtn.style.margin = '0 auto';
    importContainer.appendChild(backBtn);

    importContainer.appendChild(fileInput);
    this.setContent(importContainer);
    this.updateFocusableElements();
  }
}
