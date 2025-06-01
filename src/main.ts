import './style.css';
import { Game } from './core/Game';
import { Renderer } from './rendering/Renderer';
import { InputHandler } from './ui/InputHandler';

// Get canvas element
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
if (!canvas) {
  throw new Error('Canvas element not found');
}

// Create game instance
const game = new Game({ boardSize: 7 });

// Create renderer
const renderer = new Renderer({
  canvas,
  boardSize: 7,
  antialias: true
});

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

resetBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to reset the game?')) {
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
});

game.on('undo', () => {
  updateUI();
});

game.on('redo', () => {
  updateUI();
});

game.on('reset', () => {
  updateUI();
});

// Initial UI update
updateUI();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  inputHandler.dispose();
  renderer.dispose();
});
