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

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  inputHandler.dispose();
  renderer.dispose();
});
