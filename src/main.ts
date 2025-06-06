import './style.css';
import { Game } from './core/Game';
import { Renderer, QualityManager } from './rendering';
import { InputHandler, MenuModal, SettingsModal, DialogManager, NetworkModal, NetworkStatus, ConflictNotification, PerformanceStats, KeyboardHelpModal } from './ui';
import { StorageManager } from './storage';
import { downloadFile, uploadJSON } from './utils/fileIO';
import { PerformanceMonitor, AccessibilityManager, logger } from './utils';

// Get canvas element
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
if (!canvas) {
  throw new Error('Canvas element not found');
}

// Load settings first
const settings = StorageManager.loadSettings();

// Create dialog manager
const dialogManager = new DialogManager();

// Create network status UI (initially hidden)
const networkStatus = new NetworkStatus();

// Create conflict notification UI
const conflictNotification = new ConflictNotification();

// NetworkManager instance (created when network game starts)
let networkManager: any = null;

// Create game instance - try to restore from storage
const loadedGame = StorageManager.loadGame();
let game = loadedGame || new Game({ boardSize: 7 });

// Create renderer
const renderer = new Renderer({
  canvas,
  boardSize: 7,
  antialias: true
});

// Initialize performance monitoring
const performanceMonitor = new PerformanceMonitor({
  targetFps: 60,
  minAcceptableFps: 30,
  maxMemoryUsage: 500 * 1024 * 1024, // 500MB
  maxDrawCalls: 1000
});

const qualityManager = new QualityManager(performanceMonitor);

// Set up renderer with performance optimization
renderer.setPerformanceMonitor(performanceMonitor);
renderer.setQualityManager(qualityManager);

// Optional: Add performance stats overlay (development mode)
let performanceStats: PerformanceStats | null = null;
if ((import.meta as any).env?.DEV) {
  performanceStats = new PerformanceStats(performanceMonitor);
}

// Listen for quality changes and update settings
qualityManager.on('quality-changed', ({ preset, reason }: any) => {
  logger.info('Quality changed', { preset, reason });
  
  // Save quality preference
  (settings as any).performanceQuality = preset;
  StorageManager.save(game, settings);
});

// Load saved quality preference
const savedQuality = (settings as any).performanceQuality;
if (savedQuality && typeof savedQuality === 'string') {
  qualityManager.setQualityPreset(savedQuality);
}

// Apply theme settings to renderer
const colors = settings.getColors();
const opacity = settings.getOpacitySettings();
renderer.applyColorSettings(colors);
renderer.applyOpacitySettings(opacity);

// Set the board
renderer.setBoard(game.getBoard());

// Create accessibility manager
const accessibilityManager = new AccessibilityManager(game);

// Create input handler
const inputHandler = new InputHandler({
  canvas,
  camera: renderer.getCamera(),
  scene: renderer.getScene(),
  controls: renderer.getControls() as any, // OrbitControls type mismatch with Three.js version
  game,
  renderer,
  accessibilityManager
});

// Start focus indicator animation
inputHandler.startAnimationLoop();

// Set up input event listeners
inputHandler.on('piecePlaced', () => {
  renderer.updatePieces();
});

inputHandler.on('showHelp', () => {
  const helpModal = new KeyboardHelpModal();
  helpModal.open();
});

inputHandler.on('openMenu', () => {
  menuModal.open();
});

inputHandler.on('invalidMove', (data) => {
  logger.warn('Invalid move', { error: data.error });
});

inputHandler.on('temporaryModeChanged', (data) => {
  logger.debug('Temporary mode changed', { enabled: data.enabled });
});

// Subscribe to game events
game.on('move', () => {
  renderer.setBoard(game.getBoard());
  renderer.updatePieces();
});

game.on('gameOver', (data: any) => {
  logger.info('Game Over!', { 
    winner: data.winner?.id, 
    winType: data.winType 
  });
});

// Start render loop
renderer.startRenderLoop();

// Expose objects for E2E testing
if ((window as any).Playwright || (import.meta as any).env?.DEV) {
  (window as any).game = game;
  (window as any).renderer = renderer;
  (window as any).inputHandler = inputHandler;
  logger.debug('Game objects exposed for testing');
}

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
    renderer.setBoard(game.getBoard());
    renderer.updatePieces();
    updateUI();
  }
});

redoBtn.addEventListener('click', () => {
  if (game.redo()) {
    renderer.setBoard(game.getBoard());
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
    renderer.setBoard(game.getBoard());
    renderer.updatePieces();
    updateUI();
  }
});

// History slider
historySlider.addEventListener('input', () => {
  const targetIndex = parseInt(historySlider.value);
  if (game.goToMove(targetIndex)) {
    renderer.setBoard(game.getBoard());
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

// Get the existing menu button from HTML
const menuBtn = document.getElementById('menu-btn') as HTMLButtonElement;

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
      // Disconnect network if active
      if (networkManager) {
        networkManager.disconnect();
        networkManager = null;
        networkStatus.hide();
      }
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
      'Pente3D v1.0\n\nA 3D implementation of the classic Pente game.\n\nBuilt with Three.js and TypeScript.'
    );
  },
  onNetworkGame: () => {
    const networkModal = new NetworkModal({
      game,
      onNetworkStart: (nm) => {
        networkManager = nm;
        networkStatus.setNetworkManager(nm);
        setupNetworkHandlers();
        dialogManager.showInfo('Network game started!');
      },
      onCancel: () => {
        // User cancelled network game
      }
    });
    networkModal.open();
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

// Setup network handlers
function setupNetworkHandlers() {
  if (!networkManager) return;

  // Handle network moves
  networkManager.on('move', (data: any) => {
    const move = data.move;
    const position = move.getPosition();
    if (game.placePiece(position)) {
      renderer.updatePieces();
      updateUI();
    }
  });

  // Handle undo
  networkManager.on('undo', () => {
    if (game.undo()) {
      renderer.updatePieces();
      updateUI();
    }
  });

  // Handle redo
  networkManager.on('redo', () => {
    if (game.redo()) {
      renderer.updatePieces();
      updateUI();
    }
  });

  // Handle reset
  networkManager.on('reset', () => {
    game.reset();
    renderer.updatePieces();
    updateUI();
  });

  // Handle sync
  networkManager.on('sync', (data: any) => {
    try {
      const newGame = Game.importGame(data.gameState);
      if (newGame) {
        game = newGame;
        renderer.setBoard(game.getBoard());
        renderer.updatePieces();
        updateUI();
      }
    } catch (error) {
      logger.error('Failed to sync game state', error as Error);
    }
  });

  // Handle conflicts
  networkManager.on('conflictDetected', (data: any) => {
    // Show conflict notification using dialog manager for now
    dialogManager.showWarning(data.message);
  });

  // Handle connection events
  networkManager.on('error', (error: Error) => {
    dialogManager.showError('Network error: ' + error.message);
  });

  networkManager.on('disconnected', () => {
    dialogManager.showWarning('Network connection lost');
  });

  // Hook into game events to send to network
  game.on('move', (data: any) => {
    if (networkManager && networkManager.getConnectionInfo().status === 'connected') {
      networkManager.sendMove(data.move);
    }
  });
}

// Check URL for join parameter
const urlParams = new URLSearchParams(window.location.search);
const joinCode = urlParams.get('join');
if (joinCode) {
  // Auto-open network modal to join game
  setTimeout(() => {
    const networkModal = new NetworkModal({
      game,
      onNetworkStart: (nm) => {
        networkManager = nm;
        networkStatus.setNetworkManager(nm);
        setupNetworkHandlers();
        dialogManager.showInfo('Joined network game!');
      }
    });
    networkModal.open();
    // Trigger join with the code
    setTimeout(() => {
      const input = document.querySelector('.game-code-input') as HTMLInputElement;
      const joinBtn = document.querySelector('.join-game-btn') as HTMLButtonElement;
      if (input && joinBtn) {
        input.value = joinCode;
        input.dispatchEvent(new Event('input'));
        joinBtn.click();
      }
    }, 100);
  }, 500);
}

// Listen for accessibility preferences
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
  accessibilityManager.setReducedMotion(e.matches);
  if (e.matches) {
    // Disable animations in renderer
    renderer.setReducedMotion?.(true);
  }
});

window.matchMedia('(prefers-contrast: high)').addEventListener('change', (e) => {
  accessibilityManager.setHighContrastMode(e.matches);
  document.body.classList.toggle('high-contrast', e.matches);
});

// Check initial media query states
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  accessibilityManager.setReducedMotion(true);
  renderer.setReducedMotion?.(true);
}

if (window.matchMedia('(prefers-contrast: high)').matches) {
  accessibilityManager.setHighContrastMode(true);
  document.body.classList.add('high-contrast');
}

// Global keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Check if focus is in an input field
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    return;
  }
  
  if (e.key === 'h' || e.key === 'H') {
    const helpModal = new KeyboardHelpModal();
    helpModal.open();
  }
});

// Toggle performance stats with F3
document.addEventListener('keydown', (e) => {
  if (e.key === 'F3' && performanceStats) {
    e.preventDefault();
    performanceStats.toggle();
  }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  performanceMonitor.stopMonitoring();
  if (performanceStats) {
    performanceStats.destroy();
  }
  inputHandler.dispose();
  renderer.dispose();
  menuModal.destroy();
  dialogManager.closeAll();
  networkStatus.dispose();
  conflictNotification.dispose();
  accessibilityManager.dispose();
  if (networkManager) {
    networkManager.disconnect();
  }
});
