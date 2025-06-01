import { test, expect } from '@playwright/test';

test.describe('Issue #005: Debug Piece Placement', () => {
  test('trace piece placement flow', async ({ page }) => {
    // Add console logging
    const logs: string[] = [];
    page.on('console', msg => {
      if (msg.text().includes('Click detected') || 
          msg.text().includes('Invalid move') ||
          msg.text().includes('placePiece')) {
        logs.push(`${msg.type()}: ${msg.text()}`);
      }
    });

    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Inject debugging into game
    await page.evaluate(() => {
      const game = (window as any).game;
      const inputHandler = (window as any).inputHandler;
      
      // Override placePiece to add logging
      const originalPlacePiece = game.placePiece.bind(game);
      game.placePiece = function(position: any) {
        console.log('placePiece called with:', position);
        try {
          const result = originalPlacePiece(position);
          console.log('placePiece returned:', result);
          return result;
        } catch (error) {
          console.log('placePiece threw error:', error);
          throw error;
        }
      };
      
      // Log game state
      console.log('Game state:', {
        isGameOver: game.isGameOver(),
        currentPlayer: game.getCurrentPlayer()?.getColor(),
        historyLength: game.getHistoryLength()
      });
    });
    
    // Get initial state
    const initialState = await page.evaluate(() => {
      const game = (window as any).game;
      const board = game.getBoard();
      
      let pieceCount = 0;
      for (let x = 0; x < 7; x++) {
        for (let y = 0; y < 7; y++) {
          for (let z = 0; z < 7; z++) {
            if (board.getPieceAt({ x, y, z })) pieceCount++;
          }
        }
      }
      
      return {
        pieceCount,
        currentPlayer: game.getCurrentPlayer()?.getColor(),
        isGameOver: game.isGameOver()
      };
    });
    
    console.log('Initial state:', initialState);
    
    // Click on a specific position
    await page.mouse.click(640, 360); // Center of viewport
    await page.waitForTimeout(500);
    
    // Get final state
    const finalState = await page.evaluate(() => {
      const game = (window as any).game;
      const board = game.getBoard();
      
      let pieceCount = 0;
      for (let x = 0; x < 7; x++) {
        for (let y = 0; y < 7; y++) {
          for (let z = 0; z < 7; z++) {
            if (board.getPieceAt({ x, y, z })) pieceCount++;
          }
        }
      }
      
      return {
        pieceCount,
        currentPlayer: game.getCurrentPlayer()?.getColor(),
        historyLength: game.getHistoryLength(),
        isGameOver: game.isGameOver()
      };
    });
    
    console.log('Final state:', finalState);
    console.log('Console logs:', logs);
    
    // Check if piece was placed
    expect(finalState.pieceCount).toBeGreaterThan(initialState.pieceCount);
  });
});