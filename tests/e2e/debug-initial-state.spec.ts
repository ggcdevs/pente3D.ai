import { test, expect } from '@playwright/test';
import { createGameHelpers } from './utils/game-interactions';

test.describe('Debug Initial State', () => {
  test('check initial game state', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    const game = createGameHelpers(page);
    
    console.log('=== Initial State Check ===');
    const initialState = await page.evaluate(() => {
      const g = (window as any).game;
      const board = g.getBoard();
      const pieces = board.getAllPieces();
      const currentPlayer = g.getCurrentPlayer();
      
      // Check specific positions
      const positions = [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 3, z: 3 },
        { x: 1, y: 0, z: 0 }
      ];
      
      const positionChecks = positions.map(pos => ({
        pos,
        hasPiece: board.getPieceAt(pos) !== null
      }));
      
      return {
        pieceCount: pieces.length,
        currentPlayer: currentPlayer.color,
        pieces: pieces.map((p: any) => ({ pos: p.coords, color: p.player.color })),
        positionChecks
      };
    });
    
    console.log('Initial state:', JSON.stringify(initialState, null, 2));
    
    // Try to place at different positions
    console.log('\n=== Testing Different Positions ===');
    
    const positions = [
      { x: 0, y: 0, z: 0, name: 'center' },
      { x: 1, y: 0, z: 0, name: 'right of center' },
      { x: -1, y: 0, z: 0, name: 'left of center' },
      { x: 0, y: 1, z: 0, name: 'above center' },
      { x: 0, y: 0, z: 1, name: 'front of center' }
    ];
    
    for (const pos of positions) {
      console.log(`\nTrying to place at ${pos.name} (${pos.x},${pos.y},${pos.z})`);
      
      const beforeCount = await page.evaluate(() => {
        return (window as any).game.getBoard().getAllPieces().length;
      });
      
      await game.placePiece(pos.x, pos.y, pos.z);
      await page.waitForTimeout(500);
      
      const afterState = await page.evaluate(({ x, y, z }) => {
        const g = (window as any).game;
        const board = g.getBoard();
        const pieces = board.getAllPieces();
        const pieceAtPos = board.getPieceAt({ x, y, z });
        
        return {
          totalPieces: pieces.length,
          pieceAtPosition: pieceAtPos ? { color: pieceAtPos.player.color } : null,
          lastPiece: pieces[pieces.length - 1] ? {
            pos: pieces[pieces.length - 1].coords,
            color: pieces[pieces.length - 1].player.color
          } : null
        };
      }, pos);
      
      console.log(`Result: ${afterState.totalPieces} pieces total`);
      if (afterState.totalPieces > beforeCount) {
        console.log(`Success! Placed ${afterState.lastPiece?.color} at (${afterState.lastPiece?.pos.x},${afterState.lastPiece?.pos.y},${afterState.lastPiece?.pos.z})`);
      } else {
        console.log('Failed to place piece');
      }
    }
  });
});