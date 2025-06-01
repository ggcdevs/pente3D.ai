import './style.css';
import { testValue } from '@/utils/test';
import { Vector3, Player, Move, Piece } from '@/core';

console.log('Pente3D.ai initializing...');
console.log(testValue);

// Test basic data structures
const testVector = new Vector3(1, 2, 3);
const testPlayer = Player.createLocal('player1', 'black');
const testMove = Move.createSimple(testVector, testPlayer);
const testPiece = Piece.createNormal(testVector, testPlayer);

console.log('Data structures loaded:', {
  vector: testVector.toString(),
  player: testPlayer.toString(),
  move: testMove.toString(),
  piece: testPiece.toString(),
});

// Basic application bootstrap
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const loading = document.getElementById('loading');

  if (!canvas) {
    throw new Error('Game canvas element not found');
  }

  // Hide loading indicator
  if (loading) {
    loading.style.display = 'none';
  }

  // Basic canvas setup
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  console.log('Pente3D.ai initialized successfully');
});

// Handle window resize
window.addEventListener('resize', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
});
