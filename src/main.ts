import './style.css';
import { Game } from './core/Game';
import { Renderer } from './rendering/Renderer';
import { InputHandler, MenuModal, SettingsModal, DialogManager } from './ui';
import { StorageManager } from './storage';
import { downloadFile, uploadJSON } from './utils/fileIO';

// Get canvas element
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
if (!canvas) {
  throw new Error('Canvas element not found');
}

// Load settings first
const settings = StorageManager.loadSettings();

// Create dialog manager
const dialogManager = new DialogManager();

// Create game instance - try to restore from storage
const loadedGame = StorageManager.loadGame();
let game = loadedGame || new Game({ boardSize: 7 });

// Create renderer
const renderer = new Renderer({
  canvas,
  boardSize: 7,
  antialias: true
});

// Apply theme settings to renderer
const colors = settings.getColors();
const opacity = settings.getOpacitySettings();
renderer.applyColorSettings(colors);
renderer.applyOpacitySettings(opacity);

// Set the board
renderer.setBoard(game.getBoard());

// Create input handler
const inputHandler = new InputHandler({
  canvas,
  camera: renderer.getCamera(),
  scene: renderer.getScene(),
  controls: renderer.getControls() as any, // OrbitControls type mismatch with Three.js version
  game,
  renderer
});

// Set up input event listeners
inputHandler.on('piecePlaced', () => {
  renderer.updatePieces();
});

inputHandler.on('invalidMove', (data) => {
  console.warn('Invalid move:', data.error);
});

inputHandler.on('temporaryModeChanged', (data) => {
  console.log('Temporary mode:', data.enabled);
});

// Subscribe to game events
game.on('move', () => {
  renderer.updatePieces();
});

game.on('gameOver', (data: any) => {
  console.log('Game Over! Winner:', data.winner?.id);
  console.log('Win type:', data.winType);
});

// Start render loop
renderer.startRenderLoop();

// Handle window focus/blur for performance
window.addEventListener('blur', () => renderer.stopRenderLoop());
window.addEventListener('focus', () => renderer.startRenderLoop());

// Get UI elements
const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
const redoBtn = document.getElementById('redo-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const historySlider = document.getElementById('history-slider') as HTMLInputElement;
const historyInfo = document.getElementById('history-info') as HTMLSpanElement;
const playerIndicator = document.querySelector('.player-indicator') as HTMLSpanElement;
const blackCaptures = document.getElementById('black-captures') as HTMLSpanElement;
const whiteCaptures = document.getElementById('white-captures') as HTMLSpanElement;

// Update UI function
function updateUI() {
  const currentState = game.getCurrentState();
  const historyLength = game.getHistoryLength();
  const currentIndex = game.getCurrentStateIndex();
  
  // Update buttons
  undoBtn.disabled = !game.canUndo();
  redoBtn.disabled = !game.canRedo();
  
  // Update history slider
  historySlider.max = String(historyLength - 1);
  historySlider.value = String(currentIndex);
  historyInfo.textContent = `Move ${currentIndex} / ${historyLength - 1}`;
  
  // Update player indicator
  const currentPlayer = currentState.getCurrentPlayer();
  playerIndicator.className = `player-indicator ${currentPlayer.getColor()}`;
  
  // Update capture counts
  blackCaptures.textContent = String(currentState.getBlackPlayer().getCaptureCount());
  whiteCaptures.textContent = String(currentState.getWhitePlayer().getCaptureCount());
}

// Set up button event listeners
undoBtn.addEventListener('click', () => {
  if (game.undo()) {
    renderer.updatePieces();
    updateUI();
  }
});

redoBtn.addEventListener('click', () => {
  if (game.redo()) {
    renderer.updatePieces();
    updateUI();
  }
});

resetBtn.addEventListener('click', async () => {
  const confirmed = await dialogManager.confirmAction(
    'reset the game',
    'This will clear all moves and start a new game.'
  );
  if (confirmed) {
    game.reset();
    renderer.updatePieces();
    updateUI();
  }
});

// History slider
historySlider.addEventListener('input', () => {
  const targetIndex = parseInt(historySlider.value);
  if (game.goToMove(targetIndex)) {
    renderer.updatePieces();
    updateUI();
  }
});

// Update UI when game state changes
game.on('move', () => {
  updateUI();
  // Auto-save after each move
  StorageManager.save(game, settings);
});

game.on('undo', () => {
  updateUI();
  // Save after undo
  StorageManager.save(game, settings);
});

game.on('redo', () => {
  updateUI();
  // Save after redo
  StorageManager.save(game, settings);
});

game.on('reset', () => {
  updateUI();
  // Save after reset
  StorageManager.save(game, settings);
});

// Initial UI update
updateUI();

// Apply settings to renderer
if (settings.getGridDiagonals()) {
  // This would require adding a method to renderer to toggle diagonals
  // For now, we'll add this functionality later
}

// Listen for settings changes
settings.addChangeListener((newSettings) => {
  StorageManager.save(game, newSettings);
});

// Add menu button to controls
const menuBtn = document.createElement('button');
menuBtn.id = 'menu-btn';
menuBtn.textContent = '☰ Menu';
menuBtn.style.marginRight = 'auto';
document.getElementById('game-controls')?.prepend(menuBtn);

// Create menu modal
const menuModal = new MenuModal({
  game,
  onNewGame: async () => {
    const confirmed = await dialogManager.confirmAction(
      'start a new game',
      'This will clear the current game progress.'
    );
    if (confirmed) {
      game.reset();
      renderer.updatePieces();
      updateUI();
      dialogManager.showInfo('New game started!');
    }
  },
  onLoadGame: (gameState) => {
    try {
      const newGame = Game.importGame(JSON.stringify(gameState));
      if (newGame) {
        game = newGame;
      }
      renderer.setBoard(game.getBoard());
      renderer.updatePieces();
      updateUI();
      dialogManager.showInfo('Game loaded successfully!');
    } catch (error) {
      dialogManager.showError('Failed to load game: ' + (error as Error).message);
    }
  },
  onSaveGame: () => {
    try {
      StorageManager.save(game, settings);
    } catch (error) {
      dialogManager.showError('Failed to save game: ' + (error as Error).message);
    }
  },
  onExportGame: () => {
    try {
      const exportData = game.exportGame();
      downloadFile(exportData, `pente3d_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
      dialogManager.showInfo('Game exported successfully!');
    } catch (error) {
      dialogManager.showError('Failed to export game: ' + (error as Error).message);
    }
  },
  onImportGame: async (file) => {
    try {
      const gameData = await uploadJSON(file);
      const newGame = Game.importGame(JSON.stringify(gameData));
      if (newGame) {
        game = newGame;
      }
      renderer.setBoard(game.getBoard());
      renderer.updatePieces();
      updateUI();
      dialogManager.showInfo('Game imported successfully!');
    } catch (error) {
      dialogManager.showError('Failed to import game: ' + (error as Error).message);
    }
  },
  onSettings: () => {
    const settingsModal = new SettingsModal({
      settings,
      renderer,
      onSettingsChange: (newSettings) => {
        // Apply settings changes
        StorageManager.save(game, newSettings);
        dialogManager.showInfo('Settings saved!');
      }
    });
    settingsModal.open();
  },
  onAbout: () => {
    dialogManager.showInfo(
      'Pente3D v1.0\n\nA 3D implementation of the classic Pente game.\n\nBuilt with Three.js and TypeScript.',
      'About Pente3D'
    );
  }
});

// Menu button click handler
menuBtn.addEventListener('click', () => {
  menuModal.open();
});

// Add keyboard shortcut for menu (Escape key)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.querySelector('.modal')) {
    menuModal.open();
  }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  inputHandler.dispose();
  renderer.dispose();
  menuModal.destroy();
  dialogManager.closeAll();
});
