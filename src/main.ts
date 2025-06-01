import './style.css';
import { Vector3, Board } from '@/core';

console.log('Pente3D.ai - Board Logic Testing');

// Test board creation and line generation
const board = Board.createEmpty(7);
const center = Vector3.zero();
// const player = Player.createLocal('test', 'black');

// Test Moore neighborhood
const neighbors = board.getNeighbors(center);
console.log(`Center has ${neighbors.length} neighbors`);

// Test line generation
const lineUp = board.generatePartialLine(center, { x: 0, y: 1, z: 0 }, 2);
console.log('Vertical line:', lineUp.toString());

// Test diagonal line
const diagonalEnd = new Vector3(4, 4, 4);
const diagonalLine = board.generateFullLine(center, diagonalEnd);
console.log('Diagonal line:', diagonalLine?.toString());

// Test getting all lines containing a position
const allLines = board.getLinesContaining(center, 5);
console.log(`Found ${allLines.length} possible 5-lines containing center`);

// Basic application bootstrap
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const loading = document.getElementById('loading');
  
  if (!canvas) {
    throw new Error('Game canvas element not found');
  }
  
  if (loading) {
    loading.style.display = 'none';
  }
  
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  
  console.log('Pente3D.ai board logic initialized');
});

window.addEventListener('resize', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
});
