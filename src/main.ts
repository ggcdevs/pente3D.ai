import './style.css';
import { Game } from './core/Game';
import { Renderer } from './rendering/Renderer';
import { Vector3 } from './core/Vector3';

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

// Start render loop
renderer.startRenderLoop();

// Demo: Add some pieces
const demoMoves = [
  Vector3.create(3, 3, 3),
  Vector3.create(4, 3, 3),
  Vector3.create(3, 4, 3),
  Vector3.create(4, 4, 3),
  Vector3.create(3, 3, 4),
];

// Place pieces with delay for visual effect
demoMoves.forEach((position, index) => {
  setTimeout(() => {
    if (game.placePiece(position)) {
      renderer.updatePieces();
    }
  }, index * 1000);
});

// Handle window focus/blur for performance
window.addEventListener('blur', () => renderer.stopRenderLoop());
window.addEventListener('focus', () => renderer.startRenderLoop());

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  renderer.dispose();
});
